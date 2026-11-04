'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createService, COSTS } = require('../integrations/coupang/service.cjs');

const now = Date.parse('2026-10-26T15:30:00Z'); // The editable date is October 27 in Korea.
const date = '2026-10-26';
const credentials = { vendorId: 'A00012345', accessKey: 'BATCH-SYNTHETIC-ACCESS', secretKey: 'BATCH-SYNTHETIC-SECRET' };
const protect = (mode, value) => mode === 'encrypt' ? Buffer.from(value).toString('base64') : Buffer.from(value, 'base64').toString();
const product = (itemId, overrides = {}) => ({ itemId, productId: '7000', productName: '일괄 수정 시험 상품', optionName: '옵션 ' + itemId,
  name: '일괄 수정 시험 옵션 ' + itemId, channel: 'growth', unitCost: 0, commissionRate: 10, inboundFee: 100,
  deliveryFee: 200, salePrice: 10000, costSince: '2026-10-01', ...overrides });
const token = s => { const { scopeKey, revision } = s.workspace(); return { scopeKey, revision }; };
const rejected = (action, status) => assert.throws(action, error => error.status === status);

function setup(t, configured = true) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coupang-cost-batch-'));
  t.after(() => fs.rmSync(baseDir, { recursive: true, force: true }));
  const service = () => createService({ baseDir, protect, now: () => now });
  const s = service(), root = path.join(baseDir, '.roas-data/coupang/A00012345'), scopeFile = path.join(root, 'scope.json');
  if (configured) {
    s.saveCredentials(credentials);
    s.importCatalog({ products: [product('123'), product('456', { channel: 'seller' }), product('789', { unitCost: 3000, productId: '8000' })] });
  }
  return { s, service, baseDir, root, scopeFile };
}
function snapshot(root) {
  const files = {};
  const visit = folder => { for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) visit(file); else files[path.relative(root, file)] = fs.readFileSync(file).toString('base64');
  } };
  visit(root); return files;
}

test('one atomic batch changes selected cost fields and preserves all identities, groups, scope and financial originals', t => {
  const { s, service, root, scopeFile } = setup(t);
  s.saveGroups({ ...token(s), groups: [{ id: 'same_product', name: '같은 상품 옵션', itemIds: ['123', '456'] }] });
  const before = s.workspace(), ledger = s.report({ since: date, until: date }).daily[0];
  s.saveLedger({ date, channel: 'growth', scopeKey: before.scopeKey, basis: ledger.basis, reviewed: true,
    ...Object.fromEntries(COSTS.map(key => [key, 0])), netSales: 18000, productCost: 3000 });
  s.importSales({ date, rows: [{ productId: '7000', itemId: '123', channel: 'growth', name: '일괄 시험', optionName: '옵션', quantity: 2,
    adQuantity: 1, organicQuantity: 1, sales: 20000, profitBeforeAds: 13000, advertising: 1000, adSales: 10000, adProfitBeforeAds: 6500 }],
    acquisitionAdvertising: { growth: 700, seller: 0 } });
  const filesBefore = snapshot(root), oldScope = JSON.parse(fs.readFileSync(scopeFile)), originalRename = fs.renameSync;
  let scopeWrites = 0;
  t.mock.method(fs, 'renameSync', (from, to) => { if (to === scopeFile) scopeWrites++; return originalRename(from, to); });
  const next = s.updateProducts({ ...token(s), itemIds: ['456', 123], changes: { unitCost: 4200, deliveryFee: null },
    name: 'must not rename', channel: 'seller', products: [], groups: [] });
  assert.equal(scopeWrites, 1);
  assert.equal(next.scopeKey, before.scopeKey);
  assert.notEqual(next.revision, before.revision);
  assert.deepEqual(next.groups, before.groups);
  assert.deepEqual(next.products.map(p => p.itemId), before.products.map(p => p.itemId));
  for (const item of next.products) {
    const old = before.products.find(p => p.itemId === item.itemId);
    assert.deepEqual(item, item.itemId === '789' ? old : { ...old, unitCost: 4200, deliveryFee: null, productCostSourceZero: false });
  }
  const expectedFiles = { ...filesBefore, 'scope.json': fs.readFileSync(scopeFile).toString('base64') };
  assert.deepEqual(snapshot(root), expectedFiles, 'no financial report, acquisition spend or group file changes');
  assert.deepEqual(JSON.parse(fs.readFileSync(scopeFile)), { ...oldScope, products: next.products });
  assert.deepEqual(service().workspace(), next, 'all selected options persist together across restart');
  assert.ok(!JSON.stringify(next).includes(credentials.accessKey));
  assert.ok(!JSON.stringify(next).includes(credentials.secretKey));
});

