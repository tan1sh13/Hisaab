import test from 'node:test';
import assert from 'node:assert/strict';

import { checkPrice, median, priceReport } from '../src/prices.js';

const purchase = (vendor, price, unit = 'kg', item = 'tomato') =>
  ({ item, vendor, price, unit, qty: 1, date: '2026-09-01' });

test('checkPrice: first purchase of an item has no baseline', () => {
  const alert = checkPrice([], purchase('mandi', 40));
  assert.equal(alert.level, 'new');
  assert.equal(alert.baseline, null);
  assert.equal(alert.samples, 0);
});

test('checkPrice: more than +20% of the median is high, with the cheapest vendor', () => {
  const history = [purchase('mandi', 40), purchase('bigbasket', 40), purchase('mandi', 42)];
  const alert = checkPrice(history, purchase('bigbasket', 55));

  assert.equal(alert.level, 'high');
  assert.equal(alert.baseline, 40);
  assert.deepEqual(alert.cheapest, { vendor: 'mandi', price: 40 });
  assert.ok(alert.deltaPct >= 37);
});

test('checkPrice: below −15% of the median is a good deal', () => {
  const history = [purchase('mandi', 100), purchase('mandi', 100)];
  const alert = checkPrice(history, purchase('bigbasket', 80));

  assert.equal(alert.level, 'low');
  assert.equal(alert.baseline, 100);
});

test('checkPrice: a price inside the band is normal, including the exact +20% edge', () => {
  const history = [purchase('mandi', 40), purchase('mandi', 40)];
  assert.equal(checkPrice(history, purchase('bigbasket', 45)).level, 'normal');
  assert.equal(checkPrice(history, purchase('bigbasket', 48)).level, 'normal');
});

test('checkPrice uses the median, so one crazy price cannot move the baseline', () => {
  const history = [purchase('mandi', 100), purchase('mandi', 100), purchase('bigbasket', 10)];
  const alert = checkPrice(history, purchase('bigbasket', 85));

  assert.equal(alert.baseline, 100); // mean would be 70 and call this "high"
  assert.equal(alert.level, 'normal');
  assert.equal(median([100, 100, 10]), 100);
});

test('checkPrice does not compare ₹/kg history with a ₹/dozen purchase', () => {
  const history = [purchase('mandi', 60, 'litre', 'milk'), purchase('mandi', 62, 'litre', 'milk')];
  const alert = checkPrice(history, purchase('bigbasket', 25, 'packet', 'milk'));

  assert.equal(alert.level, 'new');
  assert.equal(alert.samples, 0);
});

test('priceReport summarises one item and can filter by vendor', () => {
  const history = [
    purchase('bigbasket', 40, 'kg', 'onion'),
    purchase('bigbasket', 44, 'kg', 'onion'),
    purchase('mandi', 35, 'kg', 'onion'),
    purchase('mandi', 99, 'kg', 'tomato') // different item
  ];

  const all = priceReport(history, 'onion');
  assert.equal(all.count, 3);
  assert.equal(all.avg, 39.67);
  assert.equal(all.median, 40);
  assert.equal(all.min, 35);
  assert.equal(all.max, 44);
  assert.equal(all.cheapestVendor, 'mandi');
  assert.deepEqual(all.lastPrices, [40, 44, 35]);
  assert.deepEqual(all.vendors.map((v) => v.vendor), ['mandi', 'bigbasket']);

  const oneVendor = priceReport(history, 'onion', 'bigbasket');
  assert.equal(oneVendor.count, 2);
  assert.equal(oneVendor.avg, 42);
  assert.equal(oneVendor.cheapestVendor, 'bigbasket');
});

test('priceReport returns nulls when there is no history', () => {
  const report = priceReport([], 'tomato');
  assert.equal(report.count, 0);
  assert.equal(report.avg, null);
  assert.equal(report.cheapestVendor, null);
  assert.deepEqual(report.lastPrices, []);
});
