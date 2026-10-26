'use strict';
const test=require('node:test');
const path=require('node:path');
const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');

class Element {
  constructor(tag='div'){this.tagName=tag;this.children=[];this.attributes={};this.textContent='';this.hidden=false;}
  append(...items){this.children.push(...items);}
  replaceChildren(...items){this.children=[...items];}
  setAttribute(key,value){this.attributes[key]=String(value);}
}
const dates=['2026-10-21','2026-10-22'];
const base={keys:[],since:dates[0],until:dates[1],fx:1000,accountIds:{naver:'11111',cafe:'22222'},channel:'all'};
const purchase=value=>[{action_type:'purchase',value:String(value)}];
const row=(date,spend,revenue,purchases,currency='USD')=>({date_start:date,spend,account_currency:currency,inline_link_clicks:'4',impressions:'100',...(revenue==null?{}:{action_values:purchase(revenue)}),...(purchases==null?{}:{actions:purchase(purchases)})});
const full=(revenue,cost,fee)=>({revenue,cost,fee,complete:true,confirmedAvailable:true,confirmed:{revenue,cost,fee}});
const partial=(revenue,cost,fee)=>({revenue:null,cost:null,fee:null,complete:false,confirmedAvailable:true,confirmed:{revenue,cost,fee}});
function fixtures(){
  return {
    accounts:{'11111':{rows:[row(dates[0],10,5,1),row(dates[1],90,null,null)],currency:'USD'},'22222':{rows:[row(dates[0],10000,20000,2,'KRW')],currency:'KRW'}},
    coverage:{since:dates[0],until:dates[1],totalDays:2,sources:{meta:{'11111':{missingDays:[]},'22222':{missingDays:[]}}}},
    profit:{days:[
      {date:dates[0],...full(120000,30000,7700),profit:62300,naver:full(100000,25000,7000),cafe24:full(20000,5000,700)},
      {date:dates[1],...partial(50000,10000,3500),profit:null,confirmed:{revenue:50000,cost:10000,fee:3500,profit:-53500},naver:partial(50000,10000,3500),cafe24:full(0,0,0)}
    ]}
  };
}
function setup(){
  let data=fixtures(),calls=[],gate=null;
  const nodes=Object.fromEntries(['ads-period-summary-cards','ads-period-summary','ads-period-summary-note'].map(id=>[id,new Element()]));
  const context={URLSearchParams,AbortController,setTimeout,clearTimeout,Intl,console,fetch:async(url,options)=>{
    const parsed=new URL(url,'http://127.0.0.1:3000');
    calls.push({url,options});
    assert.equal(options.method,'GET');
    assert.equal(options.cache,'no-store');
    if(gate)await gate(parsed);
    if(parsed.pathname==='/api/insights'){
      assert.equal(parsed.searchParams.get('cacheOnly'),'1');
      const payload=data.accounts[parsed.searchParams.get('account')];
      if(payload?.error)return {ok:false,json:async()=>({error:payload.error})};
      return {ok:true,json:async()=>payload};
    }
    if(parsed.pathname==='/api/data/coverage')return {ok:!data.coverage.error,json:async()=>data.coverage};
    if(parsed.pathname==='/api/profit/daily')return {ok:!data.profit.error,json:async()=>data.profit};
    throw Error('Unexpected endpoint: '+url);
  }};
  vm.createContext(context);
  // No document or localStorage exists while the module is initialized.
  const app=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
  const start=app.indexOf('const AdsOverviewSummary = (() => {');
  const end=app.indexOf('\n})();',start);
  assert.ok(start>=0 && end>start,'AdsOverviewSummary must be present in public/app.js');
  vm.runInContext(app.slice(start,end+7)+'\nglobalThis.adapter=AdsOverviewSummary;',context);
  assert.equal(calls.length,0,'module initialization must not fetch');
  assert.equal(context.adapter.metrics.length,24);
  context.document={getElementById:id=>nodes[id],createElement:tag=>new Element(tag)};
  return {adapter:context.adapter,nodes,calls,setData:value=>data=value,setGate:value=>gate=value};
}
const byKey=result=>Object.fromEntries(result.metrics.map(metric=>[metric.key,metric]));
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-9,actual+' != '+expected);
function dateRange(since,until){
  const result=[];
  for(let time=Date.parse(since+'T00:00:00Z');time<=Date.parse(until+'T00:00:00Z');time+=86400000)result.push(new Date(time).toISOString().slice(0,10));
  return result;
}
function rangeFixture(since,until){
  const range=dateRange(since,until);
  return {
    accounts:{'11111':{rows:[],currency:'KRW'},'22222':{rows:[],currency:'KRW'}},
    coverage:{since,until,totalDays:range.length,sources:{meta:{'11111':{missingDays:[]},'22222':{missingDays:[]}}}},
    profit:{days:range.map(date=>({date,...full(0,0,0),profit:0,naver:full(0,0,0),cafe24:full(0,0,0)}))}
  };
}

