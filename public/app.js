// Hisaab page: the "simulated Alexa+". Per utterance: understand -> matching tool -> card -> speak `say`.
import { connect, callTool, onLog, MOCK } from './mcp-client.js';

const $ = (id) => document.getElementById(id);
const chat = $('chat'), log = $('log'), textBox = $('text'), mic = $('mic');
const langSel = $('lang'), dateInput = $('demoDate'), modeChip = $('mode'), status = $('status');

const SPEECH_LANG = { en: 'en-IN', hi: 'hi-IN', ta: 'ta-IN' };
const LANG_NAME = { en: 'English', hi: 'Hindi', ta: 'Tamil' };
const DEFAULT_DATE = '2026-10-31'; // demo date in the video (guide section 6)
const BAZAAR = new Set(['log_purchase', 'price_check']);
// Tools whose schema takes `date` / `raw` (others would just drop them, but keep the panel tidy).
const TAKES_DATE = new Set(['understand', 'log_helper_event', 'get_bill', 'month_summary', 'log_purchase']);
const TAKES_RAW = new Set(['log_helper_event', 'log_purchase']);

const EXAMPLES = {
  en: ['Shanti didi aaj nahi aayi', 'Doodhwala ne aaj aadha litre extra diya', 'Cook ko 500 advance diya',
    'Tomato 40 rupay kilo, corner wale bhaiya se', 'Is mahine kisko kitna dena hai?', 'Tomato ka sahi rate kya hai?',
    'Galti ho gayi, last wala hata do'],
  hi: ['शांति दीदी आज नहीं आईं', 'दूधवाले ने आधा लीटर ज़्यादा दिया', 'टमाटर चालीस रुपये किलो, कोने वाले भैया से',
    'इस महीने किसको कितना देना है?', 'टमाटर का सही रेट क्या है?'],
  ta: ['Shanti akka inniki varala', 'Paalkaaran arai litre adhigam koduthaar', 'தக்காளி கிலோ நாற்பது ரூபாய், corner கடையில',
    'இந்த மாசம் யாருக்கு எவ்வளவு கொடுக்கணும்?', 'Vengayam sariyana rate enna?']
};

// ---- small helpers ----------------------------------------------------------
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } }
};
const lang = () => langSel.value;
const demoDate = () => dateInput.value || DEFAULT_DATE;
const rupees = (n) => `₹${Math.round(Number(n)).toLocaleString('en-IN')}`;
const signed = (n) => (n < 0 ? `− ${rupees(-n)}` : rupees(n));
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');
const monthName = (ym) => new Date(`${ym}-01T00:00:00`).toLocaleString('en-IN', { month: 'long', year: 'numeric' });
const prettyDate = (d) => new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) n.append(k instanceof Node ? k : String(k));
  return n;
}

function add(node) {
  chat.append(node);
  chat.scrollTop = chat.scrollHeight;
  return node;
}
const bubble = (who, text, meta) =>
  add(el('div', { class: `bubble ${who}` }, text, meta && el('span', { class: 'meta' }, meta)));

function setMode(intent) {
  const bazaar = BAZAAR.has(intent);
  modeChip.textContent = bazaar ? 'Bazaar' : 'Helpers';
  modeChip.className = `chip ${bazaar ? 'bazaar' : 'helpers'}`;
}

// ---- MCP panel ------------------------------------------------------------
const sentLabel = {}; // request id -> label, so each result names its call
onLog((dir, msg) => {
  const isReq = dir === '→';
  const label = isReq
    ? (msg.method === 'tools/call' ? `tools/call ${msg.params.name}` : msg.method)
    : `result · ${sentLabel[msg.id] ?? `#${msg.id}`}`;
  if (isReq && msg.id != null) sentLabel[msg.id] = label;
  const isErr = !isReq && (msg.error || msg.result?.isError);
  const li = el('li', { class: `${isReq ? 'req' : 'res'}${isErr ? ' error' : ''}` },
    el('div', { class: 'head', onclick: () => li.classList.toggle('collapsed') },
      el('span', { class: 'dir' }, dir), el('span', { class: 'name' }, label),
      el('span', { class: 'time' }, new Date().toLocaleTimeString('en-IN', { hour12: false }))),
    el('pre', {}, prettyRpc(msg)));
  // Keep only the newest request/response pair open so the call sequence stays readable.
  if (isReq) for (const old of log.children) old.classList.add('collapsed');
  log.append(li);
  log.scrollTop = log.scrollHeight;
});

// Show tool results as parsed JSON, not as an escaped string.
function prettyRpc(msg) {
  const copy = structuredClone(msg);
  for (const c of copy.result?.content ?? []) {
    if (c.type === 'text') try { c.text = JSON.parse(c.text); } catch { /* leave as is */ }
  }
  if (copy.result?.tools) copy.result.tools = copy.result.tools.map((t) => t.name);
  return JSON.stringify(copy, null, 2);
}
$('clearPanel').addEventListener('click', () => { log.innerHTML = ''; });

