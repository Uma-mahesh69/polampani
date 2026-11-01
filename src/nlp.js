// Natural-language job post understanding.
//
// Farmers can type (or speak) a request in any Indian language — Telugu, Hindi,
// Tamil, Kannada, Malayalam, Bengali, Marathi, Gujarati, Odia, Punjabi, Assamese,
// or English.
//
// Parsing priority:
//   1. Gemini API (free tier from AI Studio) — best multilingual understanding
//   2. Any OpenAI-compatible LLM (Ollama, etc.) — self-hosted alternative
//   3. Offline rules engine — fast fallback, no network required
//
// The AI result is always merged with the rules engine so that whichever source
// extracts more fields wins on a per-field basis.

const { WORK_TYPES, WORK_TYPE_MAP, VILLAGES, ymd, todayStr } = require('./catalog');
const config = require('./config');

// ────────────────────── work-type keywords ──────────────────────
const KEYWORDS = {
  paddy_transplanting: {
    strong: [
      'transplant', 'naatlu', 'natlu', 'nattu', 'నాట్లు', 'నాటు',
      'ropai', 'रोपाई', 'रोपण',
      'நாற்று நடவு', 'நடவு', 'nadavu',
      'ನಾಟಿ', 'naati',
      'നടീൽ', 'ഞാറ്റടി', 'nadeel',
      'রোপণ', 'চারা রোপণ', 'ropon',
      'रोवणी', 'लावणी', 'rovani', 'lavani',
      'રોપણી', 'ropani',
      'ରୋଇବା', 'roiba',
      'ਲੁਆਈ', 'ਰੋਪਾਈ', 'luaai',
    ],
    weak: ['paddy', 'vari', 'వరి', 'planting', 'nursery', 'dhan', 'धान', 'நெல்', 'ভাত', 'ಭತ್ತ'],
  },
  paddy_harvesting: {
    strong: [
      'paddy harvest', 'harvesting paddy', 'harvest paddy', 'paddy cutting',
      'vari kotha', 'వరి కోత', 'కోతలు', 'kothalu',
      'katai', 'कटाई', 'धान कटाई',
      'அறுவடை', 'aruvadai',
      'ಕೊಯ್ಲು', 'koylu',
      'കൊയ്ത്ത്', 'koythu',
      'ধান কাটা', 'কাটাই', 'dhan kata',
      'कापणी', 'kapani',
      'કાપણી', 'લણણી', 'lannani',
      'ଧାନ କାଟିବା', 'dhan katiba',
      'ਵਾਢੀ', 'vaadhi',
    ],
    weak: ['harvest', 'reap', 'cutting', 'కోత', 'paddy', 'vari', 'వరి', 'நெல்', 'ভাত', 'ಭತ್ತ'],
  },
  weeding: {
    strong: [
      'weed', 'kalupu', 'కలుపు', 'nirai', 'निराई',
      'களை', 'களை எடுப்பு', 'kalai',
      'ಕಳೆ', 'ಕಳೆ ಕೀಳು', 'kale',
      'കള', 'കള പറിക്കൽ', 'kala',
      'আগাছা', 'নিড়ানি', 'nidani',
      'निंदणी', 'nindani', 'तण',
      'નિંદામણ', 'nindaman',
      'ଘାସ ବାଛିବା', 'ghasa bachiba',
      'ਗੋਡੀ', 'godi',
      'खरपतवार',
    ],
    weak: ['grass', 'gaddi', 'గడ్డి', 'புல்', 'ಹುಲ್ಲು', 'ঘাস'],
  },
  sowing: {
    strong: [
      'sow', 'seeding', 'vithanalu', 'విత్తన', 'buvai', 'बुवाई',
      'விதைப்பு', 'vidhaippu',
      'ಬಿತ್ತನೆ', 'bittane',
      'വിതയ്ക്കൽ', 'vidhakkal',
      'বপন', 'বীজ বপন', 'bopon',
      'पेरणी', 'perani',
      'વાવણી', 'vaavani',
      'ବୁଣିବା', 'buniba',
      'ਬਿਜਾਈ', 'bijaai',
      'बीजारोपण',
    ],
    weak: ['seed', 'groundnut', 'pulses', 'விதை', 'ಬೀಜ', 'বীজ'],
  },
  spraying: {
    strong: [
      'spray', 'pesticide', 'pichikari', 'పిచికారీ', 'మందు కొట్ట',
      'छिड़काव', 'कीटनाशक', 'chhidkav',
      'தெளிப்பு', 'பூச்சிக்கொல்லி', 'thelippu',
      'ಸಿಂಪಡಣೆ', 'simpadane',
      'തളിക്കൽ', 'thalikkal',
      'স্প্রে', 'কীটনাশক', 'kitanashak',
      'फवारणी', 'phavarani',
      'છંટકાવ', 'chhantkav',
      'ସ୍ପ୍ରେ', 'କୀଟନାଶକ',
      'ਸਪਰੇ', 'sapre',
    ],
    weak: ['mandu', 'మందు', 'insect', 'fertili', 'urea', 'ఎరువు', 'உரம்', 'সার'],
  },
  sugarcane_cutting: {
    strong: [
      'sugarcane', 'cheruku', 'చెరకు',
      'ganna', 'गन्ना',
      'கரும்பு', 'karumbu',
      'ಕಬ್ಬು', 'kabbu',
      'കരിമ്പ്', 'karimbu',
      'আখ', 'aakh',
      'ऊस', 'oos',
      'શેરડી', 'sherdi',
      'ଆଖୁ', 'aakhu',
      'ਗੰਨਾ',
    ],
    weak: ['cane'],
  },
  cashew_picking: {
    strong: [
      'cashew', 'jeedi', 'జీడి',
      'kaju', 'काजू',
      'முந்திரி', 'mundhiri',
      'ಗೋಡಂಬಿ', 'godambi',
      'കശുവണ്ടി', 'kashuvandi',
      'কাজু',
    ],
    weak: [],
  },
  mango_harvesting: {
    strong: [
      'mango', 'mamidi', 'మామిడి',
      'aam', 'आम',
      'மாங்காய்', 'மாம்பழம்', 'maangaai',
      'ಮಾವು', 'maavu',
      'മാങ്ങ', 'maanga',
      'আম',
    ],
    weak: [],
  },
  ploughing: {
    strong: [
      'plough', 'plow', 'tractor', 'dukki', 'దుక్కి', 'దున్న', 'tilling',
      'jutai', 'जुताई', 'हल',
      'உழவு', 'uzhavu',
      'ಉಳುಮೆ', 'ulume',
      'ഉഴവ്',
      'চাষ', 'হাল', 'chash', 'haal',
      'नांगरणी', 'nangrani',
      'ખેડ', 'khed',
      'ଚାଷ',
      'ਵਾਹੀ', 'vaahi',
    ],
    weak: ['land prep'],
  },
  irrigation: {
    strong: [
      'irrigat', 'canal', 'pipeline', 'neeru', 'నీరు', 'నీళ్లు', 'borewell',
      'सिंचाई', 'sinchai',
      'பாசனம்', 'paasanam',
      'ನೀರಾವರಿ', 'neeravari',
      'ജലസേചനം', 'jalasechanam',
      'সেচ', 'sech',
      'सिंचन', 'sinchan',
      'સિંચાઈ',
      'ଜଳସେଚନ', 'jalasechana',
      'ਸਿੰਚਾਈ',
    ],
    weak: ['water', 'நீர்', 'ನೀರು', 'জল'],
  },
  loading: {
    strong: [
      'loading', 'unloading', 'bags', 'basta', 'బస్తా', 'lorry',
      'लदाई', 'बोरी', 'ladaai',
      'ஏற்றுதல்', 'ettrudhal',
      'ಲೋಡಿಂಗ್',
      'ലോഡിംഗ്',
      'লোডিং', 'বস্তা', 'bosta',
      'लोडिंग', 'पोती',
    ],
    weak: ['load', 'transport', 'carry', 'சுமை', 'ಹೊರೆ', 'ভার'],
  },
};

