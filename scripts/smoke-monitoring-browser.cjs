'use strict';
// Runs in release CI against an isolated synthetic store; never reads user records.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {chromium}=require(process.env.ROAS_PLAYWRIGHT_MODULE||'playwright');
const source=path.resolve(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'roas-monitoring-browser-')),base='http://127.0.0.1:3000';
const assets=['daily-monitoring.html','daily-monitoring.js','daily-monitoring.css','monitoring-import.js','monitoring-export.js','monitoring-extract.js','monitoring-collector.html','monitoring-collector.js'];
let child,browser;const errors=[],external=[];
const seed={source:'合成 browser verification',folders:[{id:'brand',name:'검증 폴더'}],products:[
  {id:'naver-101',platform:'naver',productId:'101',name:'검증 <상품>',brand:'검증 스토어',folderId:'brand',price:12000,shipping:0,reviews:12,rating:4.5,keywords:[{keyword:'검증 키워드',searchVolume:100},{keyword:'범위 밖 키워드',searchVolume:null}]},
  {id:'naver-102',platform:'naver',productId:'102',name:'두 번째 상품',keywords:[]},
  {id:'coupang-201',platform:'coupang',productId:'201',vendorItemId:'301',itemId:'401',name:'검증 쿠팡 상품',price:10000,wowPrice:8000,keywords:[{keyword:'쿠팡 키워드'}]}
],snapshots:[
  {productId:'naver-101',date:'2000-01-01',price:12000,shipping:0,reviews:10,rating:4.5,rollingSales7d:30,keywords:[{keyword:'검증 키워드',rank:3,groupRank:2,adRank:null,searchVolume:100},{keyword:'범위 밖 키워드',status:'outside',outsideLimit:80}]},
  {productId:'naver-101',date:'2000-01-02',price:12000,shipping:0,reviews:12,rating:4.5,rollingSales7d:35,keywords:[{keyword:'검증 키워드',rank:1,groupRank:1,searchVolume:110},{keyword:'범위 밖 키워드',status:'pending'}]},
  {productId:'coupang-201',date:'2000-01-02',price:10000,wowPrice:8000,reviews:0,keywords:[{keyword:'쿠팡 키워드',rank:6}]}
],reviews:[
  {id:'review-a',productId:'naver-101',date:'2000-01-02',rating:5,text:'<script>alert(1)</script> 실제 리뷰 내용',authorMasked:'ab***',monthUse:true,sourceOrder:0,videoUrls:['https://example.com/review.mp4']},
  {id:'review-b',productId:'naver-101',date:'2000-01-01',rating:2,text:'두 번째 리뷰',authorMasked:'xy***',sourceOrder:1}
],alerts:[
  {id:'alert-rank',kind:'rank',mode:'change',productId:'naver-101',date:'2000-01-02',keyword:'검증 키워드',oldRank:3,rank:1,oldStatus:'ranked',status:'ranked',createdAt:'2000-01-02T01:00:00.000Z',readAt:null},
  {id:'alert-review',kind:'review',productId:'naver-101',reviewId:'review-a',date:'2000-01-02',createdAt:'2000-01-02T01:01:00.000Z',readAt:null}
]};
async function request(route,body){const response=await fetch(base+'/api/monitoring/'+route,{...(body?{method:'POST',headers:{'content-type':'application/json','origin':base,'x-roas-local-action':'yes'},body:JSON.stringify(body)}:{})});const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));return result;}
async function mutation(page,route,action){const pending=page.waitForResponse(response=>response.url()===base+'/api/monitoring/'+route&&response.request().method()==='POST');await action();const response=await pending;assert.equal(response.status(),200,await response.text());await page.waitForFunction(()=>document.body.dataset.monitoringBusy!=='true');return response.json();}
async function download(page,selector){const pending=page.waitForEvent('download');await page.locator(selector).click();const item=await pending;assert.equal(await item.failure(),null);return{name:item.suggestedFilename(),bytes:fs.readFileSync(await item.path())};}
(async()=>{
  for(const name of ['server.js','package.json','public','vendor'])fs.cpSync(path.join(source,name),path.join(temp,name),{recursive:true});
  // An older updater may omit all new files; the server must still serve exact embedded assets.
  for(const name of assets)fs.rmSync(path.join(temp,'public',name));
  child=spawn(process.execPath,['-e',"global.fetch=async()=>{throw Error('External calls disabled')};require('./server').server.listen(3000,'127.0.0.1',()=>console.log('READY'));"],{cwd:temp,env:{...process.env,WEB_PASSWORD:'',HOST:'127.0.0.1',META_ACCESS_TOKEN:'',OPENAI_API_KEY:''},stdio:['ignore','pipe','pipe']});
  await new Promise((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(Error('Server startup timed out: '+log)),10000);child.stdout.on('data',data=>{log+=data;if(log.includes('READY')){clearTimeout(timer);resolve();}});child.stderr.on('data',data=>log+=data);child.on('error',reject);child.on('exit',code=>{if(code){clearTimeout(timer);reject(Error(log));}});});
  await request('import',{revision:0,...seed});
  browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
  const context=await browser.newContext({viewport:{width:1440,height:1050},locale:'ko-KR',timezoneId:'Asia/Seoul',acceptDownloads:true});
  await context.route('**/*',route=>{if(route.request().url().startsWith(base+'/'))return route.continue();external.push(route.request().url());return route.abort();});
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base+'/daily-monitoring.html');await page.waitForFunction(()=>document.querySelectorAll('.dm-card').length===2);
  assert.match(await page.locator('#dm-counts').textContent(),/등록 상품 수 2개/);assert.match(await page.locator('#dm-cards').textContent(),/검증 <상품>/);assert.equal(await page.locator('#dm-cards script').count(),0);
  await mutation(page,'product',()=>page.locator('[data-favorite="naver-101"]').click());await page.locator('#dm-favorites-only').check();assert.equal(await page.locator('.dm-card').count(),1);await page.locator('#dm-favorites-only').uncheck();
  await page.locator('#dm-search').fill('없는 상품');assert.equal(await page.locator('.dm-card').count(),0);await page.locator('#dm-search').fill('');assert.equal(await page.locator('.dm-card').count(),2);
  await page.locator('.dm-card-product[href="?product=naver-101"]').click();await page.locator('#dm-detail').waitFor({state:'visible'});
  assert.match(await page.locator('#dm-rank-table').textContent(),/80위 밖/);assert.match(await page.locator('#dm-rank-table').textContent(),/업데이트 중/);
  await mutation(page,'settings',()=>page.locator('#dm-orientation').selectOption('vertical'));assert.equal((await request('state')).settings.orientation,'vertical');
  await page.locator('.dm-options > summary').click();await mutation(page,'settings',()=>page.locator('[data-rank-option="ads"]').uncheck());assert.equal((await request('state')).settings.rankOptions.ads,false);
  await page.locator('.dm-keyword-accordion > summary').click();await page.locator('#dm-keyword-add').fill('새 키워드');await page.locator('#dm-keyword-add-button').click();
  await mutation(page,'settings',()=>page.locator('#dm-detail-zoom').click());assert.match(await page.locator('#dm-keyword-chips').textContent(),/새 키워드/);
  await mutation(page,'keywords',()=>page.locator('#dm-keyword-form button[type="submit"]').click());assert.equal((await request('state')).products.find(p=>p.id==='naver-101').keywords.length,3);
  const excel=await download(page,'#dm-export');assert.match(excel.name,/\.xlsx$/);assert.equal(excel.bytes.subarray(0,4).toString('hex'),'504b0304');assert.ok(excel.bytes.includes(Buffer.from('xl/worksheets/sheet1.xml')));assert.ok(!excel.bytes.includes(Buffer.from('vbaProject')));
  const ranks=await download(page,'#dm-export-csv');assert.match(ranks.bytes.toString('utf8'),/범위 밖 키워드/);
  await page.locator('[data-detail-tab="reviews"]').click();assert.equal(await page.locator('.dm-review-item').count(),2);assert.equal(await page.locator('.dm-review-item script').count(),0);assert.match(await page.locator('.dm-review-list').textContent(),/<script>alert\(1\)<\/script>/);
  await page.locator('#dm-review-stars').selectOption('5');assert.equal(await page.locator('.dm-review-item').count(),1);await page.locator('#dm-review-stars').selectOption('');
  await page.locator('#dm-review-media').selectOption('month');assert.equal(await page.locator('.dm-review-item').count(),1);await page.locator('#dm-review-media').selectOption('all');
  await page.locator('#dm-review-search').fill('두 번째');assert.equal(await page.locator('.dm-review-item').count(),1);await page.locator('#dm-review-search').fill('');
  const reviews=await download(page,'[data-review-csv]');assert.match(reviews.bytes.toString('utf8'),/리뷰ID/);assert.match(reviews.bytes.toString('utf8'),/review-a/);
  await page.locator('[data-detail-tab="sales"]').click();assert.match(await page.locator('#dm-metric-view').textContent(),/7일 구매 건수/);assert.match(await page.locator('#dm-metric-view').textContent(),/저장된 일별 판매량 자료가 없습니다/);
  await page.locator('#dm-alerts-open').click();assert.equal(await page.locator('.dm-alert-item').count(),2);await mutation(page,'alerts-ack',()=>page.locator('#dm-alerts-read-all').click());assert.equal(await page.locator('.dm-alert-item').count(),0);assert.ok((await request('state')).alerts.every(a=>a.readAt));await page.locator('#dm-alerts-dialog [data-close]').click();
  await page.locator('#dm-back').click();const backup=await download(page,'#dm-backup'),saved=JSON.parse(backup.bytes.toString('utf8'));assert.equal(saved.products.length,3);assert.equal(saved.reviews.length,2);assert.equal(saved.alerts.length,2);assert.equal(saved.snapshots.length,3);
  const imported='일자,마켓,상품ID,키워드,순위\n2000-01-03,naver,101,검증 키워드,2\n';await mutation(page,'import',()=>page.locator('#dm-file').setInputFiles({name:'검증.csv',mimeType:'text/csv',buffer:Buffer.from(imported)}));assert.equal((await request('state')).snapshots.length,4);
  await page.locator('[data-platform="coupang"]').click();assert.equal(await page.locator('.dm-card').count(),1);assert.match(await page.locator('.dm-card').textContent(),/10,000원/);assert.match(await page.locator('.dm-card').textContent(),/8,000원/);await page.locator('.dm-card-product').click();assert.equal(await page.locator('[data-detail-tab="sales"]').isVisible(),false);
  await page.locator('#dm-back').click();await page.locator('[data-platform="naver"]').click();await page.locator('.dm-card-product[href="?product=naver-102"]').click();await page.locator('#dm-edit').click();await mutation(page,'archive',()=>page.locator('#dm-archive').click());assert.equal(await page.locator('.dm-card').count(),1);
  await page.locator('#dm-folder-filter').selectOption('__archived');await page.locator('.dm-card-product').click();await mutation(page,'product',()=>page.locator('#dm-product-form button[type="submit"]').click());assert.equal((await request('state')).products.find(p=>p.id==='naver-102').archived,false);
  await page.locator('#dm-folder-filter').selectOption('');await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'mobile list has no outer horizontal overflow');await page.locator('.dm-card-product[href="?product=naver-101"]').click();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'mobile detail has no outer horizontal overflow');
  if(process.env.ROAS_MONITORING_SCREENSHOT)await page.screenshot({path:process.env.ROAS_MONITORING_SCREENSHOT,fullPage:true});
  await page.goto(base+'/monitoring-collector.html');await page.locator('#mc-form').waitFor();assert.match(await page.locator('#mc-status').textContent(),/대기|수집|연결/);assert.equal(new URL(await page.locator('.growth-navigation a[aria-current="page"]').getAttribute('href'),base).pathname,'/daily-monitoring.html');
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);console.log('PASS: monitoring embedded upgrade, cards/filtering, safe rendering, persisted keywords/settings, XLSX/CSV/JSON, import, reviews, rolling sales, alerts, archive/restore, mobile and collector navigation');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();if(child){child.kill();await new Promise(resolve=>{if(child.exitCode!==null)resolve();else child.once('exit',resolve);});}fs.rmSync(temp,{recursive:true,force:true});});
