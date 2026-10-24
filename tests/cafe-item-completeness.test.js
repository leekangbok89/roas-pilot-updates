'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const day='2026-09-29';
const source=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');

// Exercise the real parser, collection, repair and reporting functions without
// opening a port, reaching an API or reading/writing a user's order cache.
function fixture(){
 const root='/virtual-cafe-item-completeness',files=new Map();
 const memoryFs={
  readFileSync(file){const key=String(file);if(!files.has(key))throw Object.assign(Error('ENOENT'),{code:'ENOENT'});return files.get(key);},
  writeFileSync(file,value){files.set(String(file),String(value));},
  existsSync:file=>files.has(String(file)),mkdirSync(){},
  renameSync(from,to){files.set(String(to),files.get(String(from)));files.delete(String(from));},
  unlinkSync:file=>files.delete(String(file)),readdirSync:()=>[]
 };
 const blocked=()=>{throw Error('External I/O is forbidden in this fixture');};
 const isolatedRequire=name=>name==='node:fs'?memoryFs:name==='node:http'?{createServer:()=>({listen:blocked})}:name==='node:child_process'?{spawnSync:blocked}:require(name);
 const context=vm.createContext({require:isolatedRequire,module:{exports:{}},__dirname:root,process,Buffer,URL,URLSearchParams,console,AbortSignal,fetch:blocked,setTimeout:fn=>{fn();return 0;},setInterval:blocked});
 vm.runInContext(source+'\nmodule.exports.itemReview={cafeParseOrder,cafeCollect,completeOrderItems};',context);
 const app=context.module.exports;
 const location=name=>path.join(root,'.roas-data',name);
 const write=(name,value)=>files.set(location(name),JSON.stringify(value));
 const read=name=>JSON.parse(files.get(location(name)));
 const setOrders=orders=>{
  write('cafe24-orders/orders.json',{orders});
  write('cafe24-orders/sync.json',{days:{[day]:{count:Object.keys(orders).length,checkedAt:day+'T12:00:00Z'}}});
 };
 setOrders({});
 write('naver-orders/orders.json',{orders:{}});
 write('naver-orders/sync.json',{days:{[day]:{ids:0,details:0}}});
 const detailCalls=[];
 const collect=async(raw,getDetail)=>{
  context.reviewDay=day;
  context.reviewGet=async endpoint=>{
   const url=new URL(endpoint,'https://fixture.invalid/');
   if(url.pathname==='/orders/count')return {count:url.searchParams.get('start_date')?.startsWith(day)?1:0};
   if(url.pathname==='/orders')return {orders:url.searchParams.get('start_date')?.startsWith(day)?[raw]:[]};
   detailCalls.push(endpoint);
   return getDetail(endpoint);
  };
  vm.runInContext('todaySeoul=()=>reviewDay;cafeAuthorizedGet=reviewGet;',context);
  await app.itemReview.cafeCollect('recent3');
  return read('cafe24-orders/orders.json').orders[raw.order_id];
 };
 const report=()=>app.profitDaily(day,day);
 return {app,write,read,setOrders,detailCalls,collect,report};
}

function rawOrder(items){
 return {order_id:'synthetic-order',payment_date:day+'T10:00:00+09:00',paid:'T',canceled:'F',initial_order_amount:{payment_amount:'50000'},actual_order_amount:{payment_amount:'50000'},items};
}

function assertPendingDetails(result){
 const row=result.days[0].cafe24,diagnostic=result.revenueDiagnostics.cafe24;
 assert.equal(row.revenue,null,'An incomplete item set cannot certify whole-order brand revenue');
 assert.equal(row.fee,null);assert.equal(row.cost,null);
 assert.equal(row.complete,false);assert.equal(row.revenueComplete,false);
 assert.equal(row.confirmedAvailable,false);
 assert.equal(row.orders,0);assert.equal(row.excludedOrders,0);
 assert.equal(row.missingItemOrders,1);
 assert.equal(diagnostic.includedOrders,0);assert.equal(diagnostic.excludedOrders,0);
 assert.equal(diagnostic.missingItemOrders,1);assert.equal(diagnostic.complete,false);
 assert.equal(diagnostic.zeroReason,null);
}

