'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createService, COSTS } = require('../integrations/coupang/service.cjs');
const { parse } = require('../public/coupang-ad-reports.js');

const date = '2026-10-24';
const credentials = { vendorId: 'A00012345', accessKey: 'test-access-key', secretKey: 'test-secret-key' };
const protect = (mode, value) => mode === 'encrypt' ? Buffer.from(value).toString('base64') : Buffer.from(value, 'base64').toString();
const salesRow = (overrides = {}) => ({ productId: '100', itemId: '123', channel: 'growth', name: '예시 상품', optionName: '기본 구성',
  quantity: 5, adQuantity: 2, organicQuantity: 3, sales: 100000, profitBeforeAds: 30000, advertising: 10000, adSales: 40000, adProfitBeforeAds: 16000, ...overrides });
function fixture(t) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'roas-account-nca-'));
  t.after(() => fs.rmSync(baseDir, { recursive: true, force: true }));
  const create = () => createService({ baseDir, protect, now: () => Date.parse('2026-10-27T05:00:00Z') });
  const service = create(); service.saveCredentials(credentials);
  return { service, create, baseDir, query: { since: date, until: date, channel: 'all', view: 'sales' } };
}
function importFile(service, reports = [{ date, rows: [salesRow()] }]) {
  return service.importSalesBatch({ schema: 'roas-coupang-sales-v1', includeProducts: true, reports });
}
function nca(spend = 2000, day = date) {
  const headers = ['캠페인 ID', '캠페인 이름', '광고 노출 지면', '노출수', '클릭수', '집행 광고비', '참여수', '신규 구매 고객 수', '첫구매를 통한 광고 전환 매출', '신규 구매 고객 중 재구매 고객 수', '재구매를 통한 매출', '전체 매출'];
  return parse([[headers, ['456', '신규구매 예시', '전체', 100, 5, spend, 10, 2, 10000, 1, 3000, 13000]]], 'A00012345_nca_total_campaign_' + day.replaceAll('-', '') + '_' + day.replaceAll('-', '') + '.xlsx');
}
function pa(spend = 10000, day = date) {
  const headers = ['캠페인 ID', '캠페인명', '광고 노출 지면', '노출수', '클릭수', '광고비', '광고집행 옵션ID', '광고전환매출발생 옵션ID', '키워드', '총 주문수(1일)', '총 판매수량(1일)', '총 전환매출액(1일)', '총 주문수(14일)', '총 판매수량(14일)', '총 전환매출액(14일)'];
  return parse([[headers, ['789', '매출성장 예시', '검색 영역', 1000, 20, spend, '123', '123', '예시', 2, 2, 40000, 3, 3, 60000]]], 'A00012345_pa_total_campaign_' + day.replaceAll('-', '') + '_' + day.replaceAll('-', '') + '.xlsx');
}

test('confirmed NCA account spend subtracts once from the whole imported file profit without allocating it to options', t => {
  const { service, create, baseDir, query } = fixture(t);
  importFile(service);
  const salesFile = path.join(baseDir, '.roas-data/coupang', credentials.vendorId, 'sales', date + '.json');
  const sourceBefore = fs.readFileSync(salesFile, 'utf8');
  assert.equal(service.analytics(query).summary.netProfit, null, 'an absent NCA report is not confirmed zero');
  service.importAdvertising(pa()); service.importAdvertising(nca());
  let result = service.analytics(query);
  assert.equal(result.summary.sales, 100000, 'attributed PA/NCA sales must never be added to order sales');
  assert.equal(result.summary.advertising, 10000);
  assert.equal(result.summary.sourceNetProfit, 20000);
  assert.equal(result.summary.acquisitionAdvertising, 2000);
  assert.equal(result.summary.netProfit, 18000);
  assert.equal(result.daily[0].netProfit, 18000);
  assert.equal(result.daily[0].acquisitionCoverage.accountScopeVerified, false);
  assert.equal(result.daily[0].acquisitionCoverage.profitScope, 'file-sales-minus-account-nca');
  assert.equal(result.daily[0].complete, false, 'whole-file coverage does not prove the file covers the whole account');
  assert.equal(result.items[0].acquisitionAdvertising ?? null, null);
  assert.equal(result.items[0].netProfit, null);
  assert.equal(result.daily[0].channels.find(channel => channel.channel === 'growth').netProfit, null);
  assert.equal(fs.readFileSync(salesFile, 'utf8'), sourceBefore, 'querying the adjustment must not rewrite the source profit file');
  service.importAdvertising(nca());
  result = create().analytics(query);
  assert.equal(result.summary.acquisitionAdvertising, 2000);
  assert.equal(result.summary.netProfit, 18000, 'repeated report import replaces that date, rather than adding another cost');
  service.importAdvertising(nca(2500));
  assert.equal(service.analytics(query).summary.netProfit, 17500);
});

