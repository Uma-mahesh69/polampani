const path = require('path');
const express = require('express');
const { all, get, run, hydrateUser } = require('./src/db');
const { WORK_TYPES, WORK_TYPE_MAP, VILLAGES, todayStr } = require('./src/catalog');
const matcher = require('./src/matcher');
const jobs = require('./src/jobs');
const notifier = require('./src/notifier');
const { parseJobText } = require('./src/nlp');
const { seedIfEmpty } = require('./src/seed');

const seeded = seedIfEmpty();
if (seeded) console.log(`🌱 Seeded demo data: ${seeded.farmers} farmers, ${seeded.workers} workers, ${seeded.jobs} jobs`);

const app = express();
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const { httpError } = jobs;
const h = (fn) => async (req, res) => {
  try {
    const data = await fn(req, res);
    if (data !== undefined) res.json(data);
  } catch (err) {
    if (!err.status) console.error(err);
    res.status(err.status || 500).json({ error: err.message || 'Something went wrong' });
  }
};

function stats() {
  return {
    open_jobs: get("SELECT COUNT(*) AS c FROM jobs WHERE status = 'open' AND date >= ?", todayStr()).c,
    workers_available: get("SELECT COUNT(*) AS c FROM users WHERE role = 'worker' AND available = 1").c,
    farmers: get("SELECT COUNT(*) AS c FROM users WHERE role = 'farmer'").c,
    positions_filled: get("SELECT COUNT(*) AS c FROM assignments WHERE status IN ('accepted', 'completed')").c,
    alerts_sent: get("SELECT COUNT(*) AS c FROM notifications WHERE type = 'job_match'").c,
    model_samples: matcher.loadModel().samples,
  };
}

function getUser(id) {
  const u = hydrateUser(get('SELECT * FROM users WHERE id = ?', Number(id)));
  if (!u) throw httpError('User not found', 404);
  return u;
}

const cleanSkills = (s) => (Array.isArray(s) ? s.filter((x) => WORK_TYPE_MAP[x]) : []);
const cleanDays = (d) => (Array.isArray(d) ? [...new Set(d.map(Number).filter((x) => x >= 0 && x <= 6))] : null);

// ---------- meta ----------
app.get('/api/meta', h(() => ({ work_types: WORK_TYPES, villages: VILLAGES, stats: stats(), model: matcher.modelInfo(), today: todayStr() })));
app.get('/api/stats', h(() => stats()));

// ---------- users ----------
app.get('/api/users', h((req) => {
  const role = req.query.role;
  const rows = role ? all('SELECT * FROM users WHERE role = ? ORDER BY name', role) : all('SELECT * FROM users ORDER BY name');
  return rows.map(hydrateUser);
}));

app.get('/api/users/:id', h((req) => getUser(req.params.id)));