test('selected summaries preserve full-spend ratios, scopes, financial subtotals and reusable cache',async()=>{
  const env=setup();const keys=env.adapter.metrics.map(metric=>metric.key);
  const result=await env.adapter.update({...base,keys,channel:'cafe'}),m=byKey(result);
  assert.equal(result.status,'ready');
  assert.equal(m.spend.value,110000,'total spend ignores chosen ad channel');
  assert.equal(m.mallSpend.value,10000);assert.equal(m.smartstoreSpend.value,100000);
  close(m.roas.value,25000/110000*100);assert.equal(m.roas.partial,true,'missing revenue preserves full spend denominator');
  assert.equal(m.smartstoreRoas.value,5);assert.equal(m.smartstoreRoas.partial,true);
  assert.equal(m.mallRoas.value,200);assert.equal(m.mallRoas.partial,false);
  assert.equal(m.revenue.value,20000,'generic Meta metric uses passed channel');
  assert.equal(m.cpa.value,5000);assert.equal(m.purchases.value,2);
  assert.equal(m.totalStoreRevenue.value,170000);assert.equal(m.totalStoreRevenue.partial,true);
  assert.equal(m.profit.value,8800,'confirmed financial amount is used without redistributing ad spend');
  assert.equal(m.profit.partial,true);assert.equal(m.cost.value,40000);assert.equal(m.fee.value,11200);
  assert.equal(env.calls.length,4);assert.equal(env.nodes['ads-period-summary-cards'].children.length,24);
  assert.equal(env.nodes['ads-period-summary-cards'].children[0].attributes['data-summary-key'],'smartstoreSpend');
  const again=byKey(await env.adapter.update({...base,keys:['spend','revenue'],channel:'naver'}));
  assert.equal(env.calls.length,4,'channel/key/search rerenders share a snapshot');
  assert.equal(again.spend.value,110000);assert.equal(again.revenue.value,5000);
  await env.adapter.update({...base,keys:['spend'],force:true});assert.equal(env.calls.length,8);
  env.adapter.invalidate();await env.adapter.update({...base,keys:['spend']});assert.equal(env.calls.length,12);
});
test('missing dates show labelled saved-data ROAS while CPA remains withheld',async()=>{
  const env=setup(),data=fixtures();data.coverage.sources.meta['11111'].missingDays=[dates[1]];env.setData(data);
  const m=byKey(await env.adapter.update({...base,keys:['spend','roas','cpa','mallRoas','smartstoreRoas']}));
  assert.equal(m.spend.value,110000);assert.equal(m.spend.partial,true);
  close(m.roas.value,25000/110000*100);assert.equal(m.cpa.value,null);assert.equal(m.smartstoreRoas.value,5);
  assert.equal(m.roas.partial,true);assert.equal(m.smartstoreRoas.partial,true);
  assert.match(m.roas.detail,/저장된 매출·광고비 기준/);assert.match(m.roas.detail,/전체 기간 미확정/);
  assert.equal(m.mallRoas.value,200);assert.match(m.roas.detail,/광고비 미확인 1\/2일/);
});
test('verified empty days are zero while missing empty days remain unknown',async()=>{
  const env=setup(),data=fixtures();data.accounts['11111'].rows=[];data.accounts['22222'].rows=[];env.setData(data);
  let m=byKey(await env.adapter.update({...base,keys:['spend','revenue','purchases','roas','cpa']}));
  assert.equal(m.spend.value,0);assert.equal(m.spend.partial,false);assert.equal(m.revenue.value,0);assert.equal(m.purchases.value,0);
  assert.equal(m.roas.value,null);assert.equal(m.cpa.value,null);
  data.coverage.sources.meta['11111'].missingDays=dates;data.coverage.sources.meta['22222'].missingDays=dates;
  m=byKey(await env.adapter.update({...base,keys:['spend','revenue','purchases'],force:true}));
  assert.equal(m.spend.value,null);assert.equal(m.revenue.value,null);assert.equal(m.purchases.value,null,'unloaded empty days are not zero');
});
test('a missing spend field cannot become confirmed zero or a valid ratio',async()=>{
  const env=setup(),data=fixtures();delete data.accounts['11111'].rows[0].spend;env.setData(data);
  const m=byKey(await env.adapter.update({...base,keys:['spend','roas','smartstoreRoas','cpa']}));
  assert.equal(m.spend.value,100000);assert.equal(m.spend.partial,true);
  assert.equal(m.roas.value,null);assert.equal(m.smartstoreRoas.value,null);assert.equal(m.cpa.value,null);
});
test('unsupported ad currency stays unconfirmed',async()=>{
  const env=setup(),data=fixtures();data.accounts['11111'].rows[0].account_currency='EUR';env.setData(data);
  const m=byKey(await env.adapter.update({...base,keys:['spend','roas']}));
  assert.equal(m.spend.value,100000);assert.equal(m.spend.partial,true);assert.equal(m.roas.value,null);
});
test('shared ad accounts are fetched and counted once and channel splits are withheld',async()=>{
  const env=setup();const m=byKey(await env.adapter.update({...base,accountIds:{naver:'11111',cafe:'11111'},keys:['spend','roas','mallSpend','smartstoreSpend','mallRoas','smartstoreRoas']}));
  assert.equal(m.spend.value,100000);assert.equal(m.roas.value,5);
  for(const key of ['mallSpend','smartstoreSpend','mallRoas','smartstoreRoas']){assert.equal(m[key].value,null);assert.match(m[key].detail,/동일 광고계정/);}
  assert.equal(env.calls.filter(call=>call.url.startsWith('/api/insights?')).length,1);
});
test('coverage errors preserve confirmed subtotals and withhold unsupported ratios',async()=>{
  const env=setup(),data=fixtures();data.coverage={error:'coverage offline'};env.setData(data);
  const result=await env.adapter.update({...base,keys:['spend','roas','totalStoreRevenue']}),m=byKey(result);
  assert.equal(result.status,'partial');assert.equal(m.spend.value,110000);assert.equal(m.spend.partial,true);assert.equal(m.roas.value,null);
  assert.equal(m.totalStoreRevenue.value,170000);assert.match(env.nodes['ads-period-summary-note'].textContent,/coverage offline/);
});
test('insight response coverage certifies ROAS even when the separate coverage request fails',async()=>{
  const env=setup(),data=fixtures();data.coverage={error:'coverage offline'};
  for(const account of Object.values(data.accounts))account.cache={missingDays:[]};
  env.setData(data);
  const m=byKey(await env.adapter.update({...base,keys:['roas','mallRoas','smartstoreRoas']}));
  close(m.roas.value,25000/110000*100);assert.equal(m.mallRoas.value,200);assert.equal(m.smartstoreRoas.value,5);
  assert.equal(m.roas.audit.spendComplete,true);assert.equal(m.mallRoas.partial,false);
});
test('one entirely missing account cannot produce a total saved-data ROAS',async()=>{
  const env=setup(),data=fixtures();data.accounts['22222'].rows=[];
  data.accounts['22222'].cache={missingDays:dates};env.setData(data);
  const m=byKey(await env.adapter.update({...base,keys:['roas','mallRoas','smartstoreRoas']}));
  assert.equal(m.roas.value,null);assert.equal(m.mallRoas.value,null);assert.equal(m.smartstoreRoas.value,5);
});
test('unavailable confirmed-order subsets are excluded rather than treated as zero',async()=>{
  const env=setup(),data=fixtures();data.profit.days[1].confirmedAvailable=false;env.setData(data);
  const m=byKey(await env.adapter.update({...base,keys:['totalStoreRevenue','profit']}));
  assert.equal(m.totalStoreRevenue.value,120000);assert.equal(m.totalStoreRevenue.partial,true);assert.equal(m.profit.value,62300);
});
test('concurrent rerenders share requests and only the newest metric selection renders',async()=>{
  const env=setup();let release;const pending=new Promise(resolve=>release=resolve);env.setGate(()=>pending);
  const first=env.adapter.update({...base,keys:['spend']});
  const second=env.adapter.update({...base,keys:['revenue'],channel:'cafe'});
  assert.equal(env.calls.length,4,'concurrent rerender reuses in-flight fetch');release();
  assert.equal((await first).status,'superseded');assert.equal((await second).status,'ready');
  assert.equal(env.nodes['ads-period-summary-cards'].children.length,1);
  assert.equal(env.nodes['ads-period-summary-cards'].children[0].attributes['data-summary-key'],'revenue');
});
test('hiding all summary metrics invalidates an in-flight render',async()=>{
  const env=setup();let release;const pending=new Promise(resolve=>release=resolve);env.setGate(()=>pending);
  const first=env.adapter.update({...base,keys:['spend']});
  const empty=await env.adapter.update({...base,keys:[]});release();
  assert.equal(empty.status,'hidden');assert.equal((await first).status,'superseded');
  assert.equal(env.nodes['ads-period-summary'].hidden,true);assert.equal(env.nodes['ads-period-summary-cards'].children.length,0);
});
test('invalid dates, exchange rates and account IDs do not fetch',async()=>{
  const env=setup();const result=await env.adapter.update({...base,keys:['spend'],since:'2026-02-30'});
  assert.equal(result.status,'error');assert.equal(env.calls.length,0);
  await env.adapter.update({...base,keys:['spend'],fx:0});assert.equal(env.calls.length,0);
  await env.adapter.update({...base,keys:['spend'],accountIds:{naver:'bad',cafe:''}});assert.equal(env.calls.length,0);
});

