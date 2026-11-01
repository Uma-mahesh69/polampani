// UI kit: icons, the work chit, small components, toasts, dialogs, read-aloud.
import { state, esc, dateParts, timeLabel, money, relTime, daysUntil } from './core.js';
import { t, tn, workName, workIcon, villageName, STATUS, reasonText, REASON_ICON, facilityName } from './i18n.js';

// ---------- icons (24px grid, 2px stroke) ----------
const P = {
  home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  briefcase: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  rupee: '<path d="M6 3h12M6 8h12M6 13l8.5 8M6 13h3M9 13c6.67 0 6.67-10 0-10"/>',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>',
  chat: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3"/>',
  volume: '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14"/>',
  sparkle: '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  rain: '<path d="M4 14.9A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 2.5 8.2"/><path d="M16 14v6M8 14v6M12 16v6"/>',
  cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
  star: '<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>',
  nav: '<path d="m3 11 19-9-9 19-2-8-8-2z"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.59 13.51 6.83 3.98M15.41 6.51l-6.82 3.98"/>',
  trend: '<path d="m22 7-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/><path d="m9 12 2 2 4-4"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  lang: '<path d="m5 8 6 6M4 14l6-6 2-3M2 5h12M7 2h1M22 22l-5-10-5 10M14 18h6"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  login: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"/>',
  radar: '<path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5M19.1 4.9C23 8.8 23 15.1 19.1 19"/><circle cx="12" cy="12" r="2"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  wallet: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
  more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  locate: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2"/>',
  edit: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
  chart: '<path d="M3 3v18h18"/><path d="M18 17V9M13 17V5M8 17v-3"/>',
  github: '<path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.4 5.4 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/><path d="M9 18c-4.51 2-5-2-7-2"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  external: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  tool: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  handshake: '<path d="m11 17 2 2a1 1 0 1 0 3-3"/><path d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4"/><path d="m21 3 1 11h-2M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3M3 4h8"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7"/>',
  sprout: '<path d="M7 20h10M12 20V10"/><path d="M12 10C12 6 9.5 3.5 5 3.5 5 8 7.5 10 12 10Z"/><path d="M12 13c0-3.5 2.5-6 7-6 0 4-2.5 6-7 6Z"/>',
  layers: '<path d="m12 2 10 5-10 5L2 7Z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/>',
};
export const icon = (name, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || P.info}</svg>`;
export const iconFilled = (name, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true">${P[name]}</svg>`;

export const logo = (size = 32) => `<svg class="logo-mark" width="${size}" height="${size}" viewBox="0 0 40 40" aria-hidden="true">
  <rect width="40" height="40" rx="11" fill="#1F6B43"/>
  <path d="M20 31V18" stroke="#F6E7B8" stroke-width="2.6" stroke-linecap="round"/>
  <path d="M20 18c0-5.5-3.6-9-9.5-9 0 5.9 3.6 9 9.5 9Z" fill="#E3A21A"/>
  <path d="M20 22c0-4.6 3.3-7.8 8.6-7.8 0 5.1-3.3 7.8-8.6 7.8Z" fill="#F6E7B8"/>
  <path d="M12 31h16" stroke="#F6E7B8" stroke-width="2.6" stroke-linecap="round"/>
</svg>`;

// ---------- primitives ----------
export function avatar(name, size = 'md') {
  const initials = String(name || '?').split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  let h = 0;
  for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) % 360;
  const hues = [142, 38, 152, 28, 168, 48];
  const hue = hues[h % hues.length];
  return `<span class="avatar avatar-${size}" style="--h:${hue}" aria-hidden="true">${esc(initials)}</span>`;
}

export function stars(rating, { count = null, small = false } = {}) {
  const r = Number(rating || 0);
  return `<span class="stars ${small ? 'stars-sm' : ''}" title="${r.toFixed(1)} / 5">${iconFilled('star')}<b>${r.toFixed(1)}</b>${count != null ? `<span class="muted">(${count})</span>` : ''}</span>`;
}

export function starInput(name, value = 0) {
  return `<div class="star-input" role="radiogroup" aria-label="${t('Rating')}">${[1, 2, 3, 4, 5].map((n) => `
    <button type="button" class="star-btn ${n <= value ? 'on' : ''}" data-act="star" data-name="${name}" data-value="${n}" role="radio" aria-checked="${n === value}" aria-label="${n}">${iconFilled('star')}</button>`).join('')}</div>`;
}

