'use strict';

// ---------- helpers ----------
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYS_TE = ['ఆది', 'సోమ', 'మంగళ', 'బుధ', 'గురు', 'శుక్ర', 'శని'];
const VIZAG = [17.75, 83.1];

const state = {
  meta: null,
  wt: {},
  me: null,
  lang: localStorage.getItem('pp_lang') || 'en',
  map: null,
  layer: null,
  pick: null,
  pickMarker: null,
  es: null,
  openMatches: new Set(),
  refreshTimer: null,
  insightTimer: null,
};

async function api(path, opts = {}) {
  const res = await fetch(`/api${path}`, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

const T = {
  en: {
    tagline: 'Fieldwork, filled on time.',
    hero: 'PolamPani connects farmers with agricultural labourers nearby. Post work in seconds by typing or speaking, and our open-source AI alerts the best-matched workers instantly.',
    farmer: 'Farmer', worker: 'Worker',
    im_farmer: "I'm a farmer. I need workers", im_worker: "I'm a worker. I need work",
    join: 'Join PolamPani', switch: 'Switch',
    post_work: 'Post fieldwork', describe: 'Describe the work in your own words (English / తెలుగు)',
    autofill: '✨ AI auto-fill', speak: '🎤 Speak',
    work_type: 'Type of work', village: 'Village / location', date: 'Date', time: 'Start time',
    workers_needed: 'Workers needed', wage: 'Wage per day (₹)', notes: 'Notes for workers',
    post_btn: '📣 Post & alert best-matched workers', my_jobs: 'My jobs', updates: 'Updates',
    no_jobs: 'No jobs yet. Post your first fieldwork above.', no_updates: 'No updates yet.',
    ai_matches: '🤖 AI matches', notify_more: '📣 Alert more workers', complete: '✅ Mark completed',
    notifs: 'Job alerts', feed: 'Jobs near you, ranked by AI', mine: 'My confirmed work',
    accept: '✅ Accept', decline: 'Not this time', withdraw: 'Cancel booking',
    available: 'Available for work', unavailable: 'Not available. You will not get alerts',
    free_days: 'Days I can work', skills: 'Skills', expects: 'Expects', radius: 'Travels up to',
    no_notifs: 'No alerts yet. Keep availability ON to receive job alerts.',
    no_feed: 'No open jobs near you right now.', no_mine: 'No confirmed work yet.',
    model: 'How the AI matches', map_tip: 'Tip: click the map to pin the exact field location.',
    map_tip_w: 'Your home 🏠, travel radius, and jobs near you.',
    spots_left: 'spots left', match: 'match', directions: 'Directions',
    open: 'Open', filled: 'Filled', completed: 'Completed', cancelled: 'Cancelled',
    how1: 'Farmer posts work by typing or voice, in Telugu or English',
    how2: 'AI ranks nearby workers by skill, distance, availability & fair wage',
    how3: 'Best matches get instant alerts and accept in one tap',
    how4: 'Not filling? Search widens automatically so no work is left undone',
  },
  te: {
    tagline: 'పొలం పని, సమయానికి పూర్తి.',
    hero: 'పొలంపని రైతులను దగ్గరలోని వ్యవసాయ కూలీలతో కలుపుతుంది. టైప్ చేసి లేదా మాట్లాడి క్షణాల్లో పని పోస్ట్ చేయండి. మా ఓపెన్ సోర్స్ AI సరైన కూలీలకు వెంటనే తెలియజేస్తుంది.',
    farmer: 'రైతు', worker: 'కూలీ',
    im_farmer: 'నేను రైతును. నాకు కూలీలు కావాలి', im_worker: 'నేను కూలీని. నాకు పని కావాలి',
    join: 'పొలంపనిలో చేరండి', switch: 'మార్చండి',
    post_work: 'పొలం పని పోస్ట్ చేయండి', describe: 'పని గురించి మీ మాటల్లో చెప్పండి (English / తెలుగు)',
    autofill: '✨ AI తో నింపండి', speak: '🎤 మాట్లాడండి',
    work_type: 'పని రకం', village: 'గ్రామం / ప్రదేశం', date: 'తేదీ', time: 'ప్రారంభ సమయం',
    workers_needed: 'కావలసిన కూలీలు', wage: 'రోజు కూలి (₹)', notes: 'కూలీలకు సూచనలు',
    post_btn: '📣 పోస్ట్ చేసి సరైన కూలీలకు తెలియజేయండి', my_jobs: 'నా పనులు', updates: 'తాజా సమాచారం',
    no_jobs: 'ఇంకా పనులు లేవు. పైన మీ మొదటి పని పోస్ట్ చేయండి.', no_updates: 'ఇంకా సమాచారం లేదు.',
    ai_matches: '🤖 AI ఎంపికలు', notify_more: '📣 మరింత మందికి తెలియజేయండి', complete: '✅ పని పూర్తయింది',
    notifs: 'పని సమాచారం', feed: 'మీ దగ్గర పనులు (AI ర్యాంకింగ్)', mine: 'నా ఖరారైన పనులు',
    accept: '✅ ఒప్పుకుంటాను', decline: 'ఈసారి కాదు', withdraw: 'బుకింగ్ రద్దు',
    available: 'పనికి అందుబాటులో ఉన్నాను', unavailable: 'అందుబాటులో లేను. సమాచారం రాదు',
    free_days: 'పని చేయగల రోజులు', skills: 'నైపుణ్యాలు', expects: 'ఆశించే కూలి', radius: 'ప్రయాణ దూరం',
    no_notifs: 'ఇంకా సమాచారం లేదు. పని సమాచారం కోసం అందుబాటును ON లో ఉంచండి.',
    no_feed: 'ప్రస్తుతం మీ దగ్గర పనులు లేవు.', no_mine: 'ఇంకా ఖరారైన పని లేదు.',
    model: 'AI ఎలా సరిపోలుస్తుంది', map_tip: 'సూచన: పొలం ఖచ్చితమైన ప్రదేశం కోసం మ్యాప్‌పై నొక్కండి.',
    map_tip_w: 'మీ ఇల్లు 🏠, ప్రయాణ దూరం, దగ్గరలోని పనులు.',
    spots_left: 'ఖాళీలు', match: 'సరిపోలిక', directions: 'దారి',
    open: 'ఖాళీ', filled: 'నిండింది', completed: 'పూర్తయింది', cancelled: 'రద్దు',
    how1: 'రైతు టైప్ చేసి లేదా మాట్లాడి పని పోస్ట్ చేస్తారు',
    how2: 'AI నైపుణ్యం, దూరం, అందుబాటు, న్యాయమైన కూలి ఆధారంగా కూలీలను ఎంచుకుంటుంది',
    how3: 'సరైన కూలీలకు వెంటనే సమాచారం. ఒక్క టాప్‌తో ఒప్పుకోవచ్చు',
    how4: 'నిండకపోతే వెతుకులాట దూరం ఆటోమేటిక్‌గా పెరుగుతుంది',
  },
};
const t = (k) => T[state.lang][k] ?? T.en[k] ?? k;
const dayName = (d) => (state.lang === 'te' ? DAYS_TE[d] : DAYS[d]);
const workLabel = (id) => {
  const w = state.wt[id];
  return w ? `${w.icon} ${state.lang === 'te' ? w.te : w.en}` : id;
};

function ago(ts) {
  const d = new Date(`${ts.replace(' ', 'T')}Z`);
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return d.toLocaleDateString();
}

function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 6000);
}

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.08, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.25);
  } catch { /* audio not allowed */ }
}

