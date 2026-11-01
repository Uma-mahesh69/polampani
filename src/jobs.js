// Job lifecycle: post -> AI dispatch -> accept/decline -> (auto-escalate) -> filled -> completed.
const { all, get, run, tx, hydrateUser } = require('./db');
const {
  WORK_TYPE_MAP, VILLAGES, haversineKm, todayStr, fmtDate, nearestVillage, round1,
} = require('./catalog');
const matcher = require('./matcher');
const notifier = require('./notifier');

// Each escalation round widens every worker's travel radius by this multiplier.
const ROUND_RADIUS = [1, 1.6, 2.5, 4];

const httpError = (message, status = 400) => Object.assign(new Error(message), { status });
const clampInt = (v, min, max) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};

function hydrateJob(j) {
  if (!j) return null;
  const accepted = all(
    `SELECT u.id, u.name, u.phone, u.village, u.lat, u.lng, u.rating, u.jobs_done, a.status
     FROM assignments a JOIN users u ON u.id = a.worker_id
     WHERE a.job_id = ? AND a.status IN ('accepted', 'completed') ORDER BY a.created_at`,
    j.id,
  ).map((w) => ({ ...w, distance: round1(haversineKm(w.lat, w.lng, j.lat, j.lng)) }));
  const n = get(
    `SELECT COUNT(*) AS notified,
            SUM(CASE WHEN responded = 'declined' THEN 1 ELSE 0 END) AS declined,
            SUM(CASE WHEN responded IS NULL THEN 1 ELSE 0 END) AS pending
     FROM notifications WHERE job_id = ? AND type = 'job_match'`,
    j.id,
  );
  return {
    ...j,
    work: WORK_TYPE_MAP[j.work_type],
    date_label: fmtDate(j.date),
    accepted,
    accepted_count: accepted.length,
    spots_left: Math.max(0, j.workers_needed - accepted.length),
    notified: n.notified || 0,
    declined: n.declined || 0,
    pending: n.pending || 0,
  };
}

function getJob(id) {
  return hydrateJob(get(
    `SELECT j.*, u.name AS farmer_name, u.phone AS farmer_phone
     FROM jobs j JOIN users u ON u.id = j.farmer_id WHERE j.id = ?`,
    Number(id),
  ));
}

function listJobs({ farmer_id } = {}) {
  const rows = farmer_id
    ? all('SELECT id FROM jobs WHERE farmer_id = ?', Number(farmer_id))
    : all('SELECT id FROM jobs');
  const order = { open: 0, filled: 1, completed: 2, cancelled: 3 };
  return rows.map((r) => getJob(r.id))
    .sort((a, b) => (order[a.status] - order[b.status]) || a.date.localeCompare(b.date) || b.id - a.id);
}

function jobMessage(job, distance) {
  const w = WORK_TYPE_MAP[job.work_type];
  return `${w.icon} ${w.en} (${w.te}) · ${job.village} · ${fmtDate(job.date)} ${job.start_time} · ₹${job.wage}/day`
    + (distance != null ? ` · ${distance} km away` : '');
}

function getWorker(id) {
  const w = hydrateUser(get("SELECT * FROM users WHERE id = ? AND role = 'worker'", Number(id)));
  if (!w) throw httpError('Worker not found', 404);
  return w;
}

