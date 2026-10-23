// Turns a spoken sentence into an intent + args for the MCP tools.
// Path 1: Gemini (askLLM) with a strict prompt, then validate everything it says.
// Path 2: if Gemini throws, a small rule parser still catches the 5 core patterns
//         (absent, extra, less, advance, bill) plus the common purchase/undo cases.

import { askLLM, stripFences } from './llm.js';
import { load } from './store.js';
import { hints, say } from './lang.js';
import { addDays, isValidDate, isValidMonth, monthOf, shiftMonth, todayIST } from './dates.js';

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
  tomato: ['tomato', 'tomatoes'],
  onion: ['onion', 'onions'],
  potato: ['potato', 'potatoes'],
  okra: ['okra', 'ladyfinger', 'ladyfingers', 'lady finger', 'lady fingers'],
  coriander: ['coriander', 'cilantro', 'coriander leaves'],
  milk: ['milk'],
  curd: ['curd', 'yogurt', 'yoghurt'],
  paneer: ['paneer', 'cottage cheese'],
  egg: ['egg', 'eggs'],
  bread: ['bread'],
  rice: ['rice'],
  flour: ['flour', 'wheat flour'],
  lentils: ['lentils', 'lentil', 'dal'],
  oil: ['oil', 'cooking oil'],
  sugar: ['sugar'],
  tea: ['tea'],
  banana: ['banana', 'bananas'],
  apple: ['apple', 'apples'],
  salt: ['salt'],
  carrot: ['carrot', 'carrots'],
  cabbage: ['cabbage'],
  cauliflower: ['cauliflower'],
  spinach: ['spinach'],
  brinjal: ['brinjal', 'brinjals', 'eggplant', 'aubergine'],
  cucumber: ['cucumber', 'cucumbers'],
  capsicum: ['capsicum', 'bell pepper', 'bell peppers'],
  beans: ['beans', 'green beans'],
  peas: ['peas', 'green peas'],
  garlic: ['garlic'],
  ginger: ['ginger'],
  lemon: ['lemon', 'lemons']
};

const ITEM_LOOKUP = new Map();
for (const [item, words] of Object.entries(ITEM_ALIASES)) {
  for (const word of words) ITEM_LOOKUP.set(norm(word), item);
}

const UNIT_ALIASES = {
  kg: ['kg', 'kgs', 'kilo', 'kilos', 'kilogram', 'kilograms'],
  litre: ['litre', 'litres', 'liter', 'liters', 'ltr', 'l'],
  dozen: ['dozen', 'dozens'],
  piece: ['piece', 'pieces', 'pcs', 'pc'],
  bunch: ['bunch', 'bunches'],
  packet: ['packet', 'packets', 'pkt'],
  g: ['g', 'gm', 'gms', 'gram', 'grams']
};

const UNIT_LOOKUP = new Map();
for (const [unit, words] of Object.entries(UNIT_ALIASES)) {
  for (const word of words) UNIT_LOOKUP.set(norm(word), unit);
}

const UNIT_BY_ITEM = {
  milk: 'litre', curd: 'litre', oil: 'litre',
  egg: 'dozen', coriander: 'bunch', banana: 'dozen', spinach: 'bunch'
};

const ROLE_WORDS = {
  maid: ['maid', 'housemaid', 'house help', 'cleaner', 'cleaning lady'],
  cook: ['cook', 'chef'],
  milkman: ['milkman', 'milk man', 'milk guy', 'milk delivery'],
  newspaper: ['newspaper', 'newspaper boy', 'paper boy', 'paperboy', 'newspaper man'],
  laundry: ['laundry', 'washerman', 'ironing', 'ironing man', 'dry cleaner'],
  driver: ['driver', 'chauffeur'],
  gardener: ['gardener'],
  sweeper: ['sweeper']
};

