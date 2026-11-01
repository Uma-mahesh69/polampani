// Public pages: landing, impact, shared job.
import {
  state, api, esc, debounce, addDays, money, num, pct, dateShort, dateLong,
} from '../core.js';
import { t, tn, workName, villageName } from '../i18n.js';
import {
  icon, logo, chit, avatar, stars, facilities, emptyState, toast, listen, skeleton, weatherBadge,
} from '../ui.js';
import { hbars, vbars, bindTooltips, table } from '../charts.js';
import { createMap, pin } from '../map.js';
import { modelCard } from './shared.js';

export function publicHeader() {
  const loggedIn = !!state.me;
  return `<header class="public-top">
    <a class="brand" href="#/">${logo(36)}<span class="brand-name">PolamPani<small>పొలం పని</small></span></a>
    <nav>
      <a class="btn btn-ghost btn-sm hide-sm" href="#/impact">${t('Impact')}</a>
      <a class="btn btn-ghost btn-sm hide-sm" href="${state.meta.repo_url}" target="_blank" rel="noopener">${icon('github')}<span>GitHub</span></a>
      <button class="btn btn-ghost btn-sm" data-act="lang">${icon('lang')}<span>${state.lang === 'te' ? 'English' : 'తెలుగు'}</span></button>
      ${loggedIn
    ? `<a class="btn btn-primary btn-sm" href="#/${state.me.role === 'farmer' ? 'f' : 'w'}">${t('Open app')}</a>`
    : `<a class="btn btn-primary btn-sm" href="#/login">${icon('login')}<span>${t('Log in')}</span></a>`}
    </nav>
  </header>`;
}

const EXAMPLES = [
  { label: 'Telugu', text: 'రేపు ఉదయం 6 గంటలకి అనకాపల్లిలో వరి కోతలకు 8 మంది కావాలి, కూలి 600, భోజనం ఉంటుంది' },
  { label: 'Hindi', text: 'कल सुबह 6 बजे अनकापल्ली में 8 मजदूर धान कटाई के लिए चाहिए, 600 रुपये, खाना मिलेगा' },
  { label: 'Tamil', text: 'நாளை காலை 6 மணிக்கு நடவு வேலைக்கு 8 ஆட்கள் வேணும், கூలి 600, சாப்பாடு உண்டு' },
  { label: 'Kannada', text: 'ನಾಳೆ ಬೆಳಗ್ಗೆ 6 ಗಂಟೆಗೆ 5 ಜನ ನಾಟಿ ಕೆಲಸಕ್ಕೆ ಬೇಕು, ಕೂಲಿ 550, ಊಟ ಉಂಟು' },
  { label: 'English', text: 'Need 5 people for sugarcane cutting in Chodavaram on Saturday for 2 days, 650 per day' },
  { label: 'Telugu in English letters', text: 'ellundi sabbavaram lo kalupu pani ki naluguru kavali, rs 450' },
];

