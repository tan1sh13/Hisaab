// Turns a spoken sentence into an intent + args for the MCP tools.
// Path 1: Gemini (askLLM) with a strict prompt, then validate everything it says.
// Path 2: if Gemini throws, a small rule parser still catches the 5 core patterns
//         (absent, extra, less, advance, bill) plus the common purchase/undo cases.

import { askLLM, stripFences } from './llm.js';
import { load } from './store.js';
import { hints, say } from './lang.js';
import { isValidDate, isValidMonth, monthOf, shiftMonth, todayIST } from './dates.js';

export const INTENTS = [
  'add_helper', 'log_helper_event', 'get_bill', 'month_summary',
  'log_purchase', 'price_check', 'undo_last', 'clarify'
];

const EVENT_TYPES = ['absent', 'extra', 'less', 'advance', 'visit'];
const RATE_TYPES = ['monthly', 'per_unit', 'per_visit'];

const norm = (value) => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const escapeRe = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordRx = (term) => new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(term)}(?=[^\\p{L}\\p{N}]|$)`, 'u');
const hasAny = (text, terms) => terms.some((term) => wordRx(term).test(text));
const has = (text, term) => wordRx(term).test(text);

// ---- small dictionaries ---------------------------------------------------

const ITEM_ALIASES = {
  tomato: ['tomato', 'tomatoes', 'tamatar', 'tamaatar', 'टमाटर', 'தக்காளி'],
  onion: ['onion', 'onions', 'pyaaz', 'pyaz', 'kanda', 'प्याज', 'प्याज़', 'வெங்காயம்'],
  potato: ['potato', 'potatoes', 'aloo', 'alu', 'आलू', 'உருளைக்கிழங்கு', 'urulaikizhangu'],
  bhindi: ['bhindi', 'okra', 'ladyfinger', 'lady finger', 'भिंडी', 'வெண்டைக்காய்', 'vendakkai'],
  coriander: ['coriander', 'dhaniya', 'dhania', 'cilantro', 'धनिया', 'கொத்தமல்லி', 'kothamalli'],
  milk: ['milk', 'doodh', 'dudh', 'दूध', 'பால்', 'paal'],
  curd: ['curd', 'dahi', 'yogurt', 'yoghurt', 'दही', 'தயிர்'],
  paneer: ['paneer', 'पनीर', 'பனீர்'],
  egg: ['egg', 'eggs', 'anda', 'ande', 'अंडा', 'अंडे', 'முட்டை'],
  bread: ['bread', 'double roti', 'ब्रेड', 'பிரெட்'],
  rice: ['rice', 'chawal', 'चावल', 'அரிசி'],
  atta: ['atta', 'flour', 'आटा', 'மாவு'],
  dal: ['dal', 'daal', 'दाल', 'பருப்பு'],
  oil: ['oil', 'tel', 'तेल', 'எண்ணெய்'],
  sugar: ['sugar', 'cheeni', 'chini', 'चीनी', 'சர்க்கரை'],
  tea: ['tea', 'chai', 'चाय', 'தேநீர்'],
  banana: ['banana', 'bananas', 'kela', 'केला', 'வாழைப்பழம்'],
  apple: ['apple', 'apples', 'seb', 'सेब', 'ஆப்பிள்'],
  salt: ['salt', 'namak', 'नमक', 'உப்பு']
};

const ITEM_LOOKUP = new Map();
for (const [item, words] of Object.entries(ITEM_ALIASES)) {
  for (const word of words) ITEM_LOOKUP.set(norm(word), item);
}

const UNIT_ALIASES = {
  kg: ['kg', 'kgs', 'kilo', 'kilos', 'kilogram', 'kilograms', 'किलो', 'கிலோ'],
  litre: ['litre', 'litres', 'liter', 'liters', 'ltr', 'l', 'लीटर', 'லிட்டர்'],
  dozen: ['dozen', 'dozens', 'darzan', 'dazan', 'दर्जन', 'டஜன்'],
  piece: ['piece', 'pieces', 'pcs', 'pc', 'nag', 'नग', 'எண்ணம்'],
  bunch: ['bunch', 'bunches', 'gaddi', 'गुच्छा', 'கட்டு'],
  packet: ['packet', 'packets', 'pkt', 'पैकेट', 'பாக்கெட்'],
  g: ['g', 'gm', 'gms', 'gram', 'grams', 'ग्राम']
};

const UNIT_LOOKUP = new Map();
for (const [unit, words] of Object.entries(UNIT_ALIASES)) {
  for (const word of words) UNIT_LOOKUP.set(norm(word), unit);
}

const UNIT_BY_ITEM = {
  milk: 'litre', curd: 'litre', oil: 'litre',
  egg: 'dozen', coriander: 'bunch', banana: 'dozen'
};

const ROLE_WORDS = {
  maid: ['maid', 'bai', 'kaamwali', 'kaam wali', 'kamwali', 'मेड', 'बाई', 'कामवाली', 'வேலைக்காரி'],
  cook: ['cook', 'khana banane wali', 'khana banane wali', 'महाराज', 'रसोइया', 'சமையல்காரர்'],
  milkman: ['milkman', 'doodhwala', 'dudhwala', 'दूधवाला', 'पाल்காரர்', 'பால்காரர்'],
  newspaper: ['newspaper', 'paperwala', 'paper wala', 'अखबारवाला', 'பேப்பர்காரர்'],
  dhobi: ['dhobi', 'washerman', 'धोबी', 'தோபி'],
  driver: ['driver', 'chauffeur', 'ड्राइवर', 'ஓட்டுநர்'],
  gardener: ['gardener', 'mali', 'माली', 'தோட்டக்காரர்'],
  sweeper: ['sweeper', 'जमादार', 'தூய்மைக்காரர்']
};

const NUMBER_WORDS = new Map(Object.entries({
  half: 0.5, quarter: 0.25,
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
  ek: 1, do: 2, teen: 3, char: 4, chaar: 4, paanch: 5, panch: 5, chhe: 6, che: 6, saat: 7,
  aath: 8, nau: 9, das: 10, gyarah: 11, barah: 12, pandrah: 15, bees: 20, pachees: 25,
  tees: 30, chalis: 40, pachas: 50, pachaas: 50, saath: 60, sattar: 70, assi: 80, nabbe: 90, sau: 100,
  aadha: 0.5, adha: 0.5, paav: 0.25, pav: 0.25, dedh: 1.5, dhai: 2.5,
  onnu: 1, rendu: 2, moonu: 3, naalu: 4, anju: 5, aaru: 6, ezhu: 7, ettu: 8, onbadhu: 9,
  pathu: 10, irubadhu: 20, muppadhu: 30, naarpadhu: 40, aimbadhu: 50, arubadhu: 60,
  nooru: 100, arai: 0.5, அரை: 0.5, ஒன்று: 1, இரண்டு: 2, மூன்று: 3, நான்கு: 4,
  ஐந்து: 5, பத்து: 10, இருபது: 20, முப்பது: 30, நாற்பது: 40, ஐம்பது: 50, அறுபது: 60, நூறு: 100,
  आधा: 0.5, पाव: 0.25, डेढ़: 1.5, ढाई: 2.5,
  एक: 1, दो: 2, तीन: 3, चार: 4, पांच: 5, पाँच: 5, छह: 6, सात: 7, आठ: 8, नौ: 9, दस: 10,
  बीस: 20, तीस: 30, चालीस: 40, पचास: 50, साठ: 60, सौ: 100
}));

const MONTH_NAMES = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5,
  june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8, september: 9, sep: 9, sept: 9,
  october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12,
  जनवरी: 1, फरवरी: 2, मार्च: 3, अप्रैल: 4, मई: 5, जून: 6, जुलाई: 7, अगस्त: 8,
  सितंबर: 9, अक्टूबर: 10, नवंबर: 11, दिसंबर: 12
};

const ADD_WORDS = ['add', 'jodo', 'jod', 'naya', 'nayi', 'new', 'जोड़', 'சேர்'];
const PURCHASE_WORDS = ['bought', 'buy', 'buying', 'kharida', 'kharide', 'kharidi', 'kharid', 'le liya', 'le liye', 'liya', 'खरीदा', 'खरीद', 'வாங்கினேன்'];
const PRICE_WORDS = ['price', 'rate', 'bhav', 'bhaav', 'daam', 'dam', 'kitne ka', 'kitna chal raha', 'भाव', 'कीमत', 'விலை'];
const BILL_WORDS = ['bill', 'hisaab', 'hisab', 'kitna dena', 'kitna dena hai', 'how much do i owe', 'how much should i pay', 'owe', 'salary', 'pagar', 'tankhwah', 'बिल', 'हिसाब', 'कितना देना', 'பில்', 'எவ்வளவு'];
const SUMMARY_WORDS = ['summary', 'sabka', 'sab ka', 'sab milakar', 'total', 'everyone', 'all helpers', 'saare', 'sabhi', 'सारांश', 'सबका', 'कुल', 'மொத்தம்'];
const UNDO_WORDS = ['undo', 'cancel the last', 'remove the last', 'delete the last', 'last entry hatao', 'wapas', 'waps', 'radd', 'वापस', 'रद्द', 'செயல்தவிர்'];
const ABSENT_WORDS = ['absent', 'chhutti', 'chutti', 'nahi aayi', 'nahi aaya', 'nahin aayi', 'nahi aya', 'leave', 'off', 'not come', 'did not come', 'didnt come', 'varala', 'varavillai', 'छुट्टी', 'नहीं आई', 'नहीं आया', 'வரவில்லை', 'வரல'];
const EXTRA_WORDS = ['extra', 'zyada', 'zyaada', 'jada', 'adhigam', 'more', 'ज़्यादा', 'ज्यादा', 'அதிகம்'];
const LESS_WORDS = ['less', 'kam', 'kamm', 'kammi', 'कम', 'கம்மி'];
const ADVANCE_WORDS = ['advance', 'advance diya', 'paise diye', 'paisa diya', 'pesa diya', 'udhaar', 'kuduthen', 'एडवांस', 'அட்வான்ஸ்'];
const VISIT_WORDS = ['visit', 'aaya', 'aayi', 'came', 'delivered', 'delivery', 'आया', 'आई', 'வந்தார்', 'வந்தாள்'];

// ---- normalization --------------------------------------------------------

const DEV = '०१२३४५६७८९';
const TAMIL_DIGITS = '௦௧௨௩௪௫௬௭௮௯';

function cleanText(text) {
  return String(text ?? '')
    .replace(/[०-९]/g, (d) => String(DEV.indexOf(d)))
    .replace(/[௦-௯]/g, (d) => String(TAMIL_DIGITS.indexOf(d)))
    .replace(/(\d),(\d{3})\b/g, '$1$2')      // 1,000 -> 1000
    .replace(/(\d)\.(\d)/g, '$1\u0000$2')     // protect decimals: 1.5 stays 1.5
    .replace(/[।!?.,;:'"]+/g, ' ')
    .replace(/\u0000/g, '.')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function normalizeItem(value) {
  const key = norm(value).replace(/[.,!?]/g, '');
  if (!key) return '';
  return ITEM_LOOKUP.get(key) ?? ITEM_LOOKUP.get(key.replace(/s$/, '')) ?? key;
}

export function normalizeUnit(value) {
  const key = norm(value).replace(/[.,!?]/g, '');
  return UNIT_LOOKUP.get(key) ?? (key || null);
}

const unitFor = (item) => UNIT_BY_ITEM[item] ?? 'kg';

const toNumber = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const s = value.replace(/[₹,\s]/g, '');
  const frac = s.match(/^(\d+)\/(\d+)$/);
  if (frac && Number(frac[2]) !== 0) return Number(frac[1]) / Number(frac[2]);
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  return null;
};

function coerceMonth(value, fallbackDate) {
  const raw = norm(value);
  if (isValidMonth(raw)) return raw;
  const loose = raw.match(/^(\d{4})-(\d{1,2})$/);
  if (loose) {
    const month = `${loose[1]}-${String(loose[2]).padStart(2, '0')}`;
    if (isValidMonth(month)) return month;
  }
  const name = Object.keys(MONTH_NAMES).find((key) => has(raw, key));
  if (name) return `${fallbackDate.slice(0, 4)}-${String(MONTH_NAMES[name]).padStart(2, '0')}`;
  return null;
}

// ---- helpers in the data file --------------------------------------------

export function resolveHelper(value, helpers = []) {
  const raw = typeof value === 'object' && value ? value.id ?? value.name : value;
  const key = norm(raw);
  if (!key) return null;
  const fields = (h) => [h.id, h.name, ...(h.aliases ?? [])].map(norm).filter(Boolean);
  const exact = helpers.find((h) => fields(h).includes(key));
  if (exact) return exact;
  return helpers.find((h) => {
    const names = fields(h);
    return names.some((name) => name.length > 2 && (name.includes(key) || key.includes(name)));
  }) ?? null;
}

function loadHelpers() {
  try {
    return load().helpers ?? [];
  } catch (error) {
    if (process.env.HISAAB_DEBUG) console.warn('[understand] could not load helpers:', error.message);
    return [];
  }
}

// ---- prompt ---------------------------------------------------------------

export function buildPrompt({ text, date = todayIST(), lang = 'en', helpers = [] } = {}) {
  const people = helpers.map((h) => ({
    id: h.id, name: h.name, role: h.role, rateType: h.rateType, rate: h.rate,
    unit: h.unit ?? null, aliases: h.aliases ?? []
  }));

  return `You are the intent parser for "Hisaab", a voice-first household money app in India.
