// Browser MCP client (Streamable HTTP, stateless) + mock mode (?mock=1).
// Mock mode answers in the exact contract shapes (guide section 5) so UI work never waits on the server.

export const MOCK = new URLSearchParams(location.search).has('mock');

let nextId = 1;
let protocolVersion = '2025-06-18'; // replaced by what the server answers
let logPanel = () => {};
export const onLog = (fn) => { logPanel = fn; };

async function post(body) {
  logPanel('→', body);
  if (MOCK) {
    const result = mockAnswer(body);
    if (result !== null) logPanel('←', { jsonrpc: '2.0', id: body.id, result });
    return result;
  }
  const r = await fetch('/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream', // both are required
      'MCP-Protocol-Version': protocolVersion
    },
    body: JSON.stringify(body)
  });
  if (r.status === 202) return null; // notifications get no body
  const json = await r.json();
  logPanel('←', json);
  if (json.error) throw new Error(json.error.message);
  return json.result;
}

export async function connect() {
  const res = await post({ jsonrpc: '2.0', id: nextId++, method: 'initialize', params: {
    protocolVersion, capabilities: {}, clientInfo: { name: 'hisaab-web', version: '1.0.0' } } });
  protocolVersion = res.protocolVersion;
  await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
  return (await post({ jsonrpc: '2.0', id: nextId++, method: 'tools/list' })).tools;
}

export async function callTool(name, args) {
  const res = await post({ jsonrpc: '2.0', id: nextId++, method: 'tools/call', params: { name, arguments: args } });
  const data = JSON.parse(res.content[0].text);
  if (res.isError) throw Object.assign(new Error(data.error), { say: data.say });
  return data;
}

// ---- mock mode ------------------------------------------------------------

const TOOLS = ['understand', 'add_helper', 'log_helper_event', 'get_bill', 'month_summary',
  'log_purchase', 'price_check', 'undo_last'];

const HELPERS = [
  { id: 'shanti', name: 'Shanti didi', aliases: ['shanti', 'maid', 'bai', 'शांति'], unit: null },
  { id: 'lakshmi', name: 'Lakshmi akka', aliases: ['lakshmi', 'cook', 'कुक', 'சமையல்'], unit: null },
  { id: 'raju', name: 'Raju doodhwala', aliases: ['raju', 'doodhwala', 'milkman', 'paalkaaran', 'दूधवाल'], unit: 'litre' },
  { id: 'ganesh', name: 'Ganesh paperwala', aliases: ['ganesh', 'paperwala', 'newspaper'], unit: null }
];
const ITEMS = { tomato: /tomato|tamatar|टमाटर|thakkali|தக்காளி/, onion: /onion|pyaaz|प्याज|vengayam|வெங்காயம்/,
  potato: /potato|aloo|आलू/, bhindi: /bhindi|भिंडी|vendakkai/ };
const VENDORS = { 'corner bhaiya': /corner|कोने/, 'station market': /station/, 'thela uncle': /thela/ };
const NUMS = { aadha: 0.5, arai: 0.5, 'आधा': 0.5, ek: 1, one: 1, do: 2, bees: 20, tees: 30, chalis: 40, 'चालीस': 40,
  naarpadhu: 40, pachas: 50, pachaas: 50, saath: 60, 'पाँच सौ': 500, 'ஐநூறு': 500 };

const MOCK_BILLS = [
  { helperId: 'shanti', helperName: 'Shanti didi', month: '2026-10', total: 3871, lines: [
    { label: 'Base salary', amount: 4000 }, { label: '3 absent, 2 paid leave → 1 unpaid day', amount: -129 }] },
  { helperId: 'lakshmi', helperName: 'Lakshmi akka', month: '2026-10', total: 5500, lines: [
    { label: 'Base salary', amount: 6000 }, { label: 'Advance on 10 Oct', amount: -500 }] },
  { helperId: 'raju', helperName: 'Raju doodhwala', month: '2026-10', total: 1800, lines: [
    { label: '31 days × 1 litre', amount: 1860 }, { label: '1 absent day (−1 litre)', amount: -60 },
    { label: 'Extra 1 litre (8, 15 Oct)', amount: 60 }, { label: 'Less 1 litre', amount: -60 }] },
  { helperId: 'ganesh', helperName: 'Ganesh paperwala', month: '2026-10', total: 350, lines: [
    { label: 'Base', amount: 350 }] }
];

function num(s) {
  const d = s.match(/\d+(\.\d+)?/);
  if (d) return Number(d[0]);
  for (const [w, n] of Object.entries(NUMS)) if (s.includes(w)) return n;
  return null;
}
const findKey = (map, s) => Object.keys(map).find((k) => map[k].test(s));
const helperIn = (s) => HELPERS.find((h) => h.aliases.some((a) => s.includes(a)));
const helperOf = (q) => HELPERS.find((h) => h.id === q || h.name.toLowerCase() === String(q).toLowerCase()
  || h.aliases.includes(String(q).toLowerCase())) ?? HELPERS[0];

