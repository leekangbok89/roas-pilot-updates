'use strict';
const LOCAL='http://127.0.0.1:3000/monitoring-collector.html',KEY='roasMonitoringCollector';let busy=false,token=null;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const read=async()=>(await chrome.storage.local.get(KEY))[KEY]||{};
const write=async value=>chrome.storage.local.set({[KEY]:{...await read(),...value}});
const nonce=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('');
function localTab(tab){try{const u=new URL(tab?.url);return /^http:\/\/(127\.0\.0\.1|localhost):3000$/.test(u.origin)&&u.pathname==='/monitoring-collector.html';}catch{return false;}}
function sourceTab(url){try{const u=new URL(url);return u.origin==='https://sellha.kr'&&/^\/monitoring\/day\/(naver|coupang)$/.test(u.pathname)&&!u.username&&!u.password&&!u.hash;}catch{return false;}}
async function receiver(){const s=await read();let tab;try{tab=await chrome.tabs.get(s.receiverTab);}catch{}if(!localTab(tab)){tab=await chrome.tabs.create({url:LOCAL,active:false});await write({receiverTab:tab.id});}for(let n=0;n<20;n++){try{const r=await chrome.tabs.sendMessage(tab.id,{kind:'ping'});if(r?.ok)return tab.id;}catch{}await pause(250);}throw Error('이 PC의 ROAS Pilot 수집 연결 화면을 열어 주세요.');}
async function bridge(operation,payload={}){const id=crypto.randomUUID(),r=await chrome.tabs.sendMessage(await receiver(),{kind:'bridge',id,nonce:nonce(),operation,payload});if(!r?.ok)throw Error(r?.error||'로컬 수집 연결 응답이 없습니다.');return r.result;}
function nextDaily(hour,minute,now=Date.now()){const kst=new Date(now+9*3600000),day=Date.UTC(kst.getUTCFullYear(),kst.getUTCMonth(),kst.getUTCDate(),hour,minute)-9*3600000;return day>now?day:day+86400000;}
async function schedule(s){if(s.automatic)await chrome.alarms.create('roas-monitoring-daily',{when:nextDaily(s.hour,s.minute)});else await chrome.alarms.clear('roas-monitoring-daily');}
async function failJob(job,error){try{await bridge('failure',{token,runId:job.runId,jobId:job.id,error:String(error.message||error).slice(0,300)});}catch{}await write({message:'수집 중단: '+String(error.message||error).slice(0,300),running:false,automatic:false});}
async function waitReady(tabId,job,phase='summary'){
  // A completed top-level navigation can precede Sellha's signed-in SPA data.
  // Stabilize rendered evidence before extraction; authentication forms,
  // expired sessions and access blocks are terminal, never retried.
  let previous=null;
  for(let attempt=0;attempt<12;attempt++){
    const results=await chrome.scripting.executeScript({target:{tabId},func:context=>{
      const url=location.href,text=document.body?.innerText||'',visible=node=>!!node?.getClientRects().length&&getComputedStyle(node).visibility!=='hidden';
      if(url!==context.url)return {fatal:true,error:'요청한 셀하 화면에서 벗어났습니다.'};
      if(/Access Denied|automated (?:traffic|requests)|비정상적인\s*접근|접근이\s*차단|보안문자|사람인지\s*확인|로봇이\s*아닙니다|Verify you are human/i.test(text))return {fatal:true,error:'인증 또는 접근 제한 화면이 표시되었습니다.'};
      if([...document.querySelectorAll('input[type="password"]')].some(visible)||/세션이\s*만료/.test(text))return {fatal:true,error:'셀하 로그인을 직접 완료해 주세요.'};
      if(/로그인이\s*필요|로그인\s*후\s*이용/.test(text))return {authWall:true,signature:'auth:'+text.replace(/\s+/g,' ').slice(0,800)};
      if(document.readyState==='loading'||[...document.querySelectorAll('[aria-busy="true"]')].some(visible))return {ready:false};
      const images=[...document.querySelectorAll('img[alt="item-image"]')].filter(visible);
      if(context.type==='list'){
        const match=/등록\s*상품\s*수\s*([\d,]+)\s*개/.exec(text);if(!match)return {ready:false};
        const expected=Number(match[1].replace(/,/g,'')),ids=[...new Set([...document.querySelectorAll('a[href*="productId="]')].filter(node=>visible(node)&&node.querySelector('img[alt="item-image"]')).map(node=>node.getAttribute('href')))];
        return {ready:ids.length===expected,signature:'list:'+expected+':'+ids.join('|')};
      }
      if(!images.length||!/카테고리/.test(text)||!/배송비/.test(text))return {ready:false};
      const identity=images.map(node=>node.currentSrc||node.src||'').join('|');
      if(context.phase!=='keywords')return {ready:true,signature:'summary:'+identity+':'+text.slice(0,1200)};
      const tables=[...document.querySelectorAll('table')].filter(visible),header=tables.find(table=>/키워드/.test(table.innerText||'')&&/\d{1,2}\s*[.]\s*\d{1,2}/.test(table.innerText||''));
      const rows=tables.flatMap(table=>[...table.querySelectorAll('tr')]).filter(visible),observed=rows.filter(row=>/\d[\d,]*\s*위|미노출|업데이트\s*중|-위/.test(row.innerText||''));
      return {ready:!!header&&observed.length>0,signature:'keywords:'+identity+':'+tables.map(table=>table.innerText||'').join('|')};
    },args:[{readiness:true,url:job.url,type:job.type,phase}]});
    const state=results?.[0]?.result;if(!state)throw Error('셀하 화면 준비 상태를 확인하지 못했습니다.');
    if(state.fatal)throw Error(state.error);
    if(state.signature&&state.signature===previous){if(state.authWall)throw Error('셀하 로그인이 필요합니다. 로그인 후 이어서 수집하세요.');if(state.ready)return true;}
    previous=state.signature||null;await pause(350);
  }
  return false;
}
async function openView(tabId,view){
  const results=await chrome.scripting.executeScript({target:{tabId},func:kind=>{
    const text=document.body?.innerText||'',url=location.href;
    if(/Access Denied|automated (?:traffic|requests)|비정상적인\s*접근|접근이\s*차단|보안문자|사람인지\s*확인|로봇이\s*아닙니다|Verify you are human/i.test(text))return {url,blocked:true,error:'인증 또는 접근 제한 화면이 표시되었습니다.'};
    if(document.querySelector('input[type="password"]')||/로그인이\s*필요|로그인\s*후\s*이용|세션이\s*만료/.test(text))return {url,blocked:true,error:'셀하 로그인을 직접 완료해 주세요.'};
    const label={keywords:'키워드',reviews:'리뷰',sales:'판매량'}[kind],pattern=new RegExp('^'+label+'\\s*(?:모니터링)?$');
    const nodes=[...document.querySelectorAll('button,[role="tab"],a,div,span,p')].filter(node=>{if(!node.getClientRects().length||getComputedStyle(node).visibility==='hidden'||!pattern.test((node.innerText||'').trim()))return false;const r=node.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return hit===node||node.contains(hit);});
    const control=nodes[nodes.length-1];if(!control)return {url,found:false};control.click();return {url,found:true};
  },args:[view]});
  const result=results?.[0]?.result;if(!result)throw Error('모니터링 항목을 열지 못했습니다.');return result;
}
async function extract(tabId,job,view='keywords'){
  await chrome.scripting.executeScript({target:{tabId},files:['extract.js']});
  const results=await chrome.scripting.executeScript({target:{tabId},func:context=>{try{const text=document.body?.innerText||'';return {ok:true,url:location.href,payload:MonitoringExtract.extract(document,{url:location.href,today:context.today,year:context.year,view:context.view}),signals:{extensionRequired:/(?:확장\s*프로그램|익스텐션).{0,45}(?:설치|필요)|(?:설치|필요).{0,45}(?:확장\s*프로그램|익스텐션)/.test(text),emptyReviews:/(?:등록된|수집된|표시할)\s*리뷰(?:가|는)?\s*없|리뷰\s*(?:내역|데이터|목록)?(?:가|이|는)?\s*없/.test(text)}};}catch(e){return {ok:false,url:location.href,code:e.code||'INVALID_DATA',error:e.message||'실제 화면을 읽지 못했습니다.'};}},args:[{today:job.today,year:job.year,view}]});
  const result=results?.[0]?.result;if(!result)throw Error('셀하 화면에서 읽기 결과를 받지 못했습니다.');return result;
}
function mergeView(base,extra){
  // Secondary views expose aggregate metrics too. Never let their empty
  // keyword arrays replace the independently captured rank history.
  for(const record of extra.snapshots||[]){let target=base.snapshots.find(x=>x.platform===record.platform&&x.productId===record.productId&&x.date===record.date);if(!target){target={platform:record.platform,productId:record.productId,date:record.date,keywords:[]};base.snapshots.push(target);}for(const [key,value]of Object.entries(record))if(key!=='keywords')target[key]=value;}
  if(extra.reviews?.length){const reviews=new Map((base.reviews||[]).map(r=>[r.id,r]));for(const r of extra.reviews)reviews.set(r.id,r);base.reviews=[...reviews.values()];}
}
async function detailViews(tabId,job,initial){
  const payload=initial.payload;payload.sourceCoverage=[{kind:'keywords',state:'collected',records:payload.snapshots.reduce((n,s)=>n+(s.keywords?.length||0),0)}];payload.warnings=[];let stop=false;
  for(const view of ['reviews','sales']){
    const title=view==='reviews'?'리뷰':'7일 구매 건수';
    if(view==='sales'&&job.platform==='coupang'){payload.sourceCoverage.push({kind:view,state:'not_supported',records:0,message:'셀하 쿠팡 화면은 판매량 모니터링을 제공하지 않습니다.'});continue;}
    let opened;try{opened=await openView(tabId,view);}catch(error){payload.sourceCoverage.push({kind:view,state:'unverified',records:0,message:String(error.message||error).slice(0,300)});payload.warnings.push(title+' 화면을 확인하지 못했습니다.');continue;}
    if(opened.blocked||opened.url!==initial.url){payload.sourceCoverage.push({kind:view,state:'blocked',records:0,message:opened.error||'요청한 상품 화면에서 벗어났습니다.'});payload.warnings.push(title+' 확인 중 로그인·인증 또는 화면 이동이 필요합니다.');stop=true;break;}
    if(!opened.found){payload.sourceCoverage.push({kind:view,state:'not_available',records:0,message:title+' 탭이 실제 화면에 없습니다.'});payload.warnings.push(title+' 탭을 확인하지 못했습니다.');continue;}
    let captured,records=0,state='unverified',message=title+' 원본 값이 표시되었는지 확인하지 못했습니다.';
    for(let attempt=0;attempt<8;attempt++){
      await pause(400);try{captured=await extract(tabId,job,view);}catch(error){message=title+' 화면 응답을 확인하지 못했습니다. '+String(error.message||error).slice(0,150);stop=true;break;}
      if(captured.url!==initial.url||!captured.ok&&['AUTH_REQUIRED','SOURCE_BLOCKED','SOURCE_UNSUPPORTED'].includes(captured.code)){state='blocked';message=captured.error||'요청한 상품 화면에서 벗어났습니다.';stop=true;break;}
      if(!captured.ok){message=captured.error||message;continue;}
      mergeView(payload,captured.payload);
      records=view==='reviews'?(captured.payload.reviews?.length||0):captured.payload.snapshots.filter(s=>Object.hasOwn(s,'rollingSales7d')).length;
      if(records){state='collected';message=view==='reviews'?'실제 화면에 표시된 리뷰만 저장합니다. 전체 리뷰 이력은 검증되지 않았습니다.':'관찰한 7일 구매 건수만 저장합니다. 일별 판매량으로 환산하지 않습니다.';break;}
      if(captured.signals?.extensionRequired){state='extension_required';message=title+' 원본은 셀하 확장프로그램 설치 후 확인할 수 있습니다.';break;}
      if(view==='reviews'&&captured.signals?.emptyReviews){state='empty';message='원본 화면에 수집된 리뷰가 없다고 표시되어 있습니다.';break;}
    }
    payload.sourceCoverage.push({kind:view,state,records,message});
    if(state!=='collected'&&state!=='empty')payload.warnings.push(message);
    if(view==='reviews'&&state==='collected')payload.warnings.push('리뷰는 현재 화면에 표시된 '+records+'건만 확인했습니다.');
    if(stop)break;
  }
  return {result:initial,stop};
}
async function tick(reason){if(busy)return;const previous=await read();if(!['wake','daily','resume','pause'].includes(reason)&&!previous.running&&!previous.automatic&&!previous.pendingDaily)return;busy=true;let job;try{
  const connected=await bridge('connect');token=connected.token;let status=connected.status;await schedule(status);
  const stored=await read();if((reason==='daily'||stored.pendingDaily)&&status.automatic&&!status.running){status=await bridge('start',{mode:'recent',platform:status.platform,automatic:true,hour:status.hour,minute:status.minute,reason:'daily'});await write({pendingDaily:false});}
  const next=await bridge('job',{token});status=next.status;job=next.job;await write({message:status.message,running:status.running,automatic:status.automatic,completed:status.completed,total:status.total});if(!job)return;
  if(!sourceTab(job.url))throw Error('허용된 셀하 일간 모니터링 화면이 아닙니다.');let tab;try{tab=await chrome.tabs.get(stored.sourceTab);}catch{}
  if(tab&&/Access Denied|Request Blocked|Forbidden/i.test(tab.title||''))throw Error('셀하가 이 브라우저의 접근을 거절했습니다.');
  if(!tab){tab=await chrome.tabs.create({url:job.url,active:true});await write({sourceTab:tab.id,jobId:job.id,requestedUrl:job.url,attempts:0});return;}
  if(tab.status==='loading')return;
  if(tab.url!==job.url){if(tab.url&&/\/login|\/sign-?in|nid\.naver\.com/i.test(tab.url))throw Error('셀하 로그인 또는 인증을 직접 완료한 뒤 이어서 수집하세요.');if(stored.jobId===job.id&&stored.requestedUrl===job.url)throw Error('요청한 셀하 화면으로 이동하지 못했습니다. 로그인·이용 권한·화면 주소를 확인한 뒤 이어서 수집하세요.');let current;try{current=new URL(tab.url);}catch{}if(current?.origin!=='https://sellha.kr')throw Error('수집 탭에 다른 사이트가 열렸습니다. 기존 탭은 변경하지 않고 중단했습니다.');await chrome.tabs.update(tab.id,{url:job.url});await write({jobId:job.id,requestedUrl:job.url,attempts:0});return;}
  const waiting=async()=>{const s=await read(),attempts=s.jobId===job.id?(s.attempts||0)+1:1;await write({jobId:job.id,attempts,message:'셀하 로그인 상태와 상품 자료가 안정적으로 표시되기를 기다립니다.'});if(attempts>=5)throw Error('셀하 상품 자료가 준비되지 않았습니다. 화면을 확인한 뒤 이어서 수집하세요.');};
  if(!await waitReady(tab.id,job)){await waiting();return;}
  if(job.type==='detail'){const opened=await openView(tab.id,'keywords');if(opened.blocked||opened.url!==job.url)throw Error(opened.error||'요청한 셀하 상품 화면에서 벗어났습니다.');if(!await waitReady(tab.id,job,'keywords')){await waiting();return;}}
  let result;for(let attempt=0;attempt<5;attempt++){result=await extract(tab.id,job);if(result.ok||result.code!=='SOURCE_NOT_READY')break;await pause(700);}
  if(!result.ok){if(result.code==='SOURCE_NOT_READY'){const s=await read(),attempts=s.jobId===job.id?(s.attempts||0)+1:1;await write({jobId:job.id,attempts,message:'셀하 자료가 표시되기를 기다립니다.'});if(attempts<5)return;}throw Error(result.error);}
  let sourceStop=false;if(job.type==='detail'){const captured=await detailViews(tab.id,job,result);result=captured.result;sourceStop=captured.stop;}else result.payload.sourceCoverage=[{kind:'products',state:result.payload.products.length?'collected':'empty',records:result.payload.products.length}];
  const ack=await bridge('result',{token,runId:job.runId,jobId:job.id,sourceUrl:result.url,payload:result.payload});if(ack.jobId!==job.id||!Number.isInteger(ack.revision))throw Error('저장 확인 응답이 수집 작업과 다릅니다.');
  if(sourceStop){const stopped=await bridge('pause',{reason:'source'});await write({message:stopped.message,running:false,automatic:false,completed:stopped.completed,total:stopped.total,attempts:0});await schedule(stopped);return;}
  await write({message:ack.status.message,running:ack.status.running,automatic:ack.status.automatic,completed:ack.status.completed,total:ack.status.total,attempts:0});await schedule(ack.status);if(ack.status.running)setTimeout(()=>tick('next'),300);
 }catch(error){if(job)await failJob(job,error);else await write({message:String(error.message||error).slice(0,300),running:false});}finally{busy=false;}}
