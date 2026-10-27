'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = fs.readFileSync(path.resolve(__dirname, '../public/coupang-analytics.js'), 'utf8');
function declaration(name) {
  const start = source.indexOf('  function ' + name + '('); assert.notEqual(start, -1, name);
  const next = source.indexOf('\n  function ', start + 1);
  return source.slice(start, next < 0 ? source.length : next);
}
function helpers() {
  const context = vm.createContext({});
  const constants = ['summable', 'channels', 'isNumber', 'number', 'won', 'sum'].map(name => {
    const line = source.split('\n').find(line => line.trim().startsWith('const ' + name + ' ='));
    assert.ok(line, name); return line;
  }).join('\n');
  const names = ['displayedValue', 'isPartialValue', 'availableSum', 'salesStatus', 'aggregateRows', 'compareValues', 'filterProductGroups'];
  vm.runInContext(constants + '\n' + names.map(declaration).join('\n') + '\nglobalThis.h={' + names.join(',') + '};', context);
  return context.h;
}
test('collected sales and quantities survive missing coverage without inventing zero or profits', () => {
  const h = helpers(), partial = { sales: null, quantity: null, netProfit: null, advertising: null, available: { sales: 20000, quantity: 2, netProfit: 9999, advertising: 200 } };
  assert.equal(h.displayedValue(partial, 'sales'), 20000);
  assert.equal(h.displayedValue(partial, 'quantity'), 2);
  assert.equal(h.isPartialValue(partial, 'sales'), true);
  assert.equal(h.salesStatus(partial), '수집분 · 일부 미수집');
  assert.equal(h.displayedValue(partial, 'netProfit'), null);
  assert.equal(h.displayedValue(partial, 'advertising'), null);
  assert.equal(h.displayedValue({ sales: null, available: { sales: null } }, 'sales'), null);
  assert.equal(h.salesStatus({ sales: null, available: { sales: null } }), '자료 없음');
  assert.equal(h.displayedValue({ sales: null, available: { sales: 0 } }, 'sales'), 0);
  assert.equal(h.displayedValue({ sales: 0, available: { sales: 99 } }, 'sales'), 0);
  assert.equal(h.displayedValue({ sales: null, available: { sales: -5000 } }, 'sales'), -5000);
});
test('product and option totals keep collected subtotals separate from strict period sums and ROAS', () => {
  const h = helpers();
  const rows = [
    { sales: null, quantity: null, advertising: 1000, adSales: 10000, netProfit: null, available: { sales: 20000, quantity: 2 } },
    { sales: 15000, quantity: 1, advertising: 3000, adSales: 20000, netProfit: 3000, available: { sales: 15000, quantity: 1 } }
  ];
  const total = h.aggregateRows(rows);
  assert.equal(total.sales, null); assert.equal(total.quantity, null);
  assert.equal(total.available.sales, 35000); assert.equal(total.available.quantity, 3);
  assert.equal(h.displayedValue(total, 'sales'), 35000); assert.equal(total.netProfit, null);
  assert.equal(total.roas, 750);
  assert.equal(h.aggregateRows([{ sales: null, available: { sales: null } }]).available.sales, null);
  assert.equal(h.aggregateRows([{ sales: null, available: { sales: 0 } }]).available.sales, 0);
  const missingAd = h.aggregateRows([rows[0], { sales: null, advertising: null, adSales: null, available: { sales: 0 } }]);
  assert.equal(missingAd.roas, null); assert.equal(missingAd.available.sales, 20000);
});
test('sales sorting follows displayed collected values while unknown rows remain last', () => {
  const h = helpers();
  const high = { sales: null, available: { sales: 20000 } }, low = { sales: 10000 }, unknown = { sales: null, available: { sales: null } };
  assert.ok(h.compareValues(high, low, 'sales', false) < 0);
  assert.ok(h.compareValues(high, low, 'sales', true) > 0);
  assert.ok(h.compareValues(unknown, low, 'sales', false) > 0);
  assert.equal(h.compareValues({ netProfit: null, available: { netProfit: 100 } }, { netProfit: null }, 'netProfit', false), 0);
});

test('saved groups filter exact options and recalculate table totals without allocating final acquisition profit', () => {
  const h = helpers();
  const a = { itemId:'123', sales:20000, quantity:2, advertising:1000, adSales:10000, netProfit:null, source:'sellha' };
  const b = { itemId:'456', sales:10000, quantity:1, advertising:3000, adSales:20000, netProfit:null, source:'sellha' };
  const products = [{ id:'700', name:'예시', ...h.aggregateRows([a,b]), options:[{id:'123',channel:'growth',rows:[a]},{id:'456',channel:'seller',rows:[b]}], rows:[a,b] }];
  const original = JSON.stringify(products);
  const selected = h.filterProductGroups(products, ['456']);
  assert.equal(selected.length,1); assert.equal(selected[0].sales,10000); assert.equal(selected[0].roas,20000/3000*100);
  assert.equal(selected[0].netProfit,null); assert.equal(selected[0].channel,'판매자배송');
  assert.equal(selected[0].options.length,1); assert.equal(selected[0].options[0].id,'456');
  assert.equal(JSON.stringify(products),original); assert.equal(products[0].sales,30000);
  assert.equal(h.filterProductGroups(products, []).length,0);
  assert.equal(h.filterProductGroups(products, null),products);
});
