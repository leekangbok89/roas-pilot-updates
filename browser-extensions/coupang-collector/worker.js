'use strict';
const REPORTS={pa:'https://advertising.coupang.com/marketing-reporting/billboard/reports/pa',nca:'https://advertising.coupang.com/marketing-reporting/billboard/reports/nca'};
const LOCAL='http://127.0.0.1:3000/coupang-collector.html';let working=false,receiving=false;
const date=n=>new Date(n).toISOString().slice(0,10),kst=()=>date(Date.now()+9*3600000),shift=(d,n)=>date(Date.parse(d)+n*86400000);
function valid(d){return /^\d{4}-\d\d-\d\d$/.test(d||'')&&Number.isFinite(Date.parse(d))&&date(Date.parse(d))===d;}
function plan(since,until){if(!valid(since)||!valid(until)||since>until||until>=kst()||since<shift(kst(),-365))throw Error('어제까지 최근 1년의 기간을 선택하세요.');const jobs=[];for(let d=since;d<=until;){const end=shift(d,6)<until?shift(d,6):until;for(const type of ['pa','nca'])jobs.push({type,since:d,until:end});d=shift(end,1);}return jobs;}
const read=async()=>(await chrome.storage.local.get('collector')).collector;
async function write(s,force=false){const current=await read();if(!force&&current?.runId&&(current.runId!==s.runId||current.running===false&&s.running===true))return false;await chrome.storage.local.set({collector:s});if(s.receiverTab)try{await chrome.tabs.sendMessage(s.receiverTab,{kind:'status',message:s.message});}catch{}return true;}
async function receiver(s){
 let ready=false;
 try{const t=await chrome.tabs.get(s.receiverTab);if(t.url===LOCAL)ready=true;else if(t.url?.startsWith('chrome-error:')){await chrome.tabs.update(t.id,{url:LOCAL});ready=true;}}catch{}
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
 if(job.startedAt&&Date.now()-job.startedAt>15*60000){s.running=false;s.automatic=false;s.message='보고서 생성·저장 확인 시간 초과. 생성 상태와 수집 로그를 확인하세요.';await write(s);return;}
 if(job.downloadRequestedAt){s.message='보고서 다운로드·로컬 저장 확인 대기';await write(s);return;}
 job.startedAt ||= Date.now();
 // Store the intent before submitting so a worker restart cannot submit twice.
 const submitting=!job.submitted;job.submitted=true;await write(s);
 const current=await read();if(current?.runId!==s.runId||!current.running)return;let result;try{result=await chrome.tabs.sendMessage(tab.id,{kind:'step',job,allowCreate:submitting});}catch{if(submitting)job.submitted=false;s.message='광고 보고서 화면이 준비되기를 기다립니다.';await write(s);return;}
 s.message=result.message||'보고서 확인 중';if(result.requested){job.confirmedAllCampaigns=true;job.baselineCount=result.baselineCount;}if(result.downloading)job.downloadRequestedAt=Date.now();if(result.blocked){s.running=false;s.automatic=false;}if(result.needsInput){s.running=false;s.automatic=false;s.message+=' 수집을 멈췄습니다. 화면 변경 사항을 확인한 뒤 다시 시작하세요.';}if(result.notSubmitted)job.submitted=false;
 await write(s);
 }catch(e){const s=await read();if(s){s.message=String(e.message).slice(0,500);await write(s);}}finally{working=false;}}
