'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {PassThrough}=require('node:stream');

const selected={since:'2026-09-01',until:'2026-09-30'};
const item={name:'위마망 백도씨',option:'화이트',quantity:1};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const navDetail=id=>({productOrder:{productOrderId:String(id),productName:item.name,productOption:item.option,quantity:item.quantity}});
const cafePayload={items:[{product_name:item.name,option_value:item.option,quantity:item.quantity}]};

function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'roas-history-test-')),serverFile=path.join(dir,'server.js');
 const source=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
 // The temporary fixture injects API stubs into the real HTTP handler without
 // adding a test override endpoint or credentials hook to production code.
 fs.writeFileSync(serverFile,source+'\nmodule.exports.__setCatalogRunner=fn=>{enrichCostCatalog=fn;};\n');
 const app=require(serverFile);
 t.after(()=>{delete require.cache[serverFile];fs.rmSync(dir,{recursive:true,force:true});});
 const write=(relative,value)=>{const file=path.join(dir,'.roas-data',relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value));};
 const read=relative=>JSON.parse(fs.readFileSync(path.join(dir,'.roas-data',relative),'utf8'));
 const seed=(channel,orders)=>write(channel+'-orders/orders.json',{orders:Object.fromEntries(orders.map(order=>[String(order.id),order]))});
 const order=(channel,id,date='2026-09-27',items=[])=>({id:String(id),[channel==='naver'?'paymentDate':'date']:date,net:300000,gross:300000,refund:0,items});
 for(const channel of ['naver','cafe24']){seed(channel,[]);write(channel+'-orders/sync.json',{days:{'2026-09-27':{checkedAt:'2026-10-01T00:00:00Z'}}});}
 write('daily/11111/2026-09-27.json',{account:'11111',date:'2026-09-27',rows:[],currency:''});
 const key=crypto.createHash('sha256').update(JSON.stringify(['cafe24',item.name,item.option])).digest('hex').slice(0,24);
 write('product-costs.json',{[key]:{channel:'cafe24',name:item.name,option:item.option,cost:150000}});
 const io=(overrides={})=>({naverCredentials:()=>({configured:true}),naverToken:async()=>({token:'test-only-token'}),naverDetails:async ids=>ids.map(navDetail),cafeCredentials:()=>({tokens:{access_token:'test-only-token'}}),cafeItems:(order,diagnose)=>app.cafeOrderItems(order,async()=>cafePayload,diagnose),delay:async()=>{},...overrides});
 const request=(method,url,body,{holdBody=false}={})=>{
  const req=new PassThrough();Object.assign(req,{method,url,headers:{host:'127.0.0.1:3000','x-roas-local-action':'yes'}});
  const res={statusCode:null,body:'',writeHead(status){this.statusCode=status;},end(value){this.body+=value||'';}};
  const done=Promise.resolve(app.server.listeners('request')[0](req,res)).then(()=>({status:res.statusCode,body:res.body?JSON.parse(res.body):null}));
  if(!holdBody)req.end(body===undefined?'':JSON.stringify(body));
  return {req,done};
 };
 return {...app,dir,write,read,seed,order,io,request};
}
async function until(predicate){for(let i=0;i<100;i++){if(predicate())return;await new Promise(resolve=>setImmediate(resolve));}assert.fail('worker did not reach expected state');}

test('Cafe24 remaining118 is initialized before requests and finishes independently of a blocked or failed779-order Naver repair',async t=>{
 const f=fixture(t),navGate=deferred(),cafeGate=deferred();let navCalls=0,cafeCalls=0;
 f.seed('naver',Array.from({length:779},(_,i)=>f.order('naver',10000000+i)));
 f.seed('cafe24',Array.from({length:139},(_,i)=>f.order('cafe24','c'+i,'2026-09-27',i<118?[]:[item])));
 const syncBefore=f.read('cafe24-orders/sync.json');
 const work=f.enrichCostCatalog(selected,f.io({
  naverDetails:async ids=>{navCalls++;if(navCalls===1){await navGate.promise;throw Error('네이버 API HTTP 503');}return ids.map(navDetail);},
  cafeItems:async(order,diagnose)=>{cafeCalls++;if(cafeCalls===1)await cafeGate.promise;return f.cafeOrderItems(order,async()=>cafePayload,diagnose);}
 }));
 let d=f.catalogDiagnostics();
 assert.equal(d.cafe24.total,118);assert.equal(d.job.sources.cafe24.total,118);assert.equal(d.job.sources.cafe24.remaining,118);assert.equal(d.job.sources.cafe24.checked,0);
 assert.equal(d.job.sources.naver.total,779);assert.equal(d.job.sources.cafe24.status,'진행 중');
 cafeGate.resolve();await until(()=>f.catalogDiagnostics().job.sources.cafe24.status==='완료');
 d=f.catalogDiagnostics();assert.equal(d.job.running,true);assert.equal(d.job.sources.naver.checked,0);assert.equal(d.job.sources.cafe24.checked,118);assert.equal(d.job.sources.cafe24.restored,118);assert.equal(d.job.sources.cafe24.remaining,0);
 assert.deepEqual(d.job.failures,{},'successful detail reads must not be listed as failures');
 navGate.resolve();await work;d=f.catalogDiagnostics();
 assert.equal(navCalls,8,'failed first Naver batch must not suppress later batches');
 assert.equal(d.job.sources.naver.checked,779);assert.equal(d.job.sources.naver.restored,679);assert.equal(d.job.sources.naver.remaining,100);
 assert.equal(d.job.sources.naver.status,'부분 완료');assert.equal(d.job.sources.cafe24.status,'완료');assert.equal(d.job.running,false);
 assert.deepEqual(f.read('cafe24-orders/sync.json'),syncBefore,'detail repair must not manufacture collection markers');
});