export function badge(status) {
  return `<span class="badge badge-${status}">${esc(STATUS[status] ? STATUS[status]() : status)}</span>`;
}

export function ring(value, total, { size = 64, label = true } = {}) {
  const pctv = total ? Math.min(1, value / total) : 0;
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  return `<div class="ring" style="width:${size}px;height:${size}px">
    <svg viewBox="0 0 ${size} ${size}" aria-hidden="true">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-track"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-val ${pctv >= 1 ? 'full' : ''}" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pctv)}"/>
    </svg>
    ${label ? `<span class="ring-label"><b>${value}</b>/${total}</span>` : ''}
  </div>`;
}

export function matchMeter(score) {
  const p = Math.round(score * 100);
  const level = p >= 75 ? 'high' : p >= 50 ? 'mid' : 'low';
  return `<div class="match match-${level}" title="${t('How well this matches, from the AI model')}">
    <span class="match-num">${p}<small>%</small></span><span class="match-label">${t('match')}</span>
  </div>`;
}

export function reasons(list, perspective, { limit = 6, filter = null } = {}) {
  const items = list.filter((r) => (perspective === 'worker' ? r.code !== 'reliability' : true)).filter(filter || (() => true)).slice(0, limit);
  return `<ul class="reasons">${items.map((r) => `<li class="${r.ok ? 'ok' : 'warn'}">${icon(REASON_ICON[r.code] || 'info')}<span>${esc(reasonText(r, perspective))}</span></li>`).join('')}</ul>`;
}

export function facilities(list) {
  if (!list?.length) return '';
  return `<ul class="facilities">${list.map((f) => `<li>${icon('check')}${esc(facilityName(f))}</li>`).join('')}</ul>`;
}

// The work chit: a tear-off-calendar date block, the work, and the day wage.
export function chit(job, { href = null, foot = '', tag = '', compact = false, highlight = false, narrow = false } = {}) {
  const d = dateParts(job.date);
  const soon = daysUntil(job.date);
  const when = soon === 0 ? t('Today') : soon === 1 ? t('Tomorrow') : '';
  const span = job.duration_days > 1 ? tn('{n} day', '{n} days', job.duration_days) : '';
  const el = href ? 'a' : 'article';
  return `<${el} class="chit ${compact ? 'chit-compact' : ''} ${narrow ? 'chit-narrow' : ''} ${highlight ? 'chit-hl' : ''} chit-${job.status || 'open'}" ${href ? `href="${href}"` : ''}>
    <div class="chit-date" aria-label="${esc(d.weekday)} ${esc(d.day)} ${esc(d.month)}">
      <span class="chit-month">${esc(d.month)}</span>
      <span class="chit-day">${d.day}</span>
      <span class="chit-wd">${esc(when || d.weekday)}</span>
      ${span ? `<span class="chit-span">${esc(span)}</span>` : ''}
    </div>
    <div class="chit-body">
      <div class="chit-head">
        <span class="crop" aria-hidden="true">${workIcon(job.work_type)}</span>
        <div class="chit-title">
          <h3>${esc(workName(job.work_type))}</h3>
          <p>${esc(state.lang === 'te' ? (state.wt[job.work_type]?.en || '') : (state.wt[job.work_type]?.te || ''))}</p>
        </div>
        ${tag}
      </div>
      <ul class="facts">
        <li>${icon('pin')}${esc(villageName(job.village))}${job.distance != null ? ` <span class="muted">${t('{km} km', { km: job.distance })}</span>` : ''}</li>
        <li>${icon('clock')}${esc(timeLabel(job.start_time))}</li>
        <li>${icon('users')}${esc(tn('{n} worker', '{n} workers', job.workers_needed))}</li>
      </ul>
      ${foot}
    </div>
    <div class="chit-pay">
      <span class="amt">${money(job.wage)}</span>
      <span class="per">${t('a day')}</span>
    </div>
  </${el}>`;
}

export function emptyState(iconName, title, body = '', action = '') {
  return `<div class="empty">${icon(iconName)}<h3>${esc(title)}</h3>${body ? `<p>${esc(body)}</p>` : ''}${action}</div>`;
}

export const skeleton = (n = 3, h = 108) => Array.from({ length: n }, () => `<div class="skeleton" style="height:${h}px"></div>`).join('');

