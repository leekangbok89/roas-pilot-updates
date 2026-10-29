'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawnSync } = require('node:child_process');
const project = path.resolve(__dirname, '..');
const assets = ['daily-monitoring.html', 'daily-monitoring.js', 'daily-monitoring.css', 'monitoring-import.js', 'monitoring-export.js', 'monitoring-extract.js', 'monitoring-collector.html', 'monitoring-collector.js'];

function temporary(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roas-monitoring-http-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.copyFileSync(path.join(project, 'server.js'), path.join(dir, 'server.js'));
  return dir;
}
async function fixture(t) {
  const dir = temporary(t), filename = path.join(dir, 'server.js'), app = require(filename);
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    app.server.closeAllConnections();
    await new Promise(resolve => app.server.close(resolve));
    delete require.cache[filename];
  });
  const headers = { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000', 'content-type': 'application/json', 'x-roas-local-action': 'yes' };
  if (process.env.WEB_PASSWORD) headers.authorization = 'Basic ' + Buffer.from('admin:' + process.env.WEB_PASSWORD).toString('base64');
  const request = (route, { method = 'GET', body, requestHeaders = headers, raw = false, pathname } = {}) => new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: app.server.address().port, path: pathname || '/api/monitoring/' + route, method, headers: requestHeaders }, response => {
      const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('error', reject);
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        try { resolve({ status: response.statusCode, headers: response.headers, text, bytes:Buffer.concat(chunks), body: raw ? text : JSON.parse(text) }); } catch (error) { reject(error); }
      });
    });
    req.on('error', reject); req.end(body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body));
  });
  return { dir, headers, request, post: (route, body, options = {}) => request(route, { ...options, method: 'POST', body }) };
}

test('monitoring HTTP persists folders, products, keywords, settings, observations and archives with revision conflicts', async t => {
  const { dir, request, post } = await fixture(t);
  let response = await request('state');
  assert.equal(response.status, 200); assert.equal(response.body.revision, 0); assert.deepEqual(response.body.products, []); assert.deepEqual(response.body.snapshots, []);
  response = await post('folder', { revision: 0, folder: { id: 'brand', name: '위마망' } });
  assert.equal(response.status, 200); assert.equal(response.body.revision, 1);
  response = await post('product', { revision: 1, product: { id: 'naver-1', platform: 'naver', productId: '13684236835', name: '백도씨', folderId: 'brand', price: null } });
  assert.equal(response.status, 200); assert.equal(response.body.revision, 2); assert.equal(response.body.products[0].price, null);
  response = await post('keywords', { revision: 2, id: 'naver-1', keywords: [{ keyword: '분유제조기', searchVolume: 8450 }] });
  assert.equal(response.status, 200); assert.equal(response.body.revision, 3);
  response = await post('settings', { revision: 3, settings: { expanded: true, orientation: 'vertical', rankOptions: { normal: true, group: true, ads: false, adCount: false } } });
  assert.equal(response.status, 200); assert.equal(response.body.revision, 4);
  response = await post('import', { revision: 4, source: '합성 HTTP 검증 자료', snapshots: [{ productId: 'naver-1', date: '2000-01-02', reviews: 0, keywords: [{ keyword: '분유제조기', rank: 2, groupRank: 1 }] }] });
  assert.equal(response.status, 200); assert.equal(response.body.revision, 5); assert.equal(response.body.snapshots[0].reviews, 0);
  response = await post('import', { revision: 5, snapshots: [{ platform: 'naver', productId: '13684236835', date: '2000-01-02', price: 399000, keywords: [{ keyword: '분유제조기', adRank: 4 }] }] });
  assert.equal(response.status, 200); assert.equal(response.body.revision, 6); assert.equal(response.body.snapshots.length, 1);
  assert.equal(response.body.snapshots[0].keywords[0].rank, 2); assert.equal(response.body.snapshots[0].keywords[0].adRank, 4); assert.equal(response.body.snapshots[0].reviews, 0);
  const conflicting = await post('product', { revision: 1, product: { id: 'naver-1', favorite: true } });
  assert.equal(conflicting.status, 409); assert.match(conflicting.body.error, /변경/);
  response = await post('order', { revision: 6, ids: ['naver-1'] });
  assert.equal(response.status, 200); assert.equal(response.body.revision, 7);
  response = await post('archive', { revision: 7, id: 'naver-1' });
  assert.equal(response.status, 200); assert.equal(response.body.revision, 8); assert.equal(response.body.products[0].archived, true);
  response = await post('product', { revision: 8, product: { id: 'naver-1', archived: false, favorite: true } });
  assert.equal(response.status, 200); assert.equal(response.body.revision, 9); assert.equal(response.body.products[0].archived, false);
  const saved = (await request('state')).body;
  assert.equal(saved.revision, 9); assert.equal(saved.settings.orientation, 'vertical'); assert.equal(saved.products[0].favorite, true); assert.equal(saved.snapshots.length, 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, '.roas-data', 'daily-monitoring', 'state.json'), 'utf8')), saved);
  assert.deepEqual(fs.readdirSync(path.join(dir, '.roas-data')), ['daily-monitoring'], 'monitoring must stay isolated from sales and ad ledgers');
});

