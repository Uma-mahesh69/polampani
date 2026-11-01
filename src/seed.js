// Demo data: farmers and labourers around Visakhapatnam, 30 days of simulated history,
// and live jobs in different states. Run `npm run reset` to wipe and reseed.
//
// The matching model is trained on *simulated* worker responses: each historical alert is
// answered according to a hidden behaviour profile (workers here care more about distance
// and wage than the model's priors assume). This demonstrates the online learning loop; in
// production the same loop runs on real accepts, declines and no-shows.
require('./runtime');

let resetRequested = require.main === module && process.argv.includes('--reset');
if (resetRequested) {
  const fs = require('fs');
  const { DB_PATH } = require('./config');
  let fileDeleted = false;
  try {
    for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) fs.rmSync(f, { force: true });
    fileDeleted = true;
  } catch (e) { /* fall back to database table wipe */ }
}
const { db, get, run, tx, hydrateUser, kvSet, SCHEMA } = require('./db');
if (resetRequested) {
  db.exec('PRAGMA foreign_keys = OFF');
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
  for (const t of tables) db.exec(`DROP TABLE IF EXISTS "${t.name}"`);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
}
const { VILLAGE_MAP, VILLAGES, CROP_CALENDAR, WORK_TYPE_MAP, addDays, endDateOf, todayStr, parseYmd } = require('./catalog');