Return ONE JSON object, nothing else. Schema: {"intent": "<name>", "args": { ... }}

Today (IST): ${date}
Reply language: ${lang} (speech only — all JSON keys and values stay in English)
Language hints: ${hints(lang)}

Helpers you may use (never invent one):
${JSON.stringify(people)}

Intents and args:
1. add_helper {name, role, rateType: "monthly"|"per_unit"|"per_visit", rate, unit?, paidLeaves?, defaultQtyPerDay?}
2. log_helper_event {helper, type: "absent"|"extra"|"less"|"advance"|"visit", qty?, amount?, date?}
3. get_bill {helper?, month, date?}
4. month_summary {month, date?}
5. log_purchase {item, price, unit, vendor?, qty?, date?}
6. price_check {item, vendor?}
7. undo_last {}
8. clarify {}

Rules:
- "helper" must be the id of a helper from the list above.
- qty and amount are JSON numbers. Fractions are allowed (aadha = 0.5, dedh = 1.5).
- "extra" and "less" need qty; "advance" needs amount.
- date is YYYY-MM-DD and month is YYYY-MM. If the user says no date, use today's date above. For bills, the month is the current month unless they say "last month".
- "bill" for one helper is get_bill; "everyone"/"total"/"sabka" is month_summary.
- log_purchase prices are in rupees PER unit (₹/kg, ₹/litre, ₹/dozen) — not the total bill.
- Convert item names to English singular: tamatar→tomato, pyaaz→onion, doodh→milk, etc.
- If something important is missing or unclear, return {"intent":"clarify","args":{}}.
- No markdown, no comments, no text outside the JSON.

