// Server-side notification text (used for SMS and as a stored fallback).
// The web client renders the same notification types from structured `data` in the viewer's language.
const { WORK_TYPE_MAP, parseYmd } = require('./catalog');

const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYS_TE = ['ఆది', 'సోమ', 'మంగళ', 'బుధ', 'గురు', 'శుక్ర', 'శని'];

function dateLabel(s, lang) {
  if (!s) return '';
  const d = parseYmd(s);
  return lang === 'te'
    ? `${DAYS_TE[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`
    : `${DAYS_EN[d.getDay()]} ${d.getDate()} ${MONTHS_EN[d.getMonth()]}`;
}
const work = (id, lang) => (WORK_TYPE_MAP[id] ? WORK_TYPE_MAP[id][lang === 'te' ? 'te' : 'en'] : id);
const rupees = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

const T = {
  en: {
    job_match: (d) => `New work: ${work(d.work_type)} at ${d.village}, ${dateLabel(d.date)} ${d.time}. ${rupees(d.wage)}/day, ${d.distance} km away. Open PolamPani to accept.`,
    invite: (d) => `${d.farmer} invited you: ${work(d.work_type)} at ${d.village}, ${dateLabel(d.date)} ${d.time}. ${rupees(d.wage)}/day.`,
    accepted: (d) => `${d.worker} accepted ${work(d.work_type)} on ${dateLabel(d.date)}. ${d.count} of ${d.needed} confirmed.`,
    filled: (d) => `Your ${work(d.work_type)} work on ${dateLabel(d.date)} is fully staffed: ${d.needed} workers confirmed.`,
    escalation: (d) => `Not filled yet, so we alerted ${d.count} more workers up to ${d.radius} km away for ${work(d.work_type)} on ${dateLabel(d.date)}.`,
    no_more: (d) => `No more free workers found for ${work(d.work_type)} on ${dateLabel(d.date)}. Raising the wage can help.`,
    withdrawn: (d) => `${d.worker} cancelled ${work(d.work_type)} on ${dateLabel(d.date)}. We are finding a replacement.`,
    cancelled: (d) => `${d.farmer} cancelled ${work(d.work_type)} on ${dateLabel(d.date)}.${d.reason ? ` Reason: ${d.reason}` : ''}`,
    checked_in: (d) => `${d.worker} has reached the field for ${work(d.work_type)}.`,
    completed: (d) => `${d.farmer} marked ${work(d.work_type)} on ${dateLabel(d.date)} complete. Earned ${rupees(d.amount)}.`,
    paid: (d) => `${d.farmer} paid you ${rupees(d.amount)} by ${d.method === 'upi' ? 'UPI' : 'cash'}.`,
    rated: (d) => `${d.farmer} rated your work ${d.rating} out of 5.`,
    closed: (d) => `${work(d.work_type)} on ${dateLabel(d.date)} is now full. We will alert you for the next one.`,
  },
  te: {
    job_match: (d) => `కొత్త పని: ${work(d.work_type, 'te')}, ${d.village}, ${dateLabel(d.date, 'te')} ${d.time}. రోజుకు ${rupees(d.wage)}, ${d.distance} కి.మీ. ఒప్పుకోవడానికి పొలంపని తెరవండి.`,
    invite: (d) => `${d.farmer} మిమ్మల్ని పిలిచారు: ${work(d.work_type, 'te')}, ${d.village}, ${dateLabel(d.date, 'te')} ${d.time}. రోజుకు ${rupees(d.wage)}.`,
    accepted: (d) => `${d.worker} ${work(d.work_type, 'te')} పనికి ఒప్పుకున్నారు (${dateLabel(d.date, 'te')}). ${d.needed} లో ${d.count} మంది ఖరారు.`,
    filled: (d) => `${dateLabel(d.date, 'te')} ${work(d.work_type, 'te')} పనికి ${d.needed} మంది కూలీలు ఖరారయ్యారు.`,
    escalation: (d) => `ఇంకా నిండలేదు. ${d.radius} కి.మీ. వరకు మరో ${d.count} మందికి తెలియజేశాం.`,
    no_more: (d) => `${dateLabel(d.date, 'te')} ${work(d.work_type, 'te')} పనికి ఖాళీగా ఉన్న కూలీలు దొరకలేదు. కూలి పెంచితే సహాయపడుతుంది.`,
    withdrawn: (d) => `${d.worker} ${dateLabel(d.date, 'te')} పనిని రద్దు చేశారు. మరొకరిని వెతుకుతున్నాం.`,
    cancelled: (d) => `${d.farmer} ${dateLabel(d.date, 'te')} ${work(d.work_type, 'te')} పనిని రద్దు చేశారు.`,
    checked_in: (d) => `${d.worker} పొలానికి చేరుకున్నారు.`,
    completed: (d) => `${d.farmer} పని పూర్తయినట్లు నమోదు చేశారు. మీ సంపాదన ${rupees(d.amount)}.`,
    paid: (d) => `${d.farmer} మీకు ${rupees(d.amount)} చెల్లించారు (${d.method === 'upi' ? 'UPI' : 'నగదు'}).`,
    rated: (d) => `${d.farmer} మీ పనికి 5 కి ${d.rating} రేటింగ్ ఇచ్చారు.`,
    closed: (d) => `${dateLabel(d.date, 'te')} ${work(d.work_type, 'te')} పని నిండిపోయింది. తదుపరి పనికి తెలియజేస్తాం.`,
  },
};

function render(type, data, lang = 'en') {
  const fn = (T[lang] || T.en)[type] || T.en[type];
  return fn ? fn(data) : type;
}

module.exports = { render, dateLabel };