// ────────────────────── number words ──────────────────────
const NUMBER_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30,
  // Telugu
  okaru: 1, iddaru: 2, rendu: 2, mugguru: 3, moodu: 3, naluguru: 4, nalugu: 4, aiduguru: 5, aidu: 5,
  aaruguru: 6, eduguru: 7, enimidi: 8, tommidi: 9, padimandi: 10, iravai: 20,
  'ఒకరు': 1, 'ఇద్దరు': 2, 'ముగ్గురు': 3, 'నలుగురు': 4, 'ఐదుగురు': 5, 'ఆరుగురు': 6, 'ఏడుగురు': 7,
  'ఎనిమిది': 8, 'తొమ్మిది': 9, 'పది': 10, 'పదిమంది': 10, 'పదిహేను': 15, 'ఇరవై': 20,
  'రెండు': 2, 'మూడు': 3, 'నాలుగు': 4, 'ఐదు': 5, 'ఆరు': 6, 'ఏడు': 7, 'వారం': 7,
  // Hindi
  ek: 1, do: 2, teen: 3, char: 4, paanch: 5, chhe: 6, saat: 7, aath: 8, nau: 9, das: 10, pandrah: 15, bees: 20,
  'एक': 1, 'दो': 2, 'तीन': 3, 'चार': 4, 'पाँच': 5, 'पांच': 5, 'छह': 6, 'छ': 6,
  'सात': 7, 'आठ': 8, 'नौ': 9, 'दस': 10, 'पंद्रह': 15, 'बीस': 20,
  // Tamil
  'ஒன்று': 1, 'இரண்டு': 2, 'மூன்று': 3, 'நான்கு': 4, 'ஐந்து': 5, 'ஆறு': 6, 'ஏழு': 7,
  'எட்டு': 8, 'ஒன்பது': 9, 'பத்து': 10, 'பதினைந்து': 15, 'இருபது': 20,
  onru: 1, irandu: 2, moondru: 3, naanku: 4, ainthu: 5, ezhu: 7, ettu: 8, onbadhu: 9, patthu: 10,
  // Kannada
  'ಒಂದು': 1, 'ಎರಡು': 2, 'ಮೂರು': 3, 'ನಾಲ್ಕು': 4, 'ಐದು': 5, 'ಆರು': 6, 'ಏಳು': 7,
  'ಎಂಟು': 8, 'ಒಂಬತ್ತು': 9, 'ಹತ್ತು': 10, 'ಇಪ್ಪತ್ತು': 20,
  ondu: 1, eradu: 2, mooru: 3, naalku: 4, elu: 7, entu: 8, ombattu: 9, hattu: 10,
  // Malayalam
  'ഒന്ന്': 1, 'രണ്ട്': 2, 'മൂന്ന്': 3, 'നാല്': 4, 'അഞ്ച്': 5, 'ആറ്': 6, 'ഏഴ്': 7,
  'എട്ട്': 8, 'ഒൻപത്': 9, 'പത്ത്': 10, 'ഇരുപത്': 20,
  // Bengali
  'এক': 1, 'দুই': 2, 'তিন': 3, 'চার': 4, 'পাঁচ': 5, 'ছয়': 6, 'সাত': 7,
  'আট': 8, 'নয়': 9, 'দশ': 10, 'পনেরো': 15, 'কুড়ি': 20,
  dui: 2, tin: 3, chhoy: 6, noy: 9, dosh: 10,
  // Marathi
  'दोन': 2, 'पाच': 5, 'सहा': 6, 'नऊ': 9, 'दहा': 10, 'पंधरा': 15, 'वीस': 20,
  don: 2, paach: 5, saha: 6, daha: 10,
  // Gujarati
  'બે': 2, 'ત્રણ': 3, 'પાંચ': 5, 'છ': 6, 'નવ': 9, 'દસ': 10, 'વીસ': 20,
  // Odia
  'ଏକ': 1, 'ଦୁଇ': 2, 'ତିନି': 3, 'ଚାରି': 4, 'ପାଞ୍ଚ': 5, 'ଛଅ': 6, 'ସାତ': 7,
  'ଆଠ': 8, 'ନଅ': 9, 'ଦଶ': 10,
  // Punjabi
  'ਇੱਕ': 1, 'ਦੋ': 2, 'ਤਿੰਨ': 3, 'ਚਾਰ': 4, 'ਪੰਜ': 5, 'ਛੇ': 6, 'ਸੱਤ': 7,
  'ਅੱਠ': 8, 'ਨੌ': 9, 'ਦਸ': 10, 'ਵੀਹ': 20,
};

