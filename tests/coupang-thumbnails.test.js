'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createService } = require('../integrations/coupang/service.cjs');
const productPath = '/v2/providers/seller_api/apis/api/v1/marketplace/seller-products';
const date = '2026-10-26', initialTime = Date.parse('2026-10-27T05:00:00Z');
const credentials = { vendorId: 'A00012345', accessKey: 'synthetic-access', secretKey: 'synthetic-secret' };
const protect = (mode, value) => mode === 'encrypt' ? Buffer.from(value).toString('base64') : Buffer.from(value, 'base64').toString();
const product = (itemId = '123', channel = 'growth') => ({ itemId, productId: '7000', name: '예시 상품 ' + itemId, channel, unitCost: 3000, commissionRate: 10, inboundFee: 100, deliveryFee: 200 });
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const detail = (sellerProductId, items, extra = {}) => json({ code: 'SUCCESS', data: { sellerProductId, vendorId: credentials.vendorId, productId: 7000, items, returnAddress: 'MUST-NOT-BE-STORED', ...extra } });
const image = (cdnPath = 'vendor_inventory/example.jpg', imageOrder = 0) => ({ imageType: 'REPRESENTATION', imageOrder, cdnPath });
function setup(t, handler, configured = true, sleep = async () => {}) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coupang-thumbnails-')), calls = [];
  let clock = initialTime;
  t.after(() => fs.rmSync(baseDir, { recursive: true, force: true }));
  const service = () => createService({ baseDir, protect, now: () => clock, sleep, fetchImpl: async (address, init) => {
    const url = new URL(address); calls.push(url);
    assert.equal(url.origin, 'https://api-gateway.coupang.com'); assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'error');
    assert.ok(init.headers.Authorization.startsWith('CEA algorithm=HmacSHA256'));
    return handler(url, calls.length);
  } });
  const s = service();
  if (configured) { s.saveCredentials(credentials); s.importCatalog({ products: [product(), product('456', 'seller')] }); }
  return { s, baseDir, calls, service, advance: ms => { clock += ms; } };
}
const context = s => { const w = s.workspace(); return { vendorKey: w.vendorKey, scopeKey: w.scopeKey }; };
const completeHandler = url => url.pathname === productPath ? json({ code: 'SUCCESS', data: [{ sellerProductId: 11, productId: 7000 }], nextToken: '' }) : detail(11, [{ vendorItemId: 123, images: [image()] }, { rocketGrowthItemData: { vendorItemId: 456 }, images: [image('vendor_inventory/second.png')] }]);

test('thumbnail reads are safe without configuration and writes require exact vendor and selected scope', t => {
  const { s, baseDir, calls } = setup(t, completeHandler, false);
  assert.equal(s.thumbnailStatus().configured, false); assert.equal(s.thumbnailStatus().needsSync, false);
  assert.deepEqual(fs.readdirSync(baseDir), []);
  assert.throws(() => s.startThumbnails({}), error => error.status === 409);
  s.saveCredentials(credentials); s.importCatalog({ products: [product()] });
  for (const invalid of [{}, { ...context(s), vendorKey: 'wrong' }, { ...context(s), scopeKey: 'wrong' }]) assert.throws(() => s.startThumbnails(invalid), error => error.status === 409);
  assert.throws(() => s.startThumbnails({ ...context(s), force: 'yes' }), error => error.status === 400);
  assert.equal(calls.length, 0);
});

