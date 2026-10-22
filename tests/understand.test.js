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
    id: 'shanti', name: 'Shanti didi', role: 'maid', rateType: 'monthly',
    rate: 3100, unit: null, paidLeaves: 1, aliases: ['shanti', 'didi', 'maid']
  },
  {
    id: 'ramesh', name: 'Ramesh', role: 'milkman', rateType: 'per_unit',
    rate: 30, unit: 'litre', defaultQtyPerDay: 1, aliases: ['ramesh', 'milkman', 'doodhwala']
  },
  {
    id: 'sunita', name: 'Sunita', role: 'cook', rateType: 'per_visit',
    rate: 200, aliases: ['sunita', 'cook']
  }
];

const askNothing = { helpers: HELPERS, ask: null };
const parse = (text, options = askNothing) => understandWith(text, DATE, 'en', options);

// The 20 English/Hinglish sentences from guide section 6, exercised without the LLM
// so the suite is deterministic and runs with no API key.
const SENTENCES = [
  { text: 'Shanti didi nahi aayi aaj', intent: 'log_helper_event', args: { helper: 'shanti', type: 'absent' } },
  { text: 'Shanti didi was absent today', intent: 'log_helper_event', args: { helper: 'shanti', type: 'absent' } },
  { text: 'Shanti didi ne aaj 2 din extra kaam kiya', intent: 'log_helper_event', args: { helper: 'shanti', type: 'extra', qty: 2 } },
  { text: 'Shanti didi ko 500 rupees advance diya', intent: 'log_helper_event', args: { helper: 'shanti', type: 'advance', amount: 500 } },
  { text: 'Ramesh ne aadha litre doodh kam diya', intent: 'log_helper_event', args: { helper: 'ramesh', type: 'less', qty: 0.5 } },
  { text: 'Ramesh gave 1 litre extra milk today', intent: 'log_helper_event', args: { helper: 'ramesh', type: 'extra', qty: 1 } },
  { text: 'Sunita came for a visit today', intent: 'log_helper_event', args: { helper: 'sunita', type: 'visit' } },
  { text: "What is Shanti didi's bill this month?", intent: 'get_bill', args: { helper: 'shanti', month: MONTH } },
  { text: 'Is mahine ka sabka hisaab batao', intent: 'month_summary', args: { month: MONTH } },
  { text: 'How much do I owe everyone this month', intent: 'month_summary', args: { month: MONTH } },
  {
    text: 'I bought 2 kg tomato at 40 rupees per kg from BigBasket',
    intent: 'log_purchase',
    args: { item: 'tomato', price: 40, unit: 'kg', qty: 2, vendor: 'bigbasket' }
  },
  { text: 'Aaj 1 litre doodh 60 rupaye me kharida', intent: 'log_purchase', args: { item: 'milk', price: 60, unit: 'litre', qty: 1 } },
  { text: 'Tamatar ka bhav kya hai', intent: 'price_check', args: { item: 'tomato' } },
  { text: 'What is the price of onion at BigBasket?', intent: 'price_check', args: { item: 'onion', vendor: 'bigbasket' } },
  { text: 'Undo the last entry', intent: 'undo_last', args: {} },
  { text: 'Last entry hatao', intent: 'undo_last', args: {} },
  { text: 'Add Geeta as a maid for 4000 per month', intent: 'add_helper', args: { name: 'Geeta', role: 'maid', rateType: 'monthly', rate: 4000 } },
  { text: 'Shanti didi ki chhutti thi', intent: 'log_helper_event', args: { helper: 'shanti', type: 'absent' } },
  { text: 'Sunita ko 200 advance diya', intent: 'log_helper_event', args: { helper: 'sunita', type: 'advance', amount: 200 } },
  { text: 'Sabka total bill kitna hai', intent: 'month_summary', args: { month: MONTH } }
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
  const result = await parse('Shanti didi nahi aayi aaj');
  assert.equal(result.args.date, DATE);
  assert.equal(result.args.raw, 'Shanti didi nahi aayi aaj');
});