// ────────────────────── worker words (regex) ──────────────────────
const WORKER_WORDS = '(?:'
  + 'workers?|people|persons?|members?|coolies|cooly|coolie|labou?rers?|labou?r|hands|men|women|ladies'
  + '|mandi|మంది|కూలీలు|కూలీ|kooleelu|kuli|kooli'
  + '|log|लोग|मजदूर|majdoor|aadmi|आदमी'
  + '|நபர்|ஆள்|ஆட்கள்|தொழிலாளர்|thozhilalar|aalkal'
  + '|ಜನ|ಕೆಲಸಗಾರ|ಕೂಲಿ|jana|kelasagara'
  + '|ആളുകൾ|തൊഴിലാളി|കൂലി|aalukal|thozhilali'
  + '|জন|মজদুর|শ্রমিক|jon|mojdur|shromik'
  + '|माणसे|मजूर|कामगार|maanse|majur|kamgar'
  + '|માણસ|મજૂર|maanas|majoor'
  + '|ଜଣ|ମଜୁର|ଶ୍ରମିକ|majura'
  + '|ਬੰਦੇ|ਮਜ਼ਦੂਰ|bande|mazdoor'
  + ')';

// ────────────────────── weekday names ──────────────────────
const WEEKDAYS = [
  [/sunday|aadivaram|adivaram|ఆదివారం|रविवार|ravivaar|ஞாயிறு|nyaayiru|ಭಾನುವಾರ|ഞായർ|রবিবার|રવિવાર|ରବିବାର|ਐਤਵਾਰ/, 0],
  [/monday|somavaram|సోమవారం|सोमवार|somvaar|திங்கள்|thingal|ಸೋಮವಾರ|തിങ്കൾ|সোমবার|સોમવાર|ସୋମବାର|ਸੋਮਵਾਰ/, 1],
  [/tuesday|mangalavaram|మంగళవారం|मंगलवार|mangalvaar|செவ்வாய்|sevvaai|ಮಂಗಳವಾರ|ചൊവ്വ|মঙ্গলবার|मंगळवार|મંગળવાર|ମଙ୍ଗଳବାର|ਮੰਗਲਵਾਰ/, 2],
  [/wednesday|budhavaram|బుధవారం|बुधवार|budhvaar|புதன்|budhan|ಬುಧವಾರ|ബുധൻ|বুধবার|બુધવાર|ବୁଧବାର|ਬੁੱਧਵਾਰ/, 3],
  [/thursday|guruvaram|గురువారం|गुरुवार|guruvaar|வியாழன்|viyaazhan|ಗುರುವಾರ|വ്യാഴം|বৃহস্পতিবার|ગુરુવાર|ଗୁରୁବାର|ਵੀਰਵਾਰ/, 4],
  [/friday|sukravaram|shukravaram|శుక్రవారం|शुक्रवार|shukrvaar|வெள்ளி|velli|ಶುಕ್ರವಾರ|വെള്ളി|শুক্রবার|શુક્રવાર|ଶୁକ୍ରବାର|ਸ਼ੁੱਕਰਵਾਰ/, 5],
  [/saturday|sanivaram|shanivaram|శనివారం|शनिवार|shanivaar|சனி|sani|ಶನಿವಾರ|ശനി|শনিবার|શનિવાર|ଶନିବାର|ਸ਼ਨਿੱਚਰਵਾਰ/, 6],
];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const DATE_TOMORROW = /tomorrow|repu|రేపు|\bkal\b|कल|நாளை|naale|ನಾಳೆ|നാളെ|আগামীকাল|agamikal|उद्या|udya|આવતીકાલે?|aavtikaal|ଆସନ୍ତାକାଲି|asantakali|ਕੱਲ੍ਹ/;
const DATE_TODAY = /today|ee ?roju|eeroju|ఈ\s?రోజు|ఈరోజు|\baaj\b|आज|இன்று|indru|ಇಂದು|indu|ഇന്ന്|innu|আজ|આજે?|aaje|ଆଜି|aaji|ਅੱਜ|ajj/;
const DATE_DAY_AFTER = /day after tomorrow|ellundi|ఎల్లుండి|parso|परसों|நாளை\s?மறுநாள்|ನಾಡಿದ್ದು|naadiddu|മറ്റന്നാൾ|mattannaal|পরশু|porshu|परवा|parva|પરમદિવસ|ପରଶୁ|ਪਰਸੋਂ|parson/;

