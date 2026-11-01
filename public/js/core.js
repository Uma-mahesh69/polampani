// Core: state, API client, live event stream, formatting helpers.
export const state = {
  me: null,
  token: localStorage.getItem('pp_token'),
  meta: null,
  lang: localStorage.getItem('pp_lang') || (navigator.language?.startsWith('te') ? 'te' : 'en'),
  unread: 0,
  wt: {},
  fac: {},
};

// ---------- tiny event bus ----------
const listeners = new Map();
export function on(evt, fn) {
  if (!listeners.has(evt)) listeners.set(evt, new Set());
  listeners.get(evt).add(fn);
  return () => listeners.get(evt)?.delete(fn);
}
export function emit(evt, data) {
  for (const fn of listeners.get(evt) || []) {
    try { fn(data); } catch (e) { console.error(e); }
  }
}

// ---------- API ----------
export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function api(path, { method = 'GET', body, signal } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  let res;
  try {
    res = await fetch(`/api${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, signal });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new ApiError(0, navigator.onLine ? 'Could not reach PolamPani. Check your connection and try again.' : 'You are offline. Connect to the internet and try again.');
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && state.token) emit('unauthorized');
  if (!res.ok) throw new ApiError(res.status, data.error || res.statusText);
  return data;
}

export function setSession(token, user) {
  state.token = token;
  state.me = user;
  if (token) localStorage.setItem('pp_token', token);
  else localStorage.removeItem('pp_token');
}

export function setLang(lang) {
  state.lang = lang;
  localStorage.setItem('pp_lang', lang);
  document.documentElement.lang = lang;
}

// ---------- live stream ----------
let es = null;
let retry = 0;
export function connectStream() {
  disconnectStream();
  if (!state.token) return;
  es = new EventSource(`/api/stream?token=${encodeURIComponent(state.token)}`);
  es.onopen = () => { retry = 0; emit('stream', 'open'); };
  es.onmessage = (e) => {
    let d;
    try { d = JSON.parse(e.data); } catch { return; }
    if (d.event === 'notification') emit('notification', d.notification);
    emit('refresh', d.scope || 'all');
  };
  es.onerror = () => {
    emit('stream', 'error');
    if (es?.readyState === EventSource.CLOSED) {
      retry += 1;
      setTimeout(connectStream, Math.min(30000, 1000 * 2 ** retry));
    }
  };
}
export function disconnectStream() {
  if (es) { es.close(); es = null; }
}

// ---------- helpers ----------
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

export function debounce(fn, ms = 250) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

const locale = () => (state.lang === 'te' ? 'te-IN' : 'en-IN');
export const num = (n) => Number(n || 0).toLocaleString('en-IN');
export const money = (n) => `₹${num(n)}`;
export const pct = (v) => (v == null ? '–' : `${Math.round(v * 100)}%`);

export function parseYmd(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export const today = () => ymd(new Date());
export function addDays(n, from = new Date()) {
  const d = typeof from === 'string' ? parseYmd(from) : new Date(from);
  d.setDate(d.getDate() + n);
  return ymd(d);
}
export const daysUntil = (s) => Math.round((parseYmd(s) - parseYmd(today())) / 86400000);

export function dateParts(s) {
  const d = parseYmd(s);
  return {
    day: String(d.getDate()).padStart(2, '0'),
    month: new Intl.DateTimeFormat(locale(), { month: 'short' }).format(d),
    weekday: new Intl.DateTimeFormat(locale(), { weekday: 'short' }).format(d),
  };
}
export const dateShort = (s) => new Intl.DateTimeFormat(locale(), { weekday: 'short', day: 'numeric', month: 'short' }).format(parseYmd(s));
export const dateLong = (s) => new Intl.DateTimeFormat(locale(), { weekday: 'long', day: 'numeric', month: 'long' }).format(parseYmd(s));
export const weekdayName = (i, style = 'short') => new Intl.DateTimeFormat(locale(), { weekday: style }).format(new Date(2024, 0, 7 + i));

export function timeLabel(hhmm) {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  const mm = String(m).padStart(2, '0');
  if (state.lang === 'te') {
    const part = h < 12 ? 'ఉదయం' : h < 16 ? 'మధ్యాహ్నం' : h < 19 ? 'సాయంత్రం' : 'రాత్రి';
    return `${part} ${h % 12 || 12}:${mm}`;
  }
  return `${h % 12 || 12}:${mm} ${h < 12 ? 'am' : 'pm'}`;
}

export function sqlDate(ts) {
  return new Date(`${String(ts).replace(' ', 'T')}Z`);
}
export function relTime(ts) {
  const d = sqlDate(ts);
  const s = (d.getTime() - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' });
  const abs = Math.abs(s);
  if (abs < 45) return rtf.format(0, 'second');
  if (abs < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(s / 3600), 'hour');
  if (abs < 86400 * 7) return rtf.format(Math.round(s / 86400), 'day');
  return new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short' }).format(d);
}
export const clockTime = (ts) => new Intl.DateTimeFormat(locale(), { hour: 'numeric', minute: '2-digit' }).format(sqlDate(ts));

export function phoneLabel(p) {
  const d = String(p || '').replace(/\D/g, '').slice(-10);
  return d.length === 10 ? `+91 ${d.slice(0, 5)} ${d.slice(5)}` : p || '';
}
export const telHref = (p) => `tel:${String(p || '').replace(/[^\d+]/g, '')}`;
export const waHref = (p, text = '') => `https://wa.me/${String(p || '').replace(/\D/g, '')}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
export const mapsHref = (lat, lng) => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;

export function greetingKey() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}
