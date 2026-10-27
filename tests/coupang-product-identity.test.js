'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createService } = require('../integrations/coupang/service.cjs');
const now = Date.parse('2026-10-27T05:00:00Z'), date = '2026-10-26';
const credentials = { vendorId: 'A00012345', accessKey: 'synthetic-access', secretKey: 'synthetic-secret' };
const productPath = '/v2/providers/seller_api/apis/api/v1/marketplace/seller-products';
const protect = (mode, value) => mode === 'encrypt' ? Buffer.from(value).toString('base64') : Buffer.from(value, 'base64').toString();
const option = (itemId, suffix) => ({ itemId, name: '예시 매트 캠핑 침대 ' + suffix, unitCost: 3000, channel: 'growth' });
const reply = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
function setup(t, handler = async () => { throw Error('No external request expected'); }) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coupang-identity-'));
  t.after(() => fs.rmSync(baseDir, { recursive: true, force: true }));
  const service = () => createService({ baseDir, protect, now: () => now, sleep: async () => {}, fetchImpl: handler });
  const s = service(); s.saveCredentials(credentials); s.saveScope({ products: [option('123', '8CM 싱글'), option('456', '8CM 더블')] });
  const vendorDir = path.join(baseDir, '.roas-data/coupang', credentials.vendorId), cache = path.join(vendorDir, 'thumbnails.json');
  const scopeFile = path.join(vendorDir, 'scope.json');
  const writeCache = (entries, vendorId = credentials.vendorId) => fs.writeFileSync(cache, JSON.stringify({ vendorId, entries }));
  return { s, service, baseDir, scopeFile, cache, writeCache };
}
const query = { since: date, until: date, channel: 'growth', view: 'sales' };

test('authoritative cached product identity groups API-only options without changing scope, finance or edit revision', async t => {
  const { s, writeCache, scopeFile } = setup(t, async () => reply({ code: 200, data: [{ vendorId: credentials.vendorId, orderId: 7001, paidAt: Date.parse(date + 'T12:00:00+09:00'), orderItems: [
    { vendorItemId: 123, productName: '예시 매트 8CM 싱글', salesQuantity: 2, unitSalesPrice: 10000, currency: 'KRW' },
    { vendorItemId: 456, productName: '예시 매트 8CM 더블', salesQuantity: 1, unitSalesPrice: 15000, currency: 'KRW' }
  ] }] }));
  s.saveScope({ products: [option('123', '8CM 싱글'), { ...option('456', '8CM 더블'), productId: '456' }] });
  await s.sync({ since: date, until: date, channel: 'growth' });
  const before = s.workspace(), beforeReport = s.analytics(query), rawScope = fs.readFileSync(scopeFile, 'utf8');
  writeCache(['123', '456'].map((itemId, i) => ({ itemId, productId: '7000', thumbnailUrl: null, productName: '예시 매트 캠핑 침대', displayName: '예시 매트', optionName: i ? '8CM 더블' : '8CM 싱글' })));
  const after = s.workspace(), report = s.analytics(query);
  assert.equal(after.revision, before.revision); assert.equal(after.scopeKey, before.scopeKey);
  assert.equal(new Set(after.products.map(p => p.productId)).size, 1);
  assert.ok(after.products.every(p => p.productId === '7000' && p.displayName === '예시 매트'));
  assert.deepEqual(after.products.map(p => p.name), before.products.map(p => p.name), 'original option titles remain intact');
  assert.equal(fs.readFileSync(scopeFile, 'utf8'), rawScope);
  assert.deepEqual(report.summary, beforeReport.summary);
  for (const row of report.items) {
    const old = beforeReport.items.find(r => r.itemId === row.itemId);
    assert.equal(row.productId, '7000'); assert.equal(row.displayName, '예시 매트'); assert.equal(row.name, old.name);
    assert.equal(row.fullName, before.products.find(p => p.itemId === row.itemId).name);
    for (const field of ['sales', 'quantity', 'netProfit', 'advertising', 'profitBeforeAds', 'available']) assert.deepEqual(row[field], old[field]);
  }
  assert.equal(s.analytics({ ...query, view: 'dashboard' }).productDaily.length, 1);
  // Optional presentation metadata cannot make an already open cost editor stale.
  const saved = s.updateProduct({ scopeKey: before.scopeKey, revision: before.revision, itemId: '123', unitCost: 4000, commissionRate: null, inboundFee: null, deliveryFee: null, costSince: null });
  assert.notEqual(saved.revision, before.revision);
  const raw = JSON.parse(fs.readFileSync(scopeFile, 'utf8'));
  assert.equal(raw.products[0].productId, undefined); assert.equal(raw.products[1].productId, '456');
  assert.ok(raw.products.every(p => p.displayName === undefined));
});

