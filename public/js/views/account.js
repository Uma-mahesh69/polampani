// Profile / settings and the full notifications page.
import { state, api, esc, phoneLabel, setLang } from '../core.js';
import { t } from '../i18n.js';
import { icon, avatar, stars, toast, skeleton, emptyState, confirmDialog } from '../ui.js';
import { createMap, pin } from '../map.js';
import { notifList } from './shared.js';

export async function profile(ctx) {
  ctx.setTitle(t('Profile'));
  const me = { ...state.me };
  const worker = me.role === 'worker';
  const draft = {
    name: me.name, village: me.village, lat: me.lat, lng: me.lng, upi_id: me.upi_id || '', lang: state.lang,
    skills: [...(me.skills || [])], daily_wage: me.daily_wage, radius_km: me.radius_km, available_days: [...(me.available_days || [])],
  };
  ctx.root.innerHTML = `
    <div class="page-head"><div class="row">${avatar(me.name, 'lg')}<div><h1>${esc(me.name)}</h1>
      <p class="row small" style="gap:10px">${icon('phone')}${esc(phoneLabel(me.phone))}${me.verified ? `<span class="tag tag-good">${icon('shield')}${t('Verified')}</span>` : ''}${stars(me.rating, { count: me.rating_count, small: true })}</p></div></div></div>
    <form id="pf" class="stack-lg" style="max-width:820px" novalidate>
      <section class="panel stack">
        <div class="panel-head" style="margin:0"><h2>${icon('user')}${t('About you')}</h2></div>
        <div class="form-grid">
          <label class="field"><span>${t('Name')}</span><input name="name" value="${esc(draft.name)}" maxlength="60" autocomplete="name"></label>
          <label class="field"><span>${t('Language')}</span><select name="lang"><option value="te" ${draft.lang === 'te' ? 'selected' : ''}>తెలుగు</option><option value="en" ${draft.lang === 'en' ? 'selected' : ''}>English</option></select><small>${t('Used for the app, alerts and SMS')}</small></label>
        </div>
        <label class="field"><span>${t('Village')}</span><select name="village">${state.meta.villages.map((v) => `<option value="${esc(v.name)}" ${v.name === draft.village ? 'selected' : ''}>${esc(state.lang === 'te' ? `${v.te} (${v.name})` : `${v.name} (${v.te})`)}</option>`).join('')}</select></label>
        <div id="pf-map" class="map" style="height:220px"></div>
        <p class="hint">${worker ? t('Drag the pin to your home. Distances to work are measured from here.') : t('Drag the pin to your farm. New jobs start here by default.')}</p>
      </section>
      ${worker ? `<section class="panel stack">
        <div class="panel-head" style="margin:0"><h2>${icon('tool')}${t('Your work')}</h2></div>
        <div class="field"><span>${t('Skills')}</span><div class="tiles">${state.meta.work_types.map((w) => `<button type="button" class="tile" data-act="skill" data-id="${w.id}" aria-pressed="${draft.skills.includes(w.id)}"><span class="crop">${w.icon}</span><b>${esc(state.lang === 'te' ? w.te : w.en)}</b></button>`).join('')}</div></div>
        <div class="form-grid">
          <label class="field"><span>${t('Your daily rate (₹)')}</span><input name="daily_wage" type="number" min="100" max="5000" step="25" value="${draft.daily_wage}"></label>
          <label class="field"><span>${t('How far can you travel?')} <b id="rad">${draft.radius_km} km</b></span><input name="radius_km" type="range" min="5" max="50" step="5" value="${draft.radius_km}"></label>
        </div>
        <div class="field"><span>${t('Days you usually work')}</span><div class="days">${[1, 2, 3, 4, 5, 6, 0].map((d) => `<button type="button" class="day-btn" data-act="day" data-day="${d}" aria-pressed="${draft.available_days.includes(d)}">${new Intl.DateTimeFormat(state.lang === 'te' ? 'te-IN' : 'en-IN', { weekday: 'short' }).format(new Date(2024, 0, 7 + d))}</button>`).join('')}</div></div>
      </section>` : ''}
      <section class="panel stack">
        <div class="panel-head" style="margin:0"><h2>${icon('wallet')}${t('Payments')}</h2></div>
        <label class="field"><span>${t('UPI ID')}</span><input name="upi_id" value="${esc(draft.upi_id)}" placeholder="name@ybl" autocapitalize="off" autocomplete="off"><small>${worker ? t('Farmers can pay you straight from the app') : t('Optional. Shown only to workers you hire.')}</small></label>
      </section>
      <div class="row-between">
        <button type="button" class="btn btn-ghost" data-act="logout" style="color:var(--chilli)">${icon('logout')}${t('Log out')}</button>
        <button class="btn btn-primary btn-lg">${t('Save changes')}</button>
      </div>
    </form>`;

  const f = ctx.root.querySelector('#pf');
  const map = createMap(ctx.root.querySelector('#pf-map'), { center: [draft.lat, draft.lng], zoom: 13 });
  let marker = null;
  if (map) {
    marker = L.marker([draft.lat, draft.lng], { icon: pin('home', '⌂'), draggable: true }).addTo(map);
    marker.on('dragend', () => { const p = marker.getLatLng(); draft.lat = p.lat; draft.lng = p.lng; draft.moved = true; });
  } else ctx.root.querySelector('#pf-map').hidden = true;
  f.village.addEventListener('change', () => {
    const v = state.meta.villages.find((x) => x.name === f.village.value);
    draft.village = v.name; draft.lat = v.lat; draft.lng = v.lng; draft.moved = true;
    if (map) { map.setView([v.lat, v.lng], 13); marker.setLatLng([v.lat, v.lng]); }
  });
  if (worker) f.radius_km.addEventListener('input', () => { ctx.root.querySelector('#rad').textContent = `${f.radius_km.value} km`; });

  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = f.querySelector('.btn-primary');
    btn.classList.add('loading');
    const body = { name: f.name.value, lang: f.lang.value, upi_id: f.upi_id.value.trim() };
    if (draft.moved) Object.assign(body, { village: draft.village, lat: draft.lat, lng: draft.lng });
    if (worker) Object.assign(body, { skills: draft.skills, daily_wage: Number(f.daily_wage.value), radius_km: Number(f.radius_km.value), available_days: draft.available_days });
    try {
      state.me = await api('/me', { method: 'PATCH', body });
      const langChanged = body.lang !== state.lang;
      if (langChanged) setLang(body.lang);
      toast(t('Saved'), { kind: 'success' });
      if (langChanged) ctx.rerender();
    } catch (err) { toast(err.message, { kind: 'error' }); } finally { btn.classList.remove('loading'); }
  });

  ctx.actions = {
    skill: (d, el) => {
      draft.skills = draft.skills.includes(d.id) ? draft.skills.filter((s) => s !== d.id) : [...draft.skills, d.id];
      el.setAttribute('aria-pressed', draft.skills.includes(d.id));
    },
    day: (d, el) => {
      const day = Number(d.day);
      draft.available_days = draft.available_days.includes(day) ? draft.available_days.filter((x) => x !== day) : [...draft.available_days, day];
      el.setAttribute('aria-pressed', draft.available_days.includes(day));
    },
    logout: async () => {
      if (await confirmDialog({ title: t('Log out of PolamPani?'), body: t('You will stop getting alerts on this device until you log in again.'), confirm: t('Log out') })) ctx.logout();
    },
  };
}

export async function alertsPage(ctx) {
  ctx.setTitle(t('Alerts'));
  ctx.root.innerHTML = `<div class="page-head"><div><h1>${t('Alerts')}</h1></div><button class="btn btn-sm btn-ghost" data-act="readAll">${icon('check')}${t('Mark all as read')}</button></div>
    <section class="panel panel-flush" id="al">${skeleton(4, 60)}</section>`;
  const load = async () => {
    const list = await api('/notifications');
    document.getElementById('al').innerHTML = list.length ? notifList(list, state.me.role) : emptyState('bell', t('No alerts yet'), state.me.role === 'worker' ? t('Keep your availability on. New work near you shows up here.') : t('You will see updates here when workers respond to your jobs.'));
  };
  await load();
  ctx.onRefresh(load);
  ctx.actions = { readAll: async () => { await api('/notifications/read', { method: 'POST', body: {} }); ctx.refreshBadge(); load(); } };
}
