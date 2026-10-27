'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { safeImageUrl, matchingContext, buildIndex, findThumbnail } = require('../public/coupang-thumbnails.js');
const imageUrl = 'https://image1.coupangcdn.com/image/vendor_inventory/example.jpg';
test('thumbnail URLs accept only secure Coupang image hosts without credentials or ports', () => {
  assert.equal(safeImageUrl(imageUrl), imageUrl);
  assert.equal(safeImageUrl('https://thumbnail7.coupangcdn.com/a.png#fragment'), 'https://thumbnail7.coupangcdn.com/a.png');
  for (const url of ['javascript:alert(1)', 'data:image/svg+xml,test', '//image1.coupangcdn.com/a.jpg', 'http://image1.coupangcdn.com/a.jpg', 'https://image1.coupangcdn.com.evil.invalid/a.jpg', 'https://evil.invalid/a.jpg', 'https://user:secret@image1.coupangcdn.com/a.jpg', 'https://image1.coupangcdn.com:8443/a.jpg']) assert.equal(safeImageUrl(url), null, url);
});
test('option thumbnails use exact IDs and product representatives never substitute a different option image', () => {
  const index = buildIndex([{ itemId:'123', productId:'700', thumbnailUrl:imageUrl }, {itemId:'456', productId:'701',thumbnailUrl:'javascript:bad'}]);
  assert.equal(findThumbnail(index, {itemId:'123',productId:'700'}),imageUrl);
  assert.equal(findThumbnail(index, {productId:'700'}),imageUrl);
  assert.equal(findThumbnail(index, {itemId:'999',productId:'700'}),null);
  assert.equal(findThumbnail(index, {productId:'701'}),null);
  assert.equal(matchingContext({vendorKey:'a',scopeKey:'s'}, {vendorKey:'b',scopeKey:'s'}),false);
  assert.equal(matchingContext({vendorKey:'a',scopeKey:'s'}, {vendorKey:'a',scopeKey:'other'}),false);
  assert.equal(matchingContext({}, {}),false);
});
class Element {
  constructor(tag) { this.tagName=tag; this.childNodes=[]; this.dataset={}; this.attributes={}; this.listeners={}; this.isConnected=true; this.classList={add:()=>{}}; }
  get firstChild(){return this.childNodes[0]||null;}
  append(...nodes){for(const node of nodes){if(node.parent){const list=node.parent.childNodes;list.splice(list.indexOf(node),1);}this.childNodes.push(node);node.parent=this;}}
  replaceChildren(...nodes){this.childNodes.forEach(node=>{node.parent=null;});this.childNodes=[];this.append(...nodes);}
  setAttribute(k,v){this.attributes[k]=v;}
  addEventListener(k,f){this.listeners[k]=f;}
}
function setup() {
  const calls=[],timers=[],cancelled=[],events={};
  const controls={'cth-refresh':new Element('button'),'cth-status':new Element('p')};
  const context=vm.createContext({URL,Map,Promise,document:{createElement:tag=>new Element(tag),getElementById:id=>controls[id]||null},window:{addEventListener:(event,handler)=>{events[event]=handler;}},fetch:(url,options)=>new Promise((resolve,reject)=>calls.push({url,options,resolve,reject})),setTimeout:(f,ms)=>{timers.push({f,ms});return timers.length;},clearTimeout:id=>{cancelled.push(id);}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/coupang-thumbnails.js'),'utf8'),context);
  return {api:context.window.CoupangThumbnails,calls,timers,cancelled,events,controls};
}
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const response=data=>({ok:true,json:async()=>data});
test('late image responses from a previous vendor cannot paint current product rows', async () => {
  const {api,calls}=setup(), container=new Element('td'); container.append(new Element('strong'));
  api.setContext({vendorKey:'a',scopeKey:'same'}); api.decorate(container,{itemId:'123'});
  api.setContext({vendorKey:'b',scopeKey:'same'}); api.decorate(container,{itemId:'123'});
  calls[0].resolve(response({configured:true,vendorKey:'a',scopeKey:'same',items:[{itemId:'123',thumbnailUrl:imageUrl}],needsSync:false,job:{running:false}}));
  await turn();
  const box=container.firstChild.firstChild;
  assert.equal(box.firstChild.tagName,'span');
  calls[1].resolve(response({configured:true,vendorKey:'b',scopeKey:'same',items:[{itemId:'123',thumbnailUrl:imageUrl}],needsSync:false,job:{running:false}}));
  await turn();assert.equal(box.firstChild.tagName,'img');
  assert.equal(box.firstChild.alt,'');assert.equal(box.firstChild.loading,'lazy');assert.equal(box.firstChild.referrerPolicy,'no-referrer');
  box.firstChild.listeners.error();assert.equal(box.firstChild.tagName,'span');assert.equal(box.dataset.state,'error');
  assert.equal(calls.length,2);
});
test('automatic image sync uses explicit vendor and scope and stops polling when idle', async () => {
  const {api,calls,timers}=setup();api.setContext({vendorKey:'a',scopeKey:'s'});
  calls[0].resolve(response({configured:true,vendorKey:'a',scopeKey:'s',items:[],needsSync:true,job:{running:false}}));await turn();
  assert.equal(calls.length,2);assert.equal(calls[1].options.method,'POST');assert.deepEqual(JSON.parse(calls[1].options.body),{vendorKey:'a',scopeKey:'s',force:false});
  calls[1].resolve(response({configured:true,vendorKey:'a',scopeKey:'s',items:[],needsSync:false,job:{running:true}}));await turn();
  assert.equal(timers.length,1);assert.equal(timers[0].ms,5000);
  timers[0].f();calls[2].resolve(response({configured:true,vendorKey:'a',scopeKey:'s',items:[],needsSync:false,job:{running:false}}));await turn();
  assert.equal(timers.length,1);assert.equal(calls.length,3);
});

test('back-forward cache restoration resumes observation after an interrupted sync start', async () => {
  const {api,calls,events,controls,timers}=setup();api.setContext({vendorKey:'a',scopeKey:'s'});
  calls[0].resolve(response({configured:true,vendorKey:'a',scopeKey:'s',items:[],needsSync:true,job:{running:false}}));await turn();
  assert.equal(calls[1].options.method,'POST');assert.equal(controls['cth-refresh'].disabled,true);
  events.pagehide({persisted:true});
  events.pageshow({persisted:true});
  assert.equal(calls.length,3,'restored page must re-read server job status even while old POST remains pending');
  calls[2].resolve(response({configured:true,vendorKey:'a',scopeKey:'s',items:[],needsSync:false,job:{running:true}}));await turn();
  assert.equal(timers.length,1);assert.equal(controls['cth-refresh'].disabled,true);
  calls[1].resolve(response({configured:true,vendorKey:'a',scopeKey:'s',items:[],needsSync:false,job:{running:false}}));await turn();
  assert.equal(controls['cth-refresh'].disabled,true,'late pre-navigation response must not overwrite current running job');
  timers[0].f();calls[3].resolve(response({configured:true,vendorKey:'a',scopeKey:'s',items:[],needsSync:false,job:{running:false}}));await turn();
  assert.equal(controls['cth-refresh'].disabled,false);assert.equal(timers.length,1);
});
test('transient polling errors recover a running job without leaving refresh permanently disabled', async () => {
  const {api,calls,timers,controls}=setup();api.setContext({vendorKey:'a',scopeKey:'s'});
  calls[0].resolve(response({configured:true,vendorKey:'a',scopeKey:'s',items:[],needsSync:false,job:{running:true}}));await turn();
  assert.equal(timers.length,1);timers[0].f();calls[1].reject(Error('temporary local connection failure'));await turn();
  assert.equal(timers.length,2,'known running job needs a bounded five-second retry');assert.equal(timers[1].ms,5000);
  assert.match(controls['cth-status'].textContent,/temporary local connection failure/);
  timers[1].f();calls[2].resolve(response({configured:true,vendorKey:'a',scopeKey:'s',items:[],needsSync:false,job:{running:false}}));await turn();
  assert.equal(controls['cth-refresh'].disabled,false);assert.equal(timers.length,2,'idle status must stop automatic retries');
  assert.ok(!controls['cth-status'].textContent.includes('temporary local connection failure'));
});
