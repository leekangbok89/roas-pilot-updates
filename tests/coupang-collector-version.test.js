'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'../browser-extensions/coupang-collector/worker.js'),'utf8');
const copy=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
function worker({adapterVersion='0.2.6',submitted=false,probeThrows=false}={}){
 let state={runId:'current-run',running:true,automatic:true,completed:0,receiverTab:10,reportTab:20,queue:[{type:'pa',since:'2026-10-26',until:'2026-11-01',...(submitted?{submitted:true,confirmedAllCampaigns:true,baselineCount:0,baselineReports:[]}:{} )}]};
 const calls={reloads:[],steps:[],probes:[],creates:[]},noop={addListener(){}};
 const chrome={
  runtime:{id:'extension',getManifest:()=>({version:'0.2.6'}),onMessage:noop,onInstalled:noop,onStartup:noop},
  storage:{local:{get:async()=>({collector:copy(state)}),set:async value=>{state=copy(value.collector);}}},
  downloads:{onChanged:noop},alarms:{onAlarm:noop,create(){}},
  tabs:{
   get:async id=>{if(id===10)return {id,url:'http://127.0.0.1:3000/coupang-collector.html'};if(id===20)return {id,url:'https://advertising.coupang.com/marketing-reporting/billboard/reports/pa',title:'쿠팡 광고 보고서'};throw Error('Unknown tab');},
   create:async spec=>{calls.creates.push(spec);throw Error('Known tabs must be reused');},
   reload:async id=>{calls.reloads.push(id);},
   sendMessage:async(id,message)=>{
    if(id===10){if(message.kind==='ping')return {ok:true};if(message.kind==='status')return {};}
    if(id===20&&message.kind==='probe'){calls.probes.push(copy(message));if(probeThrows)throw Error('No receiving end');return adapterVersion===null?undefined:{adapterVersion};}
    if(id===20&&message.kind==='step'){calls.steps.push(copy(message));return {requested:true,baselineCount:0,baselineReports:[],message:'보고서 생성 확인 중'};}
    throw Error('Unexpected message '+id+' '+message.kind);
   }
  }
 };
 const ctx=vm.createContext({chrome,URL,Date,crypto:require('node:crypto').webcrypto,setTimeout});
 vm.runInContext(source+'\nglobalThis.runTick=tick;globalThis.readStatus=controlStatus;',ctx);
 return {tick:()=>ctx.runTick(),status:()=>ctx.readStatus(),state:()=>copy(state),calls,setVersion:value=>{adapterVersion=value;probeThrows=false;}};
}
test('stale report adapter reloads the known tab once before submission and stops if the mismatch persists',async()=>{
 const h=worker({adapterVersion:'0.2.5'});
 await h.tick();assert.deepEqual(h.calls.reloads,[20]);assert.equal(h.calls.steps.length,0);assert.equal(h.calls.creates.length,0);assert.equal(h.state().running,true);assert.equal(h.state().queue[0].adapterReloaded,true);assert.notEqual(h.state().queue[0].submitted,true);
 let status=await h.status();assert.equal(status.extensionVersion,'0.2.6');assert.equal(status.reportVersion,'0.2.5');
 await h.tick();assert.deepEqual(h.calls.reloads,[20]);assert.equal(h.calls.steps.length,0);assert.equal(h.state().running,false);assert.equal(h.state().automatic,false);assert.match(h.state().message,/0\.2\.6/);assert.match(h.state().message,/0\.2\.5/);
});
test('a tab with no responding adapter is reloaded once and cannot submit until its version is verified',async()=>{
 for(const options of [{adapterVersion:null},{probeThrows:true}]){
  const h=worker(options);await h.tick();assert.deepEqual(h.calls.reloads,[20]);assert.equal(h.calls.steps.length,0);assert.equal((await h.status()).reportVersion,null);
  await h.tick();assert.deepEqual(h.calls.reloads,[20]);assert.equal(h.calls.steps.length,0);assert.equal(h.state().running,false);
 }
});
test('matching report adapter passes the actual step and persists report version in visible status',async()=>{
 const h=worker();await h.tick();assert.equal(h.calls.probes.length,1);assert.equal(h.calls.reloads.length,0);assert.equal(h.calls.steps.length,1);assert.equal(h.calls.steps[0].allowCreate,true);assert.equal(h.state().queue[0].submitted,true);assert.equal(h.state().queue[0].confirmedAllCampaigns,true);assert.equal(h.state().reportVersion,'0.2.6');
 const status=await h.status();assert.equal(status.extensionVersion,'0.2.6');assert.equal(status.reportVersion,'0.2.6');assert.equal(status.running,true);
});
test('a repaired adapter proceeds after the one reload while an already submitted stale job stops without reload or resubmission',async()=>{
 const repaired=worker({adapterVersion:'0.2.5'});await repaired.tick();repaired.setVersion('0.2.6');await repaired.tick();assert.deepEqual(repaired.calls.reloads,[20]);assert.equal(repaired.calls.steps.length,1);assert.equal(repaired.calls.steps[0].allowCreate,true);
 const submitted=worker({adapterVersion:'0.2.5',submitted:true});await submitted.tick();assert.equal(submitted.calls.reloads.length,0);assert.equal(submitted.calls.steps.length,0);assert.equal(submitted.state().running,false);assert.equal(submitted.state().queue[0].submitted,true);
});
