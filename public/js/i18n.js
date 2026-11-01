// Translation: strings are keyed by their English text, so a missing Telugu entry
// gracefully falls back to English. Parameters use {name} placeholders.
import { state, money, dateShort, timeLabel, weekdayName } from './core.js';
import { TE } from './te.js';

export function t(text, params) {
  let s = state.lang === 'te' ? (TE[text] ?? text) : text;
  if (params) s = s.replace(/\{(\w+)\}/g, (_, k) => (params[k] ?? ''));
  return s;
}

// Plural helper: tn('{n} worker', '{n} workers', n)
export const tn = (one, many, n, params = {}) => t(n === 1 ? one : many, { n, ...params });

export function workName(id, lang = state.lang) {
  const w = state.wt[id];
  if (!w) return id;
  return lang === 'te' ? w.te : w.en;
}
export const workIcon = (id) => state.wt[id]?.icon || '🌾';
export const facilityName = (id) => {
  const f = state.fac[id];
  return f ? (state.lang === 'te' ? f.te : f.en) : id;
};
export const villageName = (name) => {
  const v = state.meta?.villages?.find((x) => x.name === name);
  return v && state.lang === 'te' ? v.te : name;
};

export const STATUS = {
  open: () => t('Finding workers'),
  filled: () => t('Fully staffed'),
  completed: () => t('Completed'),
  cancelled: () => t('Cancelled'),
};

// Match reasons from the AI model, rendered for the person looking at them.
export function reasonText(r, perspective = 'farmer') {
  const you = perspective === 'worker';
  switch (r.code) {
    case 'distance': return you ? t('{km} km from you', { km: r.km }) : t('{km} km away', { km: r.km });
    case 'skill_exact': return you ? t('Matches your skills') : t('Skilled in {work}', { work: workName(r.skill).toLowerCase() });
    case 'skill_related': return t('Related skill: {work}', { work: workName(r.skill).toLowerCase() });
    case 'skill_new': return you ? t('New type of work for you') : t('New to this work');
    case 'days_free':
      if (r.days > 1) return t('Free on all {n} days', { n: r.days });
      return you ? t('{day} is one of your work days', { day: weekdayName(r.day, 'long') }) : t('Usually works on {day}', { day: weekdayName(r.day, 'long') });
    case 'days_partial': return t('Free {free} of {n} days', { free: r.free, n: r.days });
    case 'days_busy': return you ? t('{day} is not one of your work days', { day: weekdayName(r.day, 'long') }) : t('Does not usually work on {day}', { day: weekdayName(r.day, 'long') });
    case 'wage_ok':
      if (you) return r.diff > 0 ? t('{amt} above your daily rate', { amt: money(r.diff) }) : t('Matches your daily rate');
      return t('Asks {amt} a day', { amt: money(r.ask) });
    case 'wage_low':
      return you ? t('{amt} below your daily rate', { amt: money(-r.diff) }) : t('Asks {amt} a day, above your offer', { amt: money(r.ask) });
    case 'reliability': return t('{rating} rating, shows up {show}% of the time', { rating: r.rating, show: r.show });
    case 'rapport': return you ? t('You have worked for this farmer before') : tn('Has worked for you once', 'Has worked for you {n} times', r.count);
    default: return r.code;
  }
}

export const REASON_ICON = {
  distance: 'pin', skill_exact: 'tool', skill_related: 'tool', skill_new: 'tool', days_free: 'calendar',
  days_partial: 'calendar', days_busy: 'calendar', wage_ok: 'rupee', wage_low: 'rupee', reliability: 'star', rapport: 'handshake',
};

// In-app notification text in the viewer's language.
export function notifText(n) {
  const d = n.data || {};
  const w = workName(d.work_type);
  const when = d.date ? dateShort(d.date) : '';
  switch (n.type) {
    case 'job_match': return t('New work near you: {work} at {village}, {when}, {wage} a day', { work: w, village: d.village, when, wage: money(d.wage) });
    case 'invite': return t('{farmer} invited you for {work} on {when}', { farmer: d.farmer, work: w, when });
    case 'accepted': return t('{worker} accepted {work} on {when}. {count} of {needed} confirmed.', { worker: d.worker, work: w, when, count: d.count, needed: d.needed });
    case 'filled': return t('Your {work} work on {when} is fully staffed', { work: w, when });
    case 'escalation': return t('Not filled yet, so {count} more workers up to {km} km away were alerted', { count: d.count, km: d.radius });
    case 'no_more': return t('No more free workers found for {work} on {when}. Raising the wage can help.', { work: w, when });
    case 'withdrawn': return t('{worker} cancelled {work} on {when}. Finding a replacement.', { worker: d.worker, work: w, when });
    case 'cancelled': return t('{farmer} cancelled {work} on {when}', { farmer: d.farmer, work: w, when });
    case 'checked_in': return t('{worker} reached the field', { worker: d.worker });
    case 'completed': return t('{farmer} marked {work} complete. You earned {amt}.', { farmer: d.farmer, work: w, amt: money(d.amount) });
    case 'paid': return t('{farmer} paid you {amt} by {method}', { farmer: d.farmer, amt: money(d.amount), method: d.method === 'upi' ? 'UPI' : t('cash') });
    case 'rated': return t('{farmer} rated your work {n} out of 5', { farmer: d.farmer, n: d.rating });
    default: return n.message;
  }
}

export const NOTIF_ICON = {
  job_match: 'bell', invite: 'mail', accepted: 'check', filled: 'users', escalation: 'radar', no_more: 'alert',
  withdrawn: 'alert', cancelled: 'x', checked_in: 'pin', completed: 'check', paid: 'rupee', rated: 'star',
};

export function speakableJob(job) {
  return t('{work} at {village}. {date}, from {time}. {n} workers needed. {wage} a day.', {
    work: workName(job.work_type), village: job.village, date: dateShort(job.date), time: timeLabel(job.start_time),
    n: job.workers_needed, wage: money(job.wage),
  });
}
