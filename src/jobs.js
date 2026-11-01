// Job lifecycle:
// post -> AI dispatch -> accept / decline / invite -> (auto-escalate) -> filled
//      -> check-in on the day -> complete with attendance -> rate + pay.
const { all, get, run, tx, hydrateUser, parseJSON } = require('./db');
const {
  WORK_TYPE_MAP, FACILITY_IDS, VILLAGE_MAP, haversineKm, todayStr, nearestVillage, round1, endDateOf, sqlNow, addDays,
} = require('./catalog');
const matcher = require('./matcher');
const notifier = require('./notifier');
const insights = require('./insights');
const { HttpError } = require('./errors');

// Each escalation round widens every worker's travel radius by this multiplier.
const ROUND_RADIUS = [1, 1.6, 2.5, 4];
const BASE_RADIUS_KM = 20;

const clampInt = (v, min, max) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};

function event(jobId, type, data = {}) {
  run('INSERT INTO job_events (job_id, type, data) VALUES (?, ?, ?)', jobId, type, JSON.stringify(data));
}

function jobRow(id) {
  return get(
    `SELECT j.*, u.name AS farmer_name, u.phone AS farmer_phone, u.rating AS farmer_rating,
            u.rating_count AS farmer_rating_count, u.village AS farmer_village
     FROM jobs j JOIN users u ON u.id = j.farmer_id WHERE j.id = ?`,
    Number(id),
  );
}

function crew(job) {
  return all(
    `SELECT a.id AS assignment_id, a.status, a.checked_in_at, a.farmer_rating, a.farmer_review, a.worker_rating,
            a.amount, a.paid, a.paid_at, a.pay_method, a.created_at AS accepted_at,
            u.id, u.name, u.phone, u.village, u.lat, u.lng, u.rating, u.rating_count, u.jobs_done, u.upi_id, u.verified
     FROM assignments a JOIN users u ON u.id = a.worker_id
     WHERE a.job_id = ? AND a.status IN ('accepted', 'completed', 'no_show') ORDER BY a.created_at`,
    job.id,
  ).map((w) => ({ ...w, verified: !!w.verified, paid: !!w.paid, distance: round1(haversineKm(w.lat, w.lng, job.lat, job.lng)) }));
}

function counts(jobId) {
  const n = get(
    `SELECT COUNT(*) AS alerted,
            SUM(CASE WHEN responded = 'declined' THEN 1 ELSE 0 END) AS declined,
            SUM(CASE WHEN responded IS NULL THEN 1 ELSE 0 END) AS pending
     FROM notifications WHERE job_id = ? AND type IN ('job_match', 'invite')`,
    jobId,
  );
  return { alerted: n.alerted || 0, declined: n.declined || 0, pending: n.pending || 0 };
}

function hydrate(row) {
  if (!row) return null;
  const job = matcher.decorateJob(row);
  const team = crew(job);
  const confirmed = team.filter((w) => w.status !== 'no_show');
  return {
    ...job,
    crew: team,
    accepted_count: confirmed.length,
    spots_left: Math.max(0, job.workers_needed - confirmed.length),
    radius_km: Math.round(BASE_RADIUS_KM * ROUND_RADIUS[Math.max(0, Math.min(job.notify_round, ROUND_RADIUS.length) - 1)]),
    ...counts(job.id),
  };
}

const getJob = (id) => hydrate(jobRow(id));

function mustGetJob(id) {
  const job = getJob(id);
  if (!job) throw new HttpError(404, 'This job does not exist or was removed');
  return job;
}

function mustOwn(job, farmer) {
  if (!farmer || job.farmer_id !== farmer.id) throw new HttpError(403, 'Only the farmer who posted this job can do that');
}

function mustBeWorker(id) {
  const w = hydrateUser(get("SELECT * FROM users WHERE id = ? AND role = 'worker'", Number(id)));
  if (!w) throw new HttpError(404, 'Worker not found');
  return w;
}

