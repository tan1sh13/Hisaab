import test from 'node:test';
import assert from 'node:assert/strict';
import { numberToWords, toSpeakable } from '../public/speech-text.js';

test('numbers in Indian English words', () => {
  assert.equal(numberToWords(40), 'forty');
  assert.equal(numberToWords(129), 'one hundred and twenty-nine');
  assert.equal(numberToWords(4000), 'four thousand');
  assert.equal(numberToWords(11581), 'eleven thousand five hundred and eighty-one');
  assert.equal(numberToWords(150000), 'one lakh fifty thousand');
  assert.equal(numberToWords(20000000), 'two crore');
});

test('replies are spoken with no digits or symbols left', () => {
  const cases = [
    ["That's expensive! Usually ₹30, today ₹40. Try bargaining. station market had it at ₹27.",
      "That's expensive! Usually thirty rupees, today forty rupees. Try bargaining. station market had it at twenty-seven rupees."],
    ['This month you owe ₹11,581 in total across 4 helpers.',
      'This month you owe eleven thousand five hundred and eighty-one rupees in total across four helpers.'],
    ['Noted — Raju gave 0.5 litre extra.', 'Noted, Raju gave half a litre extra.'],
    ['Tomato at ₹40/kg', 'Tomato at forty rupees a kilo'],
    ['Advance on 10 Oct', 'Advance on the tenth of October'],
    ['Today is October 31, 2026.', 'Today is October thirty-first, two thousand twenty-six.']
  ];
  for (const [input, want] of cases) assert.equal(toSpeakable(input), want);
  assert.doesNotMatch(toSpeakable('₹1,860 for 31 days × 1 litre'), /\d|₹|×/);
});
