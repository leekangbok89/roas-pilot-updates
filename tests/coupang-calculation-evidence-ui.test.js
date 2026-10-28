'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = fs.readFileSync(path.resolve(__dirname, '../public/coupang-analytics.js'), 'utf8');
function declaration(name) {
  const start = source.indexOf('  function ' + name + '('), end = source.indexOf('\n  }', start);
  assert.ok(start >= 0 && end > start, name); return source.slice(start, end + 4);
}
function context() {
  const context = vm.createContext({});
  const names = ['displayedValue','dailyValue','dailyEstimated','dailyTotal','costWarningText','estimateMissingText','advertisingSourceText','dailyCalculationEvidence','openReferenceImport'];
  const constants = ['sourceNames','isNumber','dailyColumns'].map(name => source.split('\n').find(line => line.trim().startsWith('const ' + name + ' ='))).join('\n');
  vm.runInContext(constants + '\n' + names.map(declaration).join('\n') + '\nglobalThis.h={' + names.join(',') + '};', context);
  return context;
}
test('backend daily report controls each displayed value and estimate marker, including explicit unknowns', () => {
  const { h } = context();
  const row = { profitBeforeAds: 99999, advertising: 999, estimatedProfitBeforeAds: 8000, dailyReport: { profitBeforeAds: 7500, advertising: null, otherCosts: 2222, sourceNetProfit: null, estimated: { profitBeforeAds: true, otherCosts: false } } };
  assert.equal(h.dailyValue(row,'profitBeforeAds'),7500); assert.equal(h.dailyValue(row,'advertising'),null);
  assert.equal(h.dailyValue(row,'sourceNetProfit'),null); assert.equal(h.dailyValue(row,'otherCosts'),2222);
  assert.equal(h.dailyEstimated(row,'profitBeforeAds'),true); assert.equal(h.dailyEstimated(row,'otherCosts'),false);
});
test('canonical period totals preserve backend sums of rounded days and known zero beside missing days', () => {
  const { h } = context(), canonical = { sales:null,otherCosts:null,available:{sales:20000,otherCosts:0},knownDays:{sales:1,otherCosts:1},partial:{sales:true,otherCosts:true},estimated:{sales:false,otherCosts:true},totalDays:2 };
  const result = h.dailyTotal([{ sales:99999,otherCosts:3 }],canonical);
  assert.equal(result.sales,20000); assert.equal(result.otherCosts,0);
  assert.equal(result.knownDays.otherCosts,1); assert.equal(result.partial.otherCosts,true);
  assert.equal(canonical.otherCosts,null,'Formatting known totals must not mutate strict backend totals');
});
test('partial-only sales stay labelled as collected portions instead of one completely known day', () => {
  const c = context(), row = { sales:null, available:{sales:12000}, dailyReport:{sales:12000,partial:{sales:true},estimated:{sales:false}} };
  const total = c.h.dailyTotal([row]);
  assert.equal(total.sales,12000); assert.equal(total.knownDays.sales,0);
  assert.equal(total.availableDays.sales,1); assert.equal(total.partialDays.sales,1); assert.equal(total.partial.sales,true);
  vm.runInContext(`
    const won=value=>String(value)+'원';
    function element(tag,text,className){return{tag,textContent:text,className};}
    function addCell(tr,text){const cell={textContent:text,children:[],append(node){this.children.push(node);}};tr.push(cell);return cell;}
    ${declaration('appendDailyCell')}
    globalThis.appendTest=appendDailyCell;
  `,c);
  const summaryCell = c.appendTest([],total,'sales',true), dayCell = c.appendTest([],row,'sales');
  assert.equal(summaryCell.children.at(-1).textContent,'수집분'); assert.equal(dayCell.children.at(-1).textContent,'수집분');
  assert.match(summaryCell.title,/전체 확인 0일 · 부분 확인 1일.*조회 1일/);
  assert.doesNotMatch(summaryCell.title,/1\/1일 확인/);
});
test('historical whole-day values never create inferred product costs or calibrated profit', () => {
  const { h } = context();
  const evidence = h.dailyCalculationEvidence({ source:'reconciled',sales:100000,profitBeforeAds:60000,advertising:12000,sourceNetProfit:48000,dailyReport:{source:'reconciled',basis:'saved-daily-report',profitBeforeAds:60000,advertising:12000,sourceNetProfit:48000,components:{productCost:null,commission:null,fulfillment:null,estimatedProfitBeforeAds:null}} });
  assert.equal(evidence.components.productCost,null); assert.equal(evidence.calculatedProfit,null); assert.equal(evidence.difference,null);
  assert.equal(evidence.sourceProfit,60000); assert.match(evidence.sourceNote,/역산하거나 배분하지 않습니다/);
});
test('API evidence keeps component differences and missing ads explicit without changing source values', () => {
  const { h } = context(), row = { source:'api',profitBeforeAds:null,advertising:null,sourceNetProfit:null,dailyReport:{source:'api',basis:'api-orders-gross',apiUnconfirmed:true,advertising:null,sourceNetProfit:null,components:{productCost:3000,commission:1000.48,fulfillment:200.48,otherCostsRaw:1200.96,estimatedProfitBeforeAds:5800}} };
  const before = JSON.stringify(row), evidence = h.dailyCalculationEvidence(row);
  assert.match(evidence.advertisingNote,/광고비 자료 없음 · 순이익 계산 대기/);
  assert.match(evidence.sourceNote,/반품·할인·정산이 확정되기 전/);
  assert.equal(evidence.components.otherCostsRaw,1200.96); assert.equal(evidence.sourceProfit,null);
  assert.equal(JSON.stringify(row),before);
  const compared = h.dailyCalculationEvidence({ ...row,source:'sellha',profitBeforeAds:5799,dailyReport:{...row.dailyReport,source:'sellha',basis:'saved-source',differences:{profitBeforeAds:1}} });
  assert.equal(compared.difference,1); assert.equal(compared.calculatedProfit,5800);
});
test('reference shortcut opens and focuses existing import without a file dialog or data request', () => {
  const c = context();
  vm.runInContext("const events=[];const panel={open:false,scrollIntoView(){events.push('scroll')}};const file={focus(){events.push('focus')},click(){throw Error('must not open file dialog')}};const $=id=>id==='ca-import'?panel:file;globalThis.ui={panel,events};",c);
  c.h.openReferenceImport(); assert.equal(c.ui.panel.open,true); assert.deepEqual(Array.from(c.ui.events),['scroll','focus']);
});
test('NCA report evidence identifies account-wide original cost and one further deduction', () => {
  const { h } = context(), row = { source: 'sellha', profitBeforeAds: 54000, advertising: 12000, sourceNetProfit: 42000,
    dailyReport: { sourceNetProfit: 42000, acquisitionAdvertising: 3000, netProfit: 39000,
      advertisingSources: { nca: { source: 'nca-report', scope: 'account', basis: 'report-original-amount', filename: 'example-nca.xlsx', importedAt: '2026-10-28T01:00:00Z' } },
      reasons: ['계정 전체 비용'], components: {} } };
  const evidence = h.dailyCalculationEvidence(row);
  assert.match(evidence.acquisitionNote, /신규구매 광고비를 한 번 차감/);
  assert.match(evidence.advertisingSources[0], /신규구매 보고서 · 계정 전체 · 원본 금액 · example-nca.xlsx/);
  assert.match(evidence.accountCostNote, /현재 선택 상품의 이익에서 전액 차감/);
  assert.deepEqual(Array.from(evidence.reasons), ['계정 전체 비용']);
  const unknown = h.dailyCalculationEvidence({ ...row, dailyReport: { ...row.dailyReport, acquisitionAdvertising: null, netProfit: null } });
  assert.match(unknown.acquisitionNote, /신규구매 광고비 자료 없음/);
});
