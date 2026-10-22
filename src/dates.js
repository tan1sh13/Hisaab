// Date helpers for Hisaab. Every date is a plain "YYYY-MM-DD" string in IST.
// Rule from the guide: never build a date string with toISOString() — it silently
// shifts the day for IST users (UTC is 5:30 behind), so all conversions are explicit.

const IST = 'Asia/Kolkata';
const pad = (n) => String(n).padStart(2, '0');
const istFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: IST, year: 'numeric', month: '2-digit', day: '2-digit'
});

// "now" is injectable so tests never depend on the real clock.
export function todayIST(now = new Date()) {
  const parts = Object.fromEntries(istFormat.formatToParts(now).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export const isValidMonth = (month) =>
  typeof month === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(month);

export const isValidDate = (date) => {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const day = Number(date.slice(8, 10));
  return day >= 1 && day <= daysInMonth(date.slice(0, 7));
};

// daysInMonth("2026-02") -> 28. Day 0 of the next month is the last day of this one.
export function daysInMonth(month) {
  if (!isValidMonth(month)) throw new Error(`Invalid month "${month}" (use YYYY-MM)`);
  const [year, mon] = month.split('-').map(Number);
  return new Date(Date.UTC(year, mon, 0)).getUTCDate();
}

export const monthOf = (date) => {
  if (!isValidDate(date)) throw new Error(`Invalid date "${date}" (use YYYY-MM-DD)`);
  return date.slice(0, 7);
};

export const dayOfMonth = (date) => {
  if (!isValidDate(date)) throw new Error(`Invalid date "${date}" (use YYYY-MM-DD)`);
  return Number(date.slice(8, 10));
};

// addDays("2026-10-31", 1) -> "2026-11-01". UTC arithmetic, manual formatting.
export function addDays(date, days) {
  if (!isValidDate(date)) throw new Error(`Invalid date "${date}" (use YYYY-MM-DD)`);
  const [year, mon, day] = date.split('-').map(Number);
  const d = new Date(Date.UTC(year, mon - 1, day + Number(days)));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

// shiftMonth("2026-12", 1) -> "2027-01"
export function shiftMonth(month, delta) {
  if (!isValidMonth(month)) throw new Error(`Invalid month "${month}" (use YYYY-MM)`);
  const [year, mon] = month.split('-').map(Number);
  const d = new Date(Date.UTC(year, mon - 1 + Number(delta), 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

// Days of `month` that have happened by `today` (the whole month if it is in the past,
// 0 if it has not started). Bills use this so the demo date picker behaves.
export function elapsedDays(month, today = todayIST()) {
  if (!isValidMonth(month)) throw new Error(`Invalid month "${month}" (use YYYY-MM)`);
  if (!isValidDate(today)) throw new Error(`Invalid date "${today}" (use YYYY-MM-DD)`);
  const current = monthOf(today);
  if (month < current) return daysInMonth(month);
  if (month > current) return 0;
  return dayOfMonth(today);
}

export const isFutureMonth = (month, today = todayIST()) => month > monthOf(today);
