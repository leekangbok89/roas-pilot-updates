'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const html=fs.readFileSync(path.join(__dirname,'../public/visual-overview.html'),'utf8');
const source=html.match(/<script>([\s\S]*?)<\/script>/)[1].split('\nlet now=new Date();')[0];

class Element{
 constructor(){this.value='';this.style={};this.children=[];this.attributes={};this.events={};this.dataset={};this._html='';this._text='';this.offsetWidth=220;this.offsetHeight=80;this.clientWidth=1020;this.clientHeight=310;this.clientLeft=0;this.clientTop=0;this.classList={toggle(){}};}
 set innerHTML(value){this._html=value;this.children=[];this._queries={};}
 get innerHTML(){return this._html;}
 set textContent(value){this._text=value;this.children=[];}
 get textContent(){return this._text;}
 setAttribute(key,value){this.attributes[key]=String(value);}
 removeAttribute(key){delete this.attributes[key];}
 append(...nodes){this.children.push(...nodes);}
 replaceChildren(...nodes){this.children=nodes;}
 querySelector(selector){this._queries??={};return this._queries[selector]??=new Element();}
 querySelectorAll(){return [];}
 addEventListener(name,handler){this.events[name]=handler;}
 getBoundingClientRect(){return {left:0,top:0,width:1020,height:310};}
 getScreenCTM(){return {a:1,b:0,c:0,d:1,e:0,f:0,inverse(){return this;}};}
 createSVGPoint(){return {x:0,y:0,matrixTransform(m){return {x:m.a*this.x+m.c*this.y+m.e,y:m.b*this.x+m.d*this.y+m.f};}};}
}
function harness({ids={naver:'111',cafe:'222'},fetch=async()=>{throw Error('unexpected fetch');},confirm=()=>true,timer=setTimeout}={}){
 const nodes=new Map();
 const descendant=(root,id)=>root.id===id?root:root.children.map(child=>descendant(child,id)).find(Boolean);
 const node=id=>{for(const root of nodes.values()){const found=descendant(root,id);if(found)return found;}if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);};
 const context=vm.createContext({console,Intl,URLSearchParams,AbortSignal,fetch,confirm,setTimeout:timer,localStorage:{getItem:key=>key==='roas-account-ids'?JSON.stringify(ids):null,setItem(){}},document:{getElementById:node,querySelectorAll:()=>[],createElement:()=>new Element(),createElementNS:()=>new Element()}});
 node('channel').value='all';node('chart-window').value='1';node('chart-scale').value='relative';node('since').value='2026-09-01';node('until').value='2026-09-03';node('budget-step').value='20000';
 vm.runInContext(source,context);
 vm.runInContext("activeMetricKeys=['profit'];",context);
 return {context,node,run:code=>vm.runInContext(code,context)};
}
const profit=(date,value,extras={})=>({date,revenue:100000,fee:7000,cost:40000,adSpend:53000-value,profit:value,complete:value!=null,reasons:[],naver:{revenue:100000},cafe24:{revenue:0},...extras});

test('summary card settings recover exactly twelve valid slots and preserve a chosen order',()=>{
 const h=harness();
 h.context.settings=['profit','cost','fee','cpc','cpm','__proto__',null,42,'mallRevenue','smartstoreRevenue','profit','ctr','revenue'];
 const keys=JSON.parse(h.run('JSON.stringify(normalizeSummaryCardKeys(settings))'));
 assert.deepEqual(keys,['profit','cost','fee','cpc','cpm','ctr','impressions','clicks','mallRevenue','smartstoreRevenue','profit','ctr']);
 assert.equal(h.run('normalizeSummaryCardKeys({length:12}).length'),12);
 h.context.settings=['profit','','spend','','totalStoreRevenue','','ctr','','clicks','','',''];
 assert.deepEqual(JSON.parse(h.run('JSON.stringify(normalizeSummaryCardKeys(JSON.parse(JSON.stringify(settings))))')),h.context.settings,'Explicit empty slots survive saved-layout normalization without being replaced by defaults');
 assert.deepEqual(JSON.parse(h.run('JSON.stringify(normalizeSummaryCardKeys(Array(12).fill("")))')),Array(12).fill(''),'All twelve slots may intentionally be empty');
 h.node('since').value='2026-09-29';h.node('until').value='2026-10-02';
 assert.deepEqual(JSON.parse(h.run('JSON.stringify(summarySelectedDates())')),['2026-09-29','2026-09-30','2026-10-01','2026-10-02']);
 h.node('until').value='2026-09-28';assert.equal(h.run('summarySelectedDates().length'),0);
});