chrome.runtime.onMessage.addListener((m,sender,reply)=>{if(sender.id!==chrome.runtime.id)return;if(sender.tab&&!localTab(sender.tab))return;if(!['wake','open','pause','resume','status'].includes(m?.kind))return;(async()=>{if(sender.tab)await write({receiverTab:sender.tab.id});if(m.kind==='open'){const id=await receiver();await chrome.tabs.update(id,{active:true});}else if(m.kind==='pause'){await bridge('pause');await tick('pause');}else if(m.kind==='resume'){await bridge('resume');await tick('resume');}else if(m.kind==='wake')await tick('wake');reply({ok:true,status:await read()});})().catch(e=>reply({ok:false,error:e.message}));return true;});
chrome.tabs.onUpdated.addListener(async(id,change)=>{if(change.status!=='complete')return;const s=await read();if(id===s.sourceTab||id===s.receiverTab)tick('ready');});
chrome.alarms.onAlarm.addListener(async a=>{if(a.name==='roas-monitoring-tick')tick('tick');if(a.name==='roas-monitoring-daily'){await write({pendingDaily:true});tick('daily');}});
function initialize(){chrome.alarms.create('roas-monitoring-tick',{periodInMinutes:1});tick('startup');}
chrome.runtime.onInstalled.addListener(initialize);chrome.runtime.onStartup.addListener(initialize);
