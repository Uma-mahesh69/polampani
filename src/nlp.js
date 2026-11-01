// Natural-language job post understanding.
//
// Farmers can type (or speak) a request like:
//   "Need 6 people for paddy transplanting near Anakapalli tomorrow 6am, 550 per day"
//   "రేపు అనకాపల్లిలో వరి నాట్లు కి 6 మంది కావాలి, కూలి 550"
// A fast multilingual rule engine (English / Telugu / transliterated Telugu / Hindi) extracts
// the structured fields offline. If LLM_BASE_URL points to any OpenAI-compatible server
// (e.g. Ollama running an open-weights model), its answer is merged in for harder phrasing.

const { WORK_TYPES, WORK_TYPE_MAP, VILLAGES, ymd, todayStr } = require('./catalog');
const config = require('./config');

const KEYWORDS = {
  paddy_transplanting: {
    strong: ['transplant', 'naatlu', 'natlu', 'nattu', 'నాట్లు', 'నాటు', 'ropai', 'रोपाई'],
    weak: ['paddy', 'vari', 'వరి', 'planting', 'nursery', 'dhan', 'धान'],
  },
  paddy_harvesting: {
    strong: ['paddy harvest', 'harvesting paddy', 'harvest paddy', 'paddy cutting', 'vari kotha', 'వరి కోత', 'కోతలు', 'kothalu', 'katai', 'कटाई'],
    weak: ['harvest', 'reap', 'cutting', 'కోత', 'paddy', 'vari', 'వరి'],
  },
  weeding: { strong: ['weed', 'kalupu', 'కలుపు', 'nirai', 'निराई'], weak: ['grass', 'gaddi', 'గడ్డి'] },
  sowing: { strong: ['sow', 'seeding', 'vithanalu', 'విత్తన', 'buvai', 'बुवाई'], weak: ['seed', 'groundnut', 'pulses'] },
  spraying: {
    strong: ['spray', 'pesticide', 'pichikari', 'పిచికారీ', 'మందు కొట్ట'],
    weak: ['mandu', 'మందు', 'insect', 'fertili', 'urea', 'ఎరువు'],
  },
  sugarcane_cutting: { strong: ['sugarcane', 'cheruku', 'చెరకు', 'ganna', 'गन्ना'], weak: ['cane'] },
  cashew_picking: { strong: ['cashew', 'jeedi', 'జీడి', 'kaju', 'काजू'], weak: [] },
  mango_harvesting: { strong: ['mango', 'mamidi', 'మామిడి'], weak: [] },
  ploughing: { strong: ['plough', 'plow', 'tractor', 'dukki', 'దుక్కి', 'దున్న', 'tilling', 'jutai'], weak: ['land prep'] },
  irrigation: { strong: ['irrigat', 'canal', 'pipeline', 'neeru', 'నీరు', 'నీళ్లు', 'borewell'], weak: ['water'] },
  loading: { strong: ['loading', 'unloading', 'bags', 'basta', 'బస్తా', 'lorry'], weak: ['load', 'transport', 'carry'] },
};

const NUMBER_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30,
  okaru: 1, iddaru: 2, rendu: 2, mugguru: 3, moodu: 3, naluguru: 4, nalugu: 4, aiduguru: 5, aidu: 5,
  aaruguru: 6, aaru: 6, eduguru: 7, enimidi: 8, tommidi: 9, padi: 10, padimandi: 10, iravai: 20,
  'ఒకరు': 1, 'ఇద్దరు': 2, 'ముగ్గురు': 3, 'నలుగురు': 4, 'ఐదుగురు': 5, 'ఆరుగురు': 6, 'ఏడుగురు': 7,
  'ఎనిమిది': 8, 'తొమ్మిది': 9, 'పది': 10, 'పదిమంది': 10, 'పదిహేను': 15, 'ఇరవై': 20,
  'రెండు': 2, 'మూడు': 3, 'నాలుగు': 4, 'ఐదు': 5, 'ఆరు': 6, 'ఏడు': 7, 'వారం': 7,
  teen: 3, paanch: 5, chhe: 6, saat: 7, aath: 8,
};

const WORKER_WORDS = '(?:workers?|people|persons?|members?|coolies|cooly|coolie|labou?rers?|labou?r|hands|men|women|ladies|mandi|మంది|కూలీలు|కూలీ|log|लोग|मजदूर|majdoor|kooleelu|kuli|kooli)';