function mulberry32(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FARMERS = [
  ['Ramana Rao Gorle', 'Anakapalli'], ['Lakshmi Devi Peela', 'Chodavaram'], ['Appala Naidu Bonda', 'Sabbavaram'],
  ['Satyanarayana Karri', 'Bheemunipatnam'], ['Padma Allu', 'Narsipatnam'], ['Venkata Ramana Dadi', 'Pendurthi'],
  ['Chinna Rao Budi', 'Yelamanchili'], ['Suryakantham Gandi', 'Anandapuram'], ['Nooka Raju Pilla', 'Kasimkota'],
  ['Annapurna Vasa', 'Paravada'],
];

const WORKERS = [
  'Ravi Kumar', 'Lakshmi', 'Appa Rao', 'Sita', 'Raju', 'Kumari', 'Srinu', 'Durga', 'Nookalu', 'Ramulu',
  'Parvathi', 'Venkatesh', 'Mahalakshmi', 'Govind', 'Annapurna', 'Simhachalam', 'Varalakshmi', 'Prasad',
  'Kanaka Durga', 'Babu Rao', 'Gowri', 'Satish', 'Jhansi', 'Narayana', 'Rama Devi', 'Yesu Babu', 'Pydithalli',
  'Nagaraju', 'Adilakshmi', 'Krishna', 'Bangaramma', 'Suresh', 'Chittemma', 'Demudu', 'Rajeswari',
  'Kondababu', 'Mangamma', 'Tataji', 'Seethamma', 'Ramesh', 'Eswara Rao', 'Padmavathi', 'Sanyasi Rao',
  'Kamala', 'Gangaraju', 'Jyothi', 'Apparao Dola', 'Rajyalakshmi', 'Ganesh', 'Sarojini', 'Lova Raju',
  'Neelaveni', 'Chandra Rao', 'Satyavathi', 'Mohan', 'Bhavani', 'Ramana', 'Sunitha', 'Kesava', 'Ammaji',
];

const REGION_SKILLS = {
  Narsipatnam: ['cashew_picking', 'mango_harvesting'],
  Madugula: ['cashew_picking', 'mango_harvesting'],
  Anakapalli: ['sugarcane_cutting'],
  Chodavaram: ['sugarcane_cutting'],
  Kasimkota: ['sugarcane_cutting'],
  Yelamanchili: ['sugarcane_cutting', 'paddy_harvesting'],
};
const COMMON = ['paddy_transplanting', 'paddy_harvesting', 'weeding', 'sowing', 'spraying', 'loading', 'irrigation', 'ploughing'];

const sqlTime = (date, hour, minute = 0) => {
  const d = parseYmd(date);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString().slice(0, 19).replace('T', ' ');
};
const plusMinutes = (sql, m) => new Date(new Date(`${sql.replace(' ', 'T')}Z`).getTime() + m * 60000).toISOString().slice(0, 19).replace('T', ' ');

function insertUser(u) {
  return Number(run(
    `INSERT INTO users (role, name, phone, village, lat, lng, skills, available, available_days, daily_wage, radius_km,
                        rating, rating_count, jobs_done, no_shows, upi_id, lang, verified, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now', '-60 days'))`,
    u.role, u.name, u.phone, u.village, u.lat, u.lng, JSON.stringify(u.skills || []), u.available === false ? 0 : 1,
    JSON.stringify(u.available_days || [0, 1, 2, 3, 4, 5, 6]), u.daily_wage || 500, u.radius_km || 20,
    u.rating ?? 4.2, u.rating_count || 0, u.jobs_done || 0, u.no_shows || 0, u.upi_id || null, u.lang || 'te',
  ).lastInsertRowid);
}

function seed() {
  const jobs = require('./jobs');
  const matcher = require('./matcher');
  const rnd = mulberry32(2026);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const jitter = () => (rnd() - 0.5) * 0.05;
  const sigmoid = (z) => 1 / (1 + Math.exp(-z));
  const today = todayStr();
  matcher.resetModel();

  // ---- people ----
  const farmerIds = FARMERS.map(([name, vName], i) => {
    const v = VILLAGE_MAP[vName];
    return insertUser({
      role: 'farmer', name, phone: `+9198765000${String(i + 1).padStart(2, '0')}`, village: v.name,
      lat: v.lat + jitter(), lng: v.lng + jitter(), rating: Math.round((4 + rnd()) * 10) / 10, rating_count: 5 + Math.floor(rnd() * 20),
    });
  });

  const homes = VILLAGES.filter((v) => !['Paderu', 'Payakaraopeta'].includes(v.name));
  WORKERS.forEach((name, i) => {
    const v = homes[i % homes.length];
    const skills = new Set();
    if (REGION_SKILLS[v.name] && rnd() < 0.8) skills.add(pick(REGION_SKILLS[v.name]));
    while (skills.size < 2 + Math.floor(rnd() * 3)) skills.add(pick(COMMON));
    const days = [0, 1, 2, 3, 4, 5, 6].filter(() => rnd() > 0.15);
    const done = Math.floor(rnd() * 50);
    insertUser({
      role: 'worker', name, phone: `+91900000${String(i + 1).padStart(4, '0')}`, village: v.name,
      lat: v.lat + jitter(), lng: v.lng + jitter(), skills: [...skills], available: rnd() > 0.08,
      available_days: days.length >= 3 ? days : [1, 2, 3, 4, 5, 6],
      daily_wage: 425 + 25 * Math.floor(rnd() * 8), radius_km: pick([10, 15, 20, 20, 25, 30]),
      rating: Math.round((3.7 + rnd() * 1.3) * 10) / 10, rating_count: Math.floor(done * 0.6), jobs_done: done,
      no_shows: rnd() < 0.2 ? 1 + Math.floor(rnd() * 3) : 0,
      upi_id: rnd() < 0.55 ? `${name.split(' ')[0].toLowerCase()}${i + 1}@ybl` : null,
    });
  });

  // ---- 30 days of history (simulated) ----
  const hidden = (x) => sigmoid(-7.4 + 4.2 * x.proximity + 1.5 * x.skill + 2.6 * x.availability + 3.2 * x.wage
    + 0.6 * x.reliability + 0.2 * x.experience + 1.6 * x.rapport);
  const month = parseYmd(today).getMonth() + 1;
  const seasonal = Object.entries(CROP_CALENDAR).map(([id, m]) => [id, (m[month] || 0) + (m[((month + 10) % 12) + 1] || 0) * 0.6 + 0.08]);
  const pickWork = () => {
    const total = seasonal.reduce((s, [, w]) => s + w, 0);
    let r = rnd() * total;
    for (const [id, w] of seasonal) { r -= w; if (r <= 0) return id; }
    return seasonal[0][0];
  };

  let historyCount = 0;
  for (let back = 30; back >= 2; back -= 1) {
    const perDay = rnd() < 0.45 ? 2 : 1;
    for (let k = 0; k < perDay; k += 1) {
      const fIdx = back <= 6 && k === 0 && back % 2 === 0 ? 0 : Math.floor(rnd() * farmerIds.length);
      const farmer = hydrateUser(get('SELECT * FROM users WHERE id = ?', farmerIds[fIdx]));
      const work_type = pickWork();
      const date = addDays(-back);
      const duration = rnd() < 0.3 ? 2 + Math.floor(rnd() * 2) : 1;
      const end = endDateOf(date, duration);
      if (end >= today) continue;
      const need = 2 + Math.floor(rnd() * 7);
      const wage = 450 + 25 * Math.floor(rnd() * 8);
      const created = plusMinutes(sqlTime(addDays(-(1 + Math.floor(rnd() * 3)), date), 7 + Math.floor(rnd() * 12)), 0);
      const facilities = ['meals', 'tea', 'transport'].filter(() => rnd() < 0.4);
      const jobId = Number(run(
        `INSERT INTO jobs (farmer_id, work_type, description, village, lat, lng, date, end_date, duration_days, start_time,
                           workers_needed, wage, facilities, status, notify_round, last_dispatch_at, created_at)
         VALUES (?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', 1, ?, ?)`,
        farmer.id, work_type, farmer.village, farmer.lat + jitter() / 3, farmer.lng + jitter() / 3, date, end, duration,
        pick(['06:00', '06:30', '07:00', '07:30']), need, wage, JSON.stringify(facilities), created, created,
      ).lastInsertRowid);
      const job = { id: jobId, farmer_id: farmer.id, work_type, lat: farmer.lat, lng: farmer.lng, date, end_date: end, wage };
      run("INSERT INTO job_events (job_id, type, data, created_at) VALUES (?, 'posted', ?, ?)", jobId, JSON.stringify({ workers: need, wage }), created);

      const ranked = matcher.rankWorkersForJob(job, { radiusMult: 1.3 });
      const batch = ranked.slice(0, Math.max(4, Math.round(need * 2.5)));
      run("INSERT INTO job_events (job_id, type, data, created_at) VALUES (?, 'alerted', ?, ?)", jobId,
        JSON.stringify({ round: 1, count: batch.length, radius: 20 }), plusMinutes(created, 1));
      let accepted = 0;
      let minute = 3;
      tx(() => {
        for (const c of batch) {
          const full = accepted >= need;
          const y = full ? null : (rnd() < hidden(c.x) ? 1 : 0);
          minute += 2 + Math.floor(rnd() * 25);
          const at = plusMinutes(created, minute);
          run(
            `INSERT INTO notifications (user_id, job_id, type, data, message, score, features, responded, read, created_at)
             VALUES (?, ?, 'job_match', ?, ?, ?, ?, ?, 1, ?)`,
            c.worker.id, jobId,
            JSON.stringify({ work_type, village: farmer.village, date, end_date: end, days: duration, time: '07:00', wage, distance: c.distance }),
            `${WORK_TYPE_MAP[work_type].en} at ${farmer.village}`, c.score, JSON.stringify(c.x),
            y === 1 ? 'accepted' : y === 0 ? 'declined' : 'closed', plusMinutes(created, 1),
          );
          if (y == null) continue;
          matcher.learn(c.x, y);
          if (y === 1) {
            accepted += 1;
            const noShow = rnd() < 0.05;
            const amount = wage * duration;
            const paid = !noShow && (fIdx !== 0 || back > 3) && rnd() < 0.97;
            const rated = !noShow && (fIdx !== 0 || back > 3) && rnd() < 0.95;
            run(
              `INSERT INTO assignments (job_id, worker_id, status, checked_in_at, farmer_rating, worker_rating, amount, paid, paid_at, pay_method, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              jobId, c.worker.id, noShow ? 'no_show' : 'completed', noShow ? null : sqlTime(date, 6, Math.floor(rnd() * 50)),
              rated ? 3 + Math.floor(rnd() * 3) : null, !noShow && rnd() < 0.6 ? 4 + Math.floor(rnd() * 2) : null,
              noShow ? null : amount, paid ? 1 : 0, paid ? sqlTime(end, 18) : null, paid ? (rnd() < 0.5 ? 'upi' : 'cash') : null, at,
            );
            run("INSERT INTO job_events (job_id, type, data, created_at) VALUES (?, 'accepted', ?, ?)", jobId, JSON.stringify({ worker: c.worker.name, worker_id: c.worker.id }), at);
            if (noShow) {
              run('UPDATE users SET no_shows = no_shows + 1 WHERE id = ?', c.worker.id);
              matcher.learn(c.x, 0);
            } else {
              run('UPDATE users SET jobs_done = jobs_done + 1 WHERE id = ?', c.worker.id);
            }
            if (accepted === need) {
              run('UPDATE jobs SET filled_at = ? WHERE id = ?', at, jobId);
              run("INSERT INTO job_events (job_id, type, data, created_at) VALUES (?, 'filled', ?, ?)", jobId, JSON.stringify({ workers: need }), at);
            }
          }
        }
        run('UPDATE jobs SET completed_at = ? WHERE id = ?', sqlTime(end, 18), jobId);
        run("INSERT INTO job_events (job_id, type, data, created_at) VALUES (?, 'completed', ?, ?)", jobId, JSON.stringify({ present: accepted }), sqlTime(end, 18));
      });
      historyCount += 1;
    }
  }

  // ---- live jobs in different states ----
  const farmer = (i) => hydrateUser(get('SELECT * FROM users WHERE id = ?', farmerIds[i]));
  const live = [
    { f: 0, work_type: 'paddy_harvesting', days: 0, duration: 3, workers: 5, wage: 600, time: '06:30', facilities: ['meals', 'tea'], accept: 5, checkin: 3, description: 'BPT 5204 paddy, 3 acres near the canal. Bring your own sickle.' },
    { f: 0, work_type: 'loading', days: 3, duration: 1, workers: 4, wage: 550, time: '08:00', facilities: ['tea'], accept: 1, description: 'Loading paddy bags onto the lorry for the rice mill.' },
    { f: 1, work_type: 'sugarcane_cutting', days: 2, duration: 2, workers: 8, wage: 650, time: '06:00', facilities: ['meals', 'transport'], accept: 3, description: 'Cane for the Chodavaram sugar factory. Tractor pick-up from the village centre at 5:30.' },
    { f: 4, work_type: 'cashew_picking', days: 3, duration: 1, workers: 4, wage: 500, time: '07:00', facilities: [], accept: 0, description: 'Cashew orchard, 5 acres on the hill road.' },
    { f: 3, work_type: 'weeding', days: 1, duration: 1, workers: 3, wage: 475, time: '07:30', facilities: ['tea'], accept: 1, description: 'Weeding in a groundnut field.' },
    { f: 2, work_type: 'sowing', days: 4, duration: 2, workers: 5, wage: 500, time: '07:00', facilities: ['meals'], accept: 0, description: 'Black gram sowing after paddy harvest.' },
    { f: 8, work_type: 'paddy_harvesting', days: 5, duration: 2, workers: 6, wage: 575, time: '06:30', facilities: ['meals'], accept: 2, description: '' },
  ];
  for (const s of live) {
    const f = farmer(s.f);
    const { job } = jobs.createJob(f, {
      work_type: s.work_type, village: f.village, lat: f.lat + 0.006, lng: f.lng - 0.006, date: addDays(s.days),
      duration_days: s.duration, start_time: s.time, workers_needed: s.workers, wage: s.wage, facilities: s.facilities,
      description: s.description,
    }, { silent: true });
    const ranked = jobs.matches(job.id, f).filter((c) => c.status === 'alerted');
    let accepted = 0;
    for (const c of ranked) {
      if (accepted >= s.accept) break;
      try { jobs.accept(job.id, c.worker.id, { learn: false }); accepted += 1; } catch { /* clash, try next */ }
    }
    if (s.accept > accepted) {
      for (const c of jobs.matches(job.id, f).filter((x) => !x.status)) {
        if (accepted >= s.accept) break;
        try { jobs.accept(job.id, c.worker.id, { learn: false }); accepted += 1; } catch { /* next */ }
      }
    }
    if (s.checkin) {
      const crew = jobs.getJob(job.id).crew.slice(0, s.checkin);
      for (const w of crew) jobs.checkin(job.id, w.id);
    }
  }
  run('UPDATE notifications SET read = 1 WHERE user_id IN (SELECT id FROM users WHERE role = \'farmer\') AND id NOT IN (SELECT id FROM notifications ORDER BY id DESC LIMIT 6)');
  kvSet('seeded_on', today);
  return { farmers: farmerIds.length, workers: WORKERS.length, jobs: historyCount + live.length };
}

function seedIfEmpty() {
  if (get('SELECT COUNT(*) AS c FROM users').c > 0) return null;
  return seed();
}

module.exports = { seed, seedIfEmpty };

if (require.main === module) {
  const r = seedIfEmpty();
  console.log(r ? `Seeded ${r.farmers} farmers, ${r.workers} workers, ${r.jobs} jobs.` : 'Database already has data (use --reset).');
}