test('summary financial cards count the entire selected range and retain confirmed partials, zero and losses',()=>{
 const h=harness();h.context.input=[
  profit('2026-09-01',0,{revenue:100000,fee:7000,cost:40000,naver:{revenue:100000},cafe24:{revenue:0}}),
  profit('2026-09-02',null,{revenue:null,fee:null,cost:null,confirmedAvailable:true,confirmed:{revenue:50000,fee:3500,cost:30000,profit:-2000},naver:{revenue:null,confirmedAvailable:true,confirmed:{revenue:50000}},cafe24:{revenue:null}})
 ];
 h.run('profitDays=new Map(input.map(p=>[p.date,p]));');
 for(const [key,amount] of [['totalStoreRevenue',150000],['profit',-2000],['fee',10500],['cost',70000]]){
  h.context.metricKey=key;const metric=JSON.parse(h.run('JSON.stringify(summaryMetric(metricKey))'));
  assert.equal(metric.value,amount);assert.equal(metric.partial,true);
  assert.equal(metric.knownDays,2);assert.equal(metric.completeDays,1);assert.equal(metric.totalDays,3);
 }
 const cafe=JSON.parse(h.run("JSON.stringify(summaryMetric('mallRevenue'))"));
 assert.equal(cafe.value,0);assert.equal(cafe.knownDays,1);assert.equal(cafe.partial,true);
 h.node('channel').value='naver';assert.equal(h.run("summaryMetric('profit').value"),-2000);
 h.run('profitDays.clear();');assert.equal(h.run("summaryMetric('totalStoreRevenue').value"),null);
});

test('summary advertising cards distinguish not loaded, verified empty, and a missing account',()=>{
 const h=harness();
 assert.equal(h.run("summaryMetric('spend').value"),null);
 h.run("connectedAccounts={naver:'111',cafe:'222'};summaryAdLoadedAccounts=new Set(['111','222']);dataCoverage={since:'2026-09-01',until:'2026-09-03',sources:{meta:{'111':{missingDays:[]},'222':{missingDays:[]}}}};");
 for(const key of ['spend','purchases','impressions','clicks']){
  h.context.metricKey=key;const metric=JSON.parse(h.run('JSON.stringify(summaryMetric(metricKey))'));
  assert.equal(metric.value,0);assert.equal(metric.partial,false);assert.equal(metric.completeDays,3);
 }
 for(const key of ['roas','cpa','cpc','cpm','ctr']){h.context.metricKey=key;assert.equal(h.run('summaryMetric(metricKey).value'),null);}
 h.run("summaryAdLoadedAccounts.delete('222');dataCoverage.sources.meta['222'].missingDays=['2026-09-01','2026-09-02','2026-09-03'];");
 const partial=JSON.parse(h.run("JSON.stringify(summaryMetric('spend'))"));
 assert.equal(partial.value,0);assert.equal(partial.partial,true);assert.equal(partial.completeDays,0);
 h.run('summaryAdLoadedAccounts.clear();');assert.equal(h.run("summaryMetric('spend').value"),null);
});

test('summary ratios use matching confirmed ad rows and deduplicate a shared account',()=>{
 const h=harness();h.node('until').value='2026-09-02';
 h.run("connectedAccounts={naver:'111',cafe:'111'};data.naver=[{date:'2026-09-01',spend:100,revenue:500,purchases:2,clicks:10,impressions:1000},{date:'2026-09-02',spend:900,revenue:null,purchases:null,clicks:90,impressions:9000}];data.cafe=data.naver;");
 assert.equal(h.run("summaryMetric('spend').value"),1000);
 assert.equal(h.run("summaryMetric('revenue').value"),500);
 assert.equal(h.run("summaryMetric('roas').value"),500);
 assert.equal(h.run("summaryMetric('cpa').value"),50);
 assert.equal(h.run("summaryMetric('roas').partial"),true);
 assert.equal(h.run("summaryMetric('cpc').value"),10);
 assert.equal(h.run("summaryMetric('cpm').value"),100);
 assert.equal(h.run("summaryMetric('ctr').value"),1);
});

test('three ROAS cards keep fixed scopes and use the spend-weighted ratio after currency conversion',()=>{
 const h=harness();h.node('until').value='2026-09-01';
 h.run("connectedAccounts={naver:'111',cafe:'222'};rates=1350;data.naver=[normalize({date_start:'2026-09-01',spend:'100',account_currency:'USD',actions:[{action_type:'purchase',value:'1'}],action_values:[{action_type:'purchase',value:'500'}]},'naver')];data.cafe=[normalize({date_start:'2026-09-01',spend:'45000',account_currency:'KRW',actions:[{action_type:'purchase',value:'1'}],action_values:[{action_type:'purchase',value:'90000'}]},'cafe')];profitDays=new Map([['2026-09-01',{revenue:99999999,complete:true}]]);");
 for(const [channel,spend] of [['all',180000],['naver',135000],['cafe',45000]]){
  h.node('channel').value=channel;
  for(const [key,expected] of [['roas',425],['mallRoas',200],['smartstoreRoas',500]]){
   h.context.metricKey=key;
   const metric=JSON.parse(h.run('JSON.stringify(summaryMetric(metricKey))'));
   assert.equal(metric.value,expected,key+' must not follow the global '+channel+' filter');
   assert.equal(metric.partial,false);assert.equal(metric.completeDays,1);assert.equal(metric.totalDays,1);
  }
  assert.equal(h.run("summaryMetric('spend').value"),spend,'Other advertising cards keep the selected-channel scope');
 }
 assert.notEqual(h.run("summaryMetric('roas').value"),(500+200)/2,'Total ROAS is never a simple average of channel percentages');
 assert.match(h.run("summaryMetric('mallRoas').scope"),/자사몰|카페24/);
 assert.match(h.run("summaryMetric('smartstoreRoas').scope"),/스마트스토어/);
});