const WEEKDAYS = [
  [/sunday|aadivaram|adivaram|ఆదివారం|रविवार/, 0], [/monday|somavaram|సోమవారం|सोमवार/, 1],
  [/tuesday|mangalavaram|మంగళవారం|मंगलवार/, 2], [/wednesday|budhavaram|బుధవారం|बुधवार/, 3],
  [/thursday|guruvaram|గురువారం|गुरुवार/, 4], [/friday|sukravaram|shukravaram|శుక్రవారం|शुक्रवार/, 5],
  [/saturday|sanivaram|shanivaram|శనివారం|शनिवार/, 6],
];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function detectWorkType(lower) {
  let best = null;
  let bestScore = 0;
  for (const w of WORK_TYPES) {
    const k = KEYWORDS[w.id];
    let s = 0;
    for (const kw of k.strong) if (lower.includes(kw)) s += 2;
    for (const kw of k.weak) if (lower.includes(kw)) s += 1;
    if (s > bestScore) { bestScore = s; best = w.id; }
  }
  return best;
}

function normaliseNumbers(text) {
  return text.split(/(\s+)/).map((tok) => {
    const bare = tok.toLowerCase().replace(/[.,!?;:]+$/, '');
    return NUMBER_WORDS[bare] != null ? String(NUMBER_WORDS[bare]) : tok;
  }).join('');
}

function detectWorkers(text) {
  const t = normaliseNumbers(text);
  let m = t.match(new RegExp(`(\\d{1,3})\\s*(?:[^\\s\\d]+\\s+)?${WORKER_WORDS}`, 'i'));
  if (!m) m = t.match(/\b(\d{1,3})\s*(?:kavali|kaavali|కావాలి|chahiye|चाहिए|needed|required)/i);
  if (!m) m = t.match(/(?:need|want|require|kavali|kaavali|కావాలి|chahiye|for)\s+(\d{1,3})\b(?!\s*(?:rs|₹|rupees|\/-|am|pm|km|th|st|nd|rd|days?|rojulu|రోజు|din))/i);
  const n = m ? Number(m[1]) : null;
  return n && n > 0 && n <= 200 ? n : null;
}

function detectWage(text) {
  const patterns = [
    /(?:₹|rs\.?|inr|rupees)\s*(\d{3,4})/i,
    /(\d{3,4})\s*(?:rs|rupees|\/-|₹|రూపాయలు|రూ|rupaye|रुपये)/i,
    /(?:wage|kooli|కూలి|salary|pay|daily)\D{0,12}(\d{3,4})/i,
    /(\d{3,4})\s*(?:per\s*day|\/\s*day|a day|each|per head|per person)/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      const n = Number(m[1]);
      if (n >= 150 && n <= 3000) return n;
    }
  }
  return null;
}

function detectDate(lower, now) {
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const plus = (n) => { const d = new Date(base); d.setDate(d.getDate() + n); return ymd(d); };
  if (/day after tomorrow|ellundi|ఎల్లుండి|parso|परसों/.test(lower)) return plus(2);
  if (/tomorrow|repu|రేపు|\bkal\b|कल/.test(lower)) return plus(1);
  if (/today|ee roju|eeroju|ఈ రోజు|ఈరోజు|\baaj\b|आज/.test(lower)) return plus(0);
  for (const [re, wd] of WEEKDAYS) {
    if (re.test(lower)) {
      let diff = (wd - base.getDay() + 7) % 7;
      if (diff === 0) diff = 7;
      return plus(diff);
    }
  }
  const resolve = (day, monthIdx, year) => {
    const y = year ? (year < 100 ? 2000 + year : year) : base.getFullYear();
    let d = new Date(y, monthIdx, day);
    if (d.getMonth() !== monthIdx) return null;
    if (!year && d < base) d = new Date(y + 1, monthIdx, day);
    return ymd(d);
  };
  let m = lower.match(/\b(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?\b(?!\s*(?:am|pm))/);
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) {
    const r = resolve(Number(m[1]), Number(m[2]) - 1, m[3] ? Number(m[3]) : null);
    if (r) return r;
  }
  m = lower.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*/);
  if (m) return resolve(Number(m[1]), MONTHS.indexOf(m[2]));
  m = lower.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?\b/);
  if (m) return resolve(Number(m[2]), MONTHS.indexOf(m[1]));
  m = lower.match(/\bon\s+(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)\b/);
  if (m) {
    const day = Number(m[1]);
    let d = new Date(base.getFullYear(), base.getMonth(), day);
    if (d < base) d = new Date(base.getFullYear(), base.getMonth() + 1, day);
    return ymd(d);
  }
  return null;
}

