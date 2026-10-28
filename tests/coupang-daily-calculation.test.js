'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createService } = require('../integrations/coupang/service.cjs');
const credentials = { vendorId: 'A00012345', accessKey: 'test-access-key', secretKey: 'test-secret-key' };
const protect = (mode, value) => mode === 'encrypt' ? Buffer.from(value).toString('base64') : Buffer.from(value, 'base64').toString();
const days = ['2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26'];
const keys = ['sales', 'profitBeforeAds', 'advertising', 'otherCosts', 'sourceNetProfit'];
const product = (extra = {}) => ({ itemId: '123', productId: '7000', name: '합성 검증 상품', channel: 'growth', unitCost: 3000, commissionRate: 11, inboundFee: 11, deliveryFee: 17, costSince: '2026-10-01', ...extra });
const row = (extra = {}) => ({ itemId: '123', productId: '7000', channel: 'growth', name: '합성 검증 상품', quantity: 2, sales: 10003, profitBeforeAds: 5001, advertising: 101, ...extra });
function setup(t, selected = [product()]) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coupang-daily-calculation-'));
  t.after(() => fs.rmSync(baseDir, { recursive: true, force: true }));
  let clock = Date.parse('2026-10-27T05:00:00Z'), calls = 0;
  const orders = new Map();
  const service = () => createService({ baseDir, protect, now: () => clock, sleep: async () => {}, fetchImpl: async url => {
    calls++;
    const u = new URL(url), data = u.pathname.endsWith('/rg/orders') ? [...orders].filter(([date]) => date.replaceAll('-', '') >= u.searchParams.get('paidDateFrom') && date.replaceAll('-', '') <= u.searchParams.get('paidDateTo')).map(([date, value]) => ({
      vendorId: credentials.vendorId, orderId: Number(date.replaceAll('-', '')), paidAt: Date.parse(date + 'T12:00:00+09:00'),
      orderItems: [{ vendorItemId: 123, productName: value.name || '합성 API 상품', salesQuantity: value.quantity, unitSalesPrice: value.price, currency: 'KRW' }]
    })) : [];
    return { ok: true, json: async () => ({ code: 200, data }) };
  } });
  const s = service(); s.saveCredentials(credentials); s.importCatalog({ products: selected });
  return { s, service, orders, root: path.join(baseDir, '.roas-data/coupang', credentials.vendorId), calls: () => calls, advance: ms => { clock += ms; }, query: { since: days[0], until: days.at(-1), channel: 'growth', view: 'dashboard' } };
}
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, actual + ' differs from ' + expected);
test('canonical five-day report keeps exact original profit and signed refunds while independently calculating other costs', t => {
  const { s, service, query } = setup(t);
  const inputs = [row(), row({ quantity: 1, sales: 9007, profitBeforeAds: 4003, advertising: 103 }),
    row({ quantity: -1, sales: -7001, profitBeforeAds: -3001, advertising: 0 }),
    row({ quantity: 3, sales: 15011, profitBeforeAds: 8009, advertising: 211 }),
    row({ quantity: 0, sales: 0, profitBeforeAds: 0, advertising: 19 })];
  s.importSalesBatch({ reports: inputs.map((input, i) => ({ date: days[i], rows: [input] })), includeProducts: true });
  const r = service().analytics(query), expected = Object.fromEntries(keys.map(key => [key, 0]));
  r.daily.forEach((day, i) => {
    const actual = day.dailyReport, input = inputs[i];
    assert.ok(actual, 'dailyReport must own the displayed daily calculation');
    assert.equal(actual.sales, input.sales); assert.equal(actual.profitBeforeAds, input.profitBeforeAds); assert.equal(actual.advertising, input.advertising);
    assert.equal(actual.sourceNetProfit, input.profitBeforeAds - input.advertising);
    const productCost = input.quantity * 3000, commission = input.sales * 11 / 100, fulfillment = input.quantity * 28;
    const otherCosts = Math.round(commission + fulfillment), estimatedProfit = Math.round(input.sales - productCost - commission - fulfillment);
    assert.equal(actual.otherCosts, otherCosts);
    assert.equal(actual.components.productCost, productCost); close(actual.components.commission, commission); close(actual.components.fulfillment, fulfillment); close(actual.components.otherCostsRaw, commission + fulfillment);
    assert.equal(actual.components.estimatedProfitBeforeAds, estimatedProfit);
    assert.equal(actual.differences.profitBeforeAds, estimatedProfit - input.profitBeforeAds);
    assert.equal(actual.differences.otherCosts, null, 'a residual sourceOtherCosts figure is not an explicit actual other-cost input');
    assert.equal(actual.estimated.profitBeforeAds, false); assert.equal(actual.estimated.otherCosts, true); assert.equal(actual.estimated.sourceNetProfit, false);
    assert.equal(actual.estimated.sales, false); assert.equal(actual.estimated.advertising, false);
    assert.deepEqual(actual.missing, ['acquisitionAdvertising', 'netProfit']); assert.ok(actual.source); assert.ok(actual.basis); assert.ok(Array.isArray(actual.reasons));
    for (const key of keys) expected[key] += actual[key];
  });
  const summary = r.dailyReportSummary;
  for (const key of keys) { assert.equal(summary[key], expected[key]); assert.equal(summary.available[key], expected[key]); assert.equal(summary.knownDays[key], 5); assert.equal(summary.partial[key], false); }
  assert.equal(summary.totalDays, 5); assert.equal(summary.estimated.otherCosts, true); assert.equal(summary.estimated.profitBeforeAds, false);
  assert.equal(r.daily[2].dailyReport.sourceNetProfit, -3001, 'refund profit remains signed');
  assert.equal(r.daily[4].dailyReport.sourceNetProfit, -19, 'zero-sales ad spend is still deducted');
});
test('canonical other costs round each day before a period sum rather than rounding the aggregate once', t => {
  const { s, query } = setup(t, [product({ unitCost: 0, commissionRate: 15, inboundFee: 0, deliveryFee: 0 })]);
  s.importSalesBatch({ reports: days.slice(0, 2).map(date => ({ date, rows: [row({ quantity: 1, sales: 11, profitBeforeAds: 8, advertising: 1 })] })), includeProducts: true });
  const r = s.analytics({ ...query, until: days[1] });
  assert.deepEqual(r.daily.map(day => day.dailyReport.otherCosts), [2, 2]);
  assert.equal(r.dailyReportSummary.otherCosts, 4); assert.equal(Math.round(r.summary.estimatedOtherCosts), 3);
  assert.equal(r.dailyReportSummary.profitBeforeAds, 16); assert.equal(r.dailyReportSummary.sourceNetProfit, 14);
});
test('future API days compute reusable profit estimates, keep unknown advertising/net unknown and recalculate from saved settings without network', async t => {
  const { s, service, orders, calls } = setup(t, [product({ commissionRate: 10, inboundFee: 100, deliveryFee: 200 })]);
  s.importSalesBatch({ reports: [{ date: days[3], rows: [row({ sales: 10000, profitBeforeAds: 5000, advertising: 100 })] }], includeProducts: true });
  orders.set(days[4], { quantity: 2, price: 10000 });
  await s.sync({ since: days[4], until: days[4], channel: 'growth' });
  const query = { since: days[3], until: days[4], channel: 'growth' };
  let r = s.analytics(query), future = r.daily[1].dailyReport;
  assert.equal(future.sales, 20000); assert.equal(future.profitBeforeAds, 11400); assert.equal(future.otherCosts, 2600);
  assert.equal(future.advertising, null); assert.equal(future.sourceNetProfit, null); assert.equal(future.apiUnconfirmed, true);
  assert.equal(future.estimated.profitBeforeAds, true); assert.equal(future.estimated.otherCosts, true);
  assert.ok(future.missing.includes('advertising')); assert.ok(future.missing.includes('sourceNetProfit'));
  assert.equal(r.dailyReportSummary.sourceNetProfit, null); assert.equal(r.dailyReportSummary.available.sourceNetProfit, 4900);
  assert.equal(r.dailyReportSummary.knownDays.sourceNetProfit, 1); assert.equal(r.dailyReportSummary.partial.sourceNetProfit, true);
  assert.equal(r.dailyReportSummary.profitBeforeAds, 16400); assert.equal(r.dailyReportSummary.estimated.profitBeforeAds, true);
  const beforeCalls = calls(), current = s.workspace();
  s.updateProduct({ scopeKey: current.scopeKey, revision: current.revision, itemId: '123', unitCost: 4000, commissionRate: 10, inboundFee: 100, deliveryFee: 200, costSince: '2026-10-01' });
  r = service().analytics(query);
  assert.equal(r.daily[1].dailyReport.profitBeforeAds, 9400); assert.equal(r.daily[0].dailyReport.profitBeforeAds, 5000);
  assert.equal(r.daily[1].dailyReport.sourceNetProfit, null); assert.equal(calls(), beforeCalls);
});
test('API-bound daily confirmation survives timestamp/display-name refresh but becomes stale when financial order rows change', async t => {
  const { s, orders, root, advance } = setup(t);
  const date = days[4], query = { since: date, until: date, channel: 'all' };
  orders.set(date, { quantity: 2, price: 10000 });
  await s.sync({ since: date, until: date, channel: 'growth' }); await s.sync({ since: date, until: date, channel: 'seller' });
  const actual = { date, sales: 19001, profitBeforeAds: 10007, advertising: 503, otherCosts: 2999 };
  s.importSalesBatch({ reports: [], dailyTotals: [actual] });
  const stored = JSON.parse(fs.readFileSync(path.join(root, 'daily-totals', date + '.json'), 'utf8'));
  assert.ok(stored.ordersBasis, 'a no-file daily confirmation must bind to the selected saved API financial rows');
  let day = s.analytics(query).daily[0];
  assert.equal(day.dailyTotalsApplied, true); assert.equal(day.dailyReport.otherCosts, 2999); assert.equal(day.dailyReport.estimated.otherCosts, false);
  assert.equal(day.dailyReport.components.otherCostsRaw, day.estimatedOtherCosts, 'registered cost detail must retain its own raw amount rather than the confirmed daily override');
  assert.equal(day.dailyReport.differences.otherCosts, Math.round(day.estimatedOtherCosts) - 2999);
  advance(1000); await s.sync({ since: date, until: date, channel: 'growth' });
  assert.equal(s.analytics(query).daily[0].dailyTotalsApplied, true, 'fetchedAt alone is not a financial source change');
  orders.set(date, { quantity: 2, price: 10000, name: '표시 이름만 변경' }); advance(1000);
  await s.sync({ since: date, until: date, channel: 'growth' });
  assert.equal(s.analytics(query).daily[0].dailyTotalsApplied, true, 'presentation names are excluded from the financial binding');
  orders.set(date, { quantity: 3, price: 10000, name: '표시 이름만 변경' }); advance(1000);
  await s.sync({ since: date, until: date, channel: 'growth' });
  day = s.analytics(query).daily[0];
  assert.notEqual(day.dailyTotalsApplied, true); assert.equal(day.dailyTotalsStatus.applied, false); assert.equal(day.dailyTotalsStatus.state, 'stale-orders'); assert.equal(day.dailyReport.sales, 30000);
  assert.equal(day.dailyReport.advertising, null); assert.equal(day.dailyReport.sourceNetProfit, null);
});
test('source-file replacement invalidates its confirmation while legacy unbound references remain explicitly marked', t => {
  const { s, root } = setup(t);
  const date = days[0], query = { since: date, until: date, channel: 'all' };
  const actual = { date, sales: 9997, profitBeforeAds: 6001, advertising: 333, otherCosts: 1999 };
  s.importSalesBatch({ reports: [{ date, rows: [row()] }], dailyTotals: [actual], includeProducts: true });
  s.importSales({ date, rows: [row({ sales: 12001 })] });
  let day = s.analytics(query).daily[0];
  assert.notEqual(day.dailyTotalsApplied, true); assert.equal(day.dailyTotalsStatus.applied, false); assert.equal(day.dailyTotalsStatus.state, 'stale-source');
  const legacyDate = days[1];
  s.importSalesBatch({ reports: [], dailyTotals: [{ ...actual, date: legacyDate }] });
  const file = path.join(root, 'daily-totals', legacyDate + '.json'), legacy = JSON.parse(fs.readFileSync(file, 'utf8'));
  delete legacy.ordersBasis; delete legacy.basisType; legacy.salesBasis = null; fs.writeFileSync(file, JSON.stringify(legacy));
  day = s.analytics({ since: legacyDate, until: legacyDate, channel: 'all' }).daily[0];
  assert.equal(day.dailyTotalsStatus.state, 'legacy-unbound'); assert.equal(day.dailyTotalsApplied, true);
  assert.equal(day.dailyReport.sales, actual.sales); assert.equal(day.dailyReport.profitBeforeAds, actual.profitBeforeAds);
});
test('a partially collected all-channel day exposes known sales without presenting an unknown channel as zero', async t => {
  const { s, orders } = setup(t);
  const date = days[4]; orders.set(date, { quantity: 2, price: 10000 });
  await s.sync({ since: date, until: date, channel: 'growth' });
  const r = s.analytics({ since: date, until: date, channel: 'all' }), day = r.daily[0];
  assert.equal(day.sales, null); assert.equal(day.available.sales, 20000);
  assert.equal(day.dailyReport.sales, 20000); assert.equal(day.dailyReport.partial.sales, true);
  assert.equal(day.dailyReport.profitBeforeAds, null); assert.equal(day.dailyReport.otherCosts, null);
  assert.equal(day.dailyReport.components.productCost, null); assert.equal(day.dailyReport.components.estimatedProfitBeforeAds, null);
  const summary = r.dailyReportSummary;
  assert.equal(summary.sales, null); assert.equal(summary.available.sales, 20000);
  assert.equal(summary.knownDays.sales, 0); assert.equal(summary.availableDays.sales, 1); assert.equal(summary.partialDays.sales, 1); assert.equal(summary.partial.sales, true);
  assert.equal(summary.profitBeforeAds, null); assert.equal(summary.otherCosts, null); assert.equal(summary.sourceNetProfit, null);
});
test('whole-day actual totals recompute acquisition-adjusted net without changing underlying channel or item net', t => {
  const { s } = setup(t);
  const date = days[0], original = row(), query = { since: date, until: date, channel: 'all' };
  const actual = { date, sales: 10007, profitBeforeAds: 5009, advertising: 103, otherCosts: 1999 };
  const save = acquisitionAdvertising => s.importSalesBatch({ includeProducts: true,
    reports: [{ date, rows: [original], acquisitionAdvertising }], dailyTotals: [actual] });
  save({ growth: 0, seller: 0 });
  let r = s.analytics(query), day = r.daily[0];
  assert.equal(day.sourceNetProfit, 4906); assert.equal(day.netProfit, 4906); assert.equal(day.complete, true);
  assert.equal(day.channels.find(part => part.channel === 'growth').sourceNetProfit, 4900);
  assert.equal(day.channels.find(part => part.channel === 'growth').netProfit, 4900); assert.equal(r.items[0].netProfit, 4900);
  save({ growth: 7, seller: 11 });
  r = s.analytics(query); day = r.daily[0];
  assert.equal(day.acquisitionAdvertising, 18); assert.equal(day.sourceNetProfit, 4906); assert.equal(day.netProfit, 4888); assert.equal(day.complete, true);
  assert.equal(day.channels.find(part => part.channel === 'growth').netProfit, 4893);
  assert.equal(day.channels.find(part => part.channel === 'seller').netProfit, -11); assert.equal(r.items[0].netProfit, null);
  save({ growth: null, seller: 0 });
  day = s.analytics(query).daily[0];
  assert.equal(day.sourceNetProfit, 4906); assert.equal(day.netProfit, null); assert.equal(day.complete, false);
});
