'use strict';
const assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require(process.env.ROAS_PLAYWRIGHT_MODULE||'playwright');
const source=path.resolve(__dirname,'../browser-extensions/coupang-collector/report-page.js');
let browser;
async function fixture(mode){
 const page=await browser.newPage({viewport:{width:1300,height:1000}});
 await page.setContent('<label><input type="radio" name="period" checked>기간 설정</label><span class="ant-calendar-picker"><span class="ant-calendar-range-picker"><input readonly placeholder="시작일" value="2026-10-01"><input readonly placeholder="종료일" value="2026-10-07"></span></span><div id="calendar" hidden></div><label><input type="radio" name="group">일별</label><select><option value="all">전체 캠페인</option></select><button id="create">보고서 만들기</button>');
 await page.evaluate(mode=>{
  const fields=[...document.querySelectorAll('.ant-calendar-range-picker input')],calendar=document.getElementById('calendar');
  let active=1;window.clickedDates=[];window.endpointClicks=[];window.created=0;
  fields.forEach((field,index)=>{
   // Opening alone does not select the active endpoint. In particular, the
   // second input must be clicked even when the range calendar stays open.
   field.addEventListener('focus',()=>{calendar.hidden=false;});
   field.addEventListener('click',()=>{active=index;window.endpointClicks.push(index);calendar.hidden=false;});
  });
  function panel(year,month,index){
   const root=document.createElement('section');root.className=mode==='unrelated'?'invoice-month':index?'ant-calendar-range-right':'ant-calendar-range-left';
   root.innerHTML='<div class="'+(mode==='unrelated'?'invoice-heading':'ant-calendar-header')+'"><a class="ant-calendar-year-select">'+year+'년</a> <a class="ant-calendar-month-select">'+month+'월</a></div>';
   const table=document.createElement('table');table.className=mode==='unrelated'?'invoice-table':'ant-calendar-table';
   const head=document.createElement('thead');head.innerHTML='<tr>'+['일','월','화','수','목','금','토'].map(day=>'<th>'+day+'</th>').join('')+'</tr>';table.append(head);
   const body=document.createElement('tbody'),first=new Date(Date.UTC(year,month-1,1));
   const start=first.getTime()-first.getUTCDay()*86400000;
   for(let week=0;week<6;week++){
    const row=document.createElement('tr');
    for(let col=0;col<7;col++){
     const offset=week*7+col,date=new Date(start+offset*86400000),iso=date.toISOString().slice(0,10),cell=document.createElement('td'),inner=document.createElement('div');
     cell.className=mode==='unrelated'?'invoice-cell':'ant-calendar-cell';inner.className=mode==='unrelated'?'invoice-day':'ant-calendar-date';
     if(date.getUTCMonth()!==month-1)cell.classList.add(date<first?'ant-calendar-last-month-cell':'ant-calendar-next-month-cell');
     if(mode==='disabled'&&iso==='2026-11-01')cell.classList.add('ant-calendar-disabled-cell');
     inner.textContent=mode==='invalid'&&offset===15?'31':String(date.getUTCDate());
     if(mode==='inner-title')inner.title=iso;
     cell.append(inner);cell.addEventListener('click',()=>{
      // Fixture behaves like the page: disabled dates cannot change a value.
      if(cell.classList.contains('ant-calendar-disabled-cell'))return;
      fields[active].value=iso;window.clickedDates.push({endpoint:active,date:iso});
      // Keep the panel open after selecting the start, as a range picker does.
      calendar.hidden=active===1;
     });row.append(cell);
    }body.append(row);
   }table.append(body);root.append(table);calendar.append(root);
  }
  panel(2026,10,0);panel(2026,11,1);
  document.getElementById('create').onclick=()=>window.created++;
 },mode);
 await page.addScriptTag({content:'window.chrome={runtime:{id:"TEST",getManifest(){return {version:"0.2.8"};},onMessage:{addListener(fn){window.collectStep=m=>new Promise(resolve=>fn(m,{id:"TEST"},resolve));}}}};'});
 await page.addScriptTag({path:path.resolve(__dirname,'../browser-extensions/coupang-collector/download-bridge.js')});await page.addScriptTag({path:source});return page;
}
(async()=>{
 browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
 for(const mode of ['inner-title','numeric','disabled','invalid','unrelated']){
  const page=await fixture(mode);
  const result=await page.evaluate(()=>window.collectStep({kind:'step',allowCreate:true,job:{since:'2026-10-26',until:'2026-11-01'}}));
  if(mode==='inner-title'||mode==='numeric'){
   assert.equal(result.requested,true,mode+': '+JSON.stringify(result));
   assert.equal(await page.locator('input[placeholder="시작일"]').inputValue(),'2026-10-26',mode+' start');
   assert.equal(await page.locator('input[placeholder="종료일"]').inputValue(),'2026-11-01',mode+' end');
   assert.equal(await page.evaluate(()=>window.created),1,mode+' creates only once');
   assert.deepEqual(await page.evaluate(()=>window.clickedDates),[{endpoint:0,date:'2026-10-26'},{endpoint:1,date:'2026-11-01'}],mode+' clicks the correct range endpoint');
   const endpoints=await page.evaluate(()=>window.endpointClicks);assert.ok(endpoints.includes(0)&&endpoints.includes(1),mode+' activates both inputs explicitly');
  }else{
   assert.equal(result.needsInput,true,mode+': '+JSON.stringify(result));
   assert.notEqual(result.requested,true,mode+' must stop');
   assert.equal(await page.evaluate(()=>window.created),0,mode+' cannot submit a guessed or disabled range');
  }
  await page.close();
 }
 console.log('PASS local calendar fixtures: inner full-date attributes, validated numeric two-month grids, explicit start/end activation, disabled target and invalid/non-calendar rejection. Live Coupang DOM is not exercised.');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await browser?.close();});
