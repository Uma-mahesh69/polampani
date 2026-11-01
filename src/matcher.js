// AI matching engine.
//
// For every (worker, job) pair we compute six interpretable features, then an online
// logistic-regression model turns them into the probability that the worker will accept
// and show up. The model starts from expert priors and is updated with SGD every time a
// worker accepts or declines an alert, so ranking keeps adapting to local behaviour.
// Every score ships with human-readable reasons, so farmers and workers can see *why*.

const { all, get, run, hydrateUser } = require('./db');
const {
  WORK_TYPE_MAP, DAYS, skillMatch, haversineKm, weekdayOf, fmtDate, todayStr, round1,
} = require('./catalog');

const FEATURES = ['proximity', 'skill', 'availability', 'wage', 'reliability', 'experience'];
const LABELS = {
  proximity: 'Distance to field',
  skill: 'Skill match',
  availability: 'Free on that day',
  wage: 'Wage fairness',
  reliability: 'Rating',
  experience: 'Experience',
};
const PRIOR = {
  weights: { proximity: 2.8, skill: 2.4, availability: 2.0, wage: 1.6, reliability: 0.9, experience: 0.6 },
  bias: -6.5,
};
const LEARNING_RATE = 0.25;

const clone = (o) => JSON.parse(JSON.stringify(o));
const sigmoid = (z) => 1 / (1 + Math.exp(-z));

function loadModel() {
  const row = get("SELECT value FROM kv WHERE key = 'model'");
  if (row) return JSON.parse(row.value);
  return { ...clone(PRIOR), samples: 0, correct: 0, positives: 0 };
}

function saveModel(m) {
  run(
    "INSERT INTO kv (key, value) VALUES ('model', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    JSON.stringify(m),
  );
}

function features(worker, job) {
  const distance = haversineKm(worker.lat, worker.lng, job.lat, job.lng);
  const skill = skillMatch(worker.skills, job.work_type);
  const wd = weekdayOf(job.date);
  const availDay = (worker.available_days || []).includes(wd);
  const wageRatio = job.wage / Math.max(1, worker.daily_wage);
  const x = {
    proximity: Math.exp(-distance / 10),
    skill: skill.value,
    availability: availDay ? 1 : 0,
    wage: wageRatio >= 1 ? 1 : Math.max(0, 1 - (1 - wageRatio) * 3),
    reliability: (worker.rating || 0) / 5,
    experience: Math.min(1, Math.log1p(worker.jobs_done || 0) / Math.log1p(60)),
  };
  return { x, distance, skill, availDay, wd };
}

function score(x, model = loadModel()) {
  let z = model.bias;
  for (const f of FEATURES) z += model.weights[f] * x[f];
  return sigmoid(z);
}

function explain(worker, job, f, perspective = 'farmer') {
  const work = WORK_TYPE_MAP[job.work_type];
  const day = DAYS[f.wd];
  const you = perspective === 'worker';
  const reasons = [];
  reasons.push({ ok: f.distance <= worker.radius_km, text: `📍 ${round1(f.distance)} km${you ? ' from you' : ' away'}` });
  if (f.skill.value === 1) {
    reasons.push({ ok: true, text: you ? '🛠️ Matches your skill' : `🛠️ Skilled in ${work.en.toLowerCase()}` });
  } else if (f.skill.value >= 0.5) {
    reasons.push({ ok: true, text: `🛠️ Related skill: ${WORK_TYPE_MAP[f.skill.best].en.toLowerCase()}` });
  } else {
    reasons.push({ ok: false, text: '🛠️ New type of work' });
  }
  reasons.push(f.availDay
    ? { ok: true, text: you ? `📅 ${day} is your free day` : `📅 Usually free on ${day}` }
    : { ok: false, text: you ? `📅 ${day} is not your usual day` : `📅 Not usually free on ${day}` });
  const diff = job.wage - worker.daily_wage;
  if (you) {
    reasons.push({ ok: diff >= 0, text: diff >= 0 ? `💰 ₹${diff} above your ask` : `💰 ₹${-diff} below your ask` });
  } else {
    reasons.push({ ok: diff >= 0, text: `💰 Asks ₹${worker.daily_wage}/day` });
    reasons.push({ ok: worker.rating >= 4, text: `⭐ ${worker.rating.toFixed(1)} · ${worker.jobs_done} jobs done` });
  }
  return reasons;
}

const publicWorker = (w) => ({
  id: w.id, name: w.name, village: w.village, lat: w.lat, lng: w.lng, skills: w.skills,
  rating: w.rating, jobs_done: w.jobs_done, daily_wage: w.daily_wage, radius_km: w.radius_km,
});

// Rank available workers for a job. radiusMult widens each worker's travel radius
// (used by escalation rounds when a job is not filling up).
function rankWorkersForJob(job, { radiusMult = 1, excludeIds = new Set() } = {}) {
  const workers = all("SELECT * FROM users WHERE role = 'worker' AND available = 1").map(hydrateUser);
  const booked = new Set(all(
    `SELECT a.worker_id FROM assignments a JOIN jobs j ON j.id = a.job_id
     WHERE a.status = 'accepted' AND j.date = ? AND j.id <> ?`,
    job.date, job.id ?? -1,
  ).map((r) => r.worker_id));
  const model = loadModel();
  return workers
    .filter((w) => !excludeIds.has(w.id) && !booked.has(w.id))
    .map((w) => {
      const f = features(w, job);
      return {
        worker: publicWorker(w),
        distance: round1(f.distance),
        score: score(f.x, model),
        x: f.x,
        reasons: explain(w, job, f, 'farmer'),
        inRange: f.distance <= w.radius_km * radiusMult,
      };
    })
    .filter((c) => c.inRange)
    .sort((a, b) => b.score - a.score);
}

