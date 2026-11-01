// Static domain data: work types, facilities, crop calendar, villages around Visakhapatnam,
// plus geo and date helpers shared by the server.

const WORK_TYPES = [
  { id: 'paddy_transplanting', en: 'Paddy transplanting', te: 'వరి నాట్లు', icon: '🌱', groups: ['paddy', 'field'] },
  { id: 'paddy_harvesting', en: 'Paddy harvesting', te: 'వరి కోతలు', icon: '🌾', groups: ['paddy', 'harvest'] },
  { id: 'weeding', en: 'Weeding', te: 'కలుపు తీయడం', icon: '🌿', groups: ['paddy', 'field'] },
  { id: 'sowing', en: 'Sowing', te: 'విత్తనాలు వేయడం', icon: '🫘', groups: ['paddy', 'field'] },
  { id: 'spraying', en: 'Pesticide spraying', te: 'మందు పిచికారీ', icon: '💦', groups: ['field', 'machine'] },
  { id: 'sugarcane_cutting', en: 'Sugarcane cutting', te: 'చెరకు నరకడం', icon: '🎋', groups: ['harvest'] },
  { id: 'cashew_picking', en: 'Cashew picking', te: 'జీడి పిక్కలు ఏరడం', icon: '🌰', groups: ['harvest', 'orchard'] },
  { id: 'mango_harvesting', en: 'Mango harvesting', te: 'మామిడి కోత', icon: '🥭', groups: ['harvest', 'orchard'] },
  { id: 'ploughing', en: 'Ploughing / tractor', te: 'దుక్కి దున్నడం', icon: '🚜', groups: ['machine'] },
  { id: 'irrigation', en: 'Irrigation work', te: 'నీటి పారుదల పని', icon: '💧', groups: ['field', 'machine'] },
  { id: 'loading', en: 'Loading / unloading', te: 'బస్తాలు ఎత్తడం', icon: '📦', groups: ['harvest', 'general'] },
];
const WORK_TYPE_MAP = Object.fromEntries(WORK_TYPES.map((w) => [w.id, w]));

const FACILITIES = [
  { id: 'meals', en: 'Lunch provided', te: 'భోజనం ఇస్తారు' },
  { id: 'tea', en: 'Tea and snacks', te: 'టీ, టిఫిన్' },
  { id: 'transport', en: 'Pick-up provided', te: 'వాహనం ఏర్పాటు' },
  { id: 'tools', en: 'Tools provided', te: 'పనిముట్లు ఇస్తారు' },
];
const FACILITY_IDS = new Set(FACILITIES.map((f) => f.id));

// Relative labour demand by month (1-12) for coastal Andhra (Visakhapatnam / Anakapalli).
// Kharif paddy: transplanting Jul-Aug, harvest Oct-Dec. Rabi: Dec-Jan transplant, Mar-Apr harvest.
// Sugarcane crushing season Dec-Mar, cashew Mar-May, mango Apr-Jun.
const CROP_CALENDAR = {
  paddy_transplanting: { 6: 0.4, 7: 1, 8: 0.9, 9: 0.3, 12: 0.6, 1: 0.7 },
  paddy_harvesting: { 10: 0.6, 11: 1, 12: 0.8, 3: 0.4, 4: 0.7 },
  weeding: { 8: 0.8, 9: 1, 10: 0.4, 1: 0.6, 2: 0.6 },
  sowing: { 6: 0.9, 7: 0.6, 11: 0.5, 12: 0.6 },
  spraying: { 8: 0.6, 9: 0.8, 10: 0.7, 1: 0.5, 2: 0.5 },
  sugarcane_cutting: { 12: 0.8, 1: 1, 2: 1, 3: 0.8, 4: 0.4, 11: 0.3 },
  cashew_picking: { 3: 0.7, 4: 1, 5: 0.9 },
  mango_harvesting: { 4: 0.7, 5: 1, 6: 0.6 },
  ploughing: { 5: 0.7, 6: 1, 7: 0.5, 11: 0.5, 12: 0.4 },
  irrigation: { 1: 0.5, 2: 0.6, 3: 0.7, 4: 0.6 },
  loading: { 11: 0.6, 12: 0.7, 1: 0.8, 2: 0.7, 4: 0.5 },
};

