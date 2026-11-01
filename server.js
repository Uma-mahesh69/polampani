const path = require('path');
const express = require('express');
const config = require('./src/config');
require('./src/db');
const jobs = require('./src/jobs');
const api = require('./src/api');
const { seedIfEmpty } = require('./src/seed');

if (process.env.SEED !== 'false') {
  const seeded = seedIfEmpty();
  if (seeded) console.log(`🌱 Seeded demo data: ${seeded.farmers} farmers, ${seeded.workers} workers, ${seeded.jobs} jobs`);
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback');

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

app.use(express.json({ limit: '64kb' }));

app.get('/healthz', (_req, res) => res.json({ ok: true, uptime: Math.round(process.uptime()) }));
app.use('/api', api);

// Self-hosted vendor assets: the app works on a rural connection or fully offline (except map tiles).
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