// Rank open jobs for a worker's personalised feed.
function rankJobsForWorker(worker) {
  const jobs = all(
    `SELECT j.*, u.name AS farmer_name FROM jobs j JOIN users u ON u.id = j.farmer_id
     WHERE j.status = 'open' AND j.date >= ?`,
    todayStr(),
  );
  const booked = all(
    `SELECT j.id, j.date FROM assignments a JOIN jobs j ON j.id = a.job_id
     WHERE a.worker_id = ? AND a.status = 'accepted'`,
    worker.id,
  );
  const bookedIds = new Set(booked.map((b) => b.id));
  const bookedDates = new Set(booked.map((b) => b.date));
  const notifs = new Map(all(
    "SELECT job_id, responded FROM notifications WHERE user_id = ? AND type = 'job_match'",
    worker.id,
  ).map((n) => [n.job_id, n.responded]));
  const model = loadModel();
  return jobs
    .filter((j) => !bookedIds.has(j.id) && !bookedDates.has(j.date) && notifs.get(j.id) !== 'declined')
    .map((j) => {
      const f = features(worker, j);
      const acc = get("SELECT COUNT(*) AS c FROM assignments WHERE job_id = ? AND status = 'accepted'", j.id).c;
      return {
        job: {
          ...j,
          work: WORK_TYPE_MAP[j.work_type],
          date_label: fmtDate(j.date),
          accepted_count: acc,
          spots_left: Math.max(0, j.workers_needed - acc),
        },
        distance: round1(f.distance),
        score: score(f.x, model),
        reasons: explain(worker, j, f, 'worker'),
        alerted: notifs.has(j.id),
      };
    })
    .filter((r) => r.distance <= Math.max(worker.radius_km * 3, 30))
    .sort((a, b) => b.score - a.score);
}

// One SGD step on the logistic loss. y = 1 (accepted) or 0 (declined).
function learn(x, y) {
  const m = loadModel();
  const p = score(x, m);
  m.samples += 1;
  if ((p >= 0.5) === (y === 1)) m.correct += 1;
  if (y === 1) m.positives += 1;
  const err = y - p;
  for (const f of FEATURES) m.weights[f] = Math.max(0, m.weights[f] + LEARNING_RATE * err * x[f]);
  m.bias += LEARNING_RATE * err;
  saveModel(m);
  return { p, y };
}

function modelInfo() {
  const m = loadModel();
  const total = FEATURES.reduce((s, f) => s + m.weights[f], 0) || 1;
  const priorTotal = FEATURES.reduce((s, f) => s + PRIOR.weights[f], 0);
  return {
    type: 'Online logistic regression (explainable, runs locally)',
    samples: m.samples,
    accuracy: m.samples ? m.correct / m.samples : null,
    positives: m.positives,
    bias: m.bias,
    features: FEATURES.map((f) => ({
      key: f,
      label: LABELS[f],
      weight: +m.weights[f].toFixed(3),
      prior: PRIOR.weights[f],
      importance: m.weights[f] / total,
      prior_importance: PRIOR.weights[f] / priorTotal,
    })),
  };
}

function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

// Fair-wage suggestion + labour supply forecast for a planned job.
function wageInsight({ work_type, lat, lng, date, workers_needed = 1 }) {
  const workers = all("SELECT * FROM users WHERE role = 'worker'").map(hydrateUser);
  const near = workers.filter((w) => haversineKm(w.lat, w.lng, lat, lng) <= 25
    && skillMatch(w.skills, work_type).value >= 0.55);
  const wages = near.map((w) => w.daily_wage).sort((a, b) => a - b);
  const median = quantile(wages, 0.5) ?? 500;
  const p70 = quantile(wages, 0.7) ?? 520;
  const wd = date ? weekdayOf(date) : null;
  const booked = date ? new Set(all(
    `SELECT a.worker_id FROM assignments a JOIN jobs j ON j.id = a.job_id
     WHERE a.status = 'accepted' AND j.date = ?`, date,
  ).map((r) => r.worker_id)) : new Set();
  const supply = near.filter((w) => w.available && !booked.has(w.id)
    && (wd == null || w.available_days.includes(wd))).length;
  const need = Math.max(1, Number(workers_needed) || 1);
  const risk = supply >= need * 4 ? 'low' : supply >= need * 2 ? 'medium' : 'high';
  const base = risk === 'high' ? p70 * 1.1 : risk === 'medium' ? p70 : median;
  const suggested = Math.round(base / 10) * 10;
  const tips = {
    low: 'Plenty of skilled workers nearby. A fair wage will fill this fast.',
    medium: 'Supply is moderate. Offering the suggested wage improves acceptance.',
    high: `Few skilled workers are free that day. Offer ≥ ₹${suggested} and post early. We will widen the search radius automatically.`,
  };
  return {
    suggested_wage: suggested,
    median_wage: Math.round(median),
    supply,
    skilled_nearby: near.length,
    risk,
    tip: tips[risk],
  };
}

module.exports = {
  FEATURES, PRIOR, loadModel, features, score, explain, learn, modelInfo,
  rankWorkersForJob, rankJobsForWorker, wageInsight, publicWorker,
};