test('channel ROAS retains explicit zero revenue and identifies incomplete dates without inventing returns',()=>{
 const h=harness();
 h.run("connectedAccounts={naver:'111',cafe:'222'};summaryAdLoadedAccounts=new Set(['111','222']);dataCoverage={since:'2026-09-01',until:'2026-09-03',sources:{meta:{'111':{missingDays:[]},'222':{missingDays:['2026-09-02']}}}};data.naver=[{date:'2026-09-01',spend:100,revenue:400,purchases:1,clicks:10,impressions:1000},{date:'2026-09-02',spend:900,revenue:null,purchases:null,clicks:10,impressions:1000}];data.cafe=[{date:'2026-09-01',spend:200,revenue:0,purchases:0,clicks:10,impressions:1000}];");
 for(const [key,expected] of [['roas',400/300*100],['mallRoas',0],['smartstoreRoas',400]]){
  h.context.metricKey=key;
  const metric=JSON.parse(h.run('JSON.stringify(summaryMetric(metricKey))'));
  assert.equal(metric.value,expected);assert.equal(metric.partial,true);assert.equal(metric.knownDays,2);assert.equal(metric.completeDays,2);assert.equal(metric.totalDays,3);
 }
 h.run('data.cafe[0].spend=0;');
 assert.equal(h.run("summaryMetric('mallRoas').value"),null,'Zero spend cannot produce an infinite ROAS');
 h.run('data.cafe[0].spend=200;data.cafe[0].revenue=null;');
 assert.equal(h.run("summaryMetric('mallRoas').value"),null,'Unknown purchase revenue must not turn into a zero-percent ROAS');
});

test('a shared account is not presented as separate channel ROAS and an unconnected channel stays unknown',()=>{
 const h=harness();h.node('until').value='2026-09-01';
 h.run("connectedAccounts={naver:'111',cafe:'111'};data.naver=[{date:'2026-09-01',spend:100,revenue:500,purchases:1,clicks:10,impressions:1000}];data.cafe=data.naver;");
 assert.equal(h.run("summaryMetricContext('all').selected.length"),1);
 assert.equal(h.run("summaryMetric('roas').value"),500);
 for(const key of ['mallRoas','smartstoreRoas']){
  h.context.metricKey=key;const metric=JSON.parse(h.run('JSON.stringify(summaryMetric(metricKey))'));
  assert.equal(metric.value,null);assert.match(metric.detail,/동일 광고계정.*구분/);
 }
 h.run("connectedAccounts.cafe='';data.cafe=[];");
 assert.equal(h.run("summaryMetric('roas').value"),500);
 assert.equal(h.run("summaryMetric('smartstoreRoas').value"),500);
 assert.equal(h.run("summaryMetric('mallRoas').value"),null);
 assert.match(h.run("summaryMetric('mallRoas').detail"),/미연결/);
});

test('saved total ROAS and empty slots remain valid beside both new channel choices',()=>{
 const h=harness();
 h.context.settings=['roas','mallRoas','smartstoreRoas','','profit','','','','','','',''];
 assert.deepEqual(JSON.parse(h.run('JSON.stringify(normalizeSummaryCardKeys(settings))')),h.context.settings);
 assert.equal(h.run("summaryCardMetrics.roas.label"),'총 광고 ROAS');
 assert.equal(h.run("summaryCardMetrics.mallRoas.label"),'자사몰 광고 ROAS');
 assert.equal(h.run("summaryCardMetrics.smartstoreRoas.label"),'스마트스토어 광고 ROAS');
 assert.deepEqual(JSON.parse(h.run('JSON.stringify(summaryDefaultCardKeys)')),['spend','revenue','roas','cpa','purchases','ctr','impressions','clicks','smartstoreRevenue','mallRevenue','totalStoreRevenue','profit']);
});

test('backend zero, negative, and positive profits reach the same graph and table without sales or insight rows',()=>{
 const h=harness();h.context.input=[profit('2026-09-01',20000),profit('2026-09-02',0),profit('2026-09-03',-12000)];
 h.run('profitDays=new Map(input.map(p=>[p.date,p]));render();');
 assert.match(h.node('graph').innerHTML,/<path data-metric="profit"/);
 assert.match(h.node('graph').innerHTML,/09-02 · 통합 예상 이익: 0원/);
 assert.match(h.node('graph').innerHTML,/-12,000원/);
 assert.match(h.node('profit-table').innerHTML,/>0원<\/td>/);
 assert.match(h.node('profit-table').innerHTML,/>-12,000원<\/td>/);
 assert.equal(h.node('profit-total').textContent,'8,000원');
 h.node('channel').value='naver';h.run('render();');
 assert.equal(h.node('profit-total').textContent,'8,000원');
 assert.match(h.node('profit-chart-status').textContent,/3\/3일 계산/);
});

