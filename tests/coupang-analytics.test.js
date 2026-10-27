'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createService, COSTS } = require('../integrations/coupang/service.cjs');
const now = Date.parse('2026-10-27T05:00:00Z'), date = '2026-10-26';
const credentials = { vendorId: 'A00012345', accessKey: 'test-access-key', secretKey: 'test-secret-key' };
const protect = (mode, value) => mode === 'encrypt' ? Buffer.from(value).toString('base64') : Buffer.from(value, 'base64').toString();
const product = (itemId = '123', channel = 'growth') => ({ itemId, productId: '7000', name: '예시 토치', optionName: itemId === '123' ? '새 상품' : '중고', unitCost: 3000, commissionRate: 10, inboundFee: 100, deliveryFee: 200, salePrice: 10000, channel });
const row = (values = {}) => ({ productId: '7000', itemId: '123', channel: 'growth', name: '예시 토치', optionName: '새 상품', quantity: 9, adQuantity: 3, organicQuantity: 6, sales: 180000, profitBeforeAds: 90000, advertising: 40000, adSales: 60000, adProfitBeforeAds: 30000, ...values });
function setup(t, fetchImpl = async () => ({ ok: true, json: async () => ({ code: 200, data: [] }) })) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coupang-analytics-'));
  t.after(() => fs.rmSync(baseDir, { recursive: true, force: true }));
  const service = () => createService({ baseDir, protect, fetchImpl, now: () => now, sleep: async () => {} });
  const s = service(); s.saveCredentials(credentials); s.importCatalog({ products: [product()] });
  const query = channel => ({ since: date, until: date, channel: channel || 'growth' });
  return { s, baseDir, query, service };
}
function saveLedger(s, values = {}) {
  const report = s.report({ since: date, until: date }), ledger = report.daily[0];
  s.saveLedger({ date, channel: 'growth', scopeKey: report.scopeKey, basis: ledger.basis, reviewed: true, ...Object.fromEntries(COSTS.map(k => [k, 0])), ...values });
}
test('Sellha import calculates source profit and ROAS once, independently from mislabeled export ratio columns', t => {
  const { s, query } = setup(t);
  s.importSales({ date, rows: [row()] });
  const r = s.analytics(query());
  assert.equal(r.summary.sales, 180000);
  assert.equal(r.summary.profitBeforeAds, 90000);
  assert.equal(r.summary.sourceNetProfit, 50000);
  assert.equal(r.summary.netProfit, null);
  assert.equal(r.items[0].netProfit, null);
  assert.equal(r.items[0].adNetProfit, -10000);
  assert.ok(Math.abs(r.items[0].roas - 60000 / 40000 * 100) < 1e-9);
  assert.equal(r.summary.otherCosts, null, 'other costs are not deducted a second time or inferred from the profit');
  assert.equal(r.coverage.sellhaDays, 1);
});
test('explicit acquisition advertising zero confirms profit; positive spend is deducted only at day/channel level', t => {
  const { s, query } = setup(t);
  s.importSales({ date, rows: [row()], acquisitionAdvertising: { growth: 0 } });
  let r = s.analytics(query());
  assert.equal(r.summary.netProfit, 50000); assert.equal(r.items[0].netProfit, 50000); assert.equal(r.summary.complete, true);
  s.importSales({ date, rows: [row()], acquisitionAdvertising: { growth: 10000 } });
  r = s.analytics(query());
  assert.equal(r.summary.sourceNetProfit, 50000); assert.equal(r.summary.netProfit, 40000);
  assert.equal(r.items[0].netProfit, null, 'an unallocated channel expense must not be silently allocated to products');
  assert.equal(r.items[0].adNetProfit, -10000);
});
test('explicit acquisition costs survive a no-sale channel and catalog/export channel metadata conflicts', t => {
  const { s, query } = setup(t);
  s.importSales({ date, rows: [row()], acquisitionAdvertising: { growth: 0, seller: 100 } });
  let r = s.analytics(query('all'));
  assert.equal(r.summary.netProfit, 49900); assert.equal(r.daily[0].channels[1].netProfit, -100);
  s.importSales({ date, rows: [row({ channel: 'seller' })], acquisitionAdvertising: { growth: 0, seller: 100 } });
  r = s.analytics(query('seller'));
  assert.equal(r.summary.netProfit, 49900); assert.equal(r.items[0].netProfit, null);
});
test('Sellha refunds retain signed integer sales quantities and reverse revenue/profit without clamping', t => {
  const { s, query } = setup(t);
  s.importCatalog({ products: [product('456')] });
  const refund = row({ itemId: '456', optionName: '환불 옵션', quantity: -1, adQuantity: 0, organicQuantity: -1,
    sales: -30000, profitBeforeAds: -15000, advertising: 0, adSales: 0, adProfitBeforeAds: 0 });
  s.importSales({ date, rows: [row(), refund], acquisitionAdvertising: { growth: 0 } });
  const r = s.analytics({ ...query(), view: 'sales' });
  assert.equal(r.summary.quantity, 8); assert.equal(r.summary.sales, 150000); assert.equal(r.summary.profitBeforeAds, 75000);
  assert.equal(r.summary.sourceNetProfit, 35000); assert.equal(r.summary.netProfit, 35000);
  const refunded = r.items.find(p => p.itemId === '456');
  assert.equal(refunded.quantity, -1); assert.equal(refunded.organicQuantity, -1); assert.equal(refunded.sourceNetProfit, -15000);
});
test('import replacement is idempotent, persists across restart, and ignores customer/unrecognized fields', t => {
  const { s, query, service, baseDir } = setup(t);
  const input = { date, rows: [row({ customerName: 'DO NOT STORE', roas: 999999 })], acquisitionAdvertising: { growth: 0 } };
  assert.equal(s.importSales(input).replaced, false); assert.equal(s.importSales(input).replaced, true);
  assert.equal(service().analytics(query()).summary.sales, 180000);
  const raw = fs.readFileSync(path.join(baseDir, '.roas-data/coupang/A00012345/sales/' + date + '.json'), 'utf8');
  assert.ok(!raw.includes('DO NOT STORE')); assert.ok(!raw.includes('999999'));
  s.importSales({ ...input, rows: [row({ sales: 100000 })] });
  assert.equal(s.analytics(query()).summary.sales, 100000);
});
test('Sellha data takes precedence over order API and reviewed ledger without being added together', async t => {
  const { s, query } = setup(t, async () => ({ ok: true, json: async () => ({ code: 200, data: [{ vendorId: credentials.vendorId, orderId: 70000001, paidAt: Date.parse(date + 'T12:00:00+09:00'), orderItems: [{ vendorItemId: 123, salesQuantity: 2, unitSalesPrice: 10000, currency: 'KRW', productName: '예시 상품' }] }] }) }));
  await s.sync({ since: date, until: date, channel: 'growth' });
  saveLedger(s, { netSales: 18000, productCost: 6000, advertising: 1000 });
  assert.equal(s.analytics(query()).summary.netProfit, 11000);
  s.importSales({ date, rows: [row()], acquisitionAdvertising: { growth: 0 } });
  const r = s.analytics(query());
  assert.equal(r.summary.sales, 180000); assert.equal(r.summary.netProfit, 50000);
  assert.equal(r.items.length, 1); assert.equal(r.items[0].quantity, 9);
});
test('missing days stay unknown, imported explicit zeros stay zero, and zero ad spend has no ROAS', async t => {
  const { s, query } = setup(t);
  assert.equal(s.analytics(query()).daily[0].source, 'missing');
  assert.equal(s.analytics(query()).summary.sales, null);
  s.importSales({ date, rows: [row({ quantity: 0, adQuantity: 0, organicQuantity: 0, sales: 0, profitBeforeAds: 0, advertising: 0, adSales: 0, adProfitBeforeAds: 0 })], acquisitionAdvertising: { growth: 0 } });
  let r = s.analytics(query());
  assert.equal(r.summary.sales, 0); assert.equal(r.summary.netProfit, 0); assert.equal(r.items[0].roas, null);
  r = s.analytics({ since: '2026-10-25', until: date, channel: 'growth' });
  assert.equal(r.summary.sales, null); assert.equal(r.summary.netProfit, null); assert.equal(r.daily.length, 2);
  assert.equal(r.items.length, 2); assert.equal(r.items[0].source, 'missing'); assert.equal(r.items[0].sales, null);
  assert.equal(r.items[0].productId, r.items[1].productId, 'missing days must retain the product group identity');
  await s.sync({ since: '2026-10-25', until: '2026-10-25', channel: 'growth' });
  r = s.analytics({ since: '2026-10-25', until: '2026-10-25', channel: 'growth' });
  assert.equal(r.summary.sales, 0); assert.equal(r.summary.quantity, 0); assert.equal(r.summary.netProfit, null); assert.equal(r.items[0].source, 'api');
});
test('delivery filters and option grouping preserve Sellha/catalog IDs; a product absent from selected delivery has zero contribution', t => {
  const { s, query } = setup(t);
  s.importCatalog({ products: [product('456', 'seller')] });
  s.importSales({ date, rows: [row(), row({ itemId: '456', channel: 'seller', optionName: '중고', sales: 20000, profitBeforeAds: 8000, advertising: 2000 })], acquisitionAdvertising: { growth: 0, seller: 0 } });
  let r = s.analytics(query('all'));
  assert.equal(r.summary.sales, 200000); assert.equal(r.items.length, 2);
  assert.deepEqual(r.items.map(p => p.productId), ['7000', '7000']);
  assert.equal(r.items[1].optionName, '중고');
  r = s.analytics(query('seller')); assert.equal(r.summary.sales, 20000); assert.equal(r.items.length, 1);
  s.saveScope({ products: [{ itemId: '123', name: '예시 토치', unitCost: 3000 }] });
  r = s.analytics(query('all'));
  assert.equal(r.summary.sales, 180000); assert.equal(r.daily[0].channels[1].sales, 0);
  assert.equal(r.summary.netProfit, null, 'extra advertising confirmation belongs to the former scope');
});
test('selected scope and vendors are isolated, and unrelated imported rows never mark missing sales as zero', t => {
  const { s, query } = setup(t);
  s.importSales({ date, rows: [row({ itemId: '999', productId: '9999', name: '외부 상품' })] });
  assert.equal(s.analytics(query()).summary.sales, null);
  assert.equal(s.analytics(query()).items[0].source, 'missing');
  s.importSales({ date, rows: [row()], acquisitionAdvertising: { growth: 0 } });
  s.saveScope({ products: [{ itemId: '456', name: '위마망', unitCost: 5000 }] });
  assert.equal(s.analytics(query()).summary.sales, null);
  s.saveCredentials({ ...credentials, vendorId: 'A00054321' });
  s.saveScope({ products: [{ itemId: '123', name: '위마망', unitCost: 5000 }] });
  assert.equal(s.analytics(query()).summary.sales, null); assert.deepEqual(s.analytics(query()).importedDates, []);
});
test('partial selected-scope imports show item records but do not claim complete channel totals', t => {
  const { s, query } = setup(t);
  s.importCatalog({ products: [product('456')] });
  s.importSales({ date, rows: [row()], acquisitionAdvertising: { growth: 0 } });
  const r = s.analytics(query());
  assert.equal(r.items.length, 2); assert.equal(r.items[1].source, 'missing'); assert.equal(r.summary.sales, null); assert.equal(r.summary.netProfit, null);
  assert.equal(r.daily[0].channels[0].matchedProducts, 1); assert.equal(r.daily[0].channels[0].expectedProducts, 2);
});
test('invalid imports reject atomically: duplicates, bad numbers, unsafe IDs, future/old dates and invalid acquisition spend', t => {
  const { s, query } = setup(t);
  s.importSales({ date, rows: [row()] });
  for (const input of [
    { date, rows: [row(), row()] },
    { date, rows: [row({ sales: null })] },
    { date, rows: [row({ quantity: 1.5 })] },
    { date, rows: [row({ itemId: 9007199254740992 })] },
    { date, rows: [row({ productId: '../other' })] },
    { date, rows: [row()], acquisitionAdvertising: { growth: -1 } },
    { date: '2026-10-28', rows: [row()] },
    { date: '2025-10-25', rows: [row()] }
  ]) assert.throws(() => s.importSales(input));
  assert.equal(s.analytics(query()).summary.sales, 180000);
  assert.throws(() => s.analytics(query('invalid')), /배송/);
});
test('catalog metadata survives manual scope saves, and stale ledgers never become confirmed profit', async t => {
  let quantity = 2;
  const { s, query } = setup(t, async () => ({ ok: true, json: async () => ({ code: 200, data: [{ vendorId: credentials.vendorId, orderId: 70000001, paidAt: Date.parse(date + 'T12:00:00+09:00'), orderItems: [{ vendorItemId: 123, salesQuantity: quantity, unitSalesPrice: 10000, currency: 'KRW', productName: '예시 상품' }] }] }) }));
  s.saveScope({ products: [{ itemId: '123', name: '예시 토치', unitCost: 3000 }] });
  const p = s.status().products[0]; assert.equal(p.productId, '7000'); assert.equal(p.optionName, '새 상품'); assert.equal(p.channel, 'growth'); assert.equal(p.salePrice, 10000);
  await s.sync({ since: date, until: date, channel: 'growth' });
  saveLedger(s, { netSales: 20000, productCost: 6000, commission: 2000, advertising: 1000, inbound: 500, delivery: 500, storage: 100, returns: 200, other: 50 });
  let r = s.analytics(query());
  assert.equal(r.summary.netProfit, 9650); assert.equal(r.summary.profitBeforeAds, 10650); assert.equal(r.summary.otherCosts, 1350);
  quantity = 3; await s.sync({ since: date, until: date, channel: 'growth' });
  r = s.analytics(query()); assert.equal(r.summary.netProfit, null); assert.equal(r.summary.sales, 30000); assert.equal(r.daily[0].source, 'api');
});
test('compact views aggregate option-period totals and preserve strict nulls, weighted ROAS and product-day detail', t => {
  const { s, query } = setup(t);
  const earlier = '2026-10-25';
  s.importSales({ date: earlier, rows: [row()], acquisitionAdvertising: { growth: 0 } });
  s.importSales({ date, rows: [row({ sales: 100000, advertising: 10000, adSales: 20000 })], acquisitionAdvertising: { growth: 0 } });
  const input = { since: earlier, until: date, channel: 'growth' };
  let r = s.analytics({ ...input, view: 'sales' });
  assert.equal(r.items.length, 1); assert.equal(r.items[0].date, null); assert.equal(r.items[0].days, 2);
  assert.equal(r.items[0].sales, 280000); assert.equal(r.items[0].advertising, 50000);
  assert.ok(Math.abs(r.items[0].roas - 80000 / 50000 * 100) < 1e-9);
  assert.ok(!Object.hasOwn(r, 'productDaily'));
  r = s.analytics({ ...input, view: 'dashboard' });
  assert.equal(r.productDaily.length, 2); assert.equal(r.productDaily[0].productId, '7000');
  assert.equal(r.productDaily[0].sales, 180000); assert.equal(r.items.length, 1);
  r = s.analytics({ ...input, since: '2026-10-24', view: 'sales' });
  assert.equal(r.items.length, 1); assert.equal(r.items[0].sales, null); assert.equal(r.items[0].sourceNetProfit, null); assert.equal(r.items[0].source, 'mixed');
  assert.throws(() => s.analytics({ ...query(), view: 'other' }), /화면/);
});
test('compact one-year reports keep 398 options below response-size limits while retaining unknown profits', t => {
  const { s, baseDir } = setup(t);
  const products = Array.from({ length: 398 }, (_, i) => ({ ...product(String(10000 + i)), productId: String(20000 + Math.floor(i / 6)), productName: '상품 ' + Math.floor(i / 6) }));
  s.saveScope({ products });
  const since = '2025-10-27', input = { since, until: date, channel: 'growth' };
  let r = s.analytics({ ...input, view: 'sales' });
  assert.equal(r.items.length, 398); assert.equal(r.summary.netProfit, null); assert.ok(r.items.every(p => p.sales === null));
  assert.ok(Buffer.byteLength(JSON.stringify(r)) < 1000000);
  const orders = path.join(baseDir, '.roas-data/coupang/A00012345/orders'); fs.mkdirSync(orders, { recursive: true });
  for (let time = Date.parse(since); time <= Date.parse(date); time += 86400000) {
    const day = new Date(time).toISOString().slice(0, 10);
    fs.writeFileSync(path.join(orders, day + '-growth.json'), JSON.stringify({ date: day, channel: 'growth', vendorId: credentials.vendorId, fetchedAt: new Date(now).toISOString(), rows: [] }));
  }
  r = s.analytics({ ...input, view: 'dashboard' });
  assert.equal(r.items.length, 398); assert.equal(r.productDaily.length, 67 * 365); assert.equal(r.summary.sales, 0); assert.equal(r.summary.netProfit, null);
  assert.ok(r.items.every(p => p.sales === 0 && p.netProfit === null));
  assert.ok(Buffer.byteLength(JSON.stringify(r)) < 15000000);
});
