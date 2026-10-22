// Bill maths for one helper and one month.
//   monthly    — fixed salary, minus unpaid absences, plus/minus extra days, minus advances
//   per_unit   — units delivered (default per day, adjusted by events) × rate
//   per_visit  — visits logged × rate
// Money is rounded ONCE at the end; line amounts are only rounded for display.

import {
  dayOfMonth, daysInMonth, elapsedDays, isFutureMonth, isValidDate,
  isValidMonth, todayIST
} from './dates.js';

const num = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};
const round2 = (n) => Math.round(n * 100) / 100;
const plural = (n, word) => `${n} ${word}${Number(n) === 1 ? '' : 's'}`;

// Events are the helper's own events; ignore anything dated outside `month` (and,
// for the current month, anything after `today` — that is the demo date picker's clock).
function eventsFor(helper, events, month, today) {
  const current = today.slice(0, 7);
  return (events ?? []).filter((e) => {
    if (!e || typeof e.date !== 'string' || e.date.slice(0, 7) !== month) return false;
    if (e.helperId != null && helper.id != null && e.helperId !== helper.id) return false;
    if (month === current && e.date > today) return false;
    return true;
  });
}

const sum = (list, value) => list.reduce((total, item) => total + num(value(item)), 0);

export function computeBill(helper, events = [], month, today = todayIST()) {
  if (!helper || typeof helper !== 'object') throw new Error('computeBill needs a helper');
  if (!isValidMonth(month)) throw new Error(`Invalid month "${month}" (use YYYY-MM)`);
  if (!isValidDate(today)) throw new Error(`Invalid date "${today}" (use YYYY-MM-DD)`);

  const rateType = helper.rateType ?? 'monthly';
  const rate = num(helper.rate);
  if (!(rate >= 0)) throw new Error(`Helper ${helper.id ?? helper.name} has an invalid rate`);
  const unit = helper.unit ?? null;

  const base = {
    helperId: helper.id ?? null,
    helperName: helper.name ?? helper.id ?? 'helper',
    month,
    rateType,
    lines: [],
    total: 0
  };

  if (isFutureMonth(month, today)) {
    return { ...base, lines: [{ label: 'Month has not started', amount: 0 }] };
  }

  const periodDays = daysInMonth(month);
  const billableDays = elapsedDays(month, today);
  const rows = eventsFor(helper, events, month, today);
  const byType = (type) => rows.filter((e) => e.type === type);
  const advance = sum(byType('advance'), (e) => e.amount);

  const lines = [];
  let raw = 0;
  const add = (label, amount) => {
    raw += amount;
    lines.push({ label, amount: round2(amount) });
  };

  if (rateType === 'monthly') {
    const perDay = rate / periodDays;
    add('Monthly rate', rate);

    const absences = sum(byType('absent'), (e) => e.qty ?? 1);
    if (absences > 0) {
      const paid = Math.min(absences, Math.max(0, num(helper.paidLeaves)));
      const unpaid = absences - paid;
      add(
        `Absent ${plural(absences, 'day')}${paid ? ` (${paid} paid)` : ''}`,
        -unpaid * perDay
      );
    }

    const extraDays = sum(byType('extra'), (e) => e.qty ?? 1);
    if (extraDays > 0) add(`Extra ${plural(extraDays, 'day')}`, extraDays * perDay);

    const lessDays = sum(byType('less'), (e) => e.qty ?? 1);
    if (lessDays > 0) add(`Less ${plural(lessDays, 'day')}`, -lessDays * perDay);
  } else if (rateType === 'per_unit') {
    const perDayQty = num(helper.defaultQtyPerDay, 1) || 1;
    const unitLabel = unit ?? 'unit';

    const absentQty = sum(byType('absent'), (e) => e.qty ?? perDayQty);
    const extraQty = sum(byType('extra'), (e) => e.qty ?? perDayQty);
    const lessQty = sum(byType('less'), (e) => e.qty ?? perDayQty);

    const units = Math.max(0, perDayQty * billableDays - absentQty + extraQty - lessQty);
    // Base is the gross expected quantity; the event lines below apply the adjustments.
    add(`Base: ${plural(billableDays, 'day')} × ${perDayQty} ${unitLabel} × ₹${rate}`, perDayQty * billableDays * rate);

    if (absentQty > 0) add(`Absent ${absentQty} ${unitLabel}`, -absentQty * rate);
    if (extraQty > 0) add(`Extra ${extraQty} ${unitLabel}`, extraQty * rate);
    if (lessQty > 0) add(`Less ${lessQty} ${unitLabel}`, -lessQty * rate);

    base.units = round2(units);
    base.days = billableDays;
  } else if (rateType === 'per_visit') {
    const visits = sum(byType('visit'), (e) => e.qty ?? 1);
    add(`Visits: ${plural(visits, 'visit')} × ₹${rate}`, visits * rate);
    base.visits = round2(visits);
  } else {
    throw new Error(`Unknown rateType "${rateType}"`);
  }

  if (advance > 0) add('Advance paid', -advance);

  base.lines = lines;
  base.advance = advance;
  base.days = base.days ?? billableDays;
  base.total = Math.max(0, Math.round(raw)); // the single rounding of the final amount
  return base;
}