test('monitoring collector HTTP protects its local bridge, persists acknowledgements and serves a bounded extension', async t=>{
  const {request,post,headers}=await fixture(t);
  const status=await request('collector/status');assert.equal(status.status,200);assert.equal(status.body.running,false);assert.equal('token' in status.body,false);
  assert.equal((await request('collector/connect')).status,405);
  assert.equal((await post('collector/connect',{}, {requestHeaders:{...headers,origin:'https://sellha.kr'}})).status,403);
  assert.equal((await post('collector/__proto__',{})).status,404);
  const start=await post('collector/start',{mode:'full',platform:'naver'});assert.equal(start.status,200);assert.equal(start.body.total,1);
  const connection=await post('collector/connect',{});assert.equal(connection.status,200);assert.match(connection.body.token,/^[a-f0-9]{64}$/);
  const token=connection.body.token,job=(await post('collector/job',{token})).body.job;
  assert.equal(job.type,'list');assert.equal(job.url,'https://sellha.kr/monitoring/day/naver');
  const detailUrl='https://sellha.kr/monitoring/day/naver?productId=123&classificationType=product&isTeamProduct=false';
  const payload={products:[{platform:'naver',productId:'123',name:'검증 상품',sourceUrl:detailUrl}],snapshots:[]};
  const result=await post('collector/result',{token,runId:job.runId,jobId:job.id,sourceUrl:job.url,payload});
  assert.equal(result.status,200);assert.equal(result.body.products,1);assert.equal(result.body.status.completed,1);assert.equal(result.body.status.total,2);
  assert.equal((await request('state')).body.products[0].name,'검증 상품');
  assert.equal((await post('collector/result',{token,runId:job.runId,jobId:job.id,sourceUrl:job.url,payload})).body.alreadySaved,true);
  assert.equal((await post('collector/pause',{})).status,200);assert.equal((await post('collector/job',{token})).status,401);
  const state=(await request('state')).body;assert.equal((await post('alerts-ack',{revision:state.revision,ids:[]})).status,200);
  const download=await request('',{pathname:'/monitoring-collector-extension.zip',raw:true});assert.equal(download.status,200);assert.equal(download.headers['content-type'],'application/zip');
  const files=new Map();let offset=0;while(download.bytes.readUInt32LE(offset)===0x04034b50){const size=download.bytes.readUInt32LE(offset+18),nameLength=download.bytes.readUInt16LE(offset+26),extraLength=download.bytes.readUInt16LE(offset+28),start=offset+30+nameLength+extraLength;const name=download.bytes.subarray(offset+30,offset+30+nameLength).toString();files.set(name,download.bytes.subarray(start,start+size).toString());offset=start+size;}
  assert.equal(files.get('extract.js'),fs.readFileSync(path.join(project,'public/monitoring-extract.js'),'utf8'));
  const manifest=JSON.parse(files.get('manifest.json'));assert.equal(manifest.manifest_version,3);assert.ok(!manifest.permissions.includes('cookies'));assert.ok(!manifest.permissions.includes('debugger'));
  assert.deepEqual(manifest.host_permissions,['https://sellha.kr/*','http://127.0.0.1:3000/*','http://localhost:3000/*']);
});

test('monitoring HTTP write protection and method guards reject unauthorized or malformed requests without mutation', async t => {
  const { request, post, headers } = await fixture(t);
  const payload = { revision: 0, product: { platform: 'naver', productId: '1', name: '검증 상품' } };
  for (const invalid of [{ ...headers, origin: 'https://outside.invalid' }, { ...headers, host: 'outside.invalid:3000' }, { ...headers, host: '127.0.0.1:3001' }, { ...headers, 'x-roas-local-action': '' }]) {
    const response = await post('product', payload, { requestHeaders: invalid });
    assert.equal(response.status, 403); assert.equal(typeof response.body.error, 'string');
  }
  const withoutHeader = { ...headers }; delete withoutHeader['x-roas-local-action'];
  assert.equal((await post('product', payload, { requestHeaders: withoutHeader })).status, 403);
  assert.equal((await post('state', {})).status, 405);
  for (const method of ['GET', 'PUT', 'DELETE', 'PATCH']) assert.equal((await request('product', { method })).status, 405);
  for (const route of ['unknown', '__proto__', 'constructor', 'toString']) assert.equal((await post(route, {})).status, 404, route);
  assert.equal((await post('product', '{"revision":0,')).status, 400);
  assert.equal((await post('product', [])).status, 400);
  assert.equal((await post('product', { product: payload.product })).status, 400);
  const initial = (await request('state')).body;
  assert.equal(initial.revision, 0); assert.deepEqual(initial.products, []); assert.deepEqual(initial.snapshots, []);
  const restore = await post('import', { revision: 0, folders: [{ id: 'restore-folder', name: '복원 폴더' }], settings: { expanded: true }, products: [{ ...payload.product, id: 'restored', folderId: 'restore-folder' }], snapshots: [{ productId: 'restored', date: '2000-01-02', keywords: [{ keyword: '복원 키워드', rank: null, status: 'pending' }] }] });
  assert.equal(restore.status, 200); assert.equal(restore.body.folders[0].id, 'restore-folder'); assert.equal(restore.body.settings.expanded, true);
  const invalidRestore = await post('import', { revision: 1, folders: [{ id: 'rollback-folder', name: '취소 대상' }], products: [{ platform: 'naver', productId: '2', name: '잘못된 상품', folderId: 'missing-folder' }] });
  assert.equal(invalidRestore.status, 404);
  assert.deepEqual((await request('state')).body, restore.body, 'invalid links must roll back folder and product changes together');
});

