process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseWithRules, parseJobText } = require('../src/nlp');
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

test('parses Hindi request in Devanagari script', () => {
  const r = parseWithRules('कल सुबह 6 बजे धान कटाई के लिए 8 मजदूर चाहिए, 550 रुपये, खाना मिलेगा');
  assert.equal(r.work_type, 'paddy_harvesting');
  assert.equal(r.workers_needed, 8);
  assert.equal(r.wage, 550);
  assert.equal(r.date, addDays(1));
  assert.equal(r.start_time, '06:00');
  assert.ok(r.facilities.includes('meals'));
});

test('parses Tamil request', () => {
  const r = parseWithRules('நாளை காலை 6 மணிக்கு நடவு வேலைக்கு 5 ஆட்கள் வேணும், கூலி 600, சாப்பாடு உண்டு');
  assert.equal(r.work_type, 'paddy_transplanting');
  assert.equal(r.workers_needed, 5);
  assert.equal(r.wage, 600);
  assert.equal(r.date, addDays(1));
  assert.equal(r.start_time, '06:00');
  assert.ok(r.facilities.includes('meals'));
});

test('parses Kannada request', () => {
  const r = parseWithRules('ನಾಳೆ ಬೆಳಗ್ಗೆ ನಾಟಿ ಕೆಲಸಕ್ಕೆ 6 ಜನ ಬೇಕು, ಕೂಲಿ 550');
  assert.equal(r.work_type, 'paddy_transplanting');
  assert.equal(r.workers_needed, 6);
  assert.equal(r.wage, 550);
  assert.equal(r.date, addDays(1));
  assert.equal(r.start_time, '06:00');
});

test('parses Bengali request', () => {
  const r = parseWithRules('আগামীকাল সকাল ধান কাটা কাজে 10 জন চাই, মজুরি 500 টাকা');
  assert.equal(r.work_type, 'paddy_harvesting');
  assert.equal(r.workers_needed, 10);
  assert.equal(r.wage, 500);
  assert.equal(r.date, addDays(1));
  assert.equal(r.start_time, '06:00');
});

test('parses Marathi request', () => {
  const r = parseWithRules('उद्या सकाळी कापणी कामासाठी 6 माणसे पाहिजे, मजुरी 600 रुपये');
  assert.equal(r.work_type, 'paddy_harvesting');
  assert.equal(r.workers_needed, 6);
  assert.equal(r.wage, 600);
  assert.equal(r.date, addDays(1));
  assert.equal(r.start_time, '06:00');
});

test('does not mistake a day count for a worker count', () => {
  const r = parseWithRules('for 3 days transplanting in Paravada');
  assert.equal(r.workers_needed, null);
  assert.equal(r.duration_days, 3);
});

test('ignores implausible wages', () => {
  assert.equal(parseWithRules('need 5 workers, 50 rupees').wage, null);
});

test('parseJobText returns confidence score and found fields', async () => {
  const res = await parseJobText('Need 4 workers for weeding in Sabbavaram tomorrow, 500 per day');
  assert.ok(res.confidence > 0.5);
  assert.ok(res.found.includes('work_type'));
  assert.ok(res.found.includes('workers_needed'));
  assert.ok(res.found.includes('village'));
  assert.ok(res.source === 'ai' || res.source === 'rules');
});