const NUMBER_WORDS = new Map(Object.entries({
  half: 0.5, quarter: 0.25, 'one and a half': 1.5, 'two and a half': 2.5,
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
  seventy: 70, eighty: 80, ninety: 90, hundred: 100
}));
// "a"/"an" only count as 1 when directly before a quantity word ("a litre extra")
const ARTICLE_UNIT = /\b(a|an)\s+(litre|liter|kg|kilo|day|dozen|packet|piece|bunch)\b/;

const MONTH_NAMES = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5,
  june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8, september: 9, sep: 9, sept: 9,
  october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12
};

const ADD_WORDS = ['add', 'new', 'hire', 'hired', 'register'];
const PURCHASE_WORDS = ['bought', 'buy', 'buying', 'purchased', 'got', 'paid for', 'picked up'];
const PRICE_WORDS = ['price', 'prices', 'rate', 'cheapest', 'cheaper', 'costly', 'expensive', 'going rate', 'how much is', 'how much are', 'how much does', 'cost'];
const BILL_WORDS = ['bill', 'how much do i owe', 'how much should i pay', 'how much to pay', 'owe', 'salary', 'pay', 'payment', 'dues'];
const SUMMARY_WORDS = ['summary', 'total', 'everyone', 'everybody', 'all helpers', 'all of them', 'all bills', 'all the helpers'];
const UNDO_WORDS = ['undo', 'cancel the last', 'remove the last', 'delete the last', 'scratch that', 'that was wrong', 'take that back', 'remove that'];
const ABSENT_WORDS = ['absent', 'leave', 'off', 'not come', 'did not come', 'didnt come', 'didnt turn up', 'didnt show up', 'did not turn up', 'did not show up', 'not coming', 'no show', 'skipped', 'missed', 'on leave', 'day off', 'holiday', 'didnt work', 'did not work', 'did not deliver', 'didnt deliver', 'not deliver', 'no delivery', 'no newspaper', 'no milk today', 'sick', 'was sick', 'bunked', 'took off', 'took the day off', 'didnt turn up', 'absent on', 'wasnt there', 'was not there', 'not there'];
const EXTRA_WORDS = ['extra', 'more', 'additional'];
const LESS_WORDS = ['less', 'short', 'fewer'];
const ADVANCE_WORDS = ['advance', 'loan', 'borrowed', 'lent'];
const VISIT_WORDS = ['visit', 'came', 'delivered', 'delivery', 'ironed', 'washed', 'pieces', 'clothes'];

// ---- normalization --------------------------------------------------------