export async function landing(ctx) {
  ctx.root.innerHTML = `${publicHeader()}
  <main>
    <section class="hero">
      <div>
        <h1 class="hero-quote" lang="te"><q>రేపు ఉదయం 6 గంటలకి, 8 మంది కూలీలు కావాలి.</q></h1>
        ${state.lang === 'en' ? '<p class="hero-translation">“Tomorrow, 6 in the morning, I need 8 workers.”</p>' : ''}
        <p class="hero-lede">${t('Say it the way you would tell a neighbour. PolamPani turns it into a work request and alerts the right labourers nearby within seconds.')}</p>
        <div class="hero-ctas">
          <a class="btn btn-primary btn-lg" href="#/login?role=farmer">${icon('users')}${t('I need workers')}</a>
          <a class="btn btn-lg" href="#/login?role=worker">${icon('briefcase')}${t('I am looking for work')}</a>
        </div>
        <p class="hero-live" id="live"></p>
      </div>
      <div class="try" aria-labelledby="try-label">
        <h2 class="try-title"><label id="try-label" for="try-text">${t('Try it: type or speak a request')}</label></h2>
        <div class="try-input">
          <textarea id="try-text" rows="3">${esc(EXAMPLES[0].text)}</textarea>
          <button class="btn btn-icon" data-act="tryMic" aria-label="${t('Speak')}">${icon('mic')}</button>
        </div>
        <div class="try-examples">${EXAMPLES.map((e, i) => `<button data-act="tryExample" data-i="${i}">${t(e.label)}</button>`).join('')}</div>
        <div id="try-chit"></div>
        <div class="try-found" id="try-found" aria-live="polite"></div>
      </div>
    </section>

    <section class="band" aria-labelledby="how">
      <h2 id="how">${t('From a sentence to a full crew, without a single phone call')}</h2>
      <ol class="steps">
        <li><b>${t('Farmer posts the work')}</b><p>${t('By typing or speaking, in Telugu or English. AI fills in the details.')}</p></li>
        <li><b>${t('AI picks the best matches')}</b><p>${t('Ranked by distance, skill, free days, fair wage and past reliability.')}</p></li>
        <li><b>${t('Workers get an alert')}</b><p>${t('They hear it read aloud and accept with one tap. SMS for basic phones.')}</p></li>
        <li><b>${t('Not filling? It searches wider')}</b><p>${t('Unfilled jobs and cancellations trigger a wider search automatically.')}</p></li>
      </ol>
    </section>

    <section class="band" aria-labelledby="feat">
      <h2 id="feat">${t('Made for how fieldwork is actually hired')}</h2>
      <ul class="features">
        <li>${icon('mic')}<div><b>${t('Speak in any Indian language')}</b><p>${t('Voice and text in Telugu, Hindi, Tamil, Kannada, English or Roman script. Every alert can be read aloud.')}</p></div></li>
        <li>${icon('sparkle')}<div><b>${t('Matching you can see into')}</b><p>${t('Every match shows why: distance, skills, free days, wage. No black box.')}</p></div></li>
        <li>${icon('rupee')}<div><b>${t('Fair wage guidance')}</b><p>${t('Farmers see the going rate nearby and how many skilled workers are free that day.')}</p></div></li>
        <li>${icon('radar')}<div><b>${t('No work left undone')}</b><p>${t('If a job is not filling or someone cancels, the search radius widens on its own.')}</p></div></li>
        <li>${icon('shield')}<div><b>${t('Trust on both sides')}</b><p>${t('Verified phone numbers, attendance check-in, ratings and a record of every payment.')}</p></div></li>
        <li>${icon('phone')}<div><b>${t('Works on basic phones')}</b><p>${t('Alerts go out by SMS too, and the app is light enough for a slow village connection.')}</p></div></li>
      </ul>
    </section>

    ${state.meta.demo_mode ? `<section class="band" id="demo" aria-labelledby="demo-h">
      <h2 id="demo-h">${t('Explore with a demo account')}</h2>
      <p>${t('These accounts have live jobs, alerts and history around Visakhapatnam. Open a farmer and a worker in two windows to see alerts arrive in real time.')}</p>
      <div class="demo" id="demo-list">${skeleton(2, 120)}</div>
    </section>` : ''}

    <section class="oss">
      <div class="band">
        <h2>${t('Open source, and built to run anywhere')}</h2>
        <p>${t('PolamPani is MIT licensed. The matching model runs on your own server with no paid AI service, so a farmer cooperative, an FPO or a panchayat can run it for their own villages.')}</p>
        <div class="oss-grid">
          <div><b>${t('Transparent AI')}</b><p>${t('An explainable model that learns from every accept, decline and no-show. Inspect it on the Impact page.')}</p></div>
          <div><b>${t('Local by default')}</b><p>${t('Fonts, maps code and AI run from your server. Add your district’s villages and crops in one file.')}</p></div>
          <div><b>${t('Contributions welcome')}</b><p>${t('Translations, village lists and crop calendars are the easiest places to start.')}</p></div>
        </div>
        <p style="margin-top:28px"><a class="btn btn-action" href="${state.meta.repo_url}" target="_blank" rel="noopener">${icon('github')}${t('View on GitHub')}</a></p>
      </div>
    </section>
  </main>
  <footer class="site-foot"><span>PolamPani is open source under the MIT licence</span><span>${t('Built at Hacktoberfest Hack Day × AI for Vizag')}</span></footer>`;

  api('/stats').then((s) => {
    const el = document.getElementById('live');
    if (el) el.innerHTML = `<span><span class="pulse"></span><b>${s.open_jobs}</b>${t('jobs open now')}</span><span><b>${s.workers_ready}</b>${t('workers ready')}</span><span><b>${s.villages}</b>${t('villages')}</span>`;
  }).catch(() => {});

  if (state.meta.demo_mode) {
    api('/auth/demo-accounts').then(({ farmers, workers }) => {
      const el = document.getElementById('demo-list');
      if (!el) return;
      const btn = (u, role) => `<button class="demo-btn" data-act="demoLogin" data-id="${u.id}">${avatar(u.name)}<span><b>${esc(u.name)}</b><small>${esc(villageName(u.village))}</small>${role === 'worker' && u.alerts ? `<small class="demo-alerts">${tn('{n} new alert', '{n} new alerts', u.alerts)}</small>` : ''}</span>${icon('right')}</button>`;
      el.innerHTML = `<div class="demo-col"><h3>${icon('sprout')}${t('Farmers')}</h3><div class="demo-list">${farmers.slice(0, 4).map((u) => btn(u, 'farmer')).join('')}</div></div>
        <div class="demo-col"><h3>${icon('briefcase')}${t('Workers')}</h3><div class="demo-list">${workers.slice(0, 4).map((u) => btn(u, 'worker')).join('')}</div></div>`;
    }).catch(() => {});
  }

  const area = document.getElementById('try-text');
  const render = async () => {
    const text = area.value.trim();
    if (!text) return;
    try {
      const r = await api('/ai/parse', { method: 'POST', body: { text } });
      const job = {
        work_type: r.work_type || 'paddy_harvesting', village: r.village || 'Anakapalli', date: r.date || addDays(1),
        start_time: r.start_time || '07:00', workers_needed: r.workers_needed || 5, wage: r.wage || 500,
        duration_days: r.duration_days || 1, status: 'open',
      };
      document.getElementById('try-chit').innerHTML = chit(job);
      const fields = [['work_type', t('Work')], ['workers_needed', t('Workers')], ['date', t('Date')], ['start_time', t('Time')], ['wage', t('Wage')], ['village', t('Village')]];
      const aiBadge = r.source === 'ai'
        ? `<span class="try-ai-tag">${icon('sparkle')} ${t('Parsed by AI')}${r.model ? ` (${esc(r.model)})` : ''}</span>`
        : `<span class="try-ai-tag offline">${icon('sparkle')} ${t('Parsed by offline rules')}</span>`;
      document.getElementById('try-found').innerHTML = `${fields.map(([k, label]) => `<span class="${r[k] != null ? '' : 'miss'}">${icon(r[k] != null ? 'check' : 'minus')}${label}</span>`).join('')} ${aiBadge}`;
    } catch { /* keep last render */ }
  };
  const debounced = debounce(render, 350);
  area.addEventListener('input', debounced);
  render();

  ctx.actions = {
    tryExample: (d) => { area.value = EXAMPLES[Number(d.i)].text; render(); },
    tryMic: () => listen((text) => { area.value = text; render(); }),
  };
}


