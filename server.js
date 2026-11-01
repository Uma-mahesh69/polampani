require('./src/runtime');
const path = require('path');
const fs = require('fs');
const express = require('express');
const compression = require('compression');
const config = require('./src/config');
const { kvGet } = require('./src/db');
const { todayStr } = require('./src/catalog');
const jobs = require('./src/jobs');
const api = require('./src/api');
const { seedIfEmpty } = require('./src/seed');

if (process.env.SEED !== 'false') {
  const seeded = seedIfEmpty();
  if (seeded) console.log(`🌱 Seeded demo data: ${seeded.farmers} farmers, ${seeded.workers} workers, ${seeded.jobs} jobs`);
  const seededOn = kvGet('seeded_on');
  if (!seeded && seededOn && seededOn < todayStr()) {
    console.log(`ℹ️  Demo data was created on ${seededOn}, so "today's" jobs are in the past. Stop the server and run \`npm run reset\` for fresh dates.`);
  }
}

const app = express();
app.disable('x-powered-by');
// Behind a hosting proxy (Render, Railway, nginx) set TRUST_PROXY so rate limits see real client IPs.
const trust = process.env.TRUST_PROXY;
app.set('trust proxy', trust == null || trust === '' ? 'loopback' : /^\d+$/.test(trust) ? Number(trust) : trust === 'true' ? true : trust);

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'geolocation=(self), microphone=(self), camera=()');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; "
    + "img-src 'self' data: https://*.tile.openstreetmap.org; connect-src 'self'; manifest-src 'self'; "
    + "worker-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  );
  next();
});

// gzip everything except the live event stream (SSE must not be buffered).
app.use(compression({ filter: (req, res) => !req.path.startsWith('/api/stream') && compression.filter(req, res) }));
app.use(express.json({ limit: '64kb' }));

app.get('/healthz', (_req, res) => res.json({ ok: true, uptime: Math.round(process.uptime()) }));
app.use('/api', api);

// Self-hosted vendor assets: the app works on a rural connection or fully offline (except map tiles).
// One stylesheet for all self-hosted font faces (instead of six requests).
const FONT_CSS = [
  ['hind-guntur', ['400', '500', '600', '700'], '@fontsource/hind-guntur'],
  ['big-shoulders', ['700', '800'], '@fontsource/big-shoulders-display'],
].map(([mount, weights, pkg]) => weights.map((w) => fs.readFileSync(path.join(__dirname, 'node_modules', pkg, `${w}.css`), 'utf8')
  .replace(/url\(\.\/files\//g, `url(/vendor/fonts/${mount}/files/`)).join('\n')).join('\n');
app.get('/vendor/fonts.css', (_req, res) => {
  res.type('text/css').set('Cache-Control', 'public, max-age=86400').send(FONT_CSS);
});
const vendor = (pkgPath) => express.static(path.join(__dirname, 'node_modules', pkgPath), { maxAge: '30d', immutable: true });
app.use('/vendor/leaflet', vendor('leaflet/dist'));
app.use('/vendor/fonts/hind-guntur', vendor('@fontsource/hind-guntur'));
app.use('/vendor/fonts/big-shoulders', vendor('@fontsource/big-shoulders-display'));

app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, file) => {
    if (file.endsWith('sw.js') || file.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
  },
}));
// Client-side routes fall back to the app shell.
app.get(/^\/(?!api\/|vendor\/).*/, (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// Central error handler: JSON for the API, plain text otherwise.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
  if (status >= 500) console.error(err);
  const message = status >= 500 ? 'Something went wrong on our side. Please try again.' : err.message;
  if (req.path.startsWith('/api')) res.status(status).json({ error: message });
  else res.status(status).send(message);
});

function start(port = config.PORT) {
  const escalator = setInterval(() => {
    try {
      const n = jobs.autoEscalate(config.ESCALATE_AFTER_MIN);
      if (n) console.log(`📣 Auto-escalated ${n} unfilled job(s)`);
    } catch (e) { console.error('auto-escalate failed', e); }
  }, 60_000);
  escalator.unref();

  const server = app.listen(port, () => {
    console.log(`🌾 PolamPani running at http://localhost:${port}${config.DEMO_MODE ? ' (demo mode)' : ''}`);
  });
  const shutdown = (signal) => {
    console.log(`${signal} received, shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  return server;
}

if (require.main === module) start();

module.exports = { app, start };
