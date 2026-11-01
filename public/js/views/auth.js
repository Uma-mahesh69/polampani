// Phone + OTP login and the onboarding wizard.
import { state, api, esc, setSession } from '../core.js';
import { t } from '../i18n.js';
import { icon, toast, logo } from '../ui.js';
import { publicHeader } from './public.js';
import { createMap, pin } from '../map.js';

function afterLogin(ctx, user, token) {
  setSession(token, user);
  ctx.onLogin();
  const next = ctx.query.next;
  const home = user.role === 'farmer' ? '/f' : '/w';
  const safe = next && next.startsWith(`/${user.role === 'farmer' ? 'f' : 'w'}`) ? next : home;
  location.hash = `#${safe}`;
}

export async function login(ctx) {
  if (state.me) { location.replace(`#/${state.me.role === 'farmer' ? 'f' : 'w'}`); return; }
  let phone = '';
  let timer = null;

  const renderPhone = () => {
    ctx.root.querySelector('#auth').innerHTML = `
      <h1>${t('Log in or create an account')}</h1>
      <p>${t('Enter your mobile number. We will send a 6-digit code by SMS.')}</p>
      <form id="phoneForm" class="stack" style="margin-top:22px" novalidate>
        <label class="field"><span>${t('Mobile number')}</span>
          <div class="phone-input"><span>+91</span><input name="phone" inputmode="numeric" autocomplete="tel-national" maxlength="10" placeholder="98765 43210" value="${esc(phone)}" required></div>
        </label>
        <button class="btn btn-primary btn-lg btn-block">${t('Send code')}</button>
      </form>
      ${state.meta.demo_mode ? `<p class="small muted" style="margin-top:18px">${t('Just exploring?')} <a href="#/" data-act="toDemo">${t('Use a demo account')}</a></p>` : ''}`;
    const f = ctx.root.querySelector('#phoneForm');
    f.phone.focus();
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = f.querySelector('button');
      phone = f.phone.value.replace(/\D/g, '');
      if (!/^[6-9]\d{9}$/.test(phone)) { toast(t('Enter a valid 10-digit mobile number'), { kind: 'error' }); return; }
      btn.classList.add('loading');
      try {
        const r = await api('/auth/otp', { method: 'POST', body: { phone } });
        renderCode(r.dev_code);
      } catch (err) { toast(err.message, { kind: 'error' }); } finally { btn.classList.remove('loading'); }
    });
  };

  const renderCode = (devCode) => {
    const pretty = `+91 ${phone.slice(0, 5)} ${phone.slice(5)}`;
    ctx.root.querySelector('#auth').innerHTML = `
      <h1>${t('Enter the code')}</h1>
      <p>${t('We sent a 6-digit code to {phone}.', { phone: pretty })} <button class="link-btn" data-act="changePhone">${t('Change number')}</button></p>
      ${devCode ? `<div class="dev-code" style="margin-top:16px">${t('Demo mode has no SMS gateway. Your code is')}<b>${devCode}</b> <button class="link-btn" data-act="fillCode" data-code="${devCode}">${t('Fill it in')}</button></div>` : ''}
      <form id="codeForm" class="stack" style="margin-top:20px" novalidate>
        <div class="otp" role="group" aria-label="${t('6-digit code')}">${Array.from({ length: 6 }, (_, i) => `<input inputmode="numeric" maxlength="1" autocomplete="${i === 0 ? 'one-time-code' : 'off'}" aria-label="${t('Digit {n}', { n: i + 1 })}">`).join('')}</div>
        <button class="btn btn-primary btn-lg btn-block">${t('Verify and continue')}</button>
        <p class="small muted" id="resend"></p>
      </form>`;
    const f = ctx.root.querySelector('#codeForm');
    const boxes = [...f.querySelectorAll('.otp input')];
    boxes[0].focus();
    boxes.forEach((b, i) => {
      b.addEventListener('input', () => {
        b.value = b.value.replace(/\D/g, '').slice(-1);
        if (b.value && i < 5) boxes[i + 1].focus();
        if (boxes.every((x) => x.value)) f.requestSubmit();
      });
      b.addEventListener('keydown', (e) => { if (e.key === 'Backspace' && !b.value && i > 0) boxes[i - 1].focus(); });
      b.addEventListener('paste', (e) => {
        const digits = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6);
        if (digits.length) { e.preventDefault(); digits.split('').forEach((d, j) => { boxes[j].value = d; }); boxes[Math.min(5, digits.length)].focus(); if (digits.length === 6) f.requestSubmit(); }
      });
    });
    let left = 30;
    const tick = () => {
      const el = ctx.root.querySelector('#resend');
      if (!el) { clearInterval(timer); return; }
      el.innerHTML = left > 0 ? t('Resend code in {s}s', { s: left }) : `<button class="link-btn" data-act="resend">${t('Resend code')}</button>`;
      left -= 1;
      if (left < -1) clearInterval(timer);
    };
    clearInterval(timer);
    tick();
    timer = setInterval(tick, 1000);
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const code = boxes.map((x) => x.value).join('');
      if (code.length !== 6) return;
      const btn = f.querySelector('button.btn-primary');
      btn.classList.add('loading');
      try {
        const r = await api('/auth/verify', { method: 'POST', body: { phone, code } });
        clearInterval(timer);
        if (r.token) {
          toast(t('Welcome back, {name}', { name: r.user.name }), { kind: 'success' });
          afterLogin(ctx, r.user, r.token);
        } else {
          sessionStorage.setItem('pp_signup', JSON.stringify({ token: r.signup_token, phone: r.phone, role: ctx.query.role || null }));
          location.hash = '#/signup';
        }
      } catch (err) {
        toast(err.message, { kind: 'error' });
        boxes.forEach((x) => { x.value = ''; });
        boxes[0].focus();
      } finally { btn.classList.remove('loading'); }
    });
  };

  ctx.root.innerHTML = `${publicHeader()}<main class="auth-wrap"><div class="auth-card" id="auth"></div></main>`;
  renderPhone();
  ctx.onCleanup(() => clearInterval(timer));
  ctx.actions = {
    changePhone: () => renderPhone(),
    fillCode: (d) => {
      const boxes = [...ctx.root.querySelectorAll('.otp input')];
      d.code.split('').forEach((c, i) => { boxes[i].value = c; });
      ctx.root.querySelector('#codeForm').requestSubmit();
    },
    resend: async () => {
      const r = await api('/auth/otp', { method: 'POST', body: { phone } });
      toast(t('A new code is on its way'), { kind: 'success' });
      renderCode(r.dev_code);
    },
    toDemo: () => { location.hash = '#/'; setTimeout(() => document.getElementById('demo')?.scrollIntoView({ behavior: 'smooth' }), 150); },
  };
}

