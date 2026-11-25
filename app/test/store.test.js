import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createStore } from '../store.js';

const timestamp = Date.parse('2030-06-01T12:00:00Z');
const payload = (quantity = 1) => ({ eventId: 'film-1', quantity, name: 'Testgast', email: 'test@example.org', requestKey: randomUUID() });
const event = (id = 'film-1', startsAt = '2030-06-02T15:00:00Z') => ({ id, title: 'Testfilm', startsAt });
function fixture(t) { const s = createStore(':memory:', { now: () => timestamp }); s.sync({ groupId: 'film', events: [event()] }); t.after(() => s.close()); return s; }

test('16 Plätze buchbar; 17. Platz wird abgewiesen', t => {
  const s = fixture(t); s.reserve(payload(16));
  assert.equal(s.list()[0].available, 0);
  assert.throws(() => s.reserve(payload()), { status: 409 });
  assert.equal(s.db.prepare('SELECT count(*) AS n FROM reservations').get().n, 1);
});
test('Gruppenbuchung ist atomar, Restplätze bleiben bei zu großer Anfrage frei', t => {
  const s = fixture(t); s.reserve(payload(14));
  assert.throws(() => s.reserve(payload(3)), { status: 409 });
  assert.equal(s.list()[0].available, 2);
  s.reserve(payload(2)); assert.equal(s.list()[0].available, 0);
});
test('Zweite Startzeit hat unabhängige Kapazität', t => {
  const s = fixture(t); s.sync({ groupId: 'film', events: [event(), event('film-2', '2030-06-02T17:30:00Z')] });
  s.reserve(payload(16)); assert.equal(s.list()[1].available, 16);
});
test('Netzwerkwiederholung erzeugt nur eine Reservierung und eine Mail', t => {
  const s = fixture(t); const p = payload(3); const a = s.reserve(p); const b = s.reserve(p);
  assert.equal(a.id, b.id); assert.equal(s.list()[0].available, 13); assert.equal(s.pendingMail().length, 1);
  assert.throws(() => s.reserve({ ...p, quantity: 2 }), { status: 409 });
});
test('Storno gibt Plätze frei und ist idempotent; Linkaufruf allein verändert nichts', t => {
  const s = fixture(t); const r = s.reserve(payload(4)); const token = new URL(r.cancelUrl).hash.slice(1);
  assert.equal(s.cancellationInfo(token).quantity, 4); assert.equal(s.list()[0].available, 12);
  assert.throws(() => s.cancel('falsch'), { status: 404 });
  s.cancel(token); s.cancel(token); assert.equal(s.list()[0].available, 16);
  assert.equal(s.cancellationInfo(token).status, 'cancelled');
  assert.equal(s.pendingMail().length, 1); assert.match(s.pendingMail()[0].subject, /Stornierung/);
});
test('Ungültige Mengen erzeugen weder Buchung noch E-Mail', t => {
  const s = fixture(t);
  for (const quantity of [0, -1, 17, 1.5, '2', null]) assert.throws(() => s.reserve({ ...payload(), quantity }), { status: 400 });
  assert.equal(s.list()[0].available, 16); assert.equal(s.pendingMail().length, 0);
});
test('Import ist idempotent, Film- und Terminwechsel mit Buchungen werden abgewiesen', t => {
  const s = fixture(t); s.reserve(payload());
  s.sync({ groupId: 'film', events: [event()] }); assert.equal(s.list().length, 1); assert.equal(s.list()[0].available, 15);
  assert.throws(() => s.sync({ groupId: 'film', events: [event('film-1', '2030-06-03T15:00:00Z')] }), { status: 409 });
  assert.throws(() => s.sync({ groupId: 'film', events: [{ ...event(), title: 'Anderer Film' }] }), { status: 409 });
  assert.throws(() => s.sync({ groupId: 'film', events: [] }), { status: 409 });
  assert.equal(s.list()[0].available, 15);
});
test('Import lehnt vergangene, doppelte und uneindeutige Termine ab', t => {
  const s = fixture(t);
  for (const events of [[event('film-1', '2020-06-01T10:00:00Z')], [event(), event()], [event('film-1', '2030-06-02T17:00:00')]]) assert.throws(() => s.sync({ groupId: 'film', events }), { status: 400 });
});
test('Begonnene Vorstellung wird weder gelistet noch reserviert', t => {
  let clock = timestamp; const s = createStore(':memory:', { now: () => clock }); t.after(() => s.close());
  s.sync({ groupId: 'film', events: [event()] }); const r = s.reserve(payload());
  clock = Date.parse('2030-06-02T15:00:00Z'); assert.equal(s.list().length, 0);
  assert.throws(() => s.reserve(payload()), { status: 404 });
  assert.throws(() => s.cancel(new URL(r.cancelUrl).hash.slice(1)), { status: 409 });
});
test('Öffentliche Filmdaten enthalten keine Gastdaten oder internen Platznummern', t => {
  const s = fixture(t); s.reserve(payload()); const data = JSON.stringify(s.list());
  assert.doesNotMatch(data, /Testgast|test@example|cancel|email|A1/);
});
test('Bestätigung vergibt keine festen Sitze; Mailversand lässt sich erneut versuchen', t => {
  const s = fixture(t); s.reserve(payload(2)); const mail = s.pendingMail()[0];
  assert.match(mail.body, /Anzahl Plätze: 2/); assert.match(mail.body, /Freie Sitzwahl/); assert.doesNotMatch(mail.body, /^Plätze:.*\bA[1-4]\b/m);
  s.mailFailed(mail.id); assert.equal(s.pendingMail().length, 0);
  assert.equal(s.db.prepare('SELECT attempts FROM outbox WHERE id=?').get(mail.id).attempts, 1);
});
test('Mehrzeilige Anmerkungen werden gespeichert, bestätigt und nur privat angezeigt', t => {
  const s = fixture(t); const notes = '2 Mitglieder\nBitte um Rückruf <script>alert(1)</script>';
  const p = { ...payload(2), notes }; const r = s.reserve(p);
  assert.equal(r.notes, notes);
  assert.equal(s.reserve(p).id, r.id);
  assert.equal(s.adminList()[0].reservations[0].notes, notes);
  assert.ok(s.pendingMail()[0].body.includes('Anmerkungen/Mitglieder:\n' + notes));
  assert.doesNotMatch(JSON.stringify(s.list()), /Mitglieder|Rückruf|script/);
  assert.throws(() => s.reserve({ ...p, notes: 'Andere Angaben' }), { status: 409 });
});
test('Anmerkungen sind optional; ungültige oder zu lange Angaben werden abgewiesen', t => {
  const s = fixture(t);
  assert.equal(s.reserve(payload()).notes, '');
  assert.equal(s.reserve({ ...payload(), notes: '  Erste Zeile\r\nZweite Zeile  ' }).notes, 'Erste Zeile\nZweite Zeile');
  for (const notes of ['a'.repeat(1001), {}, 12, null, 'Text\u0000']) assert.throws(() => s.reserve({ ...payload(), notes }), { status: 400 });
  assert.equal(s.list()[0].available, 14);
});