test('monitoring assets serve exact embedded release content with no installed public files', async t => {
  const { dir, request } = await fixture(t);
  assert.equal(fs.existsSync(path.join(dir, 'public')), false);
  for (const name of assets) {
    const response = await request('', { pathname: '/' + name + '?v=legacy-upgrade', raw: true });
    assert.equal(response.status, 200, name);
    assert.equal(response.text, fs.readFileSync(path.join(project, 'public', name), 'utf8'), name);
    assert.equal(response.headers['content-type'], name.endsWith('.html') ? 'text/html; charset=utf-8' : name.endsWith('.css') ? 'text/css; charset=utf-8' : 'application/javascript; charset=utf-8');
    assert.equal(response.headers['cache-control'], 'no-cache'); assert.equal(response.headers['x-content-type-options'], 'nosniff');
  }
  assert.equal(fs.existsSync(path.join(dir, 'public')), false, 'serving bundled assets must not rewrite installed files');
  for (const pathname of ['/nested/daily-monitoring.js', '/Daily-monitoring.html', '/missing-monitoring.js']) assert.equal((await request('', { pathname, raw: true })).status, 404);
  assert.equal((await request('', { pathname: '/daily-monitoring.js', method: 'POST', body: {}, raw: true })).status, 405);
});

test('monitoring bundle check detects stale backend and assets without mutation and regeneration is deterministic', t => {
  const dir = temporary(t);
  fs.mkdirSync(path.join(dir, 'scripts'));
  fs.mkdirSync(path.join(dir, 'public'));
  fs.mkdirSync(path.join(dir, 'integrations', 'monitoring'), { recursive: true });
  fs.copyFileSync(path.join(project, 'scripts', 'bundle-monitoring.cjs'), path.join(dir, 'scripts', 'bundle-monitoring.cjs'));
  fs.copyFileSync(path.join(project, 'integrations', 'monitoring', 'service.cjs'), path.join(dir, 'integrations', 'monitoring', 'service.cjs'));
  fs.copyFileSync(path.join(project, 'integrations', 'monitoring', 'collector.cjs'), path.join(dir, 'integrations', 'monitoring', 'collector.cjs'));
  fs.cpSync(path.join(project, 'browser-extensions', 'monitoring-collector'), path.join(dir, 'browser-extensions', 'monitoring-collector'), {recursive:true});
  for (const name of assets) fs.copyFileSync(path.join(project, 'public', name), path.join(dir, 'public', name));
  const generate = (...args) => spawnSync(process.execPath, [path.join(dir, 'scripts', 'bundle-monitoring.cjs'), ...args], { cwd: dir, encoding: 'utf8', timeout: 10000 });
  const serverFile = path.join(dir, 'server.js'), source = fs.readFileSync(serverFile, 'utf8');
  const current = generate('--check');
  assert.equal(current.status, 0, current.stderr);
  fs.appendFileSync(path.join(dir, 'public', 'daily-monitoring.css'), '\n/* verify changed source */\n');
  const staleAsset = generate('--check');
  assert.notEqual(staleAsset.status, 0); assert.match(staleAsset.stderr, /bundle is stale/);
  assert.equal(fs.readFileSync(serverFile, 'utf8'), source, 'check mode may not rewrite server source');
  assert.equal(generate().status, 0); assert.equal(generate('--check').status, 0);
  fs.appendFileSync(path.join(dir, 'integrations', 'monitoring', 'service.cjs'), '\n// verify changed backend\n');
  assert.notEqual(generate('--check').status, 0);
  assert.equal(generate().status, 0); assert.equal(generate('--check').status, 0);
  const regenerated = fs.readFileSync(serverFile, 'utf8');
  assert.equal(generate().status, 0);
  assert.equal(fs.readFileSync(serverFile, 'utf8'), regenerated, 'identical source must produce byte-identical embedded release');
});
