'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { spawnSync } = require('node:child_process');

test('legacy installs serve Coupang workspace pages and authenticate analytics, edits and imports', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coupang-analytics-http-'));
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
          for(const asset of ['coupang-dashboard.html','coupang-sales.html','coupang-analytics.js','coupang-analytics.css','coupang-sheets.js','coupang-products.html','coupang-products.js','coupang-products.css','coupang-ads.html','coupang-ads.js','coupang-ads.css','coupang-thumbnails.js','coupang-thumbnails.css']) {
            const r=await req('/'+asset);assert.equal(r.status,200,asset);assert.ok(r.text.length>100,asset+' must exist in embedded upgrade assets');
          }
          assert.equal((await req('/api/coupang/analytics?since=2026-10-25&until=2026-10-25')).status,409);
          const imageStatus=await req('/api/coupang/thumbnails');assert.equal(imageStatus.status,200);assert.equal(JSON.parse(imageStatus.text).configured,false);
          assert.equal((await req('/api/coupang/thumbnails',{}, {...headers,origin:'https://evil.invalid'})).status,403);
          assert.equal((await req('/api/coupang/thumbnails',{}, {host:'127.0.0.1:3000','content-type':'application/json'})).status,403);

          assert.equal((await req('/api/coupang/analytics',{})).status,405);
          assert.equal((await req('/api/coupang/sales-import',{}, {...headers,origin:'https://evil.invalid'})).status,403);
          assert.equal((await req('/api/coupang/sales-import',{}, {host:'127.0.0.1:3000','content-type':'application/json'})).status,403);
          assert.equal((await req('/api/coupang/credentials',{vendorId:'A00012345',accessKey:'SYNTHETIC-ACCESS',secretKey:'SYNTHETIC-SECRET'})).status,200);
          assert.equal((await req('/api/coupang/catalog-import',{products:[{itemId:'123',productId:'456',name:'예시 상품',channel:'growth',unitCost:1000,commissionRate:10,inboundFee:100,deliveryFee:200}]})).status,200);
          const workspace=JSON.parse((await req('/api/coupang/workspace')).text);
          assert.equal(workspace.configured,true);assert.equal(workspace.products.length,1);
          const configuredImages=JSON.parse((await req('/api/coupang/thumbnails')).text);assert.equal(configuredImages.vendorKey,workspace.vendorKey);assert.equal(configuredImages.scopeKey,workspace.scopeKey);
          assert.equal((await req('/api/coupang/thumbnails',{vendorKey:'wrong-vendor',scopeKey:workspace.scopeKey})).status,409);

          assert.equal((await req('/api/coupang/workspace',{})).status,405);
          assert.equal((await req('/api/coupang/product-update')).status,405);
          const edit={scopeKey:workspace.scopeKey,revision:workspace.revision,itemId:'123',unitCost:2000,commissionRate:10,inboundFee:100,deliveryFee:200,costSince:null};
          assert.equal((await req('/api/coupang/product-update',edit,{host:'127.0.0.1:3000','content-type':'application/json'})).status,403);
          const updated=await req('/api/coupang/product-update',edit);assert.equal(updated.status,200);
          assert.equal(JSON.parse(updated.text).scopeKey,workspace.scopeKey);
          assert.equal((await req('/api/coupang/product-update',edit)).status,409);
          const groupEdit={scopeKey:workspace.scopeKey,revision:JSON.parse(updated.text).revision,groups:[{id:'example',name:'예시 그룹',itemIds:['123']}]};
          assert.equal((await req('/api/coupang/groups',groupEdit,{...headers,origin:'https://evil.invalid'})).status,403);
          const grouped=await req('/api/coupang/groups',groupEdit);assert.equal(grouped.status,200);
          assert.equal(JSON.parse(grouped.text).groups[0].name,'예시 그룹');
          assert.equal((await req('/api/coupang/groups',groupEdit)).status,409);
          const data={date:'2026-10-25',rows:[{itemId:'123',productId:'456',channel:'growth',name:'예시 상품',quantity:3,adQuantity:1,organicQuantity:2,sales:30000,profitBeforeAds:16000,advertising:3000,adSales:10000,adProfitBeforeAds:5000}],acquisitionAdvertising:{growth:1000,seller:0}};
          for(let i=0;i<2;i++)assert.equal((await req('/api/coupang/sales-import',data)).status,200);
          const r=await req('/api/coupang/analytics?since=2026-10-25&until=2026-10-25&channel=growth');assert.equal(r.status,200);
          const report=JSON.parse(r.text);assert.equal(report.summary.sales,30000);assert.equal(report.summary.sourceNetProfit,13000);assert.equal(report.summary.netProfit,12000);assert.equal(report.items.length,1);assert.equal(report.items[0].productId,'456');
          assert.equal((await req('/api/coupang/analytics?since=2026-10-25&until=2026-10-25&channel=invalid')).status,400);
          // All-group writes stay within the advertised 100 groups x 500 options capacity.
          const many=Array.from({length:499},(_,i)=>({itemId:'1111111111111111'+String(i).padStart(3,'0'),productId:'456',name:'규모 검증',channel:'growth',unitCost:1000,commissionRate:10,inboundFee:0,deliveryFee:0}));
          assert.equal((await req('/api/coupang/catalog-import',{products:many})).status,200);
          const largeWorkspace=JSON.parse((await req('/api/coupang/workspace')).text);
          const largeGroups=Array.from({length:100},(_,i)=>({id:'g'+i,name:'검증 그룹 '+i,itemIds:largeWorkspace.products.map(p=>p.itemId)}));
          const largeBody={scopeKey:largeWorkspace.scopeKey,revision:largeWorkspace.revision,groups:largeGroups};
          assert.ok(Buffer.byteLength(JSON.stringify(largeBody))>262144);
          const largeSaved=await req('/api/coupang/groups',largeBody);assert.equal(largeSaved.status,200);
          assert.equal(JSON.parse(largeSaved.text).groups.length,100);

        } finally {app.server.closeAllConnections();await new Promise(resolve=>app.server.close(resolve));}
      })().catch(error=>{console.error(error);process.exitCode=1;});
    `;
    const result = spawnSync(process.execPath, ['-e', script], { cwd: dir, env: { ...process.env, WEB_PASSWORD: '' }, encoding: 'utf8', timeout: 15000 });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