test('3/5/7-day buckets clip query edges and month ends without treating internal missing days as zero',()=>{
 const h=harness();
 for(const size of [3,5,7]){
  h.context.size=size;h.context.rows=Array.from({length:size-1},(_,i)=>({date:'2026-09-'+String(i+2).padStart(2,'0'),profit:(i+1)*100}));
  const result=JSON.parse(h.run("JSON.stringify(chartBuckets(rows,size,rows[0].date,rows.at(-1).date).map(b=>({value:metricForBucket(b,'profit'),length:b.length,label:b.label})))"));
  assert.equal(result.length,1);assert.equal(result[0].length,size-1);assert.equal(result[0].value,size*50);
 }
 h.context.rows=[{date:'2026-09-29',profit:100},{date:'2026-09-30',profit:300}];
 assert.equal(h.run("metricForBucket(chartBuckets(rows,3,'2026-09-29','2026-09-30')[0],'profit')"),200);
 h.context.rows=[{date:'2026-09-01',profit:100},{date:'2026-09-03',profit:300}];
 assert.equal(h.run("metricForBucket(chartBuckets(rows,3,'2026-09-01','2026-09-03')[0],'profit')"),200);
 h.context.rows=[{date:'2026-09-01',profit:100},{date:'2026-09-02',profit:null},{date:'2026-09-03',profit:300}];
 assert.equal(h.run("metricForBucket(chartBuckets(rows,3,'2026-09-01','2026-09-03')[0],'profit')"),200);
});

test('an isolated profit point remains visible beyond 35 plotted dates and unknown days remain gaps',()=>{
 const h=harness();h.node('since').value='2026-01-01';h.node('until').value='2026-02-09';
 h.context.rows=Array.from({length:40},(_,i)=>({date:new Date(Date.UTC(2026,0,i+1)).toISOString().slice(0,10),profit:i===20?-5000:null}));
 h.run('draw(rows);');
 const svg=h.node('graph').innerHTML;
 assert.match(svg,/<circle data-metric="profit" data-point-date="2026-01-21"/);
 assert.equal((svg.match(/<circle data-metric="profit"/g)||[]).length,1);
 assert.doesNotMatch(svg,/NaN|Infinity/);
});

test('missing profit displays actionable reason without manufacturing a zero-profit line',()=>{
 const h=harness();h.context.input=[profit('2026-09-01',null,{cost:null,reasons:['스마트스토어: 상품·옵션 원가 미확정 1건']})];
 h.run('profitDays=new Map(input.map(p=>[p.date,p]));render();');
 assert.doesNotMatch(h.node('graph').innerHTML,/<path data-metric="profit"/);
 assert.match(h.node('profit-chart-diagnostic').children.flatMap(x=>[x.textContent,...x.children.map(y=>y.textContent)]).join(' '),/상품·옵션 원가 미확정 1건/);
 assert.equal(h.node('profit-total').textContent,'산출 불가');
});

test('channel-filtered load refreshes both accounts then renders canonical combined profit even if sales endpoint fails',async()=>{
 const calls=[];
 const h=harness({fetch:async url=>{
  const u=new URL(url,'http://localhost');calls.push(u);
  if(u.pathname==='/api/insights')return {ok:true,json:async()=>({currency:'KRW',rows:[],cache:{missingDays:[],warnings:[]}})};
  if(u.pathname==='/api/sales/compare')return {ok:false,json:async()=>({error:'sales temporarily unavailable'})};
  if(u.pathname==='/api/profit/daily')return {ok:true,json:async()=>({fees:{naver:7,cafe24:3.5},days:[profit('2026-09-01',53000,{adSpend:0})]})};
  throw Error('unexpected endpoint');
 }});
 h.node('channel').value='naver';await h.run('run()');
 assert.deepEqual(calls.filter(u=>u.pathname==='/api/insights').map(u=>u.searchParams.get('account')).sort(),['111','222']);
 const p=calls.find(u=>u.pathname==='/api/profit/daily');assert.equal(p.searchParams.get('accounts'),'111,222');assert.equal(p.searchParams.get('fx'),'1350');
 assert.ok(calls.indexOf(p)>Math.max(...calls.flatMap((u,i)=>u.pathname==='/api/insights'?[i]:[])));
 assert.ok(calls.filter(u=>u.pathname==='/api/insights').every(u=>u.searchParams.get('cacheOnly')==='1'),'Date scoped query must only read cached Meta data');
 assert.equal(h.node('profit-total').textContent,'53,000원');assert.match(h.node('graph').innerHTML,/<circle data-metric="profit"/);
});

test('one account assigned to both channel labels is fetched once and never doubled in aggregate spend',async()=>{
 const calls=[];
 const h=harness({ids:{naver:'111',cafe:'111'},fetch:async url=>{
  const u=new URL(url,'http://localhost');calls.push(u);
  const body=u.pathname==='/api/insights'?{currency:'KRW',rows:[{date_start:'2026-09-01',spend:'10000'}],cache:{missingDays:[]}}:u.pathname==='/api/profit/daily'?{fees:{naver:7,cafe24:3.5},days:[profit('2026-09-01',43000,{adSpend:10000})]}:{days:[]};
  return {ok:true,json:async()=>body};
 }});
 await h.run('run()');
 assert.equal(calls.filter(u=>u.pathname==='/api/insights').length,1);
 assert.equal(calls.find(u=>u.pathname==='/api/profit/daily').searchParams.get('accounts'),'111');
 assert.equal(h.node('spend').textContent,'10,000원');
 assert.equal(h.node('profit-total').textContent,'43,000원');
});