// ---- voice out ------------------------------------------------------------
let voices = [];
function loadVoices() { voices = speechSynthesis.getVoices(); }
if ('speechSynthesis' in window) {
  loadVoices();
  speechSynthesis.onvoiceschanged = loadVoices;
}
function pickVoice(l) {
  const want = SPEECH_LANG[l].toLowerCase();
  const prefix = l === 'en' ? 'en-in' : l;
  return voices.find((v) => v.lang.toLowerCase().replace('_', '-') === want)
    ?? voices.find((v) => v.lang.toLowerCase().startsWith(prefix));
}
function speak(text) {
  if (!text || !('speechSynthesis' in window)) return;
  const l = lang();
  const voice = pickVoice(l);
  if (!voice && l !== 'en') {
    // No Hindi/Tamil voice installed: show the native text only (guide section 8).
    bubble('bot', `(No ${LANG_NAME[l]} voice on this computer — showing text only.)`);
    return;
  }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = voice?.lang ?? SPEECH_LANG.en;
  if (voice) u.voice = voice;
  speechSynthesis.speak(u);
}

// ---- voice in -------------------------------------------------------------
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null;
if (!Recognition) {
  mic.disabled = true;
  mic.title = 'Voice input needs Chrome or Edge on localhost — use the text box';
} else {
  mic.addEventListener('click', () => {
    if (rec) { rec.stop(); return; }
    rec = new Recognition();
    rec.lang = SPEECH_LANG[lang()];
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => handle(e.results[0][0].transcript);
    rec.onerror = (e) => {
      if (e.error !== 'no-speech' && e.error !== 'aborted') bubble('bot err', `Mic error: ${e.error}. Use the text box.`);
    };
    rec.onend = () => { mic.classList.remove('listening'); rec = null; };
    mic.classList.add('listening');
    rec.start();
  });
}

// ---- the per-utterance flow -------------------------------------------------
let busy = false;
async function handle(text) {
  text = text.trim();
  if (!text || busy) return;
  busy = true;
  bubble('user', text);
  const l = lang(), date = demoDate();
  try {
    const u = await callTool('understand', { text, date, lang: l });
    if (u.intent === 'clarify') {
      bubble('bot', u.say ?? u.args?.question ?? 'Sorry?', `understand · ${u.source}`);
      speak(u.say);
      return;
    }
    const args = { ...u.args, lang: l };
    if (TAKES_DATE.has(u.intent)) args.date = date;
    if (TAKES_RAW.has(u.intent)) args.raw = text;
    if ((u.intent === 'get_bill' || u.intent === 'month_summary') && !args.month) args.month = date.slice(0, 7);
    setMode(u.intent);
    const r = await callTool(u.intent, args);
    bubble('bot', r.say, `understand (${u.source}) → ${u.intent}`);
    renderCard(u.intent, r);
    speak(r.say);
  } catch (e) {
    const line = e.say ?? `Something went wrong: ${e.message}`;
    bubble('bot err', line);
    speak(e.say);
  } finally {
    busy = false;
  }
}

// ---- cards ----------------------------------------------------------------
function renderCard(intent, r) {
  const card = CARDS[intent]?.(r);
  if (card) add(card);
}

