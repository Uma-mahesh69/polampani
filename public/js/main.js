// App shell, router, live updates.
import {
  state, api, on, setSession, setLang, connectStream, disconnectStream, esc, debounce,
} from './core.js';
import { t, notifText } from './i18n.js';
import { icon, logo, avatar, toast, beep, emptyState } from './ui.js';
import { destroyMaps } from './map.js';
import { notifList, notifHref } from './views/shared.js';
import * as pub from './views/public.js';
import * as auth from './views/auth.js';
import * as farmer from './views/farmer.js';
import * as worker from './views/worker.js';
import * as account from './views/account.js';

const routes = [
  { path: '/', view: pub.landing, layout: 'public', title: 'PolamPani' },
  { path: '/impact', view: pub.impact, layout: 'public', title: 'Impact' },
  { path: '/job/:id', view: pub.publicJob, layout: 'public', title: 'Work' },
  { path: '/login', view: auth.login, layout: 'public', title: 'Log in' },
  { path: '/signup', view: auth.signup, layout: 'public', title: 'Create account' },
  { path: '/f', view: farmer.farmerHome, role: 'farmer', nav: 'home' },
  { path: '/f/post', view: farmer.postWizard, role: 'farmer', nav: 'post' },
  { path: '/f/jobs', view: farmer.farmerJobs, role: 'farmer', nav: 'jobs' },
  { path: '/f/jobs/:id', view: farmer.farmerJob, role: 'farmer', nav: 'jobs' },
  { path: '/w', view: worker.workerFeed, role: 'worker', nav: 'home' },
  { path: '/w/jobs/:id', view: worker.workerJob, role: 'worker', nav: 'home' },
  { path: '/w/work', view: worker.workerWork, role: 'worker', nav: 'work' },
  { path: '/alerts', view: account.alertsPage, auth: true, nav: 'alerts' },
  { path: '/profile', view: account.profile, auth: true, nav: 'profile' },
].map((r) => ({ ...r, re: new RegExp(`^${r.path.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`) }));

const homeOf = (u) => (u.role === 'farmer' ? '/f' : '/w');
let current = { actions: {}, cleanup: [], refresh: null };
let shellFor = null;
let firstRoute = true;

// ---------- shell ----------
function navItems() {
  if (state.me.role === 'farmer') {
    return [
      { key: 'home', href: '#/f', icon: 'home', label: t('Home') },
      { key: 'post', href: '#/f/post', icon: 'plus', label: t('Post work'), cta: true },
      { key: 'jobs', href: '#/f/jobs', icon: 'briefcase', label: t('My jobs') },
      { key: 'alerts', href: '#/alerts', icon: 'bell', label: t('Alerts'), badge: true },
      { key: 'profile', href: '#/profile', icon: 'user', label: t('Profile') },
    ];
  }
  return [
    { key: 'home', href: '#/w', icon: 'search', label: t('Find work') },
    { key: 'work', href: '#/w/work', icon: 'briefcase', label: t('My work') },
    { key: 'alerts', href: '#/alerts', icon: 'bell', label: t('Alerts'), badge: true },
    { key: 'profile', href: '#/profile', icon: 'user', label: t('Profile') },
  ];
}

function buildShell() {
  const me = state.me;
  const items = navItems();
  document.getElementById('root').innerHTML = `
  <div class="app">
    <aside class="sidebar" aria-label="${t('Main menu')}">
      <a class="brand" href="#${homeOf(me)}">${logo(36)}<span class="brand-name">PolamPani<small>పొలం పని</small></span></a>
      ${me.role === 'farmer' ? `<a class="btn btn-action btn-block nav-cta" href="#/f/post">${icon('plus')}${t('Post work')}</a>` : ''}
      <nav class="nav">${items.filter((i) => !i.cta).map((i) => `<a href="${i.href}" data-nav="${i.key}">${icon(i.icon)}<span>${i.label}</span>${i.badge ? '<span class="count unread-count" hidden></span>' : ''}</a>`).join('')}</nav>
      <div class="sidebar-foot">
        <a class="side-btn" href="#/impact">${icon('chart')}${t('Impact')}</a>
        <button class="side-btn" data-act="lang">${icon('lang')}${state.lang === 'te' ? 'English' : 'తెలుగు'}</button>
        <a class="me-card" href="#/profile">${avatar(me.name, 'sm')}<span class="grow"><b>${esc(me.name)}</b><small>${me.role === 'farmer' ? t('Farmer') : t('Worker')}, ${esc(me.village)}</small></span></a>
      </div>
    </aside>
    <div class="main">
      <header class="topbar" id="topbar">
        <a class="brand brand-mobile" href="#${homeOf(me)}" aria-label="PolamPani">${logo(32)}</a>
        <div class="topbar-title" id="title"></div>
        <button class="btn btn-ghost btn-sm" data-act="lang" aria-label="${t('Change language')}">${icon('lang')}<span>${state.lang === 'te' ? 'EN' : 'తె'}</span></button>
        <button class="btn btn-ghost btn-icon bell" data-act="bell" aria-label="${t('Alerts')}">${icon('bell')}<span class="dot unread-count" hidden></span></button>
      </header>
      <main class="content" id="view" tabindex="-1"></main>
    </div>
    <nav class="bottomnav" aria-label="${t('Main menu')}">${items.map((i) => `<a href="${i.href}" data-nav="${i.key}" class="${i.cta ? 'bn-cta' : ''}">${icon(i.icon)}<span>${i.label}</span>${i.badge ? '<span class="count unread-count" hidden></span>' : ''}</a>`).join('')}</nav>
  </div>`;
  shellFor = `${me.id}:${state.lang}`;
  const tb = document.getElementById('topbar');
  window.onscroll = () => tb?.classList.toggle('scrolled', window.scrollY > 4);
  updateBadge();
}