export async function impact(ctx) {
  ctx.root.innerHTML = `${publicHeader()}<main class="content" style="max-width:1100px">
    <div class="page-head"><div><h1>${t('Impact around Visakhapatnam')}</h1><p>${t('Live numbers from this PolamPani server. Demo data includes 30 days of simulated history.')}</p></div></div>
    <div id="impact">${skeleton(3, 140)}</div></main>`;
  const d = await api('/impact');
  const shortDay = (s) => new Intl.DateTimeFormat(state.lang === 'te' ? 'te-IN' : 'en-IN', { day: 'numeric', month: 'short' }).format(new Date(`${s}T00:00`));
  const byType = d.by_type.map((r) => ({ label: workName(r.work_type), value: r.workers, tip: t('{work}: {n} workers requested in {jobs} jobs', { work: workName(r.work_type), n: r.workers, jobs: r.jobs }) }));
  const daily = d.daily.map((r) => ({ label: shortDay(r.date), value: r.posted, tip: t('{date}: {n} posted, {f} filled', { date: shortDay(r.date), n: r.posted, f: r.filled }) }));
  document.getElementById('impact').innerHTML = `
    <div class="kpis impact-kpis">
      <div class="kpi"><div class="kpi-label">${t('Workdays created')}</div><div class="kpi-value">${num(d.workdays)}</div><div class="kpi-note">${t('{n} workers earning', { n: d.workers_earning })}</div></div>
      <div class="kpi"><div class="kpi-label">${t('Wages earned')}</div><div class="kpi-value">${money(d.wages_earned)}</div><div class="kpi-note">${t('{amt} more booked', { amt: money(d.wages_booked) })}</div></div>
      <div class="kpi"><div class="kpi-label">${t('Jobs fully staffed')}</div><div class="kpi-value">${pct(d.fill_rate)}</div><div class="kpi-note">${t('{n} of {m} jobs', { n: d.jobs_filled, m: d.jobs_posted })}</div></div>
      <div class="kpi"><div class="kpi-label">${t('Typical time to fill')}</div><div class="kpi-value">${d.median_fill_minutes != null ? (d.median_fill_minutes < 120 ? t('{n} min', { n: d.median_fill_minutes }) : t('{n} hrs', { n: Math.round(d.median_fill_minutes / 60) })) : '–'}</div><div class="kpi-note">${t('from posting to full crew')}</div></div>
    </div>
    <div class="cols" style="margin-top:24px">
      <div class="stack">
        <section class="panel">
          <div class="panel-head"><h2>${icon('users')}${t('Workers requested by type of work')}</h2><button class="link-btn small" data-act="toggleTable" data-t="t1">${t('Show table')}</button></div>
          <div class="chart">${hbars(byType)}</div>
          <div id="t1" hidden>${table([t('Work'), t('Workers')], d.by_type.map((r) => [workName(r.work_type), r.workers]))}</div>
        </section>
        <section class="panel">
          <div class="panel-head"><h2>${icon('chart')}${t('Jobs posted per day, last 14 days')}</h2><button class="link-btn small" data-act="toggleTable" data-t="t2">${t('Show table')}</button></div>
          <div class="chart">${vbars(daily)}</div>
          <div id="t2" hidden>${table([t('Date'), t('Posted'), t('Filled')], d.daily.map((r) => [shortDay(r.date), r.posted, r.filled]))}</div>
        </section>
      </div>
      <div class="cols-side">
        <section class="panel">${modelCard(d.model)}</section>
        <section class="panel">
          <div class="panel-head"><h2>${icon('layers')}${t('Reach')}</h2></div>
          <ul class="rows small">
            <li class="rowitem"><span class="grow">${t('Farmers')}</span><b>${num(d.farmers)}</b></li>
            <li class="rowitem"><span class="grow">${t('Workers')}</span><b>${num(d.workers)}</b></li>
            <li class="rowitem"><span class="grow">${t('Villages with jobs')}</span><b>${num(d.villages)}</b></li>
            <li class="rowitem"><span class="grow">${t('Smart alerts sent')}</span><b>${num(d.alerts_sent)}</b></li>
          </ul>
        </section>
      </div>
    </div>`;
  bindTooltips(ctx.root);
  ctx.actions = {
    toggleTable: (dd, el) => {
      const tb = document.getElementById(dd.t);
      tb.hidden = !tb.hidden;
      el.textContent = tb.hidden ? t('Show table') : t('Hide table');
    },
  };
}