test('a discarded Wemamang item cannot turn a paid mixed order into completed excluded zero',async()=>{
 const f=fixture(),raw=rawOrder([{product_name:'위마망 상품',quantity:null},{product_name:'트루버 상품',quantity:1}]);
 const parsed=f.app.itemReview.cafeParseOrder(raw);
 assert.equal(parsed.net,50000);assert.equal(parsed.itemsComplete,false);assert.equal(parsed.rawItemCount,2);
 assert.equal(f.app.itemReview.completeOrderItems(parsed),false);
 const saved=await f.collect(raw,async()=>({items:raw.items}));
 assert.ok(f.detailCalls.length>=2,'Both detail paths must be tried for a partially parsed item list');
 assert.equal(saved.net,50000);assert.equal(saved.itemsComplete,false);assert.equal(saved.rawItemCount,2);
 assert.equal(f.app.itemReview.completeOrderItems(saved),false);
 assertPendingDetails(f.report());
});

test('a discarded other-brand item cannot donate the whole paid amount to Wemamang',async()=>{
 const f=fixture(),raw=rawOrder([{product_name:'위마망 상품',quantity:1},{product_name:'트루버 상품',quantity:null}]);
 const parsed=f.app.itemReview.cafeParseOrder(raw);
 assert.equal(parsed.itemsComplete,false);assert.equal(parsed.rawItemCount,2);
 const saved=await f.collect(raw,async()=>({items:raw.items}));
 assert.ok(f.detailCalls.length>=2);assert.equal(saved.net,50000);assert.equal(saved.itemsComplete,false);
 assertPendingDetails(f.report());
});

test('failed detail lookup cannot promote a previously partial cached item list to complete',async()=>{
 const f=fixture(),raw=rawOrder([]);
 const items=f.app.itemsFromCafeOrder([{product_name:'위마망 상품',quantity:1}]);
 f.setOrders({[raw.order_id]:{id:raw.order_id,date:day,net:50000,gross:50000,refund:0,unverified:false,items,itemsComplete:false,rawItemCount:2}});
 const saved=await f.collect(raw,async()=>{throw Error('카페24 주문 조회 HTTP 503');});
 assert.ok(f.detailCalls.length>=2,'A partial cached subset must not suppress detail recovery');
 assert.equal(saved.net,50000);assert.equal(saved.itemsComplete,false);
 assert.equal(f.app.itemReview.completeOrderItems(saved),false);
 assertPendingDetails(f.report());
});

test('full catalog recovery clears the item flag but leaves a genuine mixed-brand payment unallocated',async()=>{
 const f=fixture(),raw=rawOrder([{product_name:'위마망 상품',quantity:1},{product_name:'트루버 상품',quantity:1}]);
 const partial=f.app.itemsFromCafeOrder([raw.items[0]]);
 f.setOrders({[raw.order_id]:{id:raw.order_id,date:day,net:50000,gross:50000,refund:0,unverified:false,items:partial,itemsComplete:false,rawItemCount:2}});
 assertPendingDetails(f.report());
 const diagnostics=await f.app.enrichCostCatalog({since:day,until:day},{
  cafeCredentials:()=>({tokens:{access_token:'synthetic-token'}}),
  cafeItems:async()=>f.app.itemsFromCafeOrder(raw.items),delay:async()=>{}
 });
 const saved=f.read('cafe24-orders/orders.json').orders[raw.order_id];
 assert.equal(saved.itemsComplete,true);assert.equal(saved.rawItemCount,2);assert.equal(saved.items.length,2);
 assert.equal(f.app.itemReview.completeOrderItems(saved),true);assert.equal(saved.net,50000);
 assert.equal(diagnostics.job.sources.cafe24.restored,1);assert.equal(diagnostics.job.sources.cafe24.remaining,0);
 const result=f.report(),row=result.days[0].cafe24,d=result.revenueDiagnostics.cafe24;
 assert.equal(row.missingItemOrders,0);assert.equal(row.mixedOrders,1);
 assert.equal(row.revenue,null);assert.equal(row.fee,null);assert.equal(row.cost,null);
 assert.equal(row.complete,false);assert.equal(row.confirmedAvailable,false);
 assert.equal(row.orders,0);assert.equal(row.excludedOrders,0);
 assert.equal(d.mixedOrders,1);assert.equal(d.includedOrders,0);assert.equal(d.excludedOrders,0);assert.equal(d.zeroReason,null);
});
