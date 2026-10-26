'use strict';
// Synthetic pages only: every real analytics request is blocked.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.ROAS_PLAYWRIGHT_MODULE||'playwright');
const base=path.resolve(__dirname,'..'), tracker=fs.readFileSync(path.join(base,'public/detail-tracker.js'),'utf8');
const thumbnailVideo=Buffer.from('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','base64');
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
    ui.on('pageerror',e=>errors.push(e.message));let saved={...DETAIL_DEFAULTS},mode='ready',catalog={productId:'458',contentVersion:'v1',items:[],importedAt:null};
    const raw={dimensionHeaders:['eventName','customEvent:rp_content_id','customEvent:rp_content_type'].map(name=>({name})),metricHeaders:['eventCount','customEvent:rp_visible_ms'].map(name=>({name})),rows:[['rp_detail_view','page','page','100','0'],['rp_content_view','image_001_p01','image','80','0'],['rp_content_time','image_001_p01','image','3','400000']].map(r=>({dimensionValues:r.slice(0,3).map(value=>({value})),metricValues:r.slice(3).map(value=>({value}))}))};
    const report=assembleDetailReport(raw,{since:'2026-10-19',until:'2026-10-25',productId:'458',contentVersion:'v1'},true);
    await ui.route('**/*',async route=>{
      const url=new URL(route.request().url()),p=url.pathname;
      if(url.hostname==='wemamang.mycafe24.com'&&p==='/detail/dp02.mp4')return route.fulfill({contentType:'video/mp4',headers:{'Access-Control-Allow-Origin':'*'},body:thumbnailVideo});
      if(url.hostname!=='127.0.0.1')return route.abort();
      if(p==='/api/ga4/status')return route.fulfill({json:{configured:true}});
      if(p==='/api/ga4/detail-settings'){if(route.request().method()==='POST')saved=route.request().postDataJSON();return route.fulfill({json:saved});}
      if(p==='/api/ga4/detail-catalog'){
        if(route.request().method()==='POST'){
          const input=route.request().postDataJSON();
          if(input.action==='import')catalog.items=[{id:'image_001',type:'image',url:'https://wemamang.mycafe24.com/detail/dp01.jpg',filename:'dp01.jpg',alt:'상세 이미지',name:''},{id:'video_001',type:'video',url:'https://wemamang.mycafe24.com/detail/dp02.mp4',filename:'dp02.mp4',name:''},{id:'video_002',type:'video',url:'https://wemamang.mycafe24.com/detail/blocked.mp4',filename:'blocked.mp4',name:''}];
          else if(input.action==='thumbnail')catalog.items.find(item=>item.id===input.id).thumbnail=input.thumbnail;
          else for(const n of input.names)catalog.items.find(item=>item.id===n.id).name=n.name;
        }
        return route.fulfill({json:catalog});
      }
      if(p==='/api/ga4/detail-report')return mode==='error'?route.fulfill({status:502,json:{error:'합성 오류 <img src=x onerror="window.injected=1">'}}):route.fulfill({json:mode==='setup'?{state:'setup_required',missing:['rp_content_id']}:mode==='zero'?{state:'no_data',rows:[]}:report});
      const file=path.join(base,'public',p.slice(1));if(fs.existsSync(file))return route.fulfill({path:file});return route.fulfill({status:404,body:'missing'});
    });
    await ui.goto('http://127.0.0.1:3000/detail-analysis.html');await ui.mouse.move(900,700);await ui.keyboard.press('Escape');await ui.locator('#install-output').waitFor({state:'visible'});
    const snippet=await ui.locator('#install-code').inputValue();assert.ok(snippet.includes('G-RZF6S41CF0'));assert.ok(!snippet.includes('127.0.0.1'));new Function(snippet.slice(9,-9));
    await ui.locator('#detail-clarity').fill('abc123456');await ui.locator('#settings-save').click();await ui.waitForFunction(()=>document.querySelector('#install-code').value.includes('abc123456'));
    assert.match(await ui.locator('#clarity-dashboard').getAttribute('href'),/abc123456/);
    await ui.locator('#catalog-import').click();await ui.locator('.catalog-name').first().waitFor();
    assert.equal(await ui.locator('#catalog-body img').getAttribute('src'),'https://wemamang.mycafe24.com/detail/dp01.jpg');
    assert.equal(await ui.locator('#catalog-body video').count(),0,'No blank video player should be displayed');
    await ui.waitForFunction(()=>Array.from(document.querySelectorAll('#catalog-body .video-thumb img')).some(img=>img.src.startsWith('data:image/jpeg;base64,')));
    await ui.waitForFunction(()=>document.querySelector('#catalog-body .video-thumb .thumb-message').textContent==='');
    await ui.locator('.catalog-name').first().fill('수정 중인 이름');
    await ui.locator('#catalog-body input[type=file]').first().setInputFiles({name:'local-video.mp4',mimeType:'video/mp4',buffer:thumbnailVideo});
    await ui.waitForFunction(()=>document.querySelector('#catalog-body .thumb-message').textContent.includes('썸네일 저장 완료'));
    assert.equal(await ui.locator('.catalog-name').first().inputValue(),'수정 중인 이름','Thumbnail updates must preserve unsaved names');
    assert.ok(catalog.items[1].thumbnail.startsWith('data:image/jpeg;base64,'));
    await ui.locator('#catalog-body .video-thumb').nth(1).scrollIntoViewIfNeeded();
    await ui.waitForFunction(()=>Array.from(document.querySelectorAll('#catalog-body .thumb-placeholder')).some(node=>node.textContent==='썸네일 등록 필요'));
    assert.equal(await ui.locator('#catalog-body video').count(),0);
    pass('automatic video frame thumbnails and local-video uploads persist without clearing unsaved names');
    await ui.locator('.catalog-name').first().fill('100℃ 가열 설명 <b>테스트</b>');await ui.locator('#catalog-save').click();
    await ui.waitForFunction(()=>document.querySelector('#catalog-message').textContent.includes('이름을 저장했습니다'));
    await ui.locator('#detail-setup summary').click();await ui.locator('#detail-query').click();await ui.locator('#detail-results').waitFor({state:'visible'});
    assert.equal(await ui.locator('#detail-views').innerText(),'100');assert.match(await ui.locator('#detail-content-body').innerText(),/80%/);assert.match(await ui.locator('#detail-content-body').innerText(),/5초/);
    assert.match(await ui.locator('#detail-content-body').innerText(),/100℃ 가열 설명 <b>테스트<\/b>/);
    assert.match(await ui.locator('#detail-content-body').innerText(),/dp01.jpg/);assert.equal(await ui.locator('#detail-content-body b').count(),0);
    assert.equal(await ui.locator('#detail-content-body img').count(),1);pass('catalog previews, filenames and safe saved aliases map split image rows to their original asset');
    await ui.screenshot({path:path.join(base,'..','detail-analysis-qa.png'),fullPage:true});
    assert.equal(await ui.locator('#app-nav [data-app-route="detail"]').getAttribute('aria-current'),'page');
    await ui.locator('#app-theme-toggle').click();assert.equal(await ui.locator('html').getAttribute('data-theme'),'light');
    for(const m of ['error','setup','zero']){mode=m;await ui.locator('#detail-refresh').click();await ui.waitForFunction(()=>!document.querySelector('#detail-refresh').disabled);assert.equal(await ui.locator('#detail-results').isVisible(),false);}
    assert.equal(await ui.evaluate(()=>window.injected),undefined);
    await ui.reload();await ui.mouse.move(900,700);await ui.keyboard.press('Escape');await ui.waitForFunction(()=>Array.from(document.querySelectorAll('#catalog-body .video-thumb img')).some(img=>img.src.startsWith('data:image/jpeg;base64,')));
    assert.equal(await ui.locator('.catalog-name').first().inputValue(),'100℃ 가열 설명 <b>테스트</b>');pass('blocked remote video has an upload fallback; saved thumbnails and names survive reload');
    await ui.setViewportSize({width:390,height:844});assert.ok(await ui.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));
    assert.deepEqual(errors,[]);pass('dashboard setup/snippet, real calculations, dark/light, mobile and safe empty/error states');
    console.log('Detail browser verification: '+checks+' checks passed.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
