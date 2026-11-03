'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),http=require('node:http');
const {chromium}=require(process.env.ROAS_PLAYWRIGHT_MODULE||'playwright');
const source=path.resolve(__dirname,'../browser-extensions/coupang-collector/report-page.js');
const range={type:'pa',since:'2026-10-26',until:'2026-11-01'};
let browser,base;const server=http.createServer((req,res)=>{res.setHeader('content-type','text/html; charset=utf-8');res.end('<!doctype html><body>Local report fixture</body>');});
async function fixture(){
 const page=await browser.newPage({viewport:{width:1300,height:1000}});await page.goto(base);
 await page.setContent('<label><input type="radio" checked>기간 설정</label><input placeholder="시작일" value="2026-10-26"><input placeholder="종료일" value="2026-11-01"><label><input type="radio" checked>일별</label><select><option value="all">전체 캠페인</option></select><button id="create">보고서 만들기</button><div class="ant-table-wrapper"><table><thead><tr><th>요청일</th><th>보고서 기간</th><th>캠페인</th><th>상태</th><th>보고서 조회</th></tr></thead><tbody></tbody></table><button id="refresh">목록 새로 고침</button></div>');
 await page.evaluate(()=>{
  window.created=0;window.downloaded=0;window.refreshes=0;
  document.getElementById('create').onclick=()=>window.created++;
  document.getElementById('refresh').onclick=()=>window.refreshes++;
  window.addReport=(id,status='생성 완료',period='2026-10-26 ~ 2026-11-01',scope='전체 캠페인',positional=false)=>{
   const tr=document.createElement('tr');tr.setAttribute(positional?'data-row-key':'data-report-id',id);
   for(const value of ['2026-11-03',period,scope,status]){const td=document.createElement('td');td.textContent=value;tr.append(td);}
   tr.children[3].className='report-status';
   const cell=document.createElement('td'),button=document.createElement('button');button.textContent='다운로드';button.onclick=()=>window.downloaded++;cell.append(button);tr.append(cell);document.querySelector('tbody').prepend(tr);return tr;
  };
 });
 await page.addScriptTag({content:'window.chrome={runtime:{id:"TEST",getManifest(){return {version:"0.2.8"};},onMessage:{addListener(fn){window.collectStep=m=>new Promise(resolve=>fn(m,{id:"TEST"},resolve));}}}};'});
 await page.addScriptTag({path:path.resolve(__dirname,'../browser-extensions/coupang-collector/download-bridge.js')});await page.addScriptTag({path:source});return page;
}
async function request(page){
 const result=await page.evaluate(job=>window.collectStep({kind:'step',allowCreate:true,job}),range);
 assert.equal(result.requested,true,JSON.stringify(result));
 return {...range,submitted:true,confirmedAllCampaigns:true,baselineCount:result.baselineCount,baselineReports:result.baselineReports};
}
const poll=(page,job)=>page.evaluate(job=>window.collectStep({kind:'step',allowCreate:false,job}),job);
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
 for(const disabled of ['native','aria']){
  const page=await fixture(),job=await request(page);
  await page.evaluate(disabled=>{const button=window.addReport('new-completed').querySelector('button');if(disabled==='native')button.disabled=true;else button.setAttribute('aria-disabled','true');},disabled);
  let result=await poll(page,job);assert.equal(result.phase,'ready',disabled+': '+JSON.stringify(result));assert.notEqual(result.downloading,true);assert.equal(await page.evaluate(()=>window.downloaded),0);
  await page.evaluate(()=>{const button=document.querySelector('tbody button');button.disabled=false;button.removeAttribute('aria-disabled');});
  result=await poll(page,job);assert.equal(result.downloading,true,JSON.stringify(result));assert.equal(await page.evaluate(()=>window.downloaded),1);assert.equal(await page.evaluate(()=>window.created),1);
  await page.close();
 }
 {
  const page=await fixture(),job=await request(page);await page.evaluate(()=>window.addReport('new-failed','생성 실패'));
  const result=await poll(page,job);assert.equal(result.blocked,true,JSON.stringify(result));assert.equal(result.phase,'failed');assert.equal(await page.evaluate(()=>window.downloaded),0);await page.close();
 }
 for(const period of ['2026-10-26 ~ 2026-11-01','2026.10.26 - 2026.11.1','2026/10/26 ～ 2026/11/1']){
  const page=await fixture(),job=await request(page);await page.evaluate(period=>window.addReport('new-format','생성 완료',period),period);
  const result=await poll(page,job);assert.equal(result.downloading,true,period+': '+JSON.stringify(result));assert.equal(await page.evaluate(()=>window.downloaded),1);await page.close();
 }
 {
  const page=await fixture(),job=await request(page);
  await page.evaluate(()=>{
   window.addReport('new-pending','생성 중');document.getElementById('refresh').onclick=()=>{window.refreshes++;setTimeout(()=>{document.querySelector('tbody .report-status').textContent='생성 완료';},350);};
  });
  const result=await poll(page,job);assert.equal(result.downloading,true,'refresh must re-read the changed rows: '+JSON.stringify(result));assert.equal(await page.evaluate(()=>window.refreshes),1);assert.equal(await page.evaluate(()=>window.downloaded),1);await page.close();
 }
 {
  const page=await fixture();await page.evaluate(()=>{
   window.addReport('second-page');const list=document.createElement('ul');list.className='ant-pagination';list.innerHTML='<li class="ant-pagination-item ant-pagination-item-1"><a>1</a></li><li class="ant-pagination-item ant-pagination-item-2 ant-pagination-item-active"><a>2</a></li>';document.querySelector('.ant-table-wrapper').append(list);
   list.querySelector('.ant-pagination-item-1').onclick=()=>{window.firstPageClicks=(window.firstPageClicks||0)+1;list.querySelector('.ant-pagination-item-active').classList.remove('ant-pagination-item-active');list.querySelector('.ant-pagination-item-1').classList.add('ant-pagination-item-active');const first=list.querySelector('.ant-pagination-item-1');first.replaceWith(first.cloneNode(true));document.querySelector('tbody').replaceChildren();window.addReport('first-page');};
   document.getElementById('create').onclick=()=>{window.created++;window.pageAtCreate=!!list.querySelector('.ant-pagination-item-1.ant-pagination-item-active');};
  });
  const job=await request(page);assert.equal(await page.evaluate(()=>window.firstPageClicks),1);assert.equal(await page.evaluate(()=>window.pageAtCreate),true);assert.equal(job.baselineCount,1);assert.ok(job.baselineReports.some(item=>String(item.key).includes('first-page')),JSON.stringify(job.baselineReports));assert.equal(await page.evaluate(()=>window.created),1);await page.close();
 }
 {
  const page=await fixture();await page.evaluate(()=>window.addReport('old-partial','생성 완료',undefined,'일부 캠페인 A'));const job=await request(page);
  await page.evaluate(()=>{document.querySelector('tbody tr').children[2].textContent='일부 캠페인 B';});
  const result=await poll(page,job);assert.notEqual(result.downloading,true,'known old ID must remain old after scope text changes');assert.equal(await page.evaluate(()=>window.downloaded),0);await page.close();
 }
 {
  const page=await fixture();await page.evaluate(()=>{for(let index=9;index>=0;index--)window.addReport(String(index),'생성 완료',undefined,undefined,true);});const job=await request(page);
  await page.evaluate(()=>{document.querySelector('tbody .report-status').textContent='생성 중';});let result=await poll(page,job);assert.notEqual(result.downloading,true);
  await page.evaluate(()=>{document.querySelector('tbody .report-status').textContent='생성 완료';});result=await poll(page,job);assert.notEqual(result.downloading,true,'identical positional rows must not select an older report');assert.equal(await page.evaluate(()=>window.downloaded),0);await page.close();
 }
 console.log('PASS local report-status fixtures: disabled downloads, failure detection, date formats, refreshed state, first-page baseline and ambiguous/old-report rejection. Live Coupang account not exercised.');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await browser?.close();await new Promise(resolve=>server.close(resolve));});