export async function signup(ctx) {
  const pending = JSON.parse(sessionStorage.getItem('pp_signup') || 'null');
  if (!pending) { location.replace('#/login'); return; }
  const draft = {
    role: pending.role || null, name: '', village: state.meta.villages[0].name, lat: null, lng: null, skills: [],
    daily_wage: 500, radius_km: 20, available_days: [1, 2, 3, 4, 5, 6], lang: state.lang, upi_id: '',
  };
  let step = 0;
  const steps = [t('About you'), t('Your village'), t('Your work')];

  const render = () => {
    const last = draft.role === 'farmer' ? 1 : 2;
    const stepper = `<ol class="wizard-steps">${steps.slice(0, last + 1).map((s, i) => `<li class="${i < step ? 'done' : i === step ? 'current' : ''}">${s}</li>`).join('')}</ol>`;
    let body = '';
    if (step === 0) {
      body = `<h1>${t('Welcome to PolamPani')}</h1><p>${t('How will you use PolamPani?')}</p>
        <div class="role-pick" style="margin-top:18px">
          <button type="button" data-act="role" data-role="farmer" aria-pressed="${draft.role === 'farmer'}"><span class="crop">🧑‍🌾</span><b>${t('I have farm work')}</b><small>${t('Post work and get a crew of labourers nearby')}</small></button>
          <button type="button" data-act="role" data-role="worker" aria-pressed="${draft.role === 'worker'}"><span class="crop">🌾</span><b>${t('I am looking for work')}</b><small>${t('Get alerts for paid fieldwork near your village')}</small></button>
        </div>
        <label class="field" style="margin-top:16px"><span>${t('Your name')}</span><input id="su-name" value="${esc(draft.name)}" autocomplete="name" maxlength="60" placeholder="${t('As people in your village know you')}"></label>`;
    } else if (step === 1) {
      body = `<h1>${t('Where are you?')}</h1><p>${draft.role === 'worker' ? t('We use this to find work you can reach.') : t('We use this to find workers near your fields.')}</p>
        <label class="field" style="margin-top:18px"><span>${t('Village or mandal')}</span>
          <select id="su-village">${state.meta.villages.map((v) => `<option value="${esc(v.name)}" ${v.name === draft.village ? 'selected' : ''}>${esc(state.lang === 'te' ? `${v.te} (${v.name})` : `${v.name} (${v.te})`)}</option>`).join('')}</select></label>
        <button type="button" class="btn btn-quiet btn-block" style="margin-top:10px" data-act="gps">${icon('locate')}${t('Use my current location')}</button>
        <div id="su-map" class="map" style="margin-top:12px;height:220px"></div>
        <p class="hint" style="margin-top:6px">${t('Drag the pin to your home if it is not exact.')}</p>`;
    } else {
      body = `<h1>${t('What work can you do?')}</h1><p>${t('Choose all that apply. Farmers will find you for these.')}</p>
        <div class="tiles" style="margin-top:16px">${state.meta.work_types.map((w) => `<button type="button" class="tile" data-act="skill" data-id="${w.id}" aria-pressed="${draft.skills.includes(w.id)}"><span class="crop">${w.icon}</span><b>${esc(state.lang === 'te' ? w.te : w.en)}</b><small>${esc(state.lang === 'te' ? w.en : w.te)}</small></button>`).join('')}</div>
        <div class="form-grid" style="margin-top:18px">
          <label class="field"><span>${t('Your daily rate')}</span><input id="su-wage" type="number" min="100" max="5000" step="25" value="${draft.daily_wage}"><small>${t('You will see how each job compares')}</small></label>
          <label class="field"><span>${t('How far can you travel?')} <b id="su-rad-v">${draft.radius_km} km</b></span><input id="su-radius" type="range" min="5" max="50" step="5" value="${draft.radius_km}"></label>
        </div>
        <div class="field" style="margin-top:14px"><span>${t('Days you usually work')}</span>
          <div class="days">${[1, 2, 3, 4, 5, 6, 0].map((d) => `<button type="button" class="day-btn" data-act="day" data-day="${d}" aria-pressed="${draft.available_days.includes(d)}">${new Intl.DateTimeFormat(state.lang === 'te' ? 'te-IN' : 'en-IN', { weekday: 'short' }).format(new Date(2024, 0, 7 + d))}</button>`).join('')}</div></div>
        <label class="field" style="margin-top:14px"><span>${t('UPI ID for payments (optional)')}</span><input id="su-upi" value="${esc(draft.upi_id)}" placeholder="name@ybl" autocapitalize="off"></label>`;
    }
    ctx.root.querySelector('#auth').innerHTML = `${stepper}${body}
      <div class="row-between" style="margin-top:24px">
        ${step > 0 ? `<button class="btn btn-ghost" data-act="back">${icon('left')}${t('Back')}</button>` : '<span></span>'}
        <button class="btn btn-primary btn-lg" data-act="next">${step === last ? t('Create account') : t('Continue')}</button>
      </div>`;
    if (step === 1) {
      const map = createMap(ctx.root.querySelector('#su-map'), { center: [draft.lat ?? villageOf(draft.village).lat, draft.lng ?? villageOf(draft.village).lng], zoom: 12 });
      if (map) {
        const m = L.marker(map.getCenter(), { icon: pin('home', '⌂'), draggable: true }).addTo(map);
        m.on('dragend', () => { const p = m.getLatLng(); draft.lat = p.lat; draft.lng = p.lng; });
        ctx.root.querySelector('#su-village').addEventListener('change', (e) => {
          draft.village = e.target.value; draft.lat = null; draft.lng = null;
          const v = villageOf(draft.village);
          map.setView([v.lat, v.lng], 12); m.setLatLng([v.lat, v.lng]);
        });
        ctx.mapMarker = { map, m };
      } else ctx.root.querySelector('#su-map').hidden = true;
    }
    if (step === 2) {
      const r = ctx.root.querySelector('#su-radius');
      r.addEventListener('input', () => { ctx.root.querySelector('#su-rad-v').textContent = `${r.value} km`; });
    }
  };
  const villageOf = (name) => state.meta.villages.find((v) => v.name === name) || state.meta.villages[0];
  const collect = () => {
    if (step === 0) draft.name = ctx.root.querySelector('#su-name').value.trim();
    if (step === 1) draft.village = ctx.root.querySelector('#su-village').value;
    if (step === 2) {
      draft.daily_wage = Number(ctx.root.querySelector('#su-wage').value);
      draft.radius_km = Number(ctx.root.querySelector('#su-radius').value);
      draft.upi_id = ctx.root.querySelector('#su-upi').value.trim();
    }
  };

  ctx.root.innerHTML = `<header class="public-top"><a class="brand" href="#/">${logo(36)}<span class="brand-name">PolamPani<small>పొలం పని</small></span></a></header>
    <main class="auth-wrap"><div class="auth-card" id="auth" style="width:min(620px,100%)"></div></main>`;
  render();

  ctx.actions = {
    role: (d) => { collect(); draft.role = d.role; render(); },
    skill: (d, el) => {
      draft.skills = draft.skills.includes(d.id) ? draft.skills.filter((s) => s !== d.id) : [...draft.skills, d.id];
      el.setAttribute('aria-pressed', draft.skills.includes(d.id));
    },
    day: (d, el) => {
      const day = Number(d.day);
      draft.available_days = draft.available_days.includes(day) ? draft.available_days.filter((x) => x !== day) : [...draft.available_days, day];
      el.setAttribute('aria-pressed', draft.available_days.includes(day));
    },
    gps: () => new Promise((resolve) => {
      if (!navigator.geolocation) { toast(t('Location is not available on this device'), { kind: 'error' }); resolve(); return; }
      navigator.geolocation.getCurrentPosition((p) => {
        draft.lat = p.coords.latitude; draft.lng = p.coords.longitude;
        ctx.mapMarker?.map.setView([draft.lat, draft.lng], 14);
        ctx.mapMarker?.m.setLatLng([draft.lat, draft.lng]);
        toast(t('Location set'), { kind: 'success' });
        resolve();
      }, () => { toast(t('Could not get your location. Choose your village instead.'), { kind: 'error' }); resolve(); }, { timeout: 10000 });
    }),
    back: () => { collect(); step -= 1; render(); },
    next: async () => {
      collect();
      if (step === 0) {
        if (!draft.role) { toast(t('Choose whether you are a farmer or a worker'), { kind: 'error' }); return; }
        if (draft.name.length < 2) { toast(t('Enter your name'), { kind: 'error' }); return; }
      }
      const last = draft.role === 'farmer' ? 1 : 2;
      if (step === 2 && !draft.skills.length) { toast(t('Choose at least one type of work'), { kind: 'error' }); return; }
      if (step === 2 && !draft.available_days.length) { toast(t('Choose at least one day you can work'), { kind: 'error' }); return; }
      if (step < last) { step += 1; render(); return; }
      const r = await api('/auth/signup', { method: 'POST', body: { ...draft, signup_token: pending.token } });
      sessionStorage.removeItem('pp_signup');
      toast(t('Welcome to PolamPani, {name}', { name: r.user.name }), { kind: 'success' });
      afterLogin(ctx, r.user, r.token);
    },
  };
}
