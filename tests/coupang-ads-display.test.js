'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('../public/coupang-ads.js');

function option(values = {}) {
  return { productId: 'p1', itemId: 'i1', name: '테스트 상품', optionName: '작은 옵션', channel: 'growth', source: 'sellha', advertising: 1000, adSales: 6000, adQuantity: 2, organicQuantity: 1, adProfitBeforeAds: 2500, ...values };
}
test('advertising totals use weighted ROAS and never allocate customer acquisition spend', () => {
  const total = h.aggregate([option({ acquisitionAdvertising: 9999 }), option({ advertising: 3000, adSales: 12000, adProfitBeforeAds: 4000, acquisitionAdvertising: 9999 })]);
  assert.equal(total.advertising, 4000);
  assert.equal(total.adSales, 18000);
  assert.equal(total.roas, 450);
  assert.equal(total.adNetProfit, 2500);
  assert.equal('netProfit' in total, false);
  assert.equal('acquisitionAdvertising' in total, false);
});
test('unknown advertising data does not become zero or an apparently complete subtotal', () => {
  const total = h.aggregate([option(), option({ source: 'api', advertising: null, adSales: null, adQuantity: null, organicQuantity: null, adProfitBeforeAds: null })]);
  for (const key of ['advertising', 'adSales', 'adQuantity', 'organicQuantity', 'adProfitBeforeAds', 'roas', 'adNetProfit']) assert.equal(total[key], null, key);
  assert.equal(total.source, 'mixed');
  assert.equal(h.aggregate([]).advertising, null);
  assert.equal(h.aggregate([option({ advertising: 0, adSales: 0, adProfitBeforeAds: 0 })]).adNetProfit, 0);
  assert.equal(h.aggregate([option({ advertising: 0, adSales: 0 })]).roas, null);
  assert.equal(h.aggregate([option({ adSales: -1000, adProfitBeforeAds: -500 })]).adNetProfit, -1500);
});
test('named groups filter option membership before product totals and loss filters retain only confirmed loss', () => {
  const rows = [option(), option({ itemId: 'i2', optionName: '큰 옵션', advertising: 4000, adProfitBeforeAds: 1000 }), option({ productId: 'p2', itemId: 'i3', advertising: null, adProfitBeforeAds: null, source: 'missing' })];
  const selected = h.productGroups(rows, { itemIds: ['i2'] });
  assert.equal(selected.length, 1);
  assert.equal(selected[0].rows.length, 1);
  assert.equal(selected[0].advertising, 4000);
  assert.equal(selected[0].adNetProfit, -3000);
  assert.equal(selected[0].options[0].itemId, 'i2');
  assert.equal(h.productGroups(rows, { itemIds: [] }).length, 0);
  const losses = h.productGroups(rows, { lossOnly: true });
  assert.equal(losses.length, 1);
  assert.equal(losses[0].id, 'p1');
  assert.equal(losses[0].adNetProfit, -1500);
  const searched = h.productGroups(rows, { search: '큰 옵션' });
  assert.equal(searched[0].options.length, 1);
  assert.equal(searched[0].advertising, 4000);
});
test('option channels stay separate, unknown sort values last and CSV neutralizes formula text', () => {
  const groups = h.productGroups([option(), option({ channel: 'seller' })]);
  assert.equal(groups[0].options.length, 2);
  assert.notEqual(groups[0].options[0].key, groups[0].options[1].key);
  assert.ok(h.compare({ roas: null }, { roas: 100 }, 'roas', true) > 0);
  assert.ok(h.compare({ roas: null }, { roas: 100 }, 'roas', false) > 0);
  assert.equal(h.csvCell(' \t=SUM(A1:A2)'), '"\' \t=SUM(A1:A2)"');
  assert.equal(h.csvCell('-option'), '"\'-option"');
  assert.equal(h.csvCell(-1500), '"-1500"');
  assert.equal(h.csvCell('a"b'), '"a""b"');
});
