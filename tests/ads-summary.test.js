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
  assert.equal(context.adapter.metrics.length,20);
  context.document={getElementById:id=>nodes[id],createElement:tag=>new Element(tag)};
  return {adapter:context.adapter,nodes,calls,setData:value=>data=value,setGate:value=>gate=value};
}
const byKey=result=>Object.fromEntries(result.metrics.map(metric=>[metric.key,metric]));
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-9,actual+' != '+expected);

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
  assert.equal(env.calls.length,4);assert.equal(env.nodes['ads-period-summary-cards'].children.length,20);
  assert.equal(env.nodes['ads-period-summary-cards'].children[0].attributes['data-summary-key'],'smartstoreSpend');
  const again=byKey(await env.adapter.update({...base,keys:['spend','revenue'],channel:'naver'}));
  assert.equal(env.calls.length,4,'channel/key/search rerenders share a snapshot');
  assert.equal(again.spend.value,110000);assert.equal(again.revenue.value,5000);
  await env.adapter.update({...base,keys:['spend'],force:true});assert.equal(env.calls.length,8);
  env.adapter.invalidate();await env.adapter.update({...base,keys:['spend']});assert.equal(env.calls.length,12);
});
test('any unconfirmed spend day blocks total and affected-channel ROAS and CPA',async()=>{
  const env=setup(),data=fixtures();data.coverage.sources.meta['11111'].missingDays=[dates[1]];env.setData(data);
  const m=byKey(await env.adapter.update({...base,keys:['spend','roas','cpa','mallRoas','smartstoreRoas']}));
  assert.equal(m.spend.value,110000);assert.equal(m.spend.partial,true);
  assert.equal(m.roas.value,null);assert.equal(m.cpa.value,null);assert.equal(m.smartstoreRoas.value,null);
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
