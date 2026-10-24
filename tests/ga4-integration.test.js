'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {Readable}=require('node:stream');
const {spawnSync}=require('node:child_process');
const project=path.resolve(__dirname,'..');
const assets=['ga4.html','ga4.js','ga4.css'];

function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'roas-ga4-integration-'));
 const file=path.join(dir,'server.js');
 fs.copyFileSync(path.join(project,'server.js'),file);
 fs.mkdirSync(path.join(dir,'public'));
 const app=require(file);
 t.after(()=>{delete require.cache[file];fs.rmSync(dir,{recursive:true,force:true});});
 const request=(url,{method='GET',headers={},body=''}={})=>new Promise((resolve,reject)=>{
  const req=Readable.from(body?[Buffer.from(body)]:[]);
  Object.assign(req,{url,method,headers:{host:'127.0.0.1:3000',...headers}});
  const result={};
  const res={writeHead(status,values){result.status=status;result.headers=values;},end(value){result.body=Buffer.isBuffer(value)?value.toString('utf8'):String(value??'');resolve(result);}};
  Promise.resolve(app.server.listeners('request')[0](req,res)).catch(reject);
 });
 const write=(name,value)=>{const target=path.join(dir,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,typeof value==='string'?value:JSON.stringify(value));};
 return {dir,app,request,write};
}

test('legacy updater with server.js only serves GA4 UI and unconfigured status without installing extra files',async t=>{
 const f=fixture(t);
 for(const name of assets){
  const response=await f.request('/'+name+'?v=legacy');
  assert.equal(response.status,200);
  assert.equal(response.body,fs.readFileSync(path.join(project,'public',name),'utf8'));
  assert.equal(response.headers['Cache-Control'],'no-cache');
  assert.equal(response.headers['X-Content-Type-Options'],'nosniff');
  assert.equal(fs.existsSync(path.join(f.dir,'public',name)),false);
 }
 const status=await f.request('/api/ga4/status');
 assert.equal(status.status,200);
 assert.equal(JSON.parse(status.body).configured,false);
 assert.equal(status.headers['Cache-Control'],'no-store');
 assert.equal(fs.existsSync(path.join(f.dir,'.roas-private')),false);
 const report=await f.request('/api/ga4/report?since=2026-10-24&until=2026-10-24&scope=all');
 assert.ok(report.status>=400,'An unconnected property cannot return a zero-filled success report');
 assert.equal(Object.hasOwn(JSON.parse(report.body),'summary'),false);
});

test('GA4 routes reject cross-origin/host access and mutations without the local action header',async t=>{
 const f=fixture(t);
 for(const endpoint of ['/api/ga4/credentials','/api/ga4/test','/api/ga4/disconnect']){
  for(const headers of [{},{'x-roas-local-action':'yes',origin:'https://example.com'},{'x-roas-local-action':'yes',host:'untrusted.example:3000'}]){
   const response=await f.request(endpoint,{method:'POST',headers,body:'{}'});
   assert.equal(response.status,403,endpoint);
  }
  assert.equal((await f.request(endpoint)).status,405);
 }
 for(const endpoint of ['/api/ga4/status','/api/ga4/report']){
  assert.equal((await f.request(endpoint,{headers:{host:'untrusted.example:3000'}})).status,403);
  assert.equal((await f.request(endpoint,{headers:{origin:'https://example.com'}})).status,403);
  assert.equal((await f.request(endpoint,{method:'POST',headers:{'x-roas-local-action':'yes'}})).status,405);
 }
 assert.equal((await f.request('/api/ga4/missing')).status,404);
 assert.equal(fs.existsSync(path.join(f.dir,'.roas-private')),false);
});

test('credential request rejects oversized and malformed JSON without echoing sensitive input',async t=>{
 const f=fixture(t),headers={'x-roas-local-action':'yes','content-type':'application/json'};
 for(const body of ['{"private_key":"SYNTHETIC_SECRET"',JSON.stringify(['SYNTHETIC_SECRET'])]){
  const response=await f.request('/api/ga4/credentials',{method:'POST',headers,body});
  assert.equal(response.status,400);
  assert.equal(response.body.includes('SYNTHETIC_SECRET'),false);
 }
 const big=await f.request('/api/ga4/credentials',{method:'POST',headers,body:JSON.stringify({credentials:'SYNTHETIC_SECRET'+'x'.repeat(100*1024)})});
 assert.equal(big.status,413);
 assert.equal(big.body.includes('SYNTHETIC_SECRET'),false);
 assert.equal(fs.existsSync(path.join(f.dir,'.roas-private')),false);
});

