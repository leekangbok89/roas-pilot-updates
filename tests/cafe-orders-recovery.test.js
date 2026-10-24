'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {PassThrough}=require('node:stream');

const first='2026-09-01',second='2026-09-02',outside='2026-08-31';
const range={since:first,until:second};
const item={name:'위마망 복구 상품',option:'화이트',quantity:1};
const other={name:'트루버 다른 상품',option:'블랙',quantity:1};
const raw=(id,date=first,overrides={})=>({order_id:id,payment_date:date+'T12:00:00+09:00',paid:'T',initial_order_amount:{payment_amount:'100000'},actual_order_amount:{payment_amount:'100000'},...overrides});
const stored=(id,date=first,overrides={})=>({id,date,net:100000,gross:100000,refund:0,unverified:false,items:[item],...overrides});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};

function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'roas-cafe-recover-')),serverFile=path.join(dir,'server.js');
 const source=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
 fs.writeFileSync(serverFile,source+'\nmodule.exports.__setRecoveryRunner=fn=>{cafeRecoverOrders=fn;};\nmodule.exports.__setNormalCollector=(getter,today)=>{cafeFetchDate=getter;todaySeoul=()=>today;};\nmodule.exports.__collect=cafeCollect;\n');
 const app=require(serverFile);
 t.after(()=>{delete require.cache[serverFile];fs.rmSync(dir,{recursive:true,force:true});});
 const file=name=>path.join(dir,'.roas-data',name);
 const write=(name,value)=>{const target=file(name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(value));};
 const read=name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
 const seed=orders=>write('cafe24-orders/orders.json',{revision:'preserve-envelope',orders:Object.fromEntries(orders.map(order=>[order.id,order]))});
 const sync=(dates=[first,second,outside])=>write('cafe24-orders/sync.json',{extra:'preserve-sync',days:Object.fromEntries(dates.map(date=>[date,{count:1,checkedAt:'2026-10-01T00:00:00Z'}]))});
 seed([]);sync();
 write('naver-orders/orders.json',{orders:{}});
 write('naver-orders/sync.json',{days:Object.fromEntries([first,second,outside].map(date=>[date,{checkedAt:'2026-10-01T00:00:00Z'}]))});
 for(const date of [first,second,outside])write('daily/11111/'+date+'.json',{account:'11111',date,rows:[],currency:''});
 const key=crypto.createHash('sha256').update(JSON.stringify(['cafe24',item.name,item.option])).digest('hex').slice(0,24);
 write('product-costs.json',{[key]:{channel:'cafe24',name:item.name,option:item.option,cost:20000}});
 write('product-cost-aliases.json',{sentinel:'preserve aliases'});
 write('product-brand-scope.json',{sentinel:'preserve classifications'});
 const io=overrides=>({credentials:()=>({tokens:{access_token:'synthetic-token-never-return'}}),fetchDate:async date=>[raw('new-'+date,date)],orderItems:async()=>[item],orderDetails:async()=>null,delay:async()=>{},...overrides});
 const request=(method,url,body,{holdBody=false,headers={}}={})=>{
  const req=new PassThrough();Object.assign(req,{method,url,headers:{host:'127.0.0.1:3000','x-roas-local-action':'yes',...headers}});
  const res={statusCode:null,body:'',writeHead(status){this.statusCode=status;},end(value){this.body+=value||'';}};
  const done=Promise.resolve(app.server.listeners('request')[0](req,res)).then(()=>({status:res.statusCode,body:res.body?JSON.parse(res.body):null}));
  if(!holdBody)req.end(body===undefined?'':JSON.stringify(body));
  return {req,done};
 };
 const report=(since=first,until=second)=>app.profitDaily(since,until,{accounts:['11111'],fx:1350});
 return {...app,dir,file,write,read,seed,sync,io,request,report};
}

