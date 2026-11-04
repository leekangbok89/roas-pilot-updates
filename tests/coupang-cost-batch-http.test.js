'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { spawnSync } = require('node:child_process');

test('production HTTP products-update route applies a guarded atomic batch and preserves the single-option route', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coupang-cost-batch-http-'));
  try {
    const serverFile = path.resolve(__dirname, '../server.js'), serviceFile = path.resolve(__dirname, '../integrations/coupang/service.cjs');
    const source = fs.readFileSync(serverFile, 'utf8'), seam = 'const coupang=bundledCoupang.createService(';
    assert.equal(source.split(seam).length, 2);
    // Keep the actual production router. Use its current service source before
    // release bundling, with all saved state isolated in this disposable folder.
    fs.writeFileSync(path.join(dir, 'server.js'), source.replace(seam, 'const coupang=require(' + JSON.stringify(serviceFile) + ').createService('));
    const script = String.raw`
      const assert = require('node:assert/strict'), http = require('node:http'), fs = require('node:fs'), path = require('node:path');
      require('node:child_process').spawnSync = (command, args, options) => {
        assert.equal(command, 'powershell.exe');
        const decrypt = Buffer.from(args.at(-1), 'base64').toString('utf16le').includes('::Unprotect');
        return { status: 0, stdout: decrypt ? Buffer.from(options.input, 'base64').toString() : Buffer.from(options.input).toString('base64') };
      };
      Object.defineProperty(process, 'platform', { value: 'win32' });
      global.fetch = async () => { throw Error('Cost editing must not call an external API'); };
      const app = require('./server');
      (async () => {
        await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
        try {
          const headers = { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000', 'content-type': 'application/json', 'x-roas-local-action': 'yes' };
          const req = (route, body, custom = headers, method = body === undefined ? 'GET' : 'POST') => new Promise((resolve, reject) => {
            const request = http.request({ hostname: '127.0.0.1', port: app.server.address().port, path: '/api/coupang/' + route, method, headers: custom }, response => {
              const chunks = []; response.on('data', chunk => chunks.push(chunk));
              response.on('end', () => { try { const text = Buffer.concat(chunks).toString(); resolve({ status: response.statusCode, body: JSON.parse(text), text }); } catch (error) { reject(error); } });
            });
            request.on('error', reject); request.end(body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body));
          });
          const body = { itemIds: ['123', '456'], changes: { unitCost: 4200 } };
          assert.equal((await req('products-update')).status, 405);
          assert.equal((await req('products-update', body, headers, 'PUT')).status, 405);
          assert.equal((await req('products-update', body)).status, 409);
          assert.equal((await req('products-update', body, { ...headers, origin: 'https://foreign.invalid' })).status, 403);
          assert.equal((await req('products-update', body, { ...headers, host: 'foreign.invalid:3000' })).status, 403);
          assert.equal((await req('products-update', body, { host: headers.host, 'content-type': 'application/json' })).status, 403);
          assert.equal((await req('credentials', { vendorId: 'A00012345', accessKey: 'BATCH-HTTP-SYNTHETIC-ACCESS', secretKey: 'BATCH-HTTP-SYNTHETIC-SECRET' })).status, 200);
          const product = (itemId, channel = 'growth', unitCost = 0) => ({ itemId, productId: '7000', name: '일괄 수정 시험 ' + itemId,
            productName: '일괄 수정 시험 상품', optionName: '옵션 ' + itemId, channel, unitCost, commissionRate: 10,
            inboundFee: 100, deliveryFee: 200, salePrice: 10000, costSince: '2024-01-01' });
          assert.equal((await req('catalog-import', { products: [product('123'), product('456', 'seller'), product('789', 'growth', 3000)] })).status, 200);
          let workspace = (await req('workspace')).body;
          const token = value => ({ scopeKey: value.scopeKey, revision: value.revision });
          workspace = (await req('groups', { ...token(workspace), groups: [{ id: 'same_product', name: '같은 상품', itemIds: ['123', '456'] }] })).body;
          const before = workspace, root = path.join(process.cwd(), '.roas-data/coupang/A00012345'), scopeFile = path.join(root, 'scope.json');
          const groupFile = path.join(root, 'groups.json'), originalGroup = fs.readFileSync(groupFile, 'utf8'), originalRename = fs.renameSync;
          let scopeWrites = 0;
          fs.renameSync = (from, to) => { if (to === scopeFile) scopeWrites++; return originalRename(from, to); };
          const saved = await req('products-update', { ...token(before), itemIds: [123, '456'], changes: { unitCost: 4200, deliveryFee: null }, name: 'ignored name' });
          assert.equal(saved.status, 200); assert.equal(scopeWrites, 1);
          workspace = saved.body;
          assert.equal(workspace.scopeKey, before.scopeKey); assert.notEqual(workspace.revision, before.revision);
          assert.deepEqual(workspace.groups, before.groups); assert.equal(fs.readFileSync(groupFile, 'utf8'), originalGroup);
          for (const item of workspace.products) {
            const original = before.products.find(p => p.itemId === item.itemId);
            assert.deepEqual(item, item.itemId === '789' ? original : { ...original, unitCost: 4200, deliveryFee: null, productCostSourceZero: false });
          }
          const disk = fs.readFileSync(scopeFile, 'utf8');
          assert.equal((await req('products-update', { ...token(before), ...body })).status, 409);
          for (const changes of [{}, { unitCost: '5000' }, { unitCost: -1 }, { commissionRate: 101 }, { costSince: '2024-02-30' }, { unitCost: 5000, channel: 'seller' }]) {
            assert.equal((await req('products-update', { ...token(workspace), itemIds: ['123', '456'], changes })).status, 400);
            assert.equal(fs.readFileSync(scopeFile, 'utf8'), disk);
          }
          assert.equal((await req('products-update', { ...token(workspace), itemIds: ['123', 123], changes: { unitCost: 5000 } })).status, 400);
          assert.equal((await req('products-update', { ...token(workspace), itemIds: ['123', '999'], changes: { unitCost: 5000 } })).status, 409);
          assert.equal((await req('products-update', 'not-json')).status, 400);
          assert.equal(fs.readFileSync(scopeFile, 'utf8'), disk); assert.equal(scopeWrites, 1);
          const single = await req('product-update', { ...token(workspace), itemId: '789', unitCost: 3100, commissionRate: 11,
            inboundFee: 110, deliveryFee: 210, costSince: '2024-01-02' });
          assert.equal(single.status, 200); assert.equal(single.body.products.find(p => p.itemId === '789').unitCost, 3100);
          assert.equal(single.body.products.find(p => p.itemId === '123').unitCost, 4200);
          assert.deepEqual((await req('workspace')).body, single.body);
          assert.ok(!saved.text.includes('BATCH-HTTP-SYNTHETIC-ACCESS')); assert.ok(!saved.text.includes('BATCH-HTTP-SYNTHETIC-SECRET'));
        } finally { app.server.closeAllConnections(); await new Promise(resolve => app.server.close(resolve)); }
      })().catch(error => { console.error(error); process.exitCode = 1; });
    `;
    const result = spawnSync(process.execPath, ['-e', script], { cwd: dir, env: { ...process.env, WEB_PASSWORD: '' }, encoding: 'utf8', timeout: 15000 });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
