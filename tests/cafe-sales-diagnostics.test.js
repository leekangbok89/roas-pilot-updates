'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');

const day='2026-09-01',next='2026-09-02',accounts=['11111'];
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'roas-cafe-diagnostic-')),serverFile=path.join(dir,'server.js');
 fs.copyFileSync(path.join(__dirname,'../server.js'),serverFile);const app=require(serverFile);
 t.after(()=>{delete require.cache[serverFile];fs.rmSync(dir,{recursive:true,force:true});});
 const file=name=>path.join(dir,'.roas-data',name);
 const write=(name,value)=>{fs.mkdirSync(path.dirname(file(name)),{recursive:true});fs.writeFileSync(file(name),JSON.stringify(value));};
 for(const channel of ['naver','cafe24']){write(channel+'-orders/orders.json',{orders:{}});write(channel+'-orders/sync.json',{days:{[day]:{checkedAt:'2026-09-02T00:00:00Z',count:0}}});}
 const ads=spend=>write('daily/11111/'+day+'.json',{account:'11111',date:day,currency:'KRW',rows:spend?[{spend:String(spend),account_currency:'KRW'}]:[]});ads(0);
 const costs={};
 const cost=(channel,name,amount)=>{const key=crypto.createHash('sha256').update(JSON.stringify([channel,name,''])).digest('hex').slice(0,24);costs[key]={channel,name,option:'',cost:amount};write('product-costs.json',costs);};
 const setOrders=(orders,count=Object.keys(orders).length)=>{write('cafe24-orders/orders.json',{orders});write('cafe24-orders/sync.json',{days:{[day]:{checkedAt:'2026-09-02T00:00:00Z',count}}});};
 const report=()=>app.profitDaily(day,day,{accounts,fx:1350});
 const coverage=()=>app.dataCoverage(day,day,accounts,1350);
 return {...app,dir,file,write,ads,cost,setOrders,report,coverage};
}
const order=(extra={})=>({id:'PRIVATE-ORDER-ID',date:day,net:100000,items:[{name:'위마망 상품',option:'',quantity:1}],...extra});
function assertUnavailable(report){
 const row=report.days[0];
 for(const key of ['revenue','fee','cost']){assert.equal(row.cafe24[key],null);assert.equal(row.cafe24.confirmed[key],null);assert.equal(row[key],null);assert.equal(row.confirmed[key],null);}
 assert.equal(row.cafe24.complete,false);assert.equal(row.cafe24.confirmedAvailable,false);
 assert.equal(row.complete,false);assert.equal(row.confirmedAvailable,false);assert.equal(row.profit,null);assert.equal(row.confirmed.profit,null);
}

for(const state of ['missing','invalid_json','invalid_schema'])test('unreadable Cafe order cache stays unknown despite completed sync: '+state,t=>{
 const f=fixture(t);f.setOrders({a:order()},1);f.ads(1000);
 f.write('naver-orders/orders.json',{orders:{known:{paymentDate:day,net:50000,items:[{name:'위마망 네이버 상품',option:'',quantity:1}]}}});f.cost('naver','위마망 네이버 상품',20000);
 const target=f.file('cafe24-orders/orders.json'),syncBefore=fs.readFileSync(f.file('cafe24-orders/sync.json'),'utf8');
 if(state==='missing')fs.unlinkSync(target);
 else fs.writeFileSync(target,state==='invalid_json'?'{ PRIVATE-CUSTOMER-TOKEN':JSON.stringify({records:[order()]}));
 const before=state==='missing'?null:fs.readFileSync(target,'utf8'),report=f.report(),d=report.revenueDiagnostics.cafe24;
 assertUnavailable(report);assert.equal(report.days[0].naver.revenue,50000);
 assert.equal(d.cacheState,state);assert.equal(d.complete,false);assert.equal(d.zeroReason,null);assert.equal(d.confirmedRevenue,null);
 for(const key of ['storedOrders','positiveOrders','missingItemOrders','includedOrders','excludedOrders','zeroNetOrders','undatedOrders'])assert.equal(d[key],null);
 assert.equal(d.recordedDays,1);assert.equal(d.recordedOrders,1);assert.deepEqual(d.countMismatches,[]);
 assert.equal(typeof d.cacheIssue,'string');assert.equal(d.mallId,null);assert.equal(d.shopNo,1);assert.match(d.version,/^2\.8\./);
 const coverage=f.coverage();assert.deepEqual(coverage.revenueDiagnostics.cafe24,d);
 assert.equal(coverage.sources.cafe24.positiveOrders,null);assert.equal(coverage.sources.cafe24.missingItemOrders,null);
 assert.equal(coverage.sources.cafe24.storedDays,0);assert.deepEqual(coverage.sources.cafe24.missingDays,[day]);
 assert.equal(coverage.profit.completeDays,0);
 const safe=JSON.stringify(d);for(const forbidden of ['PRIVATE-CUSTOMER-TOKEN','PRIVATE-ORDER-ID',f.dir,'ENOENT','SyntaxError'])assert.equal(safe.includes(forbidden),false);
 assert.equal(state==='missing'?fs.existsSync(target):fs.readFileSync(target,'utf8'),state==='missing'?false:before);
 assert.equal(fs.readFileSync(f.file('cafe24-orders/sync.json'),'utf8'),syncBefore);
});