test('selected historical days are fetched despite completed sync, with outside orders and all other channel/settings files preserved',async t=>{
 const f=fixture(t);f.seed([stored('outside-order',outside),stored('old-unverified',first,{net:null,unverified:true,items:[]})]);
 const protectedFiles=['naver-orders/orders.json','naver-orders/sync.json','daily/11111/'+first+'.json','product-costs.json','product-cost-aliases.json','product-brand-scope.json'];
 const before=new Map(protectedFiles.map(name=>[name,fs.readFileSync(f.file(name),'utf8')]));
 const oldOutside=f.read('cafe24-orders/orders.json').orders['outside-order'],calls=[];
 const result=await f.cafeRecoverOrders(range,f.io({fetchDate:async date=>{calls.push(date);return [raw(date===first?'old-unverified':'restored-second',date)];}}));
 assert.deepEqual(calls,[first,second]);assert.equal(result.job.status,'완료');assert.equal(result.job.running,false);
 assert.equal(result.job.completedDays,2);assert.equal(result.job.ordersRestored,1);assert.equal(result.job.ordersUpdated,1);
 const saved=f.read('cafe24-orders/orders.json');assert.deepEqual(saved.orders['outside-order'],oldOutside);assert.equal(saved.revision,'preserve-envelope');
 assert.equal(saved.orders['old-unverified'].unverified,false);assert.equal(saved.orders['old-unverified'].itemsComplete,true);
 for(const [name,content] of before)assert.equal(fs.readFileSync(f.file(name),'utf8'),content,name);
 const report=f.report();assert.ok(report.days.every(day=>day.complete));assert.equal(report.days[0].cafe24.revenue,100000);assert.equal(report.days[0].profit,76500);
 assert.equal(f.read('cafe24-orders/sync.json').days[outside].complete,undefined,'unchanged valid outside sync remains intact');
 assert.doesNotMatch(JSON.stringify(result),/old-unverified|restored-second|outside-order|synthetic-token/);
});

for(const broken of ['missing','invalid_json','invalid_schema'])test(broken+' cache is backed up before rebuilding; unknown history is retained as incomplete',async t=>{
 const f=fixture(t);let original=null;
 if(broken==='missing')fs.unlinkSync(f.file('cafe24-orders/orders.json'));
 else{original=broken==='invalid_json'?'{ private-cache-original':JSON.stringify({orders:{outside:stored('outside',outside),invalid:null}});fs.writeFileSync(f.file('cafe24-orders/orders.json'),original);}
 const oldSync=fs.readFileSync(f.file('cafe24-orders/sync.json'),'utf8');
 assert.equal(f.report(first,first).days[0].cafe24.revenue,null);
 const result=await f.cafeRecoverOrders({since:first,until:first},f.io());
 assert.equal(result.job.status,'완료');assert.equal(result.job.backupCreated,true);
 const root=f.file('cafe24-orders/recovery-backups'),directories=fs.readdirSync(root);assert.equal(directories.length,1);
 const backup=path.join(root,directories[0]);assert.equal(fs.readFileSync(path.join(backup,'sync.json'),'utf8'),oldSync);
 if(original===null)assert.equal(fs.existsSync(path.join(backup,'orders.json')),false);else assert.equal(fs.readFileSync(path.join(backup,'orders.json'),'utf8'),original);
 const sync=f.read('cafe24-orders/sync.json');assert.equal(sync.days[first].complete,true);assert.equal(sync.days[second].complete,false);assert.equal(sync.days[outside].complete,false);
 if(broken==='invalid_schema')assert.ok(f.read('cafe24-orders/orders.json').orders.outside,'recognisable outside order survives schema repair');
 assert.equal(f.report(first,first).days[0].cafe24.revenue,100000);
 const outsideDay=f.report(second,second).days[0];assert.equal(outsideDay.cafe24.revenue,null);assert.equal(outsideDay.confirmedAvailable,false);assert.equal(outsideDay.confirmed.profit,null);
 assert.doesNotMatch(JSON.stringify(result),/private-cache-original|recovery-backups|outside-order/);
});

