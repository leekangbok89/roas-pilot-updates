'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {parse,day}=require('../public/coupang-ad-reports.js'),{createService}=require('../integrations/coupang/service.cjs');
// Synthetic report fixtures only. No uploaded workbook content or account rows.
const headers=['날짜','과금 방식','광고 목표','판매방식','광고유형','캠페인 ID','캠페인명','노출수','클릭수','광고비','총 주문수(1일)','총 판매수량(1일)','총 전환매출액(1일)','총 주문수(14일)','총 판매수량(14일)','총 전환매출액(14일)'];
const dates=['2026-10-27','2026-10-28','2026-10-29','2026-10-30','2026-10-31','2026-11-01','2026-11-02'];
const rawDates=[20261027,'2.0261028E7','20261029','2.026103E7','2.0261031e+7','2.0261101E+7','20261102'];
const filename='A00012345_pa_daily_campaign_20261027_20261102 (3).xlsx';
const grid=()=>[headers, ...rawDates.map((date,i)=>[date,'cpc','sales','growth','product','901','합성 캠페인',100+i,5,1000+i*100,1,1,5000+i*100,2,2,7000+i*100])];
const report=()=>parse([grid()],filename);
function fixture(t){
 const baseDir=fs.mkdtempSync(path.join(os.tmpdir(),'roas-campaign-ad-'));t.after(()=>fs.rmSync(baseDir,{recursive:true,force:true}));
 const create=()=>createService({baseDir,protect:(mode,value)=>value,now:()=>Date.parse('2026-11-03T03:00:00Z')});
 const service=create();service.saveCredentials({vendorId:'A00012345',accessKey:'SYNTHETIC-ACCESS',secretKey:'SYNTHETIC-SECRET'});
 return {baseDir,service,create,dir:path.join(baseDir,'.roas-data/coupang/A00012345'),query:{since:dates[0],until:dates.at(-1),channel:'all',view:'sales'}};
}
test('compact and scientific integer YYYYMMDD dates normalize exactly, including a coefficient with omitted trailing zero',()=>{
 for(const value of ['20261030',20261030,'2.026103E7','2.0261030e+7','202610300E-1','2026.10.30','2026-10-30'])assert.equal(day(value),'2026-10-30',String(value));
 for(const value of ['20260230','2.026023E7','20261301','20260001','20261000','20261030.5','20261030.0000000001','2.0261030000000001E7','2.026103000000001E7','-20261030','Infinity','2.026103E999999','20261030junk','46325'])assert.equal(day(value),null,String(value));
});
test('synthetic daily campaign export preserves all seven dates and account metrics without invented product IDs',()=>{
 const result=report();assert.equal(result.reportLevel,'campaign');assert.equal(result.type,'pa');assert.deepEqual(result.rows.map(row=>row.date),dates);assert.equal(result.rows.length,7);
 assert.equal(result.rows.reduce((sum,row)=>sum+row.spend,0),9100);assert.equal(result.rows.reduce((sum,row)=>sum+row.sales1,0),37100);assert.equal(result.rows.reduce((sum,row)=>sum+row.sales14,0),51100);
 for(const row of result.rows){assert.equal(row.advertisedItemId,null);assert.equal(row.convertedItemId,null);assert.equal(row.placement,'');assert.equal(row.keyword,'');}
 const invalid=grid();invalid[1]=[20261026,...invalid[1].slice(1)];assert.throws(()=>parse([invalid],filename),/기간|범위/);
});
test('campaign reports import all seven days, survive restart and replace matching dates without doubling cost',t=>{
 const {service,create,dir,query}=fixture(t),input=report();const saved=service.importAdvertising(input);assert.equal(saved.saved,true);assert.equal(saved.days,7);assert.deepEqual(saved.dates,dates);
 let result=create().advertisingReports(query).types.pa;assert.equal(result.knownDays,7);assert.equal(result.totalDays,7);assert.equal(result.complete,true);assert.equal(result.available.spend,9100);assert.equal(result.available.sales1,37100);assert.deepEqual(result.daily.map(day=>day.spend),[1000,1100,1200,1300,1400,1500,1600]);
 for(const date of dates){const savedFile=JSON.parse(fs.readFileSync(path.join(dir,'ad-reports/pa',date+'.json'),'utf8'));assert.equal(savedFile.reportLevel,'campaign');assert.equal(savedFile.rows.length,1);assert.equal(savedFile.rows[0].advertisedItemId,null);}
 const revision=saved.advertisingRevision;service.importAdvertising(input);result=create().advertisingReports(query).types.pa;assert.equal(result.available.spend,9100);assert.equal(result.knownDays,7);assert.equal(service.importAdvertising(input).advertisingRevision,revision);
});
test('campaign-level costs preserve the saved source sales, selected scope and per-option advertising rather than allocating account costs',t=>{
 const {service,dir,query}=fixture(t);
 service.importSalesBatch({includeProducts:true,reports:dates.map(date=>({date,rows:[{productId:'44000',itemId:'44001',channel:'growth',name:'합성 상품',quantity:2,adQuantity:1,organicQuantity:1,sales:10000,profitBeforeAds:6000,advertising:75,adSales:2000,adProfitBeforeAds:1000}]}))});
 const before=service.analytics(query),scope=fs.readFileSync(path.join(dir,'scope.json'),'utf8'),sources=dates.map(date=>fs.readFileSync(path.join(dir,'sales',date+'.json'),'utf8'));
 service.importAdvertising(report());const after=service.analytics(query);
 assert.equal(after.summary.sales,before.summary.sales);assert.equal(after.summary.profitBeforeAds,before.summary.profitBeforeAds);assert.equal(after.summary.advertising,525);assert.equal(after.items[0].advertising,before.items[0].advertising);assert.equal(after.scopeKey,before.scopeKey);assert.equal(after.summary.sourceNetProfit,before.summary.sourceNetProfit);
 assert.equal(service.advertisingReports(query).types.pa.available.spend,9100);assert.equal(fs.readFileSync(path.join(dir,'scope.json'),'utf8'),scope);assert.deepEqual(dates.map(date=>fs.readFileSync(path.join(dir,'sales',date+'.json'),'utf8')),sources);
});
test('tampered campaign metadata cannot carry product IDs, placement or keywords into account report storage',t=>{
 const {service,dir}=fixture(t);service.importAdvertising(report());const file=path.join(dir,'ad-reports/pa',dates[0]+'.json'),before=fs.readFileSync(file,'utf8');
 for(const change of [{advertisedItemId:'44001'},{convertedItemId:'44001'},{placement:'검색 영역'},{keyword:'합성 키워드'}]){const value=report();Object.assign(value.rows[0],change);assert.throws(()=>service.importAdvertising(value),{status:400});assert.equal(fs.readFileSync(file,'utf8'),before);}
 const unknown=report();unknown.reportLevel='unknown';assert.throws(()=>service.importAdvertising(unknown),{status:400});
});
test('a missing campaign marker or partial option schema cannot bypass positive-spend product ID validation',t=>{
 const {service}=fixture(t);
 for(const absent of ['과금 방식','광고 목표','판매방식','광고유형']){
  const index=headers.indexOf(absent),partial=grid().map(row=>row.filter((_,i)=>i!==index));const value=parse([partial],filename);assert.equal(value.reportLevel,'product');assert.throws(()=>service.importAdvertising(value),{status:400});
 }
 for(const optionHeader of ['광고집행 옵션ID','광고전환매출발생 옵션ID']){
  const partial=grid().map((row,i)=>[...row,i===0?optionHeader:'-']);const value=parse([partial],filename);assert.equal(value.reportLevel,'product');assert.throws(()=>service.importAdvertising(value),{status:400});
 }
});
test('legacy product payloads without reportLevel retain strict advertised-item validation and persist product metadata',t=>{
 const {service,create,dir}=fixture(t);
 const productHeaders=['캠페인 ID','캠페인명','광고 노출 지면','노출수','클릭수','광고비','광고집행 옵션ID','광고전환매출발생 옵션ID','키워드','총 주문수(1일)','총 판매수량(1일)','총 전환매출액(1일)','총 주문수(14일)','총 판매수량(14일)','총 전환매출액(14일)'];
 const value=parse([[productHeaders,['902','합성 상품 광고','검색 영역',100,5,500,'44001','44001','합성',1,1,2000,2,2,4000]]],'A00012345_pa_total_campaign_20261102_20261102.xlsx');assert.equal(value.reportLevel,'product');delete value.reportLevel;service.importAdvertising(value);
 const file=path.join(dir,'ad-reports/pa/2026-11-02.json'),saved=JSON.parse(fs.readFileSync(file,'utf8'));assert.equal(saved.reportLevel,'product');assert.equal(create().advertisingReports({since:'2026-11-02',until:'2026-11-02'}).types.pa.available.spend,500);
 const bad=JSON.parse(JSON.stringify(value));bad.rows[0].advertisedItemId=null;assert.throws(()=>service.importAdvertising(bad),{status:400});
 delete saved.reportLevel;fs.writeFileSync(file,JSON.stringify(saved));assert.equal(create().advertisingReports({since:'2026-11-02',until:'2026-11-02'}).types.pa.available.spend,500,'pre-existing files with no level remain readable as product reports');
});

test('NCA daily rows use the same exact scientific-date normalization without PA campaign metadata',t=>{
 const {service,create,query}=fixture(t),ncaHeaders=['날짜','캠페인 ID','캠페인 이름','광고 노출 지면','노출수','클릭수','집행 광고비','참여수','신규 구매 고객 수','첫구매를 통한 광고 전환 매출','신규 구매 고객 중 재구매 고객 수','재구매를 통한 매출','전체 매출'];
 const input=parse([[ncaHeaders,...rawDates.map(date=>[date,'903','합성 신규 고객 광고','전체',100,5,100,4,2,1000,1,500,1500])]],'A00012345_nca_daily_campaign_20261027_20261102.xlsx');
 assert.equal(input.reportLevel,undefined);assert.deepEqual(input.rows.map(row=>row.date),dates);assert.equal(service.importAdvertising(input).days,7);assert.equal(create().advertisingReports(query).types.nca.available.spend,700);
});
