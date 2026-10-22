import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addDays, dayOfMonth, daysInMonth, elapsedDays, isValidDate, isValidMonth,
  monthOf, shiftMonth, todayIST
} from '../src/dates.js';

test('todayIST uses the IST calendar day, not the UTC one', () => {
  // 19:00 UTC is already 00:30 next day in India.
  assert.equal(todayIST(new Date('2026-10-22T19:00:00Z')), '2026-10-23');
  // 18:29 UTC is 23:59 the same day in India.
  assert.equal(todayIST(new Date('2026-10-22T18:29:59Z')), '2026-10-22');
});

test('daysInMonth handles leap years and month lengths', () => {
  assert.equal(daysInMonth('2024-02'), 29);
  assert.equal(daysInMonth('2026-02'), 28);
  assert.equal(daysInMonth('2026-04'), 30);
  assert.equal(daysInMonth('2026-12'), 31);
  assert.throws(() => daysInMonth('2026-13'), /Invalid month/);
});

test('date validation rejects impossible days and months', () => {
  assert.equal(isValidDate('2026-02-28'), true);
  assert.equal(isValidDate('2026-02-30'), false);
  assert.equal(isValidDate('2026-10-00'), false);
  assert.equal(isValidDate('22-10-2026'), false);
  assert.equal(isValidMonth('2026-10'), true);
  assert.equal(isValidMonth('2026-13'), false);
});

test('monthOf, dayOfMonth and addDays cross month/year boundaries', () => {
  assert.equal(monthOf('2026-10-22'), '2026-10');
  assert.equal(dayOfMonth('2026-10-22'), 22);
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2024-02-28', 1), '2024-02-29');
});

test('elapsedDays: past month is full, current month stops at today, future is zero', () => {
  assert.equal(elapsedDays('2026-09', '2026-10-10'), 30);
  assert.equal(elapsedDays('2026-10', '2026-10-10'), 10);
  assert.equal(elapsedDays('2026-11', '2026-10-10'), 0);
});

test('shiftMonth moves across years', () => {
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.equal(shiftMonth('2026-10', -1), '2026-09');
});
