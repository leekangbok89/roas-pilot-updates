'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const engine=require('../public/gfa-data.js');
function metric(entries,key,since,until){
 const html=fs.readFileSync(require.resolve('../public/visual-overview.html'),'utf8');
 const start=html.indexOf('const gfaMetricKeys='),end=html.indexOf('let savedSummaryCardKeys=',start);
 const context={summaryCardMetrics:{gfaSpend:{}},metrics:{},window:{roasGfaData:engine}};vm.createContext(context);vm.runInContext(html.slice(start,end),context);
 context.entries=entries;context.key=key;context.dates=Array.from({length:(Date.parse(until)-Date.parse(since))/86400000+1},(_,i)=>new Date(Date.parse(since)+i*86400000).toISOString().slice(0,10));
 return vm.runInContext('overviewGfaEntries=entries;overviewGfaMetric(key,dates)',context);
}
const entries=[{kind:'ads',since:'2026-10-01',until:'2026-10-07',rows:[{name:'A',id:'1',spend:100000,purchases:5,revenue:1995000,clicks:500,impressions:10000}]},{kind:'channels',since:'2026-10-01',until:'2026-10-07',rows:[{since:'2026-10-01',until:'2026-10-07',gfa:true,visits:100,orders:2,sales:798000},{since:'2026-10-01',until:'2026-10-07',gfa:false,visits:1000,orders:20,sales:7980000}]}];
test('overview GFA uses selected channel sales and independent ad attribution with weighted period ROAS',()=>{
 assert.equal(metric(entries,'gfaDirectRevenue','2026-10-01','2026-10-07').value,798000);
 assert.equal(metric(entries,'gfaDirectRoas','2026-10-01','2026-10-07').value,798);
 assert.equal(metric(entries,'gfaIndirectRoas','2026-10-01','2026-10-07').value,1995);
 assert.equal(metric(entries,'gfaIndirectPurchases','2026-10-01','2026-10-07').value,5);
});
test('overview never invents daily GFA results from weekly totals; empty, incomplete and explicit zero remain distinct',()=>{
 assert.equal(metric(entries,'gfaDirectRevenue','2026-10-01','2026-10-01').value,null);
 assert.equal(metric(entries,'gfaIndirectPurchases','2026-10-01','2026-10-01').value,null);
 assert.equal(metric([],'gfaDirectRevenue','2026-10-01','2026-10-07').value,null);
 const zeros=JSON.parse(JSON.stringify(entries));zeros[1].rows[0].sales=0;
 assert.equal(metric(zeros,'gfaDirectRevenue','2026-10-01','2026-10-07').value,0);
 assert.equal(metric(zeros,'gfaDirectRoas','2026-10-01','2026-10-07').value,0);
 assert.equal(metric(entries,'gfaDirectRevenue','2026-10-01','2026-10-08').value,null);
});
