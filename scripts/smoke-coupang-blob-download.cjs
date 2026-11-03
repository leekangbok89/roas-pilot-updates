'use strict';
const assert=require('node:assert/strict'),http=require('node:http'),path=require('node:path');
const {chromium}=require(process.env.ROAS_PLAYWRIGHT_MODULE||'playwright');
const bridge=path.resolve(__dirname,'../browser-extensions/coupang-collector/download-bridge.js');
const filename='A00836776_pa_daily_campaign_20261102_20261102.xlsx';
let browser;const server=http.createServer((req,res)=>{res.setHeader('content-type','text/html; charset=utf-8');res.end('<!doctype html><title>Local Blob fixture</title><body>Report download fixture</body>');});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
 const context=await browser.newContext({acceptDownloads:true});await context.addInitScript({path:bridge});const page=await context.newPage();await page.goto(origin);
 await page.evaluate(()=>{
  window.responses=[];window.addEventListener('message',event=>{if(event.source===window&&event.origin===location.origin&&event.data?.source==='ROAS_COUPANG_BLOB_RESPONSE')window.responses.push(event.data);});
  let id=0;window.requestBlob=(kind,extra={})=>new Promise(resolve=>{
   const request={source:'ROAS_COUPANG_BLOB_REQUEST',id:'request-'+(++id),captureId:'capture-1',kind,...extra};
   const listener=event=>{if(event.source===window&&event.origin===location.origin&&event.data?.source==='ROAS_COUPANG_BLOB_RESPONSE'&&event.data.id===request.id){clearTimeout(timer);window.removeEventListener('message',listener);resolve(event.data);}};
   const timer=setTimeout(()=>{window.removeEventListener('message',listener);resolve(null);},3000);window.addEventListener('message',listener);window.postMessage(request,location.origin);
  });
 });
 const read=async extra=>page.evaluate(({filename,...extra})=>window.requestBlob('read',{url:window.reportUrl,filename,...extra}),{filename,...extra});
 const arm=async extra=>page.evaluate(extra=>window.requestBlob('arm',{type:'pa',since:'2026-11-02',until:'2026-11-02',...extra}),extra||{});
 let result=await read();assert.equal(result.ok,false);assert.equal(result.code,'CAPTURE_MISSING');assert.equal((await arm()).ok,true);
 const expected=Buffer.from([80,75,3,4,0,255,128,13,10,65,66,67]);const observed=page.waitForEvent('download');
 await page.evaluate(({data,filename})=>{
  const blob=new Blob([new Uint8Array(data)],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});window.reportUrl=URL.createObjectURL.call(URL,blob);
  const link=document.createElement('a');link.href=window.reportUrl;link.download=filename;document.body.append(link);link.click();URL.revokeObjectURL(window.reportUrl);link.remove();
 },{data:[...expected],filename});
 const downloaded=await observed;assert.equal(downloaded.suggestedFilename(),filename,'native anchor download is not suppressed');
 result=await read();assert.equal(result.ok,true);assert.equal(result.bytes,expected.length);assert.deepEqual(Buffer.from(result.data,'base64'),expected,'retained Blob bytes survive immediate native revoke');
 assert.equal(await page.evaluate(async()=>{try{await fetch(window.reportUrl);return false;}catch{return true;}}),true,'the original blob URL really was revoked');
 assert.equal(await page.evaluate(()=>{try{URL.createObjectURL({});return false;}catch(error){return error instanceof TypeError;}}),true,'native createObjectURL errors are preserved');
 for(const extra of [{filename:'A00836776_nca_daily_campaign_20261102_20261102.xlsx'},{filename:'A00836776_pa_daily_campaign_20261101_20261101.xlsx'},{filename:'C:\\Downloads\\'+filename},{captureId:'wrong-capture'},{type:'nca'},{url:'blob:https://unrelated.invalid/not-a-report'}]){
  result=await read(extra);assert.equal(result.ok,false,JSON.stringify(extra));assert.equal(result.code,'INVALID_REPORT');
 }
 await page.evaluate(()=>window.requestBlob('release',{url:window.reportUrl}));assert.equal((await read()).code,'CAPTURE_MISSING');
 // Some report UIs create and cache the Blob URL before the collector is armed.
 // The anchor hook starts only a same-origin Blob read before native click/revoke.
 await page.evaluate(()=>window.requestBlob('release'));
 await page.evaluate(data=>{window.preCreatedUrl=URL.createObjectURL(new Blob([new Uint8Array(data)]));},[...expected]);
 assert.equal((await arm({captureId:'pre-created'})).ok,true);const preCreatedDownload=page.waitForEvent('download');
 await page.evaluate(filename=>{const anchor=document.createElement('a');anchor.href=window.preCreatedUrl;anchor.download=filename;document.body.append(anchor);anchor.click();URL.revokeObjectURL(window.preCreatedUrl);anchor.remove();},filename);
 assert.equal((await preCreatedDownload).suggestedFilename(),filename);
 result=await page.evaluate(filename=>window.requestBlob('read',{captureId:'pre-created',url:window.preCreatedUrl,filename}),filename);assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.bytes,expected.length);assert.deepEqual(Buffer.from(result.data,'base64'),expected,'pre-created URL is captured before immediate revocation');
 await page.evaluate(()=>window.requestBlob('release',{captureId:'pre-created'}));
 await page.evaluate(data=>{window.wrongAnchorUrl=URL.createObjectURL(new Blob([new Uint8Array(data)]));},[...expected]);
 assert.equal((await arm({captureId:'wrong-anchor'})).ok,true);const wrongAnchorDownload=page.waitForEvent('download');
 await page.evaluate(()=>{const anchor=document.createElement('a');anchor.href=window.wrongAnchorUrl;anchor.download='A00836776_nca_daily_campaign_20261102_20261102.xlsx';document.body.append(anchor);anchor.click();URL.revokeObjectURL(window.wrongAnchorUrl);anchor.remove();});
 await wrongAnchorDownload;
 result=await page.evaluate(filename=>window.requestBlob('read',{captureId:'wrong-anchor',url:window.wrongAnchorUrl,filename}),filename);assert.equal(result.code,'CAPTURE_MISSING','wrong filename anchor is not captured even when the later read supplies a correct filename');
 assert.equal((await arm({captureId:'capture-2'})).ok,true);
 await page.evaluate(()=>{window.largeUrl=URL.createObjectURL(new Blob([new Uint8Array(8*1024*1024+1)]));URL.revokeObjectURL(window.largeUrl);});
 result=await page.evaluate(filename=>window.requestBlob('read',{captureId:'capture-2',url:window.largeUrl,filename}),filename);assert.equal(result.code,'TOO_LARGE');
 assert.equal((await arm()).ok,true);await page.evaluate(()=>{window.smallUrls=Array.from({length:3},(_,i)=>URL.createObjectURL(new Blob([new Uint8Array([i+1])])));window.smallUrls.forEach(url=>URL.revokeObjectURL(url));});
 result=await page.evaluate(filename=>window.requestBlob('read',{url:window.smallUrls[0],filename}),filename);assert.equal(result.code,'CAPTURE_MISSING','only two Blob references can remain');
 result=await page.evaluate(filename=>window.requestBlob('read',{url:window.smallUrls[2],filename}),filename);assert.equal(result.ok,true);assert.deepEqual(Buffer.from(result.data,'base64'),Buffer.from([3]));
 const before=await page.evaluate(()=>window.responses.length);
 await page.evaluate(()=>{
  const request={source:'ROAS_COUPANG_BLOB_REQUEST',id:'untrusted',captureId:'capture-1',kind:'arm',type:'pa',since:'2026-11-02',until:'2026-11-02'};
  window.dispatchEvent(new MessageEvent('message',{data:request,origin:location.origin,source:null}));
  window.dispatchEvent(new MessageEvent('message',{data:request,origin:'https://unrelated.invalid',source:window}));
  window.postMessage({...request,id:'malformed',since:'2026-02-30'},location.origin);
 });
 await page.waitForFunction(n=>window.responses.length===n+1,before);assert.equal(await page.evaluate(()=>window.responses.at(-1).code),'INVALID_REPORT','only the same-window malformed report receives a bounded rejection');assert.equal(await page.evaluate(()=>window.responses.some(response=>response.id==='untrusted')),false);
 await page.evaluate(()=>{const now=Date.now();Date.now=()=>now+5*60000+1;});
 result=await page.evaluate(filename=>window.requestBlob('read',{url:window.smallUrls[2],filename}),filename);assert.equal(result.code,'CAPTURE_MISSING','capture expires after five minutes');
 // Exercise the real isolated report-page adapter's asynchronous arm/read/release
 // protocol as well as the MAIN-world helper. The extension API is stubbed, but
 // the report-page source, window message bridge and native download are real.
 const integrated=await context.newPage();await integrated.goto(origin);
 await integrated.evaluate(()=>{document.body.innerHTML='<table><tbody><tr data-report-id="integrated-new-report"><td>2026-11-02 ~ 2026-11-02 일별 모든 캠페인 생성 완료</td><td><button id="download">다운로드</button></td></tr></tbody></table>';});
 await integrated.evaluate(({data,filename})=>{
  window.armAcknowledged=false;window.clickedWithoutArm=false;
  window.addEventListener('message',event=>{if(event.source===window&&event.origin===location.origin&&event.data?.source==='ROAS_COUPANG_BLOB_RESPONSE'&&event.data.kind==='arm'&&event.data.captureId==='integrated-1'&&event.data.ok)window.armAcknowledged=true;});
  window.chrome={runtime:{id:'TEST',onMessage:{addListener(handler){window.sendExtension=(message,senderId='TEST')=>new Promise(resolve=>{const accepted=handler(message,{id:senderId},resolve);if(!accepted)resolve(null);});}}}};
  document.getElementById('download').onclick=()=>{
   window.clickedWithoutArm=!window.armAcknowledged;
   window.integratedUrl=URL.createObjectURL(new Blob([new Uint8Array(data)],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
   const anchor=document.createElement('a');anchor.href=window.integratedUrl;anchor.download=filename;document.body.append(anchor);anchor.click();URL.revokeObjectURL(window.integratedUrl);anchor.remove();
  };
 },{data:[...expected],filename});
 await integrated.addScriptTag({path:path.resolve(__dirname,'../browser-extensions/coupang-collector/report-page.js')});
 const integratedDownload=integrated.waitForEvent('download');
 result=await integrated.evaluate(()=>window.sendExtension({kind:'step',allowCreate:false,job:{type:'pa',since:'2026-11-02',until:'2026-11-02',confirmedAllCampaigns:true,baselineReports:[],captureId:'integrated-1'}}));
 assert.equal(result.downloading,true,JSON.stringify(result));assert.equal(result.captureId,'integrated-1');assert.equal(result.phase,'download');assert.equal(await integrated.evaluate(()=>window.clickedWithoutArm),false,'report-page waits for arm ACK before clicking');assert.equal((await integratedDownload).suggestedFilename(),filename);
 const fileRequest={kind:'read-report-file',captureId:'integrated-1',type:'pa',since:'2026-11-02',until:'2026-11-02',filename,url:await integrated.evaluate(()=>window.integratedUrl)};
 result=await integrated.evaluate(request=>window.sendExtension(request),fileRequest);assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.bytes,expected.length);assert.deepEqual(Buffer.from(result.data,'base64'),expected,'actual report adapter transfers the retained Blob byte-exactly');
 result=await integrated.evaluate(request=>window.sendExtension({...request,type:'nca'}),fileRequest);assert.equal(result.code,'INVALID_REPORT');
 assert.equal(await integrated.evaluate(request=>window.sendExtension(request,'OTHER'),fileRequest),null,'wrong extension sender cannot read retained bytes');
 result=await integrated.evaluate(request=>window.sendExtension({kind:'release-report-file',captureId:request.captureId,url:request.url}),fileRequest);assert.equal(result.ok,true);
 result=await integrated.evaluate(request=>window.sendExtension(request),fileRequest);assert.equal(result.code,'CAPTURE_MISSING');
 console.log('PASS local MAIN-world Blob capture and actual report-page arm/read/release integration: native click/revoke, byte-exact read, request validation, two-reference and 8MiB bounds, release and expiry. No live Coupang DOM or account exercised.');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await browser?.close();await new Promise(resolve=>server.close(resolve));});
