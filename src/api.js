const express = require('express');
const { all, get, run, hydrateUser } = require('./db');
const config = require('./config');
const {
  WORK_TYPES, WORK_TYPE_MAP, FACILITIES, VILLAGES, VILLAGE_MAP, todayStr, nearestVillage,
} = require('./catalog');
const auth = require('./auth');
const matcher = require('./matcher');
const insights = require('./insights');
const jobs = require('./jobs');
const notifier = require('./notifier');
const { parseJobText } = require('./nlp');
const { HttpError } = require('./errors');

const router = express.Router();

// ---------- helpers ----------
const h = (fn) => async (req, res, next) => {
  try {
    const data = await fn(req, res);
    if (data !== undefined && !res.headersSent) res.json(data);
  } catch (err) {
    next(err);
  }
};

function rateLimit({ windowMs, max, key = (req) => req.ip }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  }, windowMs).unref();
  return (req, _res, next) => {
    const k = key(req);
    const now = Date.now();
    const entry = hits.get(k) || { count: 0, reset: now + windowMs };
    if (entry.reset < now) { entry.count = 0; entry.reset = now + windowMs; }
    entry.count += 1;
    hits.set(k, entry);
    if (entry.count > max) return next(new HttpError(429, 'Too many requests. Please wait a moment and try again.'));
    return next();
  };
}

const num = (v) => (v === '' || v == null ? NaN : Number(v));
const cleanSkills = (s) => (Array.isArray(s) ? [...new Set(s.filter((x) => WORK_TYPE_MAP[x]))] : null);
const cleanDays = (d) => (Array.isArray(d) ? [...new Set(d.map(Number).filter((x) => Number.isInteger(x) && x >= 0 && x <= 6))] : null);
const cleanUpi = (u) => {
  const s = String(u || '').trim();
  if (!s) return null;
  if (!/^[\w.-]{2,64}@[a-zA-Z]{2,32}$/.test(s)) throw new HttpError(400, 'UPI ID should look like name@bank');
  return s;
};

function locationFrom(body, fallback) {
  const lat = num(body.lat);
  const lng = num(body.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
    return { lat, lng, village: VILLAGE_MAP[body.village]?.name || nearestVillage(lat, lng).name };
  }
  const v = VILLAGE_MAP[body.village];
  if (v) return { lat: v.lat, lng: v.lng, village: v.name };
  return fallback;
}

router.use(auth.authenticate);
router.use(rateLimit({ windowMs: 60_000, max: 400 }));

// ---------- meta ----------
router.get('/meta', h(() => ({
  work_types: WORK_TYPES,
  facilities: FACILITIES,
  villages: VILLAGES.map(({ aliases, ...v }) => v),
  demo_mode: config.DEMO_MODE,
  today: todayStr(),
  repo_url: config.REPO_URL,
  llm: !!config.LLM_BASE_URL,
})));

router.get('/stats', h(() => ({
  open_jobs: get("SELECT COUNT(*) AS c FROM jobs WHERE status = 'open' AND end_date >= ?", todayStr()).c,
  workers_ready: get("SELECT COUNT(*) AS c FROM users WHERE role = 'worker' AND available = 1").c,
  villages: get("SELECT COUNT(DISTINCT village) AS c FROM users").c,
})));

router.get('/impact', h(() => ({ ...insights.impact(), model: matcher.modelInfo() })));

// ---------- auth ----------
const otpLimiter = rateLimit({ windowMs: 10 * 60_000, max: 20 });

router.post('/auth/otp', otpLimiter, h((req) => {
  const { phone, code } = auth.requestOtp(req.body?.phone);
  const text = `${code} is your PolamPani login code. It expires in ${config.OTP_TTL_MIN} minutes. Do not share it.`;
  notifier.sendSms(phone, text);
  return { sent: true, phone, ...(config.DEMO_MODE ? { dev_code: code } : {}) };
}));