test('GA4 fallback is limited to exact missing assets and installed files remain authoritative',async t=>{
 const f=fixture(t);
 for(const url of ['/nested/ga4.js','/Ga4.js','/ga4.js/','/integrations/ga4/client.cjs','/.roas-private/ga4.dpapi','/missing.html'])assert.equal((await f.request(url)).status,404,url);
 for(const name of assets){
  f.write('public/'+name,'installed '+name);
  assert.equal((await f.request('/'+name)).body,'installed '+name);
 }
 fs.unlinkSync(path.join(f.dir,'public','ga4.js'));
 fs.mkdirSync(path.join(f.dir,'public','ga4.js'));
 assert.equal((await f.request('/ga4.js')).status,404,'A non-file error cannot silently receive a bundled asset');
 assert.equal((await f.request('/ga4.html',{method:'POST'})).status,405);
});

test('Meta names join exact string IDs from selected-period cached ads without changing GA4 metrics or local data',t=>{
 const f=fixture(t),ad='120239876543210001',neighbor='120239876543210002';
 const snapshot=(date,rows)=>({account:'11111',date,currency:'KRW',rows});
 f.write('.roas-data/daily/11111/2026-10-24.json',snapshot('2026-10-24',[{ad_id:ad,ad_name:'이전 광고명',spend:'999'}]));
 f.write('.roas-data/daily/11111/2026-10-25.json',snapshot('2026-10-25',[{ad_id:ad,ad_name:'현재 광고명',spend:'777'},{ad_id:neighbor,ad_name:'다른 광고'}]));
 f.write('.roas-data/daily/11111/2026-10-26.json',snapshot('2026-10-26',[{ad_id:ad,ad_name:'기간 밖 광고명'}]));
 f.write('.roas-data/daily/22222/2026-10-25.json',{account:'WRONG',date:'2026-10-25',rows:[{ad_id:'120239876543210003',ad_name:'잘못된 계정'}]});
 f.write('.roas-private/preservation.dpapi','synthetic ciphertext');
 const file=path.join(f.dir,'.roas-data/daily/11111/2026-10-25.json'),before=fs.readFileSync(file,'utf8');
 const report={since:'2026-10-24',until:'2026-10-25',summary:{activeUsers:4,sessions:6,purchaseRevenue:null},acquisition:[{adContent:ad,sessions:3,activeUsers:3},{adContent:neighbor,sessions:2,activeUsers:3},{adContent:'120239876543210003',sessions:1},{adContent:'{{ad.id}}',sessions:1},{adContent:'(not set)',sessions:1},{adContent:'',sessions:1}],landingPages:[]};
 const original=structuredClone(report),result=f.app.ga4WithMetaNames(report);
 assert.equal(result.acquisition[0].metaAdName,'현재 광고명');
 assert.equal(result.acquisition[1].metaAdName,'다른 광고');
 assert.deepEqual(result.acquisition.map(row=>row.metaMatch),['matched','matched','unmatched','unmatched','missing_utm','missing_utm']);
 assert.deepEqual(result.summary,original.summary,'Do not recalculate non-additive users or restricted revenue');
 assert.deepEqual(report,original,'Do not mutate a cached GA4 report');
 assert.equal(Object.hasOwn(result.acquisition[0],'spend'),false,'A name match must not fabricate session-attributed ad spend');
 assert.equal(fs.readFileSync(file,'utf8'),before);
 assert.equal(fs.readFileSync(path.join(f.dir,'.roas-private/preservation.dpapi'),'utf8'),'synthetic ciphertext');
});

test('GA4 bundle generator checks both client and assets and regenerates deterministically',t=>{
 const f=fixture(t);
 fs.mkdirSync(path.join(f.dir,'scripts'));
 fs.mkdirSync(path.join(f.dir,'integrations','ga4'),{recursive:true});
 fs.copyFileSync(path.join(project,'scripts','bundle-ga4.cjs'),path.join(f.dir,'scripts','bundle-ga4.cjs'));
 fs.copyFileSync(path.join(project,'integrations','ga4','client.cjs'),path.join(f.dir,'integrations','ga4','client.cjs'));
 for(const name of assets)fs.copyFileSync(path.join(project,'public',name),path.join(f.dir,'public',name));
 const run=(...args)=>spawnSync(process.execPath,[path.join(f.dir,'scripts','bundle-ga4.cjs'),...args],{encoding:'utf8'});
 assert.equal(run('--check').status,0);
 const file=path.join(f.dir,'server.js'),before=fs.readFileSync(file,'utf8');
 fs.appendFileSync(path.join(f.dir,'integrations','ga4','client.cjs'),'\n// changed client\n');
 fs.appendFileSync(path.join(f.dir,'public','ga4.css'),'\n/* changed UI */\n');
 const stale=run('--check');
 assert.notEqual(stale.status,0);
 assert.equal(fs.readFileSync(file,'utf8'),before);
 assert.equal(run().status,0);
 assert.equal(run('--check').status,0);
 const regenerated=fs.readFileSync(file,'utf8');
 assert.notEqual(regenerated,before);
 assert.equal(run().status,0);
 assert.equal(fs.readFileSync(file,'utf8'),regenerated);
});
