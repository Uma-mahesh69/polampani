// AI matching engine.
//
// For every (worker, job) pair we compute seven interpretable features. An online
// logistic-regression model turns them into the probability that the worker accepts and
// shows up. It starts from expert priors and takes one SGD step on every accept, decline
// and no-show, so the ranking adapts to how people in this area actually behave.
// Each score ships with structured reasons so the UI can explain *why* in Telugu or English.

const { all, get, hydrateUser, parseJSON, kvGet, kvSet } = require('./db');
const {
  WORK_TYPE_MAP, skillMatch, haversineKm, weekdayOf, todayStr, round1, datesBetween,
} = require('./catalog');

const FEATURES = ['proximity', 'skill', 'availability', 'wage', 'reliability', 'experience', 'rapport'];
const PRIOR = {
  weights: { proximity: 2.8, skill: 2.4, availability: 2.0, wage: 1.6, reliability: 1.0, experience: 0.6, rapport: 0.8 },
  bias: -7.0,
};
const LEARNING_RATE = 0.2;
const RECENT_WINDOW = 100;

const clone = (o) => JSON.parse(JSON.stringify(o));
const sigmoid = (z) => 1 / (1 + Math.exp(-z));

let cached = null;
function loadModel() {
  if (cached) return cached;
  const raw = kvGet('model');
  const m = raw ? JSON.parse(raw) : null;
  cached = m && m.version === 2 ? m : { version: 2, ...clone(PRIOR), samples: 0, correct: 0, positives: 0, recent: [] };
  return cached;
}
function saveModel(m) {
  cached = m;
  kvSet('model', JSON.stringify(m));
}
function resetModel() {
  cached = null;
  kvSet('model', JSON.stringify({ version: 2, ...clone(PRIOR), samples: 0, correct: 0, positives: 0, recent: [] }));
  cached = null;
}

// history: Map(worker_id -> { count, avg }) of past completed work with this job's farmer.
function features(worker, job, history = null) {
  const distance = haversineKm(worker.lat, worker.lng, job.lat, job.lng);
  const skill = skillMatch(worker.skills, job.work_type);
  const days = datesBetween(job.date, job.end_date || job.date);
  const freeDays = days.filter((d) => (worker.available_days || []).includes(weekdayOf(d))).length;
  const wageRatio = job.wage / Math.max(1, worker.daily_wage);
  const showRate = ((worker.jobs_done || 0) + 2) / ((worker.jobs_done || 0) + (worker.no_shows || 0) + 2);
  const past = history?.get(worker.id);
  const x = {
    proximity: Math.exp(-distance / 10),
    skill: skill.value,
    availability: days.length ? freeDays / days.length : 0,
    wage: wageRatio >= 1 ? 1 : Math.max(0, 1 - (1 - wageRatio) * 3),
    reliability: 0.6 * ((worker.rating || 0) / 5) + 0.4 * showRate,
    experience: Math.min(1, Math.log1p(worker.jobs_done || 0) / Math.log1p(60)),
    rapport: past ? (past.avg >= 4 || past.count >= 2 ? 1 : 0.6) : 0,
  };
  return { x, distance, skill, freeDays, totalDays: days.length, wd: weekdayOf(job.date), past, showRate };
}

function score(x, model = loadModel()) {
  let z = model.bias;
  for (const f of FEATURES) z += model.weights[f] * (x[f] ?? 0);
  return sigmoid(z);
}

// Structured, language-neutral reasons. The client renders them per viewer and language.
function explain(worker, job, f) {
  const r = [];
  r.push({ code: 'distance', ok: f.distance <= worker.radius_km, km: round1(f.distance) });
  if (f.skill.value === 1) r.push({ code: 'skill_exact', ok: true, skill: job.work_type });
  else if (f.skill.value >= 0.5) r.push({ code: 'skill_related', ok: true, skill: f.skill.best });
  else r.push({ code: 'skill_new', ok: false, skill: job.work_type });
  if (f.freeDays === f.totalDays) r.push({ code: 'days_free', ok: true, day: f.wd, days: f.totalDays });
  else if (f.freeDays > 0) r.push({ code: 'days_partial', ok: false, free: f.freeDays, days: f.totalDays });
  else r.push({ code: 'days_busy', ok: false, day: f.wd, days: f.totalDays });
  r.push({ code: job.wage >= worker.daily_wage ? 'wage_ok' : 'wage_low', ok: job.wage >= worker.daily_wage, diff: job.wage - worker.daily_wage, ask: worker.daily_wage });
  r.push({ code: 'reliability', ok: worker.rating >= 4 && f.showRate >= 0.85, rating: round1(worker.rating), jobs: worker.jobs_done, show: Math.round(f.showRate * 100) });
  if (f.past) r.push({ code: 'rapport', ok: true, count: f.past.count });
  return r;
}

