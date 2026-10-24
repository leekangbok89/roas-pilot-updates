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
 assert.equal(columns.find(column=>column.key==='overview-spend').kind,'adScoped','Total spend keeps the period total and also exposes each ad spend');
 assert.equal(columns.find(column=>column.key==='overview-spend').sourceKey,'spend');
 assert.equal(columns.find(column=>column.key==='overview-roas').kind,'adScoped');
 assert.equal(columns.find(column=>column.key==='overview-roas').sourceKey,'roas');
});

test('all twenty existing overview selections are retained and visible without resetting browser settings',()=>{
 const h=harness();
 const result=JSON.parse(h.run("JSON.stringify((()=>{const saved=normalizeAdsDisplaySettings({version:1,columns:adsColumnMetrics.map(metric=>metric.key),summary:AdsOverviewSummary.metrics.map(metric=>metric.key)});const columns=adsTableColumns(saved);return {saved,keys:columns.map(column=>column.overviewKey).filter(Boolean),count:columns.length};})())"));
 assert.equal(result.saved.summary.length,20);
 assert.equal(result.count,29,'17 ad columns plus 20 overview keys minus eight shared columns');
 assert.equal(new Set(result.keys).size,20);
 assert.deepEqual(result.keys.slice().sort(),result.saved.summary.slice().sort());
});

test('ad-capable overview cells show real per-ad values while store totals remain period-only',()=>{
 const h=harness();
 const period=h.run("adsTableCell(adsTableColumns({columns:[],summary:['profit']})[0],{profit:999999,diagnosis:{status:'keep'}})");
 assert.match(period,/data-summary-key="profit"/);
 assert.match(period,/기간 합계 전용/);
 assert.doesNotMatch(period,/999999|999,999/,'Store totals must not masquerade as per-ad profit');

 const spend=h.run("adsTableCell(adsTableColumns({columns:[],summary:['spend']})[0],{channel:'naver',spend:123456,spendPartial:false,diagnosis:{status:'keep'}})");
 assert.match(spend,/data-summary-key="spend"/);
 assert.match(spend,/123,456원/);
 assert.doesNotMatch(spend,/합계 행 참조|기간 합계 전용/);

 const mallRoas=h.run("adsTableCell(adsTableColumns({columns:[],summary:['mallRoas']})[0],{channel:'cafe',roas:62.5,roasPartial:false,diagnosis:{status:'keep'}})");
 assert.match(mallRoas,/62\.5%/);
 const mallRoasOther=h.run("adsTableCell(adsTableColumns({columns:[],summary:['mallRoas']})[0],{channel:'naver',roas:88.8,roasPartial:false,diagnosis:{status:'keep'}})");
 assert.match(mallRoasOther,/>—<\/td>/);

 const common=h.run("adsTableCell(adsTableColumns({columns:[],summary:['purchases']})[0],{purchases:3,missing:{},diagnosis:{status:'keep'}})");
 assert.match(common,/data-summary-key="purchases"/);
 assert.match(common,/>3<\/td>/);
});

test('campaign average row uses per-ad means for absolute values and aggregate ratios for efficiency metrics',()=>{
 const h=harness();
 h.node('since').value='2026-10-01';h.node('until').value='2026-10-03';
 h.run("adsDisplaySaved={version:1,columns:['spend','purchases','revenue','roas','cpa','cpc','cpm','ctr'],summary:[]};adsCampaignAverageScope='캠페인 A';adsCampaignAverageRows=[{channel:'naver',spend:100000,purchases:2,revenue:300000,clicks:100,impressions:10000,landing:80,spendPartial:false,roasPartial:false,cpaPartial:false,missing:{}},{channel:'naver',spend:300000,purchases:4,revenue:600000,clicks:200,impressions:20000,landing:160,spendPartial:false,roasPartial:false,cpaPartial:false,missing:{}}];renderAdsPeriodTotal();");
 const html=h.node('ads-period-total').innerHTML;
 assert.match(html,/id="ads-campaign-average-row"/);
 assert.match(html,/캠페인 광고 평균/);
 assert.match(html,/캠페인 A · 광고 2개/);
 assert.match(html,/data-metric="spend"[^>]*><strong>200,000원<\/strong>/,'Spend is average spend per ad');
 assert.match(html,/data-metric="purchases"[^>]*><strong>3<\/strong>/,'Purchases are average purchases per ad');
 assert.match(html,/data-metric="revenue"[^>]*><strong>450,000원<\/strong>/,'Revenue is average revenue per ad');
 assert.match(html,/data-metric="roas"[^>]*><strong>225%<\/strong>/,'ROAS is total revenue divided by total spend, not mean of ad ROAS');
 assert.match(html,/data-metric="cpa"[^>]*><strong>66,667원<\/strong>/);
 assert.match(html,/data-metric="cpc"[^>]*><strong>1,333원<\/strong>/);
 assert.match(html,/data-metric="cpm"[^>]*><strong>13,333원<\/strong>/);
 assert.match(html,/data-metric="ctr"[^>]*><strong>1%<\/strong>/);
 assert.match(h.node('ads-table-summary-note').textContent,/광고 1개당 평균/);
 assert.match(h.node('ads-table-summary-note').textContent,/캠페인 합계에서 다시 계산/);
});

test('campaign average keeps channel-scoped overview metrics on their own channel and store totals out of averages',()=>{
 const h=harness();
 h.run("adsDisplaySaved={version:1,columns:[],summary:['mallRoas','smartstoreRoas','profit']};adsCampaignAverageScope='전체 캠페인';adsCampaignAverageRows=[{channel:'naver',spend:100000,revenue:200000,roas:200,spendPartial:false,roasPartial:false,missing:{}},{channel:'cafe',spend:300000,revenue:900000,roas:300,spendPartial:false,roasPartial:false,missing:{}}];renderAdsPeriodTotal();");
 const html=h.node('ads-period-total').innerHTML;
 assert.match(html,/data-metric="overview-mallRoas"[^>]*><strong>300%<\/strong>/);
 assert.match(html,/data-metric="overview-smartstoreRoas"[^>]*><strong>200%<\/strong>/);
 assert.match(html,/data-metric="overview-profit"[^>]*>—<\/td>/,'Store profit remains period-only in the average row');
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
 assert.match(h.node('ads-table-summary-note').textContent,/선택 기간과 각 지표의 집계 범위를 따릅니다/);
 h.run('adsDisplaySaved.summary=[];renderAdsPeriodTotal();');
 assert.equal(h.node('ads-period-total').hidden,true);
 assert.equal(h.node('ads-period-total').innerHTML,'');
});
