'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const source=path.resolve(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'roas-change-browser-'));
const {chromium}=require(process.env.ROAS_PLAYWRIGHT_MODULE||'playwright');
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const shift=(d,n)=>new Date(Date.parse(d+'T00:00:00Z')+n*86400000).toISOString().slice(0,10),pivot=shift(today,-10),base='http://127.0.0.1:3000';
let child,browser;const errors=[],external=[];
const write=(file,value)=>{const dest=path.join(temp,file);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,JSON.stringify(value));};
(async()=>{
  for(const name of ['server.js','package.json','public','vendor'])fs.cpSync(path.join(source,name),path.join(temp,name),{recursive:true});
  // Reproduce an old updater that knows only server.js and old public assets.
  for(const name of ['ad-changes.html','ad-changes.js','ad-changes.css','app-shell.js','app-shell.css'])fs.rmSync(path.join(temp,'public',name));
  for(let n=-3;n<=3;n++){if(n===0)continue;const date=shift(pivot,n);write('.roas-data/daily/111111/'+date+'.json',{account:'111111',date,currency:'KRW',rows:[{campaign_id:'c1',campaign_name:'백도씨 캠페인',adset_id:'s1',adset_name:'광범위',ad_id:'a1',ad_name:'새벽수유',spend:n<0?'100':'200',impressions:'1000',inline_link_clicks:'10',actions:[{action_type:'purchase',value:'2'}],action_values:[{action_type:'purchase',value:n<0?'400':'1200'}]}]});}
  child=spawn(process.execPath,['-e',"global.fetch=async()=>{throw Error('External calls disabled')};require('./server').server.listen(3000,'127.0.0.1',()=>console.log('READY'));"],{cwd:temp,env:{...process.env,WEB_PASSWORD:'',HOST:'127.0.0.1',META_ACCESS_TOKEN:'',OPENAI_API_KEY:''},stdio:['ignore','pipe','pipe']});
  await new Promise((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(Error('Server startup timed out: '+log)),10000);child.stdout.on('data',s=>{log+=s;if(log.includes('READY')){clearTimeout(timer);resolve();}});child.stderr.on('data',s=>log+=s);child.on('error',reject);child.on('exit',code=>{if(code){clearTimeout(timer);reject(Error(log));}});});
  browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
  const context=await browser.newContext({viewport:{width:1440,height:1050},locale:'ko-KR',timezoneId:'Asia/Seoul',acceptDownloads:true});
  await context.route('**/*',route=>{if(route.request().url().startsWith(base+'/'))return route.continue();external.push(route.request().url());return route.abort();});
  await context.addInitScript(({pivot})=>{localStorage.setItem('roas-account-ids',JSON.stringify({naver:'111111'}));if(!localStorage.getItem('roas-pilot-changelog-v1'))localStorage.setItem('roas-pilot-changelog-v1',JSON.stringify([{date:pivot,kind:'타겟 변경',ad:'이전 메모',note:'확인 필요'}]));},{pivot:shift(pivot,-20)});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/ad-changes.html');await page.mouse.move(1200,900);await page.waitForFunction(()=>document.getElementById('status').textContent.includes('가져왔습니다'));
  assert.equal(await page.locator('#account').inputValue(),'111111');assert.equal(await page.locator('#entries tr').count(),1);
  await page.mouse.move(1200,900);await page.locator('#date').fill(pivot);await page.locator('#windowDays').selectOption('3');await page.locator('#load-targets').click();await page.waitForFunction(()=>document.getElementById('target').options.length===2);await page.locator('#target').selectOption('0');assert.equal(await page.locator('#entityId').inputValue(),'c1');
  await page.locator('#before').fill('3만원');await page.locator('#after').fill('5만원');await page.locator('#note').fill('<script>alert(1)</script> 신규 영상 반응 확인');await page.locator('#save').click();await page.waitForFunction(()=>document.getElementById('status').textContent==='변경 기록을 저장했습니다.');
  assert.equal(await page.locator('#entries tr').count(),2);assert.equal(await page.locator('#entries script').count(),0);assert.match(await page.locator('#entries').textContent(),/<script>alert\(1\)<\/script>/);
  await page.reload();await page.waitForFunction(()=>document.querySelectorAll('#entries tr').length===2);
  const row=page.locator('#entries tr').filter({hasText:'백도씨 캠페인'});await row.locator('[data-action="compare"]').click();await page.waitForFunction(()=>document.getElementById('report-status').textContent.startsWith('비교 가능'));
  assert.match(await page.locator('#report-body').textContent(),/400%/);assert.match(await page.locator('#report-body').textContent(),/600%/);assert.match(await page.locator('#report-body').textContent(),/200%p/);
  await row.locator('[data-action="edit"]').click();await page.locator('#after').fill('6만원');await page.locator('#save').click();await page.waitForFunction(()=>document.getElementById('status').textContent==='변경 기록을 저장했습니다.');assert.match(await row.textContent(),/6만원/);
  await page.locator('#search').fill('없는광고');assert.match(await page.locator('#entries').textContent(),/조건에 맞는 기록/);await page.locator('#clear-filter').click();
  const downloadPromise=page.waitForEvent('download');await page.locator('#export').click();const download=await downloadPromise;const report=JSON.parse(fs.readFileSync(await download.path(),'utf8'));assert.equal(report.entries.length,2);assert.equal(report.reports.find(r=>r.ready).deltas.roas,200);assert.equal(report.reports.find(r=>r.ready).after.daily.length,3);
  if(process.env.ROAS_JOURNAL_SCREENSHOT)await page.screenshot({path:process.env.ROAS_JOURNAL_SCREENSHOT,fullPage:true});
  for(const mode of ['light','dark']){if(await page.locator('html').getAttribute('data-theme')!==mode)await page.locator('#app-theme-toggle').click();assert.equal(await page.locator('html').getAttribute('data-theme'),mode);}
  await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'mobile page has no outer horizontal overflow');
  await page.setViewportSize({width:1440,height:1050});page.once('dialog',d=>d.accept());await row.locator('[data-action="delete"]').click();await page.waitForFunction(()=>document.querySelectorAll('#entries tr').length===1);assert.equal(JSON.parse(fs.readFileSync(path.join(temp,'.roas-data/ad-changes.json'))).entries.length,1);
  for(const channel of ['naver-search','naver-display','meta-other']){
    await page.locator('#cancel').click();await page.locator('#channel').selectOption(channel);
    assert.equal(await page.locator('#account').inputValue(),'');
    assert.equal(await page.locator('#entityName').inputValue(),'');assert.equal(await page.locator('#entityId').inputValue(),'');
    assert.equal(await page.locator('#meta-picker').isVisible(),channel.startsWith('meta-'));
    const memo='계정과 대상 없이 저장 '+channel;
    await page.locator('#note').fill(memo);await page.locator('#save').click();
    await page.waitForFunction(()=>document.getElementById('status').textContent==='변경 기록을 저장했습니다.');
    await page.reload();await page.waitForFunction(()=>document.querySelectorAll('#entries tr').length===2);
    const memoRow=page.locator('#entries tr').filter({hasText:memo});await memoRow.locator('[data-action="edit"]').click();
    assert.equal(await page.locator('#channel').inputValue(),channel);assert.equal(await page.locator('#meta-picker').isVisible(),channel.startsWith('meta-'));
    await page.locator('#note').fill(memo+' 수정');await page.locator('#save').click();
    await page.waitForFunction(()=>document.getElementById('status').textContent==='변경 기록을 저장했습니다.');
    await memoRow.locator('[data-action="compare"]').click();
    await page.waitForFunction(()=>/기록만 저장|광고 연결 필요/.test(document.getElementById('report-status').textContent));
    assert.equal(await page.locator('#report-body .comparison-metrics').count(),0);
    if(process.env.ROAS_JOURNAL_MEMO_SCREENSHOT&&channel==='naver-search'){
      await memoRow.locator('[data-action="edit"]').click();
      await page.screenshot({path:process.env.ROAS_JOURNAL_MEMO_SCREENSHOT,fullPage:true});
    }
    page.once('dialog',d=>d.accept());await memoRow.locator('[data-action="delete"]').click();
    await page.waitForFunction(()=>document.querySelectorAll('#entries tr').length===1);
  }
  await page.goto(base+'/visual-overview.html');await page.locator('#app-nav-toggle').click();await page.locator('#app-nav [data-app-route="changes"]').click();await page.waitForURL('**/ad-changes.html');assert.equal(await page.locator('#app-nav [aria-current="page"]').getAttribute('data-app-route'),'changes');
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);console.log('PASS: legacy fallback, migration, target picker, persistence, edit/delete, safe rendering, comparisons, export, optional account and target memos across channels, dark/light, mobile and navigation');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();if(child){child.kill();await new Promise(resolve=>{if(child.exitCode!==null)resolve();else child.once('exit',resolve);});}fs.rmSync(temp,{recursive:true,force:true});});