const publicWorker = (w) => ({
  id: w.id, name: w.name, village: w.village, lat: w.lat, lng: w.lng, skills: w.skills,
  rating: w.rating, rating_count: w.rating_count, jobs_done: w.jobs_done, no_shows: w.no_shows,
  daily_wage: w.daily_wage, radius_km: w.radius_km, verified: w.verified,
});

function farmerHistory(farmerId) {
  return new Map(all(
    `SELECT a.worker_id, COUNT(*) AS count, AVG(COALESCE(a.farmer_rating, 4)) AS avg
     FROM assignments a JOIN jobs j ON j.id = a.job_id
     WHERE j.farmer_id = ? AND a.status = 'completed' GROUP BY a.worker_id`,
    farmerId,
  ).map((r) => [r.worker_id, { count: r.count, avg: r.avg }]));
}

// Workers already booked on any day that overlaps this job.
function bookedWorkers(job) {
  return new Set(all(
    `SELECT a.worker_id FROM assignments a JOIN jobs j ON j.id = a.job_id
     WHERE a.status = 'accepted' AND j.date <= ? AND j.end_date >= ? AND j.id <> ?`,
    job.end_date || job.date, job.date, job.id ?? -1,
  ).map((r) => r.worker_id));
}

// Rank available workers for a job. radiusMult widens each worker's travel radius
// (escalation rounds use it when a job is not filling up).
function rankWorkersForJob(job, { radiusMult = 1, excludeIds = new Set() } = {}) {
  const workers = all("SELECT * FROM users WHERE role = 'worker' AND available = 1").map(hydrateUser);
  const booked = bookedWorkers(job);
  const history = job.farmer_id ? farmerHistory(job.farmer_id) : null;
  const model = loadModel();
  return workers
    .filter((w) => !excludeIds.has(w.id) && !booked.has(w.id))
    .map((w) => {
      const f = features(w, job, history);
      return {
        worker: publicWorker(w),
        distance: round1(f.distance),
        score: score(f.x, model),
        x: f.x,
        reasons: explain(w, job, f),
        inRange: f.distance <= w.radius_km * radiusMult,
      };
    })
    .filter((c) => c.inRange)
    .sort((a, b) => b.score - a.score);
}