test('confirmed day shows as a clearly labeled partial 3-day average and missing day is not zero',()=>{
 const h=harness();h.node('chart-window').value='3';
 h.context.input=[
 profit('2026-09-01',30000),
 profit('2026-09-02',null,{cost:null,reasons:['자사몰: 상품·옵션 원가 미확정 1건'],naver:{revenue:100000},cafe24:{revenue:0,missingCostItems:[{name:'원가누락',option:'추가',orders:1}]} }),
 profit('2026-09-03',60000)
 ];
 h.run('profitDays=new Map(input.map(p=>[p.date,p]));render();');
 const html=h.node('graph').innerHTML;
 assert.match(html,/<circle data-metric="profit"/);
 assert.match(html,/45,000원/);
 assert.match(html,/확인 2\/3일 평균 · 부분 집계/);
 assert.match(h.node('profit-chart-status').textContent,/부분 집계 1구간/);
 assert.equal(h.node('profit-total').textContent,'90,000원 (확인된 2일 합계)');
 assert.match(h.node('profit-chart-diagnostic').children.map(c=>c.textContent||'').join(' '),/계산 가능 2일/);
});
test('when no profits are calculated, diagnostic explains failure and shows missing options',()=>{
 const h=harness();h.context.input=[
 profit('2026-09-01',null,{cost:null,reasons:['스마트스토어: 상품·옵션 원가 미확정 1건'],naver:{revenue:100000,missingCostItems:[{name:'백도씨',option:'화이트',orders:2}]},cafe24:{revenue:0}})
 ];
 h.run('profitDays=new Map(input.map(p=>[p.date,p]));render();');
 assert.match(h.node('profit-chart-status').textContent,/통합 예상 이익: 0\/1일 계산/);
 assert.match(h.node('profit-chart-status').children[0].textContent,/계산된 이익 0일/);
 assert.equal(h.node('profit-chart-debug').open,true);
 assert.equal(h.node('graph').innerHTML.includes('<circle data-metric="profit"'),false);
 assert.ok(h.node('profit-chart-diagnostic').children.length>=3);
});

test('zero Meta-attributed purchase revenue does not suppress combined store profit',async()=>{
 const h=harness({fetch:async url=>{
  const u=new URL(url,'http://localhost');
  const body=u.pathname==='/api/insights'?
   {currency:'KRW',rows:[{date_start:'2026-09-01',account_currency:'KRW',spend:'10000',actions:[],action_values:[]}],cache:{missingDays:[],warnings:[]}}:
   u.pathname==='/api/profit/daily'?
   {fees:{naver:7,cafe24:3.5},days:[profit('2026-09-01',33000,{adSpend:20000})]}:
   {days:[{date:'2026-09-01',naver:100000,cafe24:0,total:100000,complete:true}]};
  return {ok:true,json:async()=>body};
 }});
 await h.run('run()');
 assert.equal(h.node('revenue').textContent,'—','Meta purchase revenue remains missing');
 assert.equal(h.node('profit-total').textContent,'33,000원','store profit derives from order revenue, not attribution');
 assert.match(h.node('graph').innerHTML,/통합 예상 이익: 33,000원/);
 assert.match(h.node('profit-reconciliation').textContent,/33,000원/);
 assert.match(h.node('profit-troubleshooting-body').children.map(x=>x.textContent||'').join(' '),/Meta 구매 전환매출과 무관/);
});

test('unmatched cost options appear with dates and a priced candidate from the same channel',()=>{
 const h=harness(),item={name:'위마망 백도씨',option:'화이트 신형',orders:3,reason:'원가 미입력'};
 const missing=profit('2026-09-01',null,{cost:null,reasons:['카페24 원가 연결 미완료'],naver:{revenue:0},cafe24:{revenue:100000,missingCostItems:[item]}});
 h.context.input=[missing];
 h.run("profitDays=new Map(input.map(x=>[x.date,x]));existingCostRows=[{channel:'cafe24',key:'cafecafecafecafecafecafe',name:'백도씨',option:'화이트',cost:175000},{channel:'naver',key:'navernavernavernavernave',name:'백도씨',option:'화이트',cost:90000}];render();");
 const rows=JSON.parse(h.run('JSON.stringify(unmatchedProfitItems())'));
 assert.equal(rows.length,1);
 assert.equal(rows[0].name,'위마망 백도씨');
 assert.deepEqual(rows[0].dates,['2026-09-01']);
 const table=h.node('unmatched-table').children[0],tr=table.children[1].children[0],select=tr.children[3].children[0];
 assert.equal(select.children.length,3,'Both store price sources are offered for manual confirmation');
 assert.equal(select.children[1].value,'cafecafecafecafecafecafe');
});


test('recent-three-day control is separate from selected-period cache-only display',()=>{
 assert.match(html,/id="recent3-refresh"/);
 assert.match(html,/cacheOnly:'1'/);
 assert.match(html,/\/api\/data\/recent3\/refresh/);
 assert.match(html,/\/api\/data\/recent3\/status/);
 assert.match(html,/const version=\+\+requestVersion,since=\$\('since'\)\.value,until=\$\('until'\)\.value/);
});

