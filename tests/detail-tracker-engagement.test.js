'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
test('tracker records visible engagement and image clicks for the correct section', () => {
  const events = [], handlers = {}, docHandlers = {}, rect = {top: 0, left: 0, right: 400, width: 400, height: 2000};
  const img = {complete:true, naturalWidth:400, naturalHeight:2000, isConnected:true,
    getBoundingClientRect:()=>rect, getClientRects:()=>[rect], closest:s=>s==='img,video'?img:null};
  const root = {querySelectorAll:s=>s==='img'?[img]:[], contains:e=>e===img, addEventListener:()=>{}, getBoundingClientRect:()=>rect};
  const document = {hidden:false, readyState:'complete', scripts:[], head:{appendChild:()=>{}}, querySelector:()=>root,
    createElement:()=>({}), addEventListener:(name,fn)=>{docHandlers[name]=fn;}};
  let clock=0, tick;
  const window = {ROAS_DETAIL_CONFIG:{measurementId:'G-ABC123',productId:'458',contentVersion:'v1'},
    location:{hostname:'wemamang.com',href:'https://wemamang.com/product/detail.html?product_no=458'},
    innerHeight:1000,innerWidth:500,gtag:(...args)=>events.push(args),getComputedStyle:()=>({visibility:'visible',opacity:'1'}),
    setInterval:fn=>{tick=fn;return 1;},setTimeout:()=>{},clearInterval:()=>{},addEventListener:(name,fn)=>{handlers[name]=fn;}};
  const context={window,document,URL,performance:{now:()=>clock},MutationObserver:class{observe(){} disconnect(){}},Set,WeakSet,Number,Array,Object,Math};
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/detail-tracker.js'),'utf8'),context);
  for(let i=0;i<11;i++){clock+=500;tick();}
  docHandlers.click({clientY:250,target:img});
  const named=name=>events.filter(e=>e[0]==='event'&&e[1]===name);
  assert.equal(named('rp_content_v2_view').length,1);assert.equal(named('rp_content_3s').length,1);assert.equal(named('rp_content_5s').length,1);
  assert.equal(named('rp_content_click').length,1);assert.equal(named('rp_content_click')[0][2].rp_content_id,'image_001_p01');
  document.hidden=true;docHandlers.visibilitychange();for(let i=0;i<8;i++){clock+=500;tick();}
  assert.equal(named('rp_content_5s').length,1);
});