test('verified product details retain identity and compact names even when no thumbnail exists', async t => {
  const { s, service, scopeFile, cache } = setup(t, async address => {
    const url = new URL(address);
    if (url.pathname === productPath) return reply({ code: 'SUCCESS', data: [{ sellerProductId: 11, productId: 7000 }], nextToken: '' });
    assert.equal(url.pathname, productPath + '/11');
    return reply({ code: 'SUCCESS', data: { sellerProductId: 11, vendorId: credentials.vendorId, productId: 7000, brand: '예시', generalProductName: '자충매트', displayProductName: '예시 자충매트 캠핑 매트리스', returnAddress: 'MUST-NOT-PERSIST', items: [
      { vendorItemId: 123, itemName: '8CM 싱글', images: [] },
      { rocketGrowthItemData: { vendorItemId: 456 }, itemName: '8CM 더블', images: [{ imageType: 'REPRESENTATION', cdnPath: 'https://arbitrary.invalid/product.jpg' }] },
      { vendorItemId: 999, itemName: '미선택', images: [] }
    ] } });
  });
  s.saveScope({ products: [{ ...option('123', '8CM 싱글'), productId: '123' }, { ...option('456', '8CM 더블'), productId: '456' }] });
  const before = s.workspace(), rawScope = fs.readFileSync(scopeFile, 'utf8');
  s.startThumbnails({ vendorKey: before.vendorKey, scopeKey: before.scopeKey }); await s.waitForThumbnails();
  const status = s.thumbnailStatus(), after = service().workspace();
  assert.equal(status.job.status, 'partial'); assert.ok(status.items.every(p => p.thumbnailUrl === null));
  assert.ok(status.items.every(p => p.productId === '7000' && p.displayName === '예시 자충매트'));
  assert.deepEqual(after.products.map(p => p.optionName), ['8CM 싱글', '8CM 더블']);
  assert.equal(after.revision, before.revision); assert.equal(fs.readFileSync(scopeFile, 'utf8'), rawScope);
  const stored = JSON.parse(fs.readFileSync(cache, 'utf8'));
  assert.equal(stored.entries.length, 2); assert.ok(stored.entries.every(p => p.productId === '7000'));
  for (const forbidden of ['MUST-NOT-PERSIST', 'arbitrary.invalid', credentials.secretKey]) assert.ok(!JSON.stringify(stored).includes(forbidden));
});

test('catalog identities win over conflicting cache data and unknown or foreign entries never merge products by name', t => {
  const { s, writeCache, cache } = setup(t);
  s.saveScope({ products: [{ ...option('123', '8CM 싱글'), productId: '9000', productName: '카탈로그 상품', optionName: '카탈로그 옵션' }, option('456', '8CM 더블')] });
  writeCache([{ itemId: '123', productId: '7000', thumbnailUrl: null, productName: '다른 상품', displayName: '다른 상품' }]);
  let products = s.workspace().products;
  assert.equal(products[0].productId, '9000'); assert.equal(products[0].productName, '카탈로그 상품'); assert.equal(products[0].displayName, undefined);
  assert.equal(products[1].productId, undefined);
  writeCache([{ itemId: '456', productId: '9000', thumbnailUrl: null }], 'A00054321');
  products = s.workspace().products; assert.equal(products[1].productId, undefined);
  fs.writeFileSync(cache, '{not-json');
  assert.doesNotThrow(() => s.workspace()); assert.doesNotThrow(() => s.analytics(query));
  const rows = s.analytics(query).items;
  assert.deepEqual(rows.map(r => r.productId), ['9000', '456']);
  s.saveScope({ products: ['123', '456'].map(itemId => ({ itemId, name: '동일한 상품명', unitCost: null, channel: 'growth' })) });
  // saveScope preserves old explicit metadata, so a new vendor demonstrates
  // unknown identities without carrying a prior catalog classification.
  s.saveCredentials({ ...credentials, vendorId: 'A00054321' });
  s.saveScope({ products: ['123', '456'].map(itemId => ({ itemId, name: '동일한 상품명', unitCost: null, channel: 'growth' })) });
  assert.deepEqual(s.analytics(query).items.map(r => r.productId), ['123', '456']);
});
