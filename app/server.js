import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import nodemailer from 'nodemailer';
import { createStore, Problem, hash } from './store.js';

const equal = (a, b) => timingSafeEqual(Buffer.from(hash(String(a || ''))), Buffer.from(hash(String(b || ''))));
export function startServer(config = {}) {
  const demo = config.demo === true;
  const port = Number(config.port ?? process.env.PORT ?? 3000);
  const host = config.host ?? process.env.HOST ?? '127.0.0.1';
  const publicUrl = (config.publicUrl ?? process.env.PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/$/, '');
  const origin = new URL(publicUrl).origin;
  const adminToken = config.adminToken ?? process.env.ADMIN_TOKEN;
  const syncToken = config.syncToken ?? process.env.SYNC_TOKEN;
  const privacyUrl = process.env.PRIVACY_URL || '';
  const imprintUrl = process.env.IMPRINT_URL || '';
  if (!adminToken || !syncToken || adminToken.length < 32 || syncToken.length < 32 || equal(adminToken, syncToken)) throw new Error('ADMIN_TOKEN und SYNC_TOKEN müssen verschiedene Geheimnisse mit jeweils mindestens 32 Zeichen sein.');
  if (!demo) {
    if (new URL(publicUrl).protocol !== 'https:' || new URL(publicUrl).pathname !== '/') throw new Error('PUBLIC_URL muss eine HTTPS-Subdomain ohne Unterpfad sein.');
    for (const key of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM', 'PRIVACY_URL', 'IMPRINT_URL']) if (!process.env[key]) throw new Error(`${key} fehlt. Zum lokalen Ausprobieren: npm run demo.`);
    for (const url of [privacyUrl, imprintUrl]) if (new URL(url).protocol !== 'https:') throw new Error('Datenschutz und Impressum benötigen HTTPS-Links.');
  }
  const store = config.store ?? createStore(config.databasePath ?? process.env.DATABASE_PATH ?? './data/kino.sqlite', { publicUrl, demo });
  const mailer = demo ? null : nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 465), secure: process.env.SMTP_SECURE !== 'false',
    requireTLS: true, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }, connectionTimeout: 10000, socketTimeout: 15000, greetingTimeout: 10000 });
  let mailing = false;
  const deliverMail = async () => {
    if (mailing || !mailer) return;
    mailing = true;
    try {
      for (const mail of store.pendingMail()) {
        try {
          // Einzelner Prozess: keine parallelen Mail-Worker auf dieselbe SQLite-Datei.
          await mailer.sendMail({ from: process.env.MAIL_FROM, replyTo: process.env.MAIL_REPLY_TO || process.env.MAIL_FROM, to: mail.recipient, subject: mail.subject, text: mail.body,
            messageId: `<${mail.id}@${new URL(publicUrl).hostname}>`, disableFileAccess: true, disableUrlAccess: true });
          store.sent(mail.id, mail.reservation_id);
        } catch { store.mailFailed(mail.id); console.error('Eine Reservierungs-E-Mail konnte nicht versendet werden; erneuter Versuch in fünf Minuten.'); }
      }
    } finally { mailing = false; }
  };
  const buckets = new Map();
  const rateLimit = (req, scope, maximum) => {
    const ip = process.env.TRUST_PROXY === 'true' ? String(req.headers['x-forwarded-for'] || req.socket.remoteAddress).split(',')[0].trim() : req.socket.remoteAddress;
    const key = `${scope}:${ip}`;
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || bucket.until < now) { bucket = { n: 0, until: now + 15 * 60_000 }; buckets.set(key, bucket); }
    if (++bucket.n > maximum) throw new Problem(429, 'Zu viele Anfragen. Bitte in einigen Minuten erneut versuchen.');
  };
  const cleanup = setInterval(() => { for (const [key, b] of buckets) if (b.until < Date.now()) buckets.delete(key); }, 60_000);
  const mailTimer = setInterval(() => void deliverMail(), 15_000);
  cleanup.unref(); mailTimer.unref();
  const json = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
  const body = async req => {
    if (!String(req.headers['content-type']).startsWith('application/json')) throw new Problem(415, 'JSON erwartet.');
    let size = 0; const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 20_000) throw new Problem(413, 'Anfrage zu groß.');
      chunks.push(chunk);
    }
    let data;
    try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new Problem(400, 'Ungültige Anfrage.'); }
    if (!data || Array.isArray(data) || typeof data !== 'object') throw new Problem(400, 'Ungültige Anfrage.');
    return data;
  };
  const verifyOrigin = req => {
    if (req.headers.origin !== origin) throw new Problem(403, 'Anfrage stammt nicht von der Buchungsseite.');
  };
  const admin = (req, res) => {
    rateLimit(req, 'admin', 300);
    const credentials = Buffer.from(String(req.headers.authorization || '').replace(/^Basic /, ''), 'base64').toString();
    if (!credentials.startsWith('kino:') || !equal(credentials.slice(5), adminToken)) {
      res.setHeader('WWW-Authenticate', 'Basic realm="Dorfkino Verwaltung", charset="UTF-8"');
      throw new Problem(401, 'Anmeldung erforderlich. Benutzer: kino.');
    }
  };
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (!demo) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    try {
      const url = new URL(req.url, origin);
      if (url.pathname === '/health' && req.method === 'GET') return json(res, 200, { ok: true });
      if (url.pathname === '/api/config' && req.method === 'GET') return json(res, 200, { demo, privacyUrl, imprintUrl, capacity: 16 });
      if (url.pathname.startsWith('/admin') || url.pathname.startsWith('/api/admin/')) admin(req, res);
      if (url.pathname === '/api/events' && req.method === 'GET') return json(res, 200, { events: store.list(url.searchParams.get('film')) });
      if (url.pathname === '/api/reservations' && req.method === 'POST') {
        verifyOrigin(req); rateLimit(req, 'reserve', 30);
        const result = store.reserve(await body(req));
        json(res, 201, result); void deliverMail(); return;
      }
      if (url.pathname === '/api/cancellation' && req.method === 'POST') {
        verifyOrigin(req); rateLimit(req, 'cancel', 60);
        return json(res, 200, store.cancellationInfo((await body(req)).token));
      }
      if (url.pathname === '/api/cancel' && req.method === 'POST') {
        verifyOrigin(req); rateLimit(req, 'cancel', 60);
        const result = store.cancel((await body(req)).token); json(res, 200, result); void deliverMail(); return;
      }
      if (url.pathname === '/api/sync' && req.method === 'POST') {
        rateLimit(req, 'sync', 200);
        if (!equal(req.headers.authorization, `Bearer ${syncToken}`)) throw new Problem(401, 'Import nicht autorisiert.');
        return json(res, 200, store.sync(await body(req)));
      }
      if (url.pathname === '/api/admin/events' && req.method === 'GET') return json(res, 200, { events: store.adminList() });
      if (url.pathname === '/api/admin/cancel' && req.method === 'POST') {
        verifyOrigin(req);
        const input = await body(req);
        if (typeof input.id !== 'string' || !input.id) throw new Problem(400, 'Reservierungsnummer fehlt.');
        const result = store.cancel(null, input.id); json(res, 200, result); void deliverMail(); return;
      }
      const files = { '/': ['index.html', 'text/html'], '/stornieren': ['index.html', 'text/html'], '/admin': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'],
        '/assets/dorfkino-logo.png': ['assets/dorfkino-logo.png', 'image/png'],
        '/assets/roboto-slab-400.ttf': ['assets/roboto-slab-400.ttf', 'font/ttf'],
        '/assets/roboto-slab-500.ttf': ['assets/roboto-slab-500.ttf', 'font/ttf'] };
      if (files[url.pathname] && ['GET', 'HEAD'].includes(req.method)) {
        const [file, type] = files[url.pathname];
        const content = await readFile(new URL(`./public/${file}`, import.meta.url));
        res.writeHead(200, { 'Content-Type': type.startsWith('text/') ? `${type}; charset=utf-8` : type }); res.end(req.method === 'HEAD' ? undefined : content); return;
      }
      throw new Problem(404, 'Nicht gefunden.');
    } catch (error) {
      if (!res.headersSent) json(res, error.status || 500, { error: error.status ? error.message : 'Das hat gerade nicht geklappt. Bitte erneut versuchen.' });
      else res.end();
      if (!error.status) console.error('Interner Fehler:', error.code || error.name);
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.listen(port, host, () => console.log(`Dorfkino ${demo ? 'DEMO' : 'Reservierung'}: ${publicUrl}`));
  const close = async () => {
    clearInterval(mailTimer); clearInterval(cleanup);
    await new Promise(resolve => server.close(resolve));
    while (mailing) await new Promise(resolve => setTimeout(resolve, 100));
    mailer?.close(); store.close();
  };
  return { server, store, close };
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const app = startServer();
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => void app.close().then(() => process.exit(0)));
}
