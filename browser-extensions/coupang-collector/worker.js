'use strict';
const REPORTS={pa:'https://advertising.coupang.com/marketing-reporting/billboard/reports/pa',nca:'https://advertising.coupang.com/marketing-reporting/billboard/reports/nca'};
const LOCAL='http://127.0.0.1:3000/coupang-collector.html';let working=false,receiving=false;
const extensionVersion=()=>chrome.runtime.getManifest?.().version||'버전 확인 불가';
const date=n=>new Date(n).toISOString().slice(0,10),kst=()=>date(Date.now()+9*3600000),shift=(d,n)=>date(Date.parse(d)+n*86400000);
function valid(d){return /^\d{4}-\d\d-\d\d$/.test(d||'')&&Number.isFinite(Date.parse(d))&&date(Date.parse(d))===d;}
function plan(since,until){if(!valid(since)||!valid(until)||since>until||until>=kst()||since<shift(kst(),-365))throw Error('어제까지 최근 1년의 기간을 선택하세요.');const jobs=[];for(let d=since;d<=until;){const end=shift(d,6)<until?shift(d,6):until;for(const type of ['pa','nca'])jobs.push({type,since:d,until:end});d=shift(end,1);}return jobs;}
const read=async()=>(await chrome.storage.local.get('collector')).collector;
const safeMessage=value=>String(value||'').replace(/(?:https?:|blob:|file:)\/\/\S+/gi,'[주소 생략]').replace(/[A-Z]:[\\/][^\n]+/gi,'[파일 경로 생략]').slice(0,700);
function stage(job,phase){if(job.phase!==phase){job.phase=phase;job.phaseAt=Date.now();}}
function numericDiagnostics(value){const out={};if(value&&typeof value==='object')for(const [key,n]of Object.entries(value))if(/^[a-z][a-z0-9]{0,40}$/i.test(key)&&typeof n==='number'&&Number.isFinite(n)&&n>=0)out[key]=Math.min(n,1000000);return out;}
const jobLabel=job=>(job.type==='pa'?'매출성장':'신규구매')+' '+job.since+' ~ '+job.until;
const phaseLabel=phase=>({form:'기간·캠페인 설정',creating:'보고서 생성',identifying:'새 보고서 식별',ready:'다운로드 버튼 확인',download:'다운로드·저장',failed:'실패',unknown:'요청 결과 불명'}[phase]||'보고서 확인');
function downloadDescription(d,url){let source=url.hostname;try{if(url.protocol==='blob:')source=new URL(url.origin).hostname;}catch{}const size=Number.isFinite(d.fileSize)&&d.fileSize>=0?d.fileSize:Number.isFinite(d.bytesReceived)?d.bytesReceived:null,mime=/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(d.mime||'')?d.mime:'확인 불가';return '주소 형식 '+url.protocol.replace(':','')+' · 출처 '+(source||'확인 불가')+' · 파일 형식 '+mime+(size===null?'':' · '+size+'바이트');}
function checkedWorkbook(value){
 if(!value||typeof value.data!=='string'||!Number.isInteger(value.bytes)||value.bytes<=0||value.bytes>8*1024*1024||value.data.length>12*1024*1024||!/^[A-Za-z0-9+/]*={0,2}$/.test(value.data))throw Error('임시 보고서 크기·데이터 형식을 확인하지 못했습니다.');
 const binary=atob(value.data);if(binary.length!==value.bytes||binary.slice(0,4)!=='PK\x03\x04')throw Error('임시 파일이 XLSX 원본 형식과 다릅니다.');return value.data;
}
function timeoutMessage(job){return '시간 초과 · '+jobLabel(job)+' · 단계: '+phaseLabel(job.phase)+' · 마지막 확인: '+safeMessage(job.lastObservedMessage||job.lastMessage||'상태 응답 없음');}
function recordState(s){
 s.message=safeMessage(s.message);const job=s.queue?.[s.completed||0];if(!job)return;
 job.lastMessage=s.message;job.phase ||= job.confirmedAllCampaigns?'identifying':job.submitted?'unknown':'form';job.phaseAt ||= Date.now();
 const entry={at:Date.now(),type:job.type,since:job.since,until:job.until,phase:job.phase,message:s.message};
 const log=Array.isArray(s.log)?s.log.slice(-39).map(e=>({at:e.at,type:e.type,since:e.since,until:e.until,phase:e.phase,message:safeMessage(e.message)})):[];
 const last=log.at(-1);if(!last||last.message!==entry.message||last.phase!==entry.phase||last.type!==entry.type||last.since!==entry.since||last.until!==entry.until)log.push(entry);s.log=log;
}
function matchesDownload(d,job){
 const started=Date.parse(d?.startTime);if(!Number.isFinite(started)||started<(job.startedAt||0))return false;
 const filename=String(d.filename||'').split(/[\\/]/).pop(),m=/^(A\d+)_(pa|nca)_(?:total|daily)_campaign_(\d{8})_(\d{8})(?:\s*\(\d+\))?\.xlsx$/i.exec(filename);
 return !!m&&m[2].toLowerCase()===job.type&&m[3]===job.since.replaceAll('-','')&&m[4]===job.until.replaceAll('-','');
}
async function reconcileDownload(s,job,expired=false){
 let found=[];try{if(chrome.downloads.search)found=await chrome.downloads.search({startedAfter:new Date(job.startedAt||job.downloadRequestedAt).toISOString(),orderBy:['-startTime'],limit:100});}catch(e){job.downloadSearchError=safeMessage(e.message);}
 const matching=found.filter(d=>matchesDownload(d,job)&&!job.ignoredDownloadIds?.includes(d.id));job.diagnostics={...numericDiagnostics(job.diagnostics),recentDownloads:found.length,matchingDownloads:matching.length};
 const complete=matching.find(d=>d.state==='complete');if(complete){await collectFile(complete.id,true);return true;}
 const latest=matching.slice().sort((a,b)=>Date.parse(b.startTime)-Date.parse(a.startTime)||(b.id||0)-(a.id||0))[0];
 if(latest?.state==='interrupted'){s.running=false;s.automatic=false;stage(job,'failed');s.message='다운로드 중단 · '+jobLabel(job)+' · '+safeMessage(latest.error||'Chrome에서 중단됨')+'. 기존 보고서를 직접 내려받거나 상태 확인을 다시 시작하세요.';await write(s);return true;}
 if(expired)return false;
 if(latest?.state==='in_progress'){stage(job,'download');s.message='다운로드 진행 확인 · '+jobLabel(job)+' · 완료 및 로컬 저장 확인 대기';await write(s);return true;}
 if(Date.now()-job.downloadRequestedAt<120000){s.message='다운로드 시작 확인 대기 · '+jobLabel(job)+' · 일치 파일 0개 / 최근 다운로드 '+found.length+'개';await write(s);return true;}
 if((job.downloadRetries||0)>=2){s.running=false;s.automatic=false;stage(job,'failed');s.message='다운로드 시작을 확인하지 못했습니다 · '+jobLabel(job)+' · 같은 보고서 다운로드를 2회 재시도했습니다. 쿠팡의 기존 보고서를 직접 내려받은 뒤 저장 상태를 다시 확인하세요.';await write(s);return true;}
 job.downloadRetries=(job.downloadRetries||0)+1;delete job.downloadRequestedAt;stage(job,'ready');s.message='다운로드 시작 미확인 · 기존 보고서 상태를 다시 확인합니다 ('+job.downloadRetries+'/2). 보고서를 새로 만들지 않습니다.';await write(s);return false;
}
async function write(s,force=false,record=true){const current=await read();if(!force&&current?.runId&&(current.runId!==s.runId||current.running===false&&s.running===true))return false;if(record)recordState(s);await chrome.storage.local.set({collector:s});if(s.receiverTab)try{await chrome.tabs.sendMessage(s.receiverTab,{kind:'status',message:s.message});}catch{}return true;}
async function receiver(s){
 let ready=false;
 try{const t=await chrome.tabs.get(s.receiverTab);if(/^http:\/\/(127\.0\.0\.1|localhost):3000\/coupang-collector\.html(?:[?#]|$)/.test(t.url||''))ready=true;else if(t.url?.startsWith('chrome-error:')){await chrome.tabs.update(t.id,{url:LOCAL});ready=true;}}catch{}
 if(!ready){const t=await chrome.tabs.create({url:LOCAL,active:false});s.receiverTab=t.id;await write(s);}
 for(let attempt=0;attempt<10;attempt++){try{const reply=await chrome.tabs.sendMessage(s.receiverTab,{kind:'ping'});if(reply?.ok)return;}catch{}await new Promise(resolve=>setTimeout(resolve,250));}
 throw Error('ROAS Pilot의 광고 수집 연결 화면이 준비되지 않았습니다. 로컬 프로그램을 켜 주세요.');
}
async function tick(){if(working)return;working=true;try{
 const s=await read();if(!s?.running)return;
 const job=s.queue[s.completed||0];if(!job){s.running=false;s.message='완료: 요청한 '+s.completed+'개 기간의 저장을 확인했습니다.';s.finishedAt=Date.now();await write(s);return;}
 await receiver(s);let tab;try{tab=await chrome.tabs.get(s.reportTab);}catch{tab=await chrome.tabs.create({url:REPORTS[job.type],active:true});s.reportTab=tab.id;}
 if(/access denied|request blocked|forbidden/i.test(tab.title||'')){s.running=false;s.automatic=false;s.message='접근 차단: 쿠팡이 이 브라우저의 요청을 거절했습니다. 자동 재시도하지 않습니다.';await write(s);return;}
 if(!tab.url?.startsWith('https://advertising.coupang.com/')){s.message='광고센터 로그인 또는 인증을 직접 완료해 주세요. '+job.since+' ~ '+job.until;await write(s);return;}
 const path=new URL(tab.url).pathname;if(path!==new URL(REPORTS[job.type]).pathname){await chrome.tabs.update(tab.id,{url:REPORTS[job.type]});s.message='보고서 화면을 여는 중';await write(s);return;}
 if(job.submitted&&!job.confirmedAllCampaigns){s.running=false;s.automatic=false;stage(job,'unknown');s.message='요청 결과 불명 · '+jobLabel(job)+'. 보고서 만들기 이후 확인 응답을 받지 못했습니다. 중복 생성을 막기 위해 멈췄습니다. 쿠팡의 기존 보고서 목록을 확인하세요.';await write(s);return;}
 const waitStarted=job.waitStartedAt||job.startedAt,expired=!!(waitStarted&&Date.now()-waitStarted>15*60000);
 // Recover an already finished or interrupted Chrome download before applying
 // the timer. In-progress/missing downloads still obey the overall deadline.
 if(job.downloadRequestedAt&&await reconcileDownload(s,job,expired))return;
 if(expired){s.running=false;s.automatic=false;s.stoppedReason='timeout';s.message=timeoutMessage(job);await write(s);return;}
 let adapter;try{adapter=await chrome.tabs.sendMessage(tab.id,{kind:'probe'});}catch{}
 s.reportVersion=adapter?.adapterVersion||null;
 if(s.reportVersion!==extensionVersion()){
  if(!job.submitted&&!job.adapterReloaded){job.adapterReloaded=true;s.message='쿠팡 보고서 탭의 이전 연결 코드를 새로고침합니다. Chrome 연결 '+extensionVersion();await write(s);await chrome.tabs.reload(tab.id);return;}
  s.running=false;s.automatic=false;s.message='Chrome 연결 '+extensionVersion()+' · 보고서 연결 '+(s.reportVersion||'확인 불가')+'. 확장프로그램과 쿠팡 보고서 탭을 새로고침한 뒤 다시 시작하세요.';await write(s);return;
 }
 job.startedAt ||= Date.now();job.waitStartedAt ||= job.startedAt;job.captureId ||= crypto.randomUUID();
 // Store the intent before submitting so a worker restart cannot submit twice.
 const submitting=!job.submitted;if(submitting)stage(job,'form');job.submitted=true;await write(s);
 const current=await read();if(current?.runId!==s.runId||!current.running)return;let result;try{result=await chrome.tabs.sendMessage(tab.id,{kind:'step',job,allowCreate:submitting});if(!result||typeof result!=='object')throw Error('보고서 화면 응답 없음');}catch(e){s.running=false;s.automatic=false;if(submitting)stage(job,'unknown');s.message=(submitting?'요청 결과 불명 · 중복 생성을 막기 위해 멈췄습니다.':'보고서 상태 확인 실패 · 기존 요청은 보존했습니다.')+' '+jobLabel(job)+' · '+safeMessage(e.message);await write(s);return;}
 s.message=result.message||'보고서 확인 중';job.lastObservedMessage=safeMessage(s.message);job.diagnostics=numericDiagnostics(result.diagnostics);if(result.phase)stage(job,['creating','identifying','ready','download','failed'].includes(result.phase)?result.phase:'identifying');if(result.requested){job.confirmedAllCampaigns=true;job.requestedAt ||= Date.now();job.baselineCount=result.baselineCount;job.baselineReports=result.baselineReports;if(!result.phase)stage(job,'creating');}if(result.downloading){if(result.captureId)job.captureId=result.captureId;job.downloadRequestedAt=Date.now();stage(job,'download');}if(result.blocked){s.running=false;s.automatic=false;}if(result.needsInput){s.running=false;s.automatic=false;s.message+=' 수집을 멈췄습니다. 화면 변경 사항을 확인한 뒤 다시 시작하세요.';}if(result.notSubmitted)job.submitted=false;
 await write(s);
 }catch(e){const s=await read();if(s){s.message=String(e.message).slice(0,500);await write(s);}}finally{working=false;}}
async function collectFile(id,fromTick=false){if(working&&!fromTick){setTimeout(()=>collectFile(id),1000);return;}if(receiving)return;receiving=true;try{
 const s=await read();if(!s?.running)return;const job=s.queue[s.completed||0];if(!job||!job.confirmedAllCampaigns)return;
 const [d]=await chrome.downloads.search({id});if(!d||d.state!=='complete'||!matchesDownload(d,job)||job.ignoredDownloadIds?.includes(d.id))return;
 const filename=d.filename.split(/[\\/]/).pop();
 const url=new URL(d.finalUrl||d.url),host=url.hostname;
 let workbookData;
 if(url.protocol==='blob:'&&url.origin==='https://advertising.coupang.com'){
  const reportTab=await chrome.tabs.get(s.reportTab);if(reportTab.url?.split('?')[0].split('#')[0]!==REPORTS[job.type])throw Error('임시 파일을 읽을 쿠팡 보고서 탭이 요청과 다릅니다.');
  let captured;try{captured=await chrome.tabs.sendMessage(s.reportTab,{kind:'read-report-file',captureId:job.captureId,url:url.href,filename,type:job.type,since:job.since,until:job.until});}catch{captured={ok:false,code:'CAPTURE_MISSING'};}
  if(!captured?.ok){
   if(!captured||captured.code==='CAPTURE_MISSING'){
    job.ignoredDownloadIds=[...(job.ignoredDownloadIds||[]),d.id].slice(-20);delete job.downloadRequestedAt;job.blobRetries=(job.blobRetries||0)+1;
    if(job.blobRetries<=2){stage(job,'ready');s.message='이전 브라우저 임시 파일이 만료됐습니다 · '+jobLabel(job)+' · 같은 보고서 다운로드를 다시 확인합니다 ('+job.blobRetries+'/2).';}
    else{s.running=false;s.automatic=false;stage(job,'failed');s.message='브라우저 임시 파일을 2회 다시 확인했지만 읽지 못했습니다 · '+downloadDescription(d,url)+' · 받은 원본 XLSX를 수집 화면에서 선택해 저장하세요.';}
    await write(s);return;
   }
   throw Error('임시 보고서 읽기 실패: '+safeMessage(captured.error||captured.code));
  }
  workbookData=checkedWorkbook(captured);
 }else{
 if(url.protocol!=='https:'||!(host==='advertising.coupang.com'||/\.(amazonaws\.com|cloudfront\.net|coupangcdn\.com)$/.test(host))){s.running=false;s.automatic=false;s.message='자동 읽기 미지원 경로 · '+downloadDescription(d,url)+' · 받은 원본 XLSX를 수집 화면에서 선택해 저장할 수 있습니다.';await write(s);return;}
 if(!await chrome.permissions.contains({origins:[url.origin+'/*']})){s.running=false;s.permissionHost=host;s.message='보고서 다운로드 서버 접근 권한이 필요합니다: '+host+'. 확장프로그램 버튼에서 허용 후 보고서를 다시 내려받으세요.';await write(s);return;}
 const response=await fetch(url.href,{credentials:host==='advertising.coupang.com'?'include':'omit',redirect:'error',signal:AbortSignal.timeout(60000)});
 if(!response.ok)throw Error('보고서 파일 응답 오류 '+response.status);
 const reader=response.body.getReader(),parts=[];let length=0;
 while(true){const chunk=await reader.read();if(chunk.done)break;length+=chunk.value.length;if(length>8*1024*1024){await reader.cancel();throw Error('보고서가 8MB를 초과합니다. 기간을 나누세요.');}parts.push(chunk.value);}
 const data=new Uint8Array(length);let at=0;for(const part of parts){data.set(part,at);at+=part.length;}let binary='';for(let n=0;n<data.length;n+=16384)binary+=String.fromCharCode(...data.subarray(n,n+16384));
 workbookData=btoa(binary);
 }
 await receiver(s);const ack=await chrome.tabs.sendMessage(s.receiverTab,{kind:'workbook',id:crypto.randomUUID(),filename,data:workbookData});
 if(!ack?.ok)throw Error(ack?.error||'로컬 저장 확인 실패');
 const wanted=[];for(let d=job.since;d<=job.until;d=shift(d,1))wanted.push(d);
 if(!wanted.every(d=>ack.result.dates.includes(d))){s.running=false;s.message='파일은 저장됐지만 요청 기간 중 일부 날짜가 빠졌습니다. 빠진 날짜를 0원으로 계산하지 않았습니다.';await write(s);return;}
 if(url.protocol==='blob:')try{await chrome.tabs.sendMessage(s.reportTab,{kind:'release-report-file',captureId:job.captureId,url:url.href});}catch{}
 stage(job,'saved');job.lastObservedMessage='로컬 저장 응답과 요청 기간 전체 날짜를 확인했습니다.';s.message=jobLabel(job)+' 저장 확인';recordState(s);s.completed++;s.permissionHost=null;await write(s,false,false);await tick();
 }catch(e){const s=await read();if(s){s.running=false;s.automatic=false;s.message='수집 중단: '+String(e.message).slice(0,400);await write(s);}}finally{receiving=false;}}
chrome.downloads.onChanged.addListener(d=>{if(d.state?.current==='complete')collectFile(d.id);if(d.state?.current==='interrupted')tick();});
chrome.alarms.onAlarm.addListener(async a=>{if(a.name==='roas-coupang-tick')tick();if(a.name==='roas-coupang-daily'){const s=await read();if(s?.automatic&&!s.running&&!s.permissionHost){s.queue=plan(shift(kst(),-7),shift(kst(),-1));s.completed=0;s.runId=crypto.randomUUID();s.running=true;await write(s,true);tick();}}});
chrome.runtime.onInstalled.addListener(()=>{chrome.alarms.create('roas-coupang-tick',{periodInMinutes:1});chrome.alarms.create('roas-coupang-daily',{periodInMinutes:1440});});
chrome.runtime.onStartup?.addListener(()=>{chrome.alarms.create('roas-coupang-tick',{periodInMinutes:1});chrome.alarms.create('roas-coupang-daily',{periodInMinutes:1440});tick();});
async function controlStatus(){const s=await read(),versions={extensionVersion:extensionVersion(),reportVersion:s?.reportVersion||null},job=s?.queue?.[s.completed||0];const details={currentJob:job?{type:job.type,since:job.since,until:job.until,phase:job.phase||'form',phaseAt:job.phaseAt||null,lastMessage:safeMessage(job.lastMessage),diagnostics:numericDiagnostics(job.diagnostics)}:null,log:(s?.log||[]).slice(-40).map(e=>({at:e.at,type:e.type,since:e.since,until:e.until,phase:e.phase,message:safeMessage(e.message)})),canContinue:!!(s&&!s.running&&job?.submitted&&job.confirmedAllCampaigns&&!s.permissionHost)};return s?{...versions,...details,running:s.running===true,automatic:s.automatic===true,completed:s.completed||0,total:s.queue?.length||0,message:safeMessage(s.message||'대기'),permissionHost:s.permissionHost||null}:{...versions,...details,running:false,completed:0,total:0,message:'수집 대기'};}
chrome.runtime.onMessage.addListener((m,sender,reply)=>{
 const local=sender.tab&&/^http:\/\/(127\.0\.0\.1|localhost):3000\/coupang-collector\.html(?:[?#]|$)/.test(sender.url||'');
 if(sender.id!==chrome.runtime.id||sender.tab&&!local||local&&!['start','stop','status','continue'].includes(m.kind))return;
 (async()=>{if(m.kind==='start'){const old=await read();if(old?.running)throw Error('광고 보고서를 이미 수집 중입니다.');const s={runId:crypto.randomUUID(),queue:plan(m.since,m.until),completed:0,running:true,automatic:m.automatic===true,reportTab:old?.reportTab,receiverTab:local?sender.tab.id:old?.receiverTab,message:'수집 연결 시작'};await write(s,true);await tick();}
 else if(m.kind==='stop'){const s=await read();if(s){s.running=false;s.automatic=false;s.message='사용자가 수집을 중단했습니다.';await write(s,true);}}
 else if(m.kind==='continue'){const s=await read(),job=s?.queue?.[s.completed||0];if(!s||s.running||!job?.submitted||!job.confirmedAllCampaigns||s.permissionHost)throw Error('확인된 기존 보고서 요청만 상태 확인을 계속할 수 있습니다.');s.runId=crypto.randomUUID();s.running=true;job.waitStartedAt=Date.now();s.message='기존 보고서 상태 확인을 계속합니다 · '+jobLabel(job)+'. 새 보고서를 만들지 않습니다.';await write(s,true);await tick();}
 else if(m.kind==='resume'){const s=await read();if(s){s.runId=crypto.randomUUID();s.running=true;s.permissionHost=null;const job=s.queue[s.completed];if(job){job.startedAt=Date.now();job.waitStartedAt=job.startedAt;delete job.downloadRequestedAt;}await write(s,true);await tick();}}
 reply({ok:true,collector:await controlStatus()});})().catch(e=>reply({ok:false,error:e.message}));return true;});
