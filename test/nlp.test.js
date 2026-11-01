process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseWithRules } = require('../src/nlp');
const { addDays } = require('../src/catalog');

test('parses an English request with every field', () => {
  const r = parseWithRules('Need 6 people for paddy harvesting near Anakapalli for 3 days from tomorrow 6am, 600 per day, lunch provided');
  assert.equal(r.work_type, 'paddy_harvesting');
  assert.equal(r.workers_needed, 6);
  assert.equal(r.wage, 600);
  assert.equal(r.date, addDays(1));
  assert.equal(r.start_time, '06:00');
  assert.equal(r.duration_days, 3);
  assert.equal(r.village, 'Anakapalli');
  assert.deepEqual(r.facilities, ['meals']);
});

test('parses Telugu script', () => {
  const r = parseWithRules('రేపు చోడవరం లో చెరకు నరకడానికి 8 మంది కావాలి, మూడు రోజులు, కూలి 600 రూపాయలు, ఉదయం 6 గంటలకు');
  assert.equal(r.work_type, 'sugarcane_cutting');
  assert.equal(r.workers_needed, 8);
  assert.equal(r.wage, 600);
  assert.equal(r.duration_days, 3);
  assert.equal(r.village, 'Chodavaram');
  assert.equal(r.start_time, '06:00');
});

test('parses Telugu typed in English letters', () => {
  const r = parseWithRules('ellundi sabbavaram lo kalupu pani ki naluguru kavali, rs 450');
  assert.equal(r.work_type, 'weeding');
  assert.equal(r.workers_needed, 4);
  assert.equal(r.wage, 450);
  assert.equal(r.date, addDays(2));
  assert.equal(r.village, 'Sabbavaram');
});

test('does not mistake a day count for a worker count', () => {
  const r = parseWithRules('for 3 days transplanting in Paravada');
  assert.equal(r.workers_needed, null);
  assert.equal(r.duration_days, 3);
});

test('ignores implausible wages', () => {
  assert.equal(parseWithRules('need 5 workers, 50 rupees').wage, null);
});
