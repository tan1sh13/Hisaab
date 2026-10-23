import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPrompt, fallback, normalizeItem, normalizeUnit, understandWith
} from '../src/understand.js';

const DATE = '2026-10-22';
const MONTH = '2026-10';

// Same shape Tanish's add_helper writes: id, name, role and name-part aliases.
const HELPERS = [
  {
    id: 'shanti', name: 'Shanti', role: 'maid', rateType: 'monthly',
    rate: 3100, unit: null, paidLeaves: 1, aliases: ['shanti', 'maid']
  },
  {
    id: 'ramesh', name: 'Ramesh', role: 'milkman', rateType: 'per_unit',
    rate: 30, unit: 'litre', defaultQtyPerDay: 1, aliases: ['ramesh', 'milkman']
  },
  {
    id: 'sunita', name: 'Sunita', role: 'cook', rateType: 'per_visit',
    rate: 200, aliases: ['sunita', 'cook']
  }
];

const askNothing = { helpers: HELPERS, ask: null };
const parse = (text, options = askNothing) => understandWith(text, DATE, 'en', options);

// English sentences, exercised without the LLM so the suite is deterministic and runs with no API key.
const SENTENCES = [
  { text: "Shanti didn't come today", intent: 'log_helper_event', args: { helper: 'shanti', type: 'absent' } },
  { text: 'Shanti was absent today', intent: 'log_helper_event', args: { helper: 'shanti', type: 'absent' } },
  { text: 'The maid is on leave today', intent: 'log_helper_event', args: { helper: 'shanti', type: 'absent' } },
  { text: 'Shanti worked 2 extra days', intent: 'log_helper_event', args: { helper: 'shanti', type: 'extra', qty: 2 } },
  { text: 'Gave Shanti 500 rupees advance', intent: 'log_helper_event', args: { helper: 'shanti', type: 'advance', amount: 500 } },
  { text: 'The milkman gave half a litre less', intent: 'log_helper_event', args: { helper: 'ramesh', type: 'less', qty: 0.5 } },
  { text: 'Ramesh gave 1 litre extra milk today', intent: 'log_helper_event', args: { helper: 'ramesh', type: 'extra', qty: 1 } },
  { text: 'The milkman gave a litre extra', intent: 'log_helper_event', args: { helper: 'ramesh', type: 'extra', qty: 1 } },
  { text: 'Sunita came for a visit today', intent: 'log_helper_event', args: { helper: 'sunita', type: 'visit' } },
  { text: "What is Shanti's bill this month?", intent: 'get_bill', args: { helper: 'shanti', month: MONTH } },
  { text: 'How much do I owe the milkman', intent: 'get_bill', args: { helper: 'ramesh', month: MONTH } },
  { text: 'How much do I owe everyone this month', intent: 'month_summary', args: { month: MONTH } },
  { text: 'Show me the total for last month', intent: 'month_summary', args: { month: '2026-09' } },
  {
    text: 'I bought 2 kg tomatoes at 40 rupees per kg from BigBasket',
    intent: 'log_purchase',
    args: { item: 'tomato', price: 40, unit: 'kg', qty: 2, vendor: 'bigbasket' }
  },
  { text: 'Bought 2 kg onions for 80 rupees from the station market', intent: 'log_purchase', args: { item: 'onion', price: 40, qty: 2, vendor: 'station market' } },
  { text: 'Tomatoes 40 rupees a kilo from the corner shop', intent: 'log_purchase', args: { item: 'tomato', price: 40, unit: 'kg', vendor: 'corner shop' } },
  { text: 'What is the price of tomatoes', intent: 'price_check', args: { item: 'tomato' } },
  { text: 'Which vendor has the cheapest onions?', intent: 'price_check', args: { item: 'onion' } },
  { text: 'Undo the last entry', intent: 'undo_last', args: {} },
  { text: 'Sunita did not deliver today', intent: 'log_helper_event', args: { helper: 'sunita', type: 'absent' } },
  { text: 'Add Geeta as a maid for 4000 per month', intent: 'add_helper', args: { name: 'Geeta', role: 'maid', rateType: 'monthly', rate: 4000 } }
];

for (const row of SENTENCES) {
  test(`sentence: ${row.text}`, async () => {
    const result = await parse(row.text);
    assert.equal(result.intent, row.intent);
    assert.equal(result.source, 'fallback');
    for (const [key, value] of Object.entries(row.args)) {
      assert.deepEqual(result.args[key], value, `args.${key} for "${row.text}"`);
    }
  });
}

test('fallback logs today as the event date (demo date picker)', async () => {
  const result = await parse("Shanti didn't come today");
  assert.equal(result.args.date, DATE);
  assert.equal(result.args.raw, "Shanti didn't come today");
});