test('one failed date preserves orders, marks only that date incomplete, and permits later dates to recover',async t=>{
 const f=fixture(t),existing=stored('private-existing',first);f.seed([existing]);const calls=[];
 const result=await f.cafeRecoverOrders(range,f.io({fetchDate:async date=>{calls.push(date);if(date===first)throw Error('HTTP 503 secret-token customer@example.test private-existing');return [raw('later-private',date)];}}));
 assert.deepEqual(calls,[first,second]);assert.equal(result.job.status,'부분 완료');assert.equal(result.job.failedDays,1);assert.equal(result.job.completedDays,1);
 assert.deepEqual(f.read('cafe24-orders/orders.json').orders['private-existing'],existing);
 assert.equal(f.read('cafe24-orders/sync.json').days[first].complete,false);assert.equal(f.read('cafe24-orders/sync.json').days[second].complete,true);
 assert.equal(f.report().days[0].cafe24.revenue,null);assert.equal(f.report().days[1].cafe24.revenue,100000);
 assert.match(result.job.results[0].reason,/HTTP 503/);assert.doesNotMatch(JSON.stringify(result),/secret-token|customer@|private-existing|later-private/);
});

test('unverifiable or malformed list rows never overwrite existing orders or certify a zero day',async t=>{
 const f=fixture(t);f.seed([stored('keep')]);const original=fs.readFileSync(f.file('cafe24-orders/orders.json'),'utf8');
 const result=await f.cafeRecoverOrders({since:first,until:first},f.io({fetchDate:async()=>[null,raw('keep',first,{actual_order_amount:null,initial_order_amount:null})],orderDetails:async()=>({order:{order_id:'keep',paid:'T'}})}));
 assert.equal(result.job.invalidOrders,2);assert.equal(result.job.ordersUpdated,0);assert.notEqual(result.job.status,'완료');
 assert.equal(fs.readFileSync(f.file('cafe24-orders/orders.json'),'utf8'),original);
 const day=f.report(first,first).days[0];assert.equal(day.cafe24.revenue,null);assert.equal(day.confirmedAvailable,false);assert.equal(day.profit,null);
});

test('an incomplete payment list row is repaired through the order detail before being stored',async t=>{
 const f=fixture(t);let details=0;
 const result=await f.cafeRecoverOrders({since:first,until:first},f.io({fetchDate:async()=>[{order_id:'payment-repair',paid:'T'}],orderDetails:async order=>{details++;assert.equal(order.id,'payment-repair');return {order:raw(order.id)};}}));
 assert.equal(details,1);assert.equal(result.job.status,'완료');assert.equal(result.job.invalidOrders,0);assert.equal(f.report(first,first).days[0].cafe24.revenue,100000);
});

test('every positive order gets fresh full item verification; a formerly truncated excluded order becomes mixed, never allocated',async t=>{
 const f=fixture(t);f.seed([stored('legacy-truncated',first,{items:[other]})]);let detailCalls=0;
 const result=await f.cafeRecoverOrders({since:first,until:first},f.io({fetchDate:async()=>[raw('legacy-truncated')],orderItems:async()=>{detailCalls++;return [item,other];}}));
 assert.equal(detailCalls,1);assert.equal(result.job.status,'완료');
 const order=f.read('cafe24-orders/orders.json').orders['legacy-truncated'];assert.equal(order.items.length,2);assert.equal(order.itemsComplete,true);assert.equal(order.rawItemCount,2);
 const day=f.report(first,first).days[0];assert.equal(day.cafe24.revenue,null);assert.equal(day.cafe24.mixedOrders,1);assert.equal(day.cafe24.excludedOrders,0);assert.equal(day.confirmedAvailable,false);
});

