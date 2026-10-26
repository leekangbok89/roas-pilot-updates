'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Readable}=require('node:stream');
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'roas-naver-spend-')),file=path.join(dir,'server.js');
 fs.copyFileSync(path.join(__dirname,'../server.js'),file);const app=require(file);
 t.after(()=>{delete require.cache[file];fs.rmSync(dir,{recursive:true,force:true});});
 const write=(name,value)=>{const dest=path.join(dir,'.roas-data',name);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,JSON.stringify(value));};
 const save=(amounts,since='2026-09-01',until=since)=>app.naverSpendSave({since,until,amounts,revision:app.naverSpendRead().revision});
 const request=(method,body,headers={})=>new Promise((resolve,reject)=>{
  const req=Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]);Object.assign(req,{url:'/api/naver/ad-spend',method,headers:{host:'127.0.0.1:3000','x-roas-local-action':'yes',...headers}});
  let status;const res={writeHead(code){status=code;},end(data){resolve({status,body:JSON.parse(data)});}};
  Promise.resolve(app.server.listeners('request')[0](req,res)).catch(reject);
 });
 return {...app,dir,write,save,request};
}
test('Naver period costs preserve exact totals, round whole won and clip to selected dates',t=>{
 const f=fixture(t),saved=f.save({powerlink:100,shopping:0,gfa:200},'2026-09-01','2026-09-03');
 const days=['2026-09-01','2026-09-02','2026-09-03'].map(d=>f.naverSpendDay(d,saved));
 assert.deepEqual(days.map(d=>d.amounts.powerlink),[34,33,33]);assert.equal(days.reduce((s,d)=>s+d.total,0),300);
 assert.equal(days[0].estimated,true);assert.equal(days[0].amounts.shopping,0);
 assert.deepEqual(f.naverSpendDay('2026-09-04',saved),{amounts:{powerlink:null,shopping:null,gfa:null},total:0,entered:false,estimated:false});
 assert.equal(f.naverSpendDay('2026-09-02',saved).total,100,'a subperiod receives its allocated part only');
});
test('same channel and period replaces cost; blank channels preserve other saved amounts; stale edits are rejected',t=>{
 const f=fixture(t);f.save({powerlink:100,shopping:200,gfa:300});f.save({gfa:400});
 assert.equal(f.naverSpendRead().entries.length,3);assert.equal(f.naverSpendDay('2026-09-01',f.naverSpendRead()).total,700);
 assert.throws(()=>f.naverSpendSave({since:'2026-09-01',until:'2026-09-01',amounts:{gfa:99},revision:0}),/다른 화면/);
 assert.equal(f.naverSpendDay('2026-09-01',f.naverSpendRead()).total,700);
});
test('overlap rejection is atomic while unrelated channels and adjacent periods can coexist',t=>{
 const f=fixture(t);f.save({gfa:300},'2026-09-01','2026-09-03');
 assert.throws(()=>f.save({powerlink:100,gfa:400},'2026-09-03','2026-09-04'),/겹치는/);
 assert.equal(f.naverSpendRead().entries.length,1,'the valid channel must not save ahead of an invalid channel');
 f.save({powerlink:10},'2026-09-02');f.save({gfa:100},'2026-09-04');assert.equal(f.naverSpendRead().entries.length,3);
});
test('invalid money, dates, oversized ranges and unknown channels cannot change the ledger',t=>{
 const f=fixture(t);
 for(const args of [[{gfa:-1}],[{gfa:0.1}],[{gfa:'100'}],[{gfa:Infinity}],[{gfa:1e13}],[{unknown:2}],[{}],[{gfa:1},'2026-02-30'],[{gfa:1},'2026-09-03','2026-09-01'],[{gfa:1},'2024-01-01','2026-01-01']])assert.throws(()=>f.save(...args));
 assert.deepEqual(f.naverSpendRead(),{revision:0,entries:[]});
});
test('Naver costs deduct exactly once from both full and confirmed profit alongside deduplicated Meta accounts',t=>{
 const f=fixture(t),date='2026-09-01';
 for(const ch of ['naver','cafe24']){f.write(ch+'-orders/orders.json',{orders:{}});f.write(ch+'-orders/sync.json',{days:{[date]:{checkedAt:'2026-09-02'}}});}
 f.write('daily/11111/'+date+'.json',{date,account:'11111',currency:'KRW',rows:[{spend:'1000',account_currency:'KRW'}]});
 f.save({powerlink:100,shopping:200,gfa:300});
 const row=f.profitDaily(date,date,{accounts:['11111','11111']}).days[0];
 assert.equal(row.metaAdSpend,1000);assert.equal(row.naverAdSpendTotal,600);assert.equal(row.adSpend,1600);assert.equal(row.profit,-1600);assert.equal(row.confirmed.profit,-1600);assert.equal(row.adComplete,true);
 f.save({gfa:0});assert.equal(f.profitDaily(date,date,{accounts:['11111']}).days[0].adSpend,1300);
 fs.unlinkSync(path.join(f.dir,'.roas-data/daily/11111/'+date+'.json'));
 assert.equal(f.profitDaily(date,date,{accounts:['11111']}).days[0].adSpend,null,'missing Meta is never silently zeroed');
});
test('ledger API persists through reload, enforces local mutations and supports revision-safe deletion',async t=>{
 const f=fixture(t);let response=await f.request('GET');assert.equal(response.status,200);
 const body={since:'2026-09-01',until:'2026-09-01',amounts:{gfa:100},revision:0};
 response=await f.request('POST',body,{'x-roas-local-action':''});assert.equal(response.status,403);
 response=await f.request('POST',body);assert.equal(response.status,200);const entry=response.body.entries[0];
 assert.equal((await f.request('GET')).body.entries[0].amount,100);
 response=await f.request('DELETE',{id:entry.id,revision:1});assert.equal(response.status,200);assert.equal(response.body.entries.length,0);
 assert.equal((await f.request('PUT',{})).status,405);assert.equal((await f.request('POST',null)).status,400);
 f.write('naver-ad-spend.json',{broken:true});assert.equal((await f.request('GET')).status,500,'corrupt persisted costs must not become zero');
});
