// Startdatei für Hosting-Panels, die eine CommonJS-Datei erwarten.
const fs = require('node:fs');
if (fs.existsSync('.env')) process.loadEnvFile('.env');
import('./server.js').then(({ startServer }) => {
  const app = startServer();
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => void app.close().then(() => process.exit(0)));
}).catch(error => { console.error(error.message); process.exit(1); });
