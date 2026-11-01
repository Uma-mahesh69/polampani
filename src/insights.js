// Decision support for farmers and workers: fair wage, labour supply, seasonal outlook,
// weather on the work date, and platform-wide impact metrics.
const { all, get, hydrateUser } = require('./db');
const config = require('./config');
const {
  WORK_TYPES, CROP_CALENDAR, skillMatch, haversineKm, weekdayOf, todayStr, addDays, parseYmd, datesBetween,
} = require('./catalog');

function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

const workersNear = (lat, lng, km) => all("SELECT * FROM users WHERE role = 'worker'")
  .map(hydrateUser)
  .filter((w) => haversineKm(w.lat, w.lng, lat, lng) <= km);

// Fair-wage suggestion + labour supply forecast for a planned job.
function wageInsight({ work_type, lat, lng, date, duration_days = 1, workers_needed = 1 }) {
  const near = workersNear(lat, lng, 25).filter((w) => skillMatch(w.skills, work_type).value >= 0.55);
  const wages = near.map((w) => w.daily_wage).sort((a, b) => a - b);
  const median = quantile(wages, 0.5) ?? 500;
  const p25 = quantile(wages, 0.25) ?? 450;
  const p75 = quantile(wages, 0.75) ?? 560;
  const start = date || addDays(1);
  const end = addDays(Math.max(1, Number(duration_days) || 1) - 1, start);
  const days = datesBetween(start, end);
  const booked = new Set(all(
    `SELECT a.worker_id FROM assignments a JOIN jobs j ON j.id = a.job_id
     WHERE a.status = 'accepted' AND j.date <= ? AND j.end_date >= ?`, end, start,
  ).map((r) => r.worker_id));
  const supply = near.filter((w) => w.available && !booked.has(w.id)
    && days.some((d) => w.available_days.includes(weekdayOf(d)))).length;
  const need = Math.max(1, Number(workers_needed) || 1);
  const risk = supply >= need * 4 ? 'low' : supply >= need * 2 ? 'medium' : 'high';
  const base = risk === 'high' ? p75 * 1.08 : risk === 'medium' ? p75 : median;
  return {
    suggested_wage: Math.round(base / 10) * 10,
    median_wage: Math.round(median),
    range: [Math.round(p25 / 10) * 10, Math.round(p75 / 10) * 10],
    supply,
    skilled_nearby: near.length,
    risk,
  };
}

// Labour outlook for the next ~3 weeks around a location: seasonal demand from the crop
// calendar blended with jobs already posted, against skilled workers available nearby.
function seasonOutlook({ lat, lng, skills = null }) {
  const today = todayStr();
  const horizon = addDays(21);
  const month = parseYmd(today).getMonth() + 1;
  const nextMonth = (month % 12) + 1;
  const near = workersNear(lat, lng, 30);
  const posted = all(
    "SELECT work_type, workers_needed, lat, lng FROM jobs WHERE status IN ('open','filled') AND date >= ? AND date <= ?",
    today, horizon,
  ).filter((j) => haversineKm(j.lat, j.lng, lat, lng) <= 30);

  return WORK_TYPES.map((w) => {
    const seasonal = Math.max(CROP_CALENDAR[w.id]?.[month] || 0, (CROP_CALENDAR[w.id]?.[nextMonth] || 0) * 0.8);
    const postedNeed = posted.filter((j) => j.work_type === w.id).reduce((s, j) => s + j.workers_needed, 0);
    const skilled = near.filter((x) => x.available && skillMatch(x.skills, w.id).value === 1).length;
    const demand = seasonal * 10 + postedNeed;
    const ratio = demand / Math.max(1, skilled);
    const level = demand < 2 ? 'quiet' : ratio > 1.5 ? 'tight' : ratio > 0.7 ? 'busy' : 'balanced';
    return {
      work_type: w.id,
      seasonal: Math.round(seasonal * 100) / 100,
      posted_workers: postedNeed,
      skilled_workers: skilled,
      level,
      demand_index: Math.round(demand * 10) / 10,
      has_skill: skills ? skills.includes(w.id) : null,
    };
  })
    .filter((o) => o.level !== 'quiet')
    .sort((a, b) => b.demand_index - a.demand_index)
    .slice(0, 5);
}

const minutesBetween = (a, b) => (new Date(`${b.replace(' ', 'T')}Z`) - new Date(`${a.replace(' ', 'T')}Z`)) / 60000;

