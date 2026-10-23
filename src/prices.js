// Price memory: is today's vegetable price normal, and where is it cheapest?
// Baseline is the MEDIAN of past per-unit prices (one crazy vendor cannot move it).
// Alert rules: > +20% of median = high, < -15% = low, otherwise normal.

const round2 = (n) => Math.round(n * 100) / 100;
const norm = (value) => String(value ?? '').trim().toLowerCase();
const priceOf = (row) => {
  const n = Number(row?.price);
  return Number.isFinite(n) && n > 0 ? n : null;
};

export function median(values) {
  const nums = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

const HIGH_FACTOR = 1.2;   // +20%
const LOW_FACTOR = 0.85;   // -15%

export function checkPrice(purchases = [], newPurchase) {
  const price = priceOf(newPurchase);
  if (price == null) throw new Error('checkPrice needs a purchase with a positive price');

  const item = norm(newPurchase.item);
  const unit = norm(newPurchase.unit) || null;

  // Compare like with like: ₹/kg history must not judge a ₹/dozen purchase.
  let rows = (purchases ?? []).filter((p) => norm(p.item) === item);
  if (unit) rows = rows.filter((p) => norm(p.unit) === unit);
  rows = rows.filter((p) => priceOf(p) != null);

  const base = { item, unit, price: round2(price), samples: rows.length };

  if (!rows.length) {
    return { ...base, level: 'new', baseline: null, cheapest: null, deltaPct: null };
  }

  const prices = rows.map(priceOf);
  const baseline = median(prices);
  if (!(baseline > 0)) {
    return { ...base, level: 'new', baseline: null, cheapest: null, deltaPct: null };
  }

  const cheapestRow = rows.reduce((best, row) => (priceOf(row) < priceOf(best) ? row : best), rows[0]);
  const cheapest = { vendor: cheapestRow.vendor ?? 'unknown', price: round2(priceOf(cheapestRow)) };

  const delta = (price - baseline) / baseline;
  const level = price > baseline * HIGH_FACTOR ? 'high'
    : price < baseline * LOW_FACTOR ? 'low'
      : 'normal';

  return {
    ...base,
    level,
    baseline: round2(baseline),
    cheapest,
    deltaPct: Math.round(delta * 100)
  };
}

// Average / range / cheapest vendor / recent prices for one item (optionally one vendor).
export function priceReport(purchases = [], item, vendor) {
  const itemKey = norm(item);
  const vendorKey = vendor ? norm(vendor) : null;

  const rows = (purchases ?? []).filter((p) =>
    norm(p.item) === itemKey &&
    (!vendorKey || norm(p.vendor) === vendorKey) &&
    priceOf(p) != null
  );

  if (!rows.length) {
    return {
      item: itemKey, count: 0, avg: null, median: null, min: null, max: null,
      cheapestVendor: null, lastPrices: [], vendors: []
    };
  }

  const prices = rows.map(priceOf);
  const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
  const cheapestRow = rows.reduce((best, row) => (priceOf(row) < priceOf(best) ? row : best), rows[0]);

  const byVendor = new Map();
  for (const row of rows) {
    const key = row.vendor ?? 'unknown';
    if (!byVendor.has(key)) byVendor.set(key, []);
    byVendor.get(key).push(priceOf(row));
  }
  const vendors = [...byVendor.entries()]
    .map(([name, list]) => ({
      vendor: name,
      count: list.length,
      avg: round2(list.reduce((a, b) => a + b, 0) / list.length),
      min: Math.min(...list),
      max: Math.max(...list),
      lastPrice: list.at(-1)
    }))
    .sort((a, b) => a.avg - b.avg || a.vendor.localeCompare(b.vendor));

  return {
    item: itemKey,
    count: rows.length,
    avg: round2(avg),
    median: round2(median(prices)),
    min: Math.min(...prices),
    max: Math.max(...prices),
    cheapestVendor: vendorKey ? rows[0].vendor ?? 'unknown' : cheapestRow.vendor ?? 'unknown',
    lastPrices: prices.slice(-5),
    vendors
  };
}