const TIME_MORNING = /morning|udayam|ఉదయం|ఉదయాన్నే|subah|सुबह|காலை|kaalai|ಬೆಳಗ್ಗೆ|belagge|രാവിലെ|raavile|সকাল|sokal|सकाळ|sakal|સવાર|savar|ସକାଳ|sakala|ਸਵੇਰ|saver/;
const TIME_AFTERNOON = /afternoon|madhyahnam|మధ్యాహ్నం|dopahar|दोपहर|மதியம்|madhiyam|ಮಧ್ಯಾಹ್ನ|madhyahna|ഉച്ച|uccha|দুপুর|dupur|दुपार|dupar|બપોર|bapor|ଅପରାହ୍ନ|aparahna|ਦੁਪਹਿਰ|dupahir/;
const TIME_EVENING = /evening|sayantram|సాయంత్రం|shaam|शाम|மாலை|maalai|ಸಂಜೆ|sanje|വൈകുന്നേരം|vaikunneram|সন্ধ্যা|sondhya|संध्याकाळ|sandhyakal|સાંજ|saanj|ସନ୍ଧ୍ୟା|sandhya|ਸ਼ਾਮ/;

const DAY_WORDS = '(?:'
  + 'days?|rojulu|roju|రోజులు|రోజుల|రోజు|din|दिन'
  + '|நாள்|நாட்கள்|naal|naatkal'
  + '|ದಿನ|ದಿನಗಳು|dina'
  + '|ദിവസം|dhivasam'
  + '|দিন'
  + '|दिवस|divas'
  + '|દિવસ'
  + '|ଦିନ'
  + '|ਦਿਨ'
  + ')';