test('graph-only requests load daily numeric series while the legacy card panel stays hidden',async()=>{
  const env=setup();
  const result=await env.adapter.update({...base,keys:[],seriesKeys:['spend','profit'],window:1});
  assert.equal(result.status,'ready');assert.equal(result.metrics.length,0);
  assert.equal(env.nodes['ads-period-summary'].hidden,true);assert.equal(env.nodes['ads-period-summary-cards'].children.length,0);
  assert.equal(result.series.length,2);assert.equal(result.dailySeries.length,2);
  assert.equal(result.series[0].date,dates[0]);assert.equal(result.series[0].from,dates[0]);assert.equal(result.series[0].to,dates[0]);assert.equal(result.series[0].days,1);
  assert.equal(result.series[0].metrics.spend.value,20000);assert.equal(result.series[1].metrics.spend.value,90000);
  assert.equal(result.series[0].metrics.profit.value,62300);assert.equal(result.series[1].metrics.profit.value,-53500);
  assert.equal(result.series[1].metrics.profit.partial,true);assert.equal(env.calls.length,4);
});

test('totals and graph data work without any legacy card DOM',async()=>{
  const env=setup();for(const id of Object.keys(env.nodes))delete env.nodes[id];
  const result=await env.adapter.update({...base,keys:['spend','profit'],seriesKeys:['spend'],window:1});
  assert.equal(result.status,'ready');assert.equal(byKey(result).spend.value,110000);assert.equal(byKey(result).profit.value,8800);
  assert.equal(result.series.length,2);assert.equal(env.calls.length,4);
});