app.post('/api/users', h((req) => {
  const b = req.body || {};
  if (!['farmer', 'worker'].includes(b.role)) throw httpError('Role must be farmer or worker');
  const name = String(b.name || '').trim().slice(0, 60);
  if (!name) throw httpError('Name is required');
  let lat = Number(b.lat);
  let lng = Number(b.lng);
  const v = VILLAGES.find((x) => x.name === b.village);
  if (b.lat == null || b.lat === '' || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    if (!v) throw httpError('Choose a village or share your location');
    lat = v.lat;
    lng = v.lng;
  }
  const id = Number(run(
    `INSERT INTO users (role, name, phone, village, lat, lng, skills, available_days, daily_wage, radius_km, lang)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    b.role, name, String(b.phone || '').slice(0, 20), v ? v.name : String(b.village || ''), lat, lng,
    JSON.stringify(cleanSkills(b.skills)), JSON.stringify(cleanDays(b.available_days) || [0, 1, 2, 3, 4, 5, 6]),
    Math.min(5000, Math.max(100, Number(b.daily_wage) || 500)), Math.min(100, Math.max(2, Number(b.radius_km) || 20)),
    b.lang === 'en' ? 'en' : 'te',
  ).lastInsertRowid);
  notifier.broadcast({ event: 'refresh' });
  return getUser(id);
}));

app.patch('/api/users/:id', h((req) => {
  const u = getUser(req.params.id);
  const b = req.body || {};
  const sets = [];
  const vals = [];
  if (b.available != null) { sets.push('available = ?'); vals.push(b.available ? 1 : 0); }
  if (b.available_days) { sets.push('available_days = ?'); vals.push(JSON.stringify(cleanDays(b.available_days) || [])); }
  if (b.skills) { sets.push('skills = ?'); vals.push(JSON.stringify(cleanSkills(b.skills))); }
  if (b.daily_wage != null) { sets.push('daily_wage = ?'); vals.push(Math.min(5000, Math.max(100, Number(b.daily_wage) || 500))); }
  if (b.radius_km != null) { sets.push('radius_km = ?'); vals.push(Math.min(100, Math.max(2, Number(b.radius_km) || 20))); }
  if (sets.length) run(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, ...vals, u.id);
  notifier.broadcast({ event: 'refresh' });
  return getUser(u.id);
}));

app.get('/api/workers/map', h(() => all("SELECT id, name, village, lat, lng, skills, available FROM users WHERE role = 'worker'")
  .map((w) => ({ ...w, skills: JSON.parse(w.skills), available: !!w.available }))));

app.get('/api/workers/:id/feed', h((req) => matcher.rankJobsForWorker(getUser(req.params.id))));
app.get('/api/workers/:id/assignments', h((req) => jobs.workerAssignments(req.params.id)));

// ---------- AI ----------
app.post('/api/ai/parse', h(async (req) => {
  const text = String(req.body?.text || '').slice(0, 1000);
  if (!text.trim()) throw httpError('Describe the work first');
  return parseJobText(text);
}));

app.get('/api/ai/insight', h((req) => {
  const { work_type, date, workers_needed } = req.query;
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (!WORK_TYPE_MAP[work_type] || !Number.isFinite(lat) || !Number.isFinite(lng)) throw httpError('work_type, lat and lng are required');
  return matcher.wageInsight({ work_type, lat, lng, date, workers_needed });
}));

app.get('/api/ai/model', h(() => matcher.modelInfo()));

// ---------- jobs ----------
app.get('/api/jobs', h((req) => jobs.listJobs({ farmer_id: req.query.farmer_id })));
app.post('/api/jobs', h((req) => jobs.createJob(req.body || {})));
app.get('/api/jobs/:id', h((req) => jobs.getJob(req.params.id) || Promise.reject(httpError('Job not found', 404))));
app.get('/api/jobs/:id/matches', h((req) => jobs.matches(req.params.id)));
app.post('/api/jobs/:id/dispatch', h((req) => {
  const batch = jobs.dispatch(Number(req.params.id), { manual: true });
  notifier.broadcast({ event: 'refresh' });
  return { notified: batch.length };
}));
app.post('/api/jobs/:id/accept', h((req) => jobs.accept(Number(req.params.id), req.body?.worker_id)));
app.post('/api/jobs/:id/decline', h((req) => jobs.decline(Number(req.params.id), req.body?.worker_id)));
app.post('/api/jobs/:id/withdraw', h((req) => jobs.withdraw(Number(req.params.id), req.body?.worker_id)));
app.post('/api/jobs/:id/complete', h((req) => jobs.complete(Number(req.params.id), req.body?.farmer_id)));

// ---------- notifications ----------
app.get('/api/notifications', h((req) => all(
  `SELECT n.id, n.user_id, n.job_id, n.type, n.message, n.score, n.responded, n.read, n.created_at, j.status AS job_status
   FROM notifications n LEFT JOIN jobs j ON j.id = n.job_id
   WHERE n.user_id = ? ORDER BY n.id DESC LIMIT 40`,
  Number(req.query.user_id),
)));

app.post('/api/notifications/read', h((req) => {
  run('UPDATE notifications SET read = 1 WHERE user_id = ?', Number(req.body?.user_id));
  return { ok: true };
}));

app.get('/api/stream', (req, res) => {
  const userId = Number(req.query.user_id);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  const unsubscribe = notifier.subscribe(userId, res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { clearInterval(ping); unsubscribe(); });
});

// ---------- background auto-escalation ----------
const ESCALATE_AFTER_MIN = Number(process.env.ESCALATE_AFTER_MIN || 10);
setInterval(() => {
  try {
    const n = jobs.autoEscalate(ESCALATE_AFTER_MIN);
    if (n) console.log(`📣 Auto-escalated ${n} unfilled job(s)`);
  } catch (e) { console.error('auto-escalate failed', e); }
}, 60_000).unref();

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => console.log(`🌾 PolamPani running at http://localhost:${PORT}`));
