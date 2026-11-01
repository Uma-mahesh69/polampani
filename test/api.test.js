process.env.DB_PATH = ':memory:';
process.env.DEMO_MODE = 'true';
process.env.SEED = 'false';
const test = require('node:test');
const assert = require('node:assert/strict');
const { app } = require('../server');
const { addDays } = require('../src/catalog');

let base;
let server;
test.before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
test.after(() => server.close());

async function call(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

async function signup(phone, profile) {
  const otp = await call('/auth/otp', { method: 'POST', body: { phone } });
  assert.equal(otp.status, 200);
  const v = await call('/auth/verify', { method: 'POST', body: { phone, code: otp.body.dev_code } });
  assert.ok(v.body.signup_token, 'new number gets a signup token');
  const s = await call('/auth/signup', { method: 'POST', body: { ...profile, signup_token: v.body.signup_token } });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  return s.body.token;
}

test('end-to-end: post, match, accept, fill, complete, rate, pay', async () => {
  const farmer = await signup('9811111111', { role: 'farmer', name: 'Test Farmer', village: 'Anakapalli' });
  const w1 = await signup('9822222222', { role: 'worker', name: 'Worker One', village: 'Anakapalli', skills: ['paddy_harvesting'], daily_wage: 500 });
  const w2 = await signup('9833333333', { role: 'worker', name: 'Worker Two', village: 'Kasimkota', skills: ['weeding'], daily_wage: 500 });

  const wrongCode = await call('/auth/verify', { method: 'POST', body: { phone: '9811111111', code: '000000' } });
  assert.equal(wrongCode.status, 400);

  const forbidden = await call('/jobs', { method: 'POST', token: w1, body: {} });
  assert.equal(forbidden.status, 403, 'workers cannot post jobs');
  assert.equal((await call('/jobs', { method: 'POST', body: {} })).status, 401, 'login required');

  const today = addDays(0);
  const preview = await call('/jobs/preview', { method: 'POST', token: farmer, body: { work_type: 'paddy_harvesting', village: 'Anakapalli', date: today, workers_needed: 2, wage: 600 } });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.in_range, 2);

  const posted = await call('/jobs', { method: 'POST', token: farmer, body: { work_type: 'paddy_harvesting', village: 'Anakapalli', date: today, workers_needed: 2, wage: 600, facilities: ['meals', 'bogus'] } });
  assert.equal(posted.status, 200, JSON.stringify(posted.body));
  assert.equal(posted.body.notified, 2);
  assert.deepEqual(posted.body.job.facilities, ['meals']);
  const id = posted.body.job.id;

  const feed = await call('/feed', { token: w1 });
  assert.equal(feed.body[0].job.id, id);
  assert.ok(feed.body[0].reasons.length > 0);

  assert.equal((await call(`/jobs/${id}/accept`, { method: 'POST', token: w1 })).status, 200);
  assert.equal((await call(`/jobs/${id}/accept`, { method: 'POST', token: w1 })).status, 409, 'no double accept');
  assert.equal((await call(`/jobs/${id}/accept`, { method: 'POST', token: w2 })).status, 200);

  const full = await call(`/jobs/${id}`, { token: farmer });
  assert.equal(full.body.status, 'filled');
  assert.equal(full.body.crew.length, 2);

  const workerView = await call(`/jobs/${id}`, { token: w2 });
  assert.ok(workerView.body.farmer.phone, 'phone shared after accepting');
  assert.equal(workerView.body.crew, undefined, 'workers do not see the crew list');

  assert.equal((await call(`/jobs/${id}/checkin`, { method: 'POST', token: w1 })).status, 200);

  const w2id = full.body.crew.find((c) => c.name === 'Worker Two').id;
  const done = await call(`/jobs/${id}/complete`, { method: 'POST', token: farmer, body: { attendance: { [w2id]: 'no_show' } } });
  assert.equal(done.status, 200);
  const present = done.body.crew.find((c) => c.name === 'Worker One');
  assert.equal(present.status, 'completed');
  assert.equal(present.amount, 600);
  assert.equal(done.body.crew.find((c) => c.name === 'Worker Two').status, 'no_show');

  assert.equal((await call(`/assignments/${present.assignment_id}/review`, { method: 'POST', token: farmer, body: { rating: 5 } })).status, 200);
  assert.equal((await call(`/assignments/${present.assignment_id}/paid`, { method: 'POST', token: farmer, body: { method: 'upi' } })).status, 200);
  const work = await call('/work', { token: w1 });
  assert.equal(work.body.earnings.total, 600);
  assert.equal(work.body.past[0].paid, true);

  const notifs = await call('/notifications', { token: w1 });
  assert.ok(notifs.body.some((n) => n.type === 'paid'));
});

test('a cancellation reopens the job and searches again', async () => {
  const farmer = await signup('9844444444', { role: 'farmer', name: 'Second Farmer', village: 'Chodavaram' });
  const w = await signup('9855555555', { role: 'worker', name: 'Worker Three', village: 'Chodavaram', skills: ['sowing'] });
  const posted = await call('/jobs', { method: 'POST', token: farmer, body: { work_type: 'sowing', village: 'Chodavaram', date: addDays(3), workers_needed: 1, wage: 550 } });
  const id = posted.body.job.id;
  await call(`/jobs/${id}/accept`, { method: 'POST', token: w });
  assert.equal((await call(`/jobs/${id}`, { token: farmer })).body.status, 'filled');
  await call(`/jobs/${id}/withdraw`, { method: 'POST', token: w });
  const after = await call(`/jobs/${id}`, { token: farmer });
  assert.equal(after.body.status, 'open');
  assert.ok(after.body.events.some((e) => e.type === 'withdrawn'));
});

test('validation errors are clear', async () => {
  const farmer = await signup('9866666666', { role: 'farmer', name: 'Third Farmer', village: 'Paravada' });
  const r = await call('/jobs', { method: 'POST', token: farmer, body: { work_type: 'weeding', date: '2001-01-01', workers_needed: 2, wage: 500 } });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /past/);
  assert.equal((await call('/auth/otp', { method: 'POST', body: { phone: '12345' } })).status, 400);
});
