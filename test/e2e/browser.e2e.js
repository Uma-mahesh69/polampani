// Full browser end-to-end check of every user flow, including two users in real time.
// Requires Playwright (not a project dependency):
//   npm i --no-save playwright && npx playwright install chromium
// Then, with a freshly reset server running (npm run reset && npm start):
//   npm run test:e2e            (E2E_BASE_URL defaults to http://localhost:3000)
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const BASE = process.env.E2E_BASE_URL || 'http://localhost:3000';
const OUT = process.env.E2E_OUT || os.tmpdir();
const results = [];
const problems = [];
const api = async (path, { method = 'GET', body, token } = {}) => {
  const r = await fetch(`${BASE}/api${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return r.json();
};
function watch(page, label) {
  page.on('pageerror', (e) => problems.push(`[${label}] pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/tile\.openstreetmap|ERR_TUNNEL|Failed to load resource/.test(m.text())) problems.push(`[${label}] console: ${m.text()}`); });
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 500) problems.push(`[${label}] HTTP ${r.status()} ${r.url()}`); });
}
async function step(name, fn, page) {
  try { await fn(); results.push(`PASS  ${name}`); } catch (e) {
    results.push(`FAIL  ${name}: ${e.message.split('\n')[0]}`);
    if (page) await page.screenshot({ path: path.join(OUT, `polampani-fail-${name.replace(/\W+/g, '_')}.png`) }).catch(() => {});
  }
}
const toastWith = (page, re, timeout = 8000) => page.waitForFunction((src) => [...document.querySelectorAll('.toast')].some((t) => new RegExp(src).test(t.textContent)), re.source, { timeout });
async function overflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

