'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

async function impactPage(days){
 const html=fs.readFileSync(path.join(__dirname,'..','public','index.html'),'utf8');
 const script=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(x=>x[1]).find(x=>x.includes('function scopedRevenue'));
 assert.ok(script,'sales comparison handler must be present');
 const element=()=>({value:'',textContent:'',children:[],disabled:false,addEventListener(){},append(child){this.children.push(child);},replaceChildren(){this.children=[];}});
 const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);};
 get('impact-start').value='2026-09-01';get('impact-end').value='2026-09-02';get('impact-pivot').value='2026-09-02';get('fx-rate').value='1350';
 const context=vm.createContext({document:{getElementById:get,createElement:element},localStorage:{getItem:()=>JSON.stringify({naver:'11111',cafe:'22222'})},URLSearchParams,setTimeout,console,
  fetch:async url=>{
   const u=new URL(url,'http://127.0.0.1:3000');let data;
   if(u.pathname==='/api/sales/compare')data={scope:'wemamang',days};
   else if(u.pathname==='/api/insights')data={rows:days.map(d=>({date_start:d.date,spend:u.searchParams.get('account')==='11111'?'10000':'0',account_currency:'KRW'})),cache:{missingDays:[]}};
   else if(u.pathname==='/api/cafe24/orders/status')data={job:{progress:'완료',done:1,total:1,running:false},totalOrders:0,daysChecked:1,days:[]};
   else throw Error('Unexpected request '+u.pathname);
   return {ok:true,json:async()=>data};
  }
 });
 vm.runInContext(script,context);
 await get('impact-run').onclick();
 return {summary:get('impact-summary').textContent,rows:get('impact-daily').children.map(tr=>tr.children.map(td=>td.textContent))};
}

test('sales comparison displays confirmed Wemamang subtotals while excluding partial days from the complete before/after comparison',async()=>{
 const page=await impactPage([
  {date:'2026-09-01',naver:null,cafe24:0,total:null,complete:false,confirmedAvailable:true,confirmed:{naver:300000,cafe24:0,total:300000},pending:{unclassifiedOrders:2}},
  {date:'2026-09-02',naver:400000,cafe24:0,total:400000,complete:true,confirmedAvailable:true,confirmed:{naver:400000,cafe24:0,total:400000},pending:{}}
 ]);
 assert.deepEqual(page.rows[0].slice(1,4),['300,000원','0원','300,000원']);
 assert.match(page.rows[0][5],/확인된 위마망만 · 부분집계.*미분류 2건/);
 assert.match(page.rows[1][5],/위마망 매출 확정/);
 assert.match(page.summary,/확정 자료 비교 전: 유효 0\/1일/);
 assert.match(page.summary,/비교 전 300,000원 \(1일 · 부분집계 1일\)/);
 assert.match(page.summary,/관측 매출 증감\(일평균\): —/);
});

test('unknown-only comparison day cannot display confirmed zero as actual sales',async()=>{
 const page=await impactPage([{date:'2026-09-01',naver:null,cafe24:0,total:null,complete:false,confirmedAvailable:false,confirmed:{naver:0,cafe24:0,total:0},pending:{unclassifiedOrders:1}}]);
 assert.deepEqual(page.rows[0].slice(1,4),['—','—','—']);
 assert.match(page.rows[0][5],/위마망 매출 미확정.*미분류 1건/);
 assert.match(page.summary,/비교 전 — \(0일 · 부분집계 0일\)/);
});
