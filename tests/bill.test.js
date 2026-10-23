import test from 'node:test';
import assert from 'node:assert/strict';

import { computeBill } from '../src/bill.js';

const monthly = {
  id: 'shanti', name: 'Shanti', role: 'maid',
  rateType: 'monthly', rate: 3100, paidLeaves: 1
};
const perUnit = {
  id: 'ramesh', name: 'Ramesh', role: 'milkman',
  rateType: 'per_unit', rate: 30, unit: 'litre', defaultQtyPerDay: 1
};
const perVisit = {
  id: 'sunita', name: 'Sunita', role: 'cook',
  rateType: 'per_visit', rate: 200
};

const event = (helperId, date, type, extra = {}) => ({ helperId, date, type, ...extra });

test('monthly: base + unpaid absence + extra day + advance', () => {
  const events = [
    event('shanti', '2026-09-03', 'absent'),
    event('shanti', '2026-09-10', 'absent'),       // first one is the paid leave
    event('shanti', '2026-09-15', 'extra'),
    event('shanti', '2026-09-20', 'advance', { amount: 400 }),
    event('shanti', '2026-08-20', 'absent')         // other month must be ignored
  ];
  const bill = computeBill(monthly, events, '2026-09', '2026-09-30');

  assert.equal(bill.helperName, 'Shanti');
  assert.equal(bill.total, 2700);
  assert.equal(bill.lines.length, 4);
  assert.equal(bill.lines[0].amount, 3100);
  assert.equal(bill.advance, 400);
});

test('monthly: money is rounded once at the end, not per line', () => {
  const helper = { ...monthly, rate: 1000, paidLeaves: 0 };
  const events = [event('shanti', '2026-10-05', 'absent')];
  const bill = computeBill(helper, events, '2026-10', '2026-10-31');

  // 1000 - 1000/31 = 967.7419...
  assert.equal(bill.total, 968);
  assert.equal(bill.lines[1].amount, -32.26); // display rounding only
});

test('monthly: events after the demo date are not billed yet', () => {
  const helper = { ...monthly, paidLeaves: 0 };
  const events = [
    event('shanti', '2026-10-20', 'absent'), // after today
    event('shanti', '2026-10-10', 'absent')  // on today, counts
  ];
  const bill = computeBill(helper, events, '2026-10', '2026-10-10');
  assert.equal(bill.total, 3000); // 3100 - one day (31 days in October = 100/day)
  assert.equal(bill.days, 10);
});

test('future month bills nothing', () => {
  const bill = computeBill(monthly, [], '2026-11', '2026-10-22');
  assert.equal(bill.total, 0);
  assert.match(bill.lines[0].label, /not started/i);
});

test('per_unit: default daily quantity adjusted by absent/extra/less', () => {
  const events = [
    event('ramesh', '2026-09-04', 'absent'),
    event('ramesh', '2026-09-05', 'absent'),
    event('ramesh', '2026-09-06', 'extra', { qty: 0.5 }),
    event('ramesh', '2026-09-07', 'less', { qty: 0.5 })
  ];
  const bill = computeBill(perUnit, events, '2026-09', '2026-09-30');

  assert.equal(bill.units, 28);   // 30 days x 1 litre - 2 + 0.5 - 0.5
  assert.equal(bill.total, 840);  // 28 x 30
});

test('per_unit: current month is prorated to the demo date', () => {
  const events = [
    event('ramesh', '2026-10-01', 'absent'),
    event('ramesh', '2026-10-02', 'absent')
  ];
  const bill = computeBill(perUnit, events, '2026-10', '2026-10-10');

  assert.equal(bill.days, 10);
  assert.equal(bill.units, 8);
  assert.equal(bill.total, 240);
});

test('per_visit: visits count with qty, advance is deducted', () => {
  const events = [
    event('sunita', '2026-09-02', 'visit'),
    event('sunita', '2026-09-05', 'visit'),
    event('sunita', '2026-09-09', 'visit'),
    event('sunita', '2026-09-14', 'visit', { qty: 2 }),
    event('sunita', '2026-09-20', 'advance', { amount: 200 })
  ];
  const bill = computeBill(perVisit, events, '2026-09', '2026-09-30');

  assert.equal(bill.visits, 5);
  assert.equal(bill.total, 800);
  assert.equal(bill.lines.at(-1).amount, -200);
});

test('advance never makes the amount due negative', () => {
  const bill = computeBill(
    { ...monthly, rate: 1000, paidLeaves: 0 },
    [event('shanti', '2026-09-02', 'advance', { amount: 1500 })],
    '2026-09',
    '2026-09-30'
  );
  assert.equal(bill.total, 0);
});

test('per_unit: fractional rate still rounds only the total', () => {
  const helper = { ...perUnit, rate: 27.5 };
  const bill = computeBill(helper, [], '2026-10', '2026-10-03');
  assert.equal(bill.units, 3);
  assert.equal(bill.total, 83); // 82.5 -> 83
});