(async () => {
  const b = await chromium.launch();
  const desk = { viewport: { width: 1366, height: 860 }, serviceWorkers: 'block' };
  const mob = { viewport: { width: 375, height: 760 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' };

  // ---------- A. logged out ----------
  const pubCtx = await b.newContext(desk); const pub = await pubCtx.newPage(); watch(pub, 'public');
  await step('landing renders chit, stats and demo accounts', async () => {
    await pub.goto(`${BASE}/#/`); await pub.waitForSelector('.try .chit'); await pub.waitForSelector('#live b'); await pub.waitForSelector('.demo-btn');
  }, pub);
  await step('landing try-it examples re-parse', async () => {
    await pub.click('[data-act=tryExample][data-i="1"]');
    await pub.waitForFunction(() => /Sugarcane/i.test(document.querySelector('#try-chit').textContent));
  }, pub);
  await step('impact page charts + table toggle', async () => {
    await pub.goto(`${BASE}/#/impact`); await pub.waitForSelector('.chart svg .bar');
    await pub.click('[data-act=toggleTable][data-t=t1]'); await pub.waitForSelector('#t1 table', { state: 'visible' });
    await pub.hover('.chart .bar-g >> nth=0'); await pub.waitForSelector('.chart-tip.show');
  }, pub);
  let publicJobId = null;
  await step('public shared job page', async () => {
    const t = (await api('/auth/demo', { method: 'POST', body: { user_id: 2 } })).token;
    publicJobId = (await api('/jobs/mine?status=active', { token: t }))[0].id;
    await pub.goto(`${BASE}/#/job/${publicJobId}`); await pub.waitForSelector('text=Log in to accept');
  }, pub);
  await step('404 page', async () => { await pub.goto(`${BASE}/#/nope/really`); await pub.waitForSelector('text=Page not found'); }, pub);
  await step('protected route redirects to login', async () => { await pub.goto(`${BASE}/#/f`); await pub.waitForURL(/#\/login\?next=/); await pub.waitForSelector('#phoneForm'); }, pub);
  await step('invalid phone shows error', async () => { await pub.fill('input[name=phone]', '12345'); await pub.click('#phoneForm button'); await toastWith(pub, /valid 10-digit/); }, pub);

  // ---------- B. new worker signs up via OTP ----------
  const wCtx = await b.newContext(desk); const w = await wCtx.newPage(); watch(w, 'worker');
  await step('new worker: OTP + 3-step signup', async () => {
    await w.goto(`${BASE}/#/login?role=worker`); await w.fill('input[name=phone]', '9900011122'); await w.click('#phoneForm button');
    await w.waitForSelector('.dev-code'); await w.click('[data-act=fillCode]');
    await w.waitForURL(/#\/signup/); await w.waitForSelector('#su-name');
    await w.fill('#su-name', 'Test Kumar'); await w.click('[data-act=next]');
    await w.waitForSelector('#su-village'); await w.selectOption('#su-village', 'Anakapalli'); await w.click('[data-act=next]');
    await w.waitForSelector('.tiles'); await w.click('.tile[data-id=paddy_harvesting]'); await w.click('.tile[data-id=loading]');
    await w.fill('#su-wage', '500'); await w.click('.day-btn[data-day="0"]');
    await w.click('[data-act=next]'); await w.waitForURL(/#\/w$/); await w.waitForSelector('.avail.on');
  }, w);

  // ---------- C. realtime: farmer posts, new worker gets alert live, accepts ----------
  const fCtx = await b.newContext(desk); const f = await fCtx.newPage(); watch(f, 'farmer');
  let newJobId = null;
  await step('farmer demo login + home', async () => {
    await f.goto(`${BASE}/#/`); await f.waitForSelector('.demo-btn'); await f.locator('.demo-col').first().locator('.demo-btn').first().click();
    await f.waitForURL(/#\/f$/); await f.waitForSelector('.kpis');
  }, f);
  await step('composer -> wizard prefilled from Telugu text', async () => {
    await f.fill('#cmp', 'ఎల్లుండి అనకాపల్లిలో వరి కోతలకు 2 మంది కావాలి, కూలి 650, ఉదయం 6 గంటలకు');
    await f.click('[data-act=compose]'); await f.waitForURL(/#\/f\/post/); await f.waitForSelector('.tile[data-v=paddy_harvesting][aria-pressed=true]');
    const wage = await f.inputValue('[name=wage]'); if (wage !== '650') throw new Error(`wage ${wage}`);
    await f.waitForSelector('#supply .num');
  }, f);
  await step('wizard controls: stepper, facilities, review, post', async () => {
    await f.click('[data-act=bump][data-k=workers_needed][data-delta="1"]');
    await f.click('[data-act=bump][data-k=workers_needed][data-delta="-1"]');
    await f.click('[data-act=fac][data-v=meals]');
    await f.click('[data-act=toReview]'); await f.waitForSelector('.forecast-num');
    await f.click('[data-act=post]'); await f.waitForSelector('.success');
    newJobId = Number((await f.getAttribute('a[href^="#/f/jobs/"]', 'href')).split('/').pop());
  }, f);
  await step('worker receives live alert toast (SSE) without reload', async () => {
    await toastWith(w, /New work near you/, 10000);
    await w.waitForSelector(`[data-act=accept][data-id="${newJobId}"]`, { timeout: 10000 });
  }, w);
  await step('worker reads aloud + accepts from alert card', async () => {
    await w.click(`[data-act=listen][data-id="${newJobId}"]`);
    await w.click(`[data-act=accept][data-id="${newJobId}"]`); await w.waitForURL(new RegExp(`#/w/jobs/${newJobId}`));
    await w.waitForSelector('text=You are booked for this work');
    await w.waitForSelector('a[href^="tel:"]');
  }, w);
  await step('farmer gets live "accepted" toast', async () => { await toastWith(f, /accepted/); }, f);

  // ---------- D. farmer job detail ----------
  await step('job detail: ring, crew, AI matches, invite, alert more', async () => {
    await f.goto(`${BASE}/#/f/jobs/${newJobId}`); await f.waitForSelector('.statusband .ring');
    await f.waitForSelector('.crew-row');
    await f.click('[data-act=tab][data-v=matches]'); await f.waitForSelector('.match');
    const inv = f.locator('[data-act=invite]').first();
    if (await inv.count()) { await inv.click(); await toastWith(f, /Invitation sent/); }
    await f.click('[data-act=tab][data-v=activity]'); await f.waitForSelector('.timeline li');
    await f.click('[data-act=dispatch]'); await toastWith(f, /Alerted|No more free workers/);
  }, f);
  await step('job detail: share + copy link', async () => {
    const href = await f.getAttribute('a[href^="https://wa.me/?text="]', 'href'); if (!href.includes(encodeURIComponent(`/#/job/${newJobId}`))) throw new Error('share link');
  }, f);
  await step('farmer cancels job with reason; worker notified', async () => {
    await f.click('[data-act=cancel]'); await f.waitForSelector('dialog.modal input[name=v]');
    await f.fill('dialog.modal input[name=v]', 'Rain expected'); await f.click('dialog.modal button[value=ok]');
    await f.waitForSelector('.callout-bad >> text=Cancelled');
    await toastWith(w, /cancelled/);
  }, f);

  // ---------- E. today's job: check-in, complete, rate, pay ----------
  const ftoken = await f.evaluate(() => localStorage.getItem('pp_token'));
  const mine = await api('/jobs/mine?status=active', { token: ftoken });
  const todayJob = mine.find((j) => j.crew.length && j.crew.some((c) => !c.checked_in_at) && j.date <= new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }));
  const notIn = todayJob?.crew.find((c) => !c.checked_in_at);
  const w2Ctx = await b.newContext(desk); const w2 = await w2Ctx.newPage(); watch(w2, 'worker2');
  await step('crew worker checks in on the day', async () => {
    if (!todayJob) throw new Error('no job running today in seed');
    const tok = (await api('/auth/demo', { method: 'POST', body: { user_id: notIn.id } })).token;
    await w2.goto(`${BASE}/#/`); await w2.evaluate((t) => localStorage.setItem('pp_token', t), tok);
    await w2.goto('about:blank'); await w2.goto(`${BASE}/#/w/jobs/${todayJob.id}`);
    await w2.click('.actionbar [data-act=checkin]'); await w2.waitForSelector('text=Checked in at');
    await toastWith(f, /reached the field/);
  }, w2);
  await step('farmer completes job with attendance, rates and pays', async () => {
    await f.goto(`${BASE}/#/f/jobs/${todayJob.id}`); await f.click('[data-act=complete]');
    await f.waitForSelector('dialog.modal .attend'); await f.locator('dialog.modal .attend button.no').last().click();
    await f.click('dialog.modal [data-confirm]'); await f.waitForSelector('.star-input');
    await f.locator('.star-input').first().locator('.star-btn').nth(4).click(); await toastWith(f, /Rating saved/);
    await f.locator('[data-act=paid]').first().click(); await toastWith(f, /Payment recorded/);
    await f.waitForSelector('.tag-good >> text=Paid');
    await f.waitForSelector('.tag-bad >> text=Did not come');
  }, f);
  await step('worker sees completion + earnings, rates farmer', async () => {
    await w2.goto(`${BASE}/#/w/work`); await w2.waitForSelector('.earn-grid');
    const past = w2.locator('a[href^="#/w/jobs/"] >> text=Rate');
    if (await past.count()) {
      await past.first().click(); await w2.waitForSelector('.star-input'); await w2.locator('.star-input .star-btn').nth(3).click(); await toastWith(w2, /Thanks for rating/);
    }
  }, w2);

  // ---------- F. worker withdraws a booking ----------
  await step('worker cancels a booking; farmer told', async () => {
    const tok = await w2.evaluate(() => localStorage.getItem('pp_token'));
    const feed = await api('/feed', { token: tok });
    const target = feed.find((r) => r.job.spots_left > 0);
    await api(`/jobs/${target.job.id}/accept`, { method: 'POST', token: tok });
    await w2.goto(`${BASE}/#/w/jobs/${target.job.id}`); await w2.click('[data-act=withdraw]');
    await w2.click('dialog.modal button[value=ok]'); await toastWith(w2, /Booking cancelled/);
  }, w2);

  // ---------- G. alerts, profile, language, logout ----------
  await step('bell popover + alerts page + mark all read', async () => {
    await f.goto(`${BASE}/#/f`); await f.waitForSelector('.kpis');
    await f.click('.topbar [data-act=bell]'); await f.waitForSelector('.popover .notif');
    await f.locator('.popover .notif').first().click(); await f.waitForURL(/#\/f\/jobs\/\d+/);
    await f.goto(`${BASE}/#/alerts`); await f.waitForSelector('.notif'); await f.click('[data-act=readAll]');
    await f.waitForFunction(() => !document.querySelector('.notif.unread'));
  }, f);
  await step('worker profile: edit skills/wage/days, save', async () => {
    await w.goto(`${BASE}/#/profile`); await w.waitForSelector('#pf');
    await w.click('.tile[data-id=weeding]'); await w.fill('[name=daily_wage]', '550'); await w.click('.day-btn[data-day="3"]');
    await w.fill('[name=upi_id]', 'testkumar@ybl');
    await w.click('#pf button.btn-primary'); await toastWith(w, /Saved/);
    const me = await w.evaluate(() => fetch('/api/me', { headers: { Authorization: `Bearer ${localStorage.getItem('pp_token')}` } }).then((r) => r.json()));
    if (me.daily_wage !== 550 || !me.skills.includes('weeding') || me.upi_id !== 'testkumar@ybl') throw new Error(JSON.stringify(me));
  }, w);
  await step('bad UPI rejected with clear message', async () => {
    await w.fill('[name=upi_id]', 'not a upi'); await w.click('#pf button.btn-primary'); await toastWith(w, /UPI ID should look like/);
    await w.fill('[name=upi_id]', 'testkumar@ybl');
  }, w);
  await step('availability toggle pauses alerts', async () => {
    await w.goto(`${BASE}/#/w`); await w.waitForSelector('.avail.on');
    await w.click('[data-act=avail]'); await w.waitForSelector('.avail:not(.on)');
    await w.click('[data-act=avail]'); await w.waitForSelector('.avail.on');
  }, w);
  await step('feed filters + sort', async () => {
    await w.selectOption('#f-sort', 'wage'); await w.waitForTimeout(500);
    await w.click('[data-act=km][data-v="10"]'); await w.waitForTimeout(500);
    await w.selectOption('#f-type', 'sugarcane_cutting'); await w.waitForTimeout(500);
    await w.selectOption('#f-type', ''); await w.click('[data-act=km][data-v=""]');
  }, w);
  await step('language switch to Telugu and back', async () => {
    await w.click('.topbar [data-act=lang]'); await w.waitForSelector('text=పని వెతకండి');
    await w.click('.topbar [data-act=lang]'); await w.waitForSelector('.topbar-title >> text=Find work');
  }, w);
  await step('logout', async () => {
    await w.goto(`${BASE}/#/profile`); await w.click('[data-act=logout]'); await w.click('dialog.modal button[value=ok]');
    await w.waitForURL(/#\/$/); await w.waitForSelector('.hero');
  }, w);

  // ---------- H. mobile layout: no horizontal overflow on any page ----------
  for (const [role, uid] of [['farmer', 1], ['worker', 30]]) {
    const ctx = await b.newContext(mob); const m = await ctx.newPage(); watch(m, `mobile-${role}`);
    const tok = (await api('/auth/demo', { method: 'POST', body: { user_id: uid } })).token;
    const jobs = role === 'farmer' ? await api('/jobs/mine', { token: tok }) : (await api('/feed', { token: tok })).map((r) => r.job);
    await m.goto(`${BASE}/#/`); await m.evaluate((t) => localStorage.setItem('pp_token', t), tok); await m.goto('about:blank');
    const pages = role === 'farmer'
      ? ['#/f', '#/f/post', '#/f/jobs', `#/f/jobs/${jobs[0].id}`, '#/alerts', '#/profile', '#/impact']
      : ['#/w', `#/w/jobs/${jobs[0].id}`, '#/w/work', '#/alerts', '#/profile'];
    for (const lang of ['en', 'te']) {
      await m.goto(`${BASE}/#/`); await m.evaluate((l) => localStorage.setItem('pp_lang', l), lang); await m.goto('about:blank');
      for (const pg of pages) {
        await step(`mobile ${role} ${lang} ${pg} fits screen`, async () => {
          await m.goto(`${BASE}/${pg}`); await m.waitForTimeout(1200);
          const o = await overflow(m); if (o > 1) throw new Error(`overflows by ${o}px`);
        }, m);
      }
    }
  }
  console.log(results.join('\n'));
  console.log(`\n${results.filter((r) => r.startsWith('PASS')).length} passed, ${results.filter((r) => r.startsWith('FAIL')).length} failed`);
  console.log(problems.length ? `\nPROBLEMS:\n${[...new Set(problems)].join('\n')}` : '\nNo console/page/server errors');
  await b.close();
  const failed = results.some((r) => r.startsWith('FAIL')) || problems.length > 0;
  process.exit(failed ? 1 : 0);
})();