function createJob(input, { allowPast = false } = {}) {
  const farmer = hydrateUser(get("SELECT * FROM users WHERE id = ? AND role = 'farmer'", Number(input.farmer_id)));
  if (!farmer) throw httpError('Farmer not found', 404);
  const work = WORK_TYPE_MAP[input.work_type];
  if (!work) throw httpError('Please choose a type of work');
  const date = String(input.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw httpError('Date must be YYYY-MM-DD');
  if (!allowPast && date < todayStr()) throw httpError('Date cannot be in the past');
  const workers_needed = clampInt(input.workers_needed, 1, 200);
  if (!workers_needed) throw httpError('Workers needed must be between 1 and 200');
  const wage = clampInt(input.wage, 100, 5000);
  if (!wage) throw httpError('Wage must be between ₹100 and ₹5000 per day');
  const start_time = /^\d{2}:\d{2}$/.test(input.start_time || '') ? input.start_time : '07:00';

  let lat = Number(input.lat);
  let lng = Number(input.lng);
  let village = input.village ? String(input.village) : null;
  if (input.lat == null || input.lng == null || input.lat === '' || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    const v = VILLAGES.find((x) => x.name === village);
    if (v) { lat = v.lat; lng = v.lng; } else { lat = farmer.lat; lng = farmer.lng; village = village || farmer.village; }
  }
  if (!village) village = nearestVillage(lat, lng).name;

  const title = String(input.title || `${work.en} at ${village}`).slice(0, 120);
  const id = Number(run(
    `INSERT INTO jobs (farmer_id, title, work_type, description, village, lat, lng, date, start_time, workers_needed, wage)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    farmer.id, title, work.id, String(input.description || '').slice(0, 1000), village, lat, lng,
    date, start_time, workers_needed, wage,
  ).lastInsertRowid);
  const notified = date >= todayStr() ? dispatch(id) : [];
  notifier.broadcast({ event: 'refresh' });
  return { job: getJob(id), notified: notified.length };
}

// Alert the next best batch of workers. Each call is one "round"; later rounds search wider.
function dispatch(jobId, { manual = false } = {}) {
  const job = getJob(jobId);
  if (!job || job.status !== 'open') return [];
  if (!manual && job.notify_round >= ROUND_RADIUS.length) return [];
  const round = Math.min(job.notify_round + 1, ROUND_RADIUS.length);
  const already = new Set(all(
    "SELECT user_id FROM notifications WHERE job_id = ? AND type = 'job_match'", jobId,
  ).map((r) => r.user_id));
  job.accepted.forEach((a) => already.add(a.id));

  const ranked = matcher.rankWorkersForJob(job, { radiusMult: ROUND_RADIUS[round - 1], excludeIds: already });
  const batch = ranked.filter((c) => c.score >= 0.05).slice(0, Math.max(4, job.spots_left * 3));
  for (const c of batch) {
    notifier.notify(c.worker.id, {
      type: 'job_match', job_id: job.id, score: c.score, features: c.x, message: jobMessage(job, c.distance),
    });
  }
  run("UPDATE jobs SET notify_round = ?, last_dispatch_at = datetime('now') WHERE id = ?", round, job.id);
  if (round > 1 || manual) {
    notifier.notify(job.farmer_id, {
      type: 'escalation',
      job_id: job.id,
      message: batch.length
        ? `📣 Search widened (round ${round}): alerted ${batch.length} more workers for ${job.work.en} on ${job.date_label}`
        : `🔍 No more available workers found for ${job.work.en} on ${job.date_label}. Try raising the wage.`,
    });
  }
  return batch;
}

function accept(jobId, workerId, { learn = true } = {}) {
  const job = getJob(jobId);
  if (!job) throw httpError('Job not found', 404);
  const worker = getWorker(workerId);
  if (job.status !== 'open') {
    throw httpError(job.status === 'filled' ? 'Sorry, this job was just filled by other workers' : 'This job is no longer open', 409);
  }
  if (job.accepted.some((a) => a.id === worker.id)) throw httpError('You already accepted this job', 409);
  const clash = get(
    `SELECT j.id FROM assignments a JOIN jobs j ON j.id = a.job_id
     WHERE a.worker_id = ? AND a.status = 'accepted' AND j.date = ? AND j.id <> ?`,
    worker.id, job.date, job.id,
  );
  if (clash) throw httpError('You already have work booked on that day', 409);

  const notif = get(
    "SELECT * FROM notifications WHERE job_id = ? AND user_id = ? AND type = 'job_match' ORDER BY id DESC LIMIT 1",
    job.id, worker.id,
  );
  tx(() => {
    run(
      `INSERT INTO assignments (job_id, worker_id, status) VALUES (?, ?, 'accepted')
       ON CONFLICT(job_id, worker_id) DO UPDATE SET status = 'accepted', created_at = datetime('now')`,
      job.id, worker.id,
    );
    if (notif) run("UPDATE notifications SET responded = 'accepted', read = 1 WHERE id = ?", notif.id);
  });
  if (learn) matcher.learn(notif?.features ? JSON.parse(notif.features) : matcher.features(worker, job).x, 1);

  const updated = getJob(job.id);
  notifier.notify(job.farmer_id, {
    type: 'accepted',
    job_id: job.id,
    message: `✅ ${worker.name} (${worker.village}) accepted ${job.work.en} on ${job.date_label}: ${updated.accepted_count}/${job.workers_needed} confirmed`,
  });
  if (updated.accepted_count >= job.workers_needed) {
    run("UPDATE jobs SET status = 'filled' WHERE id = ?", job.id);
    notifier.notify(job.farmer_id, {
      type: 'filled',
      job_id: job.id,
      message: `🎉 Your ${job.work.en} job on ${job.date_label} is fully staffed (${job.workers_needed} workers)!`,
    });
    const pending = all(
      "SELECT user_id FROM notifications WHERE job_id = ? AND type = 'job_match' AND responded IS NULL", job.id,
    );
    run("UPDATE notifications SET responded = 'closed' WHERE job_id = ? AND type = 'job_match' AND responded IS NULL", job.id);
    pending.forEach((p) => notifier.push(p.user_id, { event: 'refresh' }));
  }
  notifier.broadcast({ event: 'refresh' });
  return getJob(job.id);
}

function decline(jobId, workerId) {
  const job = getJob(jobId);
  if (!job) throw httpError('Job not found', 404);
  const worker = getWorker(workerId);
  const notif = get(
    "SELECT * FROM notifications WHERE job_id = ? AND user_id = ? AND type = 'job_match' AND responded IS NULL ORDER BY id DESC LIMIT 1",
    job.id, worker.id,
  );
  const x = notif?.features ? JSON.parse(notif.features) : matcher.features(worker, job).x;
  if (notif) {
    run("UPDATE notifications SET responded = 'declined', read = 1 WHERE id = ?", notif.id);
  } else {
    run(
      "INSERT INTO notifications (user_id, job_id, type, message, features, responded, read) VALUES (?, ?, 'job_match', ?, ?, 'declined', 1)",
      worker.id, job.id, jobMessage(job), JSON.stringify(x),
    );
  }
  matcher.learn(x, 0);
  // Keep the pipeline full: if fewer people are still considering than spots left, alert the next best.
  const fresh = getJob(job.id);
  if (fresh.status === 'open' && fresh.pending < fresh.spots_left) dispatch(job.id);
  notifier.broadcast({ event: 'refresh' });
  return { ok: true };
}

function withdraw(jobId, workerId) {
  const job = getJob(jobId);
  if (!job) throw httpError('Job not found', 404);
  const worker = getWorker(workerId);
  const a = get("SELECT * FROM assignments WHERE job_id = ? AND worker_id = ? AND status = 'accepted'", job.id, worker.id);
  if (!a) throw httpError('No active booking for this job', 404);
  run("UPDATE assignments SET status = 'withdrawn' WHERE id = ?", a.id);
  if (job.status === 'filled') run("UPDATE jobs SET status = 'open' WHERE id = ?", job.id);
  notifier.notify(job.farmer_id, {
    type: 'withdrawn',
    job_id: job.id,
    message: `⚠️ ${worker.name} cancelled ${job.work.en} on ${job.date_label}. Finding a replacement automatically…`,
  });
  dispatch(job.id, { manual: true });
  notifier.broadcast({ event: 'refresh' });
  return getJob(job.id);
}

function complete(jobId, farmerId) {
  const job = getJob(jobId);
  if (!job) throw httpError('Job not found', 404);
  if (farmerId != null && job.farmer_id !== Number(farmerId)) throw httpError('Only the farmer who posted can complete this job', 403);
  if (!['open', 'filled'].includes(job.status)) throw httpError('Job is already closed', 409);
  const workerIds = all("SELECT worker_id FROM assignments WHERE job_id = ? AND status = 'accepted'", job.id).map((r) => r.worker_id);
  tx(() => {
    run("UPDATE jobs SET status = 'completed' WHERE id = ?", job.id);
    run("UPDATE assignments SET status = 'completed' WHERE job_id = ? AND status = 'accepted'", job.id);
    run("UPDATE notifications SET responded = 'closed' WHERE job_id = ? AND type = 'job_match' AND responded IS NULL", job.id);
    for (const id of workerIds) run('UPDATE users SET jobs_done = jobs_done + 1 WHERE id = ?', id);
  });
  for (const id of workerIds) {
    notifier.notify(id, { type: 'completed', job_id: job.id, message: `🙏 ${job.farmer_name} marked ${job.work.en} on ${job.date_label} as completed. Thank you!` });
  }
  notifier.broadcast({ event: 'refresh' });
  return getJob(job.id);
}

function matches(jobId) {
  const job = getJob(jobId);
  if (!job) throw httpError('Job not found', 404);
  const notifMap = new Map(all(
    "SELECT user_id, responded FROM notifications WHERE job_id = ? AND type = 'job_match'", job.id,
  ).map((n) => [n.user_id, n.responded]));
  const acceptedIds = new Set(job.accepted.map((a) => a.id));
  const candidates = matcher.rankWorkersForJob(job, { radiusMult: 4 }).slice(0, 30).map((c) => ({
    ...c,
    status: acceptedIds.has(c.worker.id) ? 'accepted'
      : notifMap.has(c.worker.id) ? (notifMap.get(c.worker.id) || 'alerted') : null,
  }));
  return { job, candidates };
}

function workerAssignments(workerId) {
  const worker = getWorker(workerId);
  return all(
    `SELECT j.*, u.name AS farmer_name, u.phone AS farmer_phone, a.status AS booking_status
     FROM assignments a JOIN jobs j ON j.id = a.job_id JOIN users u ON u.id = j.farmer_id
     WHERE a.worker_id = ? AND a.status IN ('accepted', 'completed') ORDER BY j.date DESC`,
    worker.id,
  ).map((j) => ({
    ...j,
    work: WORK_TYPE_MAP[j.work_type],
    date_label: fmtDate(j.date),
    distance: round1(haversineKm(worker.lat, worker.lng, j.lat, j.lng)),
  }));
}

// Called periodically: jobs that are still open after `minutes` get a wider search round.
function autoEscalate(minutes) {
  const rows = all(
    `SELECT id FROM jobs WHERE status = 'open' AND date >= ? AND notify_round < ?
     AND (last_dispatch_at IS NULL OR last_dispatch_at <= datetime('now', ?))`,
    todayStr(), ROUND_RADIUS.length, `-${minutes} minutes`,
  );
  let escalated = 0;
  for (const r of rows) if (dispatch(r.id).length) escalated += 1;
  if (escalated) notifier.broadcast({ event: 'refresh' });
  return escalated;
}

module.exports = {
  getJob, listJobs, createJob, dispatch, accept, decline, withdraw, complete, matches,
  workerAssignments, autoEscalate, getWorker, httpError,
};
