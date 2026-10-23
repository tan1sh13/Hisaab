// Turns a reply into text that any voice reads the same way, in English:
// "₹4,000" -> "four thousand rupees", "0.5 litre" -> "half a litre", "31 Oct" -> "31st October".
// Needed because Chrome's built-in Indian-accent voice would otherwise read digits in Hindi.

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const MONTHS = { jan: 'January', feb: 'February', mar: 'March', apr: 'April', may: 'May', jun: 'June', jul: 'July',
  aug: 'August', sep: 'September', sept: 'September', oct: 'October', nov: 'November', dec: 'December' };

function below1000(n) {
  const out = [];
  if (n >= 100) { out.push(`${ONES[Math.floor(n / 100)]} hundred`); n %= 100; if (n) out.push('and'); }
  if (n >= 20) { out.push(TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : '')); }
  else if (n > 0 || !out.length) out.push(ONES[n]);
  return out.join(' ');
}

// Indian English: 1,50,000 -> "one lakh fifty thousand"; 2,00,00,000 -> "two crore"
export function numberToWords(value) {
  let n = Math.round(Math.abs(Number(value)));
  if (!Number.isFinite(n)) return String(value);
  if (n === 0) return 'zero';
  const parts = [];
  for (const [size, name] of [[1e7, 'crore'], [1e5, 'lakh'], [1e3, 'thousand']]) {
    if (n >= size) { parts.push(`${numberToWords(Math.floor(n / size))} ${name}`); n %= size; }
  }
  if (n) parts.push(below1000(n));
  return (Number(value) < 0 ? 'minus ' : '') + parts.join(' ');
}

const ordinal = (d) => {
  const n = Number(d);
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th');
  return `${n}${suffix}`;
};

function decimalToWords(raw) {
  const n = Number(raw);
  if (n === 0.5) return 'half';
  if (n === 0.25) return 'a quarter';
  if (n === 1.5) return 'one and a half';
  if (n === 2.5) return 'two and a half';
  const [whole, frac] = raw.split('.');
  return `${numberToWords(whole)} point ${frac.split('').map((d) => ONES[Number(d)]).join(' ')}`;
}

export function toSpeakable(text) {
  let s = String(text ?? '');
  s = s.replace(/[—–]/g, ', ').replace(/\s*·\s*/g, ', ').replace(/→/g, ' to ').replace(/×/g, ' times ');
  // dates: "31 Oct" / "31 October" -> "31st October" (then the number becomes words below)
  s = s.replace(/\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\b/gi,
    (_, d, m) => `the ${ordinal(d)} of ${MONTHS[m.toLowerCase()]}`);
  // "October 31" -> "October 31st"
  s = s.replace(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})\b/g,
    (_, m, d) => `${m} ${ordinal(d)}`);
  s = s.replace(/\b(\d+)(st|nd|rd|th)\b/g, (_, d) => ordinalWords(Number(d)));
  // money: ₹4,000 / Rs. 40 / ₹29.5 -> "four thousand rupees"
  s = s.replace(/(?:₹|\bRs\.?|\bINR)\s?(\d+(?:,\d{2,3})*(?:\.\d+)?)(\s*\/\s*(kg|litre|liter|dozen|piece|bunch|month))?/gi, (_, num, __, per) => {
    const n = Number(num.replace(/,/g, ''));
    const rupees = `${numberToWords(Math.round(n))} ${Math.round(n) === 1 ? 'rupee' : 'rupees'}`;
    return per ? `${rupees} a ${per.toLowerCase().replace('liter', 'litre')}` : rupees;
  });
  // half a litre: "0.5 litre" -> "half a litre"
  s = s.replace(/\b0\.5\s+(litre|liter|kg|kilo|day|dozen)s?\b/gi, (_, u) => `half a ${u.toLowerCase()}`);
  // any remaining numbers
  s = s.replace(/\d+(?:,\d{2,3})*(?:\.\d+)?/g, (m) => (m.includes('.') ? decimalToWords(m.replace(/,/g, '')) : numberToWords(m.replace(/,/g, ''))));
  s = s.replace(/\bkg\b/gi, 'kilo').replace(/%/g, ' percent');
  return s.replace(/\s+,/g, ',').replace(/\s{2,}/g, ' ').trim();
}

const ORD = { one: 'first', two: 'second', three: 'third', five: 'fifth', eight: 'eighth', nine: 'ninth', twelve: 'twelfth' };
function ordinalWords(n) {
  const words = numberToWords(n);
  const last = words.split(/([\s-])/);
  const tail = last.pop();
  const ord = ORD[tail] ?? (tail.endsWith('y') ? `${tail.slice(0, -1)}ieth` : `${tail}th`);
  return last.join('') + ord;
}