const scoreBadge = (s) => {
  const pct = Math.round(s * 100);
  return `<div class="score ${pct >= 75 ? 'hi' : pct >= 50 ? 'mid' : 'lo'}">${pct}%<small>${t('match')}</small></div>`;
};
const reasonChips = (reasons) => `<div class="chips">${reasons.map((r) => `<span class="chip ${r.ok ? 'ok' : 'warn'}">${esc(r.text)}</span>`).join('')}</div>`;
const pill = (s) => (s ? `<span class="pill ${s}">${esc(s)}</span>` : '');
const tomorrow = () => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toLocaleDateString('en-CA'); };

// ---------- boot ----------
async function boot() {
  state.meta = await api('/meta');
  state.wt = Object.fromEntries(state.meta.work_types.map((w) => [w.id, w]));
  renderStats(state.meta.stats);
  $('#langBtn').textContent = state.lang === 'en' ? 'తెలుగు' : 'English';
  const id = Number(localStorage.getItem('pp_user'));
  if (id) {
    try { await login(id); return; } catch { localStorage.removeItem('pp_user'); }
  }
  renderLanding();
}

function renderStats(s) {
  $('#stats').innerHTML = [
    ['🌾', s.open_jobs, 'open jobs'],
    ['👷', s.workers_available, 'workers available'],
    ['✅', s.positions_filled, 'positions filled'],
    ['🔔', s.alerts_sent, 'smart alerts sent'],
    ['🧠', s.model_samples, 'AI learning signals'],
  ].map(([i, n, l]) => `<span class="stat">${i} <b>${n}</b> ${l}</span>`).join('');
}

function renderWho() {
  const me = state.me;
  $('#who').innerHTML = me
    ? `<span>${me.role === 'farmer' ? '👨‍🌾' : '🧑‍🌾'} <b>${esc(me.name)}</b> · ${t(me.role)}</span>
       <button class="btn ghost small" data-act="switchUser">${t('switch')}</button>`
    : '';
}

