process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert/strict');
const matcher = require('../src/matcher');
const { skillMatch, addDays } = require('../src/catalog');

const worker = (over = {}) => ({
  id: 1, lat: 17.69, lng: 83.0, skills: ['paddy_harvesting'], available_days: [0, 1, 2, 3, 4, 5, 6],
  daily_wage: 500, radius_km: 20, rating: 4.5, jobs_done: 20, no_shows: 0, ...over,
});
const job = (over = {}) => ({ id: 1, farmer_id: 99, work_type: 'paddy_harvesting', lat: 17.7, lng: 83.0, date: addDays(1), end_date: addDays(1), wage: 600, ...over });

test('skill match: exact, related, unrelated', () => {
  assert.equal(skillMatch(['paddy_harvesting'], 'paddy_harvesting').value, 1);
  assert.equal(skillMatch(['weeding'], 'paddy_harvesting').value, 0.55);
  assert.equal(skillMatch(['cashew_picking'], 'ploughing').value, 0.15);
});

test('closer, better-paid, available workers score higher', () => {
  matcher.resetModel();
  const near = matcher.score(matcher.features(worker(), job()).x);
  const far = matcher.score(matcher.features(worker({ lat: 17.95 }), job()).x);
  const underpaid = matcher.score(matcher.features(worker({ daily_wage: 900 }), job()).x);
  const busy = matcher.score(matcher.features(worker({ available_days: [] }), job()).x);
  assert.ok(near > far, 'distance');
  assert.ok(near > underpaid, 'wage');
  assert.ok(near > busy, 'availability');
});

test('every score comes with reasons', () => {
  const f = matcher.features(worker(), job());
  const codes = matcher.explain(worker(), job(), f).map((r) => r.code);
  for (const c of ['distance', 'skill_exact', 'days_free', 'wage_ok', 'reliability']) assert.ok(codes.includes(c), c);
});

test('online learning moves the prediction toward the label', () => {
  matcher.resetModel();
  const x = matcher.features(worker(), job()).x;
  const before = matcher.score(x);
  for (let i = 0; i < 20; i += 1) matcher.learn(x, 0);
  assert.ok(matcher.score(x) < before);
  assert.equal(matcher.modelInfo().samples, 20);
});

test('fill forecast is a valid probability', () => {
  assert.equal(matcher.fillForecast([], 1).probability, 0);
  assert.equal(matcher.fillForecast([1, 1, 1], 3).probability, 1);
  const f = matcher.fillForecast([0.5, 0.5], 1);
  assert.ok(Math.abs(f.probability - 0.75) < 1e-9);
  assert.equal(f.expected, 1);
});