const FACILITY_PATTERNS = {
  meals: /lunch|meals?\b|food (?:will be )?provided|bhojanam|భోజనం|అన్నం|khana|खाना|சாப்பாடு|saappaadu|உணவு|ಊಟ|oota|ഭക്ഷണം|bhakshanam|খাবার|khabar|जेवण|jevan|ભોજન|bhojan|ଖାଦ୍ୟ|khadya|ਖਾਣਾ|khaana/,
  tea: /\btea\b|chai|snacks|tiffin|టీ|టిఫిన్|चाय|chaay|டீ|தேநீர்|theneer|ಚಹಾ|chaha|ചായ|chaaya|চা|cha|चहा|ચા|ଚା|ਚਾਹ|chaah/,
  transport: /pick ?-?up|transport|vehicle|vahanam|వాహనం|tractor will (?:come|pick)|वाहन|गाड़ी|gaadi|வாகனம்|vaaganam|ವಾಹನ|vaahana|വാഹനം|vaahanam|গাড়ি|गाडी|વાહન|vaahan|ଗାଡ଼ି|ਗੱਡੀ|gaddi/,
  tools: /tools? (?:provided|given|will be given)|పనిముట్లు ఇస్తా|கருவிகள்|ಉಪಕರಣ|ഉപകരണം|যন্ত্র|औजार|ઓજાર|ଯନ୍ତ୍ର|ਔਜ਼ਾਰ/,
};