test('Wemamang-only store revenue chart cannot be overridden by all-brand sales comparison totals',()=>{
 const h=harness();h.context.input=[profit('2026-09-01',12000,{
  revenue:15000,naver:{revenue:15000},cafe24:{revenue:0},
  fee:1050,cost:1500,adSpend:450
 })];
 h.run("profitDays=new Map(input.map(p=>[p.date,p]));storeSales=new Map([['2026-09-01',{naver:1000000,cafe24:500000,total:1500000}]]);activeMetricKeys=['totalStoreRevenue','profit'];render()");
 assert.match(h.node('graph').innerHTML,/통합 매출: 15,000원/);
 assert.doesNotMatch(h.node('graph').innerHTML,/1,500,000원/);
 assert.match(h.node('profit-table').innerHTML,/15,000원/);
});

const scopedProfit=(date,extra={})=>profit(date,null,{
 revenue:null,fee:null,cost:null,adSpend:30000,complete:false,partial:true,confirmedAvailable:true,
 confirmed:{revenue:300000,fee:21000,cost:150000,profit:99000,orders:1},
 pending:{unclassifiedOrders:2,mixedOrders:0,missingItemOrders:0,invalidOrders:0,totalOrders:2},
 reasons:['스마트스토어: 위마망 여부를 확인할 미분류 주문 2건'],
 naver:{revenue:null,fee:null,cost:null,complete:false,confirmedAvailable:true,confirmed:{revenue:300000,fee:21000,cost:150000,orders:1},unclassifiedOrders:2,unclassifiedProducts:[{name:'교체용 유리컵',options:['화이트'],orders:1,source:'브랜드명 미표기',canChoose:true},{name:'위마망 트루버 공용 케이스',options:['기본'],orders:1,source:'두 브랜드 모두 포함',canChoose:true}]},
 cafe24:{revenue:0,fee:0,cost:0,complete:true},...extra
});
const elementText=element=>[element.textContent,...(element.children||[]).map(elementText)].join(' ');

test('known Wemamang orders remain visible beside unresolved brands with matching table, point, and hover disclosure',()=>{
 const h=harness();h.context.input=[scopedProfit('2026-09-01')];
 h.run("profitDays=new Map(input.map(p=>[p.date,p]));storeSales=new Map([['2026-09-01',{total:9999999}]]);activeMetricKeys=['totalStoreRevenue','profit'];render();");
 const svg=h.node('graph').innerHTML;
 assert.match(svg,/통합 매출: 300,000원/);
 assert.match(svg,/통합 예상 이익: 99,000원/);
 assert.match(svg,/data-partial="true"/);
 assert.match(svg,/확인된 위마망 주문만 · 부분 집계/);
 assert.doesNotMatch(svg,/9,999,999원/);
 assert.match(h.node('profit-table').innerHTML,/300,000원/);
 assert.match(h.node('profit-table').innerHTML,/부분 집계 · 확인된 위마망만/);
 assert.match(h.node('profit-total').textContent,/99,000원.*부분 집계/);
 assert.match(h.node('profit-status').textContent,/전체 확인 0일 · 부분 집계 1일/);
 const chart=h.node('graph').querySelector('svg');chart.events.mousemove({clientX:500,clientY:140});
 assert.match(h.node('graph').querySelector('#roas-chart-hover').innerHTML,/미분류 2건/);
 assert.equal(h.node('profit-brand-review').style.display,'block');
 assert.match(elementText(h.node('profit-brand-list')),/교체용 유리컵/);
 assert.match(elementText(h.node('profit-brand-list')),/위마망 트루버 공용 케이스/);
 assert.match(elementText(h.node('profit-brand-list')),/화이트/);
 assert.match(elementText(h.node('unmatched-table')),/아직 원가 검토가 완료된 주문이 아닙니다/);
});

test('unknown-only dates do not turn confirmed nulls or zero subtotals into invented sales or advertising losses',()=>{
 const h=harness();h.context.input=[scopedProfit('2026-09-01',{
 confirmedAvailable:false,confirmed:{revenue:0,fee:0,cost:0,profit:null,orders:0},
 naver:{revenue:null,confirmedAvailable:false,confirmed:{revenue:0,fee:0,cost:0,orders:0},unclassifiedOrders:2}
 })];
 h.run("profitDays=new Map(input.map(p=>[p.date,p]));activeMetricKeys=['totalStoreRevenue','profit'];render();");
 assert.doesNotMatch(h.node('graph').innerHTML,/<path data-metric="(?:profit|totalStoreRevenue)"/);
 assert.equal(h.node('profit-total').textContent,'산출 불가');
 h.context.input=[scopedProfit('2026-09-01',{confirmed:{revenue:300000,fee:21000,cost:null,profit:null,orders:1}})];
 h.run('profitDays=new Map(input.map(p=>[p.date,p]));render();');
 assert.match(h.node('graph').innerHTML,/통합 매출: 300,000원/);
 assert.doesNotMatch(h.node('graph').innerHTML,/<path data-metric="profit"/);
});

