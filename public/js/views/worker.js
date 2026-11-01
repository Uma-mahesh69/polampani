// Worker: find work (alerts + ranked feed), job detail, my work and earnings.
import {
  state, api, esc, money, today, dateLong, dateShort, timeLabel, daysUntil, relTime, clockTime, telHref, waHref,
  mapsHref, greetingKey, weekdayName,
} from '../core.js';
import { t, tn, workName, workIcon, villageName, speakableJob, reasonText } from '../i18n.js';
import {
  icon, chit, matchMeter, reasons, facilities, avatar, stars, starInput, emptyState, skeleton, toast, confirmDialog,
  speak, weatherBadge, badge,
} from '../ui.js';
import { createMap, pin, fit } from '../map.js';
import { outlookList } from './shared.js';

const firstName = (n) => String(n || '').split(' ')[0];
const reasonLine = (r) => reasonText(r, 'worker');

function daysSummary(days) {
  const sorted = [1, 2, 3, 4, 5, 6, 0].filter((d) => days.includes(d));
  if (sorted.length === 7) return t('every day');
  return sorted.map((d) => weekdayName(d)).join(', ');
}

async function respond(kind, id, opts = {}) {
  if (kind === 'accept') {
    await api(`/jobs/${id}/accept`, { method: 'POST' });
    toast(t('You are booked. The farmer has been told.'), { kind: 'success' });
  } else {
    await api(`/jobs/${id}/decline`, { method: 'POST' });
    if (!opts.quiet) toast(t('Okay. We will keep looking for better work for you.'));
  }
}