async function collectFile(id){if(working){setTimeout(()=>collectFile(id),1000);return;}if(receiving)return;receiving=true;try{
 const s=await read();if(!s?.running)return;const job=s.queue[s.completed||0];if(!job)return;
 const [d]=await chrome.downloads.search({id});if(!d||d.state!=='complete'||Date.parse(d.startTime)<(job.startedAt||0))return;
 const filename=d.filename.split(/[\\/]/).pop(),m=/^(A\d+)_(pa|nca)_(?:total|daily)_campaign_(\d{8})_(\d{8})(?:\s*\(\d+\))?\.xlsx$/i.exec(filename);
 if(!m||m[2].toLowerCase()!==job.type||m[3]!==job.since.replaceAll('-','')||m[4]!==job.until.replaceAll('-',''))return;
 const url=new URL(d.finalUrl||d.url),host=url.hostname;
 if(url.protocol!=='https:'||!(host==='advertising.coupang.com'||/\.(amazonaws\.com|cloudfront\.net|coupangcdn\.com)$/.test(host))){s.running=false;s.message='이 다운로드 형식은 자동 읽기를 지원하지 않습니다. 원본 파일을 로컬 수집 연결 화면에 넣어 저장할 수 있습니다.';await write(s);return;}
 if(!await chrome.permissions.contains({origins:[url.origin+'/*']})){s.running=false;s.permissionHost=host;s.message='보고서 다운로드 서버 접근 권한이 필요합니다: '+host+'. 확장프로그램 버튼에서 허용 후 보고서를 다시 내려받으세요.';await write(s);return;}
 const response=await fetch(url.href,{credentials:host==='advertising.coupang.com'?'include':'omit',redirect:'error',signal:AbortSignal.timeout(60000)});
 if(!response.ok)throw Error('보고서 파일 응답 오류 '+response.status);
 const reader=response.body.getReader(),parts=[];let length=0;
 while(true){const chunk=await reader.read();if(chunk.done)break;length+=chunk.value.length;if(length>8*1024*1024){await reader.cancel();throw Error('보고서가 8MB를 초과합니다. 기간을 나누세요.');}parts.push(chunk.value);}
 const data=new Uint8Array(length);let at=0;for(const part of parts){data.set(part,at);at+=part.length;}let binary='';for(let n=0;n<data.length;n+=16384)binary+=String.fromCharCode(...data.subarray(n,n+16384));
 await receiver(s);const ack=await chrome.tabs.sendMessage(s.receiverTab,{kind:'workbook',id:crypto.randomUUID(),filename,data:btoa(binary)});
 if(!ack?.ok)throw Error(ack?.error||'로컬 저장 확인 실패');
 const wanted=[];for(let d=job.since;d<=job.until;d=shift(d,1))wanted.push(d);
 if(!wanted.every(d=>ack.result.dates.includes(d))){s.running=false;s.message='파일은 저장됐지만 요청 기간 중 일부 날짜가 빠졌습니다. 빠진 날짜를 0원으로 계산하지 않았습니다.';await write(s);return;}
 s.completed++;s.message=(job.type==='pa'?'매출성장':'신규구매')+' '+job.since+' ~ '+job.until+' 저장 확인';s.permissionHost=null;await write(s);await tick();
 }catch(e){const s=await read();if(s){s.running=false;s.automatic=false;s.message='수집 중단: '+String(e.message).slice(0,400);await write(s);}}finally{receiving=false;}}
chrome.downloads.onChanged.addListener(d=>{if(d.state?.current==='complete')collectFile(d.id);});
chrome.alarms.onAlarm.addListener(async a=>{if(a.name==='roas-coupang-tick')tick();if(a.name==='roas-coupang-daily'){const s=await read();if(s?.automatic&&!s.running&&!s.permissionHost){s.queue=plan(shift(kst(),-7),shift(kst(),-1));s.completed=0;s.runId=crypto.randomUUID();s.running=true;await write(s,true);tick();}}});
chrome.runtime.onInstalled.addListener(()=>{chrome.alarms.create('roas-coupang-tick',{periodInMinutes:1});chrome.alarms.create('roas-coupang-daily',{periodInMinutes:1440});});
chrome.runtime.onStartup?.addListener(()=>{chrome.alarms.create('roas-coupang-tick',{periodInMinutes:1});chrome.alarms.create('roas-coupang-daily',{periodInMinutes:1440});tick();});
chrome.runtime.onMessage.addListener((m,sender,reply)=>{if(sender.id!==chrome.runtime.id||sender.tab)return;
 (async()=>{if(m.kind==='start'){const old=await read(),s={runId:crypto.randomUUID(),queue:plan(m.since,m.until),completed:0,running:true,automatic:m.automatic===true,reportTab:old?.reportTab,receiverTab:old?.receiverTab,message:'수집 연결 시작'};await write(s,true);await tick();}
 else if(m.kind==='stop'){const s=await read();if(s){s.running=false;s.automatic=false;s.message='사용자가 수집을 중단했습니다.';await write(s,true);}}
 else if(m.kind==='resume'){const s=await read();if(s){s.runId=crypto.randomUUID();s.running=true;s.permissionHost=null;const job=s.queue[s.completed];if(job){job.startedAt=Date.now();delete job.downloadRequestedAt;}await write(s,true);await tick();}}
 reply({ok:true});})().catch(e=>reply({ok:false,error:e.message}));return true;});