test('every partial day keeps a hollow marker beyond 35 points and its connecting segment is dashed',()=>{
 const h=harness();h.node('since').value='2026-09-01';h.node('until').value='2026-10-11';
 h.context.input=Array.from({length:41},(_,i)=>scopedProfit(new Date(Date.UTC(2026,8,i+1)).toISOString().slice(0,10)));
 h.run("profitDays=new Map(input.map(p=>[p.date,p]));activeMetricKeys=['totalStoreRevenue','profit'];render();");
 const svg=h.node('graph').innerHTML;
 assert.equal((svg.match(/<circle data-metric="profit"[^>]*data-partial="true"[^>]*fill="white"/g)||[]).length,41);
 assert.equal((svg.match(/<circle data-metric="totalStoreRevenue"[^>]*data-partial="true"[^>]*fill="white"/g)||[]).length,41);
 assert.match(svg,/<path data-metric="profit" data-partial="true"[^>]*stroke-dasharray="6 4"/);
 assert.match(h.node('profit-total').textContent,/확인된 위마망만 · 부분 집계/);
});

test('brand scope is never guessed from saved costs and classification saves only after explicit user confirmation',async()=>{
 let approved=false;const requests=[],confirmations=[];
 const h=harness({confirm:message=>{confirmations.push(message);return approved;},fetch:async(url,options={})=>{
  requests.push({url,options});
  if(url==='/api/brand-products')return {ok:true,json:async()=>({ok:true})};
  if(url.startsWith('/api/insights'))return {ok:true,json:async()=>({currency:'KRW',rows:[],cache:{missingDays:[]}})};
  if(url.startsWith('/api/profit/daily'))return {ok:true,json:async()=>({fees:{naver:7,cafe24:3.5},days:[profit('2026-09-01',152000)],pendingProducts:[]})};
  return {ok:true,json:async()=>({days:[]})};
 }});
 h.context.input=[scopedProfit('2026-09-01')];
 h.run("profitDays=new Map(input.map(p=>[p.date,p]));existingCostRows=[{name:'교체용 유리컵',cost:40000}];render();");
 assert.equal(requests.length,0,'Rendering unknown products must never classify them automatically');
 const tbody=h.node('profit-brand-list').children[0].children[1],button=tbody.children[0].children[3].children[0];
 assert.equal(button.attributes['data-brand-choice'],'wemamang');
 await button.onclick();assert.equal(requests.length,0,'Declining must not write a classification');
 approved=true;await button.onclick();
 const save=requests.find(r=>r.url==='/api/brand-products');
 assert.equal(save.options.method,'POST');assert.deepEqual(JSON.parse(save.options.body),{name:'교체용 유리컵',scope:'wemamang'});
 assert.match(confirmations[0],/모든 판매 채널·옵션/);
 assert.equal(h.node('profit-total').textContent,'152,000원');
 assert.ok(requests.filter(r=>r.url.startsWith('/api/insights')).every(r=>new URL(r.url,'http://local').searchParams.get('cacheOnly')==='1'));
 assert.equal(requests.some(r=>r.url.includes('/recent3/refresh')),false,'Classification must not trigger external data collection');
});

const coverageFixture=()=>({since:'2026-09-01',until:'2026-09-30',totalDays:30,sources:{
 naver:{storedDays:30,missingDays:[],positiveOrders:779,missingItemOrders:779,missingItemDates:[{date:'2026-09-01',count:779}],unclassifiedOrders:0,missingCostOrders:0},
 cafe24:{storedDays:30,missingDays:[],positiveOrders:139,missingItemOrders:118,missingItemDates:[{date:'2026-09-01',count:60},{date:'2026-09-02',count:58}],unclassifiedOrders:0,missingCostOrders:0},
 meta:{'111':{storedDays:30,missingDays:[]},'222':{storedDays:28,missingDays:['2026-09-05','2026-09-06']}}
},profit:{completeDays:12,partialDays:0,unavailableDays:18}});

test('coverage distinguishes stored paid orders from missing product metadata and shows actual missing dates',()=>{
 const h=harness();h.context.report=coverageFixture();h.run('dataCoverage=report;renderDataCoverage();');
 const text=elementText(h.node('coverage-table'));
 assert.match(text,/주문·결제자료 139건 저장됨 · 상품 상세 미연결 118건/);
 assert.match(text,/매출이 0원이라는 뜻이 아닙니다/);
 assert.match(text,/상품 상세 미연결 날짜: 2026-09-01 ~ 2026-09-02/);
 assert.match(text,/미수집 2일: 2026-09-05 ~ 2026-09-06/);
 assert.match(h.node('coverage-summary').textContent,/전체 이익 확인 12\/30일/);
});

test('queued Cafe24 reports 118 remaining before attempts while Naver progresses, independent of current selected dates',()=>{
 const h=harness();h.node('since').value='2026-10-01';h.node('until').value='2026-10-02';
 h.context.job={since:'2026-09-01',until:'2026-09-30',running:true,progress:'복구 진행',sources:{
 naver:{status:'진행 중',total:779,checked:200,restored:200,remaining:579},
 cafe24:{status:'대기',total:118,checked:0,restored:0,remaining:118}
 }};
 h.run('renderDetailRepairJob(job);');
 const text=elementText(h.node('history-repair-sources'));
 assert.match(text,/카페24 대기 0 \/ 118건 0건 118건/);
 assert.match(text,/스마트스토어 진행 중 200 \/ 779건/);
 assert.match(h.node('history-repair-summary').textContent,/2026-09-01 ~ 2026-09-30/);
 assert.equal(h.node('since').value,'2026-10-01');
});