test('partial updates preserve imported-zero provenance unless unit cost is explicitly changed', t => {
  const { s } = setup(t);
  assert.equal(s.workspace().products.find(p => p.itemId === '123').productCostSourceZero, true);
  let next = s.updateProducts({ ...token(s), itemIds: ['123', '456'], changes: { commissionRate: 0, inboundFee: null, costSince: null } });
  for (const id of ['123', '456']) {
    const p = next.products.find(p => p.itemId === id);
    assert.equal(p.unitCost, 0); assert.equal(p.productCostSourceZero, true);
    assert.equal(p.commissionRate, 0); assert.equal(p.inboundFee, null); assert.equal(p.costSince, null);
    assert.equal(p.deliveryFee, 200);
  }
  next = s.updateProducts({ ...token(s), itemIds: ['123'], changes: { unitCost: 0 } });
  assert.equal(next.products.find(p => p.itemId === '123').productCostSourceZero, false, 'an explicit confirmed zero is distinct from the imported placeholder');
  assert.equal(next.products.find(p => p.itemId === '456').productCostSourceZero, true);
  next = s.updateProducts({ ...token(s), itemIds: ['123'], changes: { unitCost: null } });
  assert.equal(next.products.find(p => p.itemId === '123').unitCost, null);
  assert.equal(next.products.find(p => p.itemId === '123').productCostSourceZero, false);
});

test('invalid fields and values reject the complete batch before any write', t => {
  const { s, scopeFile } = setup(t), previous = fs.readFileSync(scopeFile, 'utf8'), originalRename = fs.renameSync;
  let writes = 0;
  t.mock.method(fs, 'renameSync', (from, to) => { if (to === scopeFile) writes++; return originalRename(from, to); });
  const invalid = [undefined, null, [], {}, { name: 'rename' }, { source: 'manual' }, { productCostSourceZero: false }, { unitCost: 100, sales: 500 },
    { unitCost: undefined }, { unitCost: '' }, { unitCost: '100' }, { unitCost: true }, { unitCost: -1 }, { unitCost: NaN }, { unitCost: Infinity },
    { inboundFee: 1e12 + 1 }, { deliveryFee: -1 }, { commissionRate: 100.01 }, { commissionRate: '10' }, { commissionRate: Infinity },
    { costSince: '' }, { costSince: undefined }, { costSince: '2026-02-30' }, { costSince: '2026-10-28' }, { costSince: '2026-10-27T00:00:00Z' },
    { costSince: 20261027 }, { unitCost: 5000, deliveryFee: -1 }, Object.assign({ unitCost: 5000 }, { [Symbol('invalid')]: 1 })];
  for (const changes of invalid) {
    rejected(() => s.updateProducts({ ...token(s), itemIds: ['123', '456'], changes }), 400);
    assert.equal(fs.readFileSync(scopeFile, 'utf8'), previous);
  }
  assert.equal(writes, 0);
});

