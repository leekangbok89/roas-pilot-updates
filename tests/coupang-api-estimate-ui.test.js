'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = fs.readFileSync(path.resolve(__dirname, '../public/coupang-analytics.js'), 'utf8');
function declaration(name) {
  const pattern = new RegExp('^  (?:async )?function ' + name + '\\(', 'm'), match = pattern.exec(source);
  assert.ok(match, name);
  const tail = source.slice(match.index + 1), next = /\n  (?:async )?function /.exec(tail);
  return source.slice(match.index, next ? match.index + 1 + next.index : source.length);
}
function helpers() {
  const context = vm.createContext({});
  const constants = ['channels', 'isNumber', 'summable', 'sum'].map(name => source.split('\n').find(line => line.trim().startsWith('const ' + name + ' ='))).join('\n');
  const names = ['localTimestamp', 'pipelineState', 'estimateMissingText', 'displayedValue', 'availableSum', 'aggregateRows'];
  vm.runInContext(constants + '\n' + names.map(declaration).join('\n') + '\nglobalThis.h={' + names.join(',') + '};', context);
  return context;
}
test('pipeline distinguishes missing connection, running, partial failure and hourly saved-data mode', () => {
  const { h } = helpers();
  assert.equal(h.pipelineState(null).disabled, true);
  const idle = h.pipelineState({ configured: true, automatic: { enabled: true, intervalMinutes: 60 } });
  assert.equal(idle.disabled, false); assert.match(idle.title, /매시간/);
  const running = h.pipelineState({ configured: true, busy: true, automatic: { running: true } });
  assert.equal(running.disabled, true); assert.equal(running.running, true);
  const partial = h.pipelineState({ configured: true, automatic: { status: 'partial', channels: { growth: { status: 'completed' }, seller: { status: 'failed', error: '허용 IP 확인' } } } });
  assert.match(partial.title, /일부 저장/); assert.match(partial.error, /판매자배송: 허용 IP/);
  assert.equal(partial.disabled, false);
  assert.match(h.pipelineState({ configured: true, automatic: { status: 'paused', error: '중단 후 재시작' } }).title, /중단/);
});
test('refresh verification deduplicates delivery dates and keeps any changed date out of unchanged totals', () => {
  const { h } = helpers();
  const state = h.pipelineState({ configured: true, automatic: { status: 'completed', lastCompletedAt: '2026-10-27T12:00:00Z', channels: {
    growth: { verification: { newDays: ['2026-10-27'], changedDays: ['2026-10-25'], unchangedDays: ['2026-10-24', '2026-10-26'] } },
    seller: { verification: { newDays: ['2026-10-27'], changedDays: ['2026-10-26', '2026-10-25'], unchangedDays: ['2026-10-24'] } }
  } } });
  assert.match(state.verification, /신규 저장 1일/);
  assert.match(state.verification, /변경 2일 \(10-25, 10-26\)/);
  assert.match(state.verification, /동일 1일/);
  assert.match(state.verification, /배송 방식별 확인분, 날짜 중복 제외/);
  assert.match(state.detail, /최근 완료/);
  const unchanged = h.pipelineState({ configured: true, automatic: { lastCompletedAt: '2026-10-27T13:00:00Z', channels: { growth: { verification: { unchangedDays: ['2026-10-27'] } } } } });
  assert.match(unchanged.verification, /변경 0일.*동일 1일/);
  assert.notEqual(unchanged.detail, state.detail, 'Verification time must advance even when order data is unchanged');
});
test('estimates aggregate separately from exact source profit and preserve missing cost inputs', () => {
  const { h } = helpers();
  const rows = [
    { sales: 20000, estimatedProductCost: 6000, estimatedCommission: 2000, estimatedFulfillment: 500, estimatedProfitBeforeAds: 11500, sourceNetProfit: null, netProfit: null, advertising: null, missingInputs: [] },
    { sales: 10000, estimatedProductCost: 3000, estimatedCommission: 1000, estimatedFulfillment: 250, estimatedProfitBeforeAds: 5750, sourceNetProfit: null, netProfit: null, advertising: null, missingInputs: [] }
  ];
  let total = h.aggregateRows(rows);
  assert.equal(total.estimatedProfitBeforeAds, 17250); assert.equal(total.estimatedProductCost, 9000);
  assert.equal(total.sourceNetProfit, null); assert.equal(total.netProfit, null); assert.equal(total.advertising, null);
  total = h.aggregateRows([rows[0], { ...rows[1], estimatedProductCost: null, estimatedProfitBeforeAds: null, missingInputs: ['unitCost'], missingInputReasons: ['상품 원가 미등록'] }]);
  assert.equal(total.estimatedProfitBeforeAds, null); assert.equal(total.estimatedProductCost, null);
  assert.match(h.estimateMissingText(total), /상품 원가 미등록/);
  assert.match(h.estimateMissingText({ missingInputs: ['commissionRate', 'deliveryFee'] }), /수수료율 미등록.*배송비 미등록/);
});
test('status polling reloads saved analytics only after a refresh finishes, including first completion', async () => {
  const context = helpers();
  vm.runInContext(`
    let pipelinePending=false,pipelineStopped=false,pipelineNeedsReload=false,pipelineStatus=null,lastRefreshFinishedAt=undefined,lastAdvertisingRevision=undefined,lastHistoryStamp=undefined,loading=false,importSaving=false;
    const calls=[],states=[],loads=[],nodes={};
    const $=id=>nodes[id]||(nodes[id]={});
    async function request(route){calls.push(route);return states.shift();}
    function renderPipeline(value){pipelineStatus=value;return pipelineState(value);}
    function schedulePipeline(){}
    async function load(){loads.push('saved analytics');}
    ${declaration('loadPipelineStatus')}
    globalThis.flow={calls,states,loads,loadPipelineStatus};
  `, context);
  const { flow } = context;
  flow.states.push({ configured: true, automatic: { running: true, lastFinishedAt: null } });
  await flow.loadPipelineStatus(); assert.equal(flow.loads.length, 0);
  flow.states.push({ configured: true, automatic: { running: false, status: 'completed', lastFinishedAt: '2026-10-27T10:00:00Z' } });
  await flow.loadPipelineStatus(); assert.equal(flow.loads.length, 1);
  flow.states.push({ configured: true, automatic: { running: false, status: 'completed', lastFinishedAt: '2026-10-27T10:00:00Z' } });
  await flow.loadPipelineStatus(); assert.equal(flow.loads.length, 1);
  assert.ok(Array.from(flow.calls).every(route => route === 'status'), 'Polling must not start any API collection');
});
test('manual refresh sends one collection request while in flight and keeps saved data available', async () => {
  const context = helpers();
  vm.runInContext(`
    let pipelineRefreshing=false,pipelineStatus={configured:true,automatic:{enabled:true}};
    const calls=[],nodes={};let finish;
    const $=id=>nodes[id]||(nodes[id]={});
    function message(){}
    function schedulePipeline(){}
    function renderPipeline(value){pipelineStatus=value;return pipelineState(value);}
    async function request(route){calls.push(route);return new Promise(resolve=>{finish=resolve;});}
    async function loadPipelineStatus(){calls.push('status');}
    ${declaration('refreshOrders')}
    globalThis.manual={calls,nodes,refreshOrders,complete:()=>finish({started:true,automatic:{running:true,status:'running'}})};
  `, context);
  const { manual } = context;
  const first = manual.refreshOrders(); await manual.refreshOrders();
  assert.equal(manual.calls.length, 1); assert.equal(manual.calls[0], 'refresh');
  assert.equal(manual.nodes['ca-refresh-orders'].disabled, true);
  manual.complete(); await first;
  assert.deepEqual(Array.from(manual.calls), ['refresh', 'status']);
});
test('saved advertising revisions trigger analytics reload and wait for active imports', async () => {
  const context = helpers();
  vm.runInContext(`
    let pipelinePending=false,pipelineStopped=false,pipelineNeedsReload=false,pipelineStatus=null,lastRefreshFinishedAt=undefined,lastAdvertisingRevision=undefined,lastHistoryStamp=undefined,loading=false,importSaving=false;
    const calls=[],states=[],loads=[],nodes={};
    const $=id=>nodes[id]||(nodes[id]={});
    async function request(route){calls.push(route);return states.shift();}
    function renderPipeline(value){pipelineStatus=value;return pipelineState(value);}
    function schedulePipeline(){}
    async function load(){loads.push('saved analytics');}
    ${declaration('loadPipelineStatus')}
    globalThis.flow={states,loads,loadPipelineStatus,setSaving:value=>{importSaving=value;}};
  `, context);
  const { flow } = context, status = advertisingRevision => ({ configured: true, advertisingRevision, automatic: { running: false } });
  flow.states.push(status(null)); await flow.loadPipelineStatus(); assert.equal(flow.loads.length, 0);
  flow.states.push(status(null)); await flow.loadPipelineStatus(); assert.equal(flow.loads.length, 0);
  flow.states.push(status('a')); await flow.loadPipelineStatus(); assert.equal(flow.loads.length, 1, 'First saved report must reload even without a same-origin storage event');
  flow.states.push(status('a')); await flow.loadPipelineStatus(); assert.equal(flow.loads.length, 1);
  flow.states.push(status('b')); await flow.loadPipelineStatus(); assert.equal(flow.loads.length, 2);
  flow.setSaving(true); flow.states.push(status('c')); await flow.loadPipelineStatus(); assert.equal(flow.loads.length, 2);
  flow.setSaving(false); flow.states.push(status('c')); await flow.loadPipelineStatus(); assert.equal(flow.loads.length, 3);
  flow.states.push({ configured: true, automatic: {} }); await flow.loadPipelineStatus(); assert.equal(flow.loads.length, 3);
});
test('advertising storage events reload only overlapping dates and defer during saved imports', () => {
  const context = helpers();
  vm.runInContext(`
    let pipelineNeedsReload=false,loading=false,importSaving=false;
    const loads=[],scheduled=[];
    function queryValues(){return{since:'2026-10-22',until:'2026-10-26'};}
    function load(){loads.push('saved analytics');}
    function schedulePipeline(value){scheduled.push(value);}
    ${declaration('handleAdvertisingStorage')}
    globalThis.events={loads,scheduled,handleAdvertisingStorage,setSaving:value=>{importSaving=value;},pending:()=>pipelineNeedsReload};
  `, context);
  const { events } = context, change = dates => ({ key: 'roas-coupang-ad-reports-change', newValue: JSON.stringify({ type: 'nca', dates }) });
  events.handleAdvertisingStorage({ key: 'other', newValue: '{}' });
  events.handleAdvertisingStorage({ key: 'roas-coupang-ad-reports-change', newValue: 'broken' });
  events.handleAdvertisingStorage(change(['2026-10-21'])); assert.equal(events.loads.length, 0);
  events.handleAdvertisingStorage(change(['2026-10-22'])); assert.equal(events.loads.length, 1);
  events.setSaving(true); events.handleAdvertisingStorage(change(['2026-10-23'])); assert.equal(events.loads.length, 1);
  assert.equal(events.pending(), true); assert.deepEqual(Array.from(events.scheduled), [true]);
});
