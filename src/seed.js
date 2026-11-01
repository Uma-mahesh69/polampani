// Demo data: farmers and labourers around Visakhapatnam, plus a few live jobs.
// Run `npm run reset` to wipe the database and reseed.
if (require.main === module && process.argv.includes('--reset')) {
  const fs = require('fs');
  const path = require('path');
  const p = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'polampani.db');
  for (const f of [p, `${p}-wal`, `${p}-shm`]) fs.rmSync(f, { force: true });
}

const { get, run } = require('./db');
const { VILLAGES, addDays } = require('./catalog');

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
  ['Ramana Rao', 'Anakapalli'], ['Lakshmi Devi', 'Chodavaram'], ['Appala Naidu', 'Sabbavaram'],
  ['Satyanarayana', 'Bheemunipatnam'], ['Padma', 'Narsipatnam'], ['Venkata Ramana', 'Pendurthi'],
  ['Chinna Rao', 'Yelamanchili'], ['Suryakantham', 'Anandapuram'],
];

const WORKERS = [
  'Ravi', 'Lakshmi', 'Appa Rao', 'Sita', 'Raju', 'Kumari', 'Srinu', 'Durga', 'Nookalu', 'Ramulu',
  'Parvathi', 'Venkatesh', 'Mahalakshmi', 'Govind', 'Annapurna', 'Simhachalam', 'Varalakshmi', 'Prasad',
  'Kanaka', 'Babu Rao', 'Gowri', 'Satish', 'Jhansi', 'Narayana', 'Rama Devi', 'Yesu', 'Pydithalli',
  'Nagaraju', 'Adilakshmi', 'Krishna', 'Bangaramma', 'Suresh', 'Chittemma', 'Demudu', 'Rajeswari',
  'Kondababu', 'Mangamma', 'Tataji', 'Seethamma', 'Ramesh',
];

const REGION_SKILLS = {
  Narsipatnam: ['cashew_picking', 'mango_harvesting'],
  Madugula: ['cashew_picking', 'mango_harvesting'],
  Paderu: ['cashew_picking', 'mango_harvesting'],
  Anakapalli: ['sugarcane_cutting'],
  Chodavaram: ['sugarcane_cutting'],
  Kasimkota: ['sugarcane_cutting'],
  Yelamanchili: ['sugarcane_cutting'],
};
const COMMON = ['paddy_transplanting', 'paddy_harvesting', 'weeding', 'sowing', 'spraying', 'loading', 'irrigation', 'ploughing'];

function insertUser(u) {
  return Number(run(
    `INSERT INTO users (role, name, phone, village, lat, lng, skills, available, available_days, daily_wage, radius_km, rating, jobs_done, lang)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    u.role, u.name, u.phone, u.village, u.lat, u.lng, JSON.stringify(u.skills || []), u.available ? 1 : 0,
    JSON.stringify(u.available_days || [0, 1, 2, 3, 4, 5, 6]), u.daily_wage || 500, u.radius_km || 20,
    u.rating || 4, u.jobs_done || 0, u.lang || 'te',
  ).lastInsertRowid);
}

function seed() {
  const jobs = require('./jobs');
  const rnd = mulberry32(2026);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const jitter = () => (rnd() - 0.5) * 0.05;
  const phone = () => `+91 9${Array.from({ length: 9 }, () => Math.floor(rnd() * 10)).join('')}`;
  const village = (name) => VILLAGES.find((v) => v.name === name);

  const farmerIds = FARMERS.map(([name, vName]) => {
    const v = village(vName);
    return insertUser({ role: 'farmer', name, phone: phone(), village: v.name, lat: v.lat + jitter(), lng: v.lng + jitter() });
  });

  const homeVillages = VILLAGES.filter((v) => !['Paderu', 'Payakaraopeta'].includes(v.name));
  WORKERS.forEach((name, i) => {
    const v = homeVillages[i % homeVillages.length];
    const skills = new Set();
    if (REGION_SKILLS[v.name] && rnd() < 0.8) skills.add(pick(REGION_SKILLS[v.name]));
    while (skills.size < 2 + Math.floor(rnd() * 3)) skills.add(pick(COMMON));
    const days = [0, 1, 2, 3, 4, 5, 6].filter(() => rnd() > 0.18);
    insertUser({
      role: 'worker',
      name,
      phone: phone(),
      village: v.name,
      lat: v.lat + jitter(),
      lng: v.lng + jitter(),
      skills: [...skills],
      available: rnd() > 0.1,
      available_days: days.length >= 3 ? days : [1, 2, 3, 4, 5, 6],
      daily_wage: 400 + 25 * Math.floor(rnd() * 10),
      radius_km: pick([10, 15, 20, 25, 30]),
      rating: Math.round((3.6 + rnd() * 1.4) * 10) / 10,
      jobs_done: Math.floor(rnd() * 60),
    });
  });

  const specs = [
    { f: 0, work_type: 'paddy_transplanting', days: 1, workers: 6, wage: 550, time: '06:30', accept: 2, description: 'Transplanting in 2 acres of wet field near the canal. Lunch provided.' },
    { f: 1, work_type: 'sugarcane_cutting', days: 2, workers: 8, wage: 600, time: '06:00', accept: 0, description: 'Sugarcane harvest for sugar factory delivery. Tractor available for loading.' },
    { f: 4, work_type: 'cashew_picking', days: 3, workers: 4, wage: 500, time: '07:00', accept: 1, description: 'Cashew orchard, 5 acres. Women workers welcome.' },
    { f: 3, work_type: 'weeding', days: 1, workers: 3, wage: 450, time: '07:30', accept: 0, description: 'Weeding in groundnut field.' },
  ];
  for (const s of specs) {
    const farmer = get('SELECT * FROM users WHERE id = ?', farmerIds[s.f]);
    const { job } = jobs.createJob({
      farmer_id: farmer.id, work_type: s.work_type, village: farmer.village,
      lat: farmer.lat + 0.01, lng: farmer.lng - 0.01, date: addDays(s.days),
      start_time: s.time, workers_needed: s.workers, wage: s.wage, description: s.description,
    });
    const top = jobs.matches(job.id).candidates.filter((c) => c.status === 'alerted').slice(0, s.accept);
    for (const c of top) jobs.accept(job.id, c.worker.id, { learn: false });
  }
  return { farmers: farmerIds.length, workers: WORKERS.length, jobs: specs.length };
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
