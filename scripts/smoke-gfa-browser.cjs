'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawn}=require('node:child_process'),{deflateRawSync}=require('node:zlib');
const root=path.resolve(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'roas-gfa-browser-')),base='http://127.0.0.1:3000';
let browser,child;const errors=[];
// A small real ZIP/XLSX fixture exercises browser decompression, shared strings and date styles.
function xlsx(){
 const cells=[['날짜','경로(1단계)','경로(2단계)','경로(3단계)','방문수','상품결제건수','판매금액(총)'],['2026-09-01 ~ 2026-09-07','네이버 광고','성과형 디스플레이광고','GFA','100','2','798000'],['2026-09-01 ~ 2026-09-07','직접유입','-','-','50','1','399000']],strings=cells.flat();
 const sheet='<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'+cells.map((row,i)=>'<row r="'+(i+1)+'">'+row.map((v,j)=>'<c r="'+String.fromCharCode(65+j)+(i+1)+'" t="s"><v>'+(i*7+j)+'</v></c>').join('')+'</row>').join('')+'</sheetData></worksheet>';
 const files={'xl/sharedStrings.xml':'<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'+strings.map(s=>'<si><t>'+s+'</t></si>').join('')+'</sst>','xl/worksheets/sheet1.xml':sheet},locals=[],central=[];let offset=0;
 function crc32(buffer){let crc=0xffffffff;for(const b of buffer){crc^=b;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
 for(const [name,text] of Object.entries(files)){const raw=Buffer.from(text),data=deflateRawSync(raw),n=Buffer.from(name),local=Buffer.alloc(30),c=Buffer.alloc(46),crc=crc32(raw);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(8,8);local.writeUInt32LE(crc,14);local.writeUInt32LE(data.length,18);local.writeUInt32LE(raw.length,22);local.writeUInt16LE(n.length,26);locals.push(local,n,data);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(8,10);c.writeUInt32LE(crc,16);c.writeUInt32LE(data.length,20);c.writeUInt32LE(raw.length,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE(offset,42);central.push(c,n);offset+=30+n.length+data.length;}
 const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(2,8);end.writeUInt16LE(2,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...locals,directory,end]);
}
(async()=>{
 for(const name of ['server.js','package.json','public','vendor'])fs.cpSync(path.join(root,name),path.join(temp,name),{recursive:true});
 // Runtime and assets must work even if the old updater has not copied the new JS files.
 for(const name of ['gfa-data.js','gfa-analysis.js'])fs.rmSync(path.join(temp,'public',name));
 child=spawn(process.execPath,['-e',"require('./server').server.listen(3000,'127.0.0.1',()=>console.log('READY'))"],{cwd:temp,env:{...process.env,WEB_PASSWORD:'',META_ACCESS_TOKEN:''},stdio:['ignore','pipe','pipe']});
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Server startup timed out')),10000);child.stdout.on('data',v=>{if(String(v).includes('READY')){clearTimeout(timer);resolve();}});child.once('error',reject);});
 const {chromium}=require(process.env.ROAS_PLAYWRIGHT_MODULE||'playwright');browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
 const context=await browser.newContext({viewport:{width:1440,height:1100},timezoneId:'Asia/Seoul'}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await fetch(base+'/api/naver/ad-spend',{method:'POST',headers:{'Content-Type':'application/json','X-ROAS-Local-Action':'yes'},body:JSON.stringify({since:'2026-09-01',until:'2026-09-30',amounts:{gfa:300000},revision:0})});
 await page.goto(base+'/display-analysis.html');await page.waitForFunction(()=>document.querySelectorAll('#legacy-costs tr').length===1);
 page.once('dialog',d=>d.accept());await page.locator('#legacy-costs button').click();await page.waitForFunction(()=>document.querySelector('#legacy-costs').textContent.includes('저장된 GFA 광고비가 없습니다'));
 await page.locator('#report-from').click();await page.locator('.roas-range-modal').waitFor({state:'visible'});
 assert.equal(await page.locator('.roas-range-months > div').count(),2,'range picker separates two months');
 await page.locator('.roas-range-quick button').filter({hasText:/^7일$/}).click();
 const selected=await page.locator('.roas-range-grid button.selected').count();assert.ok(selected>=1);
 await page.locator('[data-apply]').click();await page.waitForFunction(()=>!document.querySelector('#report-load').disabled);
 assert.equal(await page.locator('.roas-range-modal').count(),0);
 const start=await page.locator('#report-from').inputValue(),end=await page.locator('#report-to').inputValue();assert.equal((Date.parse(end)-Date.parse(start))/86400000,6);
 await page.locator('#report-month').fill('2024-02');await page.locator('#report-month').dispatchEvent('change');await page.waitForFunction(()=>!document.querySelector('#report-load').disabled);
 assert.equal(await page.locator('#report-from').inputValue(),'2024-02-01');assert.equal(await page.locator('#report-to').inputValue(),'2024-02-29');
 await page.locator('#report-to').click();await page.keyboard.press('Escape');assert.equal(await page.locator('.roas-range-modal').count(),0);
 await page.locator('#from').fill('2026-09-01');await page.locator('#to').fill('2026-09-07');
 const paste='캠페인 이름\t캠페인 ID\t총비용\t구매완료 수\t구매완료 전환매출액\t노출수\t클릭수\n위마망 A\t1234567\t100000\t5\t1995000\t10000\t500';
 await page.locator('#paste').fill(paste);await page.locator('#save').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('전체 통계에 반영'));
 await page.waitForFunction(()=>document.querySelector('#legacy-costs').textContent.includes('100,000원'));
 assert.match(await page.locator('#legacy-costs').textContent(),/2026-09-01 ~ 2026-09-07/);
 assert.equal(await page.locator('#legacy-costs [data-load]').count(),1,'saved performance appears beside legacy costs');
 await page.locator('#clear').click();await page.locator('#legacy-costs [data-load]').click();
 assert.match(await page.locator('#rows').textContent(),/100,000원/,'saved-cost list restores campaign performance');
 await page.locator('#channel-file').setInputFiles({name:'전체채널_2026-09-01_2026-09-07.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:xlsx()});
 await page.waitForFunction(()=>document.querySelectorAll('#channel-preview tr').length===2);assert.equal(await page.locator('#file-since').inputValue(),'2026-09-01');assert.equal(await page.locator('#channel-preview input:checked').count(),1);
 await page.locator('#file-save').click();await page.waitForFunction(()=>document.querySelector('#file-status').textContent.includes('저장했습니다'));
 assert.match(await page.locator('#report-status').textContent(),/같은 기간 비교 가능/);assert.match(await page.locator('#combined-kpis').textContent(),/798,000원/);assert.match(await page.locator('#combined-kpis').textContent(),/798%/);assert.match(await page.locator('#analysis-notes').textContent(),/1,197,000원/);
 await page.locator('#file-save').click();await page.waitForFunction(()=>document.querySelector('#file-save').disabled===false);assert.equal(await page.locator('#stored-files tr').count(),2,'same-period upload replaces saved data');
 assert.equal(await page.locator('main > section').first().getAttribute('id'),'combined-analysis','dashboard precedes uploads');
 assert.match(await page.locator('[data-metric="purchases"]').textContent(),/5건/,'GFA purchases come from saved performance');
 await page.locator('#metrics-clear').click();await page.locator('#report-metrics input[value="purchases"]').check();await page.locator('#metrics-apply').click();await page.waitForFunction(()=>!document.querySelector('#report-load').disabled);
 assert.equal(await page.locator('#combined-kpis .kpi').count(),1);assert.match(await page.locator('#combined-kpis').textContent(),/5건/);
 await page.reload();await page.waitForFunction(()=>document.querySelector('#combined-kpis [data-metric="purchases"]'));
 assert.equal(await page.locator('#combined-kpis .kpi').count(),1,'metric selection survives reload');
 await page.locator('#metrics-clear').click();await page.locator('#metrics-apply').click();await page.waitForFunction(()=>!document.querySelector('#report-load').disabled);assert.match(await page.locator('#combined-kpis').textContent(),/표시할 데이터를 선택/);
 await page.locator('#metrics-all').click();await page.locator('#metrics-apply').click();await page.waitForFunction(()=>!document.querySelector('#report-load').disabled);assert.equal(await page.locator('#combined-kpis .kpi').count(),9);

 const externalContext=await browser.newContext(),other=await externalContext.newPage();await other.goto(base+'/display-analysis.html');await other.waitForFunction(()=>document.querySelectorAll('#stored-files tr').length===2);assert.equal(await other.locator('#history button').count(),1,'campaign data survives empty browser storage');assert.match(await other.locator('#combined-kpis').textContent(),/798%/);await externalContext.close();
 await page.locator('#report-from').evaluate(el=>{el.value='2026-09-02';el.dispatchEvent(new Event('change',{bubbles:true}));});await page.locator('#report-load').click();await page.waitForFunction(()=>document.querySelector('#report-load').disabled===false);assert.match(await page.locator('#report-status').textContent(),/제외/);assert.doesNotMatch(await page.locator('#combined-kpis').textContent(),/798%/);
 await page.locator('#report-from').evaluate(el=>{el.value='2026-09-01';el.dispatchEvent(new Event('change',{bubbles:true}));});await page.locator('#report-load').click();await page.waitForFunction(()=>document.querySelector('#report-load').disabled===false);
 const row=page.locator('#stored-files tr').filter({hasText:'전체채널 파일'});await row.locator('[data-load]').click();await page.locator('#channel-preview input:checked').uncheck();await page.locator('#file-save').click();await page.waitForFunction(()=>document.querySelector('#file-save').disabled===false);assert.match(await page.locator('#report-status').textContent(),/GFA 경로를 선택/);
 await page.locator('#channel-preview input').first().check();await page.locator('#file-save').click();await page.waitForFunction(()=>document.querySelector('#file-save').disabled===false);
 if(process.env.ROAS_GFA_SCREENSHOT)await page.screenshot({path:process.env.ROAS_GFA_SCREENSHOT,fullPage:true});
 // Weekly daily exports auto-save; subsequent overlapping weeks add only new date+route keys.
 const makeDaily=(start,end)=>[['날짜','경로(1단계)','경로(2단계)','경로(3단계)','방문수','상품결제건수','판매금액(총)'],
   ...Array.from({length:end-start+1},(_,i)=>{const d=String(start+i).padStart(2,'0');return ['2026-10-'+d,'모바일','광고','성과형 디스플레이광고',10,1,399000];})]
   .map(cells=>cells.join(',')).join('\n');
 await page.locator('#channel-file').setInputFiles({name:'visit_20261001-20261007.csv',mimeType:'text/csv',buffer:Buffer.from(makeDaily(1,7))});
 await page.waitForFunction(()=>document.querySelector('#file-status')?.textContent.includes('자동 저장했습니다'));
 assert.match(await page.locator('#file-status').textContent(),/새 자료 7행 저장/);
 await page.locator('#channel-file').setInputFiles({name:'visit_20261005-20261011.csv',mimeType:'text/csv',buffer:Buffer.from(makeDaily(5,11))});
 await page.waitForFunction(()=>document.querySelector('#file-status')?.textContent.includes('자동 저장했습니다'));
 assert.match(await page.locator('#file-status').textContent(),/새 자료 4행 저장 · 이미 있던 날짜·경로 3행 중복 제외/);
 const weekly=(await (await fetch(base+'/api/gfa-analysis')).json());
 const combined=require(path.join(root,'public/gfa-data.js')).analyze(weekly.entries,'2026-10-01','2026-10-11');
 assert.equal(combined.channels.covered,11);assert.equal(combined.store.sales,11*399000,'last-click results must not double count');
 // A campaign report containing planned budget and actual expenditure can be imported by file.
 const campaignFile=['캠페인 이름','캠페인 ID','총비용','캠페인 예산','구매완료 수','구매완료 전환매출액'].join('\t')+
   '\n위마망 GFA\t1234567\t700000\t1500000\t7\t2793000';
 await page.locator('#ads-file').setInputFiles({name:'GFA_20261001-20261007.tsv',mimeType:'text/tab-separated-values',buffer:Buffer.from(campaignFile)});
 await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('설정 예산을 구분'));
 assert.equal(await page.locator('#from').inputValue(),'2026-10-01');
 assert.match(await page.locator('#rows').textContent(),/1,500,000원/);
 await page.locator('#save').click();
 await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('전체 통계에 반영'));
 await page.locator('#report-from').evaluate(el=>{el.value='2026-10-01';el.dispatchEvent(new Event('change',{bubbles:true}));});await page.locator('#report-to').evaluate(el=>{el.value='2026-10-07';el.dispatchEvent(new Event('change',{bubbles:true}));});
 await page.locator('#report-load').click();await page.waitForFunction(()=>document.querySelector('#report-load').disabled===false);
 assert.match(await page.locator('#combined-kpis').textContent(),/2,793,000원/);
 assert.match(await page.locator('#combined-kpis').textContent(),/399%/);
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no outer overflow on mobile');
 await page.goto(base+'/visual-overview.html');
 await page.evaluate(()=>{document.querySelector('#since').value='2026-10-01';document.querySelector('#until').value='2026-10-07';});await page.locator('#reload').click();await page.waitForFunction(()=>!document.querySelector('#reload').disabled);
 await page.locator('#summary-edit').click();
 assert.equal(await page.locator('#summary-choice-0 optgroup[label="GFA"] option').count(),12,'all GFA metrics are grouped in one folder');
 await page.locator('#summary-choice-0').click();await page.locator('.gfa-metric-popup summary').click();await page.locator('.gfa-metric-popup [data-metric-value="gfaDirectRevenue"]').click();
 await page.locator('#summary-choice-1').selectOption('gfaIndirectRoas');await page.locator('#summary-save').click();
 assert.match(await page.locator('[data-summary-key="gfaDirectRevenue"] strong').textContent(),/2,793,000원/);
 assert.match(await page.locator('[data-summary-key="gfaIndirectRoas"] strong').textContent(),/399/);
 await page.reload();await page.waitForFunction(()=>!document.querySelector('#reload').disabled);assert.equal(await page.locator('[data-summary-key="gfaDirectRevenue"]').count(),1,'GFA metric choice persists');
 assert.deepEqual(errors,[]);console.log('PASS: XLSX decompression, preview, GFA selection, source comparison, replace, cross-browser persistence, partial dates and legacy asset fallback.');
})().catch(e=>{console.error(e.stack);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();if(child&&child.exitCode===null){child.kill();await new Promise(resolve=>child.once('exit',resolve));}fs.rmSync(temp,{recursive:true,force:true});});