export function weatherBadge(w) {
  if (!w || !w.available || !w.days?.length) return '';
  const icons = { clear: 'sun', cloudy: 'cloud', fog: 'cloud', rain: 'rain', storm: 'rain', unknown: 'cloud' };
  const advice = {
    good: t('Good weather for field work'),
    rain_possible: t('Some chance of rain. Keep tarpaulins ready.'),
    rain_risk: t('Heavy rain likely. Consider moving the date.'),
    heat: t('Very hot. Plan an early start and water breaks.'),
  };
  const day = w.days[0];
  return `<div class="weather weather-${w.advice}">
    ${icon(icons[day.condition] || 'cloud')}
    <div><b>${day.tmax}°C</b>${day.rain_prob != null ? `<span>${t('{p}% chance of rain', { p: day.rain_prob })}</span>` : ''}<p>${esc(advice[w.advice] || '')}</p></div>
  </div>`;
}

// ---------- toasts ----------
export function toast(msg, { kind = 'info', action = null, timeout = 5000 } = {}) {
  const host = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  el.innerHTML = `${icon(kind === 'error' ? 'alert' : kind === 'success' ? 'check' : 'bell')}<span>${esc(msg)}</span>`;
  if (action) {
    const b = document.createElement('button');
    b.className = 'toast-action';
    b.textContent = action.label;
    b.onclick = () => { action.run(); el.remove(); };
    el.appendChild(b);
  }
  host.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 250); }, timeout);
}

// ---------- dialogs ----------
export function modal(html, { onClose, wide = false, label = '' } = {}) {
  const dlg = document.createElement('dialog');
  dlg.className = `modal ${wide ? 'modal-wide' : ''}`;
  if (label) dlg.setAttribute('aria-label', label);
  dlg.innerHTML = html;
  document.body.appendChild(dlg);
  dlg.addEventListener('close', () => { dlg.remove(); onClose?.(); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  dlg.showModal();
  return dlg;
}

export function confirmDialog({ title, body = '', confirm = t('Confirm'), cancel = t('Go back'), danger = false, input = null }) {
  return new Promise((resolve) => {
    let value = null;
    const dlg = modal(`
      <form method="dialog" class="modal-body">
        <h2>${esc(title)}</h2>
        ${body ? `<p class="muted">${esc(body)}</p>` : ''}
        ${input ? `<label class="field"><span>${esc(input.label)}</span><input name="v" maxlength="200" placeholder="${esc(input.placeholder || '')}"></label>` : ''}
        <div class="modal-actions">
          <button value="cancel" class="btn btn-ghost">${esc(cancel)}</button>
          <button value="ok" class="btn ${danger ? 'btn-danger' : 'btn-primary'}">${esc(confirm)}</button>
        </div>
      </form>`, { onClose: () => resolve(dlg.returnValue === 'ok' ? (input ? value ?? '' : true) : false) });
    const f = dlg.querySelector('form');
    f.addEventListener('submit', () => { value = f.elements.v?.value ?? null; });
  });
}

// ---------- read aloud (for low-literacy users) ----------
export function speak(text) {
  if (!('speechSynthesis' in window)) { toast(t('Read aloud is not supported on this phone'), { kind: 'error' }); return; }
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = state.lang === 'te' ? 'te-IN' : 'en-IN';
  const voice = window.speechSynthesis.getVoices().find((v) => v.lang?.toLowerCase().startsWith(state.lang === 'te' ? 'te' : 'en-in'));
  if (voice) u.voice = voice;
  u.rate = 0.92;
  window.speechSynthesis.speak(u);
}

// ---------- voice input ----------
export function listen(onText) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { toast(t('Voice input works in Chrome on Android and desktop'), { kind: 'error' }); return null; }
  const rec = new SR();
  rec.lang = state.lang === 'te' ? 'te-IN' : 'en-IN';
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  rec.onresult = (e) => onText(e.results[0][0].transcript);
  rec.onerror = (e) => { if (e.error !== 'aborted') toast(t('Could not hear that. Try again closer to the phone.'), { kind: 'error' }); };
  rec.start();
  return rec;
}

export const timeAgo = (ts) => esc(relTime(ts));

export function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [880, 1175].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      g.gain.setValueAtTime(0.06, ctx.currentTime + i * 0.12);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.12 + 0.18);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + i * 0.12);
      o.stop(ctx.currentTime + i * 0.12 + 0.2);
    });
  } catch { /* audio blocked */ }
}
