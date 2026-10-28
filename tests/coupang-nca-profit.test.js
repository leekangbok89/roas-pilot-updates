'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createService, COSTS } = require('../integrations/coupang/service.cjs');
const date = '2026-10-22', next = '2026-10-23', vendorId = 'A00012345';
const product = { itemId: '123', productId: '7000', name: '합성 상품', channel: 'growth', unitCost: 3000, commissionRate: 10, inboundFee: 100, deliveryFee: 200 };
const row = { itemId: '123', productId: '7000', name: '합성 상품', channel: 'growth', quantity: 2, sales: 20000, profitBeforeAds: 12000, advertising: 2000 };
const query = (extra = {}) => ({ since: date, until: date, channel: 'all', view: 'dashboard', ...extra });
function setup(t) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coupang-nca-profit-'));
  t.after(() => fs.rmSync(baseDir, { recursive: true, force: true }));
  const service = () => createService({ baseDir, protect: (mode, value) => value, now: () => Date.parse('2026-10-28T03:00:00Z'), sleep: async () => {}, fetchImpl: async url => ({ ok: true, json: async () => ({ code: 200, data: new URL(url).pathname.endsWith('/rg/orders') ? [{ vendorId, orderId: 70000001, paidAt: Date.parse(date + 'T12:00:00+09:00'), orderItems: [{ vendorItemId: 123, salesQuantity: 2, unitSalesPrice: 10000, currency: 'KRW' }] }] : [] }) }) });
  const s = service(); s.saveCredentials({ vendorId, accessKey: 'SYNTHETIC', secretKey: 'SYNTHETIC' }); s.importCatalog({ products: [product] });
  return { s, service, root: path.join(baseDir, '.roas-data/coupang', vendorId) };
}
function report(type, spend, reportDate = date) {
  const base = { date: reportDate, campaignId: '456', campaignName: '합성 캠페인', placement: '검색 영역', spend, impressions: 10, clicks: 1 };
  const fields = type === 'pa' ? { advertisedItemId: '123', convertedItemId: '123', keyword: '합성', orders1: 1, quantity1: 1, sales1: 5000, orders14: 1, quantity14: 1, sales14: 5000 }
    : { engagements: 1, newCustomers: 1, firstSales: 5000, repeatCustomers: 0, repeatSales: 0, totalSales: 5000 };
  return { schema: 'roas-coupang-ad-report-v1', vendorId, type, since: reportDate, until: reportDate, filename: vendorId + '_' + type + '_total_campaign_' + reportDate.replaceAll('-', '') + '_' + reportDate.replaceAll('-', '') + '.xlsx', rows: [{ ...base, ...fields }] };
}
test('saved NCA replaces manual acquisition once, preserves source PA and recalculates after an import and restart', t => {
  const { s, service } = setup(t);
  s.importSales({ date, rows: [row], acquisitionAdvertising: { growth: 500, seller: 0 } });
  s.importSalesBatch({ reports: [], dailyTotals: [{ date, sales: 19999, profitBeforeAds: 12001, advertising: 2001, otherCosts: 2600 }] });
  s.importAdvertising(report('pa', 777)); s.importAdvertising(report('nca', 1500));
  let r = s.analytics(query()), d = r.daily[0], a = d.dailyReport;
  assert.equal(a.sourceNetProfit, 10000); assert.equal(a.advertising, 2001, 'an original PA figure is not overwritten by a differently based report');
  assert.equal(a.acquisitionAdvertising, 1500); assert.equal(a.netProfit, 8500); assert.equal(d.netProfit, 8500); assert.equal(r.summary.netProfit, 8500); assert.equal(r.dailyReportSummary.netProfit, 8500);
  assert.equal(a.advertisingSources.nca.scope, 'account'); assert.equal(a.advertisingSources.nca.basis, 'report-original-amount');
  assert.match(a.advertisingSources.nca.filename, /_nca_/); assert.ok(a.reasons.some(reason => reason.includes('현재 선택 상품')));
  assert.equal(r.items[0].netProfit, null, 'an account expense is not allocated to an option');
  assert.equal(d.channels[0].netProfit, 9500, 'saved channel confirmations remain separate from account-wide collection');
  s.importAdvertising(report('nca', 1800)); s.importAdvertising(report('nca', 1800));
  r = service().analytics(query()); assert.equal(r.daily[0].dailyReport.netProfit, 8200); assert.equal(r.summary.acquisitionAdvertising, 1800);
});
test('missing NCA remains unknown, reported zero is explicit and period totals only include confirmed dates', t => {
  const { s } = setup(t); s.importSales({ date, rows: [row] }); s.importSales({ date: next, rows: [row] });
  let r = s.analytics(query()); assert.equal(r.daily[0].dailyReport.acquisitionAdvertising, null); assert.equal(r.daily[0].dailyReport.netProfit, null);
  assert.ok(r.daily[0].dailyReport.missing.includes('acquisitionAdvertising'));
  s.importAdvertising(report('nca', 0)); r = s.analytics(query({ until: next }));
  assert.equal(r.daily[0].dailyReport.netProfit, 10000); assert.equal(r.daily[1].dailyReport.netProfit, null);
  assert.equal(r.dailyReportSummary.netProfit, null); assert.equal(r.dailyReportSummary.available.netProfit, 10000);
  assert.equal(r.dailyReportSummary.knownDays.netProfit, 1); assert.equal(r.dailyReportSummary.partial.netProfit, true);
  assert.equal(r.dailyReportSummary.available.acquisitionAdvertising, 0); assert.equal(r.summary.netProfit, null);
});
test('account reports do not allocate costs into delivery filters or override a scoped manual confirmation', t => {
  const { s } = setup(t); s.importSales({ date, rows: [row], acquisitionAdvertising: { growth: 300, seller: 0 } }); s.importAdvertising(report('nca', 1500));
  const r = s.analytics(query({ channel: 'growth' })), d = r.daily[0].dailyReport;
  assert.equal(d.acquisitionAdvertising, 300); assert.equal(d.netProfit, 9700); assert.equal(d.advertisingSources.nca.scope, 'selected');
  assert.ok(d.reasons.some(reason => reason.includes('배송 방식별로 배분하지 않아')));
  assert.equal(r.items[0].netProfit, null);
});
test('saved PA and NCA reports automatically complete API-based profit estimates without further network requests', async t => {
  const { s, service } = setup(t); await s.sync({ since: date, until: date, channel: 'growth' }); await s.sync({ since: date, until: date, channel: 'seller' });
  s.importAdvertising(report('pa', 2000)); s.importAdvertising(report('nca', 1500));
  const r = service().analytics(query()), d = r.daily[0].dailyReport;
  assert.equal(d.sales, 20000); assert.equal(d.profitBeforeAds, 11400); assert.equal(d.sourceNetProfit, 9400); assert.equal(d.netProfit, 7900);
  assert.equal(d.estimated.netProfit, true); assert.equal(d.apiUnconfirmed, true); assert.equal(d.advertisingSources.pa.scope, 'account');
  assert.equal(r.daily[0].netProfit, 7900); assert.equal(r.summary.netProfit, 7900); assert.equal(r.items[0].netProfit, null);
  const filtered = s.analytics(query({ channel: 'growth' })).daily[0].dailyReport; assert.equal(filtered.advertising, null); assert.equal(filtered.netProfit, null);
});
test('a reviewed ledger final is preserved and an ambiguous already-included acquisition cost is never deducted twice', async t => {
  const { s } = setup(t); await s.sync({ since: date, until: date, channel: 'growth' }); await s.sync({ since: date, until: date, channel: 'seller' });
  const ledgers = s.report(query()).daily;
  for (const ledger of ledgers) s.saveLedger({ date, channel: ledger.channel, scopeKey: s.status().scopeKey, basis: ledger.basis, reviewed: true, ...Object.fromEntries(COSTS.map(key => [key, 0])), ...(ledger.channel === 'growth' ? { netSales: 20000, productCost: 6000, commission: 2000, advertising: 3500, delivery: 600 } : {}) });
  let r = s.analytics(query()); assert.equal(r.summary.netProfit, 7900); assert.equal(r.daily[0].dailyReport.netProfit, 7900);
  s.importAdvertising(report('nca', 1500)); r = s.analytics(query());
  assert.equal(r.daily[0].dailyReport.acquisitionAdvertising, 1500); assert.equal(r.daily[0].dailyReport.netProfit, null);
  assert.equal(r.daily[0].dailyReport.advertisingSources.nca.deducted, false); assert.equal(r.summary.complete, false);
  assert.ok(r.daily[0].dailyReport.reasons.some(reason => reason.includes('이미 포함됐는지')));
});
test('report revision changes with saved financial content and rolls back with a failed revision write', t => {
  const { s, root } = setup(t); assert.equal(s.status().advertisingRevision, null);
  s.importAdvertising(report('nca', 1500)); const revision = s.status().advertisingRevision;
  s.importAdvertising(report('nca', 1500)); assert.equal(s.status().advertisingRevision, revision);
  s.importAdvertising(report('nca', 1600)); assert.notEqual(s.status().advertisingRevision, revision);
  const before = s.status().advertisingRevision, file = path.join(root, 'ad-reports/nca/' + date + '.json'), original = fs.readFileSync(file, 'utf8');
  const rename = fs.renameSync; let failed = false;
  fs.renameSync = (from, to) => { if (String(to).endsWith('ad-reports/revision.json') && !failed) { failed = true; throw Error('synthetic revision failure'); } return rename(from, to); };
  try { assert.throws(() => s.importAdvertising(report('nca', 1700)), /synthetic revision failure/); } finally { fs.renameSync = rename; }
  assert.equal(s.status().advertisingRevision, before); assert.equal(fs.readFileSync(file, 'utf8'), original);
});
