// Temporary stand-ins for Ritu's modules. mcp.js uses the real file as soon as it exists.
// Delete this file once bill.js, prices.js, messages.js, dates.js and understand.js have landed.
import { say } from './lang.js';

export const todayIST = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);

export async function understand(_text, _date, lang) {
  return { intent: 'clarify', args: {}, source: 'fallback', say: say(lang, 'clarify') };
}

export function computeBill(helper, _events, month, _today) {
  return {
    helperId: helper.id, helperName: helper.name, month,
    lines: [{ label: 'Base (stub)', amount: helper.rate }], total: helper.rate
  };
}

export function checkPrice(_history, _purchase) {
  return { level: 'new', baseline: null, cheapest: null };
}

export function priceReport(purchases, item, vendor) {
  const rows = purchases.filter((p) => p.item === item && (!vendor || p.vendor === vendor));
  if (!rows.length) return { item, avg: null, min: null, max: null, cheapestVendor: null, lastPrices: [] };
  const prices = rows.map((p) => p.price);
  return {
    item, avg: Math.round(prices.reduce((a, b) => a + b, 0) / prices.length),
    min: Math.min(...prices), max: Math.max(...prices),
    cheapestVendor: rows.reduce((a, b) => (b.price < a.price ? b : a)).vendor,
    lastPrices: rows.slice(-5).map((p) => p.price)
  };
}

export function whatsappText(bill, _lang) {
  return `${bill.helperName}: ₹${bill.total}`;
}