const WAGE_PATTERNS = [
  /(?:₹|rs\.?|inr|rupees)\s*([\d,]{3,5})/i,
  /([\d,]{3,5})\s*(?:rs|rupees|\/-|₹|రూపాయలు|రూ|rupaye|रुपये|ரூபாய்|ರೂಪಾಯಿ|രൂപ|টাকা|રૂપિયા|ଟଙ୍କା|ਰੁਪਏ)/i,
  /(?:wage|kooli|కూలి|salary|pay|daily|கூலி|ಕೂಲಿ|കൂലി|মজুরি|मजुरी|મજૂરી|ମଜୁରୀ|ਮਜ਼ਦੂਰੀ)\D{0,12}([\d,]{3,5})/i,
  /([\d,]{3,5})\s*(?:per\s*day|\/\s*day|a day|each|per head|per person|রোজ|प्रतिदिन|ஒருநாள்)/i,
];

// ────────────────────── detection functions ──────────────────────

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
  if (!m) m = t.match(/\b(\d{1,3})\s*(?:kavali|kaavali|కావాలి|chahiye|चाहिए|needed|required|வேணும்|வேண்டும்|ಬೇಕು|വേണം|চাই|पाहिजे|જોઈએ|ଦରକାର|ਚਾਹੀਦੇ)/i);
  if (!m) m = t.match(/(?:need|want|require|kavali|kaavali|కావాలి|chahiye|for|வேணும்|ಬೇಕು|চাই)\s+(\d{1,3})\b(?!\s*(?:rs|₹|rupees|\/-|am|pm|km|th|st|nd|rd|days?|rojulu|రోజు|din))/i);
  const n = m ? Number(m[1]) : null;
  return n && n > 0 && n <= 200 ? n : null;
}

function detectWage(text) {
  for (const p of WAGE_PATTERNS) {
    const m = text.match(p);
    if (m) {
      const n = Number(m[1].replace(/,/g, ''));
      if (n >= 150 && n <= 5000) return n;
    }
  }
  return null;
}