test('explicit acquisition confirmations, including zero, take precedence over the separate account report', t => {
  const { service, query } = fixture(t);
  service.importAdvertising(nca(2000));
  importFile(service, [{ date, rows: [salesRow()], acquisitionAdvertising: { growth: 3000, seller: 0 } }]);
  let result = service.analytics(query);
  assert.equal(result.summary.sourceNetProfit, 20000);
  assert.equal(result.summary.acquisitionAdvertising, 3000);
  assert.equal(result.summary.netProfit, 17000, 'the account report cannot be deducted after an explicit acquisition confirmation');
  assert.equal(result.summary.acquisitionCoverage.differenceDays, 1);
  importFile(service, [{ date, rows: [salesRow()], acquisitionAdvertising: { growth: 0, seller: 0 } }]);
  result = service.analytics(query);
  assert.equal(result.summary.acquisitionAdvertising, 0);
  assert.equal(result.summary.netProfit, 20000, 'explicit zero is a confirmation, not a missing value to override');
});

test('a confirmed zero NCA report differs from an uncollected day and does not overwrite PA cost', t => {
  const { service, query } = fixture(t);
  importFile(service);
  let result = service.analytics(query);
  assert.equal(result.summary.acquisitionAdvertising, null);
  assert.equal(result.summary.netProfit, null);
  service.importAdvertising(nca(0));
  result = service.analytics(query);
  assert.equal(result.summary.advertising, 10000);
  assert.equal(result.summary.acquisitionAdvertising, 0);
  assert.equal(result.summary.netProfit, 20000);
});

test('delivery subsets and selected-option subsets cannot inherit an account-wide NCA allocation', t => {
  const { service, query } = fixture(t);
  importFile(service, [{ date, rows: [salesRow(), salesRow({ itemId: '456', channel: 'seller', sales: 50000, profitBeforeAds: 20000, advertising: 5000 })] }]);
  service.importAdvertising(nca());
  assert.equal(service.analytics(query).summary.netProfit, 33000);
  for (const channel of ['growth', 'seller']) {
    const subset = service.analytics({ ...query, channel });
    assert.equal(subset.summary.acquisitionAdvertising, null, channel + ' has no observed share of account-level NCA');
    assert.equal(subset.summary.netProfit, null);
  }
  service.saveScope({ products: [{ itemId: '123', name: '선택한 상품', unitCost: null }] });
  const narrowed = service.analytics(query);
  assert.equal(narrowed.daily[0].sourceScope.selectedFileProducts, 1);
  assert.equal(narrowed.daily[0].sourceScope.fileProducts, 2);
  assert.equal(narrowed.summary.acquisitionAdvertising, null);
  assert.equal(narrowed.summary.netProfit, null);
});

test('an ordinary selected-scope import cannot claim whole-file eligibility using a raw request field', t => {
  const { service, query } = fixture(t);
  service.saveScope({ products: [{ itemId: '123', productId: '100', name: '선택한 상품', unitCost: null, channel: 'growth' }] });
  service.importSales({ date, rows: [salesRow()], scopeMode: 'file', reportItemIds: ['123'] });
  service.importAdvertising(nca());
  const result = service.analytics(query);
  assert.equal(result.daily[0].sourceScope.mode, 'selected');
  assert.equal(result.summary.acquisitionAdvertising, null);
  assert.equal(result.summary.netProfit, null);
});

test('missing NCA dates keep period profit unknown and PA/NCA attribution windows stay separate', t => {
  const { service, query } = fixture(t);
  const next = '2026-10-25';
  importFile(service, [{ date, rows: [salesRow()] }, { date: next, rows: [salesRow()] }]);
  service.importAdvertising(pa()); service.importAdvertising(nca());
  const result = service.analytics({ ...query, until: next });
  assert.equal(result.daily.find(day => day.date === date).netProfit, 18000);
  assert.equal(result.daily.find(day => day.date === next).netProfit, null);
  assert.equal(result.summary.acquisitionAdvertising, null);
  assert.equal(result.summary.netProfit, null);
  const reports = service.advertisingReports({ since: date, until: next });
  assert.equal(reports.types.pa.available.spend, 10000);
  assert.equal(reports.types.pa.available.sales1, 40000);
  assert.equal(reports.types.pa.available.sales14, 60000);
  assert.equal(reports.types.nca.available.spend, 2000);
  assert.equal(reports.types.nca.available.firstSales, 10000);
  assert.equal(reports.types.nca.knownDays, 1);
  assert.equal(reports.types.nca.complete, false);
});

test('confirmed manual ledgers retain their reviewed advertising total and never deduct NCA a second time', t => {
  const { service, query } = fixture(t);
  service.saveScope({ products: [{ itemId: '123', productId: '100', name: '확인한 상품', unitCost: null, channel: 'growth' }] });
  const current = service.report({ since: date, until: date });
  for (const channel of ['growth', 'seller']) {
    const ledger = current.daily.find(row => row.channel === channel);
    service.saveLedger({ date, channel, scopeKey: current.scopeKey, basis: ledger.basis, reviewed: true,
      ...Object.fromEntries(COSTS.map(key => [key, 0])),
      ...(channel === 'growth' ? { netSales: 100000, productCost: 60000, advertising: 10000 } : {}) });
  }
  const before = service.analytics(query);
  assert.equal(before.summary.netProfit, 30000);
  service.importAdvertising(nca());
  const after = service.analytics(query);
  assert.equal(after.summary.netProfit, before.summary.netProfit);
  assert.equal(after.summary.advertising, before.summary.advertising);
  assert.equal(after.summary.acquisitionAdvertising, before.summary.acquisitionAdvertising);
});