test('3, 5 and 7 day graph buckets reset at each month and clip only to the selected calendar range',async()=>{
  const env=setup(),since='2026-09-29',until='2026-10-08',range=dateRange(since,until),data=rangeFixture(since,until);
  data.accounts['11111'].rows=range.map((date,index)=>row(date,index+1,index+1,1,'KRW'));env.setData(data);
  const expected={
    3:[['2026-09-29','2026-09-30',2,1.5],['2026-10-01','2026-10-03',3,4],['2026-10-04','2026-10-06',3,7],['2026-10-07','2026-10-08',2,9.5]],
    5:[['2026-09-29','2026-09-30',2,1.5],['2026-10-01','2026-10-05',5,5],['2026-10-06','2026-10-08',3,9]],
    7:[['2026-09-29','2026-09-30',2,1.5],['2026-10-01','2026-10-07',7,6],['2026-10-08','2026-10-08',1,10]]
  };
  let previousSignature;
  for(const window of [3,5,7]){
    const result=await env.adapter.update({...base,since,until,keys:['spend'],seriesKeys:['spend'],window});
    assert.equal(result.status,'ready');assert.equal(byKey(result).spend.value,55,'table totals remain totals for every graph window');
    assert.deepEqual(JSON.parse(JSON.stringify(result.series.map(bucket=>[bucket.from,bucket.to,bucket.days,bucket.metrics.spend.value]))),expected[window]);
    assert.equal(result.series[0].label,'09/29~09/30');assert.equal(result.dailySeries.length,10);
    assert.deepEqual(JSON.parse(JSON.stringify(result.dailySeries.map(bucket=>bucket.metrics.spend.value))),range.map((date,index)=>index+1));
    assert.ok(result.series.every(bucket=>bucket.metrics.spend.partial===false),'short month/query edges are not missing data');
    assert.notEqual(result.requestSignature,previousSignature);previousSignature=result.requestSignature;
  }
  assert.equal(env.calls.length,4,'changing graph window reuses the snapshot');
});

