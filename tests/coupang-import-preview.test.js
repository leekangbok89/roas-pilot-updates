'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = fs.readFileSync(path.resolve(__dirname, '../public/coupang-analytics.js'), 'utf8');
function helpers() {
  const context = vm.createContext({});
  const declarations = ['normalizeImportReports', 'importTotals'].map(name => {
    const start = source.indexOf('  function ' + name + '('), next = source.indexOf('\n  function ', start + 1);
    assert.ok(start >= 0); return source.slice(start, next);
  }).join('\n');
  vm.runInContext("const today='2026-10-27'; const isNumber=v=>typeof v==='number'&&Number.isFinite(v); const sum=(rows,key)=>rows.length&&rows.every(r=>isNumber(r[key]))?rows.reduce((n,r)=>n+r[key],0):null;\n" + declarations + '\nglobalThis.helpers={normalizeImportReports,importTotals}', context);
  return context.helpers;
}
const row = (values = {}) => ({ itemId: '123', productId: '456', channel: 'growth', name: '예시 상품', quantity: 2, adQuantity: 1, organicQuantity: 1, sales: 20000, profitBeforeAds: 11000, advertising: 1000, adSales: 10000, adProfitBeforeAds: 5500, ...values });
test('preview keeps signed refund quantities and zero-sale advertising, and computes ratios from totals', () => {
  const { importTotals } = helpers();
  const totals = importTotals({ rows: [row(), row({ quantity: -1, adQuantity: 0, organicQuantity: -1, sales: -10000, profitBeforeAds: -5500, advertising: 0, adSales: 0, adProfitBeforeAds: 0 }), row({ quantity: 0, adQuantity: 0, organicQuantity: 0, sales: 0, profitBeforeAds: 0, advertising: 200, adSales: 0, adProfitBeforeAds: 0 })] });
  assert.equal(totals.quantity, 1); assert.equal(totals.organicQuantity, 0);
  assert.equal(totals.sales, 10000); assert.equal(totals.nonAdvertisingCosts, 4500);
  assert.equal(totals.advertising, 1200); assert.equal(totals.sourceNetProfit, 4300);
  assert.equal(totals.adNetProfit, 4300); assert.equal(totals.roas, 10000 / 1200 * 100);
  assert.equal(totals.adReturnOnSpend, 4300 / 1200 * 100);
});
test('preview does not fabricate missing advertising results or a zero-spend ratio', () => {
  const { importTotals } = helpers();
  const totals = importTotals({ rows: [row({ advertising: 0, adSales: null, adProfitBeforeAds: null, adQuantity: null })] });
  assert.equal(totals.adQuantity, null); assert.equal(totals.adNetProfit, null);
  assert.equal(totals.roas, null); assert.equal(totals.adReturnOnSpend, null);
});
test('batch selection sorts dates and rejects duplicate/future dates and malformed figures before saving', () => {
  const { normalizeImportReports } = helpers();
  const earlier = { date: '2026-10-22', rows: [row()] }, later = { date: '2026-10-24', rows: [row()] };
  assert.equal(normalizeImportReports([later, earlier])[0].date, earlier.date);
  assert.throws(() => normalizeImportReports([earlier, earlier]), /중복/);
  assert.throws(() => normalizeImportReports([{ ...earlier, date: '2026-10-28' }]), /날짜/);
  assert.throws(() => normalizeImportReports([{ ...earlier, rows: [row({ sales: '20000' })] }]), /숫자/);
  assert.throws(() => normalizeImportReports(Array.from({ length: 32 }, () => earlier)), /1~31/);
});