test('selected September range leaves June and October untouched and merges items without overwriting in-flight payment changes',async t=>{
 const f=fixture(t),gate=deferred();
 f.seed('cafe24',[f.order('cafe24','june','2026-06-01'),f.order('cafe24','sept'),f.order('cafe24','oct','2026-10-10')]);
 const before=f.read('cafe24-orders/orders.json');let calls=[];
 const work=f.enrichCostCatalog(selected,f.io({cafeItems:async(order,diagnose)=>{calls.push(order.id);await gate.promise;return f.cafeOrderItems(order,async()=>cafePayload,diagnose);}}));
 assert.equal(f.catalogDiagnostics().job.sources.cafe24.remaining,1);
 const fresh=f.read('cafe24-orders/orders.json');fresh.orders.sept.net=250000;fresh.orders.sept.refund=50000;fresh.orders.newer=f.order('cafe24','newer','2026-10-12');f.write('cafe24-orders/orders.json',fresh);
 gate.resolve();await work;
 const after=f.read('cafe24-orders/orders.json');
 assert.deepEqual(calls,['sept']);assert.deepEqual(after.orders.june,before.orders.june);assert.deepEqual(after.orders.oct,before.orders.oct);
 assert.equal(after.orders.sept.net,250000);assert.equal(after.orders.sept.refund,50000);assert.ok(after.orders.newer);
 assert.deepEqual(after.orders.sept.items,[{...item,key:after.orders.sept.items[0].key,channel:'cafe24'}]);
 assert.equal(f.catalogDiagnostics().cafe24.total,3,'global missing count is separate from the selected-range job count');
 assert.equal(f.catalogDiagnostics().job.sources.cafe24.remaining,0);
});

test('Cafe24 invalid schemas and failed requests stay missing, later orders continue, and rerun targets only the unresolved order',async t=>{
 const f=fixture(t);f.seed('cafe24',[f.order('cafe24','bad'),f.order('cafe24','good')]);
 const before=f.read('cafe24-orders/orders.json'),sync=f.read('cafe24-orders/sync.json');
 const first=await f.enrichCostCatalog(selected,f.io({cafeItems:(order,diagnose)=>f.cafeOrderItems(order,async()=>order.id==='bad'?{items:[{product_name:'위마망 상품',quantity:null}]}:cafePayload,diagnose)}));
 assert.equal(first.job.sources.cafe24.checked,2);assert.equal(first.job.sources.cafe24.restored,1);assert.equal(first.job.sources.cafe24.remaining,1);assert.equal(first.job.sources.cafe24.status,'부분 완료');
 assert.match(first.job.sources.cafe24.error,/상품명·옵션·수량/);assert.ok(Object.keys(first.job.failures).length>0);
 assert.deepEqual(f.read('cafe24-orders/orders.json').orders.bad,before.orders.bad);assert.deepEqual(f.read('cafe24-orders/sync.json'),sync);
 const attempts=[];const second=await f.enrichCostCatalog(selected,f.io({cafeItems:(order,diagnose)=>{attempts.push(order.id);return f.cafeOrderItems(order,async()=>cafePayload,diagnose);}}));
 assert.deepEqual(attempts,['bad']);assert.equal(second.job.sources.cafe24.total,1);assert.equal(second.job.sources.cafe24.remaining,0);assert.deepEqual(second.job.failures,{});
});

