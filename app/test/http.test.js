import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../server.js';
import { createStore } from '../store.js';
import { DatabaseSync } from 'node:sqlite';

const adminToken = 'admin-test-secret-with-more-than-32-characters';
const syncToken = 'sync-test-secret-with-more-than-32-characters';
async function fixture(t) {
  const app = startServer({ demo: true, port: 0, host: '127.0.0.1', databasePath: ':memory:', publicUrl: 'http://localhost', adminToken, syncToken });
  await once(app.server, 'listening');
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const post = (path, data, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost', ...headers }, body: JSON.stringify(data) });
  const startsAt = new Date(Date.now() + 86400000).toISOString();
  const response = await post('/api/sync', { groupId: 'film', events: [{ id: 'film-1', title: 'Testfilm', startsAt }] }, { Authorization: `Bearer ${syncToken}` });
  assert.equal(response.status, 200);
  return { ...app, base, post };
}
const booking = (quantity = 1) => ({ eventId: 'film-1', name: 'HTTP-Test', email: 'http@example.org', quantity, requestKey: randomUUID() });

test('24 gleichzeitige HTTP-Anfragen reservieren genau 16 Plätze', async t => {
  const app = await fixture(t);
  const responses = await Promise.all(Array.from({ length: 24 }, () => app.post('/api/reservations', booking())));
  assert.equal(responses.filter(r => r.status === 201).length, 16);
  assert.equal(responses.filter(r => r.status === 409).length, 8);
  assert.equal(app.store.list()[0].available, 0);
  assert.equal(app.store.pendingMail().length, 10); // Abfrage ist auf 10 pro Maildurchlauf begrenzt.
  assert.equal(app.store.db.prepare('SELECT count(*) AS n FROM reservations').get().n, 16);
});
test('Fremde Herkunft, fremde Import-Token und unauthentifizierte Verwaltung werden abgewiesen', async t => {
  const app = await fixture(t);
  assert.equal((await app.post('/api/reservations', booking(), { Origin: 'https://fremd.example' })).status, 403);
  assert.equal((await app.post('/api/sync', { groupId: 'film', events: [] })).status, 401);
  assert.equal((await fetch(app.base + '/api/admin/events')).status, 401);
  assert.equal((await fetch(app.base + '/admin')).status, 401);
  const valid = await fetch(app.base + '/api/admin/events', { headers: { Authorization: `Basic ${Buffer.from('kino:' + adminToken).toString('base64')}` } });
  assert.equal(valid.status, 200);
  assert.equal((await fetch(app.base + '/.env')).status, 404);
  assert.equal((await fetch(app.base + '/data/kino.sqlite')).status, 404);
});
test('Reservierung, lesender Stornoabruf und Stornierung funktionieren über HTTP', async t => {
  const app = await fixture(t);
  const first = await app.post('/api/reservations', { ...booking(3), notes: '2 Mitglieder\n1 Gast' }); const result = await first.json();
  assert.equal(first.status, 201); assert.equal(result.quantity, 3);
  assert.equal(result.notes, '2 Mitglieder\n1 Gast');
  const token = new URL(result.cancelUrl).hash.slice(1);
  const info = await app.post('/api/cancellation', { token }); assert.equal(info.status, 200);
  assert.equal(app.store.list()[0].available, 13);
  assert.equal((await fetch(app.base + '/api/cancel')).status, 404);
  assert.equal((await app.post('/api/cancel', { token })).status, 200);
  assert.equal(app.store.list()[0].available, 16);
});
test('HTML, JS und CSS werden mit Schutzheadern ausgeliefert', async t => {
  const app = await fixture(t);
  for (const path of ['/', '/stornieren', '/app.js', '/style.css', '/assets/dorfkino-logo.png', '/assets/roboto-slab-400.ttf', '/assets/roboto-slab-500.ttf']) {
    const response = await fetch(app.base + path); assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.ok(response.headers.get('content-security-policy').includes("script-src 'self'"));
  }
});
test('Backup-Script erzeugt bei offener WAL-Datenbank eine wiederherstellbare Sicherung', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dorfkino-backup-')); const path = join(dir, 'kino.sqlite');
  const s = createStore(path);
  try {
    s.sync({ groupId: 'film', events: [{ id: 'film-1', title: 'Sicherung', startsAt: new Date(Date.now() + 86400000).toISOString() }] });
    const r = s.reserve(booking(7));
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('../backup.js', import.meta.url))], { cwd: dir, env: { ...process.env, DATABASE_PATH: path }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const files = readdirSync(join(dir, 'backups')); assert.equal(files.length, 1);
    const restored = createStore(join(dir, 'backups', files[0]));
    try { assert.equal(restored.list()[0].available, 9); assert.equal(restored.cancellationInfo(new URL(r.cancelUrl).hash.slice(1)).quantity, 7); assert.equal(restored.pendingMail().length, 1); }
    finally { restored.close(); }
  } finally { s.close(); rmSync(dir, { recursive: true, force: true }); }
});
test('Reservierungen und Mailwarteschlange überstehen einen Datenbank-Neustart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dorfkino-test-')); const path = join(dir, 'db.sqlite');
  try {
    let s = createStore(path);
    s.sync({ groupId: 'film', events: [{ id: 'film-1', title: 'Persistenz', startsAt: new Date(Date.now() + 86400000).toISOString() }] });
    const r = s.reserve(booking(5)); s.close();
    s = createStore(path);
    try { assert.equal(s.list()[0].available, 11); assert.equal(s.pendingMail().length, 1); assert.equal(s.cancellationInfo(new URL(r.cancelUrl).hash.slice(1)).quantity, 5); }
    finally { s.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('Bestehende Datenbank erhält Anmerkungsspalte ohne Verlust von Buchungen oder Wiederholbarkeit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dorfkino-migration-')); const path = join(dir, 'kino.sqlite');
  try {
    let s = createStore(path);
    s.sync({ groupId: 'film', events: [{ id: 'film-1', title: 'Bestand', startsAt: new Date(Date.now() + 86400000).toISOString() }] });
    const request = booking(4); const r = s.reserve(request); s.close();
    const legacy = new DatabaseSync(path); legacy.exec('ALTER TABLE reservations DROP COLUMN notes'); legacy.close();
    s = createStore(path);
    try {
      assert.equal(s.list()[0].available, 12);
      assert.equal(s.adminList()[0].reservations[0].notes, '');
      assert.equal(s.reserve(request).id, r.id);
      assert.equal(s.pendingMail().length, 1);
    } finally { s.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
