'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'../browser-extensions/coupang-collector/worker.js'),'utf8');
const copy=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
function harness(options={}){
 let now=Date.parse('2026-11-03T01:00:00Z'),handler,files=options.files||[],captured=options.captured;
 const Clock=class extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
 let state={runId:'run-1',running:true,automatic:true,completed:0,receiverTab:10,reportTab:20,queue:[{type:'pa',since:'2026-11-02',until:'2026-11-02',submitted:true,confirmedAllCampaigns:true,baselineCount:0,baselineReports:[],startedAt:now-60000,waitStartedAt:now-60000,downloadRequestedAt:now-30000,phase:'download',...options.job}],...options.state};
 const calls={steps:[],workbooks:[],searches:[],fetches:[],reloads:[],blobReads:[],releases:[]},noop={addListener(){}};
 const chrome={runtime:{id:'extension',getManifest:()=>({version:'0.2.7'}),onMessage:{addListener(fn){handler=fn;}},onInstalled:noop,onStartup:noop},storage:{local:{get:async()=>({collector:copy(state)}),set:async value=>{state=copy(value.collector);}}},alarms:{onAlarm:noop,create(){}},permissions:{contains:async()=>true},downloads:{onChanged:noop,search:async query=>{calls.searches.push(copy(query));return copy(query.id?files.filter(file=>file.id===query.id):files);}},tabs:{
  get:async id=>({id,url:id===10?'http://127.0.0.1:3000/coupang-collector.html':(options.reportUrl||'https://advertising.coupang.com/marketing-reporting/billboard/reports/pa')}),reload:async id=>calls.reloads.push(id),
  sendMessage:async(id,message)=>{
   if(id===10&&message.kind==='ping')return {ok:true};if(id===10&&message.kind==='status')return {};
   if(id===10&&message.kind==='workbook'){calls.workbooks.push(copy(message));return options.ack||{ok:true,result:{dates:['2026-11-02']}};}
   if(id===20&&message.kind==='read-report-file'){calls.blobReads.push(copy(message));return captured||{ok:false,code:'CAPTURE_MISSING'};}if(id===20&&message.kind==='release-report-file'){calls.releases.push(copy(message));return {ok:true};}
   if(id===20&&message.kind==='probe')return {adapterVersion:'0.2.7'};
   if(id===20&&message.kind==='step'){calls.steps.push(copy(message));if(options.stepError)throw Error(options.stepError);return options.step||{phase:'identifying',message:'기존 보고서 식별 확인 중',diagnostics:{rows:10,freshRows:0}};}
   throw Error('Unexpected message');
  }
 }};
 const ctx=vm.createContext({chrome,URL,Date:Clock,setTimeout,crypto:require('node:crypto').webcrypto,Uint8Array,AbortSignal,btoa:value=>Buffer.from(value,'binary').toString('base64'),atob:value=>Buffer.from(value,'base64').toString('binary'),fetch:async url=>{calls.fetches.push(url);let sent=false;return {ok:true,body:{getReader:()=>({read:async()=>sent?{done:true}:(sent=true,{done:false,value:new Uint8Array([80,75,3,4])})})}};}});
 vm.runInContext(source+'\nglobalThis.runTick=tick;globalThis.readStatus=controlStatus;globalThis.storeStatus=write;globalThis.importFile=collectFile;',ctx);
 return {tick:()=>ctx.runTick(),collect:id=>ctx.importFile(id),status:()=>ctx.readStatus(),state:()=>copy(state),calls,advance:ms=>{now+=ms;},setFiles:value=>{files=value;},setCaptured:value=>{captured=value;},mutate:fn=>{fn(state);},write:async message=>{const s=copy(state);s.message=message;await ctx.storeStatus(s);},send:message=>new Promise(resolve=>handler(message,{id:'extension',url:'http://127.0.0.1:3000/coupang-collector.html',tab:{id:10}},resolve))};
}
const download=(overrides={})=>({id:7,state:'complete',startTime:'2026-11-03T00:59:30Z',filename:'C:\\Downloads\\A00836776_pa_daily_campaign_20261102_20261102 (2).xlsx',finalUrl:'https://advertising.coupang.com/download?token=PRIVATE',...overrides});
test('periodic reconciliation imports an exact completed download even when its completion event was missed',async()=>{
 const h=harness({files:[download()]});await h.tick();assert.equal(h.calls.steps.length,0);assert.equal(h.calls.workbooks.length,1);assert.equal(h.state().completed,1);assert.equal(h.state().queue[0].phase,'saved');assert.ok(h.state().log.some(entry=>entry.phase==='saved'));
 assert.doesNotMatch(JSON.stringify((await h.status()).log),/PRIVATE|https?:|Downloads|\.xlsx/);
});
test('a completed file at the deadline is recovered, and its saved log belongs to the completed job rather than the next type',async()=>{
 const h=harness({files:[download()]});h.mutate(s=>{s.queue.push({type:'nca',since:'2026-11-02',until:'2026-11-02'});});h.advance(16*60000);await h.tick();assert.equal(h.state().completed,1);assert.equal(h.calls.workbooks.length,1);const log=h.state().log;assert.equal(log.at(-1).type,'pa');assert.equal(log.at(-1).phase,'saved');assert.match(log.at(-1).message,/매출성장/);assert.notEqual(h.state().queue[1].phase,'saved');
 const unfinished=harness({files:[download({state:'in_progress'})]});unfinished.advance(16*60000);await unfinished.tick();assert.equal(unfinished.state().running,false);assert.equal(unfinished.state().completed,0);assert.match(unfinished.state().message,/시간 초과/);
});
test('download recovery never counts a save without a successful acknowledgement covering every requested date',async()=>{
 for(const ack of [{ok:false,error:'가져오기 실패'},{ok:true,result:{dates:[]}}]){
  const h=harness({files:[download()],ack});await h.tick();assert.equal(h.state().completed,0);assert.equal(h.state().running,false);assert.equal(h.calls.workbooks.length,1);
 }
});
test('interrupted exact downloads stop with the actual interruption reason',async()=>{
 const h=harness({files:[download({state:'interrupted',error:'USER_CANCELED'})]});await h.tick();assert.equal(h.state().running,false);assert.equal(h.state().completed,0);assert.equal(h.calls.workbooks.length,0);assert.match(h.state().message,/USER_CANCELED/);assert.equal((await h.status()).canContinue,true);
});
test('a newer matching attempt controls progress or interruption, while an already completed exact file remains recoverable',async()=>{
 const older=download({id:6,state:'interrupted',error:'USER_CANCELED',startTime:'2026-11-03T00:59:10Z'}),newer=download({id:8,state:'in_progress',startTime:'2026-11-03T00:59:40Z'});
 const progressing=harness({files:[older,newer]});await progressing.tick();assert.equal(progressing.state().running,true);assert.match(progressing.state().message,/다운로드 진행 확인/);assert.equal(progressing.calls.workbooks.length,0);assert.equal(progressing.calls.steps.length,0);
 const stopped=harness({files:[{...older,state:'in_progress'},{...newer,state:'interrupted',error:'NETWORK_FAILED'}]});await stopped.tick();assert.equal(stopped.state().running,false);assert.match(stopped.state().message,/NETWORK_FAILED/);assert.equal(stopped.calls.workbooks.length,0);
 const completed=harness({files:[{...older,state:'complete'},newer]});await completed.tick();assert.equal(completed.state().completed,1);assert.equal(completed.calls.workbooks.length,1);assert.equal(completed.state().log.at(-1).phase,'saved');assert.equal(completed.state().log.at(-1).type,'pa');
});
test('wrong type/date or stale downloads cannot be imported; retries poll the same report without creating another',async()=>{
 const h=harness({files:[download({filename:'A00836776_nca_daily_campaign_20261102_20261102.xlsx'}),download({id:8,filename:'A00836776_pa_daily_campaign_20261101_20261101.xlsx'}),download({id:9,startTime:'2026-11-02T01:00:00Z'})],step:{downloading:true,phase:'download',message:'기존 보고서 다운로드 클릭'}});
 await h.tick();assert.equal(h.calls.workbooks.length,0);assert.equal(h.calls.steps.length,0);assert.match(h.state().message,/일치 파일 0개/);
 for(let attempt=1;attempt<=2;attempt++){h.advance(121000);await h.tick();assert.equal(h.state().queue[0].downloadRetries,attempt);assert.equal(h.calls.steps.at(-1).allowCreate,false);assert.equal(h.state().completed,0);}
 h.advance(121000);await h.tick();assert.equal(h.state().running,false);assert.equal(h.calls.steps.length,2);assert.equal(h.calls.workbooks.length,0);assert.match(h.state().message,/2회/);
});
test('a timeout retains advertising type, range, last verified phase and message',async()=>{
 const h=harness({job:{downloadRequestedAt:undefined,phase:'creating',lastObservedMessage:'새 보고서 생성 중 · 같은 기간 10개 / 새 보고서 1개'}});h.advance(16*60000);await h.tick();const status=await h.status();assert.equal(status.running,false);assert.equal(status.canContinue,true);assert.match(status.message,/매출성장/);assert.match(status.message,/2026-11-02/);assert.match(status.message,/보고서 생성/);assert.match(status.message,/새 보고서 1개/);assert.equal(status.currentJob.phase,'creating');
});
test('continue resets only the wait timer and preserves the verified request, queue and completion checkpoint',async()=>{
 const h=harness({job:{downloadRequestedAt:undefined},state:{running:false}});h.mutate(s=>{s.queue.unshift({type:'nca',since:'2026-11-01',until:'2026-11-01'});s.completed=1;});const before=h.state();h.advance(16*60000);
 const reply=await h.send({kind:'continue'});assert.equal(reply.ok,true);const after=h.state();assert.equal(after.completed,1);assert.equal(after.queue.length,2);assert.deepEqual(after.queue[0],before.queue[0]);assert.equal(after.queue[1].submitted,true);assert.equal(after.queue[1].startedAt,before.queue[1].startedAt);assert.ok(after.queue[1].waitStartedAt>before.queue[1].waitStartedAt);assert.equal(h.calls.steps.length,1);assert.equal(h.calls.steps[0].allowCreate,false);
});
test('unknown submission outcomes and missing create responses stop instead of ever resubmitting',async()=>{
 const unknown=harness({job:{confirmedAllCampaigns:false,downloadRequestedAt:undefined}});await unknown.tick();assert.equal(unknown.state().running,false);assert.equal(unknown.state().queue[0].phase,'unknown');assert.equal(unknown.calls.steps.length,0);assert.equal((await unknown.status()).canContinue,false);assert.equal((await unknown.send({kind:'continue'})).ok,false);
 const lost=harness({job:{submitted:false,confirmedAllCampaigns:false,downloadRequestedAt:undefined},stepError:'No response https://example.invalid/?token=PRIVATE'});await lost.tick();assert.equal(lost.state().running,false);assert.equal(lost.state().queue[0].submitted,true);assert.equal(lost.state().queue[0].phase,'unknown');assert.equal(lost.calls.steps.length,1);assert.equal((await lost.status()).canContinue,false);assert.doesNotMatch(JSON.stringify((await lost.status()).log),/PRIVATE|https?:/);
});
test('status events are bounded and expose only numeric report diagnostics',async()=>{
 const h=harness({job:{downloadRequestedAt:undefined},step:{phase:'creating',message:'보고서 생성 중',diagnostics:{rows:10,freshRows:1,url:'https://private.invalid/',token:'PRIVATE'}}});await h.tick();assert.deepEqual(copy((await h.status()).currentJob.diagnostics),{rows:10,freshRows:1});for(let i=0;i<65;i++)await h.write('확인 '+i);const status=await h.status();assert.equal(status.log.length,40);assert.match(status.log.at(-1).message,/확인 64/);assert.doesNotMatch(JSON.stringify(status.log),/PRIVATE|https?:/);
});