function detectTime(lower) {
  const pad = (n) => String(n).padStart(2, '0');
  let m = lower.match(/\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)/);
  if (m) {
    let h = Number(m[1]) % 12;
    if (m[3].startsWith('p')) h += 12;
    return `${pad(h)}:${m[2] || '00'}`;
  }
  const evening = /evening|sayantram|సాయంత్రం|shaam|शाम/.test(lower);
  const afternoon = /afternoon|madhyahnam|మధ్యాహ్నం|dopahar|दोपहर/.test(lower);
  m = lower.match(/\b(\d{1,2})(?::(\d{2}))?\s*(?:gantalaku|గంటలకు|గంటల|o'?clock|baje|बजे)/);
  if (m) {
    let h = Number(m[1]);
    if ((evening || afternoon) && h < 12) h += 12;
    return `${pad(h)}:${m[2] || '00'}`;
  }
  if (/morning|udayam|ఉదయం|ఉదయాన్నే|subah|सुबह/.test(lower)) return '06:00';
  if (afternoon) return '14:00';
  if (evening) return '16:00';
  return null;
}

const DAY_WORDS = '(?:days?|rojulu|roju|రోజులు|రోజుల|రోజు|din|दिन)';

function detectDuration(text) {
  const t = normaliseNumbers(text).toLowerCase();
  const m = t.match(new RegExp(`(\\d{1,2})\\s*${DAY_WORDS}`, 'i'));
  if (m) {
    const n = Number(m[1]);
    return n >= 1 && n <= 30 ? n : null;
  }
  if (/\b(?:a|one) week\b|వారం రోజులు/.test(t)) return 7;
  return null;
}

const FACILITY_PATTERNS = {
  meals: /lunch|meals?\b|food (?:will be )?provided|bhojanam|భోజనం|అన్నం|khana|खाना/,
  tea: /\btea\b|chai|snacks|tiffin|టీ|టిఫిన్/,
  transport: /pick ?-?up|transport|vehicle|vahanam|వాహనం|tractor will (?:come|pick)/,
  tools: /tools? (?:provided|given|will be given)|పనిముట్లు ఇస్తా/,
};

function detectFacilities(lower) {
  return Object.entries(FACILITY_PATTERNS).filter(([, re]) => re.test(lower)).map(([id]) => id);
}

function detectVillage(lower) {
  for (const v of VILLAGES) {
    const names = [v.name.toLowerCase(), v.te, ...(v.aliases || [])];
    if (names.some((n) => lower.includes(n))) return v;
  }
  return null;
}

function parseWithRules(text, now = new Date()) {
  const lower = text.toLowerCase();
  const village = detectVillage(lower);
  return {
    work_type: detectWorkType(lower),
    workers_needed: detectWorkers(text),
    wage: detectWage(text),
    date: detectDate(lower, now),
    start_time: detectTime(lower),
    duration_days: detectDuration(text),
    village: village ? village.name : null,
    facilities: detectFacilities(lower),
  };
}

async function parseWithLLM(text) {
  const base = config.LLM_BASE_URL;
  if (!base) return null;
  const model = config.LLM_MODEL;
  const prompt = `Today is ${todayStr()}. Extract the farm labour request below into JSON with keys:
work_type (one of: ${WORK_TYPES.map((w) => w.id).join(', ')}), workers_needed (integer), wage (rupees per day, integer),
date (YYYY-MM-DD), start_time (HH:MM, 24h), duration_days (integer), village (one of: ${VILLAGES.map((v) => v.name).join(', ')}).
Use null for anything not mentioned. The text may be English, Telugu or Hindi. Reply with JSON only.

Request: """${text}"""`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), config.LLM_TIMEOUT_MS);
  try {
    const res = await fetch(`${base.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(config.LLM_API_KEY ? { Authorization: `Bearer ${config.LLM_API_KEY}` } : {}),
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || '';
    const json = JSON.parse(content.slice(content.indexOf('{'), content.lastIndexOf('}') + 1));
    const out = {};
    if (WORK_TYPE_MAP[json.work_type]) out.work_type = json.work_type;
    if (Number.isInteger(+json.workers_needed) && +json.workers_needed > 0 && +json.workers_needed <= 200) out.workers_needed = +json.workers_needed;
    if (+json.wage >= 150 && +json.wage <= 3000) out.wage = Math.round(+json.wage);
    if (/^\d{4}-\d{2}-\d{2}$/.test(json.date || '')) out.date = json.date;
    if (/^\d{2}:\d{2}$/.test(json.start_time || '')) out.start_time = json.start_time;
    if (Number.isInteger(+json.duration_days) && +json.duration_days >= 1 && +json.duration_days <= 30) out.duration_days = +json.duration_days;
    const v = VILLAGES.find((x) => x.name.toLowerCase() === String(json.village || '').toLowerCase());
    if (v) out.village = v.name;
    return out;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function parseJobText(text) {
  const rules = parseWithRules(text);
  const llm = await parseWithLLM(text);
  const merged = { ...rules };
  if (llm) for (const [k, v] of Object.entries(llm)) if (v != null) merged[k] = v;
  const v = VILLAGES.find((x) => x.name === merged.village);
  const found = ['work_type', 'workers_needed', 'wage', 'date', 'start_time', 'village', 'duration_days']
    .filter((k) => merged[k] != null);
  if (merged.facilities?.length) found.push('facilities');
  return {
    ...merged,
    lat: v ? v.lat : null,
    lng: v ? v.lng : null,
    found,
    confidence: Math.min(1, found.length / 6),
    source: llm ? 'llm' : 'rules',
    model: llm ? config.LLM_MODEL : null,
  };
}

module.exports = { parseJobText, parseWithRules };