Examples:
"Shanti didi nahi aayi aaj" -> {"intent":"log_helper_event","args":{"helper":"shanti","type":"absent","date":"${date}"}}
"Ramesh ne aadha litre doodh kam diya" -> {"intent":"log_helper_event","args":{"helper":"ramesh","type":"less","qty":0.5,"date":"${date}"}}
"2 kg tamatar 40 rupees kilo BigBasket se kharida" -> {"intent":"log_purchase","args":{"item":"tomato","price":40,"unit":"kg","qty":2,"vendor":"bigbasket","date":"${date}"}}
"Sarika ka is mahine ka bill" -> {"intent":"get_bill","args":{"helper":"sarika","month":"${date.slice(0, 7)}","date":"${date}"}}
"Sabka total kitna hai" -> {"intent":"month_summary","args":{"month":"${date.slice(0, 7)}","date":"${date}"}}

Sentence: ${JSON.stringify(String(text ?? ''))}`;
}

// ---- validation of whatever the model said --------------------------------

const fail = (reason) => ({ ok: false, reason });

export function validateResult(raw, { text = '', date = todayIST(), helpers = [] } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('not a JSON object');
  const intent = typeof raw.intent === 'string' ? raw.intent.trim().toLowerCase() : '';
  if (!INTENTS.includes(intent)) return fail(`unknown intent "${raw.intent}"`);
  const args = raw.args && typeof raw.args === 'object' && !Array.isArray(raw.args) ? raw.args : {};

  if (intent === 'clarify') return { ok: true, intent, args: {} };
  if (intent === 'undo_last') return { ok: true, intent, args: {} };

  if (intent === 'add_helper') {
    const name = String(args.name ?? '').trim();
    const role = String(args.role ?? '').trim().toLowerCase();
    const rateType = String(args.rateType ?? '').trim().toLowerCase();
    const rate = toNumber(args.rate);
    if (!name) return fail('add_helper needs a name');
    if (!role) return fail('add_helper needs a role');
    if (!RATE_TYPES.includes(rateType)) return fail(`bad rateType "${args.rateType}"`);
    if (!(rate > 0)) return fail('rate must be a positive number');

    const out = { name, role, rateType, rate };
    if (args.unit) out.unit = normalizeUnit(args.unit);
    const paidLeaves = toNumber(args.paidLeaves);
    if (paidLeaves != null && paidLeaves >= 0) out.paidLeaves = paidLeaves;
    const perDay = toNumber(args.defaultQtyPerDay);
    if (perDay != null && perDay > 0) out.defaultQtyPerDay = perDay;
    return { ok: true, intent, args: out };
  }

  if (intent === 'log_helper_event') {
    const helper = resolveHelper(args.helper, helpers);
    if (!helper) return fail(`unknown helper "${args.helper}"`);
    const type = String(args.type ?? '').trim().toLowerCase();
    if (!EVENT_TYPES.includes(type)) return fail(`bad event type "${args.type}"`);

    const qty = args.qty == null ? null : toNumber(args.qty);
    const amount = args.amount == null ? null : toNumber(args.amount);
    if (args.qty != null && !(qty > 0)) return fail('qty must be a positive number');
    if (args.amount != null && !(amount > 0)) return fail('amount must be a positive number');
    if ((type === 'extra' || type === 'less') && qty == null) return fail(`${type} needs qty`);
    if (type === 'advance' && amount == null) return fail('advance needs amount');

    const out = { helper: helper.id, type };
    if (qty != null) out.qty = qty;
    if (amount != null) out.amount = amount;
    out.date = isValidDate(args.date) ? args.date : date;
    if (text) out.raw = text;
    return { ok: true, intent, args: out };
  }

  if (intent === 'get_bill' || intent === 'month_summary') {
    const month = coerceMonth(args.month, date) ?? monthOf(date);
    const out = { month, date: isValidDate(args.date) ? args.date : date };
    if (intent === 'get_bill' && args.helper != null && String(args.helper).trim()) {
      const helper = resolveHelper(args.helper, helpers);
      if (!helper) return fail(`unknown helper "${args.helper}"`);
      out.helper = helper.id;
    }
    return { ok: true, intent, args: out };
  }

  if (intent === 'log_purchase') {
    const item = normalizeItem(args.item);
    const price = toNumber(args.price);
    const qty = args.qty == null ? null : toNumber(args.qty);
    if (!item) return fail('log_purchase needs an item');
    if (!(price > 0)) return fail('price must be a positive number');
    if (args.qty != null && !(qty > 0)) return fail('qty must be a positive number');

    const out = {
      item, price,
      unit: normalizeUnit(args.unit) ?? unitFor(item),
      date: isValidDate(args.date) ? args.date : date
    };
    if (qty != null) out.qty = qty;
    if (args.vendor != null && String(args.vendor).trim()) out.vendor = String(args.vendor).trim().toLowerCase();
    if (text) out.raw = text;
    return { ok: true, intent, args: out };
  }

  if (intent === 'price_check') {
    const item = normalizeItem(args.item);
    if (!item) return fail('price_check needs an item');
    const out = { item };
    if (args.vendor != null && String(args.vendor).trim()) out.vendor = String(args.vendor).trim().toLowerCase();
    return { ok: true, intent, args: out };
  }

  return fail(`unhandled intent "${intent}"`);
}

// ---- offline rules (Gemini down / no key) --------------------------------

function findHelper(text, helpers) {
  const padded = ` ${text} `;
  let best = null;
  let ambiguous = false;
  for (const helper of helpers) {
    const names = [helper.id, helper.name, ...(helper.aliases ?? [])]
      .map(norm).filter((name) => name.length > 1);
    for (const name of names) {
      const rx = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(name)}(?=[^\\p{L}\\p{N}]|$)`, 'u');
      if (!rx.test(padded)) continue;
      if (!best || name.length > best.length) {
        best = { helper, length: name.length };
        ambiguous = false;
      } else if (name.length === best.length && helper.id !== best.helper.id) {
        ambiguous = true;
      }
    }
  }
  return ambiguous ? null : best?.helper ?? null;
}