const CARDS = {
  log_helper_event: ({ event, helperName }) => {
    const what = {
      absent: 'Absent',
      extra: `Extra ${event.qty}`,
      less: `Less ${event.qty}`,
      advance: `Advance ${rupees(event.amount)}`,
      visit: `Visit × ${event.qty}`
    }[event.type];
    return el('div', { class: 'card' },
      el('h3', {}, helperName, el('span', { class: 'badge' }, 'logged')),
      el('div', { class: 'big' }, what),
      el('div', { class: 'sub' }, prettyDate(event.date)));
  },

  log_purchase: ({ purchase, alert }) => {
    const label = { high: 'Overpriced', low: 'Good deal', normal: 'Fair price', new: 'New item' }[alert.level];
    return el('div', { class: `card ${alert.level}` },
      el('h3', {}, `${cap(purchase.item)} · ${purchase.vendor}`, el('span', { class: 'badge' }, label)),
      el('div', { class: 'big' }, `${rupees(purchase.price)}/${purchase.unit}`),
      el('div', { class: 'sub' },
        alert.baseline != null ? `Usually ${rupees(alert.baseline)}/${purchase.unit}` : 'Not enough history yet',
        purchase.qty !== 1 ? ` · qty ${purchase.qty}` : ''),
      alert.cheapest && el('div', { class: 'sub' }, `Cheapest lately: ${alert.cheapest.vendor} at ${rupees(alert.cheapest.price)}`));
  },

  get_bill: ({ bills }) => (bills.length === 1 ? billCard(bills[0]) : summaryCard({ bills })),

  month_summary: (r) => summaryCard(r),

  price_check: ({ item, avg, min, max, cheapestVendor, lastPrices }) =>
    el('div', { class: 'card' },
      el('h3', {}, cap(item), el('span', { class: 'badge' }, 'price memory')),
      avg == null
        ? el('div', { class: 'sub' }, 'No purchases logged yet.')
        : [el('div', { class: 'big' }, `~${rupees(avg)}`),
          el('div', { class: 'sub' }, `Range ${rupees(min)} – ${rupees(max)}`,
            cheapestVendor ? ` · cheapest: ${cheapestVendor}` : ''),
          lastPrices?.length ? el('div', { class: 'prices' }, 'Last:', lastPrices.map((p) => el('span', {}, rupees(p)))) : null]),

  add_helper: ({ helper }) =>
    el('div', { class: 'card' },
      el('h3', {}, helper.name, el('span', { class: 'badge' }, 'new helper')),
      el('div', { class: 'sub' }, `${helper.role} · ${helper.rateType.replace('_', ' ')} · ${rupees(helper.rate)}${helper.unit ? `/${helper.unit}` : ''}`)),

  undo_last: ({ removed }) =>
    el('div', { class: 'card normal' },
      el('h3', {}, 'Removed', el('span', { class: 'badge' }, 'undo')),
      el('div', { class: 'sub' }, removed.raw || `${removed.type ?? removed.item} · ${removed.date ?? ''}`))
};

function billCard(b, whatsapp) {
  return el('div', { class: 'card' },
    el('h3', {}, b.helperName, el('span', { class: 'badge' }, monthName(b.month))),
    el('table', { class: 'lines' },
      b.lines.map((l) => el('tr', {}, el('td', {}, l.label), el('td', { class: l.amount < 0 ? 'neg' : '' }, signed(l.amount)))),
      el('tr', { class: 'total' }, el('td', {}, 'To pay'), el('td', {}, rupees(b.total)))),
    whatsapp && el('div', { class: 'actions' },
      el('button', { class: 'btn', type: 'button', onclick: (e) => copy(whatsapp, e.currentTarget) }, 'Copy WhatsApp message'),
      el('a', { class: 'btn wa', href: `https://wa.me/?text=${encodeURIComponent(whatsapp)}`, target: '_blank', rel: 'noopener' }, 'Open WhatsApp')));
}

function summaryCard({ bills, total, whatsapp = [] }) {
  total ??= bills.reduce((s, b) => s + b.total, 0);
  const textFor = (b) => whatsapp.find((w) => w.helperName === b.helperName)?.text;
  return el('div', { class: 'card' },
    el('div', { class: 'grand' },
      el('span', {}, `Month summary · ${monthName(bills[0]?.month ?? demoDate().slice(0, 7))}`),
      el('strong', {}, rupees(total))),
    el('div', { class: 'summary-grid' }, bills.map((b) => billCard(b, textFor(b)))));
}

async function copy(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = el('textarea', {}, text);
    document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove();
  }
  const old = btn.textContent;
  btn.textContent = 'Copied ✓';
  setTimeout(() => { btn.textContent = old; }, 1500);
}

// ---- pickers + examples -----------------------------------------------------
function showExamples() {
  const box = $('examples');
  box.innerHTML = '';
  for (const s of EXAMPLES[lang()]) box.append(el('button', { type: 'button', onclick: () => handle(s) }, s));
}

langSel.value = store.get('hisaab.lang') ?? 'en';
dateInput.value = store.get('hisaab.date') ?? DEFAULT_DATE;
langSel.addEventListener('change', () => {
  store.set('hisaab.lang', lang());
  document.documentElement.lang = lang();
  showExamples();
});
dateInput.addEventListener('change', () => store.set('hisaab.date', demoDate()));
document.documentElement.lang = lang();
showExamples();

$('form').addEventListener('submit', (e) => {
  e.preventDefault();
  const t = textBox.value;
  textBox.value = '';
  handle(t);
});

// ---- start ----------------------------------------------------------------
(async () => {
  try {
    const tools = await connect();
    status.textContent = MOCK ? `mock · ${tools.length} tools` : `connected · ${tools.length} tools`;
    status.className = `status ${MOCK ? 'mock' : 'ok'}`;
    bubble('bot', 'Namaste! Tell me who came, who didn’t, or what you bought. Ask “kisko kitna dena hai?” at month-end.');
  } catch (e) {
    status.textContent = 'server offline';
    status.className = 'status bad';
    bubble('bot err', `Could not reach /mcp (${e.message}). Run npm start, or open ?mock=1.`);
  }
})();
