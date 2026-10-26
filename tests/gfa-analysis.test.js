'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{Readable}=require('node:stream');
const model=require('../public/gfa-data.js'),{createStore}=require('../integrations/gfa/service.cjs');
const channels=()=>model.parseChannels([
 ['날짜','경로(1단계)','경로(2단계)','경로(3단계)','방문수','상품결제건수','구매전환율','판매금액(총)'],
 ['2026-09-01 ~ 2026-09-07','네이버 광고','성과형 디스플레이광고','GFA','100','2','2%','798,000'],
 ['2026-09-01 ~ 2026-09-07','직접유입','-','-','50','1','2%','399,000'],
 ['','합계','','','150','3','2%','1,197,000'],
]);
const ads=()=>model.parseAds('캠페인 이름\t캠페인 ID\t총비용\t구매완료 수\t구매완료 전환매출액\t노출수\t클릭수\n위마망 A\t1234567\t100,000\t5\t1,995,000\t10000\t500\n합계\t\t100,000\t5\t1,995,000\t10000\t500');
const entry=(kind,rows,since='2026-09-01',until='2026-09-07')=>({kind,rows,since,until});
function fixture(t){const baseDir=fs.mkdtempSync(path.join(os.tmpdir(),'roas-gfa-')),store=createStore({baseDir,model});t.after(()=>fs.rmSync(baseDir,{recursive:true,force:true}));return {baseDir,store,save:input=>store.save({...input,revision:store.read().revision})};}
test('GFA column names control parsing even when reordered, zero is known and missing purchases are unknown',()=>{
 const rows=model.parseAds('클릭수\t캠페인 이름\t총비용\t구매완료 전환매출액\n0\t광고 A\t0\t0');
 assert.equal(rows[0].clicks,0);assert.equal(rows[0].revenue,0);assert.equal(rows[0].purchases,null);assert.equal(rows[0].revenueEstimated,false);assert.equal(model.metrics(rows).roas,null);
 assert.equal(ads().length,1);assert.equal(ads()[0].revenue,1995000);
 const legacy=model.parseAds('캠페인 이름\n광고 A\n1234567\n운영가능\n1000\n2\n200%\n10\n미설정\n1000\n10\n100\n10%\n2\n300%\n광고 B\n2345678\n운영가능\n2000\n1\n100%\n20\n미설정\n1000\n20\n100\n10%\n1\n100%');
 assert.equal(legacy.length,2);assert.equal(legacy[0].revenue,2000);assert.equal(legacy[0].revenueEstimated,true,'total ROAS and next campaign must never become purchase revenue');
});
test('channel import recognizes paths, periods, explicit zeros, excludes summaries and identifies GFA only',()=>{
 const result=channels();assert.equal(result.rows.length,2);assert.equal(result.skipped,1);assert.equal(result.since,'2026-09-01');assert.equal(result.until,'2026-09-07');assert.equal(result.rows[0].gfa,true);assert.equal(result.rows[1].gfa,false);
 const result2=model.parseChannels([['경로(1단계)','방문수','상품결제건수','판매금액(총)'],['네이버 검색','0','','0']],'전체채널_2026-09-01_2026-09-07.xlsx');assert.equal(result2.since,'2026-09-01');assert.equal(result2.until,'2026-09-07');assert.equal(result2.rows[0].orders,null);assert.equal(result2.rows[0].visits,0);
 assert.throws(()=>model.parseChannels([['광고비','클릭수'],[100,3]]),/전체채널/);
});
test('comparison uses GFA-selected paths and independent attribution, combines adjacent weeks without duplicate sales',()=>{
 const r=model.analyze([entry('ads',ads()),entry('channels',channels().rows)],'2026-09-01','2026-09-07');
 assert.equal(r.ready,true);assert.equal(r.store.sales,798000);assert.equal(r.ad.revenue,1995000);assert.equal(r.lastRoas,798);assert.equal(r.revenueGap,1197000);assert.equal(r.ad.cpc,200);assert.equal(r.ad.cpa,20000);assert.equal(r.channelRows.length,2);
 const next=channels().rows.map(r=>({...r,since:'2026-09-08',until:'2026-09-14'}));
 const fortnight=model.analyze([entry('ads',ads()),entry('channels',channels().rows),entry('ads',ads(),'2026-09-08','2026-09-14'),entry('channels',next,'2026-09-08','2026-09-14')],'2026-09-01','2026-09-14');
 assert.equal(fortnight.ready,true);assert.equal(fortnight.store.sales,1596000);assert.equal(fortnight.campaigns.length,1);assert.equal(fortnight.campaigns[0].spend,200000);
});
test('partial weeks, missing source days, no GFA selections and zero denominator cannot produce comparison ROAS',()=>{
 const entries=[entry('ads',ads()),entry('channels',channels().rows)];let r=model.analyze(entries,'2026-09-02','2026-09-07');assert.equal(r.ready,false);assert.equal(r.partial,2);assert.equal(r.lastRoas,null);
 r=model.analyze(entries,'2026-09-01','2026-09-08');assert.equal(r.ready,false);assert.equal(r.lastRoas,null);
 r=model.analyze([entries[0],entry('channels',channels().rows.map(r=>({...r,gfa:false})))],'2026-09-01','2026-09-07');assert.equal(r.ready,false);assert.equal(r.store.sales,null);
 r=model.analyze([entry('ads',ads().map(r=>({...r,spend:0}))),entries[1]],'2026-09-01','2026-09-07');assert.equal(r.lastRoas,null);
});
test('file snapshots survive restart, same-period imports replace, overlaps and stale writes cannot mutate history',t=>{
 const f=fixture(t),input=entry('channels',channels().rows);f.save(input);f.save({...input,filename:'again.xlsx',replaceExisting:true});assert.equal(f.store.read().entries.length,1);assert.equal(f.store.read().entries[0].filename,'again.xlsx');assert.equal(createStore({baseDir:f.baseDir,model}).read().entries.length,1);
 const before=f.store.read();assert.throws(()=>f.save({...input,since:'2026-09-02'}),/기간 밖|겹치는/);assert.throws(()=>f.store.save({...input,revision:0}),/다른 화면/);assert.deepEqual(f.store.read(),before);
 f.save(entry('ads',ads()));assert.equal(f.store.read().entries.length,2);assert.throws(()=>f.store.remove({id:before.entries[0].id,revision:0}),/다른 화면/);
});
test('invalid numeric data, impossible dates, duplicates and nested daily totals are rejected',t=>{
 const f=fixture(t),input=entry('channels',channels().rows);
 for(const bad of [{...input,since:'2026-02-30'},{...input,rows:[{...input.rows[0],sales:-1}]},{...input,rows:[{...input.rows[0],sales:'100'}]},{...input,rows:[input.rows[0],input.rows[0]]},{...input,rows:[input.rows[0],{...input.rows[0],since:'2026-09-02',until:'2026-09-02'}]}])assert.throws(()=>f.save(bad));
 assert.equal(f.store.read().entries.length,0);
 fs.mkdirSync(path.join(f.baseDir,'.roas-data'),{recursive:true});fs.writeFileSync(path.join(f.baseDir,'.roas-data/gfa-analysis.json'),'bad');assert.throws(()=>f.store.read(),/읽지 못/);
});
test('weekly overlapping daily channel files save only new date and route rows',t=>{
 const f=fixture(t);
 const rows=(a,b)=>Array.from({length:b-a+1},(_,i)=>String(a+i).padStart(2,'0')).map(d=>({path1:'모바일',path2:'광고',path3:'성과형 디스플레이광고',since:'2026-10-'+d,until:'2026-10-'+d,visits:10,orders:1,sales:399000,gfa:true}));
 let result=f.save(entry('channels',rows(1,7),'2026-10-01','2026-10-07'));
 assert.equal(result.importStats.added,7);
 result=f.save(entry('channels',rows(5,11),'2026-10-05','2026-10-11'));
 assert.deepEqual([result.importStats.added,result.importStats.duplicates,result.importStats.conflicts,result.importStats.ambiguous],[4,3,0,0]);
 const report=model.analyze(f.store.read().entries,'2026-10-01','2026-10-11');
 assert.equal(report.channels.covered,11);assert.equal(report.channels.complete,true);
 assert.equal(report.store.orders,11);assert.equal(report.store.sales,11*399000);
 const original=f.store.read();
 result=f.save(entry('channels',rows(5,11),'2026-10-05','2026-10-11'));
 assert.equal(result.importStats.added,0);assert.equal(result.importStats.duplicates,7);
 assert.deepEqual(f.store.read(),original,'repeated weekly export must not double count');
 const changed=rows(5,11);changed[0].sales=500000;
 result=f.save(entry('channels',changed,'2026-10-05','2026-10-11'));
 assert.equal(result.importStats.conflicts,1,'changed past result is flagged, not counted twice');
 assert.equal(f.store.read().entries.length,2);
});
test('overlapping aggregate files remain safe because totals cannot be split into dates',t=>{
 const f=fixture(t),old=f.save(entry('channels',channels().rows));
 const next={...channels().rows[0],since:'2026-09-05',until:'2026-09-11'};
 const result=f.save(entry('channels',[next],'2026-09-05','2026-09-11'));
 assert.equal(result.importStats.ambiguous,1);assert.equal(result.importStats.added,0);
 assert.equal(f.store.read().revision,old.revision);
});
test('real Biz Advisor column names, compact dates and separate planned campaign budget are supported',()=>{
 const report=model.parseChannels([
  ['채널속성','채널그룹','채널명','채널상세','유입수','결제수(마지막클릭)','결제금액(마지막클릭)'],
  ['모바일','광고','네이버 성과형디스플레이광고','','100','4','1706600'],
  ['PC','광고','네이버 성과형디스플레이광고','','50','2','798000']
 ],'visit_20261001-20261024.xlsx');
 assert.equal(report.since,'2026-10-01');assert.equal(report.until,'2026-10-24');
 assert.equal(report.rows.length,2);assert.ok(report.rows.every(r=>r.gfa));
 assert.equal(report.rows.reduce((s,r)=>s+r.sales,0),2504600);
 const campaign=model.parseAds('캠페인 이름\t총비용\t캠페인 예산\t구매완료 수\t구매완료 전환매출액\n위마망 A\t1000\t50000\t1\t399000');
 assert.equal(campaign[0].spend,1000);assert.equal(campaign[0].budget,50000);
 assert.equal(model.metrics(campaign).roas,39900,'actual spend, never planned budget, is the ROAS denominator');
 assert.equal(model.parseAds('캠페인 이름\t캠페인 예산\n위마망 A\t50000').length,0,'budget alone must not masquerade as spend');
});
test('bundled API guards local mutations and keeps performance saves paired with GFA costs',async t=>{
 const f=fixture(t),serverFile=path.join(f.baseDir,'server.js');fs.copyFileSync(path.join(__dirname,'../server.js'),serverFile);const app=require(serverFile);t.after(()=>delete require.cache[serverFile]);
 const request=(method,body,headers={})=>new Promise((resolve,reject)=>{const req=Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]);Object.assign(req,{url:'/api/gfa-analysis',method,headers:{host:'127.0.0.1:3000','x-roas-local-action':'yes',...headers}});let status;const res={writeHead(code){status=code;},end(data){resolve({status,body:JSON.parse(data)});}};Promise.resolve(app.server.listeners('request')[0](req,res)).catch(reject);});
 const input={...entry('ads',ads()),revision:0,spendRevision:0};assert.equal((await request('POST',input,{'x-roas-local-action':''})).status,403);
 assert.equal((await request('POST',{...input,spendRevision:99})).status,409);assert.equal((await request('GET')).body.entries.length,0);
 let response=await request('POST',input);assert.equal(response.status,200);assert.equal(app.naverSpendRead().entries[0].amount,100000);
 const saved=response.body;response=await request('POST',{...input,revision:0});assert.equal(response.status,409);assert.equal(app.naverSpendRead().revision,1);
 response=await request('DELETE',{id:saved.entries[0].id,revision:saved.revision});assert.equal(response.status,200);assert.equal(response.body.entries.length,0);assert.equal(app.naverSpendRead().entries.length,0);
 assert.equal((await request('PUT',{})).status,405);assert.equal((await request('POST',null)).status,400);
});