test('missing full items after a successful list remains partial and cannot reuse a legacy subset as completed excluded zero',async t=>{
 const f=fixture(t);f.seed([stored('legacy-subset',first,{items:[other]})]);
 const result=await f.cafeRecoverOrders({since:first,until:first},f.io({fetchDate:async()=>[raw('legacy-subset')],orderItems:async()=>[]}));
 assert.equal(result.job.status,'부분 완료');assert.equal(result.job.itemsMissing,1);assert.equal(result.job.completedDays,0);
 assert.equal(f.read('cafe24-orders/sync.json').days[first].complete,true,'the order list is complete while item attribution is not');
 const day=f.report(first,first).days[0];assert.equal(day.cafe24.revenue,null);assert.equal(day.cafe24.missingItemOrders,1);assert.equal(day.cafe24.excludedOrders,0);assert.equal(day.confirmedAvailable,false);
});

test('an empty current list never deletes a previously stored order or falsely completes its day',async t=>{
 const f=fixture(t),existing=stored('not-returned');f.seed([existing]);
 const result=await f.cafeRecoverOrders({since:first,until:first},f.io({fetchDate:async()=>[]}));
 assert.equal(result.job.status,'부분 완료');assert.match(result.job.results[0].reason,/기존 주문을 보존/);
 assert.deepEqual(f.read('cafe24-orders/orders.json').orders['not-returned'],existing);assert.equal(f.read('cafe24-orders/sync.json').days[first].complete,false);
 assert.equal(f.report(first,first).days[0].cafe24.revenue,null);
});

test('fresh empty API data can confirm zero when no saved order contradicts it',async t=>{
 const f=fixture(t);const result=await f.cafeRecoverOrders({since:first,until:first},f.io({fetchDate:async()=>[]}));
 assert.equal(result.job.status,'완료');assert.equal(result.job.ordersFetched,0);assert.equal(f.read('cafe24-orders/sync.json').days[first].count,0);
 const report=f.report(first,first);assert.equal(report.days[0].cafe24.revenue,0);assert.equal(report.days[0].complete,true);assert.equal(report.revenueDiagnostics.cafe24.zeroReason,'no_orders');
});

test('a concurrently changed payment and unrelated additions survive the recovery merge',async t=>{
 const f=fixture(t);f.seed([stored('changing')]);const gate=deferred();
 const work=f.cafeRecoverOrders({since:first,until:first},f.io({fetchDate:async()=>{await gate.promise;return [raw('changing')];}}));
 const current=f.read('cafe24-orders/orders.json');current.orders.changing.net=70000;current.orders.changing.refund=30000;current.orders.added=stored('added',outside);f.write('cafe24-orders/orders.json',current);
 gate.resolve();const result=await work;
 assert.equal(result.job.status,'부분 완료');assert.equal(result.job.ordersUpdated,0);assert.deepEqual(f.read('cafe24-orders/orders.json'),current);
 assert.match(result.job.results[0].reason,/최신 저장 자료를 보존/);assert.equal(f.read('cafe24-orders/sync.json').days[first].complete,false);
});

for(const code of [401,403,429])test('HTTP '+code+' stops on the first day without overwriting any cache or sync, and hides raw API details',async t=>{
 const f=fixture(t);f.seed([stored('private')]);const originalOrders=fs.readFileSync(f.file('cafe24-orders/orders.json'),'utf8'),originalSync=fs.readFileSync(f.file('cafe24-orders/sync.json'),'utf8');let calls=0;
 const result=await f.cafeRecoverOrders(range,f.io({fetchDate:async()=>{calls++;throw Error('HTTP '+code+' token=private-secret customer@example.test');}}));
 assert.equal(calls,1);assert.equal(result.job.done,1);assert.equal(result.job.running,false);assert.equal(result.job.status,code===429?'실패':'인증 필요');
 assert.equal(fs.readFileSync(f.file('cafe24-orders/orders.json'),'utf8'),originalOrders);assert.equal(fs.readFileSync(f.file('cafe24-orders/sync.json'),'utf8'),originalSync);
 assert.equal(result.job.backupCreated,false);assert.doesNotMatch(JSON.stringify(result),/private-secret|customer@/);
});

