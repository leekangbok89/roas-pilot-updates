'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'../browser-extensions/coupang-collector/report-page.js'),'utf8');
function helper(){const context=vm.createContext({chrome:{runtime:{onMessage:{addListener(){}}}}});vm.runInContext(source+'\nglobalThis.mapDays=mapCalendarDays;',context);return context.mapDays;}
function grid(year,month){const first=new Date(Date.UTC(year,month-1,1)),start=first.getTime()-first.getUTCDay()*86400000;return Array.from({length:42},(_,i)=>new Date(start+i*86400000));}
test('calendar grid mapping validates the previous/current/next month sequence across year and leap boundaries',()=>{
 const map=helper();for(const [year,month]of [[2026,10],[2026,11],[2026,12],[2027,1],[2024,2]]){
  const dates=grid(year,month),actual=map(year,month,dates.map(date=>date.getUTCDate()));
  assert.ok(actual,year+'-'+month);assert.deepEqual(Array.from(actual),dates.map(date=>date.toISOString().slice(0,10)));
 }
});
test('calendar grid mapping rejects malformed days and ambiguous short/nonconsecutive numeric rows',()=>{
 const map=helper(),days=grid(2026,11).map(date=>date.getUTCDate());
 for(const invalid of [[1,2,3],days.map((day,i)=>i===15?31:day),days.map((day,i)=>i===10?0:day),days.map((day,i)=>i===20?1.5:day)])assert.equal(map(2026,11,invalid),null);
 assert.equal(map(2026,13,days),null);assert.equal(map(2026,0,days),null);
});
