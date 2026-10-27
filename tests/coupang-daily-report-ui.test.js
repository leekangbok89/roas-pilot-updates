'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = fs.readFileSync(path.resolve(__dirname, '../public/coupang-analytics.js'), 'utf8');
function helpers() {
  const names = ['displayedValue', 'dailyValue', 'dailyEstimated', 'dailyTotal', 'normalizeDailyTotals'];
  const context = vm.createContext({});
  const functions = names.map(name => {
    const start = source.indexOf('  function ' + name + '('), next = source.indexOf('\n  function ', start + 1);
    assert.ok(start >= 0, name); return source.slice(start, next);
  }).join('\n');
  const columns = source.split('\n').find(line => line.startsWith('  const dailyColumns ='));
  vm.runInContext("const today='2026-10-27'; const isNumber=value=>typeof value==='number'&&Number.isFinite(value);\n" + columns + '\n' + functions + '\nglobalThis.h={' + names.join(',') + '};', context);
  return context.h;
}
test('daily money totals sum known dates while keeping no-data days unknown', () => {
  const h = helpers();
  const known = { sales: 100000, profitBeforeAds: 54000, advertising: 12000, otherCosts: 20000, sourceNetProfit: 42000 };
  const unknown = Object.fromEntries(Object.keys(known).map(key => [key, null]));
  const total = h.dailyTotal([known, { ...known, advertising: 0, sourceNetProfit: 54000 }, unknown]);
  assert.equal(total.sales, 200000); assert.equal(total.profitBeforeAds, 108000);
  assert.equal(total.advertising, 12000); assert.equal(total.otherCosts, 40000); assert.equal(total.sourceNetProfit, 96000);
  assert.equal(total.knownDays.sourceNetProfit, 2); assert.equal(total.partial.sourceNetProfit, true);
  assert.equal(h.dailyValue(unknown, 'advertising'), null);
  assert.equal(h.dailyTotal([unknown]).sourceNetProfit, null);
});
test('estimated profit never invents unknown advertising or double-deducts other costs', () => {
  const h = helpers(), row = { estimatedProfitBeforeAds: 54000, estimatedOtherCosts: 20000, advertising: null };
  assert.equal(h.dailyValue(row, 'profitBeforeAds'), 54000);
  assert.equal(h.dailyEstimated(row, 'profitBeforeAds'), true);
  assert.equal(h.dailyValue(row, 'otherCosts'), 20000);
  assert.equal(h.dailyValue(row, 'sourceNetProfit'), undefined);
  assert.equal(h.dailyValue({ ...row, advertising: 12000 }, 'sourceNetProfit'), 42000);
  assert.equal(h.dailyValue({ ...row, otherCosts: 19000 }, 'otherCosts'), 19000);
  assert.equal(h.dailyEstimated({ ...row, otherCosts: 19000 }, 'otherCosts'), false);
  assert.equal(h.dailyValue({ ...row, sourceNetProfit: 40000 }, 'sourceNetProfit'), 40000);
});
test('confirmed daily import rejects duplicates, invalid dates and money without changing reported values', () => {
  const h = helpers(), first = { date: '2026-10-22', sales: 100000, profitBeforeAds: 54000, advertising: 12000, otherCosts: 20000 };
  assert.equal(h.normalizeDailyTotals([first])[0].otherCosts, 20000);
  assert.equal(h.normalizeDailyTotals([{ ...first, sales: -1000, profitBeforeAds: -500 }])[0].sales, -1000);
  assert.throws(() => h.normalizeDailyTotals([first, first]), /중복/);
  assert.throws(() => h.normalizeDailyTotals([{ ...first, date: '2026-02-30' }]), /날짜/);
  assert.throws(() => h.normalizeDailyTotals([{ ...first, date: '2026-10-28' }]), /날짜/);
  assert.throws(() => h.normalizeDailyTotals([{ ...first, advertising: -1 }]), /금액/);
  assert.throws(() => h.normalizeDailyTotals([{ ...first, otherCosts: '20000' }]), /금액/);
});