test('grouped ROAS, CPA, CTR, CPC and CPM use underlying totals rather than averaging daily ratios',async()=>{
  const env=setup(),since='2026-10-01',until='2026-10-03',data=rangeFixture(since,until);
  data.accounts['11111'].rows=[
    {...row(since,100,100,1,'KRW'),inline_link_clicks:'1',impressions:'10'},
    {...row('2026-10-02',900,1800,9,'KRW'),inline_link_clicks:'9',impressions:'900'},
    {...row(until,0,0,0,'KRW'),inline_link_clicks:'0',impressions:'0'}
  ];env.setData(data);
  const result=await env.adapter.update({...base,since,until,keys:['spend'],seriesKeys:['spend','roas','cpa','ctr','cpc','cpm','revenue'],window:3});
  const m=result.series[0].metrics;
  assert.equal(m.roas.value,190);assert.equal(m.cpa.value,100);assert.equal(m.cpc.value,100);
  close(m.ctr.value,10/910*100);close(m.cpm.value,1000/910*1000);
  close(m.spend.value,1000/3);close(m.revenue.value,1900/3);
  assert.equal(result.dailySeries[0].metrics.roas.value,100);assert.equal(result.dailySeries[1].metrics.roas.value,200);assert.equal(result.dailySeries[2].metrics.roas.value,null);
  const additive=await env.adapter.update({...base,since,until,seriesKeys:['purchases','clicks','impressions','cost','fee','profit'],seriesWindow:3});
  close(additive.series[0].metrics.purchases.value,10/3);close(additive.series[0].metrics.clicks.value,10/3);close(additive.series[0].metrics.impressions.value,910/3);
  assert.equal(additive.series[0].metrics.profit.value,0);assert.equal(env.calls.length,4,'new graph metrics and the seriesWindow alias reuse cached inputs');
});

test('zero and negative graph values survive while missing days stay gaps and partial averages use only known days',async()=>{
  const env=setup(),since='2026-10-01',until='2026-10-03',data=rangeFixture(since,until);
  data.accounts['11111'].rows=[row(since,0,0,0,'KRW'),row('2026-10-02',600,null,null,'KRW')];
  data.coverage.sources.meta['11111'].missingDays=[until];data.coverage.sources.meta['22222'].missingDays=[until];
  data.profit.days[1].profit=-600;data.profit.days[2].profit=null;data.profit.days[2].confirmedAvailable=false;
  env.setData(data);
  const result=await env.adapter.update({...base,since,until,seriesKeys:['spend','profit','roas','revenue','purchases'],window:3});
  assert.equal(result.dailySeries.length,3);assert.equal(result.dailySeries[0].metrics.profit.value,0);
  assert.equal(result.dailySeries[1].metrics.profit.value,-600);assert.equal(result.dailySeries[2].metrics.profit.value,null);
  assert.equal(result.dailySeries[0].metrics.spend.value,0);assert.equal(result.dailySeries[2].metrics.spend.value,null);
  const m=result.series[0].metrics;
  assert.equal(m.spend.value,300);assert.equal(m.spend.partial,true);assert.equal(m.spend.knownDays,2);assert.equal(m.spend.totalDays,3);
  assert.equal(m.profit.value,-300);assert.equal(m.profit.partial,true);assert.equal(m.profit.knownDays,2);
  assert.equal(m.roas.value,0,'Explicit zero revenue survives in a labelled saved-data ratio');
  assert.equal(m.roas.partial,true);assert.match(m.roas.detail,/전체 기간 미확정/);
  assert.equal(result.dailySeries[2].metrics.roas.value,null,'An entirely missing date stays a gap');
  assert.equal(m.revenue.value,0);assert.equal(m.revenue.partial,true);assert.equal(m.purchases.value,0);
});

