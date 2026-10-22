import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { load, save, nextId } from './store.js';
import { say } from './lang.js';
import * as stubs from './stubs.js';

// Use Ritu's real module when its file exists; otherwise the stub. No edits needed when hers land.
async function optional(file) {
  try {
    return await import(file);
  } catch (e) {
    if (e.code === 'ERR_MODULE_NOT_FOUND' && e.message.includes(file.slice(2))) return {};
    throw e; // her file exists but is broken: surface it
  }
}
const mods = await Promise.all(['./dates.js', './bill.js', './prices.js', './messages.js', './understand.js'].map(optional));
const logic = Object.assign({}, stubs, ...mods);
const { todayIST, computeBill, checkPrice, priceReport, whatsappText, understand } = logic;

// ---- shared schema pieces -------------------------------------------------
const Lang = z.enum(['en', 'hi', 'ta']).optional();
const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD').optional();
const Month = z.string().regex(/^\d{4}-\d{2}$/, 'use YYYY-MM');
const EventType = z.enum(['absent', 'extra', 'less', 'advance', 'visit']);

// ---- helpers --------------------------------------------------------------
const ok = (result) => ({ content: [{ type: 'text', text: JSON.stringify(result) }] });
const fail = (error, sayLine) => ({ isError: true, content: [{ type: 'text', text: JSON.stringify({ error, say: sayLine }) }] });

class UserError extends Error {
  constructor(message, sayKey = 'clarify') { super(message); this.sayKey = sayKey; }
}

const norm = (s) => String(s ?? '').trim().toLowerCase();

function findHelper(data, query) {
  const q = norm(query);
  const exact = data.helpers.find((h) => [h.id, h.name, ...h.aliases].some((x) => norm(x) === q));
  const loose = () => data.helpers.find((h) => norm(h.name).includes(q) || h.aliases.some((a) => q.includes(norm(a))));
  const found = exact ?? (q && loose());
  if (!found) throw new UserError(`No helper matches "${query}"`);
  return found;
}

function slug(s) {
  return norm(s).normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'helper';
}