test('both paginated product lists deduplicate registered IDs and exact option matches select representative images', async t => {
  const { s, baseDir, calls, service } = setup(t, url => {
    if (url.pathname === productPath) {
      assert.equal(url.searchParams.get('vendorId'), credentials.vendorId); assert.equal(url.searchParams.get('maxPerPage'), '100');
      if (url.searchParams.get('businessTypes') === 'rocketGrowth') return json({ code: 'SUCCESS', data: [{ sellerProductId: 11, productId: 7000 }, { sellerProductId: 13, productId: 7000 }] });
      return url.searchParams.get('nextToken') ? json({ code: 'SUCCESS', data: [{ sellerProductId: 12, productId: 7000 }] }) : json({ code: 'SUCCESS', data: [{ sellerProductId: 11, productId: 7000 }, { sellerProductId: 99, productId: 9000 }], nextToken: 'second' });
    }
    const id = url.pathname.split('/').at(-1);
    if (id === '11') return detail(11, [{ vendorItemId: 123, images: [{ imageType: 'DETAIL', imageOrder: 0, cdnPath: 'vendor_inventory/not-representative.jpg' }, image('vendor_inventory/later.jpg', 2), image('vendor_inventory/first.jpg', 0)] }]);
    if (id === '12') return detail(12, [{ vendorItemId: 999, images: [image('vendor_inventory/unselected.jpg')] }]);
    if (id === '13') return detail(13, [{ marketplaceItemData: { vendorItemId: 456 }, rocketGrowthItemData: { vendorItemId: 456 }, images: [image('http://image11.coupangcdn.com/image/vendor_inventory/hybrid.png')] }]);
    throw Error('Unrequested or confused sellerProductId ' + id);
  });
  const before = s.workspace(), reportBefore = s.analytics({ since: date, until: date, view: 'sales', channel: 'all' });
  const scopeFile = path.join(baseDir, '.roas-data/coupang', credentials.vendorId, 'scope.json'), beforeScope = fs.readFileSync(scopeFile, 'utf8');
  const start = s.startThumbnails(context(s)); assert.equal(start.job.running, true);
  await s.waitForThumbnails();
  const status = s.thumbnailStatus();
  assert.equal(status.job.status, 'completed'); assert.equal(status.job.completed, 3); assert.equal(status.job.total, 3); assert.equal(status.needsSync, false);
  assert.equal(status.items.find(p => p.itemId === '123').thumbnailUrl, 'https://image1.coupangcdn.com/image/vendor_inventory/first.jpg');
  assert.equal(status.items.find(p => p.itemId === '456').thumbnailUrl, 'https://image11.coupangcdn.com/image/vendor_inventory/hybrid.png');
  assert.equal(calls.filter(u => u.pathname === productPath + '/11').length, 1);
  assert.equal(calls.some(u => /\/(?:99|7000)$/.test(u.pathname)), false, 'exposed ID never used as registered product ID');
  assert.equal(fs.readFileSync(scopeFile, 'utf8'), beforeScope);
  assert.deepEqual(s.workspace(), before); assert.deepEqual(s.analytics({ since: date, until: date, view: 'sales', channel: 'all' }), reportBefore);
  const persisted = fs.readFileSync(path.join(baseDir, '.roas-data/coupang', credentials.vendorId, 'thumbnails.json'), 'utf8');
  for (const secret of ['MUST-NOT-BE-STORED', credentials.secretKey, credentials.accessKey, 'unselected.jpg']) assert.ok(!persisted.includes(secret));
  assert.deepEqual(service().thumbnailStatus().items, status.items);
});

test('authentication failure retains cached thumbnails, hides upstream text and cools down automatic retries', async t => {
  let reject = false;
  const { s, baseDir, calls, advance } = setup(t, url => reject ? json({ message: 'Not allowed IP synthetic-secret private-address' }, 403) : completeHandler(url));
  s.startThumbnails(context(s)); await s.waitForThumbnails(); const cached = s.thumbnailStatus().items;
  reject = true;
  s.startThumbnails({ ...context(s), force: true }); await s.waitForThumbnails();
  let status = s.thumbnailStatus(); assert.equal(status.job.status, 'failed'); assert.match(status.job.error, /인증/); assert.deepEqual(status.items, cached); assert.equal(status.needsSync, false);
  const after = calls.length; s.startThumbnails(context(s)); await s.waitForThumbnails(); assert.equal(calls.length, after);
  advance(30 * 60000 + 1);
  // With complete existing images, automatic refresh remains unnecessary; manual retry is always available.
  assert.equal(s.thumbnailStatus().needsSync, false);
  s.startThumbnails({ ...context(s), force: true }); await s.waitForThumbnails(); assert.equal(calls.length, after + 1);
  const output = JSON.stringify(s.thumbnailStatus()) + fs.readFileSync(path.join(baseDir, '.roas-data/coupang', credentials.vendorId, 'thumbnails.json'), 'utf8');
  assert.ok(!output.includes('synthetic-secret')); assert.ok(!output.includes('private-address'));
  assert.equal(fs.existsSync(path.join(baseDir, '.roas-data/coupang', credentials.vendorId, 'connection-check.json')), false);
});

test('missing thumbnail failures retry after cooldown while repeated starts share the same background job', async t => {
  let resolveResponse, requested;
  const requestedPromise = new Promise(resolve => { requested = resolve; });
  const { s, calls, advance } = setup(t, () => { requested(); return new Promise(resolve => { resolveResponse = resolve; }); });
  const first = s.startThumbnails(context(s)); assert.equal(first.job.running, true);
  await requestedPromise;
  const task = s.waitForThumbnails(); s.startThumbnails({ ...context(s), force: true }); assert.equal(s.waitForThumbnails(), task); assert.equal(calls.length, 1);
  resolveResponse(json({ message: 'Denied' }, 403)); await task;
  assert.equal(s.thumbnailStatus().needsSync, false); advance(30 * 60000 + 1); assert.equal(s.thumbnailStatus().needsSync, true);
});

test('changed credentials cancel old work without applying images to another vendor with identical option IDs', async t => {
  let resolveResponse, requested;
  const requestedPromise = new Promise(resolve => { requested = resolve; });
  const { s, baseDir, calls } = setup(t, () => { requested(); return new Promise(resolve => { resolveResponse = resolve; }); });
  const oldContext = context(s); s.startThumbnails(oldContext); const task = s.waitForThumbnails(); await requestedPromise;
  s.saveCredentials({ ...credentials, vendorId: 'A00054321' }); s.importCatalog({ products: [product(), product('456', 'seller')] });
  assert.notEqual(context(s).vendorKey, oldContext.vendorKey); assert.equal(context(s).scopeKey, oldContext.scopeKey);
  resolveResponse(json({ code: 'SUCCESS', data: [{ sellerProductId: 11, productId: 7000 }] })); await task;
  assert.equal(calls.length, 1); assert.ok(s.thumbnailStatus().items.every(item => item.thumbnailUrl === null));
  assert.equal(fs.existsSync(path.join(baseDir, '.roas-data/coupang/A00054321/thumbnails.json')), false);
});

