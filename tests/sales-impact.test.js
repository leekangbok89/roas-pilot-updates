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

async function signalPage(days,metaRows,missingDays=[]){
 const html=fs.readFileSync(path.join(__dirname,'..','public','index.html'),'utf8');
 const script=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(x=>x[1]).find(x=>x.includes('function scopedRevenue'));
 assert.ok(script,'sales comparison handler must be present');
 const element=()=>({value:'',textContent:'',children:[],disabled:false,addEventListener(){},append(child){this.children.push(child);},replaceChildren(){this.children=[];}});
 const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);};
 get('impact-start').value='2026-09-01';get('impact-end').value='2026-09-02';get('impact-pivot').value='2026-09-02';get('fx-rate').value='1350';
 const context=vm.createContext({document:{getElementById:get,createElement:element},localStorage:{getItem:()=>JSON.stringify({naver:'11111',cafe:'22222'})},URLSearchParams,setTimeout,console,
  fetch:async url=>{
   const u=new URL(url,'http://127.0.0.1:3000');let data;
   if(u.pathname==='/api/profit/daily')data={days};
   else if(u.pathname==='/api/insights')data={rows:metaRows,currency:'KRW',cache:{missingDays}};
   else if(u.pathname==='/api/cafe24/orders/status')data={job:{progress:'완료',done:1,total:1,running:false},totalOrders:0,daysChecked:1,days:[]};
   else throw Error('Unexpected request '+u.pathname);
   return {ok:true,json:async()=>data};
  }
 });
 vm.runInContext(script,context);
 await get('signal-run').onclick();
 return {summary:get('signal-summary').textContent,rows:get('signal-daily').children.map(tr=>tr.children.map(td=>td.textContent))};
}

test('purchase signal check compares confirmed Cafe24 orders with stored Meta Purchase signals without declaring CAPI misses',async()=>{
 const purchase=value=>[{action_type:'purchase',value:String(value)}];
 const page=await signalPage([
  {date:'2026-09-01',cafe24:{revenueComplete:true,revenue:300000,orders:2,confirmedAvailable:true,confirmed:{revenue:300000,orders:2}}},
  {date:'2026-09-02',cafe24:{revenueComplete:false,revenue:null,orders:1,confirmedAvailable:true,confirmed:{revenue:120000,orders:1}}}
 ],[
  {date_start:'2026-09-01',actions:purchase(1),action_values:purchase(150000),account_currency:'KRW'},
  {date_start:'2026-09-02',actions:purchase(1),action_values:purchase(120000),account_currency:'KRW'}
 ]);
 assert.match(page.summary,/카페24 확인 주문 3건 · Meta Purchase 2건 · 단순 건수 격차 \+1건/);
 assert.match(page.summary,/CAPI 누락 확정값이 아닙니다/);
 assert.match(page.rows[0][6],/전환 신호 격차 \+1건/);
 assert.match(page.rows[1][6],/건수 일치 · 부분집계/);
 assert.equal(page.rows[0][4],'150,000원');
});

test('purchase signal check excludes missing Meta days from the gap instead of treating them as zero',async()=>{
 const page=await signalPage([
  {date:'2026-09-01',cafe24:{revenueComplete:true,revenue:100000,orders:1,confirmedAvailable:true,confirmed:{revenue:100000,orders:1}}},
  {date:'2026-09-02',cafe24:{revenueComplete:true,revenue:100000,orders:1,confirmedAvailable:true,confirmed:{revenue:100000,orders:1}}}
 ],[],['2026-09-02']);
 assert.match(page.summary,/비교 가능 1\/2일/);
 assert.match(page.summary,/Meta 저장 누락 1일/);
 assert.equal(page.rows[1][3],'—');
 assert.match(page.rows[1][6],/Meta 저장 누락/);
});