test('missing credentials keep checked0 and truthful remaining counts without blocking the other channel',async t=>{
 const f=fixture(t);f.seed('naver',[f.order('naver',10000001)]);f.seed('cafe24',[f.order('cafe24','cafe')]);
 const result=await f.enrichCostCatalog(selected,f.io({naverCredentials:()=>null}));
 assert.equal(result.job.sources.naver.status,'인증 필요');assert.equal(result.job.sources.naver.checked,0);assert.equal(result.job.sources.naver.remaining,1);
 assert.equal(result.job.sources.cafe24.status,'완료');assert.equal(result.job.sources.cafe24.restored,1);
});

test('coverage is read-only, distinguishes cached orders missing details from uncollected days, and becomes complete only for repaired saved dates',async t=>{
 const f=fixture(t);f.seed('cafe24',[f.order('cafe24','sept')]);
 const beforeOrders=f.read('cafe24-orders/orders.json'),beforeSync=f.read('cafe24-orders/sync.json');
 let coverage=f.dataCoverage('2026-09-26','2026-09-27',['11111']);
 assert.equal(coverage.totalDays,2);assert.equal(coverage.sources.cafe24.positiveOrders,1);assert.equal(coverage.sources.cafe24.storedDays,1);
 assert.deepEqual(coverage.sources.cafe24.missingDays,['2026-09-26']);assert.equal(coverage.sources.cafe24.missingItemOrders,1);assert.deepEqual(coverage.sources.cafe24.missingItemDates,[{date:'2026-09-27',count:1}]);
 assert.deepEqual(f.read('cafe24-orders/orders.json'),beforeOrders);assert.deepEqual(f.read('cafe24-orders/sync.json'),beforeSync);
 await f.enrichCostCatalog(selected,f.io());coverage=f.dataCoverage('2026-09-26','2026-09-27',['11111']);
 assert.equal(coverage.sources.cafe24.missingItemOrders,0);assert.equal(coverage.profit.completeDays,1);assert.equal(coverage.profit.unavailableDays,1);
 const report=f.profitDaily('2026-09-26','2026-09-27',{accounts:['11111'],fx:1350});
 assert.equal(report.days[0].profit,null);assert.equal(report.days[1].profit,139500);
 assert.deepEqual(f.read('cafe24-orders/sync.json'),beforeSync);
});

test('overlapping POST request bodies cannot clear the active catalog lock and competing updates are rejected',async t=>{
 const f=fixture(t),gate=deferred();f.seed('cafe24',[f.order('cafe24','sept')]);
 const original=f.enrichCostCatalog;let work;
 f.__setCatalogRunner(range=>(work=original(range,f.io({cafeItems:async(order,diagnose)=>{await gate.promise;return f.cafeOrderItems(order,async()=>cafePayload,diagnose);}}))));
 const slow=f.request('POST','/api/costs/catalog/refresh',undefined,{holdBody:true});slow.req.write('{"since":"2026-09-01",');
 const started=await f.request('POST','/api/costs/catalog/refresh',selected).done;
 assert.equal(started.status,202);assert.equal(f.catalogDiagnostics().job.running,true);
 slow.req.end('"until":"2026-09-30"}');const rejected=await slow.done;
 assert.equal(rejected.status,409);assert.equal(f.catalogDiagnostics().job.running,true);
 assert.equal((await f.request('POST','/api/data/recent3/refresh',{accounts:[]}).done).status,409);
 assert.equal((await f.request('POST','/api/cafe24/orders/sync',{mode:'recent'}).done).status,409);
 assert.equal((await f.request('POST','/api/naver/orders/sync',{mode:'recent'}).done).status,409);
 gate.resolve();await work;assert.equal(f.catalogDiagnostics().job.running,false);
});

test('invalid selected ranges fail before API calls, and Naver missing quantity is never guessed during repair',async t=>{
 const f=fixture(t);let calls=0;
 await assert.rejects(f.enrichCostCatalog({since:'2026-09-30',until:'2026-09-01'},f.io({naverDetails:async()=>{calls++;return [];}})),/복구할 조회 기간/);
 assert.equal(calls,0);assert.equal(f.catalogDiagnostics().job.running,false);
 f.seed('naver',[f.order('naver',10000001)]);
 const result=await f.enrichCostCatalog(selected,f.io({naverDetails:async ids=>ids.map(id=>({productOrder:{productOrderId:id,productName:item.name}}))}));
 assert.equal(result.job.sources.naver.restored,0);assert.equal(result.job.sources.naver.remaining,1);assert.match(result.job.sources.naver.error,/수량/);
 assert.deepEqual(f.read('naver-orders/orders.json').orders['10000001'].items,[]);
});
