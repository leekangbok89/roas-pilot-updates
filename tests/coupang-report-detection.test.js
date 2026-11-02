'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'../browser-extensions/coupang-collector');
function helpers(){const context=vm.createContext({chrome:{runtime:{onMessage:{addListener(){}}}}});vm.runInContext(fs.readFileSync(path.join(root,'report-page.js'),'utf8')+'\nglobalThis.h={reportBaseline,newReports,reportSignature};',context);return context.h;}
const row=(id,status='생성 완료',scope='전체 캠페인')=>({innerText:'2026-11-02 2026-10-26 ~ 2026-11-01 일별 '+scope+' '+status+' 자세히 보기 다운로드',getAttribute:name=>name==='data-row-key'?id:null,querySelector:()=>null,querySelectorAll:()=>[]});
test('a new completed report is detected when a full page keeps the same row count',()=>{
 const h=helpers(),old=Array.from({length:10},(_,i)=>row('old-'+i));const job={baselineCount:10,baselineReports:h.reportBaseline(old)};
 const fresh=row('new-report'),current=[fresh,...old.slice(0,9)];assert.equal(current.length,old.length);assert.deepEqual(Array.from(h.newReports(current,job)),[fresh]);
});
test('an older pending report becoming ready is never treated as a newly requested all-campaign report',()=>{
 const h=helpers(),old=row('old','생성 중','일부 캠페인');const job={baselineCount:1,baselineReports:h.reportBaseline([old])};
 assert.equal(h.newReports([row('old','생성 완료','일부 캠페인')],job).length,0);
 assert.equal(h.newReports([row('old','생성 완료','일부 캠페인')],{baselineCount:1}).length,0);
});
test('popup observes stored progress changes without reopening the popup',async()=>{
 let listener,state={message:'요청한 보고서의 생성 상태를 확인합니다.',completed:0,queue:[{},{}]};const nodes=new Map();
 const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',checked:true,hidden:true,textContent:''});return nodes.get(id);};
 const context=vm.createContext({document:{getElementById:node},Date,chrome:{storage:{local:{get:async()=>({collector:state})},onChanged:{addListener(fn){listener=fn;}}}}});
 vm.runInContext(fs.readFileSync(path.join(root,'popup.js'),'utf8'),context);await new Promise(resolve=>setImmediate(resolve));assert.match(node('status').textContent,/0\/2/);
 state={...state,completed:1,message:'매출성장 저장 확인'};listener({collector:{}},'local');await new Promise(resolve=>setImmediate(resolve));assert.match(node('status').textContent,/1\/2/);assert.match(node('status').textContent,/매출성장/);
});