const STATUS_ORDER = { open: 0, filled: 1, completed: 2, cancelled: 3 };
function listFarmerJobs(farmerId, status) {
  const rows = all('SELECT id FROM jobs WHERE farmer_id = ?', farmerId);
  let jobs = rows.map((r) => getJob(r.id));
  if (status === 'active') jobs = jobs.filter((j) => ['open', 'filled'].includes(j.status));
  else if (status) jobs = jobs.filter((j) => j.status === status);
  return jobs.sort((a, b) => (STATUS_ORDER[a.status] - STATUS_ORDER[b.status])
    || (a.status === 'completed' || a.status === 'cancelled' ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date)));
}

function jobPayload(job, distance) {
  return {
    work_type: job.work_type, village: job.village, date: job.date, end_date: job.end_date, days: job.duration_days,
    time: job.start_time, wage: job.wage, distance,
  };
}

// ---------- validation ----------
function normaliseInput(farmer, input) {
  const work = WORK_TYPE_MAP[input.work_type];
  if (!work) throw new HttpError(400, 'Choose the type of work');
  const date = String(input.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, 'Choose a date for the work');
  if (date < todayStr()) throw new HttpError(400, 'The work date cannot be in the past');
  const duration_days = clampInt(input.duration_days ?? 1, 1, 30);
  if (!duration_days) throw new HttpError(400, 'Duration must be between 1 and 30 days');
  const workers_needed = clampInt(input.workers_needed, 1, 200);
  if (!workers_needed) throw new HttpError(400, 'Workers needed must be between 1 and 200');
  const wage = clampInt(input.wage, 100, 5000);
  if (!wage) throw new HttpError(400, 'Daily wage must be between ₹100 and ₹5,000');
  const start_time = /^\d{2}:\d{2}$/.test(input.start_time || '') ? input.start_time : '07:00';
  const facilities = Array.isArray(input.facilities) ? [...new Set(input.facilities.filter((f) => FACILITY_IDS.has(f)))] : [];

  let lat = Number(input.lat);
  let lng = Number(input.lng);
  let village = input.village ? String(input.village) : null;
  const hasCoords = input.lat != null && input.lat !== '' && Number.isFinite(lat) && Number.isFinite(lng);
  if (!hasCoords) {
    const v = VILLAGE_MAP[village];
    if (v) { lat = v.lat; lng = v.lng; } else { lat = farmer.lat; lng = farmer.lng; village = village || farmer.village; }
  }
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new HttpError(400, 'The field location is not valid');
  if (!village || !VILLAGE_MAP[village]) village = nearestVillage(lat, lng).name;
  return {
    farmer_id: farmer.id, work_type: work.id, date, end_date: endDateOf(date, duration_days), duration_days,
    start_time, workers_needed, wage, facilities, lat, lng, village,
    description: String(input.description || '').trim().slice(0, 600),
  };
}

const batchSize = (spots) => Math.max(4, spots * 3);

// Dry run of the first alert round: who would be alerted and how likely the job fills.
async function preview(farmer, input) {
  const job = { ...normaliseInput(farmer, input), id: null };
  const ranked = matcher.rankWorkersForJob(job);
  const batch = ranked.filter((c) => c.score >= 0.05).slice(0, batchSize(job.workers_needed));
  const wider = matcher.rankWorkersForJob(job, { radiusMult: ROUND_RADIUS[ROUND_RADIUS.length - 1] });
  const [weather] = await Promise.all([insights.weatherFor(job.lat, job.lng, job.date, job.end_date)]);
  return {
    job: { ...job, work: WORK_TYPE_MAP[job.work_type] },
    in_range: ranked.length,
    reachable: wider.length,
    alert_count: batch.length,
    forecast: matcher.fillForecast(batch.map((c) => c.score), job.workers_needed),
    top: batch.slice(0, 6).map((c) => ({ worker: c.worker, score: c.score, distance: c.distance })),
    wage: insights.wageInsight(job),
    weather,
  };
}

