// Language file: HINTS (prompt hints for the parser) and SAY (fixed reply templates).
// Replies never depend on the AI.
// English only. (Hindi/Tamil were removed; the `lang` argument is kept so the tool contract
// stays the same, but every reply is English.)
export const LANGS = { en: 'en-IN' };

// Hints pasted into the understand prompt.
export const HINTS = {
  en: 'Numbers: half = 0.5, quarter = 0.25, one and a half = 1.5, two and a half = 2.5. ' +
      '"didn\'t come", "on leave", "took the day off", "was absent" = absent; "gave extra/more" = extra; ' +
      '"gave less/short" = less; "gave/took an advance", "loan" = advance. ' +
      'Items: tomatoes = tomato, ladyfinger = okra, cilantro = coriander. Rupees may be said as "rs" or "bucks".'
};

export const hints = () => HINTS.en;

const r = (n) => Math.round(Number(n));
const u = (unit) => (unit ? ` ${unit}` : '');
const cheap = (c, join) => (c ? join(c.vendor, r(c.price)) : '');
const ROLE_NAMES = { laundry: 'laundry person', newspaper: 'newspaper delivery', milk: 'milkman' };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// "today" / "yesterday" / "on 10 October" — so a reply never says "today" for an older date.
export function whenText(date, today) {
  if (!date || !today || date === today) return 'today';
  const [y, m, d] = today.split('-').map(Number);
  const yest = new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10); // pure calendar maths, no time zone
  if (date === yest) return 'yesterday';
  const [, mm, dd] = date.split('-').map(Number);
  return `on ${dd} ${MONTHS[mm - 1]}`;
}

// Every template takes ONE object. Variables used per message are listed in the comment.
export const SAY = {
  en: {
    // name, when ("today" / "yesterday" / "on 10 October")
    absent: ({ name, when = 'today' }) => (when === 'today' ? `Noted — ${name} is absent today.` : `Noted — ${name} was absent ${when}.`),
    alreadyAbsent: ({ name, when = 'today' }) => `${name} is already marked absent ${when}, so I haven't added it again.`,
    extra: ({ name, qty, unit, when = 'today' }) => `Noted — ${name} gave ${qty}${u(unit)} extra ${when}.`,      // name, qty, unit?
    less: ({ name, qty, unit, when = 'today' }) => `Noted — ${name} gave ${qty}${u(unit)} less ${when}.`,        // name, qty, unit?
    advance: ({ name, amount, when = 'today' }) => `Noted — advance of ₹${r(amount)} to ${name} ${when}.`,       // name, amount
    visit: ({ name, qty, when = 'today' }) => `Noted — ${qty} for ${name} ${when}.`,                             // name, qty
    bill: ({ name, total }) => `You owe ${name} ₹${r(total)} this month.`,                      // name, total
    summary: ({ total, count }) => `This month you owe ₹${r(total)} in total across ${count} helpers.`, // total, count
    priceHigh: ({ price, baseline, cheapest }) =>                                               // price, baseline, cheapest? {vendor, price}
      `That's expensive! Usually ₹${r(baseline)}, today ₹${r(price)}. Try bargaining. ${cheap(cheapest, (v, p) => `${v} had it at ₹${p}.`)}`.trim(),
    priceLow: ({ item, price, baseline }) => `Good deal! ${item} at ₹${r(price)}, usually ₹${r(baseline)}.`,
    priceNormal: ({ item, price }) => `${item} at ₹${r(price)} — a fair price.`,
    priceNew: ({ item, price }) => `Noted ${item} at ₹${r(price)}. A bit more data and I can warn you.`,
    priceCheck: ({ item, avg, min, max, cheapestVendor }) =>                                    // item, avg, min, max, cheapestVendor?
      `${item} is usually ₹${r(avg)} (₹${r(min)} to ₹${r(max)}).${cheapestVendor ? ` Cheapest at ${cheapestVendor}.` : ''}`,
    helperAdded: ({ name, role, rate, rateType, unit }) =>
      `Added ${name}${role && role !== 'helper' ? ` as your ${ROLE_NAMES[role] ?? role}` : ''}${rate ? ` at ₹${r(rate)} ${rateType === 'monthly' ? 'a month' : `per ${unit ?? (rateType === 'per_visit' ? 'piece' : 'unit')}`}` : ''}.`,
    priceNone: ({ item }) => `No price history for ${item} yet.`,
    undo: () => 'Done, removed the last entry.',
    clarify: () => "Sorry, I didn't get that. Could you say it again?",
    error: () => 'Sorry, something went wrong. Please try again.'
  }
};

// say('en', 'absent', { name: 'Shanti' }) -> "Noted — Shanti is absent today."
export function say(_lang, key, vars = {}) {
  const v = { ...vars };
  if (v.item) v.item = v.item[0].toUpperCase() + v.item.slice(1);
  return (SAY.en[key] ?? SAY.en.error)(v);
}
