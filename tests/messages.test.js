import test from 'node:test';
import assert from 'node:assert/strict';

import { monthLabel, whatsappText } from '../src/messages.js';

const bill = {
  helperId: 'shanti',
  helperName: 'Shanti didi',
  month: '2026-09',
  rateType: 'monthly',
  lines: [
    { label: 'Monthly rate', amount: 3100 },
    { label: 'Absent 2 days (1 paid)', amount: -103.33 },
    { label: 'Advance paid', amount: -400 }
  ],
  total: 2700
};

test('whatsappText: English message has items, total and the SAY bill line', () => {
  const text = whatsappText(bill, 'en');
  assert.match(text, /Shanti didi/);
  assert.match(text, /September 2026/);
  assert.match(text, /Monthly rate: ₹3,100/);
  assert.match(text, /−₹103/);
  assert.match(text, /Total: ₹2,700/);
  assert.match(text, /You owe Shanti didi ₹2700 this month\./); // SAY template has no thousands separator
});

test('whatsappText: Hindi and Tamil use their SAY templates', () => {
  assert.match(whatsappText(bill, 'hi'), /देना है/);
  assert.match(whatsappText(bill, 'hi'), /₹2,700/);
  assert.match(whatsappText(bill, 'ta'), /கொடுக்க வேண்டும்/);
  assert.match(whatsappText(bill, 'ta'), /₹2,700/);
});

test('monthLabel is stable across time zones', () => {
  assert.equal(monthLabel('2026-09', 'en-IN'), 'September 2026');
  assert.equal(monthLabel('2026-12', 'en-IN'), 'December 2026');
});
