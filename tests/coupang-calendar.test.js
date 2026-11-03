'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'../browser-extensions/coupang-collector/report-page.js'),'utf8');
test('calendar labels require a full date, including localized accessible labels',()=>{
 const context=vm.createContext({chrome:{runtime:{onMessage:{addListener(){}}}}});vm.runInContext(source+'\nglobalThis.parse=cellDate;',context);
 for(const value of ['2026-11-02','2026.11.2','2026년 11월 2일 월요일','Monday, November 2, 2026','Choose Monday, November 2nd, 2026'])assert.equal(context.parse(value),'2026-11-02',value);
 for(const value of ['2','11월','2026년 11월','조회 2026-11-02 합계','다음 달'])assert.equal(context.parse(value),null,value);
});