test('invalid order collection shapes cannot masquerade as an empty store',t=>{
 const f=fixture(t);
 for(const data of [null,[],{orders:null},{orders:[]},{orders:{a:null}},{orders:{a:'not an order'}}]){
  f.write('cafe24-orders/orders.json',data);const r=f.report();assert.equal(r.revenueDiagnostics.cafe24.cacheState,'invalid_schema');assertUnavailable(r);
 }
});

test('ISO datetime payment dates normalize in memory and preserve existing fee and cost math',t=>{
 const f=fixture(t);f.setOrders({a:order({date:day+'T12:34:56.123+09:00'})});f.cost('cafe24','위마망 상품',40000);
 const before=fs.readFileSync(f.file('cafe24-orders/orders.json'),'utf8'),r=f.report(),d=r.revenueDiagnostics.cafe24;
 assert.equal(r.days[0].cafe24.revenue,100000);assert.equal(r.days[0].cafe24.fee,3500);assert.equal(r.days[0].cafe24.cost,40000);assert.equal(r.days[0].profit,56500);
 assert.equal(d.storedOrders,1);assert.equal(d.includedOrders,1);assert.equal(d.undatedOrders,0);assert.equal(d.complete,true);assert.equal(d.confirmedRevenue,100000);assert.equal(d.zeroReason,null);
 assert.equal(f.coverage().sources.cafe24.positiveOrders,1);assert.equal(fs.readFileSync(f.file('cafe24-orders/orders.json'),'utf8'),before);
});

test('undated or invalid-date orders cannot fabricate confirmed zero revenue or an advertising loss',t=>{
 const f=fixture(t);f.ads(1000);
 for(const value of [undefined,'not-a-date','2026-02-30','2026-09-01T25:00:00+09:00']){
  f.setOrders({a:order({date:value,payment_date:day})});const r=f.report(),d=r.revenueDiagnostics.cafe24;
  assertUnavailable(r);assert.equal(d.cacheState,'ok');assert.equal(d.undatedOrders,1);assert.equal(d.storedOrders,0);assert.equal(d.complete,false);assert.equal(d.confirmedRevenue,null);assert.equal(d.zeroReason,null);
  assert.match(d.reason,/결제일.*1건/);assert.deepEqual(d.countMismatches,[{date:day,recordedCount:1,cachedCount:0}]);
 }
});

test('a dated confirmed order remains a partial subtotal beside an undated order',t=>{
 const f=fixture(t);f.setOrders({known:order(),unknown:order({date:undefined})});f.cost('cafe24','위마망 상품',40000);f.ads(1000);
 const r=f.report(),row=r.days[0],d=r.revenueDiagnostics.cafe24;
 assert.equal(row.cafe24.revenue,null);assert.equal(row.profit,null);assert.equal(row.complete,false);assert.equal(row.cafe24.confirmed.revenue,100000);
 assert.equal(row.confirmedAvailable,true);assert.equal(row.confirmed.profit,55500);assert.equal(row.partial,true);
 assert.equal(d.includedOrders,1);assert.equal(d.undatedOrders,1);assert.equal(d.confirmedRevenue,100000);assert.equal(d.complete,false);
});

