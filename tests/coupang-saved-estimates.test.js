'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createService, COSTS } = require('../integrations/coupang/service.cjs');
const now = Date.parse('2026-10-27T05:00:00Z'), date = '2026-10-25';
const credentials = { vendorId: 'A00012345', accessKey: 'test-access-key', secretKey: 'test-secret-key' };
const protect = (mode, value) => mode === 'encrypt' ? Buffer.from(value).toString('base64') : Buffer.from(value, 'base64').toString();
const product = (extra = {}) => ({ itemId: '123', productId: '7000', name: '예시 상품', channel: 'growth', unitCost: 3000, commissionRate: 10, inboundFee: 100, deliveryFee: 200, costSince: '2026-10-01', ...extra });
const order = (itemId = 123, quantity = 2, unitSalesPrice = 10000) => ({ vendorId: credentials.vendorId, orderId: 70000000 + itemId, paidAt: Date.parse(date + 'T12:00:00+09:00'),
  orderItems: [{ vendorItemId: itemId, productName: '예시 상품', salesQuantity: quantity, unitSalesPrice, currency: 'KRW' }] });
function setup(t, products = [product()], orders = [order()]) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coupang-estimates-'));
  t.after(() => fs.rmSync(baseDir, { recursive: true, force: true }));
  let calls = 0, allowFetch = true;
  const service = () => createService({ baseDir, protect, now: () => now, sleep: async () => {}, fetchImpl: async () => {
    calls++; assert.ok(allowFetch, 'reads and saved-cost changes must not refetch the API');
    return { ok: true, json: async () => ({ code: 200, data: orders }) };
  } });
  const s = service(); s.saveCredentials(credentials); s.importCatalog({ products });
  return { s, service, baseDir, query: { since: date, until: date, channel: 'growth', view: 'sales' }, getCalls: () => calls, stopFetch: () => { allowFetch = false; } };
}
test('saved API rows calculate separate estimates and settings changes recompute without refetch or snapshot mutation', async t => {
  const { s, service, baseDir, query, getCalls, stopFetch } = setup(t);
  await s.sync({ since: date, until: date, channel: 'growth' }); stopFetch();
  const file = path.join(baseDir, '.roas-data/coupang', credentials.vendorId, 'orders', date + '-growth.json');
  const snapshot = fs.readFileSync(file, 'utf8');
  let r = s.analytics(query);
  for (const values of [r.summary, r.daily[0], r.daily[0].channels[0], r.items[0]]) {
    assert.equal(values.estimatedProductCost, 6000); assert.equal(values.estimatedCommission, 2000); assert.equal(values.estimatedFulfillment, 600); assert.equal(values.estimatedProfitBeforeAds, 11400);
    assert.deepEqual(values.missingInputs, []); assert.equal(values.estimateSource, 'api');
    assert.equal(values.profitBeforeAds, null); assert.equal(values.sourceNetProfit, null); assert.equal(values.netProfit, null);
  }
  assert.deepEqual(r.storage, { latestOrderDate: date, lastSavedAt: new Date(now).toISOString(), storedDays: 1, expectedDays: 1 });
  assert.equal(r.daily[0].channels[0].fetchedAt, new Date(now).toISOString());
  assert.equal(s.report(query).summaries.growth.estimatedProfitBeforeAds, 11400);
  const { scopeKey, revision } = s.workspace();
  s.updateProduct({ scopeKey, revision, itemId: '123', unitCost: 4000, commissionRate: 12, inboundFee: 150, deliveryFee: 350, costSince: '2026-10-01' });
  r = service().analytics(query);
  assert.equal(r.summary.estimatedProductCost, 8000); assert.equal(r.summary.estimatedCommission, 2400); assert.equal(r.summary.estimatedFulfillment, 1000); assert.equal(r.summary.estimatedProfitBeforeAds, 8600);
  assert.equal(getCalls(), 1); assert.equal(fs.readFileSync(file, 'utf8'), snapshot);
});
test('missing nonzero cost inputs stay unknown, but unsold and explicit-zero settings contribute zero', async t => {
  const { s, query } = setup(t);
  s.saveScope({ products: [{ itemId: '123', name: '원가 미등록 상품', unitCost: null }, { itemId: '456', name: '미판매 상품', unitCost: null }] });
  await s.sync({ since: date, until: date, channel: 'growth' });
  const { scopeKey, revision } = s.workspace();
  s.updateProduct({ scopeKey, revision, itemId: '123', unitCost: null, commissionRate: null, inboundFee: null, deliveryFee: null, costSince: null });
  let r = s.analytics(query);
  assert.equal(r.summary.estimatedProfitBeforeAds, null); assert.equal(r.summary.estimatedProductCost, null);
  assert.deepEqual(new Set(r.summary.missingInputs), new Set(['unitCost', 'commissionRate', 'inboundFee', 'deliveryFee']));
  assert.ok(r.summary.missingInputReasons.includes('개당 원가 미등록'));
  const unsold = r.items.find(item => item.itemId === '456');
  assert.equal(unsold.estimatedProfitBeforeAds, 0); assert.equal(unsold.estimatedProductCost, 0); assert.equal(unsold.estimatedCommission, 0); assert.equal(unsold.estimatedFulfillment, 0); assert.deepEqual(unsold.missingInputs, []);
  const token = s.workspace();
  s.updateProduct({ scopeKey: token.scopeKey, revision: token.revision, itemId: '123', unitCost: 0, commissionRate: 0, inboundFee: 0, deliveryFee: 0, costSince: null });
  r = s.analytics(query); assert.equal(r.summary.estimatedProfitBeforeAds, 20000); assert.deepEqual(r.summary.missingInputs, []);
});
test('cost effective date blocks historical estimates and absent snapshots remain unknown rather than zero', async t => {
  const { s, query } = setup(t, [product({ costSince: '2026-10-26' })]);
  await s.sync({ since: date, until: date, channel: 'growth' });
  const r = s.analytics(query);
  assert.equal(r.summary.estimatedProductCost, null); assert.equal(r.summary.estimatedCommission, 2000); assert.equal(r.summary.estimatedProfitBeforeAds, null);
  assert.deepEqual(r.summary.missingInputs, ['costSince']);
  const missing = s.analytics({ ...query, since: '2026-10-24' });
  assert.equal(missing.summary.estimatedProfitBeforeAds, null); assert.ok(missing.summary.missingInputs.includes('orders'));
  assert.equal(missing.storage.storedDays, 1); assert.equal(missing.storage.expectedDays, 2);
  assert.equal(missing.daily[0].estimatedProductCost, null);
});
test('saved reviewed ledger and original Sellha profit retain precedence over independent catalogue estimates', async t => {
  const { s, query } = setup(t);
  await s.sync({ since: date, until: date, channel: 'growth' });
  const saved = s.report(query), day = saved.daily.find(r => r.channel === 'growth');
  s.saveLedger({ date, channel: 'growth', scopeKey: saved.scopeKey, basis: day.basis, reviewed: true,
    ...Object.fromEntries(COSTS.map(key => [key, 0])), netSales: 19000, productCost: 5000, advertising: 1000 });
  let r = s.analytics(query);
  assert.equal(r.summary.sourceNetProfit, 13000); assert.equal(r.summary.netProfit, 13000); assert.equal(r.summary.estimatedProfitBeforeAds, 11400);
  s.importSales({ date, rows: [{ itemId: '123', productId: '7000', channel: 'growth', name: '예시 상품', quantity: -1, sales: -10000, profitBeforeAds: -4321, advertising: 123, adQuantity: 0, organicQuantity: -1, adSales: 0, adProfitBeforeAds: 0 }], acquisitionAdvertising: { growth: 0 } });
  r = s.analytics(query);
  assert.equal(r.summary.profitBeforeAds, -4321); assert.equal(r.summary.sourceNetProfit, -4444); assert.equal(r.summary.netProfit, -4444);
  assert.equal(r.summary.estimatedProfitBeforeAds, -5700); assert.equal(r.summary.estimateSource, 'sellha');
  assert.equal(r.items[0].quantity, -1);
});
