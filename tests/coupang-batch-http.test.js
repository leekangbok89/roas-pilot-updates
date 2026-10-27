'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { spawnSync } = require('node:child_process');

test('embedded legacy runtime imports a batch from the authenticated local route and rejects an invalid later date', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coupang-batch-http-'));
  try {
    fs.copyFileSync(path.resolve(__dirname, '../server.js'), path.join(dir, 'server.js'));
    const script = String.raw`
      const assert = require('node:assert/strict'), http = require('node:http');
      require('node:child_process').spawnSync = (command, args, options) => {
        assert.equal(command, 'powershell.exe');
        const decrypt = Buffer.from(args.at(-1), 'base64').toString('utf16le').includes('::Unprotect');
        return {status:0, stdout:decrypt?Buffer.from(options.input,'base64').toString():Buffer.from(options.input).toString('base64')};
      };
      Object.defineProperty(process, 'platform', {value:'win32'});
      global.fetch=async()=>{throw Error('External traffic forbidden in test');};
      const app=require('./server');
      (async()=>{
        await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
        try {
          const headers={host:'127.0.0.1:3000',origin:'http://127.0.0.1:3000','content-type':'application/json','x-roas-local-action':'yes'};
          const req=(route,body,custom=headers)=>new Promise((resolve,reject)=>{
            const request=http.request({hostname:'127.0.0.1',port:app.server.address().port,path:route,method:body===undefined?'GET':'POST',headers:custom},response=>{
              const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>resolve({status:response.statusCode,text:Buffer.concat(chunks).toString()}));
            });request.on('error',reject);request.end(body===undefined?undefined:JSON.stringify(body));
          });
          assert.equal((await req('/api/coupang/sales-import-batch',{}, {...headers,origin:'https://evil.invalid'})).status,403);
          assert.equal((await req('/api/coupang/sales-import-batch',{}, {host:'127.0.0.1:3000','content-type':'application/json'})).status,403);
          assert.equal((await req('/api/coupang/credentials',{vendorId:'A00012345',accessKey:'SYNTHETIC-ACCESS',secretKey:'SYNTHETIC-SECRET'})).status,200);
          const row={itemId:'123',productId:'456',channel:'growth',name:'예시 상품',quantity:3,adQuantity:1,organicQuantity:2,sales:30000,profitBeforeAds:16000,advertising:3000,adSales:10000,adProfitBeforeAds:5001};
          const date='2026-10-25';
          const data={schema:'roas-coupang-sales-v1',includeProducts:true,reports:[{date,rows:[row]}]};
          const saved=await req('/api/coupang/sales-import-batch',data);assert.equal(saved.status,200);assert.equal(JSON.parse(saved.text).addedProducts,1);
          assert.equal((await req('/api/coupang/sales-import-batch',{...data,reports:[{date,rows:[{...row,sales:1}]},{date:'2026-10-26',rows:[{...row,advertising:-1}]}]})).status,400);
          const r=await req('/api/coupang/analytics?since='+date+'&until='+date+'&channel=all&view=sales');assert.equal(r.status,200);
          const report=JSON.parse(r.text);assert.equal(report.summary.sales,30000);assert.equal(report.summary.sourceNetProfit,13000);assert.equal(report.summary.adNetProfit,2001);assert.equal(report.summary.nonAdvertisingCosts,14000);assert.equal(report.items.length,1);
          assert.equal((await req('/api/coupang/refresh')).status,405);
          assert.equal((await req('/api/coupang/refresh',{}, {...headers,origin:'https://evil.invalid'})).status,403);
          assert.equal((await req('/api/coupang/refresh',{channels:['unknown']})).status,400);
          global.fetch=async()=>({ok:true,json:async()=>({code:200,data:[]})});
          const refresh=await req('/api/coupang/refresh',{channels:['growth']});assert.equal(refresh.status,200);assert.equal(JSON.parse(refresh.text).started,true);
          let state;
          for(let attempt=0;attempt<50;attempt++){state=JSON.parse((await req('/api/coupang/status')).text);if(!state.automatic.running)break;await new Promise(resolve=>setTimeout(resolve,10));}
          assert.equal(state.automatic.status,'completed');assert.equal(state.automatic.channels.growth.savedDays.length,7);
          assert.ok(state.automatic.lastFinishedAt);assert.ok(!JSON.stringify(state).includes('SYNTHETIC-SECRET'));
        } finally {app.server.closeAllConnections();await new Promise(resolve=>app.server.close(resolve));}
      })().catch(error=>{console.error(error);process.exitCode=1;});
    `;
    const result = spawnSync(process.execPath, ['-e', script], { cwd: dir, env: { ...process.env, WEB_PASSWORD: '' }, encoding: 'utf8', timeout: 15000 });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