// Approximate coordinates of farming villages / mandals around Visakhapatnam.
const VILLAGES = [
  { name: 'Anakapalli', te: 'అనకాపల్లి', lat: 17.6913, lng: 83.0039, aliases: ['anakapalle'] },
  { name: 'Bheemunipatnam', te: 'భీమునిపట్నం', lat: 17.89, lng: 83.45, aliases: ['bheemili', 'bhimili', 'భీమిలి'] },
  { name: 'Tagarapuvalasa', te: 'తగరపువలస', lat: 17.933, lng: 83.426, aliases: [] },
  { name: 'Anandapuram', te: 'ఆనందపురం', lat: 17.897, lng: 83.374, aliases: [] },
  { name: 'Padmanabham', te: 'పద్మనాభం', lat: 17.985, lng: 83.333, aliases: [] },
  { name: 'Pendurthi', te: 'పెందుర్తి', lat: 17.8, lng: 83.205, aliases: [] },
  { name: 'Sabbavaram', te: 'సబ్బవరం', lat: 17.79, lng: 83.123, aliases: [] },
  { name: 'Simhachalam', te: 'సింహాచలం', lat: 17.766, lng: 83.25, aliases: [] },
  { name: 'Kothavalasa', te: 'కొత్తవలస', lat: 18.05, lng: 83.17, aliases: [] },
  { name: 'Chodavaram', te: 'చోడవరం', lat: 17.83, lng: 82.94, aliases: [] },
  { name: 'Madugula', te: 'మాడుగుల', lat: 17.917, lng: 82.81, aliases: [] },
  { name: 'Kasimkota', te: 'కశింకోట', lat: 17.673, lng: 82.964, aliases: [] },
  { name: 'Paravada', te: 'పరవాడ', lat: 17.628, lng: 83.079, aliases: [] },
  { name: 'Atchutapuram', te: 'అచ్యుతాపురం', lat: 17.56, lng: 82.98, aliases: ['achutapuram'] },
  { name: 'Yelamanchili', te: 'ఎలమంచిలి', lat: 17.55, lng: 82.85, aliases: ['elamanchili', 'yellamanchili'] },
  { name: 'Narsipatnam', te: 'నర్సీపట్నం', lat: 17.668, lng: 82.613, aliases: ['narasipatnam'] },
  { name: 'Payakaraopeta', te: 'పాయకరావుపేట', lat: 17.36, lng: 82.56, aliases: [] },
  { name: 'Paderu', te: 'పాడేరు', lat: 18.08, lng: 82.67, aliases: [] },
];
const VILLAGE_MAP = Object.fromEntries(VILLAGES.map((v) => [v.name, v]));

function skillMatch(skills, workType) {
  const target = WORK_TYPE_MAP[workType];
  let value = 0.15;
  let best = null;
  for (const s of skills || []) {
    if (s === workType) return { value: 1, best: s };
    const w = WORK_TYPE_MAP[s];
    if (w && target && value < 0.55 && w.groups.some((g) => target.groups.includes(g))) {
      value = 0.55;
      best = s;
    }
  }
  return { value, best };
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function nearestVillage(lat, lng) {
  let best = VILLAGES[0];
  let bestD = Infinity;
  for (const v of VILLAGES) {
    const d = haversineKm(lat, lng, v.lat, v.lng);
    if (d < bestD) { bestD = d; best = v; }
  }
  return best;
}

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayStr = () => ymd(new Date());
function parseYmd(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, m - 1, d);
}
function addDays(n, from = new Date()) {
  const d = typeof from === 'string' ? parseYmd(from) : new Date(from);
  d.setDate(d.getDate() + n);
  return ymd(d);
}
const endDateOf = (date, days) => addDays(Math.max(1, days) - 1, date);
const weekdayOf = (s) => parseYmd(s).getDay();
function datesBetween(start, end) {
  const out = [];
  for (let d = start; d <= end && out.length < 60; d = addDays(1, d)) out.push(d);
  return out;
}
const round1 = (n) => Math.round(n * 10) / 10;
const sqlNow = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

module.exports = {
  WORK_TYPES, WORK_TYPE_MAP, FACILITIES, FACILITY_IDS, CROP_CALENDAR, VILLAGES, VILLAGE_MAP,
  skillMatch, haversineKm, nearestVillage, ymd, todayStr, parseYmd, addDays, endDateOf, weekdayOf,
  datesBetween, round1, sqlNow,
};
