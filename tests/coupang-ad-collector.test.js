'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {parse}=require('../public/coupang-ad-reports.js'),{createService}=require('../integrations/coupang/service.cjs');
const paHeaders=['캠페인 ID','캠페인명','광고 노출 지면','노출수','클릭수','광고비','광고집행 옵션ID','광고전환매출발생 옵션ID','키워드','총 주문수(1일)','총 판매수량(1일)','총 전환매출액(1일)','총 주문수(14일)','총 판매수량(14일)','총 전환매출액(14일)'];
const pa=['1.23E3','예시 캠페인','검색 영역',100,5,1000,'1.23456E5','123457','예시',1,1,5000,2,2,9000];
const ncaHeaders=['캠페인 ID','캠페인 이름','광고 노출 지면','노출수','클릭수','집행 광고비','참여수','신규 구매 고객 수','첫구매를 통한 광고 전환 매출','신규 구매 고객 중 재구매 고객 수','재구매를 통한 매출','전체 매출'];
const nca=[['456','신규 예시','검색 영역',100,5,1200,10,'-',6000,'-','-','-'],['456','신규 예시','비검색 영역',50,2,300,3,'-',4000,'-','-','-'],['456','신규 예시','전체',0,0,0,0,2,'-',1,3000,13000]];
function input(type='pa',date='20261022'){return parse([type==='pa'?[paHeaders,pa]:[ncaHeaders,...nca]],'A00012345_'+type+'_total_campaign_'+date+'_'+date+'.xlsx');}
function setup(t){const baseDir=fs.mkdtempSync(path.join(os.tmpdir(),'roas-ad-collector-'));t.after(()=>fs.rmSync(baseDir,{recursive:true,force:true}));const create=()=>createService({baseDir,protect:(m,v)=>v,now:()=>Date.parse('2026-10-28T03:00:00Z')});const s=create();s.saveCredentials({vendorId:'A00012345',accessKey:'SYNTHETIC-ACCESS',secretKey:'SYNTHETIC-SECRET'});return {s,create,baseDir};}
test('PA preserves spend attribution and both conversion windows; scientific IDs remain exact',()=>{const r=input();assert.equal(r.type,'pa');assert.equal(r.rows[0].campaignId,'1230');assert.equal(r.rows[0].advertisedItemId,'123456');assert.equal(r.rows[0].convertedItemId,'123457');assert.equal(r.rows[0].sales1,5000);assert.equal(r.rows[0].sales14,9000);assert.equal(r.rows[0].spend,1000);});
test('daily reports require an explicit row date and reject multi-day totals rather than spreading amounts',()=>{
 assert.throws(()=>parse([[paHeaders,pa]],'A00012345_pa_total_campaign_20261022_20261023.xlsx'),/일별/);
 const r=parse([[['일자',...paHeaders],['2026.10.22',...pa],['2026-10-23',...pa]]],'A00012345_pa_daily_campaign_20261022_20261023.xlsx');assert.deepEqual(r.rows.map(r=>r.date),['2026-10-22','2026-10-23']);
 assert.throws(()=>parse([[['일자',...paHeaders],['2026-10-21',...pa]]],'A00012345_pa_daily_campaign_20261022_20261023.xlsx'),/기간/);
});
test('NCA missing markers remain null and campaign-wide first/repeat metrics stay separate',()=>{const r=input('nca');assert.equal(r.rows[0].newCustomers,null);assert.equal(r.rows[2].firstSales,null);assert.equal(r.rows[2].newCustomers,2);assert.equal(r.rows[2].totalSales,13000);});
test('report IDs, raw numeric values and original filenames are validated',()=>{
 for(const bad of ['not-an-id','9.99999999999999999E18'])assert.throws(()=>parse([[paHeaders,[bad,...pa.slice(1)]]],'A00012345_pa_total_campaign_20261022_20261022.xlsx'),/ID/);
 assert.throws(()=>parse([[paHeaders,pa]],'renamed.xlsx'),/原本|원본/);
 const bad=[...pa];bad[5]=-1;assert.throws(()=>parse([[paHeaders,bad]],'A00012345_pa_total_campaign_20261022_20261022.xlsx'),/숫자/);
});
test('separate PA and NCA account statistics survive restart and replace matching dates without double counting',t=>{
 const {s,create}=setup(t);s.importAdvertising(input());s.importAdvertising(input('nca'));s.importAdvertising(input());
 const r=create().advertisingReports({since:'2026-10-22',until:'2026-10-23'});assert.equal(r.types.pa.available.spend,1000);assert.equal(r.types.pa.available.sales1,5000);assert.equal(r.types.pa.available.sales14,9000);assert.equal(r.types.pa.available.roas,500);
 const n=r.types.nca.available;assert.equal(n.spend,1500);assert.equal(n.firstSales,10000);assert.equal(n.newCustomers,2);assert.equal(n.repeatSales,3000);assert.equal(n.totalSales,13000);assert.equal(n.customerCost,750);
 assert.equal(r.types.pa.knownDays,1);assert.equal(r.types.pa.complete,false);assert.equal(r.types.pa.daily[1].spend,null);
 const changed=input();changed.rows[0].spend=2000;s.importAdvertising(changed);assert.equal(s.advertisingReports({since:changed.since,until:changed.until}).types.pa.available.spend,2000);
});
test('invalid later rows and wrong vendor never partially write advertising data or alter cost/source records',t=>{
 const {s,baseDir}=setup(t);s.importAdvertising(input());const file=path.join(baseDir,'.roas-data/coupang/A00012345/ad-reports/pa/2026-10-22.json'),before=fs.readFileSync(file,'utf8');
 const bad=input();bad.until='2026-10-23';bad.rows.push({...bad.rows[0],date:'2026-10-23',spend:-1});assert.throws(()=>s.importAdvertising(bad),{status:400});assert.equal(fs.readFileSync(file,'utf8'),before);
 assert.throws(()=>s.importAdvertising({...input(),vendorId:'A00099999'}),{status:400});assert.equal(fs.existsSync(path.join(baseDir,'.roas-data/coupang/A00012345/sales')),false);assert.equal(fs.existsSync(path.join(baseDir,'.roas-data/coupang/A00012345/scope.json')),false);
});
test('archive collector requests PA/NCA weekly periods within a year and does not request cookie/debugger permissions',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../browser-extensions/coupang-collector/worker.js'),'utf8');const noop={addListener(){}};
 const context=vm.createContext({URL,Date,chrome:{downloads:{onChanged:noop},alarms:{onAlarm:noop},runtime:{onInstalled:noop,onMessage:noop}}});vm.runInContext(source+'\nglobalThis.testPlan=plan;',context);
 const until=new Date(Date.now()+9*3600000-86400000).toISOString().slice(0,10),since=new Date(Date.parse(until)-364*86400000).toISOString().slice(0,10),jobs=context.testPlan(since,until);
 assert.equal(jobs.length,106);assert.equal(jobs[0].type,'pa');assert.equal(jobs[1].type,'nca');assert.equal(jobs.at(-1).until,until);assert.throws(()=>context.testPlan(until,since));
 const manifest=require('../browser-extensions/coupang-collector/manifest.json');assert.ok(!manifest.permissions.includes('cookies'));assert.ok(!manifest.permissions.includes('debugger'));assert.ok(!manifest.host_permissions.includes('<all_urls>'));
});
test('NCA rejects duplicate overall cost and does not understate missing campaign customer counts',t=>{
 const {s}=setup(t),bad=input('nca');bad.rows[2].spend=1500;assert.throws(()=>s.importAdvertising(bad),{status:400});
 const partial=input('nca');partial.rows.push({...partial.rows[0],campaignId:'789',newCustomers:null,firstSales:0});s.importAdvertising(partial);
 const summary=s.advertisingReports({since:partial.since,until:partial.until}).types.nca.available;assert.equal(summary.newCustomers,null);assert.equal(summary.customerCost,null);assert.equal(summary.spend,2700);
});
test('advertising batch rolls back earlier dates when a later atomic replacement fails',t=>{
 const {s,baseDir}=setup(t);s.importAdvertising(input());const file=path.join(baseDir,'.roas-data/coupang/A00012345/ad-reports/pa/2026-10-22.json'),before=fs.readFileSync(file,'utf8');
 const next=input();next.until='2026-10-23';next.rows[0].spend=2000;next.rows.push({...next.rows[0],date:'2026-10-23'});
 const original=fs.renameSync;let failed=false;fs.renameSync=(from,to)=>{if(String(to).endsWith('ad-reports/pa/2026-10-23.json')&&!failed){failed=true;throw Error('synthetic disk failure');}return original(from,to);};
 try{assert.throws(()=>s.importAdvertising(next),/synthetic disk failure/);}finally{fs.renameSync=original;}
 assert.equal(fs.readFileSync(file,'utf8'),before);assert.equal(fs.existsSync(path.join(path.dirname(file),'2026-10-23.json')),false);
});
test('stopped or superseded collector runs cannot overwrite a newer queue state',async()=>{
 let state={runId:'new',running:true,message:'new queue'};const noop={addListener(){}};
 const chrome={storage:{local:{get:async()=>({collector:JSON.parse(JSON.stringify(state))}),set:async value=>{state=JSON.parse(JSON.stringify(value.collector));}}},downloads:{onChanged:noop},alarms:{onAlarm:noop},runtime:{onInstalled:noop,onMessage:noop}};
 const context=vm.createContext({URL,Date,chrome});vm.runInContext(fs.readFileSync(path.join(__dirname,'../browser-extensions/coupang-collector/worker.js'),'utf8')+'\nglobalThis.testWrite=write;',context);
 assert.equal(await context.testWrite({runId:'old',running:true,message:'stale'}),false);assert.equal(state.message,'new queue');
 state.running=false;assert.equal(await context.testWrite({runId:'new',running:true}),false);assert.equal(state.running,false);
 assert.equal(await context.testWrite({runId:'replacement',running:true,message:'explicit restart'},true),true);assert.equal(state.runId,'replacement');
});