test('selected IDs must be unique current options and fit the one-to-500 limit', t => {
  const { s, scopeFile } = setup(t), previous = fs.readFileSync(scopeFile, 'utf8');
  for (const itemIds of [undefined, null, {}, [], Array(1), ['123', '123'], ['123', 123], ['0'], [true], ['../123'], [Number.MAX_SAFE_INTEGER + 1], Array(501).fill('123')]) {
    rejected(() => s.updateProducts({ ...token(s), itemIds, changes: { unitCost: 5000 } }), 400);
    assert.equal(fs.readFileSync(scopeFile, 'utf8'), previous);
  }
  rejected(() => s.updateProducts({ ...token(s), itemIds: ['123', '999'], changes: { unitCost: 5000 } }), 409);
  assert.equal(fs.readFileSync(scopeFile, 'utf8'), previous, 'a later unknown option cannot partially update the first option');
  const many = Array.from({ length: 500 }, (_, i) => product(String(i + 1000), { unitCost: 1000 }));
  s.saveScope({ products: many });
  const next = s.updateProducts({ ...token(s), itemIds: many.map(p => p.itemId), changes: { unitCost: 1e12, commissionRate: 100 } });
  assert.equal(next.products.length, 500);
  assert.ok(next.products.every(p => p.unitCost === 1e12 && p.commissionRate === 100));
});

test('workspace revisions prevent stale, changed-scope and cross-vendor bulk edits', t => {
  const { s, scopeFile } = setup(t);
  const body = { itemIds: ['123'], changes: { unitCost: 5000 } }, stale = token(s);
  s.saveGroups({ ...token(s), groups: [{ id: 'g1', name: '시험', itemIds: ['123'] }] });
  const previous = fs.readFileSync(scopeFile, 'utf8');
  for (const guard of [{}, stale, { ...token(s), scopeKey: 'wrong' }, { ...token(s), revision: 'wrong' }]) {
    rejected(() => s.updateProducts({ ...guard, ...body }), 409);
    assert.equal(fs.readFileSync(scopeFile, 'utf8'), previous);
  }
  const current = token(s);
  s.saveScope({ products: [product('123')] });
  rejected(() => s.updateProducts({ ...current, ...body }), 409);
  const firstVendor = token(s);
  s.saveCredentials({ ...credentials, vendorId: 'A00054321' });
  s.importCatalog({ products: [product('123')] });
  rejected(() => s.updateProducts({ ...firstVendor, ...body }), 409);
});

test('Korean current date is allowed, and the batch leaves unspecified date and cost fields unchanged', t => {
  const { s } = setup(t);
  let next = s.updateProducts({ ...token(s), itemIds: ['123'], changes: { costSince: '2026-10-27' } });
  const first = next.products.find(p => p.itemId === '123');
  assert.equal(first.costSince, '2026-10-27'); assert.equal(first.unitCost, 0);
  next = s.updateProducts({ ...token(s), itemIds: ['123'], changes: { deliveryFee: 0 } });
  assert.deepEqual(next.products.find(p => p.itemId === '123'), { ...first, deliveryFee: 0 });
});

test('a failed atomic replacement preserves every original option and removes its temporary file', t => {
  const { s, root, scopeFile } = setup(t), previous = snapshot(root), originalRename = fs.renameSync;
  let attempted = 0;
  t.mock.method(fs, 'renameSync', (from, to) => {
    if (to === scopeFile) { attempted++; throw Object.assign(Error('synthetic disk replacement failure'), { code: 'EACCES' }); }
    return originalRename(from, to);
  });
  assert.throws(() => s.updateProducts({ ...token(s), itemIds: ['123', '456'], changes: { unitCost: 5000 } }), /synthetic disk replacement failure/);
  assert.equal(attempted, 1); assert.deepEqual(snapshot(root), previous);
});

test('an unconfigured service rejects a batch without creating workspace files', t => {
  const { s, baseDir } = setup(t, false);
  rejected(() => s.updateProducts({ scopeKey: '', revision: '', itemIds: ['123'], changes: { unitCost: 5000 } }), 409);
  assert.deepEqual(fs.readdirSync(baseDir), []);
});