function setActiveNav(key) {
  document.querySelectorAll('[data-nav]').forEach((a) => {
    if (a.dataset.nav === key) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

function updateBadge() {
  document.querySelectorAll('.unread-count').forEach((el) => {
    el.hidden = !state.unread;
    el.textContent = state.unread > 9 ? '9+' : state.unread;
  });
}

async function refreshBadge() {
  if (!state.me) return;
  try {
    const list = await api('/notifications');
    state.unread = list.filter((n) => !n.read).length;
    updateBadge();
    return list;
  } catch { return null; }
}

// ---------- notifications popover ----------
let popover = null;
function closePopover() {
  if (popover) { popover.remove(); popover = null; }
}
async function togglePopover() {
  if (popover) { closePopover(); return; }
  if (window.innerWidth < 1024) { location.hash = '#/alerts'; return; }
  popover = document.createElement('div');
  popover.className = 'popover';
  popover.setAttribute('role', 'dialog');
  popover.setAttribute('aria-label', t('Alerts'));
  popover.innerHTML = `<div class="popover-head"><b>${t('Alerts')}</b><a class="small" href="#/alerts">${t('See all')}</a></div><div class="pop-body"><div class="skeleton" style="height:180px;margin:12px"></div></div>`;
  document.body.appendChild(popover);
  const list = await refreshBadge();
  if (!popover) return;
  popover.querySelector('.pop-body').innerHTML = list?.length ? notifList(list.slice(0, 12), state.me.role) : emptyState('bell', t('No alerts yet'));
  if (state.unread) {
    api('/notifications/read', { method: 'POST', body: {} }).then(() => { state.unread = 0; updateBadge(); }).catch(() => {});
  }
}
document.addEventListener('click', (e) => {
  if (popover && !popover.contains(e.target) && !e.target.closest('[data-act="bell"]')) closePopover();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePopover(); });

// ---------- session ----------
function onLogin() {
  connectStream();
  refreshBadge();
  if ('Notification' in window && Notification.permission === 'default') {
    setTimeout(() => Notification.requestPermission().catch(() => {}), 1500);
  }
}

function logout() {
  setSession(null, null);
  disconnectStream();
  state.unread = 0;
  shellFor = null;
  location.hash = '#/';
  toast(t('You have logged out'));
}

// ---------- live events ----------
on('notification', (n) => {
  state.unread += 1;
  updateBadge();
  beep();
  toast(notifText(n), {
    kind: ['accepted', 'filled', 'paid', 'completed', 'checked_in'].includes(n.type) ? 'success' : 'info',
    action: n.job_id ? { label: t('View'), run: () => { location.hash = notifHref(n, state.me.role); } } : null,
    timeout: 7000,
  });
  if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
    try { new Notification('PolamPani', { body: notifText(n), icon: '/icons/icon-192.png', tag: `n${n.id}` }); } catch { /* ignore */ }
  }
});
const refreshView = debounce(() => { current.refresh?.().catch(() => {}); }, 300);
on('refresh', refreshView);
on('unauthorized', () => { if (state.me) { setSession(null, null); disconnectStream(); shellFor = null; location.hash = '#/login'; } });

// ---------- actions (event delegation) ----------
const globalActions = {
  lang: async () => {
    setLang(state.lang === 'te' ? 'en' : 'te');
    if (state.me) api('/me', { method: 'PATCH', body: { lang: state.lang } }).then((u) => { state.me = u; }).catch(() => {});
    shellFor = null;
    await route();
  },
  bell: () => togglePopover(),
  notifOpen: (d) => {
    closePopover();
    api('/notifications/read', { method: 'POST', body: { ids: [Number(d.id)] } }).catch(() => {});
    return 'navigate';
  },
  demoLogin: async (d) => {
    const r = await api('/auth/demo', { method: 'POST', body: { user_id: Number(d.id) } });
    setSession(r.token, r.user);
    onLogin();
    toast(t('Logged in as {name}', { name: r.user.name }), { kind: 'success' });
    location.hash = `#${homeOf(r.user)}`;
  },
};

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  const fn = current.actions?.[act] || globalActions[act];
  if (!fn) return;
  if (act !== 'notifOpen') e.preventDefault();
  const isBtn = el.tagName === 'BUTTON';
  if (isBtn && el.disabled) return;
  let spin = null;
  if (isBtn) {
    el.disabled = true;
    spin = setTimeout(() => el.classList.add('loading'), 180);
  }
  try {
    await fn({ ...el.dataset }, el, e);
  } catch (err) {
    if (err?.name !== 'AbortError') toast(err.message || t('Something went wrong'), { kind: 'error' });
  } finally {
    clearTimeout(spin);
    if (isBtn && el.isConnected) { el.disabled = false; el.classList.remove('loading'); }
  }
});