function detectDate(lower, now) {
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const plus = (n) => { const d = new Date(base); d.setDate(d.getDate() + n); return ymd(d); };
  if (DATE_DAY_AFTER.test(lower)) return plus(2);
  if (DATE_TOMORROW.test(lower)) return plus(1);
  if (DATE_TODAY.test(lower)) return plus(0);
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
  let m = lower.match(/\b(\d{1,2})(?:[:](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)/);
  if (m) {
    let h = Number(m[1]) % 12;
    if (m[3].startsWith('p')) h += 12;
    return `${pad(h)}:${m[2] || '00'}`;
  }
  const evening = TIME_EVENING.test(lower);
  const afternoon = TIME_AFTERNOON.test(lower);
  m = lower.match(/\b(\d{1,2})(?::(\d{2}))?\s*(?:gantalaku|గంటలకు|గంటల|o'?clock|baje|बजे|மணி|mani|ಗಂಟೆ|gante|മണി|টা|ta|वाजता|vaajta|ਵਜੇ|vaje)/);
  if (m) {
    let h = Number(m[1]);
    if ((evening || afternoon) && h < 12) h += 12;
    return `${pad(h)}:${m[2] || '00'}`;
  }
  if (TIME_MORNING.test(lower)) return '06:00';
  if (afternoon) return '14:00';
  if (evening) return '16:00';
  return null;
}

function detectDuration(text) {
  const t = normaliseNumbers(text).toLowerCase();
  const m = t.match(new RegExp(`(\\d{1,2})\\s*${DAY_WORDS}`, 'i'));
  if (m) {
    const n = Number(m[1]);
    return n >= 1 && n <= 30 ? n : null;
  }
  if (/\b(?:a|one) week\b|వారం రోజులు|ஒரு வாரம்|ಒಂದು ವಾರ|ഒരു ആഴ്ച|এক সপ্তাহ|एक हफ्ता|એક અઠવાડિયું|ଏକ ସପ୍ତାହ|ਇੱਕ ਹਫ਼ਤਾ/.test(t)) return 7;
  return null;
}

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

// ────────────────────── AI-powered parsing ──────────────────────

const AI_PROMPT = (text) => `Today is ${todayStr()}. Extract the farm labour request below into JSON with these keys:
work_type (one of: ${WORK_TYPES.map((w) => w.id).join(', ')}), workers_needed (integer), wage (rupees per day, integer),
date (YYYY-MM-DD), start_time (HH:MM, 24h), duration_days (integer), village (one of: ${VILLAGES.map((v) => v.name).join(', ')}),
facilities (array of: meals, tea, transport, tools).
Use null for anything not mentioned. Facilities should be an empty array if none mentioned.

The text can be in ANY Indian language — Telugu, Hindi, Tamil, Kannada, Malayalam, Bengali, Marathi, Gujarati, Odia, Punjabi, Assamese, Konkani, or English — in native script or romanised transliteration. Understand the meaning regardless of language.

Reply with only a valid JSON object.

Request: """${text}"""`;

function validateAIResult(json) {
  const out = {};
  if (WORK_TYPE_MAP[json.work_type]) out.work_type = json.work_type;
  if (Number.isInteger(+json.workers_needed) && +json.workers_needed > 0 && +json.workers_needed <= 200) out.workers_needed = +json.workers_needed;
  if (+json.wage >= 150 && +json.wage <= 5000) out.wage = Math.round(+json.wage);
  if (/^\d{4}-\d{2}-\d{2}$/.test(json.date || '')) out.date = json.date;
  if (/^\d{2}:\d{2}$/.test(json.start_time || '')) out.start_time = json.start_time;
  if (Number.isInteger(+json.duration_days) && +json.duration_days >= 1 && +json.duration_days <= 30) out.duration_days = +json.duration_days;
  const v = VILLAGES.find((x) => x.name.toLowerCase() === String(json.village || '').toLowerCase());
  if (v) out.village = v.name;
  if (Array.isArray(json.facilities)) out.facilities = json.facilities.filter((f) => ['meals', 'tea', 'transport', 'tools'].includes(f));
  return out;
}

// ── Gemini API (free tier from Google AI Studio) ──

async function parseWithGemini(text) {
  const key = config.GEMINI_API_KEY;
  if (!key) return null;
  const model = config.GEMINI_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), config.LLM_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: AI_PROMPT(text) }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0,
        },
      }),
    });
    if (!res.ok) {
      console.warn(`[nlp] Gemini API ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return null;
    }
    const data = await res.json();
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const json = JSON.parse(content);
    return validateAIResult(json);
  } catch (e) {
    if (e.name !== 'AbortError') console.warn('[nlp] Gemini parse failed:', e.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ── OpenAI-compatible LLM (Ollama, vLLM, etc.) ──

async function parseWithLLM(text) {
  const base = config.LLM_BASE_URL;
  if (!base) return null;
  const model = config.LLM_MODEL;
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
        messages: [{ role: 'user', content: AI_PROMPT(text) }],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || '';
    const json = JSON.parse(content.slice(content.indexOf('{'), content.lastIndexOf('}') + 1));
    return validateAIResult(json);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ── Unified entry point: AI first, rules fill gaps ──

async function parseWithAI(text) {
  // Try Gemini first (free, best multilingual), then OpenAI-compatible LLM
  const result = await parseWithGemini(text) || await parseWithLLM(text);
  return result;
}

async function parseJobText(text) {
  const [ai, rules] = await Promise.all([
    parseWithAI(text),
    Promise.resolve(parseWithRules(text)),
  ]);
  // Start with rules as base, then AI overrides (AI is more accurate for complex input)
  const merged = { ...rules };
  if (ai) {
    for (const [k, v] of Object.entries(ai)) {
      if (v != null && !(Array.isArray(v) && v.length === 0 && merged[k]?.length > 0)) {
        merged[k] = v;
      }
    }
  }
  const v = VILLAGES.find((x) => x.name === merged.village);
  const found = ['work_type', 'workers_needed', 'wage', 'date', 'start_time', 'village', 'duration_days']
    .filter((k) => merged[k] != null);
  if (merged.facilities?.length) found.push('facilities');
  const aiUsed = ai && Object.keys(ai).length > 0;
  return {
    ...merged,
    lat: v ? v.lat : null,
    lng: v ? v.lng : null,
    found,
    confidence: Math.min(1, found.length / 6),
    source: aiUsed ? 'ai' : 'rules',
    model: aiUsed ? (config.GEMINI_API_KEY ? config.GEMINI_MODEL : config.LLM_MODEL) : null,
  };
}

module.exports = { parseJobText, parseWithRules };