function mockUnderstand({ text, date }) {
  const s = text.toLowerCase();
  const month = (date ?? '2026-10-31').slice(0, 7);
  const h = helperIn(s);
  const item = findKey(ITEMS, s);
  let r;
  if (/undo|hata do|हटा|galti|neekku/.test(s)) r = { intent: 'undo_last', args: {} };
  else if (/kitna dena|kisko|कितना देना|evlo|எவ்வளவு|owe|hisaab|bill/.test(s))
    r = h ? { intent: 'get_bill', args: { helper: h.id, month } } : { intent: 'month_summary', args: { month } };
  else if (item && /rate|sahi|रेट|cheapest|mehenga|sariyana/.test(s)) r = { intent: 'price_check', args: { item } };
  else if (item) {
    const qtyM = s.match(/(do|2|teen|3)\s*(kilo|kg)/);
    const qty = qtyM ? ({ do: 2, teen: 3 }[qtyM[1]] ?? Number(qtyM[1])) : 1;
    const total = num(s.replace(/(do|2|teen|3)\s*(kilo|kg)/, '')) ?? 40;
    r = { intent: 'log_purchase', args: { item, vendor: findKey(VENDORS, s) ?? 'unknown', price: total / qty, unit: 'kg', qty } };
  } else if (h && /nahi aa|absent|didn't come|chhutti|नहीं आ|varala|வரவில்லை/.test(s))
    r = { intent: 'log_helper_event', args: { helper: h.id, type: 'absent' } };
  else if (h && /extra|zyada|ज़्यादा|adhigam/.test(s))
    r = { intent: 'log_helper_event', args: { helper: h.id, type: 'extra', qty: num(s) ?? 0.5 } };
  else if (h && /less|kam\b|कम/.test(s))
    r = { intent: 'log_helper_event', args: { helper: h.id, type: 'less', qty: num(s) ?? 1 } };
  else if (h && /advance|एडवांस/.test(s))
    r = { intent: 'log_helper_event', args: { helper: h.id, type: 'advance', amount: num(s) ?? 500 } };
  else r = { intent: 'clarify', args: { question: 'What happened?' }, say: "Sorry, I didn't get that. Could you say it again?" };
  return { ...r, source: 'fallback' };
}

const MOCK_TOOLS = {
  understand: mockUnderstand,
  add_helper: (a) => ({ helper: { id: a.name.split(' ')[0].toLowerCase(), aliases: [], paidLeaves: 0,
    defaultQtyPerDay: null, unit: null, ...a }, say: `Added ${a.name}.` }),
  log_helper_event: (a) => {
    const h = helperOf(a.helper);
    const event = { id: `e${Date.now()}`, helperId: h.id, date: a.date, type: a.type,
      qty: a.qty ?? null, amount: a.amount ?? null, raw: a.raw ?? '' };
    const say = { absent: `Noted — ${h.name} is absent today.`, extra: `Noted — ${h.name} gave ${a.qty} litre extra.`,
      less: `Noted — ${h.name} gave ${a.qty} litre less.`, advance: `Advance of ₹${a.amount} to ${h.name} noted.`,
      visit: `Noted — ${a.qty} for ${h.name}.` }[a.type];
    return { event, helperName: h.name, say };
  },
  get_bill: (a) => {
    const bills = a.helper ? MOCK_BILLS.filter((b) => b.helperId === helperOf(a.helper).id) : MOCK_BILLS;
    return { bills, say: bills.length === 1 ? `You owe ${bills[0].helperName} ₹${bills[0].total} this month.`
      : `This month you owe ₹${bills.reduce((s, b) => s + b.total, 0)} in total across ${bills.length} helpers.` };
  },
  month_summary: () => {
    const total = MOCK_BILLS.reduce((s, b) => s + b.total, 0);
    return { bills: MOCK_BILLS, total,
      whatsapp: MOCK_BILLS.map((b) => ({ helperName: b.helperName,
        text: `Namaste ${b.helperName}! October ka hisaab:\n${b.lines.map((l) => `${l.label}: ₹${l.amount}`).join('\n')}\nTotal: ₹${b.total}` })),
      say: `This month you owe ₹${total} in total across ${MOCK_BILLS.length} helpers.` };
  },
  log_purchase: (a) => {
    const purchase = { id: `p${Date.now()}`, item: a.item, vendor: a.vendor ?? 'unknown', price: a.price,
      unit: a.unit, qty: a.qty ?? 1, date: a.date, raw: a.raw ?? '' };
    const baseline = { tomato: 29, onion: 37, potato: 27, bhindi: 45 }[a.item];
    if (!baseline) return { purchase, alert: { level: 'new', baseline: null, cheapest: null },
      say: `Noted ${a.item} at ₹${a.price}. A bit more data and I can warn you.` };
    const level = a.price >= 1.2 * baseline ? 'high' : a.price <= 0.85 * baseline ? 'low' : 'normal';
    const cheapest = level === 'high' ? { vendor: 'station market', price: baseline - 2 } : null;
    const say = { high: `Arre! Usually ₹${baseline}, today ₹${a.price}? Bargain a little.${cheapest ? ` ${cheapest.vendor} had it at ₹${cheapest.price}.` : ''}`,
      low: `Good deal! ${a.item} at ₹${a.price}, usually ₹${baseline}.`, normal: `${a.item} at ₹${a.price} — a fair price.` }[level];
    return { purchase, alert: { level, baseline, cheapest }, say };
  },
  price_check: (a) => ({ item: a.item, avg: 29, min: 26, max: 32, cheapestVendor: 'station market',
    lastPrices: [28, 30, 27, 31, 29], say: `${a.item} is usually ₹29 (₹26 to ₹32). Cheapest at station market.` }),
  undo_last: () => ({ removed: { id: 'e99', type: 'absent' }, say: 'Done, removed the last entry.' })
};

function mockAnswer(body) {
  if (!('id' in body)) return null; // notification
  if (body.method === 'initialize') return { protocolVersion,
    capabilities: { tools: { listChanged: true } }, serverInfo: { name: 'hisaab (mock)', version: '1.0.0' } };
  if (body.method === 'tools/list') return { tools: TOOLS.map((name) => ({ name, inputSchema: { type: 'object' } })) };
  const { name, arguments: args } = body.params;
  return { content: [{ type: 'text', text: JSON.stringify(MOCK_TOOLS[name](args ?? {})) }] };
}