// ---------- landing ----------
async function renderLanding() {
  state.me = null;
  localStorage.removeItem('pp_user');
  closeStream();
  teardownMap();
  renderWho();
  const [farmers, workers] = await Promise.all([api('/users?role=farmer'), api('/users?role=worker')]);
  const userBtn = (u) => `<button class="user-btn" data-act="login" data-id="${u.id}">
      <b>${esc(u.name)}</b>
      <small>📍 ${esc(u.village)}${u.role === 'worker' ? ` · ${u.skills.map((s) => state.wt[s]?.icon || '').join('')}${u.available ? '' : ' · 💤'}` : ''}</small>
    </button>`;
  $('#app').innerHTML = `
    <section class="hero">
      <h1>🌾 ${t('tagline')}</h1>
      <p>${t('hero')}</p>
    </section>
    <div class="grid two">
      <div class="card role-card">
        <h2>👨‍🌾 ${t('im_farmer')}</h2>
        <p class="small muted">Demo accounts: pick one to continue</p>
        <div class="user-list">${farmers.map(userBtn).join('')}</div>
      </div>
      <div class="card role-card">
        <h2>🧑‍🌾 ${t('im_worker')}</h2>
        <p class="small muted">Demo accounts: pick one to continue</p>
        <div class="user-list">${workers.map(userBtn).join('')}</div>
      </div>
    </div>
    <div class="center"><button class="btn primary big" data-act="join">➕ ${t('join')}</button></div>
    <div class="card steps">
      <div><span class="n">📝</span>${t('how1')}</div>
      <div><span class="n">🤖</span>${t('how2')}</div>
      <div><span class="n">🔔</span>${t('how3')}</div>
      <div><span class="n">📡</span>${t('how4')}</div>
    </div>`;
}

// ---------- join ----------
function openJoin() {
  const dlg = $('#joinDlg');
  dlg.innerHTML = `
    <form id="joinForm">
      <div class="dlg-head"><h2>➕ ${t('join')}</h2><button type="button" class="btn ghost small" data-act="closeJoin">✕</button></div>
      <div class="row">
        <label>I am a
          <select name="role" id="joinRole">
            <option value="worker">🧑‍🌾 ${t('worker')} (labourer)</option>
            <option value="farmer">👨‍🌾 ${t('farmer')}</option>
          </select>
        </label>
        <label>Name <input name="name" required maxlength="60" placeholder="e.g. Ravi Kumar"></label>
      </div>
      <div class="row">
        <label>Phone (for alerts) <input name="phone" type="tel" placeholder="+91 9xxxxxxxxx"></label>
        <label>${t('village')}
          <select name="village">${state.meta.villages.map((v) => `<option value="${esc(v.name)}">${esc(v.name)} · ${esc(v.te)}</option>`).join('')}</select>
        </label>
      </div>
      <div id="workerFields">
        <label>${t('skills')}</label>
        <div class="checks" style="margin-bottom:10px">
          ${state.meta.work_types.map((w) => `<label><input type="checkbox" name="skills" value="${w.id}"> ${w.icon} ${esc(w.en)}</label>`).join('')}
        </div>
        <div class="row">
          <label>Expected wage / day (₹) <input name="daily_wage" type="number" min="100" max="5000" value="500"></label>
          <label>${t('radius')} (km) <input name="radius_km" type="number" min="2" max="100" value="20"></label>
        </div>
      </div>
      <div class="actions">
        <button type="button" class="btn" data-act="gps">📍 Use my GPS location</button>
        <span id="gpsInfo" class="small muted"></span>
      </div>
      <input type="hidden" name="lat"><input type="hidden" name="lng">
      <div class="actions"><button class="btn primary block">${t('join')}</button></div>
    </form>`;
  const role = $('#joinRole');
  role.onchange = () => { $('#workerFields').hidden = role.value !== 'worker'; };
  $('#joinForm').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    const fd = new FormData(f);
    const body = Object.fromEntries(fd);
    body.skills = fd.getAll('skills');
    if (!body.lat) { delete body.lat; delete body.lng; }
    body.lang = state.lang;
    try {
      const u = await api('/users', { method: 'POST', body });
      dlg.close();
      toast(`🎉 Welcome to PolamPani, ${u.name}!`, 'success');
      await login(u.id);
    } catch (err) { toast(err.message, 'warn'); }
  };
  dlg.showModal();
}

function useGps() {
  if (!navigator.geolocation) return toast('GPS not available', 'warn');
  navigator.geolocation.getCurrentPosition((p) => {
    const f = $('#joinForm');
    f.elements.lat.value = p.coords.latitude;
    f.elements.lng.value = p.coords.longitude;
    const v = nearestVillage(p.coords.latitude, p.coords.longitude);
    f.elements.village.value = v.name;
    $('#gpsInfo').textContent = `📍 ${p.coords.latitude.toFixed(4)}, ${p.coords.longitude.toFixed(4)} (near ${v.name})`;
  }, (e) => toast(`GPS error: ${e.message}`, 'warn'));
}

function nearestVillage(lat, lng) {
  let best = state.meta.villages[0];
  let bestD = Infinity;
  for (const v of state.meta.villages) {
    const d = (v.lat - lat) ** 2 + ((v.lng - lng) * Math.cos(lat * Math.PI / 180)) ** 2;
    if (d < bestD) { bestD = d; best = v; }
  }
  return best;
}

// ---------- session ----------
async function login(id) {
  state.me = await api(`/users/${id}`);
  localStorage.setItem('pp_user', id);
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
  renderWho();
  openStream();
  renderShell();
  await refresh();
}

function openStream() {
  closeStream();
  state.es = new EventSource(`/api/stream?user_id=${state.me.id}`);
  state.es.onmessage = (e) => {
    let d;
    try { d = JSON.parse(e.data); } catch { return; }
    if (d.event === 'notification') {
      const n = d.notification;
      toast(n.message, n.type === 'job_match' ? '' : 'success');
      beep();
      if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
        new Notification('PolamPani 🌾', { body: n.message });
      }
    }
    scheduleRefresh();
  };
}

