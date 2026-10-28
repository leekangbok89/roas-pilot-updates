'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
test('legacy server embeds collector assets/extension and protects report imports by local action, origin and vendor',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'roas-ad-http-'));try{
 fs.copyFileSync(path.resolve(__dirname,'../server.js'),path.join(dir,'server.js'));
 const code=String.raw`
 const http=require('node:http'),assert=require('node:assert/strict');
 require('node:child_process').spawnSync=(command,args,options)=>{const decrypt=Buffer.from(args.at(-1),'base64').toString('utf16le').includes('::Unprotect');return {status:0,stdout:decrypt?Buffer.from(options.input,'base64').toString():Buffer.from(options.input).toString('base64')};};
 Object.defineProperty(process,'platform',{value:'win32'});global.fetch=async()=>{throw Error('No external traffic');};
 const {server}=require('./server');(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));try{
 const headers={host:'127.0.0.1:3000',origin:'http://127.0.0.1:3000','x-roas-local-action':'yes','content-type':'application/json'};
 const req=(url,body,custom=headers)=>new Promise((resolve,reject)=>{const r=http.request({hostname:'127.0.0.1',port:server.address().port,path:url,method:body===undefined?'GET':'POST',headers:custom},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>{const data=Buffer.concat(chunks);resolve({status:res.statusCode,data,text:data.toString(),headers:res.headers});});});r.on('error',reject);r.end(body===undefined?undefined:JSON.stringify(body));});
 for(const file of ['coupang-collector.html','coupang-collector.js','coupang-ad-reports.js'])assert.equal((await req('/'+file)).status,200);
 const zip=await req('/coupang-collector-extension.zip');assert.equal(zip.status,200);assert.equal(zip.headers['content-type'],'application/zip');assert.equal(zip.data.readUInt32LE(0),0x04034b50);assert.ok(zip.text.includes('manifest.json'));assert.ok(zip.text.includes('report-page.js'));
 await req('/api/coupang/credentials',{vendorId:'A00012345',accessKey:'SYNTHETIC-ACCESS',secretKey:'SYNTHETIC-SECRET'});
 const row={date:'2026-10-22',campaignId:'123',campaignName:'예시',placement:'검색 영역',impressions:10,clicks:1,spend:1000,orders1:1,quantity1:1,sales1:5000,orders14:2,quantity14:2,sales14:9000,advertisedItemId:'456',convertedItemId:'789',keyword:'예시'};
 const input={schema:'roas-coupang-ad-report-v1',vendorId:'A00012345',type:'pa',since:row.date,until:row.date,filename:'A00012345_pa_total_campaign_20261022_20261022.xlsx',rows:[row]};
 assert.equal((await req('/api/coupang/ads-import',input,{...headers,origin:'https://evil.invalid'})).status,403);
 assert.equal((await req('/api/coupang/ads-import',input,{host:'127.0.0.1:3000','content-type':'application/json'})).status,403);
 assert.equal((await req('/api/coupang/ads-import',{...input,vendorId:'A00099999'})).status,400);
 assert.equal((await req('/api/coupang/ads-import',input)).status,200);
 const result=await req('/api/coupang/advertisingReports?since=2026-10-22&until=2026-10-23');assert.equal(result.status,200);const r=JSON.parse(result.text);assert.equal(r.types.pa.available.spend,1000);assert.equal(r.types.pa.available.sales14,9000);assert.equal(r.types.pa.knownDays,1);assert.equal(r.types.nca.available.spend,null);assert.ok(!result.text.includes('SYNTHETIC-SECRET'));
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}})().catch(e=>{console.error(e);process.exitCode=1;});`;
 const r=spawnSync(process.execPath,['-e',code],{cwd:dir,env:{...process.env,WEB_PASSWORD:''},encoding:'utf8',timeout:15000});assert.equal(r.status,0,r.stdout+r.stderr);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
