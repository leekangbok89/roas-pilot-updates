'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {createService}=require('../integrations/monitoring/service.cjs');
function fixture(initial){
  const nodes=new Map(),listeners=new Map(),keywordNodes=[],reviewStars=[1,2,3,4,5].map(star=>({dataset:{reviewAlertStar:String(star)},checked:true}));
  function node(id){if(!nodes.has(id))nodes.set(id,{id,value:'',checked:false,hidden:false,innerHTML:'',textContent:'',dataset:{},addEventListener(type,fn){listeners.set(id+':'+type,fn);},setAttribute(){},elements:new Proxy({}, {get(_,key){return node(id+'.'+String(key));}})});return nodes.get(id);}
  const document={getElementById:node,addEventListener(type,fn){listeners.set('document:'+type,fn);},querySelectorAll(selector){if(selector==='[data-alert-keyword]:checked')return keywordNodes.filter(n=>n.checked);if(selector==='[data-alert-keyword]')return keywordNodes;if(selector==='[data-review-alert-star]:checked')return reviewStars.filter(n=>n.checked);return [];}};
  const context=vm.createContext({document,window:{addEventListener(){}},URL,Date,Intl,Number,Set,Map,Object,JSON,String,location:{href:'http://127.0.0.1:3000/daily-monitoring.html'},console});
  let source=fs.readFileSync(path.join(__dirname,'../public/daily-monitoring.js'),'utf8');
  source=source.replace(/  const params=new URL\(location.href\)\.searchParams;[^\n]+/,"  globalThis.api={hydrate,renderAlertSettings,captureAlertDraft,alertDraft,renderAlerts,select(id){selectedId=id;},product};");
  vm.runInContext(source,context);context.api.hydrate(initial);context.api.select(initial.products[0].id);
  return {api:context.api,node,listeners,keywordNodes};
}
function initial(alert){return {revision:0,products:[{id:'p',platform:'naver',productId:'123',name:'상품',keywords:[{keyword:'분유'},{keyword:'포트'}],alert}],folders:[],snapshots:[],reviews:[],alerts:[],settings:{}};}
test('legacy empty selection displays all when ranks are enabled, while clear all disables ranks independently of review alerts',t=>{
  const view=fixture(initial({enabled:true,keywords:[],threshold:10,mode:'daily',reviewEnabled:true,reviewStars:[1,2,3,4,5]}));
  view.api.renderAlertSettings(view.api.product());
  assert.equal((view.node('dm-alert-keywords').innerHTML.match(/ checked/g)||[]).length,2);
  view.listeners.get('dm-alert-select-none:click')();
  assert.equal(view.node('dm-alert-enabled').checked,false);
  assert.equal(view.node('dm-review-alert-enabled').checked,true);
  assert.equal((view.node('dm-alert-keywords').innerHTML.match(/ checked/g)||[]).length,0);
  view.api.captureAlertDraft();const {dirty,...settings}=JSON.parse(JSON.stringify(view.api.alertDraft(view.api.product())));
  assert.equal(settings.enabled,false);assert.deepEqual(settings.keywords,[]);assert.equal(settings.reviewEnabled,true);
  const baseDir=fs.mkdtempSync(path.join(os.tmpdir(),'monitor-alert-ui-'));t.after(()=>fs.rmSync(baseDir,{recursive:true,force:true}));
  const service=createService({baseDir,today:()=> '2026-10-29'});
  let saved=service.importData({revision:0,products:initial(settings).products,snapshots:[{productId:'p',date:'2026-10-28',keywords:[{keyword:'분유',rank:2}]}]});
  saved=service.importData({revision:saved.revision,snapshots:[{productId:'p',date:'2026-10-29',keywords:[{keyword:'분유',rank:1}]}],reviews:[{productId:'p',id:'review-1',date:'2026-10-29',rating:5,text:'실제 후기'}]});
  assert.deepEqual(saved.alerts.map(a=>a.kind),['review'],'cleared ranks generate no alerts but selected review alerts still work');
});
test('enabling ranks with no selection selects current keywords and unchecking the final keyword disables ranks',()=>{
  const view=fixture(initial({enabled:false,keywords:[],threshold:10,reviewEnabled:true}));
  view.api.renderAlertSettings(view.api.product());
  view.keywordNodes.push({dataset:{alertKeyword:'분유'},checked:false},{dataset:{alertKeyword:'포트'},checked:false});
  const target=view.node('dm-alert-enabled');target.checked=true;target.matches=()=>true;
  view.listeners.get('document:change')({target});
  const enabled=JSON.parse(JSON.stringify(view.api.alertDraft(view.api.product())));assert.equal(enabled.enabled,true);assert.deepEqual(enabled.keywords,['분유','포트']);
  view.keywordNodes.forEach(n=>{n.checked=false;});view.api.captureAlertDraft();assert.equal(target.checked,false);assert.equal(view.api.alertDraft(view.api.product()).enabled,false);
});
test('notification list displays review kind and actual old/outside rank fields from the service',()=>{
  const value=initial(false);value.alerts=[{id:'r',kind:'review',productId:'p',date:'2026-10-29',createdAt:'2026-10-29T00:00:00Z',readAt:null},{id:'k',kind:'rank',productId:'p',date:'2026-10-29',createdAt:'2026-10-29T00:00:00Z',keyword:'분유',rank:null,status:'outside',outsideLimit:80,oldRank:14,oldStatus:'ranked',readAt:null}];
  const view=fixture(value);view.api.renderAlerts();
  assert.match(view.node('dm-alerts-list').innerHTML,/새 리뷰가 수집되었습니다/);assert.match(view.node('dm-alerts-list').innerHTML,/80위 밖 \(이전 14위\)/);assert.equal(view.node('dm-alert-count').textContent,2);
});
