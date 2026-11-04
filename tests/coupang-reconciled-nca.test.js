'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createService}=require('../integrations/coupang/service.cjs'),{parse}=require('../public/coupang-ad-reports.js');
const date='2026-10-20';
const product={itemId:'1001',productId:'1000',name:'합성 상품',channel:'growth',unitCost:null};
const total={date,sales:100000,profitBeforeAds:40000,advertising:5000,otherCosts:12000};
const headers=['캠페인 ID','캠페인 이름','광고 노출 지면','노출수','클릭수','집행 광고비','참여수','신규 구매 고객 수','첫구매를 통한 광고 전환 매출','신규 구매 고객 중 재구매 고객 수','재구매를 통한 매출','전체 매출'];
function nca(spend=3000){return parse([[headers,['901','합성 신규구매','전체',spend?100:0,spend?5:0,spend,spend?10:0,spend?2:0,spend?8000:0,spend?1:0,spend?2000:0,spend?10000:0]]],'A00012345_nca_total_campaign_20261020_20261020.xlsx');}
function fixture(t){
 const baseDir=fs.mkdtempSync(path.join(os.tmpdir(),'roas-confirmed-total-nca-'));t.after(()=>fs.rmSync(baseDir,{recursive:true,force:true}));
 const create=()=>createService({baseDir,protect:(mode,value)=>value,now:()=>Date.parse('2026-11-04T03:00:00Z')});
 const service=create();service.saveCredentials({vendorId:'A00012345',accessKey:'SYNTHETIC-ACCESS',secretKey:'SYNTHETIC-SECRET'});service.saveScope({products:[product]});
 service.importSalesBatch({reports:[],dailyTotals:[total]});
 return {service,create,dir:path.join(baseDir,'.roas-data/coupang/A00012345'),query:{since:date,until:date,channel:'all',view:'dashboard'}};
}
test('a verified whole-day confirmation applies account NCA even when no underlying orders or product sales exist',t=>{
 const {service,create,dir,query}=fixture(t),file=path.join(dir,'daily-totals',date+'.json'),original=fs.readFileSync(file,'utf8');
 service.importAdvertising(nca());const result=create().analytics(query),day=result.daily[0];
 assert.equal(day.source,'reconciled');assert.equal(day.underlyingSource,'missing');assert.equal(day.dailyTotalsStatus.state,'current');assert.equal(day.dailyTotalsApplied,true);assert.equal(day.dailyTotals.verified,true);
 assert.equal(day.dailyReport.sales,100000);assert.equal(day.dailyReport.profitBeforeAds,40000);assert.equal(day.dailyReport.otherCosts,12000);assert.equal(day.dailyReport.sourceNetProfit,35000);assert.equal(day.dailyReport.acquisitionAdvertising,3000);assert.equal(day.dailyReport.netProfit,32000,'subtract NCA once from confirmed profit minus PA, without subtracting other costs twice');
 assert.equal(result.dailyReportSummary.netProfit,32000);assert.equal(result.summary.netProfit,32000);assert.equal(day.acquisitionCoverage.applied,true);assert.equal(day.acquisitionCoverage.accountScopeVerified,false,'confirming selected-scope totals does not prove account-wide sales coverage');
 assert.ok(day.channels.every(part=>part.sales===null&&part.netProfit===null),'whole-day confirmation is not allocated to missing delivery records');assert.ok(result.items.every(item=>item.sales===null&&item.acquisitionAdvertising==null&&item.netProfit===null),'account NCA is not allocated to product rows');
 assert.equal(fs.readFileSync(file,'utf8'),original);assert.equal(fs.existsSync(path.join(dir,'orders')),false);assert.equal(fs.existsSync(path.join(dir,'sales')),false);
});
test('uncollected and explicitly zero NCA stay distinct on a verified reference-only day',t=>{
 const {service,query}=fixture(t);let day=service.analytics(query).daily[0];assert.equal(day.dailyReport.sourceNetProfit,35000);assert.equal(day.dailyReport.acquisitionAdvertising,null);assert.equal(day.dailyReport.netProfit,null);
 service.importAdvertising(nca(0));day=service.analytics(query).daily[0];assert.equal(day.dailyReport.acquisitionAdvertising,0);assert.equal(day.dailyReport.netProfit,35000);assert.equal(day.acquisitionCoverage.applied,true);
});
test('reimporting or correcting NCA replaces the cost once without changing the confirmed baseline',t=>{
 const {service,create,query}=fixture(t);service.importAdvertising(nca());service.importAdvertising(nca());let day=create().analytics(query).daily[0];assert.equal(day.dailyReport.sourceNetProfit,35000);assert.equal(day.dailyReport.netProfit,32000);
 service.importAdvertising(nca(3500));day=create().analytics(query).daily[0];assert.equal(day.dailyReport.profitBeforeAds,40000);assert.equal(day.dailyReport.advertising,5000);assert.equal(day.dailyReport.otherCosts,12000);assert.equal(day.dailyReport.acquisitionAdvertising,3500);assert.equal(day.dailyReport.netProfit,31500);
});
test('a partial delivery query or changed product scope cannot reuse the whole-day reference to deduct account NCA',t=>{
 const {service,query}=fixture(t);service.importAdvertising(nca());
 const partial=service.analytics({...query,channel:'growth'}).daily[0];assert.notEqual(partial.dailyTotalsApplied,true);assert.equal(partial.dailyReport.acquisitionAdvertising,null);assert.equal(partial.dailyReport.netProfit,null);assert.equal(partial.acquisitionCoverage.applied,false);
 service.saveScope({products:[{...product,itemId:'1002'}]});const changed=service.analytics(query).daily[0];assert.equal(changed.dailyTotalsStatus.state,'stale-scope');assert.equal(changed.dailyTotalsApplied,undefined);assert.equal(changed.dailyReport.sales,null);assert.equal(changed.dailyReport.acquisitionAdvertising,null);assert.equal(changed.dailyReport.netProfit,null);assert.equal(changed.acquisitionCoverage.applied,false);
});
test('an unbound legacy reference remains a baseline reference and cannot establish NCA eligibility',t=>{
 const {service,dir,query}=fixture(t),file=path.join(dir,'daily-totals',date+'.json'),saved=JSON.parse(fs.readFileSync(file,'utf8'));delete saved.ordersBasis;delete saved.basisType;fs.writeFileSync(file,JSON.stringify(saved));
 service.importAdvertising(nca());const day=service.analytics(query).daily[0];assert.equal(day.dailyTotalsStatus.state,'legacy-unbound');assert.equal(day.dailyTotalsApplied,true);assert.equal(day.dailyTotals.verified,false);assert.equal(day.dailyReport.sourceNetProfit,35000);assert.equal(day.dailyReport.acquisitionAdvertising,null);assert.equal(day.dailyReport.netProfit,null);assert.equal(day.acquisitionCoverage.applied,false);
});