function createJob(farmer, input, { silent = false } = {}) {
  const j = normaliseInput(farmer, input);
  const id = Number(run(
    `INSERT INTO jobs (farmer_id, work_type, description, village, lat, lng, date, end_date, duration_days,
                       start_time, workers_needed, wage, facilities)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    j.farmer_id, j.work_type, j.description, j.village, j.lat, j.lng, j.date, j.end_date, j.duration_days,
    j.start_time, j.workers_needed, j.wage, JSON.stringify(j.facilities),
  ).lastInsertRowid);
  event(id, 'posted', { workers: j.workers_needed, wage: j.wage });
  const batch = dispatch(id, { silent });
  notifier.broadcast({ event: 'refresh', scope: 'jobs' });
  return {
    job: getJob(id),
    notified: batch.length,
    forecast: matcher.fillForecast(batch.map((c) => c.score), j.workers_needed),
  };
}

// Alert the next best batch of workers. Each call is one round; later rounds search wider.
function dispatch(jobId, { manual = false, silent = false } = {}) {
  const job = getJob(jobId);
  if (!job || job.status !== 'open') return [];
  if (!manual && job.notify_round >= ROUND_RADIUS.length) return [];
  const round = Math.min(job.notify_round + 1, ROUND_RADIUS.length);
  const already = new Set(all(
    "SELECT user_id FROM notifications WHERE job_id = ? AND type IN ('job_match', 'invite')", jobId,
  ).map((r) => r.user_id));
  job.crew.forEach((a) => already.add(a.id));

  const mult = ROUND_RADIUS[round - 1];
  const ranked = matcher.rankWorkersForJob(job, { radiusMult: mult, excludeIds: already });
  const batch = ranked.filter((c) => c.score >= 0.05).slice(0, batchSize(job.spots_left));
  tx(() => {
    for (const c of batch) {
      notifier.notify(c.worker.id, 'job_match', jobPayload(job, c.distance), { job_id: job.id, score: c.score, features: c.x, silent });
    }
    run("UPDATE jobs SET notify_round = ?, last_dispatch_at = datetime('now') WHERE id = ?", round, job.id);
    event(job.id, 'alerted', { round, count: batch.length, radius: Math.round(BASE_RADIUS_KM * mult) });
  });
  if (round > 1 || manual) {
    notifier.notify(
      job.farmer_id,
      batch.length ? 'escalation' : 'no_more',
      { ...jobPayload(job), round, count: batch.length, radius: Math.round(BASE_RADIUS_KM * mult) },
      { job_id: job.id, silent },
    );
  }
  return batch;
}

function invite(jobId, farmer, workerId) {
  const job = mustGetJob(jobId);
  mustOwn(job, farmer);
  if (job.status !== 'open') throw new HttpError(409, 'You can only invite workers to an open job');
  const worker = mustBeWorker(workerId);
  if (job.crew.some((c) => c.id === worker.id)) throw new HttpError(409, `${worker.name} is already on this job`);
  const prior = get("SELECT id, responded FROM notifications WHERE job_id = ? AND user_id = ? AND type IN ('job_match','invite') ORDER BY id DESC LIMIT 1", job.id, worker.id);
  if (prior && !prior.responded) {
    run("UPDATE notifications SET type = 'invite' WHERE id = ?", prior.id);
  }
  const f = matcher.features(worker, job, matcher.farmerHistory(job.farmer_id));
  notifier.notify(worker.id, 'invite', { ...jobPayload(job, round1(f.distance)), farmer: farmer.name }, {
    job_id: job.id, score: matcher.score(f.x), features: f.x,
  });
  if (prior && !prior.responded) run('DELETE FROM notifications WHERE id = ?', prior.id);
  event(job.id, 'invited', { worker: worker.name });
  notifier.broadcast({ event: 'refresh', scope: 'jobs' });
  return { ok: true };
}

function accept(jobId, workerId, { learn = true } = {}) {
  const job = mustGetJob(jobId);
  const worker = mustBeWorker(workerId);
  if (job.status !== 'open') {
    throw new HttpError(409, job.status === 'filled' ? 'This job just got filled by other workers' : 'This job is no longer taking workers');
  }
  if (job.end_date < todayStr()) throw new HttpError(409, 'This job has already finished');
  if (job.crew.some((a) => a.id === worker.id)) throw new HttpError(409, 'You have already accepted this job');
  const clash = get(
    `SELECT j.id FROM assignments a JOIN jobs j ON j.id = a.job_id
     WHERE a.worker_id = ? AND a.status = 'accepted' AND j.date <= ? AND j.end_date >= ? AND j.id <> ?`,
    worker.id, job.end_date, job.date, job.id,
  );
  if (clash) throw new HttpError(409, 'You already have work booked on one of these days');

  const notif = get(
    "SELECT * FROM notifications WHERE job_id = ? AND user_id = ? AND type IN ('job_match','invite') ORDER BY id DESC LIMIT 1",
    job.id, worker.id,
  );
  tx(() => {
    run(
      `INSERT INTO assignments (job_id, worker_id, status) VALUES (?, ?, 'accepted')
       ON CONFLICT(job_id, worker_id) DO UPDATE SET status = 'accepted', created_at = datetime('now'), checked_in_at = NULL`,
      job.id, worker.id,
    );
    if (notif) run("UPDATE notifications SET responded = 'accepted', read = 1 WHERE id = ?", notif.id);
    event(job.id, 'accepted', { worker: worker.name, worker_id: worker.id });
  });
  if (learn) {
    const x = notif?.features ? JSON.parse(notif.features) : matcher.features(worker, job, matcher.farmerHistory(job.farmer_id)).x;
    matcher.learn(x, 1);
  }

  const updated = getJob(job.id);
  notifier.notify(job.farmer_id, 'accepted', {
    ...jobPayload(job), worker: worker.name, worker_village: worker.village, count: updated.accepted_count, needed: job.workers_needed,
  }, { job_id: job.id });

  if (updated.accepted_count >= job.workers_needed) {
    tx(() => {
      run("UPDATE jobs SET status = 'filled', filled_at = COALESCE(filled_at, datetime('now')) WHERE id = ?", job.id);
      event(job.id, 'filled', { workers: job.workers_needed });
    });
    notifier.notify(job.farmer_id, 'filled', { ...jobPayload(job), needed: job.workers_needed }, { job_id: job.id });
    closePending(job);
  }
  notifier.broadcast({ event: 'refresh', scope: 'jobs' });
  return getJob(job.id);
}

function closePending(job) {
  const pending = all(
    "SELECT user_id FROM notifications WHERE job_id = ? AND type IN ('job_match','invite') AND responded IS NULL", job.id,
  );
  run("UPDATE notifications SET responded = 'closed' WHERE job_id = ? AND type IN ('job_match','invite') AND responded IS NULL", job.id);
  pending.forEach((p) => notifier.push(p.user_id, { event: 'refresh', scope: 'feed' }));
}

function decline(jobId, workerId) {
  const job = mustGetJob(jobId);
  const worker = mustBeWorker(workerId);
  const notif = get(
    "SELECT * FROM notifications WHERE job_id = ? AND user_id = ? AND type IN ('job_match','invite') AND responded IS NULL ORDER BY id DESC LIMIT 1",
    job.id, worker.id,
  );
  const x = notif?.features ? JSON.parse(notif.features)
    : matcher.features(worker, job, matcher.farmerHistory(job.farmer_id)).x;
  if (notif) {
    run("UPDATE notifications SET responded = 'declined', read = 1 WHERE id = ?", notif.id);
  } else {
    run(
      "INSERT INTO notifications (user_id, job_id, type, data, message, features, responded, read) VALUES (?, ?, 'job_match', ?, '', ?, 'declined', 1)",
      worker.id, job.id, JSON.stringify(jobPayload(job)), JSON.stringify(x),
    );
  }
  matcher.learn(x, 0);
  event(job.id, 'declined', {});
  // Keep the pipeline full: if fewer people are still deciding than spots left, alert the next best.
  const fresh = getJob(job.id);
  if (fresh.status === 'open' && fresh.pending < fresh.spots_left) dispatch(job.id);
  notifier.broadcast({ event: 'refresh', scope: 'jobs' });
  return { ok: true };
}

function withdraw(jobId, workerId) {
  const job = mustGetJob(jobId);
  const worker = mustBeWorker(workerId);
  const a = get("SELECT * FROM assignments WHERE job_id = ? AND worker_id = ? AND status = 'accepted'", job.id, worker.id);
  if (!a) throw new HttpError(404, 'You do not have a booking for this job');
  if (job.date <= todayStr() && a.checked_in_at) throw new HttpError(409, 'You have already checked in. Ask the farmer to update attendance.');
  tx(() => {
    run("UPDATE assignments SET status = 'withdrawn' WHERE id = ?", a.id);
    if (job.status === 'filled') run("UPDATE jobs SET status = 'open' WHERE id = ?", job.id);
    event(job.id, 'withdrawn', { worker: worker.name });
  });
  notifier.notify(job.farmer_id, 'withdrawn', { ...jobPayload(job), worker: worker.name }, { job_id: job.id });
  dispatch(job.id, { manual: true });
  notifier.broadcast({ event: 'refresh', scope: 'jobs' });
  return getJob(job.id);
}

function cancel(jobId, farmer, reason = '') {
  const job = mustGetJob(jobId);
  mustOwn(job, farmer);
  if (!['open', 'filled'].includes(job.status)) throw new HttpError(409, 'This job is already closed');
  const why = String(reason || '').slice(0, 200);
  tx(() => {
    run("UPDATE jobs SET status = 'cancelled', cancelled_at = datetime('now'), cancel_reason = ? WHERE id = ?", why, job.id);
    run("UPDATE assignments SET status = 'cancelled' WHERE job_id = ? AND status = 'accepted'", job.id);
    event(job.id, 'cancelled', { reason: why });
  });
  for (const w of job.crew.filter((c) => c.status === 'accepted')) {
    notifier.notify(w.id, 'cancelled', { ...jobPayload(job), farmer: farmer.name, reason: why }, { job_id: job.id });
  }
  closePending(job);
  notifier.broadcast({ event: 'refresh', scope: 'jobs' });
  return getJob(job.id);
}

function checkin(jobId, workerId) {
  const job = mustGetJob(jobId);
  const worker = mustBeWorker(workerId);
  const today = todayStr();
  if (today < job.date || today > job.end_date) throw new HttpError(409, 'You can check in only on the work day');
  const a = get("SELECT * FROM assignments WHERE job_id = ? AND worker_id = ? AND status = 'accepted'", job.id, worker.id);
  if (!a) throw new HttpError(404, 'You do not have a booking for this job');
  if (a.checked_in_at && a.checked_in_at.slice(0, 10) === sqlNow().slice(0, 10)) return getJob(job.id);
  run("UPDATE assignments SET checked_in_at = datetime('now') WHERE id = ?", a.id);
  event(job.id, 'checked_in', { worker: worker.name });
  notifier.notify(job.farmer_id, 'checked_in', { ...jobPayload(job), worker: worker.name }, { job_id: job.id });
  notifier.broadcast({ event: 'refresh', scope: 'jobs' });
  return getJob(job.id);
}

// attendance: { [workerId]: 'present' | 'no_show' }. Missing entries count as present.
function complete(jobId, farmer, attendance = {}) {
  const job = mustGetJob(jobId);
  mustOwn(job, farmer);
  if (!['open', 'filled'].includes(job.status)) throw new HttpError(409, 'This job is already closed');
  if (job.date > todayStr()) throw new HttpError(409, 'You can mark the work complete once it has started');
  const active = job.crew.filter((c) => c.status === 'accepted');
  if (!active.length) throw new HttpError(409, 'No workers are booked on this job yet');
  const history = matcher.farmerHistory(job.farmer_id);
  const present = [];
  tx(() => {
    for (const w of active) {
      const noShow = attendance[w.id] === 'no_show';
      if (noShow) {
        run("UPDATE assignments SET status = 'no_show' WHERE id = ?", w.assignment_id);
        run('UPDATE users SET no_shows = no_shows + 1 WHERE id = ?', w.id);
        const worker = mustBeWorker(w.id);
        matcher.learn(matcher.features(worker, job, history).x, 0);
      } else {
        const amount = job.wage * job.duration_days;
        run("UPDATE assignments SET status = 'completed', amount = ? WHERE id = ?", amount, w.assignment_id);
        run('UPDATE users SET jobs_done = jobs_done + 1 WHERE id = ?', w.id);
        present.push({ ...w, amount });
      }
    }
    run("UPDATE jobs SET status = 'completed', completed_at = datetime('now') WHERE id = ?", job.id);
    event(job.id, 'completed', { present: present.length, no_show: active.length - present.length });
  });
  closePending(job);
  for (const w of present) {
    notifier.notify(w.id, 'completed', { ...jobPayload(job), farmer: farmer.name, amount: w.amount }, { job_id: job.id });
  }
  notifier.broadcast({ event: 'refresh', scope: 'jobs' });
  return getJob(job.id);
}

function assignmentFor(id) {
  const a = get(
    `SELECT a.*, j.farmer_id, j.work_type, j.date, j.wage, j.duration_days FROM assignments a JOIN jobs j ON j.id = a.job_id WHERE a.id = ?`,
    Number(id),
  );
  if (!a) throw new HttpError(404, 'Booking not found');
  return a;
}

const bayes = (avg, count, r) => Math.round(((avg * count + r) / (count + 1)) * 100) / 100;

function rateWorker(assignmentId, farmer, rating, review = '') {
  const a = assignmentFor(assignmentId);
  if (a.farmer_id !== farmer.id) throw new HttpError(403, 'Only the farmer who posted this job can rate');
  if (a.status !== 'completed') throw new HttpError(409, 'You can rate after the work is complete');
  const r = clampInt(rating, 1, 5);
  if (!r) throw new HttpError(400, 'Choose a rating from 1 to 5 stars');
  const worker = get('SELECT rating, rating_count FROM users WHERE id = ?', a.worker_id);
  tx(() => {
    if (a.farmer_rating == null) {
      run('UPDATE users SET rating = ?, rating_count = rating_count + 1 WHERE id = ?', bayes(worker.rating, worker.rating_count, r), a.worker_id);
    }
    run('UPDATE assignments SET farmer_rating = ?, farmer_review = ? WHERE id = ?', r, String(review || '').slice(0, 300), a.id);
  });
  if (a.farmer_rating == null) notifier.notify(a.worker_id, 'rated', { farmer: farmer.name, rating: r, work_type: a.work_type, date: a.date }, { job_id: a.job_id });
  return { ok: true };
}

function rateFarmer(assignmentId, worker, rating) {
  const a = assignmentFor(assignmentId);
  if (a.worker_id !== worker.id) throw new HttpError(403, 'You can only rate farmers you worked for');
  if (a.status !== 'completed') throw new HttpError(409, 'You can rate after the work is complete');
  const r = clampInt(rating, 1, 5);
  if (!r) throw new HttpError(400, 'Choose a rating from 1 to 5 stars');
  const f = get('SELECT rating, rating_count FROM users WHERE id = ?', a.farmer_id);
  tx(() => {
    if (a.worker_rating == null) run('UPDATE users SET rating = ?, rating_count = rating_count + 1 WHERE id = ?', bayes(f.rating, f.rating_count, r), a.farmer_id);
    run('UPDATE assignments SET worker_rating = ? WHERE id = ?', r, a.id);
  });
  return { ok: true };
}

function markPaid(assignmentId, farmer, method = 'cash') {
  const a = assignmentFor(assignmentId);
  if (a.farmer_id !== farmer.id) throw new HttpError(403, 'Only the farmer who posted this job can record payment');
  if (a.status !== 'completed') throw new HttpError(409, 'Record payment after the work is complete');
  if (a.paid) return { ok: true };
  const m = method === 'upi' ? 'upi' : 'cash';
  const amount = a.amount || a.wage * a.duration_days;
  run("UPDATE assignments SET paid = 1, paid_at = datetime('now'), pay_method = ?, amount = ? WHERE id = ?", m, amount, a.id);
  const worker = get('SELECT name FROM users WHERE id = ?', a.worker_id);
  event(a.job_id, 'paid', { worker: worker.name, amount, method: m });
  notifier.notify(a.worker_id, 'paid', { farmer: farmer.name, amount, method: m, work_type: a.work_type, date: a.date }, { job_id: a.job_id });
  notifier.broadcast({ event: 'refresh', scope: 'jobs' });
  return { ok: true };
}

function matches(jobId, farmer) {
  const job = mustGetJob(jobId);
  mustOwn(job, farmer);
  const notifMap = new Map(all(
    "SELECT user_id, responded, type FROM notifications WHERE job_id = ? AND type IN ('job_match','invite')", job.id,
  ).map((n) => [n.user_id, n]));
  const crewIds = new Set(job.crew.map((a) => a.id));
  return matcher.rankWorkersForJob(job, { radiusMult: 4 }).slice(0, 40).map(({ x, inRange, ...c }) => {
    const n = notifMap.get(c.worker.id);
    return {
      ...c,
      status: crewIds.has(c.worker.id) ? 'accepted' : n ? (n.responded || (n.type === 'invite' ? 'invited' : 'alerted')) : null,
    };
  });
}

function timeline(jobId) {
  return all('SELECT type, data, created_at FROM job_events WHERE job_id = ? ORDER BY id DESC LIMIT 60', jobId)
    .map((e) => ({ ...e, data: parseJSON(e.data, {}) }));
}

// What a given viewer is allowed to see about a job.
function view(jobId, viewer) {
  const job = mustGetJob(jobId);
  const isOwner = viewer && viewer.id === job.farmer_id;
  const base = {
    id: job.id, work_type: job.work_type, work: job.work, description: job.description, village: job.village,
    lat: job.lat, lng: job.lng, date: job.date, end_date: job.end_date, duration_days: job.duration_days,
    start_time: job.start_time, workers_needed: job.workers_needed, wage: job.wage, facilities: job.facilities,
    status: job.status, accepted_count: job.accepted_count, spots_left: job.spots_left, created_at: job.created_at,
    farmer: {
      id: job.farmer_id, name: job.farmer_name, village: job.farmer_village, rating: job.farmer_rating,
      rating_count: job.farmer_rating_count,
      jobs_posted: get('SELECT COUNT(*) AS c FROM jobs WHERE farmer_id = ?', job.farmer_id).c,
    },
  };
  if (isOwner) {
    return { ...job, ...base, viewer: 'owner', events: timeline(job.id) };
  }
  if (viewer?.role === 'worker') {
    const mine = job.crew.find((c) => c.id === viewer.id) || null;
    const notif = get(
      "SELECT id, responded, type, score FROM notifications WHERE job_id = ? AND user_id = ? AND type IN ('job_match','invite') ORDER BY id DESC LIMIT 1",
      job.id, viewer.id,
    );
    const f = matcher.features(viewer, job, matcher.farmerHistory(job.farmer_id));
    const clash = get(
      `SELECT j.id FROM assignments a JOIN jobs j ON j.id = a.job_id
       WHERE a.worker_id = ? AND a.status = 'accepted' AND j.date <= ? AND j.end_date >= ? AND j.id <> ?`,
      viewer.id, job.end_date, job.date, job.id,
    );
    return {
      ...base,
      viewer: 'worker',
      booking: mine ? {
        assignment_id: mine.assignment_id, status: mine.status, checked_in_at: mine.checked_in_at,
        amount: mine.amount, paid: mine.paid, pay_method: mine.pay_method, worker_rating: mine.worker_rating,
        farmer_rating: mine.farmer_rating,
      } : null,
      farmer: mine ? { ...base.farmer, phone: job.farmer_phone } : base.farmer,
      alert: notif ? { responded: notif.responded, type: notif.type } : null,
      clash: !!clash,
      distance: round1(f.distance),
      score: matcher.score(f.x),
      reasons: matcher.explain(viewer, job, f),
    };
  }
  return { ...base, viewer: 'public' };
}

function workerWork(workerId) {
  const worker = mustBeWorker(workerId);
  const rows = all(
    `SELECT a.id AS assignment_id, a.status AS booking_status, a.checked_in_at, a.amount, a.paid, a.paid_at, a.pay_method,
            a.farmer_rating, a.worker_rating, j.*, u.name AS farmer_name, u.phone AS farmer_phone
     FROM assignments a JOIN jobs j ON j.id = a.job_id JOIN users u ON u.id = j.farmer_id
     WHERE a.worker_id = ? AND a.status IN ('accepted', 'completed', 'no_show', 'cancelled')
     ORDER BY j.date DESC`,
    worker.id,
  ).map((j) => ({
    ...matcher.decorateJob(j),
    paid: !!j.paid,
    distance: round1(haversineKm(worker.lat, worker.lng, j.lat, j.lng)),
  }));
  const last30 = addDays(-30);
  const done = rows.filter((r) => r.booking_status === 'completed');
  return {
    upcoming: rows.filter((r) => r.booking_status === 'accepted').sort((a, b) => a.date.localeCompare(b.date)),
    past: rows.filter((r) => r.booking_status !== 'accepted'),
    earnings: {
      last_30d: done.filter((r) => r.date >= last30).reduce((s, r) => s + (r.amount || 0), 0),
      total: done.reduce((s, r) => s + (r.amount || 0), 0),
      unpaid: done.filter((r) => !r.paid).reduce((s, r) => s + (r.amount || 0), 0),
      days_worked: done.reduce((s, r) => s + r.duration_days, 0),
      upcoming_value: rows.filter((r) => r.booking_status === 'accepted').reduce((s, r) => s + r.wage * r.duration_days, 0),
    },
  };
}

function farmerSummary(farmerId) {
  const jobs = all('SELECT * FROM jobs WHERE farmer_id = ?', farmerId);
  const today = todayStr();
  const last30 = addDays(-30);
  const since = addDays(-60);
  const recent = jobs.filter((j) => j.created_at.slice(0, 10) >= since && j.status !== 'cancelled' && (j.status !== 'open' || j.end_date < today));
  const asg = all(
    `SELECT a.*, j.date, j.wage, j.duration_days, j.status AS job_status FROM assignments a JOIN jobs j ON j.id = a.job_id
     WHERE j.farmer_id = ?`, farmerId,
  );
  return {
    active_jobs: jobs.filter((j) => ['open', 'filled'].includes(j.status)).length,
    confirmed_upcoming: asg.filter((a) => a.status === 'accepted' && a.date >= today).length,
    fill_rate: recent.length ? recent.filter((j) => j.filled_at).length / recent.length : null,
    spent_30d: asg.filter((a) => a.status === 'completed' && a.date >= last30).reduce((s, a) => s + (a.amount || 0), 0),
    unpaid: asg.filter((a) => a.status === 'completed' && !a.paid).reduce((s, a) => s + (a.amount || 0), 0),
    to_rate: asg.filter((a) => a.status === 'completed' && a.farmer_rating == null).length,
  };
}

function workerProfile(workerId) {
  const w = mustBeWorker(workerId);
  const reviews = all(
    `SELECT a.farmer_rating AS rating, a.farmer_review AS review, j.work_type, j.date, u.name AS farmer
     FROM assignments a JOIN jobs j ON j.id = a.job_id JOIN users u ON u.id = j.farmer_id
     WHERE a.worker_id = ? AND a.farmer_rating IS NOT NULL ORDER BY j.date DESC LIMIT 8`, w.id,
  );
  return { ...matcher.publicWorker(w), available: w.available, available_days: w.available_days, about: w.about, reviews };
}

// Called periodically: jobs that are still open after `minutes` get a wider search round.
function autoEscalate(minutes) {
  const rows = all(
    `SELECT id FROM jobs WHERE status = 'open' AND end_date >= ? AND notify_round < ?
     AND (last_dispatch_at IS NULL OR last_dispatch_at <= datetime('now', ?))`,
    todayStr(), ROUND_RADIUS.length, `-${minutes} minutes`,
  );
  let escalated = 0;
  for (const r of rows) if (dispatch(r.id).length) escalated += 1;
  if (escalated) notifier.broadcast({ event: 'refresh', scope: 'jobs' });
  return escalated;
}

module.exports = {
  ROUND_RADIUS, getJob, mustGetJob, listFarmerJobs, preview, createJob, dispatch, invite, accept, decline, withdraw,
  cancel, checkin, complete, rateWorker, rateFarmer, markPaid, matches, view, workerWork, farmerSummary,
  workerProfile, autoEscalate, normaliseInput,
};
