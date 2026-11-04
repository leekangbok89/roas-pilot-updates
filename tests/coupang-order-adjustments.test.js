'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {normalize,createService,COSTS}=require('../integrations/coupang/service.cjs');
const date='2026-11-03',now=Date.parse('2026-11-04T01:00:00Z');
const currency=units=>({currencyCode:'KRW',units:String(units),nanos:0});
function order(item={}){return {orderId:70000000123,shipmentBoxId:80000000123,orderedAt:date+'T12:00:00+09:00',orderItems:[{vendorItemId:123,vendorItemName:'합성 상품',shippingCount:2,orderPrice:20000,...item}]};}
const normalized=item=>normalize(order(item),'seller',date)[0];
test('seller snapshots retain original ordered amounts and mark missing optional adjustment fields unknown',()=>{
 const row=normalized();assert.equal(row.quantity,2);assert.equal(row.gross,20000);
 assert.equal(row.orderAdjustments.basis,'seller-confirmed-cancellations-v1');assert.equal(row.orderAdjustments.orderedQuantity,2);assert.equal(row.orderAdjustments.orderedGross,20000);assert.equal(row.orderAdjustments.unitSalesPrice,10000);
 for(const key of ['discountPrice','instantCouponDiscount','downloadableCouponDiscount','coupangDiscount'])assert.equal(row.orderAdjustments[key],null,key);
 assert.equal(row.orderAdjustments.refundAmountVerified,false);
});
test('confirmed single, partial and full cancellations reduce retained quantity and order gross once',()=>{
 for(const [shippingCount,cancelCount,orderPrice,quantity,gross]of [[1,1,10000,0,0],[2,1,20000,1,10000],[2,2,20000,0,0],[2,0,20000,2,20000]]){
  const row=normalized({shippingCount,cancelCount,holdCountForCancel:0,orderPrice,salesPrice:10000});assert.equal(row.quantity,quantity);assert.equal(row.gross,gross);assert.equal(row.orderAdjustments.confirmedCancelledQuantity,cancelCount);assert.equal(row.orderAdjustments.confirmedCancellationGross,cancelCount*10000);assert.equal(row.orderAdjustments.orderedGross,orderPrice);
 }
});
test('pending cancellations and coupon components are retained as evidence without subtracting unconfirmed refunds or all discounts',()=>{
 const row=normalized({cancelCount:0,holdCountForCancel:1,salesPrice:currency(10000),orderPrice:currency(20000),discountPrice:currency(500),instantCouponDiscount:currency(100),downloadableCouponDiscount:currency(200),coupangDiscount:currency(200)});
 assert.equal(row.quantity,2);assert.equal(row.gross,20000);assert.equal(row.orderAdjustments.pendingCancelledQuantity,1);assert.equal(row.orderAdjustments.discountPrice,500);assert.equal(row.orderAdjustments.instantCouponDiscount,100);assert.equal(row.orderAdjustments.downloadableCouponDiscount,200);assert.equal(row.orderAdjustments.coupangDiscount,200);assert.equal(row.orderAdjustments.refundAmountVerified,false);
 const partial=normalized({cancelCount:1,holdCountForCancel:0,discountPrice:500,coupangDiscount:200});assert.equal(partial.gross,10000,'confirmed unit gross is deducted once; coupon totals are not deducted again');
});
test('seller order and unit prices support KRW money objects including exact fractional won values',()=>{
 const row=normalized({cancelCount:1,holdCountForCancel:0,orderPrice:currency(20001),salesPrice:{currencyCode:'KRW',units:'10000',nanos:500000000}});
 assert.equal(row.quantity,1);assert.equal(row.gross,10000.5);assert.equal(row.orderAdjustments.confirmedCancellationGross,10000.5);assert.equal(row.orderAdjustments.unitSalesPrice,10000.5);
});
test('invalid supplied adjustment quantities, currency values and inconsistent original unit totals fail closed',()=>{
 const invalid=[{cancelCount:-1},{cancelCount:3},{cancelCount:0.5},{holdCountForCancel:-1},{holdCountForCancel:3},{cancelCount:1,holdCountForCancel:2},{cancelCount:'invalid'},{discountPrice:-1},{discountPrice:{currencyCode:'USD',units:'500',nanos:0}},{instantCouponDiscount:'invalid'},{salesPrice:9000},{salesPrice:{currencyCode:'USD',units:'10000',nanos:0}}];
 for(const value of invalid)assert.throws(()=>normalized(value),error=>error.status===502,JSON.stringify(value));
});
test('final normalized gross rejects a tiny negative cancellation remainder and growth multiplication above the amount limit',()=>{
 assert.throws(()=>normalized({shippingCount:2,orderPrice:0,salesPrice:{currencyCode:'KRW',units:'0',nanos:500},cancelCount:1,holdCountForCancel:0}),error=>error.status===502,'unit-total tolerance must never allow a negative retained amount');
 const raw={vendorId:'A00012345',orderId:70000000123,paidAt:Date.parse(date+'T12:00:00+09:00'),orderItems:[{vendorItemId:123,productName:'합성 상품',salesQuantity:2,unitSalesPrice:1e12,currency:'KRW'}]};
 assert.throws(()=>normalize(raw,'growth',date),error=>error.status===502,'valid individual unit price and quantity must not produce an out-of-range gross');
});
function setup(t){
 const baseDir=fs.mkdtempSync(path.join(os.tmpdir(),'coupang-adjustments-'));t.after(()=>fs.rmSync(baseDir,{recursive:true,force:true}));let item={cancelCount:0,holdCountForCancel:0,salesPrice:currency(10000),orderPrice:currency(20000)},extraItems=[],conflicting=false;
 const s=createService({baseDir,protect:(_mode,value)=>value,now:()=>now,sleep:async()=>{},fetchImpl:async url=>({ok:true,json:async()=>{
  const status=new URL(url).searchParams.get('status'),raw=order(item);raw.orderItems.push(...extraItems);
  return {code:200,data:status==='FINAL_DELIVERY'?[raw]:conflicting&&status==='ACCEPT'?[order({...item,cancelCount:1})]:[]};
 }})});
 s.saveCredentials({vendorId:'A00012345',accessKey:'synthetic-access',secretKey:'synthetic-secret'});s.importCatalog({products:[{itemId:'123',productId:'456',name:'합성 상품',channel:'seller',unitCost:3000,commissionRate:10,inboundFee:100,deliveryFee:200,costSince:date}]});
 return {s,file:path.join(baseDir,'.roas-data','coupang','A00012345','orders',date+'-seller.json'),set:value=>{item={...item,...value};},setExtraItems:value=>{extraItems=value;},conflict:()=>{conflicting=true;}};
}
test('rechecking changed confirmed cancellations refreshes API estimates and invalidates a reviewed ledger instead of leaving the day unchanged',async t=>{
 const {s,set,file}=setup(t),query={since:date,until:date,channel:'seller'};
 let result=await s.sync(query);assert.deepEqual(result.verification.newDays,[date]);const initial=JSON.parse(fs.readFileSync(file));assert.equal(initial.rows[0].quantity,2);assert.equal(initial.rows[0].gross,20000);
 const report=s.report({since:date,until:date}),first=report.daily.find(row=>row.channel==='seller');
 s.saveLedger({date,channel:'seller',scopeKey:report.scopeKey,basis:first.basis,reviewed:true,...Object.fromEntries(COSTS.map(key=>[key,0])),netSales:20000,productCost:6000});
 result=await s.sync(query);assert.deepEqual(result.verification.unchangedDays,[date]);assert.equal(s.report({since:date,until:date}).daily.find(row=>row.channel==='seller').profit,14000);
 set({cancelCount:1});result=await s.sync(query);assert.deepEqual(result.verification.changedDays,[date]);assert.deepEqual(result.verification.unchangedDays,[]);
 const current=s.report({since:date,until:date}).daily.find(row=>row.channel==='seller');assert.equal(current.quantity,1);assert.equal(current.gross,10000);assert.equal(current.estimatedProductCost,3000);assert.equal(current.estimatedCommission,1000);assert.equal(current.estimatedFulfillment,300);assert.equal(current.estimatedProfitBeforeAds,5700);assert.equal(current.stale,true);assert.equal(current.profit,null);
 const saved=JSON.parse(fs.readFileSync(file));assert.equal(saved.rows[0].orderAdjustments.orderedQuantity,2);assert.equal(saved.rows[0].orderAdjustments.confirmedCancelledQuantity,1);
 result=await s.sync(query);assert.deepEqual(result.verification.unchangedDays,[date]);assert.equal(s.report({since:date,until:date}).daily.find(row=>row.channel==='seller').gross,10000,'repeated API sync never deducts the same cancellation twice');
});
test('an invalid newly supplied adjustment preserves the previously saved snapshot bytes and values',async t=>{
 const {s,set,file}=setup(t),query={since:date,until:date,channel:'seller'};await s.sync(query);const before=fs.readFileSync(file);
 set({cancelCount:3});await assert.rejects(s.sync(query),error=>error.status===502);assert.deepEqual(fs.readFileSync(file),before);assert.equal(s.report({since:date,until:date}).daily.find(row=>row.channel==='seller').gross,20000);
});
test('daily calculation metadata includes only selected seller items and tracks a scope change without adding unrelated adjustments',async t=>{
 const {s,set,setExtraItems}=setup(t);set({cancelCount:1,holdCountForCancel:0,discountPrice:500,coupangDiscount:200});setExtraItems([{vendorItemId:456,vendorItemName:'범위 밖 합성 상품',shippingCount:5,orderPrice:50000,salesPrice:10000,cancelCount:2,holdCountForCancel:1,discountPrice:1000,coupangDiscount:400}]);
 await s.sync({since:date,until:date,channel:'seller'});
 const evidence=()=>s.analytics({since:date,until:date,channel:'seller'}).daily[0].dailyReport.apiOrderAdjustments;
 let parts=evidence();assert.equal(parts.length,1);assert.equal(parts[0].channel,'seller');assert.equal(parts[0].current,true);assert.equal(parts[0].rows,1);assert.equal(parts[0].orderedQuantity,2);assert.equal(parts[0].orderedGross,20000);assert.equal(parts[0].confirmedCancelledQuantity,1);assert.equal(parts[0].confirmedCancellationGross,10000);assert.equal(parts[0].discountPrice,500);assert.equal(parts[0].coupangDiscount,200);assert.equal(parts[0].refundAmountVerified,false);
 s.saveScope({products:[...s.status().products,{itemId:'456',name:'범위 밖 합성 상품',unitCost:2000,commissionRate:10,inboundFee:100,deliveryFee:200}]});
 parts=evidence();assert.equal(parts[0].rows,2);assert.equal(parts[0].orderedQuantity,7);assert.equal(parts[0].orderedGross,70000);assert.equal(parts[0].confirmedCancelledQuantity,3);assert.equal(parts[0].pendingCancelledQuantity,1);assert.equal(parts[0].discountPrice,1500);
});
test('legacy snapshots without the current calculation basis expose a recheck reason and unknown adjustment totals',async t=>{
 const {s,file}=setup(t);await s.sync({since:date,until:date,channel:'seller'});const old=JSON.parse(fs.readFileSync(file));delete old.calculationBasis;old.rows=old.rows.map(({orderAdjustments,...row})=>row);fs.writeFileSync(file,JSON.stringify(old));
 const row=s.analytics({since:date,until:date,channel:'seller'}).daily[0],part=row.dailyReport.apiOrderAdjustments[0];assert.equal(part.current,false);assert.equal(part.basis,'legacy-orders');assert.equal(part.orderedGross,null);assert.equal(part.confirmedCancelledQuantity,null);assert.match(part.reasons.join(' '),/이전 수집 기준/);assert.match(part.reasons.join(' '),/다시 확인|다시 수집|다시 수집으로/);assert.equal(row.dailyReport.sales,20000,'a diagnostic does not silently replace old stored amounts');
});
test('conflicting copies of one seller shipment across statuses reject the request and preserve previously saved bytes',async t=>{
 const {s,file,conflict}=setup(t),query={since:date,until:date,channel:'seller'};await s.sync(query);const before=fs.readFileSync(file);conflict();await assert.rejects(s.sync(query),error=>error.status===502&&/상태별 중복 자료/.test(error.message));assert.deepEqual(fs.readFileSync(file),before);assert.equal(s.report({since:date,until:date}).daily.find(row=>row.channel==='seller').gross,20000);
});
