'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = fs.readFileSync(path.resolve(__dirname, '../public/coupang-analytics.js'), 'utf8');
function declaration(name) {
  const start = new RegExp('^  (?:async )?function ' + name + '\\(', 'm').exec(source);
  assert.ok(start, name); const end = source.indexOf('\n  }', start.index);
  assert.ok(end > start.index); return source.slice(start.index, end + 4);
}
const product = (values = {}) => ({ itemId: '123', name: '예시 상품', unitCost: 0, commissionRate: 10, inboundFee: 100, deliveryFee: 200, costSince: '2026-10-01', ...values });
const row = { itemId: '123', productId: '456', channel: 'growth', name: '예시 상품', quantity: 2, sales: 20000, profitBeforeAds: 10000, advertising: 1000 };
function context() {
  const context = vm.createContext({});
  vm.runInContext(`
    const isNumber=value=>typeof value==='number'&&Number.isFinite(value),today='2026-10-27';
    const number=value=>String(value);
    let parseSequence=0,importSaving=false,pendingImport=null;
    const nodes={},calls=[],rendered=[],messages=[];
    const $=id=>nodes[id]||(nodes[id]={disabled:false,value:'',checked:true,replaceChildren(){}});
    function message(value){messages.push(value);}
    function renderImportPreview(reports,dailyTotals,catalog){rendered.push({reports,dailyTotals,catalog});}
    function configureImportAcquisition(){}
    function markPreset(){}
    async function load(){}
    async function request(route,body){calls.push({route,body});return route==='status'?{configured:true,products:[{itemId:'123'}]}:{reports:[],catalogImported:1,catalogZeroCosts:1};}
    ${['normalizeImportProducts','normalizeImportReports','normalizeDailyTotals','catalogPreviewStats','previewImport','saveImport','costWarningText'].map(declaration).join('\n')}
    globalThis.h={normalizeImportProducts,catalogPreviewStats,previewImport,saveImport,costWarningText,nodes,calls,rendered,messages,setPending:value=>{pendingImport=value;},getPending:()=>pendingImport};
  `, context);
  return context.h;
}
test('catalogue preview preserves typed source zero and separates matches and positive costs', () => {
  const h = context(), input = [product(), product({ itemId: '456', unitCost: 5000 })], copy = JSON.stringify(input);
  const products = h.normalizeImportProducts(input), stats = h.catalogPreviewStats(products, [{ itemId: '123' }]);
  assert.equal(products[0].unitCost, 0); assert.equal(typeof products[0].unitCost, 'number');
  assert.equal(JSON.stringify(input), copy);
  assert.equal(stats.positive, 1); assert.equal(stats.zero, 1); assert.equal(stats.matched, 1); assert.equal(stats.added, 1);
  assert.equal(h.normalizeImportProducts(undefined), undefined);
  for (const bad of [null, [], [product({ unitCost: null })], [product({ unitCost: '0' })], [product(), product()], [product({ commissionRate: 101 })], [product({ costSince: '2026-10-01T00:00:00Z' })]]) assert.throws(() => h.normalizeImportProducts(bad));
});
test('prepared file preview retains optional catalogue and rejects invalid costs before any save', async () => {
  const h = context(), file = { name: 'prepared.json', size: 1000, text: async () => JSON.stringify({ schema: 'roas-coupang-sales-v1', reports: [{ date: '2026-10-22', rows: [row] }], products: [product()] }) };
  h.nodes['ca-file'] = { files: [file] }; await h.previewImport();
  assert.equal(h.getPending().products[0].unitCost, 0); assert.equal(h.rendered[0].catalog.zero, 1); assert.equal(h.rendered[0].catalog.matched, 1);
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].route, 'status'); assert.equal(h.calls[0].body, undefined);
  file.text = async () => JSON.stringify({ schema: 'roas-coupang-sales-v1', reports: [{ date: '2026-10-22', rows: [row] }], products: [product({ unitCost: null })] });
  h.calls.length = 0; await h.previewImport();
  assert.equal(h.getPending(), null); assert.equal(h.nodes['ca-save'].disabled, true); assert.equal(h.calls.length, 0);
  assert.match(h.messages.at(-1), /原|원가/);
});
test('save forwards source-zero catalogue once and refuses incompatible inclusion settings without POST', async () => {
  const h = context(), pending = { reports: [{ date: '2026-10-22', rows: [row] }], products: [product()] };
  h.setPending(pending); h.nodes['ca-include-products'] = { checked: false };
  await h.saveImport(); assert.equal(h.calls.length, 0); assert.match(h.messages.at(-1), /모든 옵션/);
  h.nodes['ca-include-products'].checked = true; await h.saveImport();
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].route, 'sales-import-batch');
  assert.equal(h.calls[0].body.products[0].unitCost, 0); assert.equal(h.calls[0].body.includeProducts, true);
  assert.equal(h.getPending(), null);
  assert.match(h.nodes['ca-import-status'].textContent, /원가·수수료·배송비 1개 갱신.*원본 0원 1개/);
});
test('daily totals without option reports retain the parent catalogue wrapper through one atomic save', async () => {
  const h = context(), daily = { date: '2026-10-23', sales: 20000, profitBeforeAds: 10000, advertising: 1000, otherCosts: 2000 };
  const file = { name: 'prepared.json', size: 1000, text: async () => JSON.stringify({ schema: 'roas-coupang-sales-v1', reports: [], dailyTotals: [daily], catalog: { products: [product()] } }) };
  h.nodes['ca-file'] = { files: [file] }; await h.previewImport();
  assert.equal(h.getPending().reports.length, 0); assert.equal(h.getPending().dailyTotals.length, 1);
  assert.equal(h.getPending().products[0].unitCost, 0); assert.equal(h.rendered[0].catalog.zero, 1);
  h.calls.length = 0; await h.saveImport();
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].route, 'sales-import-batch');
  assert.equal(h.calls[0].body.reports.length, 0); assert.equal(h.calls[0].body.dailyTotals[0].otherCosts, 2000);
  assert.equal(h.calls[0].body.products[0].unitCost, 0); assert.equal(h.nodes['ca-since'].value, daily.date);
});
test('zero-cost notices remain distinct from an unknown cost', () => {
  const h = context();
  assert.equal(h.costWarningText({ unitCost: null }), '');
  assert.match(h.costWarningText({ unitCost: 0, zeroCostItemIds: ['123', '123'] }), /원본 원가 0원 옵션 1개.*실제 원가 확인/);
});