export async function publicJob(ctx) {
  const id = ctx.params.id;
  if (state.me) {
    location.replace(`#/${state.me.role === 'farmer' ? 'f' : 'w'}/jobs/${id}`);
    return;
  }
  ctx.root.innerHTML = `${publicHeader()}<main class="content" style="max-width:760px"><div id="pj">${skeleton(2, 140)}</div></main>`;
  let job;
  try { job = await api(`/jobs/${id}`); } catch (e) {
    document.getElementById('pj').innerHTML = emptyState('alert', t('This job is not available'), e.message, `<a class="btn btn-primary" href="#/">${t('Go to PolamPani')}</a>`);
    return;
  }
  const open = job.status === 'open';
  document.getElementById('pj').innerHTML = `
    <div class="stack">
      <p class="muted">${t('{name} is looking for workers', { name: esc(job.farmer.name) })}</p>
      ${chit(job)}
      <section class="panel stack">
        ${job.description ? `<p>${esc(job.description)}</p>` : ''}
        ${facilities(job.facilities)}
        <div class="row">${avatar(job.farmer.name)}<div><b>${esc(job.farmer.name)}</b><div class="row small muted" style="gap:10px">${esc(villageName(job.farmer.village))}${stars(job.farmer.rating, { small: true })}</div></div></div>
        <div id="pj-map" class="map"></div>
      </section>
      ${open ? `<div class="callout callout-action">${icon('users')}<div><b>${t('{n} spots left', { n: job.spots_left })}</b>${t('Log in with your phone number to accept this work.')}</div></div>
        <a class="btn btn-primary btn-lg btn-block" href="#/login?role=worker&next=${encodeURIComponent(`/w/jobs/${job.id}`)}">${t('Log in to accept')}</a>`
    : `<div class="callout">${icon('info')}<div>${t('This job is no longer taking workers.')}</div></div>`}
    </div>`;
  const map = createMap(document.getElementById('pj-map'), { center: [job.lat, job.lng], zoom: 12 });
  if (map) L.marker([job.lat, job.lng], { icon: pin('job', state.wt[job.work_type]?.icon) }).addTo(map);
  else document.getElementById('pj-map').hidden = true;
}

export { dateLong, dateShort, weatherBadge };
