'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');

const project=path.resolve(__dirname,'..');
const shellFiles=['app-shell.css','app-shell.js'];

function fixture(t,{copyAssets=false}={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'roas-shell-bundle-'));
  const serverFile=path.join(dir,'server.js');
  fs.copyFileSync(path.join(project,'server.js'),serverFile);
  fs.mkdirSync(path.join(dir,'public'));
  if(copyAssets)for(const name of shellFiles)fs.copyFileSync(path.join(project,'public',name),path.join(dir,'public',name));
  const app=require(serverFile);
  t.after(()=>{delete require.cache[serverFile];fs.rmSync(dir,{recursive:true,force:true});});
  const request=(url,method='GET')=>new Promise((resolve,reject)=>{
    const req={url,method,headers:{host:'127.0.0.1:3000'}};
    const result={status:null,headers:null,body:null};
    const res={writeHead(status,headers){result.status=status;result.headers=headers;},end(value){result.body=Buffer.isBuffer(value)?value.toString('utf8'):String(value??'');resolve(result);}};
    Promise.resolve(app.server.listeners('request')[0](req,res)).catch(reject);
  });
  return {dir,request};
}

test('legacy upgrade without either shared-shell file serves the exact current CSS and JS with normal static headers',async t=>{
  const f=fixture(t);
  for(const name of shellFiles){
    assert.equal(fs.existsSync(path.join(f.dir,'public',name)),false);
    const response=await f.request('/'+name+'?v=upgrade-check');
    assert.equal(response.status,200);
    assert.equal(response.body,fs.readFileSync(path.join(project,'public',name),'utf8'));
    assert.equal(response.headers['Content-Type'],name.endsWith('.css')?'text/css; charset=utf-8':'application/javascript; charset=utf-8');
    assert.equal(response.headers['Cache-Control'],'no-cache');
    assert.equal(response.headers['X-Content-Type-Options'],'nosniff');
    assert.equal(fs.existsSync(path.join(f.dir,'public',name)),false,'read fallback must not create files or alter the installation');
  }
});

test('installed shared-shell assets take precedence over bundled fallback',async t=>{
  const f=fixture(t,{copyAssets:true});
  for(const name of shellFiles){
    const data='/* installed '+name+' */\n';
    fs.writeFileSync(path.join(f.dir,'public',name),data);
    const response=await f.request('/'+name);
    assert.equal(response.status,200);
    assert.equal(response.body,data);
  }
});

test('fallback is restricted to the two exact paths and ENOENT and preserves other missing-file and method behavior',async t=>{
  const f=fixture(t);
  for(const url of ['/missing.css','/nested/app-shell.css','/app-shell.js/','/App-shell.js','/server.js','/../server.js','/toString.css']){
    const response=await f.request(url);
    assert.equal(response.status,404,url+' must not receive shell data');
    assert.deepEqual(JSON.parse(response.body),{error:'Not found'});
  }
  const post=await f.request('/app-shell.js','POST');
  assert.equal(post.status,405);
  fs.mkdirSync(path.join(f.dir,'public','app-shell.css'));
  const directory=await f.request('/app-shell.css');
  assert.equal(directory.status,404,'EISDIR must not silently substitute a bundled asset');
});

test('bundle generator detects stale content without writing and regenerates deterministically',t=>{
  const f=fixture(t,{copyAssets:true});
  fs.mkdirSync(path.join(f.dir,'scripts'));
  fs.copyFileSync(path.join(project,'scripts','bundle-shell.cjs'),path.join(f.dir,'scripts','bundle-shell.cjs'));
  const run=(...args)=>spawnSync(process.execPath,[path.join(f.dir,'scripts','bundle-shell.cjs'),...args],{encoding:'utf8'});
  assert.equal(run('--check').status,0,'committed bundle must match canonical source assets');
  const serverFile=path.join(f.dir,'server.js'),before=fs.readFileSync(serverFile,'utf8');
  fs.appendFileSync(path.join(f.dir,'public','app-shell.css'),'\n/* source changed */\n');
  const stale=run('--check');
  assert.notEqual(stale.status,0);
  assert.match(stale.stderr,/fallback is stale/);
  assert.equal(fs.readFileSync(serverFile,'utf8'),before,'--check must not rewrite source');
  assert.equal(run().status,0);
  const regenerated=fs.readFileSync(serverFile,'utf8');
  assert.notEqual(regenerated,before);
  assert.equal(run('--check').status,0);
  assert.equal(run().status,0);
  assert.equal(fs.readFileSync(serverFile,'utf8'),regenerated,'same input must produce byte-identical fallback');
});