function closeStream() {
  if (state.es) { state.es.close(); state.es = null; }
}

function scheduleRefresh(ms = 250) {
  clearTimeout(state.refreshTimer);
  state.refreshTimer = setTimeout(() => refresh().catch((e) => console.error(e)), ms);
}

async function refresh() {
  if (!state.me) return;
  api('/stats').then(renderStats).catch(() => {});
  api('/ai/model').then(renderModel).catch(() => {});
  if (state.me.role === 'farmer') await refreshFarmer();
  else await refreshWorker();
}

function renderShell() {
  teardownMap();
  if (state.me.role === 'farmer') renderFarmerShell();
  else renderWorkerShell();
}

// ---------- map ----------
function teardownMap() {
  if (state.map) state.map.remove();
  state.map = null;
  state.layer = null;
  state.pickMarker = null;
}

function initMap(center, onClick) {
  if (!window.L) {
    $('#map').innerHTML = '<p class="muted pad">Map needs an internet connection (OpenStreetMap).</p>';
    return;
  }
  state.map = L.map('map', { scrollWheelZoom: false }).setView(center, 10);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18, attribution: '© OpenStreetMap contributors',
  }).addTo(state.map);
  state.layer = L.layerGroup().addTo(state.map);
  if (onClick) state.map.on('click', onClick);
}

const emojiIcon = (e, cls = '') => L.divIcon({ html: `<div class="pin ${cls}">${e}</div>`, className: '', iconSize: [34, 34], iconAnchor: [17, 30] });

// ---------- farmer ----------
function renderFarmerShell() {
  const me = state.me;
  const vOpts = state.meta.villages.map((v) => `<option value="${esc(v.name)}" ${v.name === me.village ? 'selected' : ''}>${esc(v.name)} · ${esc(v.te)}</option>`).join('');
  const wOpts = state.meta.work_types.map((w) => `<option value="${w.id}">${w.icon} ${esc(w.en)} · ${esc(w.te)}</option>`).join('');
  $('#app').innerHTML = `
    <div class="grid">
      <div class="col">
        <div class="card">
          <h2>📝 ${t('post_work')}</h2>
          <div class="ai-box">
            <label for="nl">${t('describe')}</label>
            <textarea id="nl" rows="2" placeholder="e.g. Need 6 people for paddy transplanting in Anakapalli tomorrow 6am, ₹550 per day  /  రేపు చోడవరం లో చెరకు నరకడానికి 8 మంది కావాలి, కూలి 600"></textarea>
            <div class="ai-row" style="margin-top:8px">
              <button type="button" class="btn primary small" data-act="autofill">${t('autofill')}</button>
              <button type="button" class="btn small" data-act="voice">${t('speak')}</button>
              <span id="parseInfo"></span>
            </div>
          </div>
          <form id="postForm">
            <div class="row">
              <label>${t('work_type')}<select name="work_type" required>${wOpts}</select></label>
              <label>${t('village')}<select name="village" required>${vOpts}</select></label>
            </div>
            <div class="row3">
              <label>${t('date')}<input name="date" type="date" required min="${state.meta.today}" value="${tomorrow()}"></label>
              <label>${t('time')}<input name="start_time" type="time" value="07:00"></label>
              <label>${t('workers_needed')}<input name="workers_needed" type="number" min="1" max="200" value="5" required></label>
            </div>
            <div class="row">
              <label>${t('wage')}<input name="wage" type="number" min="100" max="5000" step="10" value="500" required></label>
              <label>${t('notes')}<input name="description" maxlength="300" placeholder="Lunch provided, bring sickle…"></label>
            </div>
            <div id="insight"></div>
            <button class="btn primary block">${t('post_btn')}</button>
          </form>
        </div>
        <div class="card"><h2>📋 ${t('my_jobs')}</h2><div id="myJobs"></div></div>
      </div>
      <div class="col side">
        <div class="card map-card"><div id="map"></div><p class="hint">${t('map_tip')} 🟢 available workers · ⚪ unavailable</p></div>
        <div class="card"><h2>🔔 ${t('updates')} <span id="updCount"></span></h2><div id="updates" class="list-scroll"></div></div>
        <div class="card" id="aiCard"></div>
      </div>
    </div>`;

  state.pick = { lat: me.lat, lng: me.lng };
  initMap([me.lat, me.lng], (e) => {
    state.pick = { lat: e.latlng.lat, lng: e.latlng.lng };
    $('#postForm').elements.village.value = nearestVillage(e.latlng.lat, e.latlng.lng).name;
    placePick();
    updateInsight();
  });
  placePick();

  const form = $('#postForm');
  form.elements.village.addEventListener('change', () => {
    const v = state.meta.villages.find((x) => x.name === form.elements.village.value);
    if (v) { state.pick = { lat: v.lat, lng: v.lng }; placePick(true); }
    updateInsight();
  });
  ['work_type', 'date', 'workers_needed'].forEach((n) => form.elements[n].addEventListener('change', updateInsight));
  form.addEventListener('submit', submitJob);
  updateInsight();
}