test('fallback holds the 5 core patterns when Gemini is down', () => {
  const cases = [
    ['Shanti didi chhutti par hai', 'log_helper_event', { type: 'absent' }],
    ['Shanti didi ne ek din zyada kaam kiya', 'log_helper_event', { type: 'extra', qty: 1 }],
    ['Shanti didi ne aadha din kam kaam kiya', 'log_helper_event', { type: 'less', qty: 0.5 }],
    ['Shanti didi ko 500 advance diya', 'log_helper_event', { type: 'advance', amount: 500 }],
    ['Shanti didi ka bill kitna hai', 'get_bill', { helper: 'shanti' }]
  ];
  for (const [text, intent, args] of cases) {
    const result = fallback(text, DATE, HELPERS);
    assert.equal(result.intent, intent, text);
    for (const [key, value] of Object.entries(args)) assert.deepEqual(result.args[key], value, `${text} -> ${key}`);
  }
});

test('fallback clarifies instead of guessing when it cannot find a helper', () => {
  const result = fallback('chhutti hai aaj', DATE, HELPERS);
  assert.equal(result.intent, 'clarify');
  assert.deepEqual(result.args, {});
});

test('LLM path: fenced JSON is stripped and the helper name is resolved to its id', async () => {
  const answer = '```json\n{"intent":"log_helper_event","args":{"helper":"Shanti didi","type":"absent"}}\n```';
  const result = await parse('Shanti didi is on leave', { helpers: HELPERS, ask: async () => answer });

  assert.equal(result.source, 'llm');
  assert.equal(result.intent, 'log_helper_event');
  assert.equal(result.args.helper, 'shanti');
  assert.equal(result.args.date, DATE);
});

test('LLM path: JSON inside a sentence is recovered', async () => {
  const result = await parse('tomato 40', {
    helpers: HELPERS,
    ask: async () => 'Here you go: {"intent":"price_check","args":{"item":"tamatar"}}'
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
  const result = await parse('Ravi nahi aaya', {
    helpers: HELPERS,
    ask: async () => '{"intent":"log_helper_event","args":{"helper":"Ravi","type":"absent"}}'
  });
  assert.equal(result.intent, 'clarify');
});

test('LLM path: extra without qty is rejected (no silent 1)', async () => {
  const result = await parse('Shanti gave extra', {
    helpers: HELPERS,
    ask: async () => '{"intent":"log_helper_event","args":{"helper":"shanti","type":"extra"}}'
  });
  assert.equal(result.intent, 'clarify');
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
  const result = await parse('doodh liya', {
    helpers: HELPERS,
    ask: async () => '{"intent":"log_purchase","args":{"item":"doodh","price":"60","qty":"1"}}'
  });
  assert.equal(result.args.item, 'milk');
  assert.equal(result.args.unit, 'litre');
  assert.equal(result.args.price, 60);
  assert.equal(result.args.qty, 1);
  assert.equal(result.args.date, DATE);
});

test('LLM path: a thrown Gemini call falls back to rules', async () => {
  const result = await parse('Shanti didi nahi aayi', {
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

test('prompt carries helpers, HINTS for the language and the demo date', () => {
  const prompt = buildPrompt({ text: 'Shanti didi nahi aayi', date: DATE, lang: 'hi', helpers: HELPERS });
  assert.match(prompt, /"id":"shanti"/);
  assert.match(prompt, /आधा=0\.5/);
  assert.match(prompt, /2026-10-22/);
  assert.match(prompt, /Shanti didi nahi aayi/);
  assert.match(prompt, /log_purchase/);
});

test('item and unit normalization covers Hinglish and plurals', () => {
  assert.equal(normalizeItem('tamatar'), 'tomato');
  assert.equal(normalizeItem('Tomatoes'), 'tomato');
  assert.equal(normalizeItem('pyaaz'), 'onion');
  assert.equal(normalizeUnit('ltr'), 'litre');
  assert.equal(normalizeUnit('kilo'), 'kg');
});
