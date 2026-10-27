'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createService } = require('../integrations/coupang/service.cjs');
const now = Date.parse('2026-10-27T05:00:00Z'), date = '2026-10-26';
const credentials = { vendorId: 'A00012345', accessKey: 'test-access-key', secretKey: 'test-secret-key' };
const protect = (mode, value) => mode === 'encrypt' ? Buffer.from(value).toString('base64') : Buffer.from(value, 'base64').toString();
const product = { itemId: '123', productId: '7000', name: '예시 상품', unitCost: 3000, commissionRate: 10, inboundFee: 100, deliveryFee: 200, channel: 'growth' };
const row = { itemId: '123', productId: '7000', name: '예시 상품', channel: 'growth', quantity: 2, sales: 20000, profitBeforeAds: 11400, advertising: 1000 };
const daily = { date, sales: 19999, profitBeforeAds: 11401, advertising: 999, otherCosts: 2598 };
function setup(t) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coupang-daily-totals-'));
  t.after(() => fs.rmSync(baseDir, { recursive: true, force: true }));
  const service = () => createService({ baseDir, protect, now: () => now, sleep: async () => {}, fetchImpl: async () => ({ ok: true, json: async () => ({ code: 200, data: [] }) }) });
  const s = service(); s.saveCredentials(credentials); s.importCatalog({ products: [product] });
  return { s, service, baseDir, query: { since: date, until: date, channel: 'all' } };
}
test('saved whole-day reconciliation supplies six-column totals and retains the original channel and option sources', t => {
  const { s, service, query } = setup(t);
  const result = s.importSalesBatch({ reports: [{ date, rows: [row] }], dailyTotals: [daily], includeProducts: true });
  assert.equal(result.days, 1); assert.deepEqual(result.dailyTotals, [{ date, saved: true }]);
  const r = service().analytics({ ...query, view: 'dashboard' }), day = r.daily[0];
  for (const key of ['sales', 'profitBeforeAds', 'advertising', 'otherCosts']) assert.equal(day[key], daily[key]);
  assert.equal(day.source, 'reconciled'); assert.equal(day.sourceNetProfit, 10402); assert.equal(day.nonAdvertisingCosts, 8598);
  assert.equal(day.sourceOtherCosts, 2598); assert.equal(day.dailyTotalsApplied, true); assert.equal(day.dailyTotals.basis, 'saved-daily-report');
  assert.equal(day.channels[0].sales, 20000); assert.equal(day.channels[0].profitBeforeAds, 11400);
  assert.equal(r.items[0].sales, 20000); assert.equal(r.items[0].sourceNetProfit, 10400);
  assert.equal(r.summary.sales, 19999); assert.equal(r.summary.sourceNetProfit, 10402);
  assert.equal(day.netProfit, null, 'reconciliation does not invent confirmed acquisition spend');
  assert.deepEqual(r.importedDates, [date]);
  assert.equal(service().analytics({ ...query, channel: 'growth' }).summary.sales, 20000);
});
test('summary-only import remains unknown at product and delivery level and does not erase missing dates', t => {
  const { s, query } = setup(t);
  const result = s.importSalesBatch({ reports: [], dailyTotals: [daily] });
  assert.equal(result.days, 1); assert.equal(result.imported, 0); assert.deepEqual(result.reports, []);
  let r = s.analytics(query);
  assert.equal(r.summary.sales, 19999); assert.equal(r.summary.sourceNetProfit, 10402);
  assert.ok(r.items.every(item => item.sales === null)); assert.ok(r.daily[0].channels.every(part => part.sales === null));
  r = s.analytics({ ...query, until: '2026-10-27' });
  assert.equal(r.summary.sourceNetProfit, null); assert.equal(r.daily[1].sales, null); assert.equal(r.daily[1].sourceNetProfit, null);
  assert.equal(r.daily[0].sourceNetProfit, 10402);
});
test('whole-day reconciliation is bound to the exact selected products and vendor', t => {
  const { s, query } = setup(t);
  s.importSalesBatch({ reports: [], dailyTotals: [daily] });
  s.saveScope({ products: [{ ...product, itemId: '456' }] });
  assert.equal(s.analytics(query).summary.sales, null);
  s.saveScope({ products: [{ ...product, unitCost: 5000 }] });
  assert.equal(s.analytics(query).summary.sales, 19999, 'cost edits do not change the selected product scope');
  s.saveScope({ products: [product, { ...product, itemId: '456' }] });
  assert.equal(s.analytics(query).summary.sales, null, 'adding a product invalidates whole-scope reconciliation');
  s.saveCredentials({ ...credentials, vendorId: 'A00054321' }); s.saveScope({ products: [product] });
  assert.equal(s.analytics(query).summary.sales, null);
});
test('replacing source files invalidates older daily confirmations while unchanged financial reimports keep them', t => {
  const { s, query } = setup(t);
  s.importSalesBatch({ reports: [], dailyTotals: [daily] });
  assert.equal(s.analytics(query).daily[0].source, 'reconciled');
  s.importSales({ date, rows: [row] });
  let r = s.analytics(query);
  assert.notEqual(r.daily[0].source, 'reconciled'); assert.equal(r.daily[0].channels[0].sales, 20000);
  s.importSalesBatch({ reports: [{ date, rows: [row] }], dailyTotals: [daily], includeProducts: true });
  assert.equal(s.analytics(query).daily[0].sales, 19999);
  s.importSalesBatch({ reports: [{ date, rows: [{ ...row, name: '표시명 수정' }] }], includeProducts: true });
  assert.equal(s.analytics(query).daily[0].source, 'reconciled', 'import timestamps and presentation names do not change financial basis');
  s.importSalesBatch({ reports: [{ date, rows: [{ ...row, sales: 30000 }] }], includeProducts: true });
  r = s.analytics(query);
  assert.notEqual(r.daily[0].source, 'reconciled'); assert.equal(r.summary.sales, 30000);
  s.importSalesBatch({ reports: [{ date, rows: [{ ...row, sales: 40000 }] }], dailyTotals: [daily], includeProducts: true });
  assert.equal(s.analytics(query).summary.sales, 19999, 'the confirmation in the replacement batch binds to its newly staged source');
});
test('daily summary validation is atomic, rejects fabricated net and retains signed refunds and explicit zeros', t => {
  const { s, baseDir, query } = setup(t);
  s.importSalesBatch({ reports: [], dailyTotals: [daily] });
  const file = path.join(baseDir, '.roas-data/coupang', credentials.vendorId, 'daily-totals', date + '.json'), saved = fs.readFileSync(file, 'utf8');
  for (const input of [
    { reports: [], dailyTotals: [daily, daily] },
    { reports: [{ date, rows: [row] }], dailyTotals: [{ ...daily, advertising: -1 }] },
    { reports: [], dailyTotals: [{ ...daily, sales: null }] },
    { reports: [], dailyTotals: [{ ...daily, date: '2026-10-28' }] },
    { reports: [], dailyTotals: 'bad' },
    { reports: [], dailyTotals: [] }
  ]) assert.throws(() => s.importSalesBatch(input), { status: 400 });
  assert.equal(fs.readFileSync(file, 'utf8'), saved);
  assert.equal(fs.existsSync(path.join(baseDir, '.roas-data/coupang', credentials.vendorId, 'sales', date + '.json')), false);
  s.importSalesBatch({ reports: [], dailyTotals: [{ ...daily, sales: -10000, profitBeforeAds: -4000, advertising: 0, otherCosts: -2000, sourceNetProfit: 999999 }] });
  assert.equal(s.analytics(query).summary.sourceNetProfit, -4000);
  s.importSalesBatch({ reports: [], dailyTotals: [{ date, sales: 0, profitBeforeAds: 0, advertising: 0, otherCosts: 0 }] });
  assert.equal(s.analytics(query).summary.sales, 0); assert.equal(s.analytics(query).summary.sourceNetProfit, 0);
});
test('source other costs split out registered product cost and API estimates expose commission plus fulfillment', async t => {
  const { s, query } = setup(t);
  s.importSales({ date, rows: [row] });
  let r = s.analytics({ ...query, channel: 'growth' });
  for (const values of [r.summary, r.daily[0], r.items[0]]) {
    assert.equal(values.sourceOtherCosts, 2600); assert.equal(values.estimatedOtherCosts, 2600);
  }
  const current = s.workspace();
  s.updateProduct({ scopeKey: current.scopeKey, revision: current.revision, itemId: '123', unitCost: null, commissionRate: 10, inboundFee: 100, deliveryFee: 200, costSince: null });
  r = s.analytics({ ...query, channel: 'growth' });
  assert.equal(r.summary.sourceOtherCosts, null); assert.equal(r.summary.estimatedOtherCosts, 2600);
  assert.equal(r.summary.profitBeforeAds, 11400); assert.equal(r.summary.sourceNetProfit, 10400);
  await s.sync({ since: '2026-10-25', until: '2026-10-25', channel: 'growth' });
  r = s.analytics({ since: '2026-10-25', until: '2026-10-25', channel: 'growth' });
  assert.equal(r.summary.estimatedOtherCosts, 0); assert.equal(r.summary.sourceOtherCosts, null);
});