function placePick(pan = false) {
  if (!state.map || !state.pick) return;
  const ll = [state.pick.lat, state.pick.lng];
  if (state.pickMarker) state.pickMarker.setLatLng(ll);
  else state.pickMarker = L.marker(ll, { icon: emojiIcon('📌', 'pick'), zIndexOffset: 1000 }).addTo(state.map).bindTooltip('New job location');
  if (pan) state.map.panTo(ll);
}

function updateInsight() {
  clearTimeout(state.insightTimer);
  state.insightTimer = setTimeout(async () => {
    const f = $('#postForm');
    if (!f || !state.pick) return;
    const q = new URLSearchParams({
      work_type: f.elements.work_type.value, lat: state.pick.lat, lng: state.pick.lng,
      date: f.elements.date.value, workers_needed: f.elements.workers_needed.value,
    });
    try {
      const d = await api(`/ai/insight?${q}`);
      $('#insight').innerHTML = `<div class="insight risk-${d.risk}">
        <div>💡 AI fair-wage suggestion: <b>₹${d.suggested_wage}/day</b> (area median ₹${d.median_wage})
          <button type="button" class="btn tiny" data-act="useWage" data-wage="${d.suggested_wage}">Use</button></div>
        <div>👥 <b>${d.supply}</b> skilled workers free within 25 km · Shortage risk: <b>${d.risk.toUpperCase()}</b></div>
        <div class="small muted">${esc(d.tip)}</div>
      </div>`;
    } catch { $('#insight').innerHTML = ''; }
  }, 200);
}

async function submitJob(e) {
  e.preventDefault();
  const btn = e.submitter || $('#postForm button.primary');
  btn.disabled = true;
  try {
    const body = Object.fromEntries(new FormData(e.target));
    Object.assign(body, { farmer_id: state.me.id, lat: state.pick?.lat, lng: state.pick?.lng });
    const r = await api('/jobs', { method: 'POST', body });
    toast(`📣 Posted! AI alerted the ${r.notified} best-matched workers.`, 'success');
    $('#nl').value = '';
    $('#parseInfo').textContent = '';
    state.openMatches.add(r.job.id);
    scheduleRefresh(0);
  } catch (err) {
    toast(err.message, 'warn');
  } finally {
    btn.disabled = false;
  }
}

async function autofill() {
  const text = $('#nl').value.trim();
  if (!text) return toast('Type or speak the work details first', 'warn');
  try {
    const r = await api('/ai/parse', { method: 'POST', body: { text } });
    const f = $('#postForm');
    const set = (name, val) => {
      if (val == null || val === '') return;
      const el = f.elements[name];
      el.value = val;
      el.classList.remove('flash');
      void el.offsetWidth;
      el.classList.add('flash');
    };
    ['work_type', 'village', 'date', 'start_time', 'workers_needed', 'wage'].forEach((k) => set(k, r[k]));
    if (!f.elements.description.value) set('description', text.slice(0, 300));
    if (r.lat != null) { state.pick = { lat: r.lat, lng: r.lng }; placePick(true); }
    $('#parseInfo').textContent = `✓ Understood ${r.found.length}/6 details (${r.source})`;
    updateInsight();
  } catch (err) { toast(err.message, 'warn'); }
}

function startVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return toast('Voice input is not supported in this browser (try Chrome)', 'warn');
  const rec = new SR();
  rec.lang = state.lang === 'te' ? 'te-IN' : 'en-IN';
  rec.interimResults = false;
  rec.onresult = (e) => {
    const said = e.results[0][0].transcript;
    $('#nl').value = `${$('#nl').value} ${said}`.trim();
    autofill();
  };
  rec.onerror = (e) => toast(`Voice error: ${e.error}`, 'warn');
  rec.start();
  toast(`🎤 Listening (${rec.lang})…`);
}

async function refreshFarmer() {
  const me = state.me;
  const [jobs, notifs, workers] = await Promise.all([
    api(`/jobs?farmer_id=${me.id}`),
    api(`/notifications?user_id=${me.id}`),
    api('/workers/map'),
  ]);
  if (state.me?.id !== me.id) return;
  $('#myJobs').innerHTML = jobs.length ? jobs.map(farmerJobCard).join('') : `<p class="empty">${t('no_jobs')}</p>`;
  for (const id of state.openMatches) if (jobs.some((j) => j.id === id)) loadMatches(id);
  renderNotifs('#updates', notifs, false);

  if (state.layer) {
    state.layer.clearLayers();
    L.marker([me.lat, me.lng], { icon: emojiIcon('🏠', 'me') }).addTo(state.layer).bindTooltip('Your farm');
    for (const w of workers) {
      L.circleMarker([w.lat, w.lng], {
        radius: 6, weight: 1, color: '#fff', fillOpacity: 0.9, fillColor: w.available ? '#3f8f47' : '#b9b9b9',
      }).addTo(state.layer).bindTooltip(`${esc(w.name)} · ${esc(w.village)}<br>${w.skills.map((s) => state.wt[s]?.icon).join(' ')}`);
    }
    for (const j of jobs.filter((x) => x.status !== 'completed')) {
      L.marker([j.lat, j.lng], { icon: emojiIcon(j.work.icon) }).addTo(state.layer)
        .bindPopup(`<b>${esc(j.work.en)}</b><br>${esc(j.date_label)} · ${j.accepted_count}/${j.workers_needed} confirmed`);
    }
  }
}

