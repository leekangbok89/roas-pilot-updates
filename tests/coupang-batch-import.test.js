'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createService } = require('../integrations/coupang/service.cjs');
const credentials = { vendorId: 'A00012345', accessKey: 'test-access-key', secretKey: 'test-secret-key' };
const protect = (mode, value) => mode === 'encrypt' ? Buffer.from(value).toString('base64') : Buffer.from(value, 'base64').toString();
const row = (overrides = {}) => ({ productId: '100', itemId: '123', channel: 'growth', name: '예시 상품', optionName: '새 상품',
  quantity: 5, adQuantity: 2, organicQuantity: 3, sales: 10000, profitBeforeAds: 4000, advertising: 1000,
  adSales: 4000, adProfitBeforeAds: 1600, ...overrides });
const report = (date = '2026-10-24', rows = [row()]) => ({ date, rows });
function setup(t) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coupang-batch-'));
  t.after(() => fs.rmSync(baseDir, { recursive: true, force: true }));
  const service = () => createService({ baseDir, protect, now: () => Date.parse('2026-10-27T05:00:00Z') });
  const s = service(); s.saveCredentials(credentials);
  return { s, service, baseDir, query: { since: '2026-10-24', until: '2026-10-25', view: 'sales' } };
}
test('batch inclusion seeds an empty scope and retains signed refunds, zero-sales advertising and every result metric', t => {
  const { s, query } = setup(t);
  const reports = [
    report('2026-10-24', [row(), row({ itemId: '456', channel: 'seller', quantity: -1, adQuantity: 0, organicQuantity: -1, sales: -3000, profitBeforeAds: -1000, advertising: 0, adSales: 0, adProfitBeforeAds: 0 })]),
    report('2026-10-25', [row({ quantity: 0, adQuantity: 1, organicQuantity: -1, sales: 0, profitBeforeAds: 0, advertising: 500, adSales: 2000, adProfitBeforeAds: 801 }),
      row({ itemId: '456', channel: 'seller', quantity: 0, adQuantity: 0, organicQuantity: 0, sales: 0, profitBeforeAds: 0, advertising: 0, adSales: 0, adProfitBeforeAds: 0 })])
  ];
  const result = s.importSalesBatch({ schema: 'roas-coupang-sales-v1', reports, includeProducts: true });
  assert.equal(result.days, 2); assert.equal(result.imported, 4); assert.equal(result.addedProducts, 2); assert.equal(result.excluded, 0);
  const r = s.analytics(query);
  assert.equal(r.summary.sales, 7000); assert.equal(r.summary.quantity, 4); assert.equal(r.summary.adQuantity, 3); assert.equal(r.summary.organicQuantity, 1);
  assert.equal(r.summary.profitBeforeAds, 3000); assert.equal(r.summary.advertising, 1500); assert.equal(r.summary.sourceNetProfit, 1500);
  assert.equal(r.summary.nonAdvertisingCosts, 4000); assert.equal(r.summary.adReturnOnSpend, 901 / 1500 * 100);
  assert.equal(r.items.find(p => p.itemId === '123').adReturnOnSpend, 901 / 1500 * 100);
  assert.equal(r.summary.adSales, 6000); assert.equal(r.summary.adProfitBeforeAds, 2401); assert.equal(r.summary.adNetProfit, 901); assert.equal(r.summary.roas, 400);
  assert.equal(r.daily[0].adReturnOnSpend, 60); assert.equal(r.daily[0].channels.find(c => c.channel === 'seller').adReturnOnSpend, null);
  assert.equal(r.daily[0].adNetProfit, 600); assert.equal(r.daily[1].adNetProfit, 301);
  assert.equal(r.summary.netProfit, null, 'unknown acquisition advertising cannot become zero');
  assert.equal(r.summary.otherCosts, null, 'a combined profit figure does not identify individual costs');
});
test('all batch input validates before changing scope or existing date files', t => {
  const { s, baseDir } = setup(t);
  s.importSalesBatch({ reports: [report()], includeProducts: true });
  const root = path.join(baseDir, '.roas-data/coupang', credentials.vendorId);
  const previousScope = fs.readFileSync(path.join(root, 'scope.json'), 'utf8');
  const previousDate = fs.readFileSync(path.join(root, 'sales/2026-10-24.json'), 'utf8');
  assert.throws(() => s.importSalesBatch({ reports: [report('2026-10-24', [row({ itemId: '789', sales: 99999 })]), report('2026-10-25', [row({ advertising: -1 })])], includeProducts: true }), { status: 400 });
  assert.equal(fs.readFileSync(path.join(root, 'scope.json'), 'utf8'), previousScope);
  assert.equal(fs.readFileSync(path.join(root, 'sales/2026-10-24.json'), 'utf8'), previousDate);
  assert.equal(fs.existsSync(path.join(root, 'sales/2026-10-25.json')), false);
});
test('batch merging preserves catalog costs and same-date replacement survives restart without double counting', t => {
  const { s, service, query } = setup(t);
  s.importCatalog({ products: [{ itemId: '123', name: '원래 상품', unitCost: 2500, commissionRate: 12, inboundFee: 50, deliveryFee: 100, costSince: '2026-01-01' }] });
  const input = { includeProducts: true, reports: [report('2026-10-24'), report('2026-10-25')] };
  s.importSalesBatch(input);
  assert.ok(s.importSalesBatch(input).reports.every(r => r.replaced));
  const restored = service();
  const p = restored.status().products[0];
  assert.equal(p.unitCost, 2500); assert.equal(p.commissionRate, 12); assert.equal(p.inboundFee, 50); assert.equal(p.deliveryFee, 100); assert.equal(p.costSince, '2026-01-01');
  assert.equal(p.productId, '100'); assert.equal(p.productName, '예시 상품'); assert.equal(p.channel, 'growth');
  assert.equal(restored.analytics(query).summary.sales, 20000);
  assert.equal(restored.analytics(query).summary.sourceNetProfit, 6000);
});
test('batch acquisition confirmations are scoped after inclusion and subtract once at day/channel level', t => {
  const { s, query } = setup(t);
  s.importSalesBatch({ includeProducts: true, reports: [{ ...report(), acquisitionAdvertising: { growth: 500, seller: 0 } }] });
  const r = s.analytics({ ...query, until: query.since });
  assert.equal(r.summary.sourceNetProfit, 3000); assert.equal(r.summary.acquisitionAdvertising, 500); assert.equal(r.summary.netProfit, 2500);
  assert.equal(r.items[0].netProfit, null, 'channel-level spend must not be allocated to options');
});
test('batch limits reject duplicate dates, invalid schema, unselected scope and more than 500 merged options', t => {
  const { s } = setup(t);
  assert.throws(() => s.importSalesBatch({ reports: [report(), report()], includeProducts: true }), { status: 400 });
  assert.throws(() => s.importSalesBatch({ reports: [report()], schema: 'unknown', includeProducts: true }), { status: 400 });
  assert.throws(() => s.importSalesBatch({ reports: [report()] }), { status: 409 });
  assert.throws(() => s.importSalesBatch({ reports: [report('2026-10-24', Array.from({ length: 501 }, (_, i) => row({ itemId: String(i + 1) })))], includeProducts: true }), { status: 400 });
  assert.deepEqual(s.status().products, []);
});
test('explicit file snapshots retain historical totals when unrelated existing or future products are selected', t => {
  const { s, service, query } = setup(t);
  s.saveScope({ products: [{ itemId: '999', name: '다른 시기에 판매한 상품', unitCost: 200 }] });
  s.importSalesBatch({ includeProducts: true, reports: [{ ...report(), acquisitionAdvertising: { growth: 200, seller: 0 } }] });
  let r = s.analytics({ ...query, until: query.since });
  assert.equal(r.summary.sales, 10000); assert.equal(r.summary.profitBeforeAds, 4000); assert.equal(r.summary.advertising, 1000); assert.equal(r.summary.netProfit, 2800);
  assert.deepEqual(r.daily[0].sourceScope, { mode: 'file', fileProducts: 1, selectedFileProducts: 1, outsideFileProducts: 1 });
  assert.equal(r.items.length, 1, 'options outside the file snapshot are neither zero rows nor missing-value blockers');
  s.importSalesBatch({ includeProducts: true, reports: [report('2026-10-25', [row({ itemId: '456', channel: 'seller' })])] });
  r = service().analytics({ ...query, until: query.since });
  assert.equal(r.summary.sales, 10000); assert.equal(r.summary.sourceNetProfit, 3000); assert.equal(r.summary.netProfit, 2800);
  assert.equal(r.coverage.fileScopeDays, 1); assert.equal(r.daily[0].sourceScope.outsideFileProducts, 2);
});
test('narrowing a file snapshot invalidates channel-wide acquisition costs while adding outside options does not', t => {
  const { s, query } = setup(t);
  s.importSalesBatch({ includeProducts: true, reports: [{ ...report('2026-10-24', [row(), row({ itemId: '456' })]), acquisitionAdvertising: { growth: 100, seller: 0 } }] });
  s.saveScope({ products: [{ itemId: '123', name: '예시 상품', unitCost: null }] });
  let r = s.analytics({ ...query, until: query.since });
  assert.equal(r.summary.sales, 10000); assert.equal(r.summary.sourceNetProfit, 3000); assert.equal(r.summary.netProfit, null); assert.equal(r.summary.acquisitionAdvertising, null);
  assert.equal(r.daily[0].sourceScope.selectedFileProducts, 1);
  s.saveScope({ products: [{ itemId: '999', name: '파일 밖 상품만 선택', unitCost: null }] });
  r = s.analytics({ ...query, until: query.since });
  assert.equal(r.summary.netProfit, null, 'removing every file option must not turn unallocated acquisition spend into zero');
});
test('single and non-including batch imports cannot forge authoritative file scope', t => {
  const { s, query } = setup(t);
  s.saveScope({ products: [{ itemId: '123', name: '예시 상품', unitCost: null }, { itemId: '999', name: '기타 상품', unitCost: null }] });
  const forged = { ...report(), scopeMode: 'file', reportItemIds: ['123'] };
  s.importSales(forged);
  assert.equal(s.analytics({ ...query, until: query.since }).summary.profitBeforeAds, null);
  s.importSalesBatch({ includeProducts: false, reports: [forged] });
  const r = s.analytics({ ...query, until: query.since });
  assert.equal(r.summary.profitBeforeAds, null); assert.equal(r.daily[0].sourceScope.mode, 'selected');
});