function cleanText(text) {
  return String(text ?? '')
    .replace(/(\p{L})['’]s\b/gu, '$1')         // Shanti's bill -> Shanti bill
    .replace(/['’]/g, '')                     // didn't -> didnt
    .replace(/(\d),(\d{3})\b/g, '$1$2')      // 1,000 -> 1000
    .replace(/(\d)\.(\d)/g, '$1\u0000$2')     // protect decimals: 1.5 stays 1.5
    .replace(/[!?.,;:'"]+/g, ' ')
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

  const yesterday = addDays(date, -1);
  return `You are the intent parser for "Hisaab", a voice assistant that keeps an Indian household's money diary.
People talk to it casually, like to Alexa, and the text comes from speech recognition, so expect
loose grammar, filler words and misheard words. Work out what they MEAN and map it to one action.
Return ONE JSON object, nothing else: {"intent": "<name>", "args": { ... }}

Today (IST): ${date} (a ${new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })})
Hints: ${hints(lang)}

Helpers in this household (never invent one):
${JSON.stringify(people)}

Intents and args:
1. add_helper {name, role, rateType: "monthly"|"per_unit"|"per_visit", rate, unit?, paidLeaves?, defaultQtyPerDay?}
2. log_helper_event {helper, type: "absent"|"extra"|"less"|"advance"|"visit", qty?, amount?, date}
3. get_bill {helper?, month}
4. month_summary {month}
5. log_purchase {item, price, unit, vendor?, qty?, date}
6. price_check {item, vendor?}
7. undo_last {}
8. clarify {}   <- anything else: questions, advice, chit-chat, or truly unclear

Understanding people:
- Helper: match by name, role or alias, even if misheard or misspelled ("the maid", "our cook", "milk guy",
  "dermic" -> Dharmik, "laxmi" -> Lakshmi, "shanty" -> Shanti). Use the helper's id.
- Absent = didn't come / didn't turn up / was on leave / took a day off / was sick / skipped / bunked / no show.
- Extra = gave/brought/worked extra or more; less = gave less / short / fewer. If no amount is said, qty = 1.
- Advance = gave/paid/lent money in advance, took an advance, borrowed. amount is required.
- Visit = came / ironed / washed N pieces (for per-visit helpers like laundry).
- DATES: always fill "date" (YYYY-MM-DD). No date said -> today (${date}). "yesterday" -> ${yesterday}.
  "on the 10th", "10th October", "October 10", "on 5/10" -> that day (in ${date.slice(0, 4)}; if the day is
  after today, it means last month). "last Monday" / "on Friday" -> the most recent such day before today.
  "3 days ago" -> count back from today.
- add_helper: "add/hire/new/we have a <role> called/named <name> for <rate>", "<name> is our new cook at 5000".
  Write the name properly capitalised and fix obvious speech-recognition misspellings of Indian names.
  rateType: monthly salary -> "monthly" (default); per litre/kg (milkman) -> "per_unit" with unit;
  per piece/visit/day (laundry, ironing) -> "per_visit".
- Bills: one helper -> get_bill; everyone / total / all -> month_summary. "last month" -> previous month.
- Purchases: price is rupees PER unit. "2 kg for 80" -> price 40, qty 2. Items in English, lowercase, singular.
  Vendor in short lowercase words ("corner shop", "station market", "bigbasket") if said.
- Questions (how much did I spend, who was absent most, should I…), small talk, and anything not an action above -> clarify.

Examples:
"Shanti didn't come today" -> {"intent":"log_helper_event","args":{"helper":"shanti","type":"absent","date":"${date}"}}
"dharmik was absent on 10th of october" -> {"intent":"log_helper_event","args":{"helper":"<dharmik's id>","type":"absent","date":"${date.slice(0, 4)}-10-10"}}
"our maid bunked yesterday" -> {"intent":"log_helper_event","args":{"helper":"shanti","type":"absent","date":"${yesterday}"}}
"milk guy gave half litre less" -> {"intent":"log_helper_event","args":{"helper":"raju","type":"less","qty":0.5,"date":"${date}"}}
"i gave lakshmi thousand rupees advance" -> {"intent":"log_helper_event","args":{"helper":"lakshmi","type":"advance","amount":1000,"date":"${date}"}}
"add a cook called dharmik and 5000 a month" -> {"intent":"add_helper","args":{"name":"Dharmik","role":"cook","rateType":"monthly","rate":5000}}
"we have a new milkman ramu 60 rupees a litre" -> {"intent":"add_helper","args":{"name":"Ramu","role":"milkman","rateType":"per_unit","rate":60,"unit":"litre","defaultQtyPerDay":1}}
"got 2 kilo onions for 70 bucks at the station market" -> {"intent":"log_purchase","args":{"item":"onion","price":35,"unit":"kg","qty":2,"vendor":"station market","date":"${date}"}}
"what do i owe the cook" -> {"intent":"get_bill","args":{"helper":"lakshmi","month":"${date.slice(0, 7)}"}}
"how much do i have to pay everyone" -> {"intent":"month_summary","args":{"month":"${date.slice(0, 7)}"}}
"oops scratch that" -> {"intent":"undo_last","args":{}}
"how much did i spend on vegetables" -> {"intent":"clarify","args":{}}

Sentence: ${JSON.stringify(String(text ?? ''))}`;
}

// ---- validation of whatever the model said --------------------------------

// "dermic kumar" -> "Dermic Kumar"
const titleCase = (s) => String(s).trim().replace(/\s+/g, ' ').replace(/\b\p{L}/gu, (c) => c.toUpperCase());

// A day in the future can't be when something happened: use the same day a month earlier
// ("on the 25th" said on the 3rd means last month's 25th). Anything invalid -> today.
function sensibleDate(value, today) {
  if (!isValidDate(value)) return today;
  if (value <= today) return value;
  const [y, m, d] = value.split('-').map(Number);
  const earlier = `${shiftMonth(`${y}-${String(m).padStart(2, '0')}`, -1)}-${String(d).padStart(2, '0')}`;
  return isValidDate(earlier) && earlier <= today ? earlier : today;
}

const fail = (reason) => ({ ok: false, reason });

export function validateResult(raw, { text = '', date = todayIST(), helpers = [] } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('not a JSON object');
  const intent = typeof raw.intent === 'string' ? raw.intent.trim().toLowerCase() : '';
  if (!INTENTS.includes(intent)) return fail(`unknown intent "${raw.intent}"`);
  const args = raw.args && typeof raw.args === 'object' && !Array.isArray(raw.args) ? raw.args : {};

  if (intent === 'clarify') return { ok: true, intent, args: {} };
  if (intent === 'undo_last') return { ok: true, intent, args: {} };

  if (intent === 'add_helper') {
    const name = titleCase(String(args.name ?? ''));
    const role = String(args.role ?? '').trim().toLowerCase() || 'helper';
    const rate = toNumber(args.rate);
    const unit = args.unit ? normalizeUnit(args.unit) : null;
    if (!name) return fail('add_helper needs a name');
    if (!(rate > 0)) return fail('rate must be a positive number');
    // Missing or odd pay type: guess it the way a person would.
    let rateType = String(args.rateType ?? '').trim().toLowerCase();
    if (!RATE_TYPES.includes(rateType)) {
      rateType = /milk/.test(role) || unit === 'litre' || unit === 'kg' ? 'per_unit'
        : /laundry|wash|iron|dhobi/.test(role) ? 'per_visit' : 'monthly';
    }
    const out = { name, role, rateType, rate };
    if (unit) out.unit = unit;
    else if (rateType === 'per_unit') out.unit = /milk/.test(role) ? 'litre' : 'kg';
    const paidLeaves = toNumber(args.paidLeaves);
    if (paidLeaves != null && paidLeaves >= 0) out.paidLeaves = paidLeaves;
    const perDay = toNumber(args.defaultQtyPerDay);
    if (perDay != null && perDay > 0) out.defaultQtyPerDay = perDay;
    else if (rateType === 'per_unit' && /milk/.test(role)) out.defaultQtyPerDay = 1;
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
    if (type === 'advance' && amount == null) return fail('advance needs amount');

    const out = { helper: helper.id, type };
    if (qty != null) out.qty = qty;
    else if (type === 'extra' || type === 'less') out.qty = 1; // "gave extra" with no amount -> 1
    if (amount != null) out.amount = amount;
    out.date = sensibleDate(args.date, date);
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
      date: sensibleDate(args.date, date)
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
  // Number words: the earliest one in the sentence wins; at the same spot the longer phrase wins
  // ("one and a half" beats "one").
  let best = null;
  for (const [word, value] of NUMBER_WORDS) {
    const match = wordRx(word).exec(text);
    if (!match) continue;
    const index = match.index + match[1].length;
    if (!best || index < best.index || (index === best.index && word.length > best.length)) best = { value, index, length: word.length };
  }
  if (best) return { value: best.value, index: best.index };
  const article = ARTICLE_UNIT.exec(text); // "a litre extra" -> 1
  return article ? { value: 1, index: article.index } : null;
}

const CURRENCY = '(?:₹|rs\\.?|inr|rupees?|bucks)';

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
    return /^\s*(?:rupees?|rs|per|a|an|each|for|@)\b/.test(tail);
  });
  if (priced) return priced.value;
  return numbers.at(-1).value;
}

// "from the corner shop" -> "corner shop", "at station market" -> "station market"
function findVendor(text) {
  const stop = new Set(['today', 'yesterday', 'a', 'an', 'per', 'kg', 'kilo', 'litre', 'liter', 'dozen', 'rupees', 'rs']);
  const m = text.match(/\b(?:from|at)\s+(?:the\s+)?([\p{L}][\p{L}\d&'-]*(?:\s+[\p{L}][\p{L}\d&'-]*)?)/u);
  if (!m) return null;
  const words = m[1].split(' ').filter((w) => !stop.has(w) && !/^\d/.test(w));
  const tail = ['today', 'yesterday', 'for', 'per', 'at'];
  while (words.length && tail.includes(words.at(-1))) words.pop();
  return words.length ? words.join(' ') : null;
}

function findMonth(text, date) {
  const current = monthOf(date);
  if (hasAny(text, ['last month', 'previous month'])) {
    return shiftMonth(current, -1);
  }
  if (hasAny(text, ['next month'])) {
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

  const found = findNumber(text)?.value ?? null;
  const qty = found != null && found > 0 && found !== price ? found : null;
  const explicitUnit = findUnit(text);
  // "2 kg onions for 80" is a TOTAL; "40 a kilo" / "45 per kg" / "40 rupees a kg" is per unit.
  const perUnit = /(?:per|a|an|each|every|\/)\s*(?:kg|kgs|kilo|kilogram|litre|liter|ltr|dozen|piece|bunch|packet)\b|(?:rupees?|rs|₹\s*\d+)\s*(?:kg|kilo|litre|liter|dozen)\b/.test(text);
  const total = qty != null && !perUnit;
  const args = {
    item, price: total ? Math.round((price / qty) * 100) / 100 : price, unit: explicitUnit ?? unitFor(item), date
  };
  if (qty != null) args.qty = qty;
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
    new RegExp(`(?:called|named)\\s+([\\p{L}][\\p{L}']*)`, 'iu'),
    new RegExp(`([\\p{L}][\\p{L}']*)\\s+is\\s+(?:our|my|the)\\s+(?:new\\s+)?(?:${roleWords})`, 'iu'),
    new RegExp(`add\\s+([\\p{L}][\\p{L}']*(?:\\s+[\\p{L}][\\p{L}']*)?)\\s+(?:as|is)\\s+(?:a\\s+)?(?:${roleWords})`, 'iu'),
    new RegExp(`(?:${roleWords})\\s+(?:named\\s+)?([A-Z][\\p{L}]*)`, 'u'),
    new RegExp(`(?:hired|hire)\\s+([\\p{L}][\\p{L}']*)`, 'iu'),
    new RegExp(`add\\s+([\\p{L}][\\p{L}']*)`, 'iu')
  ];
  const forbidden = new Set([
    'add', 'new', 'the', 'a', 'an', 'maid', 'cook', 'milkman', 'driver', 'gardener',
    'sweeper', 'laundry', 'newspaper', 'helper', 'washerman', 'chef', 'cleaner'
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
  if (hasAny(text, ['per day', 'daily', 'per visit', 'per piece', 'per item', 'per shirt', 'per cloth', 'per clothes', 'a piece', 'each piece'])) rateType = 'per_visit';
  else if (hasAny(text, ['per kg', 'per kilo', 'per litre', 'per liter', 'a litre', 'a liter', 'per unit'])) rateType = 'per_unit';

  if (rateType === 'monthly' && role === 'milkman') rateType = 'per_unit';
  if (rateType === 'monthly' && role === 'laundry') rateType = 'per_visit';
  const args = { name: titleCase(name), role, rateType, rate };
  if (rateType === 'per_unit') args.unit = findUnit(text) ?? (role === 'milkman' ? 'litre' : 'kg');
  return { intent: 'add_helper', args };
}

// The day a sentence talks about, or today.
const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTH_RX = Object.keys(MONTH_NAMES).sort((a, b) => b.length - a.length).join('|');
export function dateSaid(text, today) {
  if (has(text, 'day before yesterday')) return addDays(today, -2);
  if (has(text, 'yesterday')) return addDays(today, -1);
  const ago = text.match(/\b(\d+|one|two|three|four|five|six|seven)\s+days?\s+ago\b/);
  if (ago) return addDays(today, -(Number(ago[1]) || NUMBER_WORDS.get(ago[1]) || 0));
  const weekday = text.match(new RegExp(`\\b(?:last|on|this past)\\s+(${DAY_NAMES.join('|')})\\b`));
  if (weekday) {
    const todayIdx = new Date(`${today}T00:00:00Z`).getUTCDay();
    const back = ((todayIdx - DAY_NAMES.indexOf(weekday[1]) + 7) % 7) || 7;
    return addDays(today, -back);
  }
  const ord = '(\\d{1,2})(?:st|nd|rd|th)?';
  const dayMonth = text.match(new RegExp(`\\b${ord}\\s+(?:of\\s+)?(${MONTH_RX})\\b`)) // 10th of october
    ?? (() => { const m = text.match(new RegExp(`\\b(${MONTH_RX})\\s+${ord}\\b`)); return m && [m[0], m[2], m[1]]; })(); // october 10
  if (dayMonth) {
    const iso = `${today.slice(0, 4)}-${String(MONTH_NAMES[dayMonth[2]]).padStart(2, '0')}-${String(dayMonth[1]).padStart(2, '0')}`;
    return sensibleDate(iso, today);
  }
  const slash = text.match(/\bon\s+(\d{1,2})\s*\/\s*(\d{1,2})\b/); // on 10/10 (day/month)
  if (slash) return sensibleDate(`${today.slice(0, 4)}-${slash[2].padStart(2, '0')}-${slash[1].padStart(2, '0')}`, today);
  const onThe = text.match(new RegExp(`\\bon\\s+the\\s+${ord}\\b`)); // on the 5th (this month)
  if (onThe) return sensibleDate(`${today.slice(0, 7)}-${String(onThe[1]).padStart(2, '0')}`, today);
  return today;
}

// 5 core patterns: absent / extra / less / advance / bill (plus purchase, price,
// visit, undo and add-helper for the demo script).
export function fallback(input, today = todayIST(), helpers = []) {
  const raw = String(input ?? '').trim();
  const text = cleanText(raw);
  if (!text) return { intent: 'clarify', args: {} };
  const date = dateSaid(text, today); // "yesterday", "on 10th of October", "last Monday"…

  if (hasAny(text, UNDO_WORDS)) return { intent: 'undo_last', args: {} };

  if (hasAny(text, ADD_WORDS) && findRole(text)) {
    const added = parseAddHelper(raw, text);
    if (added) return added;
  }

  const helper = findHelper(text, helpers);
  const month = findMonth(text, today);

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

  // "Tomatoes 40 rupees a kilo from the corner shop" (no "bought")
  if (findItem(text) && new RegExp(`${CURRENCY}|\\d+\\s*(?:per|a|an|/)?\\s*(?:kg|kilo|litre|liter|dozen)`).test(text)) {
    const bought = parsePurchase(text, date);
    if (bought) return bought;
  }

  if (hasAny(text, BILL_WORDS) || hasAny(text, SUMMARY_WORDS)) {
    const wantsSummary = hasAny(text, SUMMARY_WORDS) || (hasAny(text, BILL_WORDS) && !helper);
    const args = { month, date: today };
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
      if (checked.ok && checked.intent !== 'clarify') {
        return { intent: checked.intent, args: checked.args, source: 'llm' };
      }
      if (!checked.ok && process.env.HISAAB_DEBUG) console.warn('[understand] rejected LLM answer:', checked.reason);
      // The model was unsure (or gave something unusable): give the rules one chance before
      // treating it as a question for Ask.
      const ruled = fallback(sentence, ctx.date, helpers);
      if (ruled.intent !== 'clarify') return { ...ruled, source: 'fallback' };
      return clarifyResult(lang, 'llm');
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