function farmerJobCard(j) {
  const pct = Math.min(100, Math.round((j.accepted_count / j.workers_needed) * 100));
  const open = state.openMatches.has(j.id);
  return `<div class="job ${j.status}">
    <div class="job-head">
      <span class="icon">${j.work.icon}</span>
      <div class="grow">
        <b>${esc(j.work.en)}</b> <span class="te">${esc(j.work.te)}</span>
        <div class="meta"><span>📍 ${esc(j.village)}</span><span>📅 ${esc(j.date_label)}</span><span>⏰ ${esc(j.start_time)}</span><span>💰 ₹${j.wage}/day</span></div>
      </div>
      <span class="badge ${j.status}">${t(j.status)}</span>
    </div>
    <div class="progress"><div style="width:${pct}%"></div></div>
    <div class="small muted">👥 <b>${j.accepted_count}/${j.workers_needed}</b> confirmed · 🔔 ${j.notified} alerted · ⏳ ${j.pending} considering${j.declined ? ` · ✋ ${j.declined} declined` : ''} · 📡 search round ${j.notify_round}</div>
    ${j.accepted.length ? `<div class="crew">${j.accepted.map((w) => `<span class="crew-chip">👷 ${esc(w.name)} · ${w.distance} km · ⭐${Number(w.rating).toFixed(1)} <a href="tel:${esc(w.phone)}" title="Call ${esc(w.phone)}">📞</a></span>`).join('')}</div>` : ''}
    ${j.description ? `<p class="desc">“${esc(j.description)}”</p>` : ''}
    <div class="actions">
      <button class="btn small" data-act="matches" data-id="${j.id}">${t('ai_matches')} ${open ? '▲' : '▼'}</button>
      ${j.status === 'open' ? `<button class="btn small" data-act="dispatch" data-id="${j.id}">${t('notify_more')}</button>` : ''}
      ${['open', 'filled'].includes(j.status) && j.accepted_count ? `<button class="btn small ghost" data-act="complete" data-id="${j.id}">${t('complete')}</button>` : ''}
    </div>
    <div class="matches" id="m-${j.id}" ${open ? '' : 'hidden'}><p class="small muted">Loading AI matches…</p></div>
  </div>`;
}

async function loadMatches(id) {
  const el = $(`#m-${id}`);
  if (!el) return;
  try {
    const { candidates } = await api(`/jobs/${id}/matches`);
    el.innerHTML = `<div class="small muted">Ranked by acceptance probability from the open matching model. Reasons shown for transparency.</div>`
      + (candidates.length ? candidates.slice(0, 12).map((c) => `<div class="cand">
        <div class="cand-top">
          <b>${esc(c.worker.name)}</b><span class="muted small">${esc(c.worker.village)}</span>${pill(c.status)}
          <span class="grow"></span><b>${Math.round(c.score * 100)}%</b>
        </div>
        <div class="bar"><div style="width:${Math.round(c.score * 100)}%"></div></div>
        ${reasonChips(c.reasons)}
      </div>`).join('') : '<p class="empty">No available workers in range yet.</p>');
  } catch (err) { el.innerHTML = `<p class="empty">${esc(err.message)}</p>`; }
}

// ---------- worker ----------
function renderWorkerShell() {
  const me = state.me;
  $('#app').innerHTML = `
    <div class="grid">
      <div class="col">
        <div class="card" id="profile"></div>
        <div class="card"><h2>🔔 ${t('notifs')} <span id="notifCount"></span></h2><div id="notifs" class="list-scroll"></div></div>
        <div class="card"><h2>🤖 ${t('feed')}</h2><div id="feed"></div></div>
        <div class="card"><h2>📒 ${t('mine')}</h2><div id="mine"></div></div>
      </div>
      <div class="col side">
        <div class="card map-card"><div id="map"></div><p class="hint">${t('map_tip_w')}</p></div>
        <div class="card" id="aiCard"></div>
      </div>
    </div>`;
  initMap([me.lat, me.lng]);
  renderProfile();
}

function renderProfile() {
  const me = state.me;
  $('#profile').innerHTML = `
    <div class="profile-top">
      <div class="avatar">🧑‍🌾</div>
      <div class="grow">
        <h2 style="margin:0">${esc(me.name)}</h2>
        <div class="small muted">📍 ${esc(me.village)} · ⭐ ${Number(me.rating).toFixed(1)} · ${me.jobs_done} jobs done · ${t('expects')} ₹${me.daily_wage}/day · ${t('radius')} ${me.radius_km} km</div>
      </div>
    </div>
    <div class="switch ${me.available ? 'on' : ''}" data-act="toggleAvail" role="switch" aria-checked="${me.available}">
      <span class="track"></span><span>${me.available ? `🟢 ${t('available')}` : `💤 ${t('unavailable')}`}</span>
    </div>
    <div class="small muted" style="margin:6px 0 4px">${t('free_days')}</div>
    <div class="days">${[1, 2, 3, 4, 5, 6, 0].map((d) => `<button class="day ${me.available_days.includes(d) ? 'on' : ''}" data-act="toggleDay" data-day="${d}">${dayName(d)}</button>`).join('')}</div>
    <div class="small muted" style="margin:10px 0 4px">${t('skills')}</div>
    <div class="chips">${me.skills.map((s) => `<span class="chip skill">${workLabel(s)}</span>`).join('') || '<span class="muted small">-</span>'}</div>`;
}

