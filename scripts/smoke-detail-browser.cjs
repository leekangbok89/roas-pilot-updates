'use strict';
// Synthetic pages only: every real analytics request is blocked.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.ROAS_PLAYWRIGHT_MODULE||'playwright');
const base=path.resolve(__dirname,'..'), tracker=fs.readFileSync(path.join(base,'public/detail-tracker.js'),'utf8');
const thumbnailVideo=Buffer.from('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','base64');
const {DETAIL_DEFAULTS,assembleDetailReport,assembleDetailPageReport,DETAIL_PAGE_METRICS,reconcileDetailCatalog}=require('../integrations/ga4/client.cjs');
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
    // Flush while still hidden so this assertion measures only hidden time.
    // Restoring visibility before pagehide can legitimately add a millisecond.
    await page.clock.runFor(20000);await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
    const after=(await events()).filter(e=>e[1]==='rp_content_time').reduce((s,e)=>s+e[2].rp_visible_ms,0);assert.equal(after,before);
    await page.evaluate(()=>{window.testHidden=false;document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('pageshow'));});await page.clock.runFor(1500);
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
    ui.on('pageerror',e=>errors.push(e.message));let saved={...DETAIL_DEFAULTS},mode='ready',reportRequests=[],inspectionOverride=null,catalog={productId:'458',contentVersion:'v1',items:[],importedAt:null};
    const raw={dimensionHeaders:['eventName','customEvent:rp_content_id','customEvent:rp_content_type'].map(name=>({name})),metricHeaders:['eventCount','customEvent:rp_visible_ms'].map(name=>({name})),rows:[['rp_detail_view','page','page','100','0'],['rp_content_view','image_001_p01','image','80','0'],['rp_content_time','image_001_p01','image','3','400000']].map(r=>({dimensionValues:r.slice(0,3).map(value=>({value})),metricValues:r.slice(3).map(value=>({value}))}))};
    const report=assembleDetailReport(raw,{since:'2026-10-19',until:'2026-10-25',productId:'458',contentVersion:'v1'},true);
    report.rows.push({...report.rows[0],id:'image_001_p02',views:40,reachRate:.4,averageVisibleSeconds:3,threeSeconds:20,threeRate:.5,clicks:2});
    const pageResponse=(dims,metrics,entries)=>({dimensionHeaders:dims.map(name=>({name})),metricHeaders:metrics.map(name=>({name})),rows:entries.map(([d,m])=>({dimensionValues:d.map(value=>({value})),metricValues:m.map(value=>({value:String(value)}))}))});
    report.trackingState='ready';report.pageAnalytics=assembleDetailPageReport({
      summary:pageResponse([],DETAIL_PAGE_METRICS,[[[],[240,180,4800,800,60]]]),
      daily:pageResponse(['date'],DETAIL_PAGE_METRICS,[[['20261025'],[240,180,4800,800,60]]]),
      events:pageResponse(['eventName'],['eventCount'],[[['page_view'],[240]],[['scroll'],[70]],[['add_to_cart'],[8]]])
    },report);
    await ui.route('**/*',async route=>{
      const url=new URL(route.request().url()),p=url.pathname;
      if(url.hostname==='wemamang.mycafe24.com'&&p==='/detail/dp01.jpg')return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="800" height="3000"><rect width="800" height="1000" fill="red"/><rect y="1000" width="800" height="2000" fill="blue"/></svg>'});
      if(url.hostname==='wemamang.mycafe24.com'&&p==='/detail/dp02.mp4')return route.fulfill({contentType:'video/mp4',headers:{'Access-Control-Allow-Origin':'*'},body:thumbnailVideo});
      if(url.hostname!=='127.0.0.1')return route.abort();
      if(p==='/api/ga4/status')return route.fulfill({json:{configured:true}});
      if(p==='/api/ga4/detail-settings'){if(route.request().method()==='POST')saved=route.request().postDataJSON();return route.fulfill({json:saved});}
      if(p==='/api/ga4/detail-catalog'){
        if(route.request().method()==='POST'){
          const input=route.request().postDataJSON();
          if(input.action==='inspect')return route.fulfill({json:inspectionOverride || {...catalog,state:'matching',savedCount:catalog.items.length,currentCount:catalog.items.length,supplementalItems:[],changedIds:[]}});
          if(input.action==='image-preview'){const item=catalog.items.find(item=>item.id===input.id&&item.url===input.url);item.imagePreview={data:input.data,width:input.width,height:input.height,url:input.url};return route.fulfill({json:catalog});}
          if(input.action==='import')catalog.items=[{id:'image_001',type:'image',url:'https://wemamang.mycafe24.com/detail/dp01.jpg',filename:'dp01.jpg',alt:'상세 이미지',name:''},{id:'video_001',type:'video',url:'https://wemamang.mycafe24.com/detail/dp02.mp4',filename:'dp02.mp4',name:''},{id:'video_002',type:'video',url:'https://wemamang.mycafe24.com/detail/blocked.mp4',filename:'blocked.mp4',name:''}];
          else if(input.action==='thumbnail')catalog.items.find(item=>item.id===input.id).thumbnail=input.thumbnail;
          else for(const n of input.names)catalog.items.find(item=>item.id===n.id).name=n.name;
        }
        return route.fulfill({json:catalog});
      }
      if(p==='/api/ga4/detail-report'){reportRequests.push({mode,url:url.toString()});return mode==='error'?route.fulfill({status:502,json:{error:'합성 오류 <img src=x onerror="window.injected=1">'}}):route.fulfill({json:mode==='setup'?{...report,trackingState:'setup_required',missing:['rp_content_id'],rows:[]}:mode==='zero'?{...report,trackingState:'no_data',rows:[]}:report});}
      const file=path.join(base,'public',p.slice(1));if(fs.existsSync(file))return route.fulfill({path:file});return route.fulfill({status:404,body:'missing'});
    });
    await ui.goto('http://127.0.0.1:3000/detail-analysis.html');await ui.mouse.move(900,700);await ui.keyboard.press('Escape');
    await ui.waitForFunction(()=>document.querySelector('#detail-connection-status').textContent.includes('연결됨'));
    await ui.locator('#detail-page-results').waitFor({state:'visible'});
    assert.ok(reportRequests.length>0,'Connected page must load its data automatically');
    assert.match(await ui.locator('#detail-page-kpis').innerText(),/240회/);
    assert.match(await ui.locator('#detail-page-kpis').innerText(),/180명/);
    assert.match(await ui.locator('#detail-page-kpis').innerText(),/20초/);
    assert.equal(await ui.locator('#detail-page-daily tr').count(),7);
    await ui.locator('#detail-page-event-panel > summary').click();
    assert.match(await ui.locator('#detail-page-events').innerText(),/장바구니 담기 · add_to_cart/);
    await ui.locator('#detail-page-event-panel > summary').click();
    await ui.locator('#detail-metric-settings > summary').click();
    await ui.locator('#detail-metric-options input[value="eventCount"]').uncheck();
    assert.equal(await ui.locator('#detail-page-kpis article').count(),5);
    assert.equal(await ui.locator('#detail-page-daily-head th').count(),6);
    await ui.locator('#detail-metric-settings > summary').click();
    pass('existing GA4 page records auto-load with period-distinct visitors, engagement, daily rows, events and selectable metrics');
    assert.equal(await ui.locator('#detail-reference').getAttribute('open'),null);
    assert.equal(await ui.locator('#content-catalog').getAttribute('open'),null);
    assert.equal(await ui.locator('#install-code').isVisible(),false);
    assert.equal(await ui.locator('#ad-spend-breakdown').isVisible(),false);
    assert.equal(await ui.locator('#app-main > :last-child').getAttribute('id'),'detail-reference');
    assert.equal(await ui.locator('#detail-report-form').isVisible(),true);
    await ui.locator('#detail-reference > summary').click();await ui.locator('#install-output').waitFor({state:'visible'});
    assert.equal(await ui.locator('#ad-spend-breakdown,.ad-spend-heading,[data-ad-spend-host]').count(),0);
    pass('removed advertising-spend block stays absent; setup/code remains collapsed at the bottom and report controls remain visible');
    const snippet=await ui.locator('#install-code').inputValue();assert.ok(snippet.includes('G-RZF6S41CF0'));assert.ok(!snippet.includes('127.0.0.1'));new Function(snippet.slice(9,-9));
    await ui.locator('#detail-clarity').fill('abc123456');await ui.locator('#settings-save').click();await ui.waitForFunction(()=>document.querySelector('#install-code').value.includes('abc123456'));
    assert.match(await ui.locator('#clarity-dashboard').getAttribute('href'),/abc123456/);
    await ui.locator('#content-catalog > summary').click();await ui.locator('#catalog-import').click();await ui.locator('.catalog-name').first().waitFor();
    assert.equal(await ui.locator('#catalog-body .catalog-stats').count(),0);
    assert.ok(await ui.evaluate(()=>document.querySelector('#detail-content-results').compareDocumentPosition(document.querySelector('#detail-page-results')) & Node.DOCUMENT_POSITION_FOLLOWING));
    assert.equal(await ui.locator('#catalog-body img[alt="상세 이미지"]').getAttribute('src'),'https://wemamang.mycafe24.com/detail/dp01.jpg');
    assert.equal(await ui.locator('#catalog-body video').count(),0,'No blank video player should be displayed');
    await ui.waitForFunction(()=>Array.from(document.querySelectorAll('#catalog-body .video-thumb img')).some(img=>img.src.startsWith('data:image/jpeg;base64,')));
    await ui.waitForFunction(()=>document.querySelector('#catalog-body .video-thumb .thumb-message').textContent==='');
    await ui.locator('.catalog-name').first().fill('수정 중인 이름');
    await ui.locator('#detail-refresh').click();await ui.waitForFunction(()=>!document.querySelector('#detail-refresh').disabled);
    assert.equal(await ui.locator('.catalog-name').first().inputValue(),'수정 중인 이름','Refreshing statistics must preserve unsaved names');
    await ui.locator('#catalog-body .video-thumb input[type=file]').first().setInputFiles({name:'local-video.mp4',mimeType:'video/mp4',buffer:thumbnailVideo});
    await ui.waitForFunction(()=>document.querySelector('#catalog-body .thumb-message').textContent.includes('썸네일 저장 완료'));
    assert.equal(await ui.locator('.catalog-name').first().inputValue(),'수정 중인 이름','Thumbnail updates must preserve unsaved names');
    assert.ok(catalog.items[1].thumbnail.startsWith('data:image/jpeg;base64,'));
    await ui.locator('#catalog-body .video-thumb').nth(1).scrollIntoViewIfNeeded();
    await ui.waitForFunction(()=>Array.from(document.querySelectorAll('#catalog-body .thumb-placeholder')).some(node=>node.textContent==='썸네일 등록 필요'));
    assert.equal(await ui.locator('#catalog-body video').count(),0);
    pass('automatic video frame thumbnails and local-video uploads persist without clearing unsaved names');
    await ui.locator('.catalog-name').first().fill('100℃ 가열 설명 <b>테스트</b>');await ui.locator('#catalog-save').click();
    await ui.waitForFunction(()=>document.querySelector('#catalog-message').textContent.includes('이름을 저장했습니다'));
    await ui.locator('#detail-reference > summary').click();await ui.locator('#content-catalog > summary').click();
    await ui.locator('#detail-since').fill(report.since);await ui.locator('#detail-until').fill(report.until);
    await ui.locator('#detail-query').click();await ui.locator('#detail-results').waitFor({state:'visible'});
    assert.equal(await ui.locator('#detail-views').innerText(),'100');assert.match(await ui.locator('#detail-content-body').innerText(),/80%/);assert.match(await ui.locator('#detail-content-body').innerText(),/5초/);
    assert.match(await ui.locator('#detail-content-body').innerText(),/100℃ 가열 설명 <b>테스트<\/b>/);
    assert.match(await ui.locator('#detail-content-body').innerText(),/dp01.jpg/);assert.equal(await ui.locator('#detail-content-body b').count(),0);
    assert.equal(await ui.locator('#detail-content-body img').count(),2);pass('catalog previews, filenames and safe saved aliases map split image rows to their original asset');
    await ui.locator('#detail-content-body img').first().scrollIntoViewIfNeeded();
    await ui.waitForFunction(()=>document.querySelector('#detail-content-body img').naturalHeight===3000);
    assert.equal(await ui.locator('#detail-content-body .image-part-preview').first().evaluate(el=>el.style.height),'137.5px');
    assert.equal(await ui.locator('#detail-content-body img').nth(1).evaluate(el=>el.style.top),'-137.5px');
    await ui.screenshot({path:path.join(base,'..','detail-analysis-qa.png'),fullPage:true});
    assert.equal(await ui.locator('#app-nav [data-app-route="detail"]').getAttribute('aria-current'),'page');
    await ui.locator('#app-theme-toggle').click();assert.equal(await ui.locator('html').getAttribute('data-theme'),'light');
    for(const m of ['error','setup','zero']){
      mode=m;
      const count=reportRequests.length;
      await ui.locator('#detail-refresh').click();
      try{
        await ui.waitForFunction(()=>!document.querySelector('#detail-refresh').disabled,null,{timeout:8000});
      }catch(error){
        const state=await ui.evaluate(()=>({
          disabled:document.querySelector('#detail-refresh').disabled,
          status:document.querySelector('#detail-status').textContent,
          reportValidity:document.querySelector('#detail-report-form').checkValidity(),
          dateSince:document.querySelector('#detail-since').value,
          dateUntil:document.querySelector('#detail-until').value
        }));
        throw new Error('Detail refresh mode '+m+' stuck: '+JSON.stringify({state,requests:reportRequests.slice(count)}),{cause:error});
      }
      assert.ok(reportRequests.length>count,'Mode '+m+' must issue one explicit refresh request');
      assert.equal(await ui.locator('#detail-results').isVisible(),false);
      assert.doesNotMatch(await ui.locator('#detail-content-body').textContent(),/80%/,'Old statistics must be cleared on an unsuccessful refresh');
      assert.equal(await ui.locator('#detail-page-results').isVisible(),m!=='error');
      if(m!=='error'){
        assert.match(await ui.locator('#detail-page-kpis').innerText(),/240회/);
        assert.equal(await ui.locator('#detail-tracking-note').isVisible(),true);
        assert.equal(await ui.locator('#detail-reference').getAttribute('open'),null,'Optional setup must not expand over the native data');
      }
    }
    assert.equal(await ui.evaluate(()=>window.injected),undefined);
    await ui.reload();await ui.mouse.move(900,700);await ui.keyboard.press('Escape');await ui.locator('#content-catalog > summary').click();await ui.locator('#catalog-body .video-thumb').first().scrollIntoViewIfNeeded();await ui.waitForFunction(()=>Array.from(document.querySelectorAll('#catalog-body .video-thumb img')).some(img=>img.src.startsWith('data:image/jpeg;base64,')));
    assert.equal(await ui.locator('#detail-reference').getAttribute('open'),null,'Reference panel starts collapsed again after reload');
    assert.equal(await ui.locator('.catalog-name').first().inputValue(),'100℃ 가열 설명 <b>테스트</b>');pass('blocked remote video has an upload fallback; saved thumbnails and names survive reload');
    assert.equal(await ui.locator('#detail-page-kpis article').count(),5,'Selected native metrics survive reload');
    await ui.setViewportSize({width:390,height:844});assert.ok(await ui.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));
    // Audit every saved image, including offscreen GIFs and files without any GA4 rows.
    await ui.setViewportSize({width:1440,height:1000});
    var recoverThree = false, imageRequests = new Set();
    await ui.route('https://wemamang.mycafe24.com/detail/audit-*', async route => {
      var n = Number(new URL(route.request().url()).pathname.match(/audit-(\d+)/)[1]); imageRequests.add(n);
      if(n === 3 && !recoverThree)return route.fulfill({contentType:'text/html',body:'<html>Image server verification response</html>'});
      if(n === 7)return route.abort();
      if(n === 11)return route.fulfill({status:404,body:'missing image'});
      if(n === 14)return; // Pending image: the audit must finish with an explicit timeout.
      if(n === 6)return route.fulfill({contentType:'image/gif',body:Buffer.from('R0lGODdhyABkAIEAAACAAAAAAAAAAAAAACwAAAAAyABkAEAI5AABCBxIsKDBgwgTKlzIsKHDhxAjSpxIsaLFixgzatzIsaPHjyBDihxJsqTJkyhTqlzJsqXLlzBjypxJs6bNmzhz6tzJs6fPn0CDCh1KtKjRo0iTKl3KtKnTp1CjSp1KtarVq1izat3KtavXr2DDih1LtqzZs2jTql3Ltq3bt3Djyp1Lt67du3jz6t3Lt6/fv4ADCx5MuLDhw4gTK17MuLHjx5AjS55MubLly5gza97MubPnz6BDix5NurTp06hTq17NurXr17Bjy55Nu7bt27hz697Nu7fv38CDCx9OvLjx42QDAgA7','base64')});
      return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="800" height="500" fill="green"/></svg>'});
    });
    catalog.items=Array.from({length:21},(_,i)=>({id:'image_'+String(i+1).padStart(3,'0'),type:'image',url:i===19?'':'https://wemamang.mycafe24.com/detail/audit-'+(i+1)+(i===5?'.gif':'.jpg'),filename:'audit-'+(i+1),name:'저장 이름 '+(i+1)}));
    mode='ready';report.rows=catalog.items.map(item=>({...report.rows[0],id:item.id+(item.id==='image_018'?'_p03':'_p01')}));
    await ui.clock.install();await ui.reload();
    await ui.waitForFunction(()=>document.querySelector('#image-check-status').textContent.includes('확인 20/21'));
    await ui.clock.runFor(16000);
    await ui.waitForFunction(()=>document.querySelector('#image-check-status').textContent.includes('확인 21/21'));
    assert.match(await ui.locator('#image-check-status').innerText(),/정상 16개 · 확인 필요 5개/);
    assert.equal(imageRequests.size,20,'Every linked image must be checked even when offscreen');
    var failures=await ui.locator('#image-check-list').innerText();
    for(const n of [3,7,11,14,20])assert.match(failures,new RegExp('이미지 '+n+' ·'));
    assert.match(failures,/응답 시간 초과/);assert.match(failures,/파일 연결 없음/);
    var rows=ui.locator('#detail-content-body tr');
    await rows.nth(2).locator('.image-preview-link').scrollIntoViewIfNeeded();
    await ui.waitForFunction(()=>document.querySelectorAll('#detail-content-body tr')[2].textContent.includes('이미지 로딩 실패'));
    assert.equal(await rows.nth(2).locator('img').isVisible(),false);
    assert.match(await rows.nth(2).innerText(),/원본 열기/);
    assert.match(await rows.nth(19).innerText(),/파일 주소 없음/);
    await rows.nth(17).locator('img').scrollIntoViewIfNeeded();
    await ui.waitForFunction(()=>document.querySelectorAll('#detail-content-body tr')[17].textContent.includes('구간 불일치'));
    assert.equal(await rows.nth(17).locator('img').isVisible(),true,'Stale section must show the full original with a clear warning');
    await rows.nth(5).locator('img').scrollIntoViewIfNeeded();
    await ui.waitForFunction(()=>document.querySelectorAll('#detail-content-body tr')[5].querySelector('img').naturalWidth===200);
    await ui.locator('#content-catalog > summary').click();
    await ui.locator('.catalog-name').first().fill('저장 전 편집 중');
    recoverThree=true;
    await ui.locator('#image-check-retry').click();
    await ui.waitForFunction(()=>document.querySelector('#image-check-status').textContent.includes('확인 20/21'));
    await ui.clock.runFor(16000);
    await ui.waitForFunction(()=>document.querySelector('#image-check-status').textContent.includes('확인 21/21'));
    assert.match(await ui.locator('#image-check-status').innerText(),/정상 17개 · 확인 필요 4개/);
    assert.doesNotMatch(await ui.locator('#image-check-list').innerText(),/이미지 3 ·/);
    assert.equal(await ui.locator('.catalog-name').first().inputValue(),'저장 전 편집 중','Retry must preserve unsaved names');
    await ui.locator('#content-catalog > summary').click();
    await rows.nth(2).locator('img').scrollIntoViewIfNeeded();
    await ui.waitForFunction(()=>document.querySelectorAll('#detail-content-body tr')[2].querySelector('img').naturalWidth===800);
    assert.equal(await rows.nth(2).locator('img').isVisible(),true);
    pass('all 21 images and GIFs audited, failed HTML/404/network/timeout/missing URLs identified, stale sections remain visible and retry preserves names');
    await ui.clock.resume();
    var legacy=Array.from({length:20},(_,i)=>({id:'image_'+String(i+1).padStart(3,'0'),type:'image',url:'https://wemamang.mycafe24.com/detail/original-'+(i+1)+'.jpg',filename:i===2?'dp07.jpg':i===19?'dp27.jpg':'original-'+(i+1)+'.jpg',name:''}));
    catalog={productId:'458',contentVersion:'v1',items:legacy};
    var current={...catalog,items:[{id:'image_001',type:'image',url:'https://wemamang.mycafe24.com/detail/guide.jpg'},...legacy.map((item,i)=>({...item,id:'image_'+String(i+2).padStart(3,'0')}))]};
    inspectionOverride={...current,...reconcileDetailCatalog(catalog,current)};
    assert.equal(inspectionOverride.supplementalItems[0].id,'image_021');
    var originalReportRow=report.rows[0];report.rows=['image_003_p01','image_003_p02','image_021_p01','image_021_p02'].map(id=>({...originalReportRow,id}));mode='ready';
    await ui.route('https://wemamang.mycafe24.com/detail/original-*',route=>route.fulfill({contentType:'image/svg+xml',body:route.request().url().endsWith('original-3.jpg')?'<svg xmlns="http://www.w3.org/2000/svg" width="860" height="1"/>':'<svg xmlns="http://www.w3.org/2000/svg" width="860" height="2000"><rect width="860" height="2000" fill="tan"/></svg>'}));
    await ui.reload();
    await ui.waitForFunction(()=>document.querySelector('#catalog-layout-status').textContent.includes('구성 변경 감지'));
    assert.match(await ui.locator('#detail-content-body').innerText(),/dp27.jpg/);
    assert.equal(await ui.locator('#detail-content-body tr').nth(2).locator('.image-preview-link').getAttribute('href'),'https://wemamang.mycafe24.com/detail/original-20.jpg');
    assert.match(await ui.locator('#detail-content-body tr').nth(2).innerText(),/신규 번호/);
    await ui.locator('#detail-content-body tr').first().locator('.image-preview-link').scrollIntoViewIfNeeded();
    await ui.waitForFunction(()=>document.querySelector('#detail-content-body tr').textContent.includes('임시 이미지'));
    await ui.locator('#content-catalog > summary').click();await ui.locator('.catalog-name').first().fill('저장 전 원본 복구 테스트');
    var sourceImage=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="860" height="2000"><rect width="860" height="1000" fill="red"/><rect y="1000" width="860" height="1000" fill="blue"/></svg>');
    await ui.locator('#detail-content-body .image-original-upload input').first().setInputFiles({name:'dp07.svg',mimeType:'image/svg+xml',buffer:sourceImage});
    await ui.waitForFunction(()=>document.querySelector('#detail-content-body .image-original-status').textContent.includes('860×2000px · 2구간'));
    assert.equal(await ui.locator('.catalog-name').first().inputValue(),'저장 전 원본 복구 테스트');
    assert.equal(catalog.items[2].imagePreview.height,2000);assert.equal(catalog.items[2].imagePreview.width,860);
    await ui.locator('#content-catalog > summary').click();
    await ui.locator('#detail-content-body tr').nth(1).locator('img').scrollIntoViewIfNeeded();
    await ui.waitForFunction(()=>Array.from(document.querySelectorAll('#detail-content-body tr')).slice(0,2).every(row=>row.querySelector('img').naturalHeight===240&&!row.textContent.includes('구간 불일치')));
    assert.ok(await ui.locator('#detail-content-body tr').nth(1).locator('img').evaluate(el=>parseFloat(el.style.top)<0));
    await ui.reload();
    await ui.waitForFunction(()=>document.querySelector('#catalog-layout-status').textContent.includes('구성 변경 감지')&&!document.querySelector('#detail-query').disabled);
    await ui.locator('#detail-content-body tr').nth(1).locator('img').scrollIntoViewIfNeeded();
    await ui.waitForFunction(()=>document.querySelectorAll('#detail-content-body tr')[1].querySelector('img').src.startsWith('data:image/jpeg;base64,'));
    assert.doesNotMatch(await ui.locator('#detail-content-body tr').nth(1).innerText(),/구간 불일치/);
    pass('inserted guide resolves missing image 21 to its proven file while original upload restores both 860×2000 sections across reload without changing stats or unsaved names');
    assert.deepEqual(errors,[]);pass('dashboard setup/snippet, real calculations, dark/light, mobile and safe empty/error states');
    console.log('Detail browser verification: '+checks+' checks passed.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