function findRole(text) {
  for (const [role, words] of Object.entries(ROLE_WORDS)) {
    if (hasAny(text, words)) return role;
  }
  return null;
}

function findItem(text) {
  let best = null;
  for (const [item, words] of Object.entries(ITEM_ALIASES)) {
    for (const word of words) {
      if (!has(text, word)) continue;
      if (!best || word.length > best.length) best = { item, length: word.length };
    }
  }
  return best?.item ?? null;
}

function findUnit(text) {
  for (const [unit, words] of Object.entries(UNIT_ALIASES)) {
    if (hasAny(text, words)) return unit;
  }
  return null;
}

function findNumber(text) {
  const frac = text.match(/(\d+)\s*\/\s*(\d+)/);
  if (frac && Number(frac[2]) !== 0) return { value: Number(frac[1]) / Number(frac[2]), index: frac.index };
  const digit = text.match(/(\d+(?:[.,]\d+)?)/);
  if (digit) return { value: Number(digit[1].replace(',', '.')), index: digit.index };
  for (const [word, value] of NUMBER_WORDS) {
    const rx = wordRx(word);
    const match = rx.exec(text);
    if (match) return { value, index: match.index };
  }
  return null;
}

const CURRENCY = '(?:₹|rs\\.?|rupees?|rupaye?|rupaya|रुपये|रुपए|ரூபாய்)';

