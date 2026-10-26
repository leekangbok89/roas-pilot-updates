'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Readable}=require('node:stream');
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'roas-other-costs-')),file=path.join(dir,'server.js');fs.copyFileSync(path.join(__dirname,'../server.js'),file);const app=require(file);
 t.after(()=>{delete require.cache[file];fs.rmSync(dir,{recursive:true,force:true});});
 const write=(name,value)=>{const dest=path.join(dir,'.roas-data',name);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,JSON.stringify(value));};
 const request=(url,method='GET',body,headers={})=>new Promise((resolve,reject)=>{
  const req=Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]);Object.assign(req,{url,method,headers:{host:'127.0.0.1:3000','x-roas-local-action':'yes',...headers}});
  let status;const res={writeHead(code){status=code;},end(data){resolve({status,body:JSON.parse(data)});}};Promise.resolve(app.server.listeners('request')[0](req,res)).catch(reject);
 });
 const input=(extra={})=>({date:'2026-09-01',title:'인스타그램 협찬',product:'위마망 백도씨',recipient:'@test',unitCost:50000,quantity:2,delivery:5000,fee:10000,extra:3000,revision:app.otherAdCostRead().revision,...extra});
 return {...app,dir,file,write,request,input};
}
test('sponsorship ledger persists components, updates by ID without duplicates, and rejects stale mutations',t=>{
 const f=fixture(t);let saved=f.otherAdCostSave(f.input());assert.equal(saved.entries[0].amount,118000);const id=saved.entries[0].id;
 saved=f.otherAdCostSave(f.input({id,quantity:1}));assert.equal(saved.entries.length,1);assert.equal(saved.entries[0].amount,68000);
 delete require.cache[f.file];assert.equal(require(f.file).otherAdCostRead().entries[0].amount,68000);
 assert.throws(()=>f.otherAdCostSave(f.input({id,revision:0})),/다른 화면/);
 assert.throws(()=>f.otherAdCostSave({id,revision:0},true),/다른 화면/);
 saved=f.otherAdCostSave(f.input({date:'2026-09-02'}));assert.equal(saved.entries.length,2);
 saved=f.otherAdCostSave({id,revision:saved.revision},true);assert.equal(saved.entries.length,1);assert.equal(saved.entries[0].date,'2026-09-02');
});
test('invalid dates, numbers, totals, unknown edits and corrupt storage cannot silently change costs',t=>{
 const f=fixture(t);for(const extra of [{date:'2026-02-30'},{title:' '},{quantity:0.5},{unitCost:-1},{fee:'10'},{extra:Infinity},{quantity:1000001},{unitCost:1e12,quantity:2},{id:'missing'}])assert.throws(()=>f.otherAdCostSave(f.input(extra)));
 assert.deepEqual(f.otherAdCostRead(),{revision:0,entries:[]});f.otherAdCostSave(f.input());f.write('other-ad-costs.json',{revision:1,entries:[{amount:0}]});assert.throws(()=>f.otherAdCostRead(),/읽을 수 없습니다/);
});
test('other costs join Meta and Naver once on occurrence date in summary, chart data, full and partial profit',async t=>{
 const f=fixture(t),date='2026-09-01';for(const ch of ['naver','cafe24']){f.write(ch+'-orders/orders.json',{orders:{}});f.write(ch+'-orders/sync.json',{days:{[date]:{checkedAt:'2026-09-03'},'2026-09-02':{checkedAt:'2026-09-03'}}});}
 f.write('daily/11111/'+date+'.json',{date,account:'11111',currency:'KRW',rows:[{spend:'1000',account_currency:'KRW'}]});
 f.naverSpendSave({since:date,until:date,amounts:{gfa:300},revision:0});let saved=f.otherAdCostSave(f.input());f.otherAdCostSave(f.input({date:'2026-09-02',unitCost:0,quantity:0,delivery:0,fee:2500,extra:0}));
 let row=f.profitDaily(date,date,{accounts:['11111','11111']}).days[0];assert.equal(row.otherAdSpend,118000);assert.equal(row.adSpend,119300);assert.equal(row.profit,-119300);assert.equal(row.confirmed.profit,-119300);assert.equal(row.cost,0,'gifts do not become sold product costs');
 f.write('product-costs.json',{[require('node:crypto').createHash('sha256').update(JSON.stringify(['naver','위마망 테스트',''])).digest('hex').slice(0,24)]:{cost:0}});f.write('naver-orders/orders.json',{orders:{known:{paymentDate:date,net:100,items:[{name:'위마망 테스트',option:'',quantity:1}]},pending:{paymentDate:date,net:100,items:[{name:'미분류 상품',quantity:1}]}}});row=f.profitDaily(date,date,{accounts:['11111']}).days[0];assert.equal(row.profit,null);assert.equal(row.confirmed.profit,-119207);
 let result=await f.request('/api/meta/spend/summary?since='+date+'&until='+date+'&naver=11111&cafe=11111');assert.equal(result.status,200);assert.equal(result.body.scopes.otherAdSpend.value,118000);assert.equal(result.body.scopes.spend.value,119300);assert.equal(result.body.daily[0].spend,119300);
 result=await f.request('/api/meta/spend/summary?since=2026-09-02&until=2026-09-02');assert.equal(result.body.scopes.otherAdSpend.value,2500);assert.equal(result.body.scopes.spend.value,2500);assert.equal(result.body.scopes.spend.partial,true,'missing Meta remains unconfirmed');
 f.otherAdCostSave({id:saved.entries[0].id,revision:f.otherAdCostRead().revision},true);assert.equal(f.profitDaily(date,date,{accounts:['11111']}).days[0].adSpend,1300);
});
test('ledger API requires local writes, handles CRUD, and returns corrupt storage errors',async t=>{
 const f=fixture(t),url='/api/costs/other-ad-costs';assert.equal((await f.request(url)).status,200);
 assert.equal((await f.request(url,'POST',f.input(),{'x-roas-local-action':''})).status,403);assert.equal((await f.request(url,'POST',null)).status,400);
 let result=await f.request(url,'POST',f.input());assert.equal(result.status,200);const id=result.body.entries[0].id;
 assert.equal((await f.request(url,'PUT',{})).status,405);result=await f.request(url,'DELETE',{id,revision:1});assert.equal(result.status,200);assert.equal(result.body.entries.length,0);
 f.write('other-ad-costs.json',{broken:true});assert.equal((await f.request(url)).status,500);
});