test('item and payment-detail authentication failures stop further order/day requests',async t=>{
 for(const stage of ['items','payment']){
  const f=fixture(t);let lists=0,details=0;
  const result=await f.cafeRecoverOrders(range,f.io({fetchDate:async date=>{lists++;return stage==='items'?[raw('one',date),raw('two',date)]:[{order_id:'one'}];},orderItems:async()=>{details++;throw Error('HTTP 401 private-token');},orderDetails:async()=>{details++;throw Error('HTTP 403 private-token');}}));
  assert.equal(lists,1);assert.equal(details,1);assert.equal(result.job.status,'인증 필요');assert.equal(result.job.ordersRestored,0);assert.doesNotMatch(JSON.stringify(result),/private-token/);
 }
});

test('missing credentials and invalid ranges fail before any API request or file mutation',async t=>{
 const f=fixture(t);let calls=0;const io=f.io({fetchDate:async()=>{calls++;return [];}});
 for(const invalid of [{},{since:'2026-02-30',until:'2026-03-01'},{since:second,until:first},{since:'2023-01-01',until:'2026-09-01'},{since:first+'T00:00:00Z',until:second}])await assert.rejects(f.cafeRecoverOrders(invalid,io),error=>error.status===400);
 const before=fs.readFileSync(f.file('cafe24-orders/sync.json'),'utf8');
 const result=await f.cafeRecoverOrders(range,{...io,credentials:()=>null});
 assert.equal(calls,0);assert.equal(result.job.status,'인증 필요');assert.equal(result.job.running,false);assert.equal(result.job.done,0);assert.equal(fs.readFileSync(f.file('cafe24-orders/sync.json'),'utf8'),before);
});

test('the HTTP action validates local intent and range, locks before awaits, and reconnects through read-only status',async t=>{
 const f=fixture(t),gate=deferred();let work;
 const actual=f.cafeRecoverOrders;f.__setRecoveryRunner(selected=>(work=actual(selected,f.io({fetchDate:async date=>{await gate.promise;return [raw('http-'+date,date)];}}))));
 assert.equal((await f.request('POST','/api/cafe24/orders/recover',range,{headers:{'x-roas-local-action':'no'}}).done).status,403);
 assert.equal((await f.request('POST','/api/cafe24/orders/recover',{since:second,until:first}).done).status,400);
 const slow=f.request('POST','/api/cafe24/orders/recover',undefined,{holdBody:true});slow.req.write('{"since":"'+first+'",');
 const started=await f.request('POST','/api/cafe24/orders/recover',range).done;assert.equal(started.status,202);assert.equal(started.body.job.running,true);assert.equal(started.body.job.since,first);
 slow.req.end('"until":"'+second+'"}');assert.equal((await slow.done).status,409);
 for(const [url,body] of [['/api/costs/catalog/refresh',range],['/api/cafe24/orders/sync',{mode:'backfill'}],['/api/naver/orders/sync',{mode:'recent'}],['/api/data/recent3/refresh',{accounts:[]}]])assert.equal((await f.request('POST',url,body).done).status,409,url);
 assert.equal((await f.request('GET','/api/cafe24/orders/recovery/status').done).body.job.running,true);
 gate.resolve();await work;const status=await f.request('GET','/api/cafe24/orders/recovery/status').done;
 assert.equal(status.status,200);assert.equal(status.body.job.running,false);assert.equal(status.body.job.status,'완료');assert.equal(status.body.job.completedDays,2);
});

test('normal backfill re-queries a previously completed day whose recorded orders are missing',async t=>{
 const f=fixture(t),day='2026-06-01';f.sync([day]);let calls=0;
 f.__setNormalCollector(async date=>{calls++;assert.equal(date,day);return [raw('restored-backfill',date,{items:[{product_name:item.name,option_value:item.option,quantity:1}]})];},day);
 await f.__collect('backfill');assert.equal(calls,1);assert.ok(f.read('cafe24-orders/orders.json').orders['restored-backfill']);assert.equal(f.read('cafe24-orders/sync.json').days[day].complete,true);
 await f.__collect('backfill');assert.equal(calls,1,'verified matching records can still be skipped');
});