function findAmount(text) {
  const after = text.match(new RegExp(`(${CURRENCY})\\s*(\\d+(?:[.,]\\d+)?)`));
  if (after) return Number(after[2].replace(',', '.'));
  const before = text.match(new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*${CURRENCY}`));
  if (before) return Number(before[1].replace(',', '.'));

  const numbers = [...text.matchAll(/(\d+(?:[.,]\d+)?)/g)]
    .map((m) => ({ value: Number(m[1].replace(',', '.')), index: m.index, length: m[1].length }));
  if (!numbers.length) return null;

  // Prefer a number that is followed by a price word, then the last number.
  const priced = numbers.find(({ index, length }) => {
    const tail = text.slice(index + length);
    return /^\s*(?:rupees?|rs|ka|ke|me|mein|per|par|@)/.test(tail);
  });
  if (priced) return priced.value;
  return numbers.at(-1).value;
}

function findVendor(text) {
  const stop = new Set(['the', 'a', 'an', 'today', 'aaj', 'kal', 'market', 'shop', 'dukaan', 'mandi']);
  const from = text.match(/\b(?:from|at)\s+([\p{L}][\p{L}\d&'.-]*(?:\s+[\p{L}][\p{L}\d&'.-]*)?)/u);
  if (from && !stop.has(from[1].split(' ')[0])) return from[1].trim();
  const se = text.match(/([\p{L}][\p{L}\d&'.-]*)\s+se\b/u);
  if (se && !stop.has(se[1])) return se[1].trim();
  return null;
}

function findMonth(text, date) {
  const current = monthOf(date);
  if (hasAny(text, ['last month', 'pichle mahine', 'pichhle mahine', 'पिछले महीने', 'கடந்த மாதம்'])) {
    return shiftMonth(current, -1);
  }
  if (hasAny(text, ['next month', 'agle mahine', 'अगले महीने', 'அடுத்த மாதம்'])) {
    return shiftMonth(current, 1);
  }
  const numeric = text.match(/(20\d{2})-(\d{1,2})/);
  if (numeric) {
    const month = `${numeric[1]}-${String(numeric[2]).padStart(2, '0')}`;
    if (isValidMonth(month)) return month;
  }
  for (const [name, number] of Object.entries(MONTH_NAMES)) {
    if (has(text, name)) return `${date.slice(0, 4)}-${String(number).padStart(2, '0')}`;
  }
  return current;
}

function eventResult(helper, type, extra = {}, date, raw = '') {
  return {
    intent: 'log_helper_event',
    args: { helper: helper.id, type, ...extra, date, ...(raw ? { raw } : {}) }
  };
}

function parsePurchase(text, date) {
  const item = findItem(text);
  if (!item) return null;
  const price = findAmount(text);
  if (!(price > 0)) return null;

  const qty = findNumber(text)?.value ?? null;
  const explicitUnit = findUnit(text);
  const args = {
    item, price, unit: explicitUnit ?? unitFor(item), date
  };
  if (qty != null && qty > 0 && qty !== price) args.qty = qty;
  const vendor = findVendor(text);
  if (vendor) args.vendor = vendor;
  args.raw = text;
  return { intent: 'log_purchase', args };
}

function parseAddHelper(raw, text) {
  const role = findRole(text);
  if (!role) return null;

  const roleWords = ROLE_WORDS[role].map(escapeRe).join('|');
  const candidates = [
    new RegExp(`add\\s+([\\p{L}][\\p{L}']*(?:\\s+[\\p{L}][\\p{L}']*)?)\\s+(?:as|is)\\s+(?:a\\s+)?(?:${roleWords})`, 'iu'),
    new RegExp(`(?:${roleWords})\\s+(?:named\\s+)?([A-Z][\\p{L}]*)`, 'u'),
    new RegExp(`([\\p{L}][\\p{L}']*)\\s+ko\\s+(?:${roleWords})`, 'iu'),
    new RegExp(`add\\s+([\\p{L}][\\p{L}']*)`, 'iu')
  ];
  const forbidden = new Set([
    'add', 'new', 'the', 'a', 'an', 'maid', 'cook', 'milkman', 'driver', 'gardener',
    'sweeper', 'dhobi', 'newspaper', 'helper', 'jodo', 'naya', 'nayi'
  ]);
  let name = null;
  for (const rx of candidates) {
    const match = raw.match(rx);
    const found = match?.[1]?.trim();
    if (found && !forbidden.has(found.toLowerCase())) { name = found; break; }
  }
  if (!name) return null;

  const rate = findAmount(text) ?? findNumber(text)?.value ?? null;
  if (!(rate > 0)) return null;

  let rateType = 'monthly';
  if (hasAny(text, ['per day', 'daily', 'roz', 'रोज', 'நாள்'])) rateType = 'per_visit';
  else if (hasAny(text, ['per kg', 'per kilo', 'per litre', 'per liter', 'per unit', 'per piece'])) rateType = 'per_unit';

  const args = { name, role, rateType, rate };
  if (rateType === 'per_unit') args.unit = findUnit(text) ?? 'kg';
  return { intent: 'add_helper', args };
}

// 5 core patterns: absent / extra / less / advance / bill (plus purchase, price,
// visit, undo and add-helper for the demo script).
export function fallback(input, date = todayIST(), helpers = []) {
  const raw = String(input ?? '').trim();
  const text = cleanText(raw);
  if (!text) return { intent: 'clarify', args: {} };

  if (hasAny(text, UNDO_WORDS)) return { intent: 'undo_last', args: {} };

  if (hasAny(text, ADD_WORDS) && findRole(text)) {
    const added = parseAddHelper(raw, text);
    if (added) return added;
  }

  const helper = findHelper(text, helpers);
  const month = findMonth(text, date);

  if (hasAny(text, PURCHASE_WORDS) && findItem(text)) {
    const bought = parsePurchase(text, date);
    if (bought) return bought;
  }

  if (hasAny(text, PRICE_WORDS) && findItem(text)) {
    const args = { item: findItem(text) };
    const vendor = findVendor(text);
    if (vendor) args.vendor = vendor;
    return { intent: 'price_check', args };
  }

  if (helper) {
    if (hasAny(text, ADVANCE_WORDS)) {
      const amount = findAmount(text);
      if (amount > 0) return eventResult(helper, 'advance', { amount }, date, raw);
    }
    if (hasAny(text, ABSENT_WORDS)) return eventResult(helper, 'absent', {}, date, raw);
    if (hasAny(text, EXTRA_WORDS)) {
      const qty = findNumber(text)?.value;
      if (qty > 0) return eventResult(helper, 'extra', { qty }, date, raw);
    }
    if (hasAny(text, LESS_WORDS)) {
      const qty = findNumber(text)?.value;
      if (qty > 0) return eventResult(helper, 'less', { qty }, date, raw);
    }
    if (hasAny(text, VISIT_WORDS)) {
      const qty = findNumber(text)?.value;
      return eventResult(helper, 'visit', qty > 0 ? { qty } : {}, date, raw);
    }
  }

  if (hasAny(text, BILL_WORDS) || hasAny(text, SUMMARY_WORDS)) {
    const wantsSummary = hasAny(text, SUMMARY_WORDS) || (hasAny(text, BILL_WORDS) && !helper);
    const args = { month, date };
    if (!wantsSummary) {
      if (!helper) return { intent: 'clarify', args: {} };
      args.helper = helper.id;
      return { intent: 'get_bill', args };
    }
    return { intent: 'month_summary', args };
  }

  return { intent: 'clarify', args: {} };
}

// ---- entry points ---------------------------------------------------------

const clarifyResult = (lang, source) => ({
  intent: 'clarify', args: {}, source, say: say(lang, 'clarify')
});

export async function understandWith(text, date = todayIST(), lang = 'en', options = {}) {
  const sentence = String(text ?? '').trim();
  if (!sentence) return clarifyResult(lang, 'fallback');

  const helpers = options.helpers ?? loadHelpers();
  const ctx = {
    text: sentence,
    date: isValidDate(date) ? date : todayIST(),
    helpers
  };
  const ask = options.ask === undefined ? askLLM : options.ask;

  if (ask) {
    try {
      const answer = await ask(buildPrompt({ ...ctx, lang }));
      const parsed = typeof answer === 'string' ? JSON.parse(stripFences(answer)) : answer;
      const checked = validateResult(parsed, ctx);
      if (!checked.ok) {
        if (process.env.HISAAB_DEBUG) console.warn('[understand] rejected LLM answer:', checked.reason);
        return clarifyResult(lang, 'llm');
      }
      if (checked.intent === 'clarify') return clarifyResult(lang, 'llm');
      return { intent: checked.intent, args: checked.args, source: 'llm' };
    } catch (error) {
      if (process.env.HISAAB_DEBUG) console.warn('[understand] Gemini failed, using rules:', error.message);
    }
  }

  const ruled = fallback(sentence, ctx.date, helpers);
  if (ruled.intent === 'clarify') return clarifyResult(lang, 'fallback');
  return { ...ruled, source: 'fallback' };
}

export async function understand(text, date = todayIST(), lang = 'en') {
  return understandWith(text, date, lang);
}