test('"yesterday" logs the day before', async () => {
  const result = await parse("The maid didn't come yesterday");
  assert.equal(result.args.date, '2026-10-21');
});

test('fallback holds the 5 core patterns when Gemini is down', () => {
  const cases = [
    ['Shanti took the day off', 'log_helper_event', { type: 'absent' }],
    ['Shanti worked one extra day', 'log_helper_event', { type: 'extra', qty: 1 }],
    ['Shanti worked half a day less', 'log_helper_event', { type: 'less', qty: 0.5 }],
    ['Shanti took 500 advance', 'log_helper_event', { type: 'advance', amount: 500 }],
    ["What is Shanti's bill", 'get_bill', { helper: 'shanti' }]
  ];
  for (const [text, intent, args] of cases) {
    const result = fallback(text, DATE, HELPERS);
    assert.equal(result.intent, intent, text);
    for (const [key, value] of Object.entries(args)) assert.deepEqual(result.args[key], value, `${text} -> ${key}`);
  }
});

test('fallback clarifies instead of guessing when it cannot find a helper', () => {
  const result = fallback('someone was on leave today', DATE, HELPERS);
  assert.equal(result.intent, 'clarify');
  assert.deepEqual(result.args, {});
});

test('LLM path: fenced JSON is stripped and the helper name is resolved to its id', async () => {
  const answer = '```json\n{"intent":"log_helper_event","args":{"helper":"Shanti","type":"absent"}}\n```';
  const result = await parse('Shanti is on leave', { helpers: HELPERS, ask: async () => answer });

  assert.equal(result.source, 'llm');
  assert.equal(result.intent, 'log_helper_event');
  assert.equal(result.args.helper, 'shanti');
  assert.equal(result.args.date, DATE);
});

test('LLM path: JSON inside a sentence is recovered', async () => {
  const result = await parse('tomato 40', {
    helpers: HELPERS,
    ask: async () => 'Here you go: {"intent":"price_check","args":{"item":"Tomatoes"}}'
  });
  assert.equal(result.intent, 'price_check');
  assert.equal(result.args.item, 'tomato');
});

test('LLM path: unknown intent is rejected and becomes clarify', async () => {
  const result = await parse('transfer money', {
    helpers: HELPERS,
    ask: async () => '{"intent":"transfer_money","args":{"amount":500}}'
  });
  assert.equal(result.intent, 'clarify');
  assert.equal(result.source, 'llm');
  assert.ok(result.say);
});

test('LLM path: invented helper is rejected and becomes clarify', async () => {
  const result = await parse("Ravi didn't come", {
    helpers: HELPERS,
    ask: async () => '{"intent":"log_helper_event","args":{"helper":"Ravi","type":"absent"}}'
  });
  assert.equal(result.intent, 'clarify');
});

test('LLM path: "extra" with no amount means 1, like a person would assume', async () => {
  const result = await parse('Shanti worked extra', {
    helpers: HELPERS,
    ask: async () => '{"intent":"log_helper_event","args":{"helper":"shanti","type":"extra"}}'
  });
  assert.equal(result.intent, 'log_helper_event');
  assert.equal(result.args.qty, 1);
});

test('LLM path: add_helper without a pay type gets a sensible one, name capitalised', async () => {
  const cook = await parse('add a cook called dharmik and 5000 a month', {
    helpers: HELPERS, ask: async () => '{"intent":"add_helper","args":{"name":"dharmik","role":"cook","rate":5000}}'
  });
  assert.deepEqual(cook.args, { name: 'Dharmik', role: 'cook', rateType: 'monthly', rate: 5000 });
  const milk = await parse('new milkman ramu 60 a litre', {
    helpers: HELPERS, ask: async () => '{"intent":"add_helper","args":{"name":"ramu","role":"milkman","rate":60}}'
  });
  assert.equal(milk.args.rateType, 'per_unit');
  assert.equal(milk.args.unit, 'litre');
});

test('LLM path: a future date for a past event becomes last month', async () => {
  const result = await parse('Shanti was absent on the 25th', {
    helpers: HELPERS,
    ask: async () => '{"intent":"log_helper_event","args":{"helper":"shanti","type":"absent","date":"2026-10-25"}}'
  });
  assert.equal(result.args.date, '2026-09-25'); // DATE is 2026-10-22
});

test('LLM unsure -> the rules still catch a clear command', async () => {
  const result = await parse("Shanti didn't come today", { helpers: HELPERS, ask: async () => '{"intent":"clarify","args":{}}' });
  assert.equal(result.intent, 'log_helper_event');
  assert.equal(result.source, 'fallback');
});

