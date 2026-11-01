// Farmer: home, post work wizard, jobs list, job detail.
import {
  state, api, esc, money, num, pct, addDays, today, dateLong, dateShort, dateParts, timeLabel, daysUntil,
  relTime, clockTime, telHref, waHref, phoneLabel, greetingKey, debounce,
} from '../core.js';
import { t, tn, workName, workIcon, villageName, facilityName } from '../i18n.js';
import {
  icon, chit, badge, ring, avatar, stars, starInput, reasons, facilities, emptyState, skeleton, toast, modal,
  confirmDialog, listen, weatherBadge, matchMeter,
} from '../ui.js';
import { createMap, pin, fit } from '../map.js';
import { modelCard, outlookList } from './shared.js';

const firstName = (n) => String(n || '').split(' ')[0];

function progressFoot(j) {
  const p = Math.min(100, Math.round((j.accepted_count / j.workers_needed) * 100));
  return `<div class="chit-foot"><div class="progress"><div style="width:${p}%"></div></div>
    <span class="progress-label">${t('{n} of {m} confirmed', { n: j.accepted_count, m: j.workers_needed })}</span></div>`;
}

export function shareText(j) {
  return t('{work} at {village}, {date} from {time}. {wage} a day, {n} workers needed. Accept on PolamPani: {url}', {
    work: workName(j.work_type), village: j.village, date: dateShort(j.date), time: timeLabel(j.start_time),
    wage: money(j.wage), n: j.workers_needed, url: `${location.origin}/#/job/${j.id}`,
  });
}

// ---------------------------------------------------------------- home
export async function farmerHome(ctx) {
  const me = state.me;
  ctx.setTitle(t('Home'));
  ctx.root.innerHTML = `
    <div class="page-head">
      <div><h1>${t(greetingKey())}, ${esc(firstName(me.name))}</h1><p>${esc(dateLong(today()))}, ${esc(villageName(me.village))}</p></div>
    </div>
    <div class="cols">
      <div class="stack-lg">
        <section class="composer" aria-labelledby="cmp-h">
          <h2 id="cmp-h">${t('What work do you have?')}</h2>
          <p>${t('Say it like you would to a neighbour. Any Indian language.')}</p>
          <label class="sr-only" for="cmp">${t('Describe the work')}</label>
          <textarea id="cmp" rows="2" placeholder="${t('Example: Tomorrow 6am, 8 people for paddy harvesting, 600 a day, lunch provided')}"></textarea>
          <div class="composer-actions">
            <button class="btn btn-action" data-act="compose">${icon('sparkle')}${t('Continue')}</button>
            <button class="btn btn-ghost" data-act="cmpMic">${icon('mic')}${t('Speak')}</button>
          </div>
        </section>
        <div id="kpis">${skeleton(1, 96)}</div>
        <div id="attention"></div>
        <div id="today"></div>
        <section><div class="section-title"><h2>${t('Active jobs')}</h2><a href="#/f/jobs" class="small">${t('All jobs')}</a></div><div id="active" class="stack">${skeleton(2)}</div></section>
      </div>
      <aside class="cols-side">
        <section class="panel" id="wx" hidden></section>
        <section class="panel"><div class="panel-head"><h2>${icon('trend')}${t('Labour outlook')}</h2></div><p class="small muted" style="margin:-6px 0 8px">${t('Next three weeks within 30 km')}</p><div id="outlook">${skeleton(1, 120)}</div></section>
        <section class="panel" id="model"></section>
      </aside>
    </div>`;

  const load = async () => {
    const [s, jobs, season, model] = await Promise.all([
      api('/farmer/summary'), api('/jobs/mine?status=active'), api('/ai/season'), api('/ai/model'),
    ]);
    document.getElementById('kpis').innerHTML = `<div class="kpis">
      <div class="kpi"><div class="kpi-label">${t('Active jobs')}</div><div class="kpi-value">${s.active_jobs}</div></div>
      <div class="kpi"><div class="kpi-label">${t('Workers booked')}</div><div class="kpi-value">${s.confirmed_upcoming}</div><div class="kpi-note">${t('for upcoming work')}</div></div>
      <div class="kpi"><div class="kpi-label">${t('Fully staffed')}</div><div class="kpi-value">${pct(s.fill_rate)}</div><div class="kpi-note">${t('of jobs, last 60 days')}</div></div>
      <div class="kpi ${s.unpaid ? 'kpi-action' : ''}"><div class="kpi-label">${s.unpaid ? t('Still to pay') : t('Paid out')}</div><div class="kpi-value">${money(s.unpaid || s.spent_30d)}</div><div class="kpi-note">${s.unpaid ? t('for finished work') : t('last 30 days')}</div></div>
    </div>`;

    const t0 = today();
    const att = [];
    for (const j of jobs.filter((x) => x.status === 'open' && daysUntil(x.date) <= 2 && x.spots_left > 0)) {
      att.push(`<div class="callout callout-bad">${icon('alert')}<div class="grow"><b>${t('{work} on {date} still needs {n} more', { work: esc(workName(j.work_type)), date: esc(dateShort(j.date)), n: j.spots_left })}</b>
        <span class="small">${t('{a} alerted, {p} still deciding.', { a: j.alerted, p: j.pending })}</span></div>
        <button class="btn btn-sm btn-danger" data-act="dispatch" data-id="${j.id}">${t('Alert more')}</button></div>`);
    }
    if (s.to_rate || s.unpaid) {
      att.push(`<div class="callout callout-action">${icon('wallet')}<div class="grow"><b>${t('Finish up past work')}</b>
        <span class="small">${[s.unpaid ? t('{amt} still to pay', { amt: money(s.unpaid) }) : '', s.to_rate ? tn('{n} worker to rate', '{n} workers to rate', s.to_rate) : ''].filter(Boolean).join('. ')}</span></div>
        <a class="btn btn-sm btn-action" href="#/f/jobs?tab=completed">${t('Review')}</a></div>`);
    }
    document.getElementById('attention').innerHTML = att.length ? `<div class="stack">${att.join('')}</div>` : '';

    const running = jobs.filter((j) => j.date <= t0 && j.end_date >= t0);
    document.getElementById('today').innerHTML = running.length ? `<section><div class="section-title"><h2>${t('In the field today')}</h2></div><div class="stack">${running.map((j) => {
      const arrived = j.crew.filter((c) => c.checked_in_at).length;
      return chit(j, {
        href: `#/f/jobs/${j.id}`, compact: true, highlight: true,
        tag: `<span class="tag ${arrived === j.accepted_count && arrived ? 'tag-good' : 'tag-action'}">${icon('pin')}${t('{n} of {m} arrived', { n: arrived, m: j.accepted_count })}</span>`,
        foot: `<div class="who-strip">${j.crew.slice(0, 8).map((c) => avatar(c.name, 'sm')).join('')}</div>`,
      });
    }).join('')}</div></section>` : '';

    const upcoming = jobs.filter((j) => !(j.date <= t0 && j.end_date >= t0));
    document.getElementById('active').innerHTML = upcoming.length
      ? upcoming.map((j) => chit(j, { href: `#/f/jobs/${j.id}`, tag: badge(j.status), foot: progressFoot(j) })).join('')
      : (running.length ? `<p class="muted">${t('No other upcoming jobs.')}</p>` : emptyState('sprout', t('No active jobs'), t('Post your next fieldwork and we will alert the right workers nearby.'), `<a class="btn btn-primary" href="#/f/post">${icon('plus')}${t('Post work')}</a>`));
    document.getElementById('outlook').innerHTML = outlookList(season);
    document.getElementById('model').innerHTML = modelCard(model, { compact: true });
  };
  await load();
  ctx.onRefresh(load);

  api(`/weather?lat=${me.lat}&lng=${me.lng}&date=${today()}`).then((w) => {
    const el = document.getElementById('wx');
    if (el && w.available) { el.hidden = false; el.innerHTML = `<div class="panel-head"><h2>${icon('sun')}${t('Weather at your farm')}</h2></div>${weatherBadge(w)}`; }
  }).catch(() => {});

  ctx.actions = {
    compose: async () => {
      const text = document.getElementById('cmp').value.trim();
      if (!text) { ctx.go('#/f/post'); return; }
      const parsed = await api('/ai/parse', { method: 'POST', body: { text } });
      sessionStorage.setItem('pp_draft', JSON.stringify({ text, parsed }));
      ctx.go('#/f/post');
    },
    cmpMic: (d, el) => {
      el.classList.add('mic-on');
      const rec = listen((text) => { const a = document.getElementById('cmp'); a.value = `${a.value} ${text}`.trim(); });
      if (rec) rec.onend = () => el.classList.remove('mic-on'); else el.classList.remove('mic-on');
    },
    dispatch: (d) => dispatchMore(d.id),
  };
}