test('completely missing dates are retained as null calendar buckets rather than invented zero points',async()=>{
  const env=setup(),since='2026-10-01',until='2026-10-07',data=rangeFixture(since,until),range=dateRange(since,until);
  data.coverage.sources.meta['11111'].missingDays=range;data.coverage.sources.meta['22222'].missingDays=range;data.profit.days=[];
  env.setData(data);
  const result=await env.adapter.update({...base,since,until,seriesKeys:['spend','profit','clicks','roas'],window:3});
  assert.equal(result.series.length,3);assert.equal(result.dailySeries.length,7);
  for(const bucket of [...result.series,...result.dailySeries])for(const metric of Object.values(bucket.metrics))assert.equal(metric.value,null);
  assert.deepEqual(JSON.parse(JSON.stringify(result.series.map(bucket=>bucket.days))),[3,3,1]);
});

test('graph click and impression gaps cannot fabricate CPC, CPM or CTR denominators',async()=>{
  const env=setup(),since='2026-10-01',data=rangeFixture(since,since),ad=row(since,10,20,1,'KRW');
  delete ad.inline_link_clicks;delete ad.impressions;data.accounts['11111'].rows=[ad];env.setData(data);
  const result=await env.adapter.update({...base,since,until:since,accountIds:{naver:'11111',cafe:''},seriesKeys:['clicks','impressions','cpc','cpm','ctr'],window:1});
  for(const metric of Object.values(result.series[0].metrics))assert.equal(metric.value,null);
  assert.match(result.series[0].metrics.cpc.detail,/계산 보류/);
});

test('graph requests deduplicate and cap metric keys and reject stale responses after window changes',async()=>{
  const env=setup();let release;const pending=new Promise(resolve=>release=resolve);env.setGate(()=>pending);
  const first=env.adapter.update({...base,seriesKeys:['spend','profit'],window:1});
  const keys=['spend','spend','__proto__','profit','revenue','purchases','roas','cpa','cpc','cpm'];
  const second=env.adapter.update({...base,seriesKeys:keys,window:7});
  assert.equal(env.calls.length,4);release();
  const stale=await first,current=await second;
  assert.equal(stale.status,'superseded');assert.equal(stale.series.length,0);assert.equal(current.status,'ready');
  assert.notEqual(stale.requestSignature,current.requestSignature);
  assert.equal(Object.keys(current.series[0].metrics).length,7);
  assert.equal(Object.prototype.hasOwnProperty.call(current.series[0].metrics,'__proto__'),false);
});

test('selected-period advertising diagnostics include Naver inputs in costs and chart buckets only',async()=>{
 const env=setup(),data=fixtures();
 data.profit.days[0].naverAdSpend={powerlink:100,shopping:200,gfa:300};data.profit.days[0].naverAdSpendEstimated=true;
 env.setData(data);
 const keys=['spend','gfaSpend','shoppingSpend','powerlinkSpend','roas'];
 const result=await env.adapter.update({...base,keys,seriesKeys:keys,windowSize:1}),metrics=byKey(result);
 assert.equal(metrics.spend.value,110600);assert.equal(metrics.spend.partial,true);
 assert.equal(metrics.gfaSpend.value,300);assert.equal(metrics.gfaSpend.partial,true);assert.equal(metrics.powerlinkSpend.value,100);
 close(metrics.roas.value,25000/110000*100);
 assert.match(metrics.gfaSpend.detail,/균등 배분 추정/);
});

test('sponsorship costs appear in selected-period totals and daily chart without being attributed to a Meta ad',async()=>{
 const env=setup(),data=fixtures();data.profit.days[0].otherAdSpend=118000;data.profit.days[1].otherAdSpend=0;env.setData(data);
 const keys=['spend','otherAdSpend','roas'];const result=await env.adapter.update({...base,keys,seriesKeys:keys,windowSize:1}),metrics=byKey(result);
 assert.equal(metrics.spend.value,228000);assert.equal(metrics.otherAdSpend.value,118000);assert.equal(metrics.otherAdSpend.partial,false);
 assert.match(metrics.spend.detail,/기타 광고비/);assert.equal(result.series[0].metrics.otherAdSpend.value,118000);assert.equal(result.series[1].metrics.otherAdSpend.value,0);
 close(metrics.roas.value,25000/110000*100);
});