test('rules understand the day you said', () => {
  const day = (text) => fallback(text, DATE, HELPERS).args.date;
  assert.equal(day('Shanti was absent on 10th of October'), '2026-10-10');
  assert.equal(day('Shanti was absent on October 5th'), '2026-10-05');
  assert.equal(day("Shanti didn't come yesterday"), '2026-10-21');
  assert.equal(day("Shanti didn't come day before yesterday"), '2026-10-20');
  assert.equal(day('Shanti was absent 3 days ago'), '2026-10-19');
  assert.equal(day('Shanti was absent last Monday'), '2026-10-19'); // DATE 2026-10-22 is a Thursday
  assert.equal(day('Shanti was absent on the 25th'), '2026-09-25');
  assert.equal(day('Shanti was absent on 10/10'), '2026-10-10');
  assert.equal(day("Shanti didn't come today"), DATE);
});

test('rules understand everyday ways of saying things', () => {
  const cases = [
    ['our maid was sick yesterday', 'log_helper_event', { helper: 'shanti', type: 'absent', date: '2026-10-21' }],
    ['add a cook called dharmik and 5000 a month', 'add_helper', { name: 'Dharmik', role: 'cook', rateType: 'monthly', rate: 5000 }],
    ['Dharmik is our new cook at 5000', 'add_helper', { name: 'Dharmik', role: 'cook', rate: 5000 }],
    ['we have a new milkman called ramu for 60 rupees a litre', 'add_helper', { name: 'Ramu', role: 'milkman', rateType: 'per_unit', unit: 'litre' }],
    ['got 2 kg onions for 70 rupees at the station market', 'log_purchase', { item: 'onion', price: 35, qty: 2, vendor: 'station market' }]
  ];
  for (const [text, intent, args] of cases) {
    const result = fallback(text, DATE, HELPERS);
    assert.equal(result.intent, intent, text);
    for (const [key, value] of Object.entries(args)) assert.deepEqual(result.args[key], value, `${text} -> ${key}`);
  }
});

test('LLM path: numeric strings are coerced to numbers', async () => {
  const result = await parse('Shanti gave 1.5 extra', {
    helpers: HELPERS,
    ask: async () => '{"intent":"log_helper_event","args":{"helper":"shanti","type":"extra","qty":"1.5"}}'
  });
  assert.equal(result.intent, 'log_helper_event');
  assert.equal(result.args.qty, 1.5);
  assert.equal(typeof result.args.qty, 'number');
});

test('LLM path: purchase gets canonical item, unit and date', async () => {
  const result = await parse('bought milk', {
    helpers: HELPERS,
    ask: async () => '{"intent":"log_purchase","args":{"item":"milk","price":"60","qty":"1"}}'
  });
  assert.equal(result.args.item, 'milk');
  assert.equal(result.args.unit, 'litre');
  assert.equal(result.args.price, 60);
  assert.equal(result.args.qty, 1);
  assert.equal(result.args.date, DATE);
});

test('LLM path: a thrown Gemini call falls back to rules', async () => {
  const result = await parse("Shanti didn't come", {
    helpers: HELPERS,
    ask: async () => { throw new Error('Gemini timed out'); }
  });
  assert.equal(result.source, 'fallback');
  assert.equal(result.intent, 'log_helper_event');
  assert.equal(result.args.type, 'absent');
});

test('empty speech becomes clarify, never a crash', async () => {
  const result = await parse('   ');
  assert.equal(result.intent, 'clarify');
  assert.equal(result.source, 'fallback');
});

test('prompt carries helpers, English hints and the demo date — and no Hindi', () => {
  const prompt = buildPrompt({ text: "Shanti didn't come", date: DATE, helpers: HELPERS });
  assert.match(prompt, /"id":"shanti"/);
  assert.match(prompt, /half = 0\.5/);
  assert.match(prompt, /2026-10-22/);
  assert.match(prompt, /Shanti didn't come/);
  assert.match(prompt, /log_purchase/);
  assert.doesNotMatch(prompt, /[\u0900-\u097F\u0B80-\u0BFF]|hinglish|nahi|aadha|tamatar|doodh/i);
});

test('item and unit normalization covers plurals and English synonyms', () => {
  assert.equal(normalizeItem('Tomatoes'), 'tomato');
  assert.equal(normalizeItem('onions'), 'onion');
  assert.equal(normalizeItem('ladyfinger'), 'okra');
  assert.equal(normalizeUnit('ltr'), 'litre');
  assert.equal(normalizeUnit('kilo'), 'kg');
});
