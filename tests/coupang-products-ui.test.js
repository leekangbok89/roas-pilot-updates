'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../public/coupang-products.js'), 'utf8');
function helpers(workspace, values) {
  const start = source.indexOf('  function filteredProducts()'), end = source.indexOf('  function checkBox(', start);
  assert.ok(start > 0 && end > start);
  const context = vm.createContext({ workspace, values });
  vm.runInContext("const $ = id => ({value:values[id] || '',checked:values[id] === true}); const channels={growth:'그로스',seller:'판매자'};const known=value=>typeof value==='number'&&Number.isFinite(value);const productId=p=>p.productId||'option:'+p.itemId;const productName=p=>p.productName||p.name;" + source.slice(start,end) + '\nglobalThis.helpers={filteredProducts,groupedProducts};', context);
  return context.helpers;
}
const example = {
  scopeKey: 'fixed-scope',
  products: [
    { itemId: '111', productId: '900', productName: '테스트 상품', optionName: '파랑', name: '테스트 파랑', unitCost: 0, channel: 'growth' },
    { itemId: '222', productId: '900', productName: '테스트 상품', optionName: '빨강', name: '테스트 빨강', unitCost: null, channel: 'seller' },
    { itemId: '333', name: '다른 상품', unitCost: null }
  ],
  groups: [{ id: 'sample', name: '시험 그룹', itemIds: ['222'] }]
};
test('product filters distinguish confirmed zero cost from unknown and preserve saved scope', () => {
  const before = JSON.stringify(example);
  const h = helpers(example, { 'cpm-channel':'all', 'cpm-missing':true });
  assert.deepEqual(Array.from(h.filteredProducts(), p=>p.itemId), ['222','333']);
  assert.equal(JSON.stringify(example),before);
  const zero = helpers(example, { 'cpm-channel':'growth' });
  assert.deepEqual(Array.from(zero.filteredProducts(), p=>p.itemId), ['111']);
});
test('saved group filtering keeps exact option membership within a product', () => {
  const before = JSON.stringify(example), selected = helpers(example, { 'cpm-channel':'all', 'cpm-group':'sample' }).groupedProducts();
  assert.equal(selected.length,1); assert.equal(selected[0].id,'900');
  assert.deepEqual(Array.from(selected[0].options,p=>p.itemId),['222']);
  const ungrouped = helpers(example, { 'cpm-channel':'all', 'cpm-group':'__ungrouped' }).filteredProducts();
  assert.deepEqual(Array.from(ungrouped,p=>p.itemId),['111','333']);
  const search = helpers(example, { 'cpm-channel':'all', 'cpm-search':'파랑' }).filteredProducts();
  assert.deepEqual(Array.from(search,p=>p.itemId),['111']);
  assert.equal(JSON.stringify(example),before);
});