// Personalised, filterable feed of open jobs for a worker.
function rankJobsForWorker(worker, { work_type, max_km, min_wage, sort = 'match' } = {}) {
  const jobs = all(
    `SELECT j.*, u.name AS farmer_name, u.rating AS farmer_rating, u.village AS farmer_village
     FROM jobs j JOIN users u ON u.id = j.farmer_id
     WHERE j.status = 'open' AND j.end_date >= ?`,
    todayStr(),
  );
  const booked = all(
    `SELECT j.id, j.date, j.end_date FROM assignments a JOIN jobs j ON j.id = a.job_id
     WHERE a.worker_id = ? AND a.status = 'accepted'`,
    worker.id,
  );
  const bookedIds = new Set(booked.map((b) => b.id));
  const clashes = (j) => booked.some((b) => b.date <= j.end_date && b.end_date >= j.date);
  const notifs = new Map(all(
    "SELECT job_id, responded, type FROM notifications WHERE user_id = ? AND type IN ('job_match', 'invite')",
    worker.id,
  ).map((n) => [n.job_id, n]));
  const counts = new Map(all(
    "SELECT job_id, COUNT(*) AS c FROM assignments WHERE status = 'accepted' GROUP BY job_id",
  ).map((r) => [r.job_id, r.c]));
  const histories = new Map();
  const model = loadModel();

  let list = jobs
    .filter((j) => !bookedIds.has(j.id) && !clashes(j) && notifs.get(j.id)?.responded !== 'declined')
    .map((j) => {
      if (!histories.has(j.farmer_id)) histories.set(j.farmer_id, farmerHistory(j.farmer_id));
      const f = features(worker, j, histories.get(j.farmer_id));
      const acc = counts.get(j.id) || 0;
      return {
        job: { ...decorateJob(j), accepted_count: acc, spots_left: Math.max(0, j.workers_needed - acc) },
        distance: round1(f.distance),
        score: score(f.x, model),
        reasons: explain(worker, j, f),
        alerted: notifs.has(j.id),
        invited: notifs.get(j.id)?.type === 'invite',
      };
    })
    .filter((r) => r.distance <= Math.max(worker.radius_km * 3, 30));

  if (work_type && WORK_TYPE_MAP[work_type]) list = list.filter((r) => r.job.work_type === work_type);
  if (Number(max_km) > 0) list = list.filter((r) => r.distance <= Number(max_km));
  if (Number(min_wage) > 0) list = list.filter((r) => r.job.wage >= Number(min_wage));
  const sorters = {
    match: (a, b) => b.score - a.score,
    wage: (a, b) => b.job.wage - a.job.wage || b.score - a.score,
    distance: (a, b) => a.distance - b.distance,
    date: (a, b) => a.job.date.localeCompare(b.job.date) || b.score - a.score,
  };
  return list.sort(sorters[sort] || sorters.match);
}

function decorateJob(j) {
  return { ...j, facilities: parseJSON(j.facilities, []), work: WORK_TYPE_MAP[j.work_type] };
}

// Probability that at least `need` of the alerted workers accept (Poisson-binomial).
function fillForecast(probabilities, need) {
  let dp = [1];
  for (const p of probabilities) {
    const next = new Array(dp.length + 1).fill(0);
    for (let k = 0; k < dp.length; k += 1) {
      next[k] += dp[k] * (1 - p);
      next[k + 1] += dp[k] * p;
    }
    dp = next;
  }
  const atLeast = dp.slice(Math.max(0, need)).reduce((s, v) => s + v, 0);
  return {
    expected: Math.round(probabilities.reduce((s, p) => s + p, 0) * 10) / 10,
    probability: Math.max(0, Math.min(1, atLeast)),
  };
}

// One SGD step on the logistic loss. y = 1 (accepted) or 0 (declined / no-show).
function learn(x, y) {
  const m = clone(loadModel());
  const p = score(x, m);
  const hit = (p >= 0.5) === (y === 1) ? 1 : 0;
  m.samples += 1;
  m.correct += hit;
  if (y === 1) m.positives += 1;
  m.recent = [...(m.recent || []), hit].slice(-RECENT_WINDOW);
  const err = y - p;
  for (const f of FEATURES) m.weights[f] = Math.max(0, m.weights[f] + LEARNING_RATE * err * (x[f] ?? 0));
  m.bias += LEARNING_RATE * err;
  saveModel(m);
  return { p, y };
}

function modelInfo() {
  const m = loadModel();
  const total = FEATURES.reduce((s, f) => s + m.weights[f], 0) || 1;
  const priorTotal = FEATURES.reduce((s, f) => s + PRIOR.weights[f], 0);
  const recent = m.recent || [];
  return {
    type: 'Online logistic regression',
    samples: m.samples,
    positives: m.positives,
    accuracy: m.samples ? m.correct / m.samples : null,
    recent_accuracy: recent.length >= 10 ? recent.reduce((s, v) => s + v, 0) / recent.length : null,
    recent_window: recent.length,
    features: FEATURES.map((f) => ({
      key: f,
      weight: +m.weights[f].toFixed(3),
      prior: PRIOR.weights[f],
      importance: m.weights[f] / total,
      prior_importance: PRIOR.weights[f] / priorTotal,
    })),
  };
}

module.exports = {
  FEATURES, PRIOR, loadModel, resetModel, features, score, explain, learn, modelInfo, fillForecast,
  rankWorkersForJob, rankJobsForWorker, publicWorker, farmerHistory, bookedWorkers, decorateJob,
};