function impact() {
  const jobs = all('SELECT * FROM jobs');
  const asg = all(
    `SELECT a.status, a.amount, a.paid, j.wage, j.duration_days, j.village FROM assignments a JOIN jobs j ON j.id = a.job_id
     WHERE a.status IN ('accepted', 'completed')`,
  );
  const decided = jobs.filter((j) => j.status !== 'cancelled' && (j.status !== 'open' || j.end_date < todayStr()));
  const filled = jobs.filter((j) => j.filled_at);
  const fillTimes = filled.map((j) => minutesBetween(j.created_at, j.filled_at)).filter((m) => m >= 0).sort((a, b) => a - b);
  const workdays = asg.reduce((s, a) => s + a.duration_days, 0);
  const wagesEarned = asg.filter((a) => a.status === 'completed').reduce((s, a) => s + (a.amount || a.wage * a.duration_days), 0);
  const wagesBooked = asg.filter((a) => a.status === 'accepted').reduce((s, a) => s + a.wage * a.duration_days, 0);

  const byType = WORK_TYPES.map((w) => ({
    work_type: w.id,
    jobs: jobs.filter((j) => j.work_type === w.id).length,
    workers: jobs.filter((j) => j.work_type === w.id).reduce((s, j) => s + j.workers_needed, 0),
  })).filter((r) => r.jobs > 0).sort((a, b) => b.workers - a.workers);

  const days = [];
  for (let i = 13; i >= 0; i -= 1) {
    const d = addDays(-i);
    const dayJobs = jobs.filter((j) => j.created_at.slice(0, 10) === d);
    days.push({
      date: d,
      posted: dayJobs.length,
      filled: dayJobs.filter((j) => j.filled_at).length,
    });
  }

  return {
    jobs_posted: jobs.length,
    jobs_filled: filled.length,
    fill_rate: decided.length ? decided.filter((j) => j.filled_at).length / decided.length : null,
    median_fill_minutes: fillTimes.length ? Math.round(quantile(fillTimes, 0.5)) : null,
    workdays,
    wages_earned: wagesEarned,
    wages_booked: wagesBooked,
    villages: new Set(jobs.map((j) => j.village)).size,
    workers: get("SELECT COUNT(*) AS c FROM users WHERE role = 'worker'").c,
    workers_earning: get("SELECT COUNT(DISTINCT worker_id) AS c FROM assignments WHERE status IN ('accepted','completed')").c,
    farmers: get("SELECT COUNT(*) AS c FROM users WHERE role = 'farmer'").c,
    alerts_sent: get("SELECT COUNT(*) AS c FROM notifications WHERE type IN ('job_match','invite')").c,
    by_type: byType,
    daily: days,
  };
}

// ---- Weather (Open-Meteo, free, no API key) ----
const weatherCache = new Map();
const WMO = (code) => {
  if (code == null) return 'unknown';
  if (code <= 1) return 'clear';
  if (code <= 3) return 'cloudy';
  if (code <= 48) return 'fog';
  if (code <= 67 || (code >= 80 && code <= 82)) return 'rain';
  if (code >= 95) return 'storm';
  return 'cloudy';
};

async function forecast(lat, lng) {
  if (!config.WEATHER) return null;
  const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
  const hit = weatherCache.get(key);
  if (hit && Date.now() - hit.at < 60 * 60 * 1000) return hit.data;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lng.toFixed(3)}`
    + '&daily=weathercode,temperature_2m_max,precipitation_probability_max,precipitation_sum&timezone=Asia%2FKolkata&forecast_days=16';
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    const data = j.daily.time.map((date, i) => ({
      date,
      condition: WMO(j.daily.weathercode[i]),
      tmax: Math.round(j.daily.temperature_2m_max[i]),
      rain_prob: j.daily.precipitation_probability_max[i],
      rain_mm: j.daily.precipitation_sum[i],
    }));
    weatherCache.set(key, { at: Date.now(), data });
    return data;
  } catch {
    weatherCache.set(key, { at: Date.now() - 50 * 60 * 1000, data: null }); // retry in ~10 min
    return null;
  }
}

async function weatherFor(lat, lng, start, end = start) {
  const days = await forecast(lat, lng);
  if (!days) return null;
  const range = days.filter((d) => d.date >= start && d.date <= end);
  if (!range.length) return { available: false, days: [] };
  const wettest = range.reduce((a, b) => ((b.rain_prob ?? 0) > (a.rain_prob ?? 0) ? b : a));
  const hottest = range.reduce((a, b) => (b.tmax > a.tmax ? b : a));
  let advice = 'good';
  if ((wettest.rain_prob ?? 0) >= 70 || wettest.condition === 'storm') advice = 'rain_risk';
  else if ((wettest.rain_prob ?? 0) >= 40) advice = 'rain_possible';
  else if (hottest.tmax >= 38) advice = 'heat';
  return { available: true, days: range, advice };
}

module.exports = { wageInsight, seasonOutlook, impact, weatherFor, forecast };
