'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { spawnSync } = require('node:child_process');
test('real local diagnosis route classifies auth rejection without changing saved collection or exposing keys', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coupang-auth-http-'));
  try {
    fs.copyFileSync(path.resolve(__dirname, '../server.js'), path.join(dir, 'server.js'));
    const script = String.raw`
      const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
      require('node:child_process').spawnSync=(command,args,options)=>{
        assert.equal(command,'powershell.exe');
        const decrypt=Buffer.from(args.at(-1),'base64').toString('utf16le').includes('::Unprotect');
        return {status:0,stdout:decrypt?Buffer.from(options.input,'base64').toString():Buffer.from(options.input).toString('base64')};
      };
      Object.defineProperty(process,'platform',{value:'win32'});
      let calls=0;
      global.fetch=async(url,init)=>{
        assert.ok(String(url).startsWith('https://api-gateway.coupang.com/'));assert.equal(init.method,'GET');calls++;
        return String(url).includes('/rg/orders')?new Response(JSON.stringify({message:'Not allowed IP SYNTHETIC-SECRET'}),{status:403,headers:{'content-type':'application/json'}}):new Response(JSON.stringify({code:200,data:[]}),{status:200,headers:{'content-type':'application/json'}});
      };
      const app=require('./server');
      (async()=>{await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));try{
        const headers={host:'127.0.0.1:3000',origin:'http://127.0.0.1:3000','content-type':'application/json','x-roas-local-action':'yes'};
        const req=(route,body,custom=headers)=>new Promise((resolve,reject)=>{const r=http.request({hostname:'127.0.0.1',port:app.server.address().port,path:'/api/coupang/'+route,method:body===undefined?'GET':'POST',headers:custom},response=>{const chunks=[];response.on('data',c=>chunks.push(c));response.on('end',()=>resolve({status:response.statusCode,text:Buffer.concat(chunks).toString()}));});r.on('error',reject);r.end(body===undefined?undefined:JSON.stringify(body));});
        assert.equal((await req('diagnose')).status,405);
        assert.equal((await req('diagnose',{})).status,409);
        assert.equal((await req('diagnose',{}, {...headers,origin:'https://evil.invalid'})).status,403);
        assert.equal((await req('diagnose',{}, {host:'127.0.0.1:3000','content-type':'application/json'})).status,403);
        assert.equal(calls,0);
        assert.equal((await req('credentials',{vendorId:'A00012345',accessKey:'SYNTHETIC-ACCESS',secretKey:'SYNTHETIC-SECRET'})).status,200);
        const r=await req('diagnose',{channel:'all'});assert.equal(r.status,200);
        const d=JSON.parse(r.text);assert.equal(d.keysReadable,true);assert.equal(d.ok,false);assert.equal(d.checks.length,2);assert.equal(calls,2);
        const growth=d.checks.find(c=>c.channel==='growth'),seller=d.checks.find(c=>c.channel==='seller');
        assert.equal(growth.httpStatus,403);assert.equal(growth.category,'ip_not_allowed');assert.equal(growth.ok,false);assert.equal(seller.ok,true);
        assert.ok(!r.text.includes('SYNTHETIC-ACCESS'));assert.ok(!r.text.includes('SYNTHETIC-SECRET'));
        const status=await req('status');assert.equal(status.status,200);const state=JSON.parse(status.text);assert.equal(state.configured,true);assert.equal(state.connectionCheck.ok,false);
        const root=path.join('.roas-data','coupang','A00012345');assert.ok(!fs.existsSync(path.join(root,'orders')));assert.ok(!fs.existsSync(path.join(root,'history.json')));assert.ok(!fs.existsSync(path.join(root,'ledgers')));
      }finally{app.server.closeAllConnections();await new Promise(resolve=>app.server.close(resolve));}})().catch(error=>{console.error(error);process.exitCode=1;});
    `;
    const result = spawnSync(process.execPath, ['-e', script], { cwd: dir, env: { ...process.env, WEB_PASSWORD: '' }, encoding: 'utf8', timeout: 15000 });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