router.post('/auth/verify', otpLimiter, h((req) => auth.verifyOtp(req.body?.phone, req.body?.code)));

router.post('/auth/signup', h((req) => {
  const claim = auth.verify(req.body?.signup_token);
  if (!claim?.signup || !claim.phone) throw new HttpError(401, 'Your verification expired. Log in again with your phone number.');
  if (get('SELECT id FROM users WHERE phone = ?', claim.phone)) throw new HttpError(409, 'An account with this number already exists. Log in instead.');
  const b = req.body || {};
  if (!['farmer', 'worker'].includes(b.role)) throw new HttpError(400, 'Choose whether you are a farmer or a worker');
  const name = String(b.name || '').trim().replace(/\s+/g, ' ').slice(0, 60);
  if (name.length < 2) throw new HttpError(400, 'Enter your name');
  const loc = locationFrom(b, null);
  if (!loc) throw new HttpError(400, 'Choose your village or share your location');
  const skills = cleanSkills(b.skills) || [];
  if (b.role === 'worker' && !skills.length) throw new HttpError(400, 'Choose at least one type of work you can do');
  const id = Number(run(
    `INSERT INTO users (role, name, phone, village, lat, lng, skills, available_days, daily_wage, radius_km, lang, upi_id, verified)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    b.role, name, claim.phone, loc.village, loc.lat, loc.lng, JSON.stringify(skills),
    JSON.stringify(cleanDays(b.available_days)?.length ? cleanDays(b.available_days) : [0, 1, 2, 3, 4, 5, 6]),
    Math.min(5000, Math.max(100, Number(b.daily_wage) || 500)), Math.min(100, Math.max(2, Number(b.radius_km) || 20)),
    b.lang === 'en' ? 'en' : 'te', cleanUpi(b.upi_id),
  ).lastInsertRowid);
  notifier.broadcast({ event: 'refresh', scope: 'stats' });
  return { token: auth.sign({ uid: id }), user: hydrateUser(get('SELECT * FROM users WHERE id = ?', id)) };
}));

router.get('/auth/demo-accounts', h(() => {
  if (!config.DEMO_MODE) throw new HttpError(404, 'Demo accounts are disabled');
  const farmers = all("SELECT id, name, village FROM users WHERE role = 'farmer' ORDER BY id LIMIT 6");
  const workers = all(
    `SELECT u.id, u.name, u.village, u.skills, COUNT(n.id) AS alerts FROM users u
     LEFT JOIN notifications n ON n.user_id = u.id AND n.type IN ('job_match','invite') AND n.responded IS NULL
     WHERE u.role = 'worker' AND u.available = 1 GROUP BY u.id ORDER BY alerts DESC, u.id LIMIT 6`,
  ).map((w) => ({ ...w, skills: JSON.parse(w.skills) }));
  return { farmers, workers };
}));

router.post('/auth/demo', h((req) => {
  if (!config.DEMO_MODE) throw new HttpError(404, 'Demo accounts are disabled');
  const u = hydrateUser(get('SELECT * FROM users WHERE id = ?', Number(req.body?.user_id)));
  if (!u) throw new HttpError(404, 'Demo account not found');
  return { token: auth.sign({ uid: u.id }), user: u };
}));

// ---------- me ----------
router.get('/me', auth.requireUser, h((req) => req.user));

router.patch('/me', auth.requireUser, h((req) => {
  const b = req.body || {};
  const u = req.user;
  const sets = [];
  const vals = [];
  const set = (col, val) => { sets.push(`${col} = ?`); vals.push(val); };
  if (b.name != null) {
    const name = String(b.name).trim().replace(/\s+/g, ' ').slice(0, 60);
    if (name.length < 2) throw new HttpError(400, 'Enter your name');
    set('name', name);
  }
  if (b.village != null || b.lat != null) {
    const loc = locationFrom(b, null);
    if (!loc) throw new HttpError(400, 'Choose your village or share your location');
    set('village', loc.village); set('lat', loc.lat); set('lng', loc.lng);
  }
  if (b.lang != null) set('lang', b.lang === 'en' ? 'en' : 'te');
  if (b.upi_id !== undefined) set('upi_id', cleanUpi(b.upi_id));
  if (b.about != null) set('about', String(b.about).slice(0, 300));
  if (u.role === 'worker') {
    if (b.available != null) set('available', b.available ? 1 : 0);
    if (b.available_days != null) {
      const d = cleanDays(b.available_days);
      if (!d?.length) throw new HttpError(400, 'Choose at least one day you can work');
      set('available_days', JSON.stringify(d.sort()));
    }
    if (b.skills != null) {
      const s = cleanSkills(b.skills);
      if (!s?.length) throw new HttpError(400, 'Choose at least one type of work you can do');
      set('skills', JSON.stringify(s));
    }
    if (b.daily_wage != null) set('daily_wage', Math.min(5000, Math.max(100, Math.round(Number(b.daily_wage)) || 500)));
    if (b.radius_km != null) set('radius_km', Math.min(100, Math.max(2, Number(b.radius_km) || 20)));
  }
  if (sets.length) run(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, ...vals, u.id);
  notifier.broadcast({ event: 'refresh', scope: 'stats' });
  return hydrateUser(get('SELECT * FROM users WHERE id = ?', u.id));
}));

// ---------- AI ----------
router.post('/ai/parse', rateLimit({ windowMs: 60_000, max: 60 }), h(async (req) => {
  const text = String(req.body?.text || '').slice(0, 600);
  if (!text.trim()) throw new HttpError(400, 'Describe the work first');
  return parseJobText(text);
}));

router.get('/ai/insight', h((req) => {
  const { work_type, date, duration_days, workers_needed } = req.query;
  const lat = num(req.query.lat);
  const lng = num(req.query.lng);
  if (!WORK_TYPE_MAP[work_type] || !Number.isFinite(lat) || !Number.isFinite(lng)) throw new HttpError(400, 'work_type, lat and lng are required');
  return insights.wageInsight({ work_type, lat, lng, date, duration_days, workers_needed });
}));

router.get('/ai/model', h(() => matcher.modelInfo()));

router.get('/ai/season', h((req) => {
  const lat = Number.isFinite(num(req.query.lat)) ? num(req.query.lat) : req.user?.lat ?? 17.75;
  const lng = Number.isFinite(num(req.query.lng)) ? num(req.query.lng) : req.user?.lng ?? 83.1;
  return insights.seasonOutlook({ lat, lng, skills: req.user?.role === 'worker' ? req.user.skills : null });
}));

router.get('/weather', h(async (req) => {
  const lat = num(req.query.lat);
  const lng = num(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new HttpError(400, 'lat and lng are required');
  const start = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : todayStr();
  const end = /^\d{4}-\d{2}-\d{2}$/.test(req.query.end || '') ? req.query.end : start;
  return (await insights.weatherFor(lat, lng, start, end)) || { available: false, offline: true };
}));

// ---------- farmer ----------
const farmerOnly = auth.requireRole('farmer');
const workerOnly = auth.requireRole('worker');

router.get('/farmer/summary', farmerOnly, h((req) => jobs.farmerSummary(req.user.id)));
router.post('/jobs/preview', farmerOnly, h((req) => jobs.preview(req.user, req.body || {})));
router.post('/jobs', farmerOnly, rateLimit({ windowMs: 60_000, max: 20 }), h((req) => jobs.createJob(req.user, req.body || {})));
router.get('/jobs/mine', farmerOnly, h((req) => jobs.listFarmerJobs(req.user.id, req.query.status)));
router.get('/jobs/:id/matches', farmerOnly, h((req) => jobs.matches(req.params.id, req.user)));
router.post('/jobs/:id/dispatch', farmerOnly, h((req) => {
  const job = jobs.mustGetJob(req.params.id);
  if (job.farmer_id !== req.user.id) throw new HttpError(403, 'Only the farmer who posted this job can do that');
  if (job.status !== 'open') throw new HttpError(409, 'This job is not open');
  const batch = jobs.dispatch(job.id, { manual: true });
  notifier.broadcast({ event: 'refresh', scope: 'jobs' });
  return { notified: batch.length, job: jobs.getJob(job.id) };
}));
router.post('/jobs/:id/invite', farmerOnly, h((req) => jobs.invite(req.params.id, req.user, req.body?.worker_id)));
router.post('/jobs/:id/cancel', farmerOnly, h((req) => jobs.cancel(req.params.id, req.user, req.body?.reason)));
router.post('/jobs/:id/complete', farmerOnly, h((req) => jobs.complete(req.params.id, req.user, req.body?.attendance || {})));
router.post('/assignments/:id/review', farmerOnly, h((req) => jobs.rateWorker(req.params.id, req.user, req.body?.rating, req.body?.review)));
router.post('/assignments/:id/paid', farmerOnly, h((req) => jobs.markPaid(req.params.id, req.user, req.body?.method)));
router.get('/workers/:id', farmerOnly, h((req) => jobs.workerProfile(req.params.id)));
router.get('/workers-map', farmerOnly, h(() => all("SELECT id, lat, lng, available, skills FROM users WHERE role = 'worker'")
  .map((w) => ({ ...w, skills: JSON.parse(w.skills), available: !!w.available }))));

// ---------- worker ----------
router.get('/feed', workerOnly, h((req) => matcher.rankJobsForWorker(req.user, req.query)));
router.get('/work', workerOnly, h((req) => jobs.workerWork(req.user.id)));
router.post('/jobs/:id/accept', workerOnly, h((req) => { jobs.accept(Number(req.params.id), req.user.id); return jobs.view(req.params.id, req.user); }));
router.post('/jobs/:id/decline', workerOnly, h((req) => jobs.decline(Number(req.params.id), req.user.id)));
router.post('/jobs/:id/withdraw', workerOnly, h((req) => { jobs.withdraw(Number(req.params.id), req.user.id); return jobs.view(req.params.id, req.user); }));
router.post('/jobs/:id/checkin', workerOnly, h((req) => { jobs.checkin(Number(req.params.id), req.user.id); return jobs.view(req.params.id, req.user); }));
router.post('/assignments/:id/rate-farmer', workerOnly, h((req) => jobs.rateFarmer(req.params.id, req.user, req.body?.rating)));

// ---------- shared ----------
router.get('/jobs/:id', h((req) => jobs.view(req.params.id, req.user)));

router.get('/notifications', auth.requireUser, h((req) => all(
  `SELECT n.id, n.job_id, n.type, n.data, n.message, n.score, n.responded, n.read, n.created_at, j.status AS job_status
   FROM notifications n LEFT JOIN jobs j ON j.id = n.job_id
   WHERE n.user_id = ? AND n.message <> '' ORDER BY n.id DESC LIMIT 60`,
  req.user.id,
).map((n) => ({ ...n, data: JSON.parse(n.data || '{}'), read: !!n.read }))));

router.post('/notifications/read', auth.requireUser, h((req) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : null;
  if (ids?.length) run(`UPDATE notifications SET read = 1 WHERE user_id = ? AND id IN (${ids.map(() => '?').join(',')})`, req.user.id, ...ids);
  else run('UPDATE notifications SET read = 1 WHERE user_id = ?', req.user.id);
  return { ok: true };
}));

router.get('/stream', (req, res, next) => {
  if (!req.user) return next(new HttpError(401, 'Please log in to continue'));
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  const unsubscribe = notifier.subscribe(req.user.id, res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { clearInterval(ping); unsubscribe(); });
  return undefined;
});

router.use((req, _res, next) => next(new HttpError(404, `No API route for ${req.method} ${req.path}`)));

module.exports = router;