export function buildServer() {
  const server = new McpServer({ name: 'hisaab', version: '1.0.0' });

  // Registers a tool: adds `lang`, resolves it, wraps JSON output and errors in one place.
  // Handlers do load -> change -> save with no `await` in between, so writes never interleave.
  const tool = (name, title, description, inputSchema, handler) =>
    server.registerTool(name, { title, description, inputSchema: { ...inputSchema, lang: Lang } }, async (args) => {
      const lang = args.lang ?? 'en';
      try {
        return ok(await handler(args, lang));
      } catch (e) {
        if (!(e instanceof UserError)) console.error(`[${name}]`, e);
        return fail(e.message, say(lang, e instanceof UserError ? e.sayKey : 'error'));
      }
    });

  // 1. understand ------------------------------------------------------------
  tool('understand', 'Understand what the user said',
    'Turns an English/Hindi/Tamil/Hinglish sentence into an intent and arguments for another Hisaab tool.',
    { text: z.string().min(1), date: DateStr },
    async ({ text, date, lang }) => {
      const r = await understand(text, date ?? todayIST(), lang ?? 'en');
      if (r.intent === 'clarify' && !r.say) r.say = say(lang ?? 'en', 'clarify');
      return r;
    });

  // 2. add_helper ------------------------------------------------------------
  tool('add_helper', 'Add a helper',
    'Adds a household helper (maid, cook, milkman, newspaper, dhobi) with a pay rate.',
    {
      name: z.string().min(1), role: z.string().min(1),
      rateType: z.enum(['monthly', 'per_unit', 'per_visit']), rate: z.number().positive(),
      unit: z.string().optional(), paidLeaves: z.number().min(0).optional(),
      defaultQtyPerDay: z.number().positive().optional()
    },
    ({ name, role, rateType, rate, unit, paidLeaves, defaultQtyPerDay }, lang) => {
      const data = load();
      let id = slug(name.split(/\s+/)[0]);
      if (data.helpers.some((h) => h.id === id)) id = `${id}-${data.helpers.length + 1}`;
      const helper = {
        id, name, aliases: [...new Set([id, norm(role), ...norm(name).split(/\s+/)])],
        role: norm(role), rateType, rate, unit: unit ?? null,
        paidLeaves: paidLeaves ?? 0, defaultQtyPerDay: defaultQtyPerDay ?? null
      };
      data.helpers.push(helper);
      save(data);
      return { helper, say: say(lang, 'helperAdded', { name: helper.name }) };
    });

  // 3. log_helper_event ------------------------------------------------------
  tool('log_helper_event', 'Log a helper event',
    'Logs absent / extra / less / advance / visit for a helper (name or alias).',
    {
      helper: z.string().min(1), type: EventType,
      qty: z.number().positive().optional(), amount: z.number().positive().optional(),
      date: DateStr, raw: z.string().optional()
    },
    ({ helper, type, qty, amount, date, raw }, lang) => {
      const data = load();
      const h = findHelper(data, helper);
      if ((type === 'extra' || type === 'less') && qty == null) throw new UserError(`${type} needs qty`);
      if (type === 'advance' && amount == null) throw new UserError('advance needs amount');
      const event = {
        id: nextId(data.events, 'e'), helperId: h.id, date: date ?? todayIST(), type,
        qty: type === 'visit' ? (qty ?? 1) : (qty ?? null), amount: amount ?? null, raw: raw ?? ''
      };
      data.events.push(event);
      data.lastAdded = { kind: 'event', id: event.id };
      save(data);
      return { event, helperName: h.name, say: say(lang, type, { name: h.name, qty: event.qty, unit: h.unit, amount }) };
    });

  // 4. get_bill --------------------------------------------------------------
  // `date` (the page's demo date) is optional: it is the "today" used for the current month.
  tool('get_bill', 'Get a helper bill',
    'Month bill for one helper, or for all helpers if no helper is given.',
    { helper: z.string().optional(), month: Month, date: DateStr },
    ({ helper, month, date }, lang) => {
      const data = load();
      const list = helper ? [findHelper(data, helper)] : data.helpers;
      const bills = list.map((h) => computeBill(h, data.events.filter((e) => e.helperId === h.id), month, date ?? todayIST()));
      const sayLine = bills.length === 1
        ? say(lang, 'bill', { name: bills[0].helperName, total: bills[0].total })
        : say(lang, 'summary', { total: bills.reduce((s, b) => s + b.total, 0), count: bills.length });
      return { bills, say: sayLine };
    });

  // 5. month_summary ---------------------------------------------------------
  tool('month_summary', 'Month summary',
    'Bills for every helper this month, the total, and a ready WhatsApp message per helper.',
    { month: Month, date: DateStr },
    ({ month, date }, lang) => {
      const data = load();
      const bills = data.helpers.map((h) =>
        computeBill(h, data.events.filter((e) => e.helperId === h.id), month, date ?? todayIST()));
      const total = bills.reduce((s, b) => s + b.total, 0);
      return {
        bills, total,
        whatsapp: bills.map((b) => ({ helperName: b.helperName, text: whatsappText(b, lang) })),
        say: say(lang, 'summary', { total, count: bills.length })
      };
    });

  // 6. log_purchase ----------------------------------------------------------
  tool('log_purchase', 'Log a purchase',
    'Logs a sabzi/grocery purchase (price is rupees PER unit) and returns a price alert.',
    {
      item: z.string().min(1), vendor: z.string().optional(), price: z.number().positive(),
      unit: z.string().min(1), qty: z.number().positive().optional(), date: DateStr, raw: z.string().optional()
    },
    ({ item, vendor, price, unit, qty, date, raw }, lang) => {
      const data = load();
      const purchase = {
        id: nextId(data.purchases, 'p'), item: norm(item), vendor: norm(vendor) || 'unknown',
        price, unit: norm(unit), qty: qty ?? 1, date: date ?? todayIST(), raw: raw ?? ''
      };
      const alert = checkPrice(data.purchases, purchase); // history = purchases before this one
      data.purchases.push(purchase);
      data.lastAdded = { kind: 'purchase', id: purchase.id };
      save(data);
      const key = { high: 'priceHigh', low: 'priceLow', normal: 'priceNormal' }[alert.level] ?? 'priceNew';
      return { purchase, alert, say: say(lang, key, { item: purchase.item, price, baseline: alert.baseline, cheapest: alert.cheapest }) };
    });

  // 7. price_check -----------------------------------------------------------
  tool('price_check', 'Check a price',
    'Average, min, max, cheapest vendor and recent prices for an item.',
    { item: z.string().min(1), vendor: z.string().optional() },
    ({ item, vendor }, lang) => {
      const data = load();
      const rep = priceReport(data.purchases, norm(item), vendor ? norm(vendor) : undefined);
      const sayLine = rep.avg == null
        ? say(lang, 'priceNone', { item: norm(item) })
        : say(lang, 'priceCheck', rep);
      return { ...rep, say: sayLine };
    });

  // 8. undo_last -------------------------------------------------------------
  tool('undo_last', 'Undo the last entry',
    'Removes the newest event or purchase.',
    {},
    (_args, lang) => {
      const data = load();
      let { kind, id } = data.lastAdded ?? {};
      if (!kind) { // no marker (e.g. seeded file): newest by date, events win ties
        const e = [...data.events].sort((a, b) => a.date.localeCompare(b.date)).at(-1);
        const p = [...data.purchases].sort((a, b) => a.date.localeCompare(b.date)).at(-1);
        if (e && (!p || e.date >= p.date)) ({ kind, id } = { kind: 'event', id: e.id });
        else if (p) ({ kind, id } = { kind: 'purchase', id: p.id });
      }
      const list = kind === 'purchase' ? data.purchases : data.events;
      const i = list.findIndex((x) => x.id === id);
      if (i < 0) throw new UserError('Nothing to undo');
      const [removed] = list.splice(i, 1);
      delete data.lastAdded; // one-step undo
      save(data);
      return { removed, say: say(lang, 'undo') };
    });

  return server;
}
