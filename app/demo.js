import { randomBytes } from 'node:crypto';
import { startServer } from './server.js';
const port = Number(process.env.PORT || 3000);
const app = startServer({ demo: true, port, databasePath: './data/demo.sqlite', publicUrl: `http://localhost:${port}`,
  adminToken: process.env.ADMIN_TOKEN || 'demo-verwaltung-nur-lokal-1234567890', syncToken: randomBytes(32).toString('hex') });
if (!app.store.list().length) {
  const day = new Date(); day.setUTCDate(day.getUTCDate() + 3); day.setUTCHours(17, 0, 0, 0);
  app.store.sync({ groupId: 'demo-film', events: [{ id: 'demo-film-1', title: 'Ein Abend im Dorfkino · Testvorstellung', startsAt: day.toISOString(), note: 'Beispieltermin zum Ausprobieren. Keine echte Vorstellung.' },
    { id: 'demo-film-2', title: 'Ein Abend im Dorfkino · Testvorstellung', startsAt: new Date(+day + 150 * 60000).toISOString(), note: 'Beispieltermin zum Ausprobieren. Keine echte Vorstellung.' }] });
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => void app.close().then(() => process.exit(0)));
