'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8').split('\nfunction render(){')[0];

function harness(){
 const nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',innerHTML:''});return nodes.get(id);};
 const context=vm.createContext({Intl,document:{getElementById:node}});
 vm.runInContext(source,context);
 return {context,node,run:code=>vm.runInContext(code,context),benchmark:ads=>{context.input=ads;return JSON.parse(vm.runInContext('JSON.stringify(adBenchmark(input))',context));}};
}
const ad=(id,spend,revenue,purchases,extras={})=>({id,spend,revenue,purchases,...extras});

test('benchmark includes all advertising costs when some ads have no reported purchases',()=>{
 const h=harness(),base=h.benchmark([ad('purchase',10,600,3),ad('unreported',990,null,null)]);
 assert.equal(base.roas,60,'600 confirmed revenue / 1,000 total spend, not 600 / 10');
 assert.equal(base.cpa,1000/3,'Missing purchase reporting must not remove its advertising costs');
 assert.equal(base.roasPartial,true);assert.equal(base.cpaPartial,true);assert.equal(base.spendPartial,false);
 assert.equal(base.count,1,'The comparable-ad sample count retains its purchase-and-revenue meaning');
});

test('ROAS does not require purchase counts and includes zero-spend revenue in the same selection',()=>{
 const h=harness(),base=h.benchmark([ad('no-count',100,100,null),ad('paid',900,400,2),ad('zero-spend',0,100,1)]);
 assert.equal(base.roas,60);assert.equal(base.cpa,1000/3);
 assert.equal(base.roasPartial,false);assert.equal(base.cpaPartial,true);assert.equal(base.count,1);
 const zeroSpend=h.benchmark([ad('organic-attribution',0,100,1)]);
 assert.equal(zeroSpend.roas,null,'Zero advertising spend cannot yield a finite ROAS');
 assert.equal(zeroSpend.cpa,0,'Confirmed zero cost divided by a positive count is zero');
});

test('unreported purchase revenue remains unknown while explicit zero remains zero',()=>{
 const h=harness();
 const unknown=h.benchmark([ad('unknown',100,null,null),ad('empty',0,null,null)]);
 assert.equal(unknown.roas,null);assert.equal(unknown.cpa,null);
 assert.equal(unknown.roasPartial,true);assert.equal(unknown.cpaPartial,true);
 h.context.base=unknown;assert.match(h.run('benchmarkRoasText(base)'),/—.*미확정/);
 const zero=h.benchmark([ad('a',100,0,0),ad('b',900,0,0)]);
 assert.equal(zero.roas,0);assert.equal(zero.cpa,null);
 assert.equal(zero.roasPartial,false);assert.equal(zero.cpaPartial,false);
 const partialZero=h.benchmark([ad('known-zero',100,0,0),ad('unknown',900,null,null)]);
 assert.equal(partialZero.roas,0);assert.equal(partialZero.roasPartial,true);
 const empty=h.benchmark([]);assert.equal(empty.roas,null);assert.equal(empty.cpa,null);assert.equal(empty.count,0);
});

test('mixed or invalid spend never invents a complete benchmark',()=>{
 const h=harness();
 for(const spend of [null,NaN,Infinity,-10]){
  const base=h.benchmark([ad('valid',100,60,1),ad('bad-spend',spend,40,1)]);
  assert.equal(base.roas,null);assert.equal(base.cpa,null);
  assert.equal(base.spendPartial,true);assert.equal(base.roasPartial,true);assert.equal(base.cpaPartial,true);
 }
});

test('daily aggregation preserves missing purchase fields within an otherwise reported ad',()=>{
 const h=harness();h.context.input=[ad('same-ad',100,600,3,{date:'2026-09-01'}),ad('same-ad',900,null,null,{date:'2026-09-02'})];
 const result=JSON.parse(h.run('JSON.stringify((()=>{const ads=aggregate(input);return {ad:ads[0],base:adBenchmark(ads)}})())'));
 assert.equal(result.ad.spend,1000);assert.equal(result.ad.roas,60);
 assert.equal(result.ad.roasPartial,true);assert.equal(result.ad.cpaPartial,true);
 assert.equal(result.base.roas,60);assert.equal(result.base.cpa,1000/3);
 assert.equal(result.base.roasPartial,true);assert.equal(result.base.cpaPartial,true);assert.equal(result.base.count,1);
 h.context.input[1].spend=null;
 const invalid=JSON.parse(h.run('JSON.stringify(adBenchmark(aggregate(input)))'));
 assert.equal(invalid.spendPartial,true);assert.equal(invalid.roas,null);assert.equal(invalid.cpa,null);
});

test('diagnosis does not treat a partially reported benchmark as a confirmed scale or stop signal',()=>{
 const h=harness();h.context.input=[ad('complete',100,600,10),ad('missing',900,null,null)];
 const result=JSON.parse(h.run('JSON.stringify((()=>{const ads=aggregate(input),base=adBenchmark(ads);return diagnose(ads[0],{baseline:base,min:3})})())'));
 assert.equal(result.status,'learn');
 assert.ok(result.reasons.some(reason=>/평균 ROAS.*구매매출 미확인/.test(reason)));
 assert.ok(result.reasons.some(reason=>/평균 구매 CPA.*구매수 미확인/.test(reason)));
 assert.ok(!result.reasons.some(reason=>/^(ROAS|구매 CPA) .*전체 평균/.test(reason)));
 assert.ok(!result.actions.some(action=>/예산 증액/.test(action)));
 h.context.target=ad('no-purchases',1000,0,0,{roas:0,cpa:null});
 const stop=JSON.parse(h.run('JSON.stringify(diagnose(target,{baseline:adBenchmark(aggregate(input)),min:3}))'));
 assert.equal(stop.status,'learn');assert.ok(stop.actions.some(action=>/미확인 구매수/.test(action)));
});

test('complete benchmark preserves the comparable sample count and existing diagnosis',()=>{
 const h=harness();h.context.input=[ad('strong',100,200,4),ad('b',100,100,2),ad('c',100,100,2)];
 const result=JSON.parse(h.run('JSON.stringify((()=>{const ads=aggregate(input),base=adBenchmark(ads);return {base,diagnosis:diagnose(ads[0],{baseline:base,min:3})}})())'));
 assert.equal(result.base.count,3);assert.equal(result.base.roas,400/300*100);assert.equal(result.base.cpa,300/8);
 assert.equal(result.base.roasPartial,false);assert.equal(result.base.cpaPartial,false);
 assert.equal(result.diagnosis.status,'scale');
});

test('the visible chart benchmark identifies a partial average',()=>{
 const h=harness();h.context.input=[ad('a',100,600,3,{date:'2026-09-01'}),ad('b',900,null,null,{date:'2026-09-02'})];
 h.run('state.rows=input;plot();');
 assert.match(h.node('chart').innerHTML,/평균 60% · 확인분/);
});
