'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

test('automatic update recognizes a successful install when the restart interrupts its response',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
 const begin=source.indexOf('async function setupUpdater(){');
 const end=source.indexOf("if(typeof document!=='undefined')setupUpdater();",begin);
 assert.ok(begin>=0&&end>begin);
 const elements=new Map(),get=id=>{
  if(!elements.has(id))elements.set(id,{value:'',checked:false,textContent:'',children:[],events:{},replaceChildren(){this.children=[];},append(child){this.children.push(child);},addEventListener(name,handler){this.events[name]=handler;}});
  return elements.get(id);
 };
 let postCount=0,version='2.8.126',reloads=0;
 const context=vm.createContext({
  document:{getElementById:get,createElement:()=>({style:{},addEventListener(){},append(){}})},
  setTimeout(callback){if(callback.toString().includes('location.reload'))callback();return 1;},
  setInterval(){},location:{reload(){reloads++;}}
 });
 const lostResponse=vm.runInContext("new TypeError('Failed to fetch')",context);
 context.fetch=async(url,options)=>{
  if(url==='/api/update/status')return {ok:true,json:async()=>({version,backups:[],remote:{feed:'https://example.com/manifest.json',enabled:false},watcher:{message:'준비'}})};
  if(url==='/api/update/check')return {ok:true,json:async()=>({version:'2.8.127',available:true})};
  if(url==='/api/update/remote'){
   assert.equal(options.method,'POST');postCount++;version='2.8.127';throw lostResponse;
  }
  throw Error('Unexpected request '+url);
 };
 vm.runInContext(source.slice(begin,end)+'\nglobalThis.bootUpdater=setupUpdater;',context);
 await context.bootUpdater();
 get('remote-enabled').checked=true;
 await get('remote-install').events.click();
 assert.equal(postCount,1,'the interrupted update must not be applied twice');
 assert.match(get('update-state').textContent,/v2\.8\.127 업데이트 완료/);
 assert.equal(reloads,1);
});
