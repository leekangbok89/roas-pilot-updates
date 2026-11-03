'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require(process.env.ROAS_PLAYWRIGHT_MODULE||'playwright'),{createService}=require('../integrations/coupang/service.cjs');
const publicRoot=path.resolve(__dirname,'../public'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'campaign-import-ui-'));
const vendorId='A00012345',since='2026-10-27',until='2026-11-02',filename=vendorId+'_pa_daily_campaign_20261027_20261102.xlsx';
const service=()=>createService({baseDir:temp,protect:(mode,value)=>value,now:()=>Date.parse('2026-11-03T01:00:00Z')});let s=service();
s.saveCredentials({vendorId,accessKey:'SYNTHETIC-ACCESS',secretKey:'SYNTHETIC-SECRET'});
const headers=['날짜','과금 방식','광고 목표','판매방식','광고유형','캠페인 ID','캠페인명','노출수','클릭수','광고비','총 주문수(1일)','총 판매수량(1일)','총 전환매출액(1일)','총 주문수(14일)','총 판매수량(14일)','총 전환매출액(14일)'];
const days=Array.from({length:7},(_,index)=>new Date(Date.parse(since)+index*86400000).toISOString().slice(0,10));
const rows=days.flatMap((date,index)=>[0,1].map(campaign=>[
 date.replaceAll('-',''), '클릭당 과금','합성 광고 목표','합성 판매방식','합성 광고유형',campaign?'222':'111',campaign?'합성 캠페인 둘':'합성 캠페인 하나',100+index,5+campaign,100*(campaign+1)+index,1,1,1000*(campaign+1)+index,2,2,2000*(campaign+1)+index
]));
const expectedSpend=rows.reduce((sum,row)=>sum+row[9],0),escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
function zip(entries){
 let offset=0;const files=[],directory=[];
 const crc=data=>{let value=0xffffffff;for(const byte of data){value^=byte;for(let bit=0;bit<8;bit++)value=(value>>>1)^((value&1)?0xedb88320:0);}return (value^0xffffffff)>>>0;};
 for(const [name,source]of Object.entries(entries)){
  const data=Buffer.from(source),file=Buffer.from(name),local=Buffer.alloc(30),central=Buffer.alloc(46),sum=crc(data);
  local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt32LE(sum,14);local.writeUInt32LE(data.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(file.length,26);
  central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt32LE(sum,16);central.writeUInt32LE(data.length,20);central.writeUInt32LE(data.length,24);central.writeUInt16LE(file.length,28);central.writeUInt32LE(offset,42);
  files.push(local,file,data);directory.push(central,file);offset+=local.length+file.length+data.length;
 }
 const central=Buffer.concat(directory),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(directory.length/2,8);end.writeUInt16LE(directory.length/2,10);end.writeUInt32LE(central.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...files,central,end]);
}
function workbook(headerMode='inline',badDate){
 const col=index=>String.fromCharCode(65+index),strings=[],shared=value=>{const index=strings.length;strings.push(value);return index;};
 const header='<row r="1">'+headers.map((value,index)=>headerMode==='shared'?'<c r="'+col(index)+'1" t="s"><v>'+shared(value)+'</v></c>':'<c r="'+col(index)+'1" t="inlineStr"><is><t>'+escape(value)+'</t></is></c>').join('')+'</row>';
 const body=rows.map((row,index)=>'<row r="'+(index+2)+'">'+row.map((value,column)=>{
  const address=col(column)+(index+2);
  if(column===0){const raw=badDate&&index===rows.length-1?badDate:value[0]+'.'+value.slice(1).replace(/0+$/,'')+'E7';return '<c r="'+address+'" t="n" s="0"><v>'+raw+'</v></c>';}
  if(typeof value==='number'||column===5)return '<c r="'+address+'" t="n" s="0"><v>'+value+'</v></c>';
  return '<c r="'+address+'" t="inlineStr"><is><t>'+escape(value)+'</t></is></c>';
 }).join('')+'</row>').join('');
 const entries={
  'xl/workbook.xml':'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="합성 캠페인 보고서" r:id="r1"/></sheets></workbook>',
  'xl/_rels/workbook.xml.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
  'xl/styles.xml':'<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cellXfs count="1"><xf numFmtId="0"/></cellXfs></styleSheet>',
  'xl/worksheets/sheet1.xml':'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'+header+body+'</sheetData></worksheet>'
 };
 if(headerMode==='shared')entries['xl/sharedStrings.xml']='<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'+strings.map(value=>'<si><t>'+escape(value)+'</t></si>').join('')+'</sst>';
 return zip(entries);
}
let posts=0,posted=[],browser;
const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname.startsWith('/api/coupang/')){
   const endpoint=url.pathname.split('/').pop();let result;
   if(endpoint==='status')result={...s.status(),automatic:{enabled:false}};
   else if(endpoint==='advertisingReports')result=s.advertisingReports(Object.fromEntries(url.searchParams));
   else if(endpoint==='ads-import'){const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks));posts++;posted.push(body);result=s.importAdvertising(body);}
   else throw Error('Unexpected synthetic test route');
   res.setHeader('content-type','application/json');return res.end(JSON.stringify(result));
  }
  const file=path.resolve(publicRoot,'.'+url.pathname);if(!file.startsWith(publicRoot+path.sep))throw Error('Invalid synthetic test path');
  res.setHeader('content-type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file));
 }catch(error){res.statusCode=error.status||500;res.end(JSON.stringify({error:error.message}));}
});
const query=()=>s.advertisingReports({since,until}).types.pa;
const snapshot=()=>Object.fromEntries([...days.map(day=>'pa/'+day+'.json'),'revision.json'].map(relative=>[relative,fs.readFileSync(path.join(temp,'.roas-data','coupang',vendorId,'ad-reports',relative)).toString('base64')]));
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
 const page=await browser.newPage({viewport:{width:1300,height:1000}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(base+'/coupang-collector.html?since='+since+'&until='+until);
 async function upload(buffer){await page.locator('#cc-files').setInputFiles({name:filename,mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer});}
 async function saveValid(mode){
  await upload(workbook(mode));await page.evaluate(()=>{document.getElementById('cc-result').textContent='';document.getElementById('cc-statistics').replaceChildren();});const response=page.waitForResponse(result=>result.url().endsWith('/api/coupang/ads-import')&&result.request().method()==='POST');await page.locator('#cc-import').click();const result=await(await response).json();assert.equal(result.saved,true);assert.equal(result.days,7);assert.equal(result.rows,14);assert.deepEqual(result.dates,days);
  await page.waitForFunction(()=>document.getElementById('cc-result').textContent.includes('매출성장 보고서 7일 · 14행 저장 및 재조회 확인'));
  await page.waitForFunction(()=>document.getElementById('cc-statistics').textContent.includes('7/7일 저장'));
 }
 await saveValid('shared');assert.equal(posts,1);assert.equal(posted[0].reportLevel,'campaign');assert.equal(posted[0].rows.length,14);
 assert.ok(posted[0].rows.every(row=>row.advertisedItemId===null&&row.convertedItemId===null&&row.placement===''&&row.keyword===''));
 let saved=query();assert.equal(saved.knownDays,7);assert.equal(saved.complete,true);assert.equal(saved.campaigns.length,2);assert.equal(saved.available.spend,expectedSpend);assert.deepEqual(saved.daily.map(day=>day.date),days);
 for(let index=0;index<days.length;index++)assert.equal(saved.daily[index].spend,300+index*2);
 for(const day of days){const file=JSON.parse(fs.readFileSync(path.join(temp,'.roas-data','coupang',vendorId,'ad-reports','pa',day+'.json')));assert.equal(file.reportLevel,'campaign');assert.equal(file.rows.length,2);}
 s=service();assert.deepEqual(query(),saved,'campaign totals and all seven day files survive restart');
 await saveValid('inline');assert.equal(posts,2);assert.equal(query().available.spend,expectedSpend,'same report replaces each day instead of double-counting');assert.equal(query().campaigns.length,2);assert.equal(query().knownDays,7);
 const before=snapshot(),values=query();
 for(const invalid of [{raw:'2.0261103E7',message:'2026-11-03'},{raw:'2.02610275E7',message:'2.02610275E7'}]){
  const count=posts;await upload(workbook('inline',invalid.raw));await page.locator('#cc-import').click();
  await page.waitForFunction(raw=>document.getElementById('cc-result').textContent.includes(raw),invalid.message);
  const message=await page.locator('#cc-result').textContent();assert.match(message,/엑셀 15행/);assert.match(message,/2026-10-27 ~ 2026-11-02/);assert.equal(posts,count,'invalid raw date must be rejected before ads-import POST');assert.deepEqual(snapshot(),before,'invalid file must not change saved bytes');assert.deepEqual(query(),values,'invalid file must not change existing values');
 }
 assert.deepEqual(errors,[]);
 console.log('PASS synthetic seven-day campaign XLSX: raw general numeric scientific dates, shared/inline headers, real collector UI import/ACK, restart and replacement, row-specific invalid-date rejection before POST with stored bytes preserved. No user workbook or rows used.');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.rmSync(temp,{recursive:true,force:true});});