test('selected-period detail repair posts exact dates, redraws partial progress from cache, and keeps source failures separate',async()=>{
 const requests=[],seenProgress=[];let stage=0,h;
 const job=()=>({since:'2026-09-01',until:'2026-09-30',running:stage<2,done:stage<2?2:3,total:3,progress:stage<2?'채널별 상세 복구 중':'상세 복구 일부 완료',error:'스마트스토어 일부 미복구',sources:{
 naver:{status:'부분 완료',total:1,checked:1,restored:0,remaining:1,error:'스마트스토어 상세 재조회 실패'},
 cafe24:{status:stage<2?'진행 중':'완료',total:2,checked:stage<2?1:2,restored:stage<2?1:2,remaining:stage<2?1:0,error:null}
 }});
 h=harness({timer:resolve=>{seenProgress.push(elementText(h.node('history-repair-sources')));stage=2;h.node('since').value='2026-10-01';h.node('until').value='2026-10-02';resolve();},fetch:async(url,options={})=>{
  requests.push({url,options});const u=new URL(url,'http://local');
  if(u.pathname==='/api/costs/catalog/refresh'){stage=1;return {ok:true,json:async()=>({ok:true})};}
  if(u.pathname==='/api/costs/catalog/diagnostics')return {ok:true,json:async()=>({job:job()})};
  if(u.pathname==='/api/data/coverage'){const report=coverageFixture();report.since=u.searchParams.get('since');report.until=u.searchParams.get('until');return {ok:true,json:async()=>report};}
  if(u.pathname==='/api/insights')return {ok:true,json:async()=>({currency:'KRW',rows:[],cache:{missingDays:[]}})};
  if(u.pathname==='/api/profit/daily')return {ok:true,json:async()=>({fees:{naver:7,cafe24:3.5},days:[profit(u.searchParams.get('since'),stage===1?10000:20000)]})};
  return {ok:true,json:async()=>({days:[]})};
 }});
 h.node('since').value='2026-09-01';h.node('until').value='2026-09-30';
 await h.run('recoverSelectedOrderDetails()');
 const posts=requests.filter(r=>r.options.method==='POST');assert.equal(posts.length,1);
 assert.equal(posts[0].url,'/api/costs/catalog/refresh');assert.deepEqual(JSON.parse(posts[0].options.body),{since:'2026-09-01',until:'2026-09-30'});
 assert.match(seenProgress[0],/카페24 진행 중 1 \/ 2건 1건 1건/);
 assert.match(elementText(h.node('history-repair-sources')),/카페24 완료 2 \/ 2건 2건 0건/);
 assert.match(elementText(h.node('history-repair-sources')),/스마트스토어 상세 재조회 실패/);
 assert.ok(requests.filter(r=>r.url.startsWith('/api/profit/daily')).length>=2,'Partial progress and completion both redraw');
 assert.ok(requests.filter(r=>r.url.startsWith('/api/insights')).every(r=>new URL(r.url,'http://local').searchParams.get('cacheOnly')==='1'));
 assert.equal(requests.some(r=>r.url.includes('/recent3/refresh')),false);
 assert.equal(h.node('since').value,'2026-10-01');assert.equal(h.node('until').value,'2026-10-02');
 assert.match(h.node('history-repair-summary').textContent,/2026-09-01 ~ 2026-09-30/);
});

test('page lookup resumes observing an existing detail repair without starting a second job',async()=>{
 const requests=[];let running=true;
 const h=harness({timer:resolve=>{running=false;resolve();},fetch:async(url,options={})=>{
  requests.push({url,options});const u=new URL(url,'http://local');
  if(u.pathname==='/api/costs/catalog/diagnostics')return {ok:true,json:async()=>({job:{since:'2026-09-01',until:'2026-09-30',running,done:running?0:1,total:1,sources:{naver:{status:'완료',total:0,checked:0,restored:0,remaining:0},cafe24:{status:running?'진행 중':'완료',total:1,checked:running?0:1,restored:running?0:1,remaining:running?1:0}}}})};
  if(u.pathname==='/api/data/coverage')return {ok:true,json:async()=>coverageFixture()};
  if(u.pathname==='/api/insights')return {ok:true,json:async()=>({currency:'KRW',rows:[],cache:{missingDays:[]}})};
  if(u.pathname==='/api/profit/daily')return {ok:true,json:async()=>({fees:{naver:7,cafe24:3.5},days:[profit('2026-09-01',12000)]})};
  return {ok:true,json:async()=>({days:[]})};
 }});
 await h.run('run()');for(let i=0;i<10&&h.run('detailRepairPolling');i++)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(requests.some(r=>r.options.method==='POST'),false);
 assert.match(elementText(h.node('history-repair-sources')),/카페24 완료/);
 assert.equal(h.run('detailRepairPolling'),false);
});
