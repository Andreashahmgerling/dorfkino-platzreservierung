import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export class Problem extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (message, status = 400) => { throw new Problem(status, message); };
export const hash = value => createHash('sha256').update(value).digest('hex');
export const SEATS = [...'ABCD'].flatMap(row => [1, 2, 3, 4].map(n => `${row}${n}`));
const bounded = (value, max, label) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x1f\x7f]/.test(value)) fail(`${label} ist ungültig.`);
  return value.trim();
};

export function createStore(path = ':memory:', { now = () => Date.now(), publicUrl = 'http://localhost:3000', demo = false } = {}) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY, group_id TEXT NOT NULL, title TEXT NOT NULL,
      starts_at INTEGER NOT NULL, published INTEGER NOT NULL DEFAULT 1,
      note TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reservations (
      id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id),
      name TEXT NOT NULL, email TEXT NOT NULL, cancel_hash TEXT UNIQUE NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('confirmed','cancelled')),
      request_key TEXT UNIQUE NOT NULL, fingerprint TEXT NOT NULL,
      created_at INTEGER NOT NULL, email_sent_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS seats (
      event_id TEXT NOT NULL REFERENCES events(id), seat TEXT NOT NULL,
      reservation_id TEXT NOT NULL REFERENCES reservations(id),
      PRIMARY KEY(event_id,seat)
    );
    CREATE TABLE IF NOT EXISTS reservation_seats (
      reservation_id TEXT NOT NULL REFERENCES reservations(id), seat TEXT NOT NULL,
      PRIMARY KEY(reservation_id,seat)
    );
    CREATE TABLE IF NOT EXISTS outbox (
      id TEXT PRIMARY KEY, reservation_id TEXT NOT NULL REFERENCES reservations(id),
      recipient TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL, last_error TEXT
    );
    CREATE INDEX IF NOT EXISTS event_start ON events(starts_at);
    CREATE INDEX IF NOT EXISTS reservation_event ON reservations(event_id);
  `);
  // Bestehende Reservierungen bei der Erweiterung unverändert erhalten.
  if (!db.prepare('PRAGMA table_info(reservations)').all().some(column => column.name === 'notes')) {
    db.exec("ALTER TABLE reservations ADD COLUMN notes TEXT NOT NULL DEFAULT ''");
  }
  const transaction = fn => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  const seatList = id => db.prepare('SELECT seat FROM reservation_seats WHERE reservation_id=? ORDER BY seat').all(id).map(x => x.seat);
  const localTime = ms => new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'full', timeStyle: 'short' }).format(ms);
  const summary = row => ({ id: row.id, title: row.title, startsAt: new Date(row.starts_at).toISOString(), groupId: row.group_id, note: row.note,
    available: 16 - db.prepare('SELECT count(*) AS n FROM seats WHERE event_id=?').get(row.id).n, capacity: 16 });
  const reservationResult = row => ({ id: row.id, status: row.status, quantity: seatList(row.id).length, email: row.email, notes: row.notes, emailSent: !!row.email_sent_at });
  const queueMail = (reservationId, recipient, subject, body) => {
    db.prepare('INSERT INTO outbox(id,reservation_id,recipient,subject,body,next_at) VALUES(?,?,?,?,?,?)').run(randomUUID(), reservationId, recipient, subject, body, now());
  };
  return {
    db,
    list(group) {
      const rows = group ? db.prepare('SELECT * FROM events WHERE published=1 AND starts_at>? AND group_id=? ORDER BY starts_at').all(now(), group)
        : db.prepare('SELECT * FROM events WHERE published=1 AND starts_at>? ORDER BY starts_at').all(now());
      return rows.map(summary);
    },
    sync(input) {
      const groupId = bounded(input.groupId, 100, 'Film-ID');
      if (!/^[a-zA-Z0-9_-]+$/.test(groupId)) fail('Film-ID ist ungültig.');
      if (!Array.isArray(input.events) || input.events.length > 2) fail('Erwartet werden bis zu zwei Vorstellungen.');
      const parsed = input.events.map(e => {
        const id = bounded(e.id, 110, 'Vorstellungs-ID');
        if (![`${groupId}-1`, `${groupId}-2`].includes(id)) fail('Vorstellungs-ID passt nicht zum Film.');
        const title = bounded(e.title, 200, 'Filmtitel');
        const startsAt = typeof e.startsAt === 'string' ? Date.parse(e.startsAt) : NaN;
        if (!Number.isFinite(startsAt) || !/T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(e.startsAt)) fail('Datum benötigt eine eindeutige Zeitzone.');
        if (startsAt <= now()) fail('Vergangene Vorstellungen können nicht veröffentlicht werden.');
        const note = e.note ? bounded(e.note, 600, 'Hinweis') : '';
        return { id, title, startsAt, note };
      });
      if (new Set(parsed.map(e => e.id)).size !== parsed.length || new Set(parsed.map(e => e.startsAt)).size !== parsed.length) fail('Doppelte Vorstellung.');
      return transaction(() => {
        const old = db.prepare('SELECT * FROM events WHERE group_id=?').all(groupId);
        for (const event of old) {
          const replacement = parsed.find(e => e.id === event.id);
          const booked = db.prepare("SELECT count(*) AS n FROM reservations WHERE event_id=? AND status='confirmed'").get(event.id).n;
          if (booked && (!replacement || replacement.startsAt !== event.starts_at || replacement.title !== event.title)) fail('Für diese Vorstellung gibt es Reservierungen. Filmwechsel, Terminänderung oder Entfernung zuerst mit den Gästen klären und Reservierungen stornieren.', 409);
        }
        db.prepare('UPDATE events SET published=0 WHERE group_id=?').run(groupId);
        for (const e of parsed) db.prepare(`INSERT INTO events(id,group_id,title,starts_at,note,created_at) VALUES(?,?,?,?,?,?)
          ON CONFLICT(id) DO UPDATE SET title=excluded.title,starts_at=excluded.starts_at,note=excluded.note,published=1`).run(e.id, groupId, e.title, e.startsAt, e.note, now());
        return { groupId, count: parsed.length, url: `${publicUrl}/?film=${encodeURIComponent(groupId)}` };
      });
    },
    reserve(input) {
      const eventId = bounded(input.eventId, 110, 'Vorstellung');
      const name = bounded(input.name, 100, 'Name');
      const email = bounded(input.email, 254, 'E-Mail').toLowerCase();
      if (input.notes !== undefined && (typeof input.notes !== 'string' || input.notes.length > 1000 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(input.notes))) fail('Anmerkungen/Mitglieder: Bitte höchstens 1.000 Zeichen eingeben.');
      const notes = (input.notes || '').replace(/\r\n?/g, '\n').trim();
      if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) fail('Bitte eine gültige E-Mail-Adresse eingeben.');
      if (input.website) fail('Die Anfrage konnte nicht verarbeitet werden.');
      const requestKey = bounded(input.requestKey, 100, 'Anfrage-ID');
      if (!/^[a-zA-Z0-9_-]{20,100}$/.test(requestKey)) fail('Anfrage-ID ist ungültig.');
      if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 16) fail('Bitte eine Platzanzahl zwischen 1 und 16 wählen.');
      // Anfragen aus der bisherigen Version ohne Anmerkungen bleiben wiederholbar.
      const fingerprint = hash(JSON.stringify({ eventId, name, email, quantity: input.quantity, ...(notes ? { notes } : {}) }));
      return transaction(() => {
        const previous = db.prepare('SELECT * FROM reservations WHERE request_key=?').get(requestKey);
        if (previous) {
          if (previous.fingerprint !== fingerprint) fail('Diese Anfrage-ID wurde bereits verwendet. Bitte die Seite neu laden.', 409);
          return reservationResult(previous);
        }
        const event = db.prepare('SELECT * FROM events WHERE id=? AND published=1 AND starts_at>?').get(eventId, now());
        if (!event) fail('Diese Vorstellung ist nicht mehr buchbar.', 404);
        const occupied = db.prepare('SELECT seat FROM seats WHERE event_id=?').all(eventId).map(x => x.seat);
        const chosen = SEATS.filter(s => !occupied.includes(s)).slice(0, input.quantity);
        if (chosen.length !== input.quantity) fail('Inzwischen sind weniger Plätze frei. Bitte eine kleinere Anzahl wählen.', 409);
        const id = randomBytes(8).toString('hex').toUpperCase();
        const cancelToken = randomBytes(32).toString('base64url');
        db.prepare(`INSERT INTO reservations(id,event_id,name,email,cancel_hash,status,request_key,fingerprint,created_at,notes)
          VALUES(?,?,?,?,?,'confirmed',?,?,?,?)`).run(id, eventId, name, email, hash(cancelToken), requestKey, fingerprint, now(), notes);
        for (const seat of chosen) {
          db.prepare('INSERT INTO seats(event_id,seat,reservation_id) VALUES(?,?,?)').run(eventId, seat, id);
          db.prepare('INSERT INTO reservation_seats(reservation_id,seat) VALUES(?,?)').run(id, seat);
        }
        const cancelUrl = `${publicUrl}/stornieren#${cancelToken}`;
        queueMail(id, email, `Deine Reservierung: ${event.title}`, `Hallo ${name},\n\ndeine Plätze im Dorfkino Lögow sind reserviert.\n\n${event.title}\n${localTime(event.starts_at)}\nAnzahl Plätze: ${chosen.length}\nReservierungsnummer: ${id}${notes ? '\n\nAnmerkungen/Mitglieder:\n' + notes : ''}\n\nFreie Sitzwahl und Bezahlung vor Ort.\nEintritt: 9 € · ermäßigt 6 € · Mitglieder 4,50 €\n\nReservierung ansehen oder stornieren:\n${cancelUrl}\n\nBis bald im Dorfkino Lögow!\n\nWar das einfach? Webmuli (also Andreas Hahm-Gerling) hat das programmiert. Bitte geben Sie doch ein Feedback mit Stichworten wie Webdesign oder Internetmarketing auf meinem Google Profil!\nhttps://g.page/r/CYJZwG_BTybPEBM/review`);
        return { ...reservationResult(db.prepare('SELECT * FROM reservations WHERE id=?').get(id)), cancelUrl, demo };
      });
    },
    cancellationInfo(token) {
      if (typeof token !== 'string' || token.length > 100) fail('Ungültiger Stornolink.', 404);
      const row = db.prepare('SELECT r.*,e.title,e.starts_at FROM reservations r JOIN events e ON e.id=r.event_id WHERE cancel_hash=?').get(hash(token));
      if (!row) fail('Diese Reservierung wurde nicht gefunden.', 404);
      return { id: row.id, title: row.title, startsAt: new Date(row.starts_at).toISOString(), quantity: seatList(row.id).length, status: row.status, canCancel: row.status === 'confirmed' && row.starts_at > now() };
    },
    cancel(token, adminId) {
      return transaction(() => {
        const row = adminId ? db.prepare('SELECT r.*,e.title FROM reservations r JOIN events e ON e.id=r.event_id WHERE r.id=?').get(adminId)
          : db.prepare('SELECT r.*,e.title,e.starts_at FROM reservations r JOIN events e ON e.id=r.event_id WHERE cancel_hash=?').get(hash(typeof token === 'string' ? token : ''));
        if (!row) fail('Diese Reservierung wurde nicht gefunden.', 404);
        if (row.status === 'cancelled') return { status: 'cancelled' };
        if (!adminId && row.starts_at <= now()) fail('Die Vorstellung hat bereits begonnen. Bitte kontaktiere das Kino.', 409);
        db.prepare("UPDATE reservations SET status='cancelled' WHERE id=?").run(row.id);
        db.prepare('DELETE FROM seats WHERE reservation_id=?').run(row.id);
        db.prepare('DELETE FROM outbox WHERE reservation_id=?').run(row.id);
        queueMail(row.id, row.email, `Stornierung: ${row.title}`, `Hallo ${row.name},\n\ndeine Reservierung ${row.id} für ${row.title} wurde storniert. Deine ${seatList(row.id).length} Plätze sind wieder freigegeben.\n\nDein Dorfkino Lögow`);
        return { status: 'cancelled' };
      });
    },
    adminList() {
      return db.prepare('SELECT * FROM events ORDER BY starts_at DESC LIMIT 200').all().map(e => ({ ...summary(e), published: !!e.published,
        reservations: db.prepare('SELECT id,name,email,notes,status,email_sent_at FROM reservations WHERE event_id=? ORDER BY created_at').all(e.id).map(r => ({ ...r, quantity: seatList(r.id).length, mailPending: !!db.prepare('SELECT id FROM outbox WHERE reservation_id=?').get(r.id) })) }));
    },
    pendingMail() { return db.prepare('SELECT * FROM outbox WHERE next_at<=? ORDER BY next_at LIMIT 10').all(now()); },
    sent(id, reservationId) { transaction(() => { db.prepare('DELETE FROM outbox WHERE id=?').run(id); db.prepare('UPDATE reservations SET email_sent_at=? WHERE id=?').run(now(), reservationId); }); },
    mailFailed(id) { db.prepare("UPDATE outbox SET attempts=attempts+1,next_at=?,last_error='SMTP-Versand fehlgeschlagen' WHERE id=?").run(now() + 5 * 60_000, id); },
    close() { db.close(); }
  };
}