const blobDownload=(overrides={})=>download({finalUrl:'blob:https://advertising.coupang.com/SYNTHETIC-BLOB-PRIVATE',mime:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',...overrides});
const blobBytes={ok:true,data:Buffer.from([80,75,3,4]).toString('base64'),bytes:4};
test('same-origin captured blob bytes follow the exact Chrome file and save acknowledgement path without fetching a URL',async()=>{
 const h=harness({files:[blobDownload()],captured:blobBytes,job:{captureId:'capture-1'}});await h.tick();assert.equal(h.state().completed,1);assert.equal(h.calls.fetches.length,0);assert.equal(h.calls.blobReads.length,1);assert.equal(h.calls.blobReads[0].captureId,'capture-1');assert.equal(h.calls.workbooks[0].data,blobBytes.data);assert.equal(h.calls.releases.length,1);assert.doesNotMatch(JSON.stringify((await h.status()).log),/SYNTHETIC-BLOB|PRIVATE|blob:https/);
});
test('expired pre-upgrade blob is ignored and only the same report download is retried with a new capture',async()=>{
 const h=harness({files:[blobDownload()],captured:{ok:false,code:'CAPTURE_MISSING'},step:{phase:'download',downloading:true,message:'기존 보고서 다운로드 클릭'}});await h.tick();assert.equal(h.state().completed,0);assert.deepEqual(h.state().queue[0].ignoredDownloadIds,[7]);assert.equal(h.calls.steps.length,0);assert.equal(h.state().running,true);
 await h.tick();assert.equal(h.calls.steps.length,1);assert.equal(h.calls.steps[0].allowCreate,false);assert.ok(h.state().queue[0].captureId);h.setCaptured(blobBytes);h.setFiles([blobDownload(),blobDownload({id:8,finalUrl:'blob:https://advertising.coupang.com/NEW-PRIVATE'})]);await h.tick();assert.equal(h.state().completed,1);assert.equal(h.calls.workbooks.length,1);
});
test('missing blob capture retries are bounded and never create another report',async()=>{
 const h=harness({files:[blobDownload()],step:{phase:'download',downloading:true,message:'기존 보고서 다운로드 클릭'}});for(let index=0;index<3;index++){if(index)await h.tick();h.setFiles([blobDownload({id:7+index})]);await h.tick();assert.equal(h.state().completed,0);}assert.equal(h.state().running,false);assert.equal(h.calls.steps.length,2);assert.ok(h.calls.steps.every(m=>m.allowCreate===false));assert.match(h.state().message,/2회/);
});
test('blob source, current report tab, payload size and ZIP signature must all be valid before import',async()=>{
 for(const options of [{files:[blobDownload({finalUrl:'blob:https://unrelated.example/SECRET'})],captured:blobBytes},{files:[blobDownload()],captured:blobBytes,reportUrl:'https://advertising.coupang.com/marketing-reporting/billboard/reports/nca'},{files:[blobDownload()],captured:{ok:true,data:'UEsDBA==',bytes:9*1024*1024}},{files:[blobDownload()],captured:{ok:true,data:Buffer.from('html').toString('base64'),bytes:4}},{files:[blobDownload()],captured:blobBytes,ack:{ok:false,error:'저장 실패'}}]){
  const h=harness(options);if(options.reportUrl)await h.collect(7);else await h.tick();assert.equal(h.state().completed,0);assert.equal(h.state().running,false);assert.equal(h.calls.fetches.length,0);assert.equal(h.calls.releases.length,0);assert.doesNotMatch(JSON.stringify((await h.status()).log),/SECRET|SYNTHETIC-BLOB-PRIVATE/);
 }
});
test('unsupported HTTPS download reports only the host, MIME and size instead of a signed file URL',async()=>{
 const h=harness({files:[download({finalUrl:'https://new-report.example/report?token=PRIVATE',mime:'application/octet-stream',fileSize:1234})]});await h.tick();assert.equal(h.state().running,false);assert.equal(h.calls.fetches.length,0);assert.match(h.state().message,/new-report.example/);assert.match(h.state().message,/1234바이트/);assert.doesNotMatch(h.state().message,/PRIVATE|token=|https:\/\//);
});
