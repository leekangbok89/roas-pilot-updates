'use strict';
// Synthetic pages only: every real analytics request is blocked.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.ROAS_PLAYWRIGHT_MODULE||'playwright');
const base=path.resolve(__dirname,'..'), tracker=fs.readFileSync(path.join(base,'public/detail-tracker.js'),'utf8');
const {DETAIL_DEFAULTS,assembleDetailReport}=require('../integrations/ga4/client.cjs');
let checks=0;
const pass=label=>{checks++;console.log('PASS '+label);};
(async()=>{
  const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
  try{
    const page=await browser.newPage({viewport:{width:900,height:650},locale:'ko-KR',timezoneId:'Asia/Seoul'}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.clock.install();
    const image='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="3000"><rect width="800" height="3000" fill="#9688db"/></svg>');
    const fixture='<!doctype html><style>body{margin:0}#prdDetail{width:600px}img,video{width:600px;display:block}video{height:300px}</style><div id="prdDetail"><img src="'+image+'"><video></video><img src="'+image+'"></div><button data-roas-buy>구매</button><button data-roas-cart>담기</button><script>window.calls=[];window.gtag=function(){window.calls.push(Array.from(arguments))};</script>';
    await page.route('**/*',r=>r.request().url().startsWith('https://wemamang.com/')?r.fulfill({contentType:'text/html',body:fixture}):r.abort());
    async function setup(url='https://wemamang.com/product/detail.html?product_no=458',extra={}){
      await page.goto(url);await page.locator('img').first().evaluate(el=>el.decode());
      await page.evaluate(c=>{window.ROAS_DETAIL_CONFIG=c;},{...DETAIL_DEFAULTS,...extra});
      await page.addScriptTag({content:tracker});
    }
    const events=()=>page.evaluate(()=>calls.filter(c=>c[0]==='event'));
    await setup();await page.clock.runFor(2200);
    let data=await events();assert.equal(data.filter(e=>e[1]==='rp_detail_view').length,1);
    assert.equal(data.filter(e=>e[1]==='rp_content_view'&&e[2].rp_content_id==='image_001_p01').length,1);
    assert.equal(data.some(e=>e[2].rp_content_id==='image_002_p01'),false);
    assert.equal(await page.evaluate(()=>__roasDetailTracker.content),7);
    await page.addScriptTag({content:tracker});await page.clock.runFor(1000);assert.equal((await events()).filter(e=>e[1]==='rp_detail_view').length,1);
    pass('product tracking, tall-image sections, offscreen exclusion and duplicate-install guard');
    await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>window.testHidden===true});window.testHidden=true;document.dispatchEvent(new Event('visibilitychange'));});
    const before=(await events()).filter(e=>e[1]==='rp_content_time').reduce((s,e)=>s+e[2].rp_visible_ms,0);
    await page.clock.runFor(20000);await page.evaluate(()=>{window.testHidden=false;document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('pagehide'));});
    const after=(await events()).filter(e=>e[1]==='rp_content_time').reduce((s,e)=>s+e[2].rp_visible_ms,0);assert.equal(after,before);
    await page.evaluate(()=>window.dispatchEvent(new Event('pageshow')));await page.clock.runFor(1500);
    await page.evaluate(()=>{document.querySelector('[data-roas-buy]').click();document.querySelector('[data-roas-buy]').click();document.querySelector('[data-roas-cart]').click();window.dispatchEvent(new Event('pagehide'));window.dispatchEvent(new Event('pagehide'));});
    data=await events();assert.equal(data.filter(e=>e[1]==='rp_buy_click').length,1);assert.equal(data.filter(e=>e[1]==='rp_cart_click').length,1);
    assert.ok(data.filter(e=>e[1]==='rp_content_time').reduce((s,e)=>s+e[2].rp_visible_ms,0)<10000);
    assert.ok(!JSON.stringify(data).includes('data:image'));
    pass('hidden tabs, BFCache flush deduplication and per-view click semantics');
    await setup('https://wemamang.com/product/detail.html?product_no=459');await page.clock.runFor(2000);assert.equal((await events()).length,0);
    await setup('https://wemamang.com/product/baekdoc/458/category/115/',{requireConsent:true});await page.clock.runFor(2000);assert.equal((await events()).length,0);
    await page.evaluate(()=>window.ROAS_DETAIL_CONSENT=true);await page.clock.runFor(2000);assert.equal((await events()).filter(e=>e[1]==='rp_detail_view').length,1);
    pass('wrong products excluded; pretty URLs and explicit consent gate supported');
    await setup();
    await page.evaluate(()=>{
      const v=document.querySelector('video');window.mockTime=0;Object.defineProperties(v,{paused:{get:()=>false},ended:{get:()=>false},duration:{get:()=>10},currentTime:{get:()=>mockTime}});
    });
    await page.clock.runFor(2000);assert.equal((await events()).some(e=>e[1]==='rp_video_start'),false);
    await page.evaluate(()=>window.scrollTo(0,2100));await page.clock.runFor(500);
    for(let i=1;i<=40;i++){await page.evaluate(time=>window.mockTime=time,i/4);await page.clock.runFor(250);}
    data=await events();assert.equal(data.filter(e=>e[1]==='rp_video_start').length,1);assert.equal(data.filter(e=>e[1]==='rp_video_100').length,1);
    await page.evaluate(()=>window.__roasDetailTracker.stop());
    await setup();await page.evaluate(()=>{
      const v=document.querySelector('video');window.mockTime=0;Object.defineProperties(v,{paused:{get:()=>false},ended:{get:()=>false},duration:{get:()=>60},currentTime:{get:()=>mockTime}});window.scrollTo(0,2100);
    });await page.clock.runFor(1000);
    await page.evaluate(()=>{mockTime=59;document.querySelector('video').dispatchEvent(new Event('seeking'));});await page.clock.runFor(1000);
    assert.equal((await events()).some(e=>e[1]==='rp_video_100'),false);
    pass('visible video playback completes once; autoplay offscreen and seek-to-end do not');
    await page.close();
    const ui=await browser.newPage({viewport:{width:1440,height:1000},locale:'ko-KR',timezoneId:'Asia/Seoul'});
    ui.on('pageerror',e=>errors.push(e.message));let saved={...DETAIL_DEFAULTS},mode='ready';
    const raw={dimensionHeaders:['eventName','customEvent:rp_content_id','customEvent:rp_content_type'].map(name=>({name})),metricHeaders:['eventCount','customEvent:rp_visible_ms'].map(name=>({name})),rows:[['rp_detail_view','page','page','100','0'],['rp_content_view','image_001_p01','image','80','0'],['rp_content_time','image_001_p01','image','3','400000']].map(r=>({dimensionValues:r.slice(0,3).map(value=>({value})),metricValues:r.slice(3).map(value=>({value}))}))};
    const report=assembleDetailReport(raw,{since:'2026-10-19',until:'2026-10-25',productId:'458',contentVersion:'v1'},true);
    await ui.route('**/*',async route=>{
      const url=new URL(route.request().url()),p=url.pathname;
      if(url.hostname!=='127.0.0.1')return route.abort();
      if(p==='/api/ga4/status')return route.fulfill({json:{configured:true}});
      if(p==='/api/ga4/detail-settings'){if(route.request().method()==='POST')saved=route.request().postDataJSON();return route.fulfill({json:saved});}
      if(p==='/api/ga4/detail-report')return mode==='error'?route.fulfill({status:502,json:{error:'합성 오류 <img src=x onerror="window.injected=1">'}}):route.fulfill({json:mode==='setup'?{state:'setup_required',missing:['rp_content_id']}:mode==='zero'?{state:'no_data',rows:[]}:report});
      const file=path.join(base,'public',p.slice(1));if(fs.existsSync(file))return route.fulfill({path:file});return route.fulfill({status:404,body:'missing'});
    });
    await ui.goto('http://127.0.0.1:3000/detail-analysis.html');await ui.mouse.move(900,700);await ui.keyboard.press('Escape');await ui.locator('#install-output').waitFor({state:'visible'});
    const snippet=await ui.locator('#install-code').inputValue();assert.ok(snippet.includes('G-RZF6S41CF0'));assert.ok(!snippet.includes('127.0.0.1'));new Function(snippet.slice(9,-9));
    await ui.locator('#detail-clarity').fill('abc123456');await ui.locator('#settings-save').click();await ui.waitForFunction(()=>document.querySelector('#install-code').value.includes('abc123456'));
    assert.match(await ui.locator('#clarity-dashboard').getAttribute('href'),/abc123456/);
    await ui.locator('#detail-setup summary').click();await ui.locator('#detail-query').click();await ui.locator('#detail-results').waitFor({state:'visible'});
    assert.equal(await ui.locator('#detail-views').innerText(),'100');assert.match(await ui.locator('#detail-content-body').innerText(),/80%/);assert.match(await ui.locator('#detail-content-body').innerText(),/5초/);
    await ui.screenshot({path:path.join(base,'..','detail-analysis-qa.png'),fullPage:true});
    assert.equal(await ui.locator('#app-nav [data-app-route="detail"]').getAttribute('aria-current'),'page');
    await ui.locator('#app-theme-toggle').click();assert.equal(await ui.locator('html').getAttribute('data-theme'),'light');
    for(const m of ['error','setup','zero']){mode=m;await ui.locator('#detail-refresh').click();await ui.waitForFunction(()=>!document.querySelector('#detail-refresh').disabled);assert.equal(await ui.locator('#detail-results').isVisible(),false);}
    assert.equal(await ui.evaluate(()=>window.injected),undefined);
    await ui.setViewportSize({width:390,height:844});assert.ok(await ui.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));
    assert.deepEqual(errors,[]);pass('dashboard setup/snippet, real calculations, dark/light, mobile and safe empty/error states');
    console.log('Detail browser verification: '+checks+' checks passed.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