// ---------------------------------------------------------------- find work
export async function workerFeed(ctx) {
  const me = state.me;
  ctx.setTitle(t('Find work'));
  const filters = { work_type: '', max_km: '', sort: 'match' };
  ctx.root.innerHTML = `
    <div class="page-head"><div><h1>${t(greetingKey())}, ${esc(firstName(me.name))}</h1><p>${esc(dateLong(today()))}</p></div></div>
    <div class="cols">
      <div class="stack-lg">
        <div id="avail"></div>
        <section id="alerts-sec"></section>
        <section>
          <div class="section-title"><h2>${t('Work near you')}</h2><span class="small muted">${t('Ranked by AI for you')}</span></div>
          <div class="filters" role="group" aria-label="${t('Filters')}">
            <select id="f-type" aria-label="${t('Type of work')}"><option value="">${t('All work')}</option>${state.meta.work_types.map((w) => `<option value="${w.id}">${esc(state.lang === 'te' ? w.te : w.en)}</option>`).join('')}</select>
            <div class="seg" role="group" aria-label="${t('Distance')}">${[['', t('Any distance')], ['10', '10 km'], ['20', '20 km'], ['30', '30 km']].map(([v, l]) => `<button data-act="km" data-v="${v}" aria-pressed="${filters.max_km === v}">${l}</button>`).join('')}</div>
            <select id="f-sort" aria-label="${t('Sort')}"><option value="match">${t('Best match')}</option><option value="wage">${t('Highest wage')}</option><option value="distance">${t('Nearest')}</option><option value="date">${t('Soonest')}</option></select>
          </div>
          <div id="feed" class="stack">${skeleton(3)}</div>
        </section>
      </div>
      <aside class="cols-side">
        <section class="panel" id="earn"></section>
        <section class="panel" id="next" hidden></section>
        <section class="panel"><div class="panel-head"><h2>${icon('trend')}${t('Work coming up near you')}</h2></div><div id="outlook">${skeleton(1, 120)}</div></section>
      </aside>
    </div>`;

  const renderAvail = () => {
    const m = state.me;
    document.getElementById('avail').innerHTML = `<div class="avail ${m.available ? 'on' : ''}">
      <button class="switch" role="switch" aria-checked="${m.available}" data-act="avail" aria-label="${t('Available for work')}"><span class="track"></span></button>
      <div class="grow"><b>${m.available ? t('You are available for work') : t('You are not taking work right now')}</b>
        <div class="small muted">${m.available ? t('Farmers within {km} km can alert you, {days}.', { km: m.radius_km, days: daysSummary(m.available_days) }) : t('Turn this on to get job alerts again.')}</div></div>
      <a class="btn btn-sm ${m.available ? 'btn-ghost' : ''}" href="#/profile" style="${m.available ? 'color:#fff' : ''}">${icon('sliders')}${t('Edit')}</a>
    </div>`;
  };

  const load = async () => {
    const q = new URLSearchParams(Object.entries(filters).filter(([, v]) => v));
    const [feed, notifs, work, season] = await Promise.all([
      api(`/feed?${q}`), api('/notifications'), api('/work'), api('/ai/season'),
    ]);
    renderAvail();
    const pending = new Set(notifs.filter((n) => ['job_match', 'invite'].includes(n.type) && !n.responded && n.job_status === 'open').map((n) => n.job_id));
    const alerts = feed.filter((r) => pending.has(r.job.id));
    const rest = feed.filter((r) => !pending.has(r.job.id));

    document.getElementById('alerts-sec').innerHTML = alerts.length ? `
      <div class="section-title"><h2>${t('New alerts for you')} <span class="count">${alerts.length}</span></h2></div>
      <div class="stack">${alerts.map((r) => alertCard(r)).join('')}</div>` : '';

    document.getElementById('feed').innerHTML = rest.length ? rest.slice(0, 20).map((r) => chit({ ...r.job, distance: r.distance }, {
      href: `#/w/jobs/${r.job.id}`,
      tag: matchMeter(r.score),
      foot: `${reasons(r.reasons, 'worker', { limit: 3, filter: (x) => x.code !== 'distance' })}<div class="small muted">${tn('{n} spot left', '{n} spots left', r.job.spots_left)}${r.job.farmer_name ? `, ${t('posted by {name}', { name: esc(r.job.farmer_name) })}` : ''}</div>`,
    })).join('') : emptyState('search', t('No other open work matches these filters'), t('Try a longer distance or all types of work. New jobs appear here as soon as they are posted.'));

    const e = work.earnings;
    document.getElementById('earn').innerHTML = `<div class="panel-head"><h2>${icon('wallet')}${t('Your earnings')}</h2><a class="small" href="#/w/work">${t('Details')}</a></div>
      <div class="earn-big">${money(e.last_30d)}</div><div class="small muted">${t('earned in the last 30 days')}</div>
      ${e.unpaid ? `<div class="callout callout-action" style="margin-top:12px">${icon('rupee')}<div>${t('{amt} still to be paid by farmers', { amt: money(e.unpaid) })}</div></div>` : ''}
      ${e.upcoming_value ? `<p class="small" style="margin-top:10px">${t('{amt} more from work you have booked', { amt: money(e.upcoming_value) })}</p>` : ''}`;

    const nextJob = work.upcoming[0];
    const nx = document.getElementById('next');
    if (nextJob) {
      nx.hidden = false;
      const isToday = nextJob.date <= today() && nextJob.end_date >= today();
      nx.innerHTML = `<div class="panel-head"><h2>${icon('calendar')}${isToday ? t('Today') : t('Your next work')}</h2></div>
        ${chit(nextJob, { href: `#/w/jobs/${nextJob.id}`, compact: true, narrow: true })}
        ${isToday && !nextJob.checked_in_at ? `<button class="btn btn-action btn-block" style="margin-top:10px" data-act="checkin" data-id="${nextJob.id}">${icon('pin')}${t('I have reached the field')}</button>` : ''}`;
    } else nx.hidden = true;
    document.getElementById('outlook').innerHTML = outlookList(season, { worker: true });
  };

  const alertCard = (r) => `<article class="stack" style="gap:0">
    ${chit({ ...r.job, distance: r.distance }, {
    highlight: true,
    tag: matchMeter(r.score),
    foot: `${reasons(r.reasons, 'worker', { limit: 4, filter: (x) => x.code !== 'distance' })}
        <div class="chit-actions">
          <button class="btn btn-primary" data-act="accept" data-id="${r.job.id}">${icon('check')}${t('Accept')}</button>
          <button class="btn" data-act="decline" data-id="${r.job.id}">${t('Not this time')}</button>
          <button class="btn btn-ghost btn-icon" data-act="listen" data-id="${r.job.id}" aria-label="${t('Read aloud')}">${icon('volume')}</button>
          <a class="btn btn-ghost" href="#/w/jobs/${r.job.id}">${t('Details')}</a>
        </div>`,
  })}</article>`;

  await load();
  ctx.onRefresh(load);
  ctx.root.querySelector('#f-type').addEventListener('change', (e) => { filters.work_type = e.target.value; load(); });
  ctx.root.querySelector('#f-sort').addEventListener('change', (e) => { filters.sort = e.target.value; load(); });

  ctx.actions = {
    avail: async () => {
      state.me = await api('/me', { method: 'PATCH', body: { available: !state.me.available } });
      renderAvail();
      toast(state.me.available ? t('You will get job alerts again') : t('Alerts paused. Turn it back on any time.'));
    },
    km: (d, el) => { filters.max_km = d.v; el.parentElement.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b === el)); load(); },
    accept: async (d) => { await respond('accept', d.id); ctx.go(`#/w/jobs/${d.id}`); },
    decline: async (d) => { await respond('decline', d.id); load(); },
    listen: async (d) => { speak(speakableJob(await api(`/jobs/${d.id}`))); },
    checkin: async (d) => { await api(`/jobs/${d.id}/checkin`, { method: 'POST' }); toast(t('Checked in. The farmer can see you have arrived.'), { kind: 'success' }); load(); },
  };
}

// ---------------------------------------------------------------- job detail
export async function workerJob(ctx) {
  const id = Number(ctx.params.id);
  let map = null;
  ctx.setTitle(t('Work details'));
  ctx.root.innerHTML = `<a class="back" href="#/w">${icon('left')}${t('Find work')}</a><div id="wj">${skeleton(3, 140)}</div>`;

  const load = async () => {
    let j;
    try { j = await api(`/jobs/${id}`); } catch (e) {
      document.getElementById('wj').innerHTML = emptyState('alert', t('This work could not be opened'), e.message, `<a class="btn btn-primary" href="#/w">${t('Find other work')}</a>`);
      return;
    }
    ctx.setTitle(workName(j.work_type));
    const b = j.booking;
    const booked = b?.status === 'accepted';
    const t0 = today();
    const onDay = j.date <= t0 && j.end_date >= t0;
    const canAccept = j.status === 'open' && !b && !j.clash && j.end_date >= t0;

    let status = '';
    if (booked) {
      status = `<div class="callout">${icon('check')}<div class="grow"><b>${onDay ? t('You are working here today') : t('You are booked for this work')}</b>
        ${b.checked_in_at ? t('Checked in at {time}', { time: clockTime(b.checked_in_at) }) : onDay ? t('Check in when you reach the field so the farmer knows.') : t('Starts {when}, {time}', { when: daysUntil(j.date) === 1 ? t('tomorrow') : dateShort(j.date), time: timeLabel(j.start_time) })}</div></div>`;
    } else if (b?.status === 'completed') {
      status = `<div class="callout">${icon('wallet')}<div class="grow"><b>${t('Work complete. You earned {amt}.', { amt: money(b.amount) })}</b>${b.paid ? t('Paid by {m}', { m: b.pay_method === 'upi' ? 'UPI' : t('cash') }) : t('Payment pending from the farmer')}</div></div>`;
    } else if (b?.status === 'cancelled' || j.status === 'cancelled') {
      status = `<div class="callout callout-bad">${icon('x')}<div><b>${t('This work was cancelled by the farmer')}</b></div></div>`;
    } else if (j.clash) {
      status = `<div class="callout callout-action">${icon('calendar')}<div><b>${t('You already have work on these days')}</b>${t('Cancel that booking first if you want this one.')}</div></div>`;
    } else if (j.status !== 'open') {
      status = `<div class="callout">${icon('info')}<div><b>${t('This work is full')}</b>${t('We will alert you for the next one that suits you.')}</div></div>`;
    }

    document.getElementById('wj').innerHTML = `
      <div class="cols">
        <div class="stack">
          ${chit({ ...j, distance: j.distance }, { tag: j.score != null && canAccept ? matchMeter(j.score) : (j.status !== 'open' ? badge(j.status) : '') })}
          ${status}
          ${j.alert?.type === 'invite' && canAccept ? `<div class="callout callout-info">${icon('mail')}<div>${t('{name} invited you personally for this work.', { name: esc(j.farmer.name) })}</div></div>` : ''}
          ${j.reasons && (canAccept || booked) ? `<section class="panel"><div class="panel-head"><h2>${icon('sparkle')}${t('Why this suits you')}</h2></div>
            <ul class="reasons-list">${j.reasons.filter((r) => r.code !== 'reliability').map((r) => `<li class="${r.ok ? 'ok' : 'warn'}">${icon({ distance: 'pin', wage_ok: 'rupee', wage_low: 'rupee', rapport: 'handshake' }[r.code] || (r.code.startsWith('days') ? 'calendar' : 'tool'))}<span>${esc(reasonLine(r))}</span></li>`).join('')}</ul></section>` : ''}
          <section class="panel stack">
            <div class="panel-head" style="margin:0"><h2>${icon('info')}${t('About the work')}</h2></div>
            <ul class="rows small">
              <li class="rowitem"><span class="grow muted">${t('Dates')}</span><b>${esc(dateShort(j.date))}${j.duration_days > 1 ? ` – ${esc(dateShort(j.end_date))}` : ''}</b></li>
              <li class="rowitem"><span class="grow muted">${t('Starts at')}</span><b>${esc(timeLabel(j.start_time))}</b></li>
              <li class="rowitem"><span class="grow muted">${t('You will earn')}</span><b>${money(j.wage * j.duration_days)}${j.duration_days > 1 ? ` <span class="muted">(${tn('{n} day', '{n} days', j.duration_days)})</span>` : ''}</b></li>
              <li class="rowitem"><span class="grow muted">${t('Spots left')}</span><b>${j.spots_left} / ${j.workers_needed}</b></li>
            </ul>
            ${facilities(j.facilities)}
            ${j.description ? `<p>${esc(j.description)}</p>` : ''}
          </section>
          <section class="panel">
            <div class="row">${avatar(j.farmer.name, 'lg')}<div class="grow"><b>${esc(j.farmer.name)}</b>
              <div class="small muted">${esc(villageName(j.farmer.village))}</div>
              <div class="row small" style="gap:12px;margin-top:2px">${stars(j.farmer.rating, { count: j.farmer.rating_count, small: true })}<span class="muted">${tn('{n} job posted', '{n} jobs posted', j.farmer.jobs_posted)}</span></div></div></div>
            ${j.farmer.phone ? `<div class="row" style="margin-top:14px;flex-wrap:wrap">
              <a class="btn btn-quiet" href="${telHref(j.farmer.phone)}">${icon('phone')}${t('Call')}</a>
              <a class="btn btn-quiet" href="${waHref(j.farmer.phone)}" target="_blank" rel="noopener">${icon('chat')}WhatsApp</a>
              <a class="btn btn-quiet" href="${mapsHref(j.lat, j.lng)}" target="_blank" rel="noopener">${icon('nav')}${t('Directions')}</a></div>` : `<p class="small muted" style="margin-top:10px">${t('The farmer’s phone number is shared once you accept.')}</p>`}
            ${b?.status === 'completed' ? `<hr class="divider"><div class="row" style="flex-wrap:wrap">${b.worker_rating ? `<span class="tag tag-good">${icon('star')}${t('You rated {n}', { n: b.worker_rating })}</span>` : `<span class="small">${t('Rate this farmer')}</span>${starInput(`f${b.assignment_id}`, 0)}`}</div>` : ''}
          </section>
        </div>
        <aside class="cols-side">
          <div id="wjmap" class="map map-tall"></div>
          <div id="wjwx"></div>
        </aside>
      </div>
      ${canAccept ? `<div class="actionbar">
        <button class="btn btn-ghost btn-icon" data-act="listen" aria-label="${t('Read aloud')}">${icon('volume')}</button>
        <button class="btn btn-lg" data-act="decline">${t('Not this time')}</button>
        <button class="btn btn-primary btn-lg" data-act="accept">${icon('check')}${t('Accept work')}</button></div>` : ''}
      ${booked ? `<div class="actionbar">
        ${onDay && !b.checked_in_at ? `<button class="btn btn-action btn-lg" data-act="checkin">${icon('pin')}${t('I have reached the field')}</button>` : `<a class="btn btn-primary btn-lg" href="${mapsHref(j.lat, j.lng)}" target="_blank" rel="noopener">${icon('nav')}${t('Directions')}</a>`}
        ${!b.checked_in_at ? `<button class="btn btn-lg" data-act="withdraw">${t('Cancel booking')}</button>` : ''}</div>` : ''}`;

    if (map) { map.remove(); map = null; }
    map = createMap(document.getElementById('wjmap'), { center: [j.lat, j.lng], zoom: 12 });
    if (map) {
      L.marker([j.lat, j.lng], { icon: pin('job', workIcon(j.work_type)) }).addTo(map).bindTooltip(t('Field'));
      L.marker([state.me.lat, state.me.lng], { icon: pin('home', '⌂') }).addTo(map).bindTooltip(t('Your home'));
      L.polyline([[state.me.lat, state.me.lng], [j.lat, j.lng]], { color: '#1f6b43', weight: 2, dashArray: '6 6' }).addTo(map);
      fit(map, [[j.lat, j.lng], [state.me.lat, state.me.lng]], 50);
    } else document.getElementById('wjmap').hidden = true;
    if (daysUntil(j.date) <= 15 && j.end_date >= t0) {
      api(`/weather?lat=${j.lat}&lng=${j.lng}&date=${j.date}&end=${j.end_date}`).then((w) => { const el = document.getElementById('wjwx'); if (el && w.available) el.innerHTML = weatherBadge(w); }).catch(() => {});
    }
    ctx.job = j;
  };

  await load();
  ctx.onRefresh(load);
  ctx.onCleanup(() => { if (map) map.remove(); window.speechSynthesis?.cancel(); });

  ctx.actions = {
    accept: async () => { await respond('accept', id); load(); },
    decline: async () => { await respond('decline', id); ctx.go('#/w'); },
    listen: () => speak(speakableJob(ctx.job)),
    checkin: async () => { await api(`/jobs/${id}/checkin`, { method: 'POST' }); toast(t('Checked in. The farmer can see you have arrived.'), { kind: 'success' }); load(); },
    withdraw: async () => {
      const ok = await confirmDialog({ title: t('Cancel your booking?'), body: t('The farmer will be told and we will look for someone else. Cancelling often lowers your reliability.'), confirm: t('Cancel booking'), cancel: t('Keep booking'), danger: true });
      if (!ok) return;
      await api(`/jobs/${id}/withdraw`, { method: 'POST' });
      toast(t('Booking cancelled'));
      load();
    },
    star: async (d) => {
      await api(`/assignments/${d.name.slice(1)}/rate-farmer`, { method: 'POST', body: { rating: Number(d.value) } });
      toast(t('Thanks for rating'), { kind: 'success' });
      load();
    },
  };
}

// ---------------------------------------------------------------- my work
export async function workerWork(ctx) {
  ctx.setTitle(t('My work'));
  ctx.root.innerHTML = `<div class="page-head"><div><h1>${t('My work')}</h1><p>${t('Your bookings, past work and payments.')}</p></div></div><div id="ww">${skeleton(3)}</div>`;
  const load = async () => {
    const w = await api('/work');
    const e = w.earnings;
    document.getElementById('ww').innerHTML = `
      <div class="earn-grid">
        <div class="kpi"><div class="kpi-label">${t('Last 30 days')}</div><div class="kpi-value">${money(e.last_30d)}</div></div>
        <div class="kpi"><div class="kpi-label">${t('Total earned')}</div><div class="kpi-value">${money(e.total)}</div><div class="kpi-note">${tn('{n} day worked', '{n} days worked', e.days_worked)}</div></div>
        <div class="kpi ${e.unpaid ? 'kpi-action' : ''}"><div class="kpi-label">${t('Waiting for payment')}</div><div class="kpi-value">${money(e.unpaid)}</div></div>
      </div>
      <section style="margin-top:28px"><div class="section-title"><h2>${t('Upcoming')}</h2></div>
        <div class="stack">${w.upcoming.length ? w.upcoming.map((j) => {
    const onDay = j.date <= today() && j.end_date >= today();
    return chit({ ...j, status: 'filled' }, {
      href: `#/w/jobs/${j.id}`,
      tag: onDay ? (j.checked_in_at ? `<span class="tag tag-good">${icon('check')}${t('Checked in')}</span>` : `<span class="tag tag-action">${t('Today')}</span>`) : '',
      foot: `<div class="small muted">${t('Farmer: {name}', { name: esc(j.farmer_name) })}</div>`,
    });
  }).join('') : emptyState('calendar', t('No upcoming work'), t('Accept work from your alerts and it will show here.'), `<a class="btn btn-primary" href="#/w">${t('Find work')}</a>`)}</div>
      </section>
      <section style="margin-top:28px"><div class="section-title"><h2>${t('Past work')}</h2></div>
        <div class="panel">${w.past.length ? `<ul class="rows">${w.past.map((j) => `<li class="rowitem">
          <span class="crop" style="font-size:1.5rem" aria-hidden="true">${workIcon(j.work_type)}</span>
          <div class="rowitem-main"><b>${esc(workName(j.work_type))}</b>
            <div class="rowitem-sub"><span>${esc(dateShort(j.date))}</span><span>${esc(j.farmer_name)}</span><span>${esc(villageName(j.village))}</span></div></div>
          <div class="rowitem-actions">
            ${j.booking_status === 'completed' ? `<b class="num" style="font-size:1.2rem">${money(j.amount)}</b>${j.paid ? `<span class="tag tag-good">${t('Paid')}</span>` : `<span class="tag tag-action">${t('Unpaid')}</span>`}`
    : j.booking_status === 'no_show' ? `<span class="tag tag-bad">${t('Marked absent')}</span>` : `<span class="tag">${t('Cancelled')}</span>`}
            ${j.booking_status === 'completed' && !j.worker_rating ? `<a class="btn btn-sm btn-quiet" href="#/w/jobs/${j.id}">${icon('star')}${t('Rate')}</a>` : ''}
          </div></li>`).join('')}</ul>` : emptyState('briefcase', t('No past work yet'))}</div>
      </section>`;
  };
  await load();
  ctx.onRefresh(load);
}