async function dispatchMore(id) {
  const r = await api(`/jobs/${id}/dispatch`, { method: 'POST' });
  if (r.notified) toast(tn('Alerted {n} more worker within {km} km', 'Alerted {n} more workers within {km} km', r.notified, { km: r.job.radius_km }), { kind: 'success' });
  else toast(t('No more free workers found. Raising the wage can help.'), { kind: 'error' });
}

// ---------------------------------------------------------------- post wizard
export async function postWizard(ctx) {
  const me = state.me;
  ctx.setTitle(t('Post work'));
  const d = {
    work_type: null, date: addDays(1), duration_days: 1, start_time: '07:00', workers_needed: 5, wage: 500,
    facilities: [], village: me.village, lat: me.lat, lng: me.lng, description: '', text: '',
  };
  let step = 'describe';
  let found = [];
  let preview = null;
  let posted = null;

  const apply = (p) => {
    found = p.found || [];
    for (const k of ['work_type', 'date', 'start_time', 'workers_needed', 'wage', 'duration_days', 'village']) if (p[k] != null) d[k] = p[k];
    if (p.facilities?.length) d.facilities = p.facilities;
    if (p.lat != null && p.village && p.village !== me.village) { d.lat = p.lat; d.lng = p.lng; }
  };
  const draft = sessionStorage.getItem('pp_draft');
  if (draft) {
    const x = JSON.parse(draft);
    sessionStorage.removeItem('pp_draft');
    apply(x.parsed);
    d.text = x.text;
    d.description = x.text;
    step = 'details';
  }

  const wizardSteps = () => {
    const order = ['describe', 'details', 'review'];
    const idx = order.indexOf(step);
    return `<ol class="wizard-steps">${[t('Describe'), t('Details'), t('Review and post')].map((s, i) => `<li class="${i < idx ? 'done' : i === idx ? 'current' : ''}">${s}</li>`).join('')}</ol>`;
  };

  const render = () => {
    window.scrollTo(0, 0);
    if (step === 'describe') renderDescribe();
    else if (step === 'details') renderDetails();
    else if (step === 'review') renderReview();
    else renderDone();
  };

  const renderDescribe = () => {
    ctx.root.innerHTML = `<div style="max-width:760px">
      <div class="page-head"><div><h1>${t('Post work')}</h1><p>${t('Describe it in your own words and AI will fill in the details. You can change anything after.')}</p></div></div>
      ${wizardSteps()}
      <section class="composer">
        <label for="desc" class="sr-only">${t('Describe the work')}</label>
        <textarea id="desc" rows="4" placeholder="${t('Example: Tomorrow 6am, 8 people for paddy harvesting, 600 a day, lunch provided')}">${esc(d.text)}</textarea>
        <div class="composer-actions">
          <button class="btn btn-action" data-act="parse">${icon('sparkle')}${t('Fill in the details')}</button>
          <button class="btn btn-ghost" data-act="mic">${icon('mic')}${t('Speak')}</button>
          <span class="grow"></span>
          <button class="btn btn-ghost" data-act="skip">${t('Skip and fill it myself')}</button>
        </div>
      </section>
      <p class="small muted" style="margin-top:14px">${t('AI understands the type of work, number of workers, date, start time, number of days, wage, village, and lunch or transport.')}</p>
    </div>`;
    ctx.root.querySelector('#desc').focus();
  };

  const dateChips = () => {
    const chips = [];
    for (let i = 0; i < 7; i += 1) {
      const v = addDays(i);
      const p = dateParts(v);
      const label = i === 0 ? t('Today') : i === 1 ? t('Tomorrow') : `${p.weekday} ${Number(p.day)}`;
      chips.push(`<button type="button" class="chip-toggle" data-act="set" data-k="date" data-v="${v}" aria-pressed="${d.date === v}">${esc(label)}</button>`);
    }
    return chips.join('');
  };

  const renderDetails = () => {
    const vOpts = state.meta.villages.map((v) => `<option value="${esc(v.name)}" ${v.name === d.village ? 'selected' : ''}>${esc(state.lang === 'te' ? `${v.te} (${v.name})` : `${v.name} (${v.te})`)}</option>`).join('');
    ctx.root.innerHTML = `
      <div class="page-head"><div><h1>${t('Post work')}</h1>${found.length ? `<p>${tn('AI filled in {n} detail from your description. Check them below.', 'AI filled in {n} details from your description. Check them below.', found.length)}</p>` : `<p>${t('Tell workers what the work is, when, and what it pays.')}</p>`}</div></div>
      ${wizardSteps()}
      <div class="wiz">
        <form id="wiz" class="panel" novalidate>
          <div class="wiz-section">
            <h3>${t('Type of work')}</h3><p>${t('Workers with this skill are matched first.')}</p>
            <div class="tiles">${state.meta.work_types.map((w) => `<button type="button" class="tile" data-act="set" data-k="work_type" data-v="${w.id}" aria-pressed="${d.work_type === w.id}"><span class="crop">${w.icon}</span><b>${esc(state.lang === 'te' ? w.te : w.en)}</b><small>${esc(state.lang === 'te' ? w.en : w.te)}</small></button>`).join('')}</div>
          </div>
          <div class="wiz-section">
            <h3>${t('When')}</h3><p>${t('Pick the first day of work.')}</p>
            <div class="chips" id="date-chips">${dateChips()}</div>
            <div class="form-grid" style="margin-top:14px">
              <label class="field"><span>${t('Or choose a date')}</span><input type="date" name="date" min="${state.meta.today}" value="${d.date}"></label>
              <div class="field"><span>${t('Number of days')}</span>${stepperHtml('duration_days', d.duration_days)}</div>
            </div>
            <div class="field" style="margin-top:14px"><span>${t('Start time')}</span>
              <div class="chips" id="time-chips">${['06:00', '06:30', '07:00', '08:00', '09:00'].map((v) => `<button type="button" class="chip-toggle" data-act="set" data-k="start_time" data-v="${v}" aria-pressed="${d.start_time === v}">${esc(timeLabel(v))}</button>`).join('')}
                <input type="time" name="start_time" value="${d.start_time}" style="width:140px;min-height:40px" aria-label="${t('Other time')}"></div></div>
          </div>
          <div class="wiz-section">
            <h3>${t('Workers and wage')}</h3><p>${t('A fair wage gets more people to say yes, faster.')}</p>
            <div class="form-grid">
              <div class="field"><span>${t('Workers needed')}</span>${stepperHtml('workers_needed', d.workers_needed)}</div>
              <label class="field"><span>${t('Wage per day, per worker (₹)')}</span><input name="wage" type="number" min="100" max="5000" step="10" value="${d.wage}" inputmode="numeric"></label>
            </div>
            <div id="wage-hint" style="margin-top:12px"></div>
          </div>
          <div class="wiz-section">
            <h3>${t('What you provide')}</h3><p>${t('These help workers decide.')}</p>
            <div class="chips">${state.meta.facilities.map((f) => `<button type="button" class="chip-toggle" data-act="fac" data-v="${f.id}" aria-pressed="${d.facilities.includes(f.id)}">${icon('check')}${esc(state.lang === 'te' ? f.te : f.en)}</button>`).join('')}</div>
          </div>
          <div class="wiz-section">
            <h3>${t('Where is the field?')}</h3><p>${t('Drag the pin to the exact field so workers can find it.')}</p>
            <div class="form-grid"><label class="field"><span>${t('Village')}</span><select name="village">${vOpts}</select></label>
              <div class="field"><span>&nbsp;</span><button type="button" class="btn btn-quiet" data-act="myFarm">${icon('locate')}${t('Use my farm location')}</button></div></div>
            <div id="wiz-map" class="map" style="margin-top:12px"></div>
          </div>
          <div class="wiz-section">
            <label class="field"><span>${t('Notes for workers (optional)')}</span><textarea name="description" rows="3" maxlength="600" placeholder="${t('Example: Bring your own sickle. Field is behind the temple.')}">${esc(d.description)}</textarea></label>
          </div>
          <div class="wiz-foot">
            <button type="button" class="btn btn-ghost" data-act="toDescribe">${icon('left')}${t('Back')}</button>
            <button type="button" class="btn btn-primary btn-lg" data-act="toReview">${t('Review')}${icon('right')}</button>
          </div>
        </form>
        <aside class="wiz-side">
          <p class="label">${t('Workers will see')}</p>
          <div id="live-chit"></div>
          <section class="panel" id="supply"></section>
        </aside>
      </div>`;

    const f = ctx.root.querySelector('#wiz');
    f.addEventListener('input', (e) => {
      const n = e.target.name;
      if (!n) return;
      if (n === 'wage' || n === 'workers_needed' || n === 'duration_days') d[n] = Number(e.target.value) || 0;
      else d[n] = e.target.value;
      if (n === 'date') ctx.root.querySelector('#date-chips').innerHTML = dateChips();
      if (n === 'start_time') ctx.root.querySelectorAll('#time-chips .chip-toggle').forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === d.start_time));
      if (n === 'village') {
        const v = state.meta.villages.find((x) => x.name === d.village);
        d.lat = v.lat; d.lng = v.lng;
        if (wizMap) { wizMap.map.setView([v.lat, v.lng], 13); wizMap.m.setLatLng([v.lat, v.lng]); }
      }
      updateSide();
    });

    let wizMap = null;
    const map = createMap(ctx.root.querySelector('#wiz-map'), { center: [d.lat, d.lng], zoom: 13 });
    if (map) {
      const m = L.marker([d.lat, d.lng], { icon: pin('pick', workIcon(d.work_type)), draggable: true }).addTo(map);
      m.on('dragend', () => { const p = m.getLatLng(); d.lat = p.lat; d.lng = p.lng; updateSide(); });
      map.on('click', (e) => { m.setLatLng(e.latlng); d.lat = e.latlng.lat; d.lng = e.latlng.lng; updateSide(); });
      wizMap = { map, m };
    } else ctx.root.querySelector('#wiz-map').innerHTML = `<div class="map-offline">${t('Map needs an internet connection. The village location will be used.')}</div>`;
    ctx.wizMap = wizMap;
    updateSide();
  };

  const stepperHtml = (k, v) => `<div class="stepper"><button type="button" data-act="bump" data-k="${k}" data-delta="-1" aria-label="${t('Less')}">${icon('minus')}</button>
    <input name="${k}" type="number" inputmode="numeric" value="${v}" min="1" max="${k === 'duration_days' ? 30 : 200}" aria-label="${k === 'duration_days' ? t('Number of days') : t('Workers needed')}">
    <button type="button" data-act="bump" data-k="${k}" data-delta="1" aria-label="${t('More')}">${icon('plus')}</button></div>`;

  const updateSide = debounce(async () => {
    const liveEl = ctx.root.querySelector('#live-chit');
    if (!liveEl) return;
    liveEl.innerHTML = d.work_type ? chit({ ...d, status: 'open' }) : `<div class="panel muted small">${t('Choose the type of work to see a preview.')}</div>`;
    if (ctx.wizMap) ctx.wizMap.m.setIcon(pin('pick', workIcon(d.work_type)));
    if (!d.work_type) { ctx.root.querySelector('#supply').innerHTML = `<p class="muted small">${t('Choose the type of work to see the fair wage and how many workers are free.')}</p>`; return; }
    try {
      const q = new URLSearchParams({ work_type: d.work_type, lat: d.lat, lng: d.lng, date: d.date, duration_days: d.duration_days, workers_needed: d.workers_needed });
      const ins = await api(`/ai/insight?${q}`);
      const riskText = { low: t('Plenty of workers'), medium: t('Some competition for workers'), high: t('Workers will be hard to find') };
      ctx.root.querySelector('#supply').innerHTML = `
        <div class="panel-head"><h2>${icon('sparkle')}${t('Local market')}</h2><span class="level level-${ins.risk === 'high' ? 'tight' : ins.risk === 'medium' ? 'busy' : 'balanced'}">${riskText[ins.risk]}</span></div>
        <div class="row" style="align-items:baseline"><span class="num" style="font-size:2.2rem">${ins.supply}</span><span class="small muted">${t('skilled workers free within 25 km on these days')}</span></div>
        <hr class="divider">
        <div class="small muted">${t('Usual daily wage for this work nearby')}</div>
        <div class="num" style="font-size:1.5rem">${money(ins.range[0])} – ${money(ins.range[1])}</div>`;
      const hint = ctx.root.querySelector('#wage-hint');
      if (hint) {
        hint.innerHTML = d.wage < ins.suggested_wage
          ? `<div class="callout callout-action">${icon('rupee')}<div class="grow">${t('Jobs like this fill faster at {amt} a day.', { amt: money(ins.suggested_wage) })}</div><button type="button" class="btn btn-sm btn-action" data-act="useWage" data-v="${ins.suggested_wage}">${t('Use {amt}', { amt: money(ins.suggested_wage) })}</button></div>`
          : `<div class="callout">${icon('check')}<div>${t('{amt} is a fair wage for this work nearby.', { amt: money(d.wage) })}</div></div>`;
      }
    } catch { /* keep the previous panel */ }
  }, 200);

  const renderReview = () => {
    ctx.root.innerHTML = `
      <div class="page-head"><div><h1>${t('Review and post')}</h1><p>${t('Check everything once. Workers are alerted the moment you post.')}</p></div></div>
      ${wizardSteps()}
      <div class="wiz">
        <div class="stack">
          ${chit({ ...d, status: 'open' })}
          <section class="panel stack">
            ${d.facilities.length ? facilities(d.facilities) : `<p class="muted small">${t('No lunch, tea, transport or tools listed.')}</p>`}
            ${d.description ? `<p>${esc(d.description)}</p>` : ''}
            <button class="link-btn" data-act="toDetails">${icon('edit')}${t('Change details')}</button>
          </section>
          <div id="wx-review"></div>
        </div>
        <aside class="wiz-side"><section class="panel" id="forecast">${skeleton(1, 180)}</section></aside>
      </div>`;
    loadPreview();
  };

  const loadPreview = async () => {
    try {
      preview = await api('/jobs/preview', { method: 'POST', body: payload() });
    } catch (e) {
      ctx.root.querySelector('#forecast').innerHTML = `<div class="callout callout-bad">${icon('alert')}<div>${esc(e.message)}</div></div>`;
      return;
    }
    const p = preview;
    const prob = Math.round(p.forecast.probability * 100);
    const level = prob >= 75 ? '' : prob >= 40 ? 'mid' : 'low';
    ctx.root.querySelector('#forecast').innerHTML = `
      <div class="panel-head"><h2>${icon('sparkle')}${t('What to expect')}</h2></div>
      <div class="forecast"><span class="forecast-num ${level}">${Math.min(prob, 99)}%</span>
        <div><b>${t('chance of a full crew from the first alert')}</b></div></div>
      <p class="small muted" style="margin-top:10px">${t('{n} best-matched workers will be alerted now. About {e} are likely to accept.', { n: p.alert_count, e: p.forecast.expected })}</p>
      ${p.top.length ? `<div class="row" style="margin-top:12px"><div class="who-strip">${p.top.map((c) => avatar(c.worker.name, 'sm')).join('')}</div><span class="small muted">${p.top.slice(0, 2).map((c) => esc(c.worker.name)).join(', ')}${p.alert_count > 2 ? ` ${t('and {n} more', { n: p.alert_count - 2 })}` : ''}</span></div>` : ''}
      ${p.in_range < d.workers_needed ? `<div class="callout callout-bad" style="margin-top:14px">${icon('alert')}<div>${t('Only {n} available workers live within travel distance. We will widen the search automatically if the job is not filling.', { n: p.in_range })}</div></div>` : ''}
      ${d.wage < p.wage.median_wage ? `<div class="callout callout-action" style="margin-top:14px">${icon('rupee')}<div class="grow">${t('Your wage is below the local usual of {amt}.', { amt: money(p.wage.median_wage) })}</div><button class="btn btn-sm btn-action" data-act="useWage" data-v="${p.wage.suggested_wage}" data-reload="1">${t('Use {amt}', { amt: money(p.wage.suggested_wage) })}</button></div>` : ''}
      <button class="btn btn-primary btn-lg btn-block" style="margin-top:18px" data-act="post">${icon('bell')}${tn('Post and alert {n} worker', 'Post and alert {n} workers', p.alert_count)}</button>
      <button class="btn btn-ghost btn-block" style="margin-top:6px" data-act="toDetails">${t('Back to details')}</button>`;
    if (p.weather?.available) ctx.root.querySelector('#wx-review').innerHTML = weatherBadge(p.weather);
  };

  const renderDone = () => {
    const j = posted.job;
    ctx.root.innerHTML = `<div class="panel success" style="max-width:640px;margin:20px auto">
      <div class="success-mark">${icon('check')}</div>
      <h1>${t('Your work is posted')}</h1>
      <p class="muted">${tn('{n} best-matched worker has been alerted.', '{n} best-matched workers have been alerted.', posted.notified)} ${t('You will get a notification each time someone accepts.')}</p>
      <ol class="timeline next-steps">
        <li><b>${t('Workers decide')}</b><time>${t('Most replies come within an hour')}</time></li>
        <li><b>${t('Not filling?')}</b><time>${t('After {n} minutes we alert more workers further away', { n: 10 })}</time></li>
        <li><b>${t('On the day')}</b><time>${t('Workers check in when they reach the field')}</time></li>
      </ol>
      <div class="row" style="flex-wrap:wrap;justify-content:center;margin-top:10px">
        <a class="btn btn-primary" href="#/f/jobs/${j.id}">${t('Track this job')}</a>
        <a class="btn" href="https://wa.me/?text=${encodeURIComponent(shareText(j))}" target="_blank" rel="noopener">${icon('chat')}${t('Share on WhatsApp')}</a>
        <button class="btn btn-ghost" data-act="again">${icon('plus')}${t('Post another')}</button>
      </div>
    </div>`;
  };

  const payload = () => ({
    work_type: d.work_type, date: d.date, duration_days: d.duration_days, start_time: d.start_time,
    workers_needed: d.workers_needed, wage: d.wage, facilities: d.facilities, village: d.village, lat: d.lat, lng: d.lng,
    description: d.description,
  });

  render();

  ctx.actions = {
    parse: async () => {
      const text = ctx.root.querySelector('#desc').value.trim();
      if (!text) { toast(t('Describe the work first, or skip to fill it yourself'), { kind: 'error' }); return; }
      d.text = text;
      const p = await api('/ai/parse', { method: 'POST', body: { text } });
      apply(p);
      if (!d.description) d.description = text;
      step = 'details';
      render();
    },
    mic: (dd, el) => {
      el.classList.add('mic-on');
      const rec = listen((text) => { const a = ctx.root.querySelector('#desc'); a.value = `${a.value} ${text}`.trim(); });
      if (rec) rec.onend = () => el.classList.remove('mic-on'); else el.classList.remove('mic-on');
    },
    skip: () => { step = 'details'; found = []; render(); },
    set: (dd, el) => {
      d[dd.k] = dd.v;
      el.parentElement.querySelectorAll('[data-act="set"]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === dd.v));
      const input = ctx.root.querySelector(`[name="${dd.k}"]`);
      if (input) input.value = dd.v;
      updateSide();
    },
    bump: (dd) => {
      const max = dd.k === 'duration_days' ? 30 : 200;
      d[dd.k] = Math.max(1, Math.min(max, (Number(d[dd.k]) || 1) + Number(dd.delta)));
      ctx.root.querySelector(`[name="${dd.k}"]`).value = d[dd.k];
      updateSide();
    },
    fac: (dd, el) => {
      d.facilities = d.facilities.includes(dd.v) ? d.facilities.filter((x) => x !== dd.v) : [...d.facilities, dd.v];
      el.setAttribute('aria-pressed', d.facilities.includes(dd.v));
    },
    useWage: (dd) => {
      d.wage = Number(dd.v);
      const input = ctx.root.querySelector('[name="wage"]');
      if (input) { input.value = d.wage; input.classList.remove('flash'); void input.offsetWidth; input.classList.add('flash'); }
      if (dd.reload) renderReview(); else updateSide();
    },
    myFarm: () => {
      d.lat = me.lat; d.lng = me.lng; d.village = me.village;
      ctx.root.querySelector('[name="village"]').value = me.village;
      if (ctx.wizMap) { ctx.wizMap.map.setView([d.lat, d.lng], 14); ctx.wizMap.m.setLatLng([d.lat, d.lng]); }
      updateSide();
    },
    toDescribe: () => { step = 'describe'; render(); },
    toDetails: () => { step = 'details'; render(); },
    toReview: () => {
      if (!d.work_type) { toast(t('Choose the type of work'), { kind: 'error' }); ctx.root.querySelector('.tiles')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
      if (!d.date || d.date < state.meta.today) { toast(t('Choose a date from today onwards'), { kind: 'error' }); return; }
      if (!(d.wage >= 100)) { toast(t('Enter the daily wage'), { kind: 'error' }); return; }
      step = 'review';
      render();
    },
    post: async () => {
      posted = await api('/jobs', { method: 'POST', body: payload() });
      toast(t('Posted. Workers are being alerted.'), { kind: 'success' });
      step = 'done';
      render();
    },
    again: () => { location.hash = '#/f'; setTimeout(() => { location.hash = '#/f/post'; }, 0); },
  };
}

// ---------------------------------------------------------------- jobs list
export async function farmerJobs(ctx) {
  ctx.setTitle(t('My jobs'));
  let tab = ctx.query.tab || 'active';
  ctx.root.innerHTML = `<div class="page-head"><div><h1>${t('My jobs')}</h1><p>${t('Everything you have posted, with who is coming.')}</p></div><a class="btn btn-primary" href="#/f/post">${icon('plus')}${t('Post work')}</a></div>
    <div class="tabs" role="tablist" id="tabs"></div><div id="list" class="stack">${skeleton(3)}</div>`;
  const load = async () => {
    const all = await api('/jobs/mine');
    const groups = {
      active: all.filter((j) => ['open', 'filled'].includes(j.status)),
      completed: all.filter((j) => j.status === 'completed'),
      cancelled: all.filter((j) => j.status === 'cancelled'),
    };
    const names = { active: t('Active'), completed: t('Completed'), cancelled: t('Cancelled') };
    document.getElementById('tabs').innerHTML = Object.keys(groups).map((k) => `<button role="tab" aria-selected="${tab === k}" data-act="tab" data-v="${k}">${names[k]} <span class="count count-quiet">${groups[k].length}</span></button>`).join('');
    const list = groups[tab];
    document.getElementById('list').innerHTML = list.length ? list.map((j) => {
      let foot = progressFoot(j);
      if (j.status === 'completed') {
        const unpaid = j.crew.filter((c) => c.status === 'completed' && !c.paid).length;
        const unrated = j.crew.filter((c) => c.status === 'completed' && c.farmer_rating == null).length;
        foot = `<div class="chit-foot">${unpaid ? `<span class="tag tag-action">${icon('wallet')}${tn('{n} to pay', '{n} to pay', unpaid)}</span>` : `<span class="tag tag-good">${icon('check')}${t('All paid')}</span>`}
          ${unrated ? `<span class="tag tag-action">${icon('star')}${tn('{n} to rate', '{n} to rate', unrated)}</span>` : ''}
          <span class="small muted">${tn('{n} worker came', '{n} workers came', j.crew.filter((c) => c.status === 'completed').length)}</span></div>`;
      }
      if (j.status === 'cancelled') foot = j.cancel_reason ? `<p class="small muted">${esc(j.cancel_reason)}</p>` : '';
      return chit(j, { href: `#/f/jobs/${j.id}`, tag: badge(j.status), foot });
    }).join('') : emptyState('briefcase', tab === 'active' ? t('No active jobs') : tab === 'completed' ? t('No completed jobs yet') : t('No cancelled jobs'),
      tab === 'active' ? t('Post your next fieldwork and we will alert the right workers nearby.') : '', tab === 'active' ? `<a class="btn btn-primary" href="#/f/post">${icon('plus')}${t('Post work')}</a>` : '');
  };
  await load();
  ctx.onRefresh(load);
  ctx.actions = { tab: (d) => { tab = d.v; history.replaceState(null, '', `#/f/jobs?tab=${tab}`); load(); } };
}

// ---------------------------------------------------------------- job detail
const EVENT_TEXT = (e) => {
  const d = e.data || {};
  switch (e.type) {
    case 'posted': return [t('Posted for {n} workers at {wage} a day', { n: d.workers, wage: money(d.wage) }), ''];
    case 'alerted': return [d.count ? t('Alerted {n} workers within {km} km', { n: d.count, km: d.radius }) : t('Searched within {km} km, no new workers found', { km: d.radius }), d.round > 1 ? 'action' : ''];
    case 'invited': return [t('You invited {name}', { name: d.worker }), ''];
    case 'accepted': return [t('{name} accepted', { name: d.worker }), ''];
    case 'declined': return [t('A worker said no'), ''];
    case 'filled': return [t('Fully staffed'), ''];
    case 'withdrawn': return [t('{name} cancelled', { name: d.worker }), 'bad'];
    case 'checked_in': return [t('{name} reached the field', { name: d.worker }), ''];
    case 'completed': return [t('Marked complete'), ''];
    case 'paid': return [t('Paid {name} {amt} by {m}', { name: d.worker, amt: money(d.amount), m: d.method === 'upi' ? 'UPI' : t('cash') }), ''];
    case 'cancelled': return [t('Job cancelled'), 'bad'];
    default: return [e.type, ''];
  }
};

export async function farmerJob(ctx) {
  const id = Number(ctx.params.id);
  let tab = 'crew';
  let matchesCache = null;
  let showAll = false;
  let map = null;
  ctx.setTitle(t('Job'));
  ctx.root.innerHTML = `<a class="back" href="#/f/jobs">${icon('left')}${t('My jobs')}</a><div id="jd">${skeleton(3, 140)}</div>`;

  const load = async () => {
    let j;
    try { j = await api(`/jobs/${id}`); } catch (e) {
      document.getElementById('jd').innerHTML = emptyState('alert', t('This job could not be opened'), e.message);
      return;
    }
    if (j.viewer !== 'owner') { location.replace(`#/w/jobs/${id}`); return; }
    ctx.setTitle(workName(j.work_type));
    const t0 = today();
    const started = j.date <= t0;
    const active = ['open', 'filled'].includes(j.status);
    const canComplete = active && started && j.crew.some((c) => c.status === 'accepted');
    const deciding = j.pending;
    document.getElementById('jd').innerHTML = `
      <div class="cols">
        <div class="stack">
          ${chit(j, { tag: badge(j.status) })}
          <div class="row" style="flex-wrap:wrap">
            ${canComplete ? `<button class="btn btn-primary" data-act="complete">${icon('check')}${t('Mark work complete')}</button>` : ''}
            ${j.status === 'open' ? `<button class="btn ${canComplete ? '' : 'btn-primary'}" data-act="dispatch">${icon('radar')}${t('Alert more workers')}</button>` : ''}
            <a class="btn" href="https://wa.me/?text=${encodeURIComponent(shareText(j))}" target="_blank" rel="noopener">${icon('chat')}${t('Share')}</a>
            <button class="btn btn-ghost" data-act="copy">${icon('copy')}${t('Copy link')}</button>
            ${active ? `<button class="btn btn-ghost" data-act="cancel" style="color:var(--chilli)">${icon('x')}${t('Cancel job')}</button>` : ''}
          </div>

          ${active ? `<section class="panel statusband">
            ${ring(j.accepted_count, j.workers_needed, { size: 72 })}
            <div><b>${j.status === 'filled' ? t('Your crew is complete') : tn('{n} more worker needed', '{n} more workers needed', j.spots_left)}</b>
              <div class="stats" style="margin-top:6px">
                <span>${icon('bell')}${tn('{n} alerted', '{n} alerted', j.alerted)}</span>
                <span>${icon('clock')}${tn('{n} deciding', '{n} deciding', deciding)}</span>
                <span>${icon('x')}${tn('{n} said no', '{n} said no', j.declined)}</span>
                <span>${icon('radar')}${t('Searching up to {km} km', { km: j.radius_km })}</span>
              </div></div>
            <span></span>
          </section>` : ''}
          ${j.status === 'open' && j.pending < j.spots_left && j.notify_round >= 2 ? `<div class="callout callout-action">${icon('rupee')}<div>${t('Fewer people are deciding than spots left. Raising the wage or inviting workers from the AI matches tab helps.')}</div></div>` : ''}
          ${j.status === 'cancelled' ? `<div class="callout callout-bad">${icon('x')}<div><b>${t('Cancelled')}</b>${j.cancel_reason ? esc(j.cancel_reason) : ''}</div></div>` : ''}

          <section class="panel">
            <div class="tabs" role="tablist">
              <button role="tab" aria-selected="${tab === 'crew'}" data-act="tab" data-v="crew">${t('Crew')} <span class="count count-quiet">${j.crew.length}</span></button>
              ${active ? `<button role="tab" aria-selected="${tab === 'matches'}" data-act="tab" data-v="matches">${icon('sparkle')}${t('AI matches')}</button>` : ''}
              <button role="tab" aria-selected="${tab === 'activity'}" data-act="tab" data-v="activity">${t('Activity')}</button>
            </div>
            <div id="tabbody"></div>
          </section>
        </div>
        <aside class="cols-side">
          <div id="jmap" class="map"></div>
          <div id="jwx"></div>
          <section class="panel stack">
            <div class="panel-head" style="margin:0"><h2>${icon('info')}${t('Details')}</h2></div>
            <ul class="rows small">
              <li class="rowitem"><span class="grow muted">${t('Dates')}</span><b>${esc(dateShort(j.date))}${j.duration_days > 1 ? ` – ${esc(dateShort(j.end_date))}` : ''}</b></li>
              <li class="rowitem"><span class="grow muted">${t('Total wage bill')}</span><b>${money(j.wage * j.workers_needed * j.duration_days)}</b></li>
              <li class="rowitem"><span class="grow muted">${t('Posted')}</span><b>${esc(relTime(j.created_at))}</b></li>
            </ul>
            ${facilities(j.facilities)}
            ${j.description ? `<p class="small">${esc(j.description)}</p>` : ''}
          </section>
        </aside>
      </div>`;
    renderTab(j);
    if (map) { map.remove(); map = null; }
    map = createMap(document.getElementById('jmap'), { center: [j.lat, j.lng], zoom: 12 });
    if (map) {
      L.marker([j.lat, j.lng], { icon: pin('job', workIcon(j.work_type)) }).addTo(map).bindTooltip(t('Field'));
      const pts = [[j.lat, j.lng]];
      j.crew.forEach((c) => { L.circleMarker([c.lat, c.lng], { radius: 7, weight: 2, color: '#fff', fillColor: c.checked_in_at ? '#1f6b43' : '#e3a21a', fillOpacity: 1 }).addTo(map).bindTooltip(esc(c.name)); pts.push([c.lat, c.lng]); });
      fit(map, pts);
    } else document.getElementById('jmap').hidden = true;
    if (active && daysUntil(j.date) <= 15) {
      api(`/weather?lat=${j.lat}&lng=${j.lng}&date=${j.date}&end=${j.end_date}`).then((w) => { const el = document.getElementById('jwx'); if (el && w.available) el.innerHTML = weatherBadge(w); }).catch(() => {});
    }
    ctx.job = j;
  };

  const renderTab = async (j) => {
    const body = document.getElementById('tabbody');
    if (!body) return;
    if (tab === 'crew') body.innerHTML = crewList(j);
    else if (tab === 'activity') {
      body.innerHTML = j.events.length ? `<ol class="timeline">${j.events.map((e) => { const [txt, kind] = EVENT_TEXT(e); return `<li class="${kind ? `t-${kind}` : ''}"><b>${esc(txt)}</b><time>${esc(relTime(e.created_at))}</time></li>`; }).join('')}</ol>` : `<p class="muted">${t('No activity yet.')}</p>`;
    } else {
      if (!matchesCache) body.innerHTML = skeleton(3, 70);
      try { matchesCache = await api(`/jobs/${id}/matches`); } catch (e) { body.innerHTML = `<p class="muted">${esc(e.message)}</p>`; return; }
      body.innerHTML = matchesCache.length ? `<p class="small muted" style="margin-bottom:6px">${t('Ranked by how likely each worker is to accept and show up. Invite anyone who has not been alerted yet.')}</p>
        <ul class="rows">${(showAll ? matchesCache : matchesCache.slice(0, 12)).map((c) => `<li class="rowitem" style="align-items:flex-start">
          ${matchMeter(c.score)}
          <div class="rowitem-main">
            <b>${esc(c.worker.name)}${c.worker.verified ? icon('shield', 'verified') : ''}</b>
            <div class="rowitem-sub"><span>${esc(villageName(c.worker.village))}</span>${stars(c.worker.rating, { small: true })}<span>${tn('{n} job done', '{n} jobs done', c.worker.jobs_done)}</span></div>
            <div style="margin-top:8px">${reasons(c.reasons, 'farmer', { limit: 5 })}</div>
          </div>
          <div class="rowitem-actions">${c.status ? `<span class="tag ${c.status === 'accepted' ? 'tag-good' : c.status === 'declined' ? 'tag-bad' : c.status === 'invited' ? 'tag-info' : ''}">${esc({ accepted: t('Coming'), declined: t('Said no'), alerted: t('Alerted'), invited: t('Invited'), closed: t('Alerted') }[c.status] || c.status)}</span>`
    : `<button class="btn btn-sm btn-quiet" data-act="invite" data-w="${c.worker.id}">${icon('mail')}${t('Invite')}</button>`}</div>
        </li>`).join('')}</ul>${!showAll && matchesCache.length > 12 ? `<button class="btn btn-ghost btn-block" data-act="moreMatches">${t('Show all {n} workers', { n: matchesCache.length })}</button>` : ''}` : emptyState('users', t('No available workers in range'), t('Try raising the wage or alerting more workers further away.'));
    }
  };

  const crewList = (j) => {
    if (!j.crew.length) return emptyState('users', t('No one has accepted yet'), j.status === 'open' ? t('Alerted workers usually reply within an hour. You will get a notification for each one.') : '');
    const done = j.status === 'completed';
    return `<ul class="rows">${j.crew.map((c) => {
      const pay = c.amount || j.wage * j.duration_days;
      let right = `<a class="btn btn-sm btn-icon btn-quiet" href="${telHref(c.phone)}" aria-label="${t('Call {name}', { name: c.name })}">${icon('phone')}</a>
        <a class="btn btn-sm btn-icon btn-quiet" href="${waHref(c.phone)}" target="_blank" rel="noopener" aria-label="WhatsApp">${icon('chat')}</a>`;
      let extra = '';
      if (done && c.status === 'completed') {
        extra = `<div class="row" style="flex-wrap:wrap;margin-top:10px;gap:10px">
          ${c.farmer_rating ? `<span class="tag tag-good">${icon('star')}${t('You rated {n}', { n: c.farmer_rating })}</span>` : `<span class="small muted">${t('Rate')}</span>${starInput(`a${c.assignment_id}`, 0)}`}
          ${c.paid ? `<span class="tag tag-good">${icon('check')}${t('Paid {amt} by {m}', { amt: money(pay), m: c.pay_method === 'upi' ? 'UPI' : t('cash') })}</span>`
    : `<button class="btn btn-sm btn-action" data-act="paid" data-a="${c.assignment_id}" data-m="cash">${icon('wallet')}${t('Paid {amt} in cash', { amt: money(pay) })}</button>
             ${c.upi_id ? `<button class="btn btn-sm" data-act="upi" data-a="${c.assignment_id}" data-upi="${esc(c.upi_id)}" data-name="${esc(c.name)}" data-amt="${pay}">${t('Pay by UPI')}</button>` : ''}`}
        </div>`;
      }
      if (c.status === 'no_show') right = `<span class="tag tag-bad">${t('Did not come')}</span>`;
      return `<li class="rowitem crew-row" style="align-items:flex-start">
        ${avatar(c.name)}
        <div class="rowitem-main">
          <b>${esc(c.name)}${c.verified ? icon('shield', 'verified') : ''}</b>
          <div class="rowitem-sub"><span>${esc(villageName(c.village))}, ${t('{km} km', { km: c.distance })}</span>${stars(c.rating, { small: true })}<span>${esc(phoneLabel(c.phone))}</span>
            ${!done && started(j) ? (c.checked_in_at ? `<span class="checkin-yes">${icon('check')}${t('Arrived {time}', { time: clockTime(c.checked_in_at) })}</span>` : `<span class="checkin-no">${t('Not arrived yet')}</span>`) : ''}</div>
          ${extra}
        </div>
        <div class="rowitem-actions">${right}</div>
      </li>`;
    }).join('')}</ul>`;
  };
  const started = (j) => j.date <= today();

  await load();
  ctx.onRefresh(load);
  ctx.onCleanup(() => { if (map) map.remove(); });

  ctx.actions = {
    tab: (d) => { tab = d.v; document.querySelectorAll('.tabs [role=tab]').forEach((b) => b.setAttribute('aria-selected', b.dataset.v === tab)); renderTab(ctx.job); },
    dispatch: () => dispatchMore(id),
    moreMatches: () => { showAll = true; renderTab(ctx.job); },
    invite: async (d, el) => {
      await api(`/jobs/${id}/invite`, { method: 'POST', body: { worker_id: Number(d.w) } });
      el.outerHTML = `<span class="tag tag-info">${t('Invited')}</span>`;
      toast(t('Invitation sent'), { kind: 'success' });
    },
    copy: async () => {
      const url = `${location.origin}/#/job/${id}`;
      try { await navigator.clipboard.writeText(url); toast(t('Link copied'), { kind: 'success' }); } catch { toast(url); }
    },
    cancel: async () => {
      const reason = await confirmDialog({
        title: t('Cancel this job?'), body: t('Everyone who accepted will be told the work is cancelled.'),
        confirm: t('Cancel job'), cancel: t('Keep job'), danger: true, input: { label: t('Reason (optional)'), placeholder: t('Example: Rain expected') },
      });
      if (reason === false) return;
      await api(`/jobs/${id}/cancel`, { method: 'POST', body: { reason } });
      toast(t('Job cancelled. Workers have been told.'));
      load();
    },
    complete: async () => {
      const j = ctx.job;
      const crew = j.crew.filter((c) => c.status === 'accepted');
      const attendance = Object.fromEntries(crew.map((c) => [c.id, 'present']));
      const dlg = modal(`<div class="modal-body">
        <h2>${t('Who came to work?')}</h2>
        <p class="muted">${t('Workers who came get paid {amt} each and their record improves. Marking someone absent lowers their reliability.', { amt: money(j.wage * j.duration_days) })}</p>
        <ul class="rows">${crew.map((c) => `<li class="rowitem">${avatar(c.name, 'sm')}<div class="rowitem-main"><b>${esc(c.name)}</b>${c.checked_in_at ? `<div class="rowitem-sub"><span class="checkin-yes">${icon('check')}${t('Checked in')}</span></div>` : ''}</div>
          <div class="attend" role="group"><button type="button" class="yes" aria-pressed="true" data-w="${c.id}" data-v="present">${t('Came')}</button><button type="button" class="no" aria-pressed="false" data-w="${c.id}" data-v="no_show">${t('Did not come')}</button></div></li>`).join('')}</ul>
        <div class="modal-actions"><button class="btn btn-ghost" data-close>${t('Go back')}</button><button class="btn btn-primary" data-confirm>${t('Mark work complete')}</button></div></div>`, { label: t('Who came to work?') });
      dlg.addEventListener('click', async (e) => {
        const b = e.target.closest('.attend button');
        if (b) {
          attendance[b.dataset.w] = b.dataset.v;
          b.parentElement.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === b));
        }
        if (e.target.closest('[data-close]')) dlg.close();
        const c = e.target.closest('[data-confirm]');
        if (c) {
          c.classList.add('loading');
          try {
            await api(`/jobs/${id}/complete`, { method: 'POST', body: { attendance } });
            dlg.close();
            toast(t('Work marked complete. Now rate and pay your crew.'), { kind: 'success' });
            tab = 'crew';
            load();
          } catch (err) { c.classList.remove('loading'); toast(err.message, { kind: 'error' }); }
        }
      });
    },
    star: async (d) => {
      const aid = d.name.slice(1);
      await api(`/assignments/${aid}/review`, { method: 'POST', body: { rating: Number(d.value) } });
      toast(t('Rating saved'), { kind: 'success' });
      load();
    },
    paid: async (d) => {
      await api(`/assignments/${d.a}/paid`, { method: 'POST', body: { method: d.m } });
      toast(t('Payment recorded'), { kind: 'success' });
      load();
    },
    upi: async (d) => {
      const url = `upi://pay?pa=${encodeURIComponent(d.upi)}&pn=${encodeURIComponent(d.name)}&am=${d.amt}&cu=INR&tn=${encodeURIComponent('PolamPani wages')}`;
      window.location.href = url;
      const ok = await confirmDialog({ title: t('Did the UPI payment go through?'), body: t('Your UPI app opens to pay {amt} to {upi}. Confirm here once it is done.', { amt: money(d.amt), upi: d.upi }), confirm: t('Yes, it is paid') });
      if (!ok) return;
      await api(`/assignments/${d.a}/paid`, { method: 'POST', body: { method: 'upi' } });
      toast(t('Payment recorded'), { kind: 'success' });
      load();
    },
  };
}

export { num, facilityName, reasons };