async function refreshWorker() {
  const id = state.me.id;
  const [me, notifs, feed, mine] = await Promise.all([
    api(`/users/${id}`),
    api(`/notifications?user_id=${id}`),
    api(`/workers/${id}/feed`),
    api(`/workers/${id}/assignments`),
  ]);
  if (state.me?.id !== id) return;
  state.me = me;
  renderProfile();
  renderNotifs('#notifs', notifs, true);

  $('#feed').innerHTML = feed.length ? feed.slice(0, 15).map((r) => `<div class="job">
      <div class="job-head">
        <span class="icon">${r.job.work.icon}</span>
        <div class="grow">
          <b>${esc(r.job.work.en)}</b> <span class="te">${esc(r.job.work.te)}</span>${r.alerted ? ' <span class="pill alerted">alerted</span>' : ''}
          <div class="small muted">👨‍🌾 ${esc(r.job.farmer_name)} · ${esc(r.job.village)}</div>
        </div>
        ${scoreBadge(r.score)}
      </div>
      <div class="meta"><span>📅 ${esc(r.job.date_label)}</span><span>⏰ ${esc(r.job.start_time)}</span><span>💰 <b>₹${r.job.wage}</b>/day</span><span>👥 ${r.job.spots_left} ${t('spots_left')}</span></div>
      ${r.job.description ? `<p class="desc">“${esc(r.job.description)}”</p>` : ''}
      ${reasonChips(r.reasons)}
      <div class="actions">
        <button class="btn primary" data-act="accept" data-id="${r.job.id}">${t('accept')}</button>
        <button class="btn ghost" data-act="decline" data-id="${r.job.id}">${t('decline')}</button>
      </div>
    </div>`).join('') : `<p class="empty">${t('no_feed')}</p>`;

  $('#mine').innerHTML = mine.length ? mine.map((j) => `<div class="job ${j.booking_status === 'completed' ? 'completed' : 'filled'}">
      <div class="job-head">
        <span class="icon">${j.work.icon}</span>
        <div class="grow"><b>${esc(j.work.en)}</b> · ${esc(j.date_label)} ⏰ ${esc(j.start_time)}
          <div class="small muted">👨‍🌾 ${esc(j.farmer_name)} · 📍 ${esc(j.village)} (${j.distance} km) · 💰 ₹${j.wage}/day</div>
        </div>
        <span class="badge ${j.booking_status === 'completed' ? 'completed' : 'filled'}">${j.booking_status === 'completed' ? t('completed') : '✔'}</span>
      </div>
      ${j.booking_status === 'accepted' ? `<div class="actions">
        <a class="btn small" href="tel:${esc(j.farmer_phone)}">📞 ${esc(j.farmer_phone)}</a>
        <a class="btn small" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${j.lat},${j.lng}">🧭 ${t('directions')}</a>
        <button class="btn small ghost" data-act="withdraw" data-id="${j.id}">${t('withdraw')}</button>
      </div>` : ''}
    </div>`).join('') : `<p class="empty">${t('no_mine')}</p>`;

  if (state.layer) {
    state.layer.clearLayers();
    L.marker([me.lat, me.lng], { icon: emojiIcon('🏠', 'me') }).addTo(state.layer).bindTooltip('You');
    L.circle([me.lat, me.lng], { radius: me.radius_km * 1000, color: '#3f8f47', weight: 1, fillOpacity: 0.06 }).addTo(state.layer);
    for (const r of feed) {
      L.marker([r.job.lat, r.job.lng], { icon: emojiIcon(r.job.work.icon) }).addTo(state.layer)
        .bindPopup(`<b>${esc(r.job.work.en)}</b><br>${esc(r.job.village)} · ${esc(r.job.date_label)}<br>₹${r.job.wage}/day · ${Math.round(r.score * 100)}% match`);
    }
    for (const j of mine.filter((x) => x.booking_status === 'accepted')) {
      L.marker([j.lat, j.lng], { icon: emojiIcon('✅') }).addTo(state.layer).bindPopup(`<b>Booked:</b> ${esc(j.work.en)} · ${esc(j.date_label)}`);
    }
  }
}

function renderNotifs(sel, notifs, actionable) {
  const unread = notifs.filter((n) => !n.read).length;
  const countEl = $(sel === '#notifs' ? '#notifCount' : '#updCount');
  if (countEl) countEl.innerHTML = unread ? `<span class="count">${unread} new</span>` : '';
  $(sel).innerHTML = notifs.length ? notifs.map((n) => {
    const canAct = actionable && n.type === 'job_match' && !n.responded && n.job_status === 'open';
    return `<div class="notif ${n.read ? '' : 'unread'}">
      <div>${esc(n.message)}</div>
      <div class="small muted">${ago(n.created_at)}${n.score != null ? ` · 🤖 ${Math.round(n.score * 100)}% ${t('match')}` : ''} ${pill(n.responded)}</div>
      ${canAct ? `<div class="actions"><button class="btn primary small" data-act="accept" data-id="${n.job_id}">${t('accept')}</button><button class="btn ghost small" data-act="decline" data-id="${n.job_id}">${t('decline')}</button></div>` : ''}
    </div>`;
  }).join('') : `<p class="empty">${actionable ? t('no_notifs') : t('no_updates')}</p>`;
  if (unread) setTimeout(() => api('/notifications/read', { method: 'POST', body: { user_id: state.me.id } }).catch(() => {}), 4000);
}

