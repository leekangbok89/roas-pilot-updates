'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8').split('\nfunction render(){')[0];

function harness(){
 const nodes=new Map();
 const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',innerHTML:'',textContent:'',hidden:false,attributes:{},replaceChildren(){this.innerHTML='';},setAttribute(key,value){this.attributes[key]=value;}});return nodes.get(id);};
 const context=vm.createContext({Intl,document:{getElementById:node}});
 vm.runInContext(source,context);
 return {node,run:code=>vm.runInContext(code,context),context};
}

test('saved overview selections become actual table columns, including scope-specific spend and ROAS',()=>{
 const h=harness();
 const columns=JSON.parse(h.run("JSON.stringify(adsTableColumns({columns:['spend','purchases','revenue','roas'],summary:['spend','purchases','revenue','roas','profit']}))"));
 assert.deepEqual(columns.map(column=>column.key),['spend','purchases','revenue','roas','overview-spend','overview-roas','overview-profit']);
 assert.equal(columns.filter(column=>column.key==='purchases').length,1,'A shared ad/overview metric has one column');
 assert.equal(columns.find(column=>column.key==='purchases').overviewKey,'purchases');
 assert.equal(columns.find(column=>column.key==='overview-spend').kind,'period','Total spend is not relabeled as an individual ad');
 assert.equal(columns.find(column=>column.key==='overview-roas').kind,'period');
});

test('all twenty existing overview selections are retained and visible without resetting browser settings',()=>{
 const h=harness();
 const result=JSON.parse(h.run("JSON.stringify((()=>{const saved=normalizeAdsDisplaySettings({version:1,columns:adsColumnMetrics.map(metric=>metric.key),summary:AdsOverviewSummary.metrics.map(metric=>metric.key)});const columns=adsTableColumns(saved);return {saved,keys:columns.map(column=>column.overviewKey).filter(Boolean),count:columns.length};})())"));
 assert.equal(result.saved.summary.length,20);
 assert.equal(result.count,29,'17 ad columns plus 20 overview keys minus eight shared columns');
 assert.equal(new Set(result.keys).size,20);
 assert.deepEqual(result.keys.slice().sort(),result.saved.summary.slice().sort());
});

test('period-only ad cells point to totals while shared columns retain real per-ad values',()=>{
 const h=harness();
 const period=h.run("adsTableCell(adsTableColumns({columns:[],summary:['profit']})[0],{profit:999999,diagnosis:{status:'keep'}})");
 assert.match(period,/data-summary-key="profit"/);
 assert.match(period,/합계 행 참조/);
 assert.doesNotMatch(period,/999999|999,999/,'Store totals must not masquerade as per-ad profit');
 const common=h.run("adsTableCell(adsTableColumns({columns:[],summary:['purchases']})[0],{purchases:3,missing:{},diagnosis:{status:'keep'}})");
 assert.match(common,/data-summary-key="purchases"/);
 assert.match(common,/>3<\/td>/);
});

test('the dedicated total row renders confirmed zero, negative partial profit and missing values distinctly',()=>{
 const h=harness();h.node('since').value='2026-10-01';h.node('until').value='2026-10-03';
 h.run("adsDisplaySaved={version:1,columns:[],summary:['spend','profit','mallRevenue']};adsPeriodViewResult={status:'ready',metrics:[{key:'spend',value:0,scope:'전체 광고',detail:'확인 3/3일'},{key:'profit',value:-10000,partial:true,scope:'위마망',detail:'확인분'},{key:'mallRevenue',value:null,scope:'카페24',detail:'미수집'}],errors:[]};renderAdsPeriodTotal();");
 const html=h.node('ads-period-total').innerHTML;
 assert.equal(h.node('ads-period-total').hidden,false);
 assert.match(html,/id="ads-period-total-row"/);
 assert.match(html,/선택 기간 합계/);
 assert.match(html,/data-summary-key="spend"[^>]*><strong>0원<\/strong>/);
 assert.match(html,/data-summary-key="profit"[^>]*><strong>-10,000원<\/strong><span class="ads-metric-partial">확인분/);
 assert.match(html,/data-summary-key="mallRevenue"[^>]*><strong>—<\/strong>/);
 assert.match(h.node('ads-table-summary-note').textContent,/캠페인·소재·검색 필터와 별도/);
 h.run('adsDisplaySaved.summary=[];renderAdsPeriodTotal();');
 assert.equal(h.node('ads-period-total').hidden,true);
 assert.equal(h.node('ads-period-total').innerHTML,'');
});
