'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const read=name=>fs.readFileSync(path.join(__dirname,'../browser-extensions/coupang-collector',name),'utf8');
function worker(){let state=null,handler;const noop={addListener(){}};const chrome={runtime:{id:'extension',onMessage:{addListener(fn){handler=fn;}},onInstalled:noop},downloads:{onChanged:noop},alarms:{onAlarm:noop},storage:{local:{get:async()=>({collector:state}),set:async value=>{state=value.collector;}}}};const ctx=vm.createContext({chrome,URL,Date,crypto:require('node:crypto').webcrypto});vm.runInContext(read('worker.js'),ctx);vm.runInContext('tick=async()=>{};',ctx);const send=(m,sender)=>new Promise(resolve=>{const accepted=handler(m,sender,resolve);if(!accepted)resolve(null);});return {send,state:()=>state};}
test('local collection buttons start both PA/NCA queues, report progress and stop without duplicate jobs',async()=>{
 const h=worker(),sender={id:'extension',url:'http://127.0.0.1:3000/coupang-collector.html?from=dashboard',tab:{id:10}};
 const until=new Date(Date.now()+9*3600000-86400000).toISOString().slice(0,10),since=new Date(Date.parse(until)-6*86400000).toISOString().slice(0,10);
 let r=await h.send({kind:'start',since,until,automatic:true},sender);assert.equal(r.ok,true);assert.equal(r.collector.running,true);assert.equal(r.collector.total,2);assert.equal(h.state().receiverTab,10);assert.deepEqual(Array.from(h.state().queue,x=>x.type),['pa','nca']);
 const id=h.state().runId;r=await h.send({kind:'start',since,until},sender);assert.equal(r.ok,false);assert.equal(h.state().runId,id);
 r=await h.send({kind:'status'},sender);assert.equal(r.collector.total,2);assert.equal(r.collector.automatic,true);
 r=await h.send({kind:'stop'},sender);assert.equal(r.collector.running,false);assert.equal(h.state().automatic,false);
});
test('worker rejects external/wrong-page/wrong-extension controls and local-page permission resume',async()=>{
 const h=worker();for(const sender of [{id:'other'}, {id:'extension',url:'https://advertising.coupang.com/',tab:{id:1}}, {id:'extension',url:'http://127.0.0.1:3000/other.html',tab:{id:1}}])assert.equal(await h.send({kind:'status'},sender),null);
 assert.equal(await h.send({kind:'resume'},{id:'extension',url:'http://localhost:3000/coupang-collector.html',tab:{id:1}}),null);
});
test('receiver bridges only same-window same-origin allowlisted commands',async()=>{
 let listener;const calls=[],messages=[],win={addEventListener(kind,fn){if(kind==='message')listener=fn;},postMessage(m){messages.push(m);}};
 const ctx=vm.createContext({window:win,location:{origin:'http://127.0.0.1:3000',pathname:'/coupang-collector.html'},chrome:{runtime:{id:'extension',onMessage:{addListener(){}},sendMessage:async m=>{calls.push(m);return {ok:true,collector:{running:true}};}}}});vm.runInContext(read('receiver.js'),ctx);
 const data={source:'ROAS_COUPANG_PAGE',id:'request',kind:'start',since:'2026-10-01',until:'2026-10-07'};
 await listener({source:{},origin:'http://127.0.0.1:3000',data});await listener({source:win,origin:'https://evil.invalid',data});await listener({source:win,origin:'http://127.0.0.1:3000',data:{...data,kind:'resume'}});assert.equal(calls.length,0);
 await listener({source:win,origin:'http://127.0.0.1:3000',data});assert.equal(calls.length,1);assert.equal(messages[0].source,'ROAS_COUPANG_CONTROL');assert.equal(messages[0].id,'request');assert.equal(messages[0].ok,true);
});
