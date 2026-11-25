import { DatabaseSync, backup } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
const source = process.env.DATABASE_PATH || './data/kino.sqlite';
mkdirSync('./backups', { recursive: true, mode: 0o700 });
const target = `./backups/kino-${new Date().toISOString().replaceAll(':', '-')}.sqlite`;
const db = new DatabaseSync(source, { readOnly: true });
try { await backup(db, target); console.log(`Konsistente Sicherung erstellt: ${target}`); }
finally { db.close(); }