test('verified empty, zero-balance and excluded orders have distinct truthful zero explanations',t=>{
 const f=fixture(t);f.ads(1000);
 let r=f.report(),d=r.revenueDiagnostics.cafe24;assert.equal(d.zeroReason,'no_orders');assert.equal(d.complete,true);assert.equal(d.confirmedRevenue,0);assert.equal(r.days[0].profit,-1000);
 f.setOrders({zero:order({net:0,items:[]})});d=f.report().revenueDiagnostics.cafe24;assert.equal(d.zeroReason,'zero_net');assert.equal(d.zeroNetOrders,1);assert.equal(d.positiveOrders,0);
 const neutral='중립 상품',key=crypto.createHash('sha256').update(neutral).digest('hex').slice(0,24);
 f.write('brand-product-scopes.json',{[key]:{name:neutral,scope:'excluded'}});
 const excluded={auto:order({items:[{name:'트루버 상품',quantity:1}]}),manual:order({items:[{name:neutral,quantity:1}]})};
 f.setOrders(excluded);r=f.report();d=r.revenueDiagnostics.cafe24;
 assert.equal(d.zeroReason,'excluded');assert.equal(d.excludedOrders,2);assert.equal(d.autoExcludedOrders,1);assert.equal(d.manualExcludedOrders,1);assert.equal(d.includedOrders,0);assert.equal(d.confirmedRevenue,0);assert.equal(d.complete,true);assert.equal(r.days[0].profit,-1000);
 f.setOrders({...excluded,zero:order({net:0})});d=f.report().revenueDiagnostics.cafe24;assert.equal(d.zeroReason,'excluded_and_zero_net');
});

test('diagnostics preserve missing detail, brand and payment distinctions without exposing records',t=>{
 const f=fixture(t);f.setOrders({
  included:order({customer:'PRIVATE-CUSTOMER',token:'PRIVATE-TOKEN'}),
  unclassified:order({items:[{name:'브랜드 미표기 상품',quantity:1}]}),
  mixed:order({items:[{name:'위마망 상품',quantity:1},{name:'트루버 상품',quantity:1}]}),
  missing:order({items:[]}),invalid:order({unverified:true})
 });f.cost('cafe24','위마망 상품',40000);
 const r=f.report(),d=r.revenueDiagnostics.cafe24;assert.equal(d.storedOrders,5);assert.equal(d.includedOrders,1);assert.equal(d.unclassifiedOrders,1);assert.equal(d.mixedOrders,1);assert.equal(d.missingItemOrders,1);assert.equal(d.invalidOrders,1);
 assert.equal(d.confirmedRevenue,100000);assert.equal(d.complete,false);assert.equal(r.days[0].confirmed.profit,56500);
 assert.equal(/PRIVATE-|order_id|access_token/.test(JSON.stringify(d)),false);
});

test('coverage keeps incomplete item quantity visible even when order revenue is known',t=>{
 const f=fixture(t);f.setOrders({a:order({date:day+'T10:00:00+09:00',items:[{name:'위마망 상품',option:''}]})});
 const r=f.report(),coverage=f.coverage(),d=r.revenueDiagnostics.cafe24;
 assert.equal(r.days[0].cafe24.revenue,100000);assert.equal(r.days[0].cafe24.cost,null);assert.equal(r.days[0].profit,null);
 assert.equal(d.complete,true,'Revenue completeness must not depend on cost or quantity entry');
 assert.equal(d.missingItemOrders,1);assert.deepEqual(d.missingItemDates,[{date:day,count:1}]);
 assert.equal(coverage.sources.cafe24.missingItemOrders,1);assert.deepEqual(coverage.sources.cafe24.missingItemDates,[{date:day,count:1}]);
});

test('sync count differences are read-only reconciliation information, not proof of corrupt orders',t=>{
 const f=fixture(t);f.setOrders({current:order(),moved:order({date:next})},2);f.cost('cafe24','위마망 상품',40000);
 const names=['cafe24-orders/orders.json','cafe24-orders/sync.json'],before=names.map(name=>fs.readFileSync(f.file(name),'utf8'));
 const r=f.report(),d=r.revenueDiagnostics.cafe24;
 assert.equal(r.days[0].complete,true);assert.equal(d.complete,true);assert.equal(d.confirmedRevenue,100000);assert.equal(d.cacheState,'ok');
 assert.deepEqual(d.countMismatches,[{date:day,recordedCount:2,cachedCount:1}]);assert.match(d.reason,/결제일 변경 여부.*대조/);
 assert.deepEqual(names.map(name=>fs.readFileSync(f.file(name),'utf8')),before);
});