// ---------- router ----------
async function route() {
  const raw = location.hash.slice(1) || '/';
  const [path, qs] = raw.split('?');
  const query = Object.fromEntries(new URLSearchParams(qs || ''));
  let match = null;
  let params = {};
  for (const r of routes) {
    const m = path.match(r.re);
    if (m) { match = r; params = m.groups || {}; break; }
  }

  if (match && (match.role || match.auth) && !state.me) { location.replace(`#/login?next=${encodeURIComponent(path)}`); return; }
  if (match?.role && state.me && state.me.role !== match.role) { location.replace(`#${homeOf(state.me)}`); return; }
  if (path === '/' && state.me && !query.home) { location.replace(`#${homeOf(state.me)}`); return; }

  current.cleanup.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
  try { destroyMaps(); } catch { /* ignore */ }
  closePopover();
  window.speechSynthesis?.cancel();

  let rootEl;
  if (!match || match.layout === 'public') {
    shellFor = null;
    document.getElementById('root').innerHTML = '<div id="view" tabindex="-1"></div>';
    window.onscroll = null;
  } else if (shellFor !== `${state.me.id}:${state.lang}`) {
    buildShell();
  }
  rootEl = document.getElementById('view');
  if (match?.nav) setActiveNav(match.nav);

  const ctx = {
    params, query, root: rootEl, actions: {}, cleanup: [], refresh: null,
    setTitle: (title) => {
      const el = document.getElementById('title');
      if (el) el.textContent = title;
      document.title = `${title} | PolamPani`;
    },
    onRefresh: (fn) => { ctx.refresh = fn; },
    onCleanup: (fn) => ctx.cleanup.push(fn),
    onLogin, logout, refreshBadge, rerender: () => { shellFor = null; route(); },
    // Navigate only if the user is still on this page (async actions must not pull them back).
    go: (hash) => { if (current === ctx) location.hash = hash; },
  };
  current = ctx;

  if (!match) {
    rootEl.innerHTML = `${pub.publicHeader()}<main class="content">${emptyState('alert', t('Page not found'), t('The link may be old or mistyped.'), `<a class="btn btn-primary" href="#/">${t('Go to PolamPani')}</a>`)}</main>`;
    return;
  }
  if (match.title) document.title = match.title === 'PolamPani' ? 'PolamPani: farm work, filled on time' : `${t(match.title)} | PolamPani`;
  if (!firstRoute) window.scrollTo(0, 0);
  try {
    await match.view(ctx);
  } catch (err) {
    console.error(err);
    if (current !== ctx) return;
    rootEl.innerHTML = emptyState('alert', t('This page could not load'), err.message, '<button class="btn btn-primary" onclick="location.reload()">Retry</button>');
  }
  if (!firstRoute && current === ctx) rootEl.focus({ preventScroll: true });
  firstRoute = false;
}

window.addEventListener('hashchange', route);
window.addEventListener('online', () => { toast(t('Back online')); connectStream(); current.refresh?.(); });
window.addEventListener('offline', () => toast(t('You are offline. Changes will not be saved until you reconnect.'), { kind: 'error', timeout: 8000 }));

async function boot() {
  setLang(state.lang);
  try {
    state.meta = await api('/meta');
  } catch (e) {
    document.getElementById('root').innerHTML = `<div class="auth-wrap"><div class="auth-card">${emptyState('alert', 'PolamPani is not reachable', e.message, '<button class="btn btn-primary" onclick="location.reload()">Retry</button>')}</div></div>`;
    return;
  }
  state.wt = Object.fromEntries(state.meta.work_types.map((w) => [w.id, w]));
  state.fac = Object.fromEntries(state.meta.facilities.map((f) => [f.id, f]));
  if (state.token) {
    try {
      state.me = await api('/me');
      onLogin();
    } catch { setSession(null, null); }
  }
  await route();
  if ('serviceWorker' in navigator && location.hostname !== '127.0.0.1') {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}

boot();