test('the real date fetch verifies count and every page before returning, including a valid empty response',async t=>{
 const f=fixture(t),calls=[];
 const values=Array.from({length:101},(_,i)=>raw('page-'+i));
 const result=await f.cafeFetchDate(first,async endpoint=>{calls.push(endpoint);const url=new URL(endpoint,'https://fixture.invalid/');assert.equal(url.searchParams.get('date_type'),'pay_date');assert.equal(url.searchParams.get('shop_no'),'1');assert.equal(url.searchParams.get('start_date'),first+' 00:00:00');if(url.pathname==='/orders/count')return {count:101};const offset=Number(url.searchParams.get('offset'));return {orders:values.slice(offset,offset+100)};},async()=>{});
 assert.equal(result.length,101);assert.equal(calls.length,3);
 assert.deepEqual(await f.cafeFetchDate(first,async endpoint=>endpoint.startsWith('orders/count?')?{count:0}:{orders:[]},async()=>{}),[]);
 await assert.rejects(f.cafeFetchDate(first,async endpoint=>endpoint.startsWith('orders/count?')?{count:1}:{orders:[]},async()=>{}),error=>error.code==='CAFE_COUNT');
 await assert.rejects(f.cafeFetchDate(first,async()=>({orders:[]}),async()=>{}),error=>error.code==='CAFE_RESPONSE');
 await assert.rejects(f.cafeFetchDate(first,async endpoint=>endpoint.startsWith('orders/count?')?{count:0}: {},async()=>{}),error=>error.code==='CAFE_RESPONSE');
});

test('final additional payment above the initial payment is not capped',t=>{
 const f=fixture(t),order=f.cafeParseOrder(raw('additional',first,{initial_order_amount:{payment_amount:'100000'},actual_order_amount:{payment_amount:'130000'}}));
 assert.equal(order.net,130000);assert.equal(order.gross,130000);assert.equal(order.refund,0);
});
test('a zero initial amount with positive final payment is recovered from an old cached zero',async t=>{
 const f=fixture(t);f.seed([stored('old-zero',first,{net:0,gross:0})]);
 const result=await f.cafeRecoverOrders({since:first,until:first},f.io({fetchDate:async()=>[raw('old-zero',first,{initial_order_amount:{payment_amount:'0'},actual_order_amount:{payment_amount:'50000'}})]}));
 assert.equal(result.job.status,'완료');assert.equal(f.report(first,first).days[0].cafe24.revenue,50000);assert.equal(f.read('cafe24-orders/orders.json').orders['old-zero'].gross,50000);
});
test('partial refunds retain final payment and a nonnegative refund amount',t=>{
 const f=fixture(t),order=f.cafeParseOrder(raw('refund',first,{actual_order_amount:{payment_amount:'60000'}}));
 assert.equal(order.net,60000);assert.equal(order.gross,100000);assert.equal(order.refund,40000);
});
test('a confirmed complete cancellation remains zero without calling item recovery',async t=>{
 const f=fixture(t);let details=0;const result=await f.cafeRecoverOrders({since:first,until:first},f.io({fetchDate:async()=>[raw('cancelled',first,{canceled:'T',actual_order_amount:{payment_amount:'0'}})],orderItems:async()=>{details++;return [];}}));
 assert.equal(result.job.status,'완료');assert.equal(details,0);assert.equal(f.report(first,first).days[0].cafe24.revenue,0);assert.equal(f.read('cafe24-orders/orders.json').orders.cancelled.refund,100000);
});
test('missing final payment and explicit unpaid status remain unverified',t=>{
 const f=fixture(t);
 assert.equal(f.cafeParseOrder(raw('unknown',first,{actual_order_amount:null})).unverified,true);
 assert.equal(f.cafeParseOrder(raw('unpaid',first,{paid:'F'})).unverified,true);
});