// ---------- model card ----------
function renderModel(m) {
  const el = $('#aiCard');
  if (!el) return;
  const arrow = (d) => (d > 0.005 ? '<span class="up" title="Learned: more important than at start">↑</span>' : d < -0.005 ? '<span class="down" title="Learned: less important than at start">↓</span>' : '');
  el.innerHTML = `<h2>🧠 ${t('model')}</h2>
    <p class="small muted" style="margin-top:0">An open, explainable model scores every worker–job pair on these signals and predicts who will accept and show up.
    It <b>learns online</b> from every accept and decline, so matching keeps adapting to local behaviour. Everything runs locally, with no paid API.</p>
    ${m.features.map((f) => `<div class="feat"><span>${esc(f.label)}</span><div class="bar"><div style="width:${Math.round(f.importance * 100)}%"></div></div><span class="small">${Math.round(f.importance * 100)}% ${arrow(f.importance - f.prior_importance)}</span></div>`).join('')}
    <p class="small" style="margin-bottom:0">📚 Learned from <b>${m.samples}</b> live responses${m.accuracy != null ? ` · 🎯 <b>${Math.round(m.accuracy * 100)}%</b> prediction accuracy` : ''}</p>`;
}

// ---------- actions ----------
const actions = {
  home: () => (state.me ? scheduleRefresh(0) : renderLanding()),
  lang: () => {
    state.lang = state.lang === 'en' ? 'te' : 'en';
    localStorage.setItem('pp_lang', state.lang);
    $('#langBtn').textContent = state.lang === 'en' ? 'తెలుగు' : 'English';
    if (state.me) { renderWho(); renderShell(); refresh(); } else renderLanding();
  },
  login: (d) => login(Number(d.id)).catch((e) => toast(e.message, 'warn')),
  switchUser: () => renderLanding(),
  join: () => openJoin(),
  closeJoin: () => $('#joinDlg').close(),
  gps: () => useGps(),
  autofill: () => autofill(),
  voice: () => startVoice(),
  useWage: (d) => { const el = $('#postForm').elements.wage; el.value = d.wage; el.classList.add('flash'); },
  matches: (d) => {
    const id = Number(d.id);
    if (state.openMatches.has(id)) state.openMatches.delete(id); else state.openMatches.add(id);
    scheduleRefresh(0);
  },
  dispatch: async (d) => {
    const r = await api(`/jobs/${d.id}/dispatch`, { method: 'POST' });
    toast(r.notified ? `📣 Alerted ${r.notified} more workers (wider radius)` : 'No more available workers found. Try raising the wage.', r.notified ? 'success' : 'warn');
  },
  complete: async (d) => {
    await api(`/jobs/${d.id}/complete`, { method: 'POST', body: { farmer_id: state.me.id } });
    toast('✅ Job marked as completed. Workers thanked!', 'success');
  },
  accept: async (d) => {
    await api(`/jobs/${d.id}/accept`, { method: 'POST', body: { worker_id: state.me.id } });
    toast('✅ Booked! The farmer has been notified.', 'success');
  },
  decline: async (d) => {
    await api(`/jobs/${d.id}/decline`, { method: 'POST', body: { worker_id: state.me.id } });
    toast('Okay, we will find better matches for you.');
  },
  withdraw: async (d) => {
    if (!confirm('Cancel this booking? The farmer will be notified and a replacement will be found.')) return;
    await api(`/jobs/${d.id}/withdraw`, { method: 'POST', body: { worker_id: state.me.id } });
    toast('Booking cancelled.');
  },
  toggleAvail: async () => {
    state.me = await api(`/users/${state.me.id}`, { method: 'PATCH', body: { available: !state.me.available } });
    renderProfile();
  },
  toggleDay: async (d) => {
    const day = Number(d.day);
    const days = new Set(state.me.available_days);
    if (days.has(day)) days.delete(day); else days.add(day);
    state.me = await api(`/users/${state.me.id}`, { method: 'PATCH', body: { available_days: [...days] } });
    renderProfile();
  },
};

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || !actions[el.dataset.act]) return;
  e.preventDefault();
  if (el.tagName === 'BUTTON') el.disabled = true;
  try {
    await actions[el.dataset.act](el.dataset, el);
  } catch (err) {
    toast(err.message, 'warn');
    scheduleRefresh(0);
  } finally {
    if (el.tagName === 'BUTTON' && el.isConnected) el.disabled = false;
  }
});

boot().catch((e) => { $('#app').innerHTML = `<p class="pad">Failed to load: ${esc(e.message)}</p>`; });
