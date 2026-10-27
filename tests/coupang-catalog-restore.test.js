'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createService } = require('../integrations/coupang/service.cjs');
const credentials = { vendorId: 'A00012345', accessKey: 'test-access-key', secretKey: 'test-secret-key' };
const protect = (mode, value) => mode === 'encrypt' ? Buffer.from(value).toString('base64') : Buffer.from(value, 'base64').toString();
const date = '2026-10-25';
const product = (extra = {}) => ({ itemId: '123', productId: '7000', name: '예시 상품', channel: 'growth', unitCost: 0, commissionRate: 10, inboundFee: 0, deliveryFee: 0, costSince: '2026-10-01', ...extra });
const row = (extra = {}) => ({ itemId: '123', productId: '7000', name: '예시 상품', channel: 'growth', quantity: 1, sales: 5, profitBeforeAds: 5, advertising: 1, adQuantity: 1, organicQuantity: 0, adSales: 5, adProfitBeforeAds: 5, ...extra });
function setup(t, orders = []) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coupang-catalog-restore-'));
  t.after(() => fs.rmSync(baseDir, { recursive: true, force: true }));
  const service = () => createService({ baseDir, protect, now: () => Date.parse('2026-10-27T05:00:00Z'), sleep: async () => {}, fetchImpl: async () => ({ ok: true, json: async () => ({ code: 200, data: orders }) }) });
  const s = service(); s.saveCredentials(credentials);
  return { s, service, root: path.join(baseDir, '.roas-data/coupang', credentials.vendorId), query: { since: date, until: date, channel: 'growth', view: 'sales' } };
}
test('source catalogue zero remains explicit with a notice while unrelated legacy null and manual clears remain unknown', t => {
  const { s, service, query } = setup(t);
  s.saveScope({ products: [{ itemId: '999', name: '기존 원가 미등록', unitCost: null }] });
  const imported = s.importCatalog({ products: [product()] });
  assert.equal(imported.sourceZeroCost, 1); assert.equal(imported.missingCost, 0);
  let selected = s.status().products;
  assert.equal(selected.find(p => p.itemId === '123').unitCost, 0); assert.equal(selected.find(p => p.itemId === '123').productCostSourceZero, true);
  assert.equal(selected.find(p => p.itemId === '999').unitCost, null, 'reimport must not migrate other ambiguous nulls');
  s.importSalesBatch({ includeProducts: true, reports: [{ date, rows: [row()] }] });
  let r = service().analytics(query);
  assert.equal(r.summary.estimatedProductCost, 0); assert.equal(r.summary.estimatedProfitBeforeAds, 5);
  assert.deepEqual(r.summary.zeroCostItemIds, ['123']); assert.ok(r.summary.costWarnings[0].includes('실제 원가'));
  assert.equal(r.summary.sourceNetProfit, 4, 'source result remains authoritative');
  const token = s.workspace();
  s.updateProduct({ scopeKey: token.scopeKey, revision: token.revision, itemId: '123', unitCost: null, commissionRate: 10, inboundFee: 0, deliveryFee: 0, costSince: '2026-10-01' });
  r = service().analytics(query);
  assert.equal(r.summary.estimatedProductCost, null); assert.equal(r.summary.estimatedProfitBeforeAds, null); assert.deepEqual(r.summary.zeroCostItemIds, []);
  assert.equal(s.status().products.find(p => p.itemId === '123').productCostSourceZero, false);
});
test('optional batch catalogue restores chosen settings atomically, preserves unrelated options, and survives restart', t => {
  const { s, service, query } = setup(t);
  s.importCatalog({ products: [product({ unitCost: 99 }), product({ itemId: '999', name: '유지할 상품', unitCost: 4321 })] });
  const result = s.importSalesBatch({ includeProducts: true, products: [product()], reports: [{ date, rows: [row()] }] });
  assert.equal(result.catalogImported, 1); assert.equal(result.catalogZeroCosts, 1); assert.equal(result.catalogMissingCost, 0);
  const restored = service();
  assert.equal(restored.status().products.find(p => p.itemId === '123').unitCost, 0);
  assert.equal(restored.status().products.find(p => p.itemId === '999').unitCost, 4321);
  assert.equal(restored.analytics(query).summary.estimatedProfitBeforeAds, 5);
});
test('invalid catalogue or later daily report cannot partly replace costs or saved source data', t => {
  const { s, root } = setup(t);
  s.importSalesBatch({ includeProducts: true, products: [product()], reports: [{ date, rows: [row()] }] });
  const scopeFile = path.join(root, 'scope.json'), salesFile = path.join(root, 'sales', date + '.json');
  const originalScope = fs.readFileSync(scopeFile, 'utf8'), originalSales = fs.readFileSync(salesFile, 'utf8');
  const rejected = [
    { products: [product({ commissionRate: 101 })], reports: [{ date, rows: [row({ sales: 999 })] }] },
    { products: [product({ unitCost: 8 })], reports: [{ date, rows: [row({ sales: 999 })] }, { date: '2026-10-26', rows: [row({ advertising: -1 })] }] },
    { products: [product(), product()], reports: [{ date, rows: [row()] }] },
    { products: [product()], reports: [{ date, rows: [row()] }], includeProducts: false }
  ];
  for (const payload of rejected) {
    assert.throws(() => s.importSalesBatch({ includeProducts: true, ...payload }), { status: 400 });
    assert.equal(fs.readFileSync(scopeFile, 'utf8'), originalScope); assert.equal(fs.readFileSync(salesFile, 'utf8'), originalSales);
  }
});
test('API estimates round once per option/day after split shipments, then sum rounded option results', async t => {
  const raw = (orderId, itemId) => ({ vendorId: credentials.vendorId, orderId, paidAt: Date.parse(date + 'T12:00:00+09:00'), orderItems: [{ vendorItemId: itemId, productName: '예시 상품', salesQuantity: 1, unitSalesPrice: 5, currency: 'KRW' }] });
  const { s, query } = setup(t, [raw(100, 123), raw(101, 123), raw(102, 456)]);
  s.importCatalog({ products: [product(), product({ itemId: '456' })] });
  await s.sync({ since: date, until: date, channel: 'growth' });
  const analytics = s.analytics(query), report = s.report(query);
  assert.equal(analytics.items.find(p => p.itemId === '123').estimatedProfitBeforeAds, 9, 'two 4.5 shipments become one option profit of 9, not 10');
  assert.equal(analytics.items.find(p => p.itemId === '456').estimatedProfitBeforeAds, 5);
  assert.equal(analytics.summary.estimatedProfitBeforeAds, 14); assert.equal(report.summaries.growth.estimatedProfitBeforeAds, 14);
  assert.equal(report.daily.find(p => p.channel === 'growth').estimatedProfitBeforeAds, analytics.summary.estimatedProfitBeforeAds);
  assert.deepEqual(new Set(analytics.summary.zeroCostItemIds), new Set(['123', '456']));
});
test('source-day estimates retain per-day rounding across a period and warn only on sold source-zero rows', t => {
  const { s } = setup(t);
  s.importSalesBatch({ includeProducts: true, products: [product(), product({ itemId: '456' })], reports: [
    { date, rows: [row(), row({ itemId: '456', quantity: 0, sales: 0, profitBeforeAds: 0, advertising: 0 })] },
    { date: '2026-10-26', rows: [row(), row({ itemId: '456', quantity: 0, sales: 0, profitBeforeAds: 0, advertising: 0 })] }
  ] });
  const r = s.analytics({ since: date, until: '2026-10-26', channel: 'growth', view: 'sales' });
  assert.equal(r.summary.estimatedProfitBeforeAds, 10, 'two rounded daily profits of 5 are not re-rounded as a period profit of 9');
  assert.deepEqual(r.summary.zeroCostItemIds, ['123']); assert.deepEqual(r.items.find(p => p.itemId === '456').zeroCostItemIds, []);
});