test('order collection takes priority and image jobs wait without blocking the order request', async t => {
  let releaseOrder, requested;
  const orderRequested = new Promise(resolve => { requested = resolve; });
  const { s, calls } = setup(t, url => {
    if (url.pathname.endsWith('/rg/orders')) { requested(); return new Promise(resolve => { releaseOrder = resolve; }); }
    return completeHandler(url);
  }, true, async milliseconds => { if (milliseconds === 2000) await new Promise(resolve => setTimeout(resolve, 1)); });
  const orders = s.sync({ since: date, until: date, channel: 'growth' }); await orderRequested;
  const started = s.startThumbnails(context(s)); assert.equal(started.job.status, 'waiting'); assert.equal(calls.length, 1);
  releaseOrder(json({ code: 200, data: [] })); await orders; await s.waitForThumbnails();
  assert.equal(s.thumbnailStatus().job.status, 'completed'); assert.ok(calls.some(url => url.pathname === productPath));
});

test('rate rejection stops immediately, and repeated pagination tokens never loop or disclose upstream data', async t => {
  let mode = 'rate';
  const { s, calls } = setup(t, () => mode === 'rate' ? json({ message: 'limit secret' }, 429) : json({ code: 'SUCCESS', data: [], nextToken: 'repeat' }));
  s.startThumbnails(context(s)); await s.waitForThumbnails(); assert.equal(calls.length, 1); assert.match(s.thumbnailStatus().job.error, /한도/);
  mode = 'loop'; const before = calls.length;
  s.startThumbnails({ ...context(s), force: true }); await s.waitForThumbnails(); assert.equal(calls.length - before, 2); assert.equal(s.thumbnailStatus().job.status, 'failed');
});

test('bounded cache eviction preserves old and newly refreshed selected options', async t => {
  const { s, baseDir } = setup(t, completeHandler);
  const file = path.join(baseDir, '.roas-data/coupang', credentials.vendorId, 'thumbnails.json');
  const entries = [{ itemId:'123', productId:'7000', thumbnailUrl:'https://image1.coupangcdn.com/image/vendor_inventory/old.jpg' }, ...Array.from({length:1999},(_,i)=>({itemId:String(10000+i),productId:'9000',thumbnailUrl:'https://image1.coupangcdn.com/image/vendor_inventory/archive.jpg'}))];
  fs.writeFileSync(file,JSON.stringify({version:1,vendorId:credentials.vendorId,entries}));
  s.startThumbnails({...context(s),force:true}); await s.waitForThumbnails();
  const saved=JSON.parse(fs.readFileSync(file,'utf8'));
  assert.equal(saved.entries.length,2000);
  assert.ok(saved.entries.some(entry=>entry.itemId==='123'));
  assert.ok(saved.entries.some(entry=>entry.itemId==='456'));
  assert.ok(s.thumbnailStatus().items.every(entry=>entry.thumbnailUrl));
});

test('large catalogs make bounded progress and prioritize known exposed products over unknown summaries', async t => {
  const { s, calls } = setup(t, url => {
    if(url.pathname===productPath) {
      if(url.searchParams.has('businessTypes')) return json({code:'SUCCESS',data:[]});
      const page=Number(url.searchParams.get('nextToken')||0), start=page*100;
      const data=Array.from({length:Math.min(100,501-start)},(_,offset)=>({sellerProductId:1000+start+offset,...(start+offset===500?{productId:7000}:{})}));
      return json({code:'SUCCESS',data,nextToken:page<5?String(page+1):''});
    }
    const sellerProductId=Number(url.pathname.split('/').at(-1));
    return sellerProductId===1500?detail(1500,[{vendorItemId:123,images:[image()]},{vendorItemId:456,images:[image('vendor_inventory/second.png')]}]):detail(sellerProductId,[]);
  });
  s.startThumbnails(context(s)); await s.waitForThumbnails();
  const status=s.thumbnailStatus();
  assert.equal(status.job.status,'partial'); assert.match(status.job.error,/한도/);
  assert.equal(status.job.total,500); assert.equal(status.job.completed,500);
  assert.ok(status.items.every(entry=>entry.thumbnailUrl));
  const details=calls.filter(url=>url.pathname.startsWith(productPath+'/'));
  assert.equal(details.length,500); assert.ok(details.some(url=>url.pathname.endsWith('/1500')));
  assert.equal(details.some(url=>url.pathname.endsWith('/1000')),false,'known product replaces an unknown candidate');
});
