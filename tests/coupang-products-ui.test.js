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

function bulkHelpers(values = {}) {
  const fields = source.split('\n').find(line => line.startsWith('  const bulkFields ='));
  const start = source.indexOf('  function readBulkChanges()'), end = source.indexOf('\n  function renderBulkPreview()', start);
  assert.ok(fields && start > 0 && end > start);
  const inputs = {};
  for (const key of ['unitCost', 'commissionRate', 'inboundFee', 'deliveryFee', 'costSince']) {
    inputs['cpm-bulk-use-' + key] = { checked: key === 'unitCost' };
    inputs['cpm-bulk-' + key] = { value: '', max: '2026-11-04' };
  }
  for (const [id, value] of Object.entries(values)) Object.assign(inputs[id], value);
  const context = vm.createContext({ inputs });
  vm.runInContext("const $=id=>inputs[id];const known=value=>typeof value==='number'&&Number.isFinite(value);\n" + fields + '\n' + source.slice(start, end) + '\nglobalThis.read=readBulkChanges;', context);
  return context.read;
}
test('bulk cost input sends only explicitly selected fields and preserves a confirmed zero', () => {
  assert.deepEqual({ ...bulkHelpers({ 'cpm-bulk-unitCost': { value: '4200' } })() }, { unitCost: 4200 });
  assert.deepEqual({ ...bulkHelpers({ 'cpm-bulk-unitCost': { value: '0' } })() }, { unitCost: 0 });
  const read = bulkHelpers({ 'cpm-bulk-use-unitCost': { checked: false }, 'cpm-bulk-use-deliveryFee': { checked: true }, 'cpm-bulk-deliveryFee': { value: '0' }, 'cpm-bulk-use-commissionRate': { checked: true }, 'cpm-bulk-commissionRate': { value: '8.5' } });
  assert.deepEqual({ ...read() }, { commissionRate: 8.5, deliveryFee: 0 });
});
test('bulk input rejects blank, invalid or unchecked changes instead of clearing unrelated costs', () => {
  for (const value of ['', ' ', '-1', 'Infinity', 'not a number', '1000000000001']) assert.throws(bulkHelpers({ 'cpm-bulk-unitCost': { value } }));
  assert.throws(bulkHelpers({ 'cpm-bulk-use-unitCost': { checked: false } }), /하나 이상/);
  assert.throws(bulkHelpers({ 'cpm-bulk-unitCost': { value: '1' }, 'cpm-bulk-use-commissionRate': { checked: true }, 'cpm-bulk-commissionRate': { value: '101' } }), /0~100%/);
});
test('bulk start dates stay unchanged unless selected and reject invalid or future dates', () => {
  assert.deepEqual({ ...bulkHelpers({ 'cpm-bulk-unitCost': { value: '1' }, 'cpm-bulk-costSince': { value: '2026-01-01' } })() }, { unitCost: 1 });
  assert.deepEqual({ ...bulkHelpers({ 'cpm-bulk-use-unitCost': { checked: false }, 'cpm-bulk-use-costSince': { checked: true } })() }, { costSince: null });
  assert.deepEqual({ ...bulkHelpers({ 'cpm-bulk-unitCost': { value: '1' }, 'cpm-bulk-use-costSince': { checked: true }, 'cpm-bulk-costSince': { value: '2026-11-01' } })() }, { unitCost: 1, costSince: '2026-11-01' });
  for (const value of ['2026-02-30', '2026-11-05', 'bad']) assert.throws(bulkHelpers({ 'cpm-bulk-unitCost': { value: '1' }, 'cpm-bulk-use-costSince': { checked: true }, 'cpm-bulk-costSince': { value } }), /開始|시작일/);
});
