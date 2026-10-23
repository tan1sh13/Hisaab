// WhatsApp-ready bill text for one helper. The closing line comes from the lang.js SAY templates.

import { say } from './lang.js';

const money = (value) => {
  const n = Math.round(Number(value) || 0);
  return `₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n)}`;
};
const signed = (value) => {
  const n = Math.round(Number(value) * 100) / 100;
  return n < 0 ? `−${money(Math.abs(n))}` : money(n);
};

export function monthLabel(month, locale = 'en-IN') {
  const [year, mon] = String(month).split('-').map(Number);
  if (!year || !mon) return String(month ?? '');
  // UTC is deliberate: the month label must not shift with the server's timezone.
  return new Intl.DateTimeFormat(locale, {
    month: 'long', year: 'numeric', timeZone: 'UTC'
  }).format(new Date(Date.UTC(year, mon - 1, 1)));
}

export function whatsappText(bill, lang = 'en') {
  if (!bill) return '';
  const name = bill.helperName ?? 'helper';
  const lines = (bill.lines ?? [])
    .filter((line) => Math.round((Number(line?.amount) || 0) * 100) !== 0)
    .map((line) => `• ${line.label}: ${signed(line.amount)}`);

  return [
    `🧾 *Hisaab* — ${name}`,
    monthLabel(bill.month),
    '',
    ...(lines.length ? lines : ['• No entries yet']),
    '',
    `*Total: ${money(bill.total)}*`,
    '',
    say(lang, 'bill', { name, total: bill.total })
  ].join('\n');
}
