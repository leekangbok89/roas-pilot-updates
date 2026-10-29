'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function fixture(){
 const links=['/coupang-sales.html','/coupang-products.html#cpm-groups-title','/coupang-collector.html','/daily-monitoring.html','/visual-overview.html','/monitoring-collector.html'].map(href=>({href,getAttribute(){return this.href;},setAttribute(name,value){if(name==='href')this.href=value;}}));
 const context=vm.createContext({URL,URLSearchParams,Date,Intl,Number,Set,Map,Object,JSON,String,location:{pathname:'/coupang-dashboard.html',search:'',hash:'',origin:'http://127.0.0.1:3000'},window:{},localStorage:{getItem(){return null;}},document:{readyState:'loading',documentElement:{dataset:{},style:{}},addEventListener(){},querySelectorAll(){return links;}}});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/app-shell.js'),'utf8'),context);
 return {api:context.window.ROASCoupangNavigation,links};
}
test('growth context preserves explicit period, delivery and group across new header routes and hashes',()=>{
 const {api,links}=fixture();api.update({since:'2026-10-01',until:'2026-10-28',channel:'seller',group:'camping'});
 for(const link of links.slice(0,3)){const url=new URL(link.href,'http://127.0.0.1:3000');assert.equal(url.searchParams.get('since'),'2026-10-01');assert.equal(url.searchParams.get('until'),'2026-10-28');assert.equal(url.searchParams.get('channel'),'seller');assert.equal(url.searchParams.get('group'),'camping');}
 assert.equal(new URL(links[1].href,'http://127.0.0.1:3000').hash,'#cpm-groups-title');
 assert.equal(links[3].href,'/daily-monitoring.html');assert.equal(links[4].href,'/visual-overview.html');
 assert.equal(links[5].href,'/monitoring-collector.html');
 api.update({since:'2026-10-20',until:'2026-10-28',channel:'all'});
 assert.equal(new URL(links[0].href,'http://127.0.0.1:3000').searchParams.has('group'),false,'clearing group does not resurrect old context');
});
test('invalid context cannot leak arbitrary values to monitoring, legacy or external destinations',()=>{
 const {api}=fixture();
 const invalid=api.href('/coupang-ads.html#ca-import',{since:'2026-02-30',until:'bad',channel:'unknown',group:'<script>'});
 assert.equal(invalid,'/coupang-ads.html#ca-import');
 assert.equal(api.href('/daily-monitoring.html?product=naver-1',{since:'2026-10-01'}),'/daily-monitoring.html?product=naver-1');
 assert.equal(api.href('/monitoring-collector.html?platform=naver',{since:'2026-10-01',channel:'seller'}),'/monitoring-collector.html?platform=naver');
 assert.equal(api.href('https://example.com/coupang-sales.html',{since:'2026-10-01'}),'https://example.com/coupang-sales.html');
});
