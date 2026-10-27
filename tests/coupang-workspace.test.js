'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createService, COSTS } = require('../integrations/coupang/service.cjs');
const now = Date.parse('2026-10-27T05:00:00Z'), date = '2026-10-26';
const credentials = { vendorId: 'A00012345', accessKey: 'test-access-key', secretKey: 'test-secret-key' };
const protect = (mode, value) => mode === 'encrypt' ? Buffer.from(value).toString('base64') : Buffer.from(value, 'base64').toString();
const product = (itemId, channel) => ({ itemId, productId: '7000', productName: '예시 상품', optionName: '옵션 ' + itemId, name: '예시 상품 옵션 ' + itemId, channel, unitCost: 3000, commissionRate: 10, inboundFee: 100, deliveryFee: 200, salePrice: 10000, costSince: '2026-10-01' });
function setup(t, configured = true) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coupang-workspace-'));
  t.after(() => fs.rmSync(baseDir, { recursive: true, force: true }));
  const service = () => createService({ baseDir, protect, now: () => now });
  const s = service();
  if (configured) { s.saveCredentials(credentials); s.importCatalog({ products: [product('123', 'growth'), product('456', 'seller')] }); }
  return { s, baseDir, service };
}
const token = s => { const { scopeKey, revision } = s.workspace(); return { scopeKey, revision }; };
const costs = (overrides = {}) => ({ itemId: '123', unitCost: 4000, commissionRate: 12, inboundFee: 150, deliveryFee: 300, costSince: '2026-10-20', ...overrides });
const group = (overrides = {}) => ({ id: 'sample_group', name: '예시 그룹', itemIds: ['123'], ...overrides });
const rejected = (action, status) => assert.throws(action, error => error.status === status);

test('unconfigured workspace is safe and reads do not create directories or require Windows encryption', t => {
  const { s, baseDir } = setup(t, false);
  assert.deepEqual(s.workspace(), { configured: false, scopeKey: '', revision: null, products: [], groups: [] });
  assert.deepEqual(fs.readdirSync(baseDir), []);
  rejected(() => s.updateProduct(costs()), 409);
  rejected(() => s.saveGroups({ groups: [] }), 409);
});

test('product edits preserve selection, identities, financial scope, reconciled ledgers and channel acquisition costs', t => {
  const { s, service, baseDir } = setup(t);
  const before = s.workspace(), other = before.products.find(p => p.itemId === '456');
  const ledger = s.report({ since: date, until: date }).daily[0];
  s.saveLedger({ date, channel: 'growth', scopeKey: before.scopeKey, basis: ledger.basis, reviewed: true, ...Object.fromEntries(COSTS.map(key => [key, 0])), netSales: 15000, productCost: 3000 });
  s.importSales({ date, rows: [{ productId: '7000', itemId: '123', channel: 'growth', name: '예시 상품', optionName: '옵션123', quantity: 2, adQuantity: 1, organicQuantity: 1, sales: 20000, profitBeforeAds: 10000, advertising: 1000, adSales: 10000, adProfitBeforeAds: 5000 }], acquisitionAdvertising: { growth: 700, seller: 0 } });
  const query = { since: date, until: date, channel: 'growth', view: 'sales' };
  const beforeAnalytics = s.analytics(query);
  const ledgerPath = path.join(baseDir, '.roas-data/coupang/A00012345/ledgers', before.scopeKey + '.json');
  const savedLedger = fs.readFileSync(ledgerPath, 'utf8');
  const next = s.updateProduct({ ...token(s), ...costs(), name: 'ignored rename', itemIds: ['999'], productId: '999', source: 'ignored source' });
  assert.equal(next.scopeKey, before.scopeKey);
  assert.notEqual(next.revision, before.revision);
  assert.deepEqual(next.products.map(p => p.itemId), before.products.map(p => p.itemId));
  assert.deepEqual(next.products.find(p => p.itemId === '456'), other);
  const updated = next.products.find(p => p.itemId === '123'), original = before.products.find(p => p.itemId === '123');
  for (const key of ['name', 'productId', 'productName', 'optionName', 'source', 'importedAt', 'salePrice', 'channel']) assert.equal(updated[key], original[key]);
  assert.equal(updated.unitCost, 4000); assert.equal(updated.costSince, '2026-10-20');
  assert.equal(fs.readFileSync(ledgerPath, 'utf8'), savedLedger);
  const afterSummary = s.analytics(query).summary;
  const confirmedSummary = value => Object.fromEntries(Object.entries(value).filter(([key]) => !key.startsWith('estimated') && !['estimateSource', 'missingInputs', 'missingInputReasons'].includes(key)));
  assert.deepEqual(confirmedSummary(afterSummary), confirmedSummary(beforeAnalytics.summary));
  assert.equal(beforeAnalytics.summary.estimatedProfitBeforeAds, 11400);
  assert.equal(afterSummary.estimatedProductCost, 8000); assert.equal(afterSummary.estimatedCommission, 2400); assert.equal(afterSummary.estimatedFulfillment, 900);
  assert.equal(afterSummary.estimatedProfitBeforeAds, 8700); assert.equal(afterSummary.estimateSource, 'sellha');
  assert.deepEqual(service().analytics(query).summary, afterSummary);
  assert.equal(afterSummary.netProfit, 8300);
  assert.equal(s.analytics(query).items[0].netProfit, null, 'unallocated acquisition advertising remains unallocated');
  assert.deepEqual(service().workspace(), next);
  assert.ok(!JSON.stringify(next).includes(credentials.accessKey));
  assert.ok(!JSON.stringify(next).includes(credentials.secretKey));
});

test('explicit zero and unknown costs remain distinct; invalid updates never write', t => {
  const { s, baseDir } = setup(t);
  let saved = s.updateProduct({ ...token(s), ...costs({ unitCost: 0, commissionRate: null, inboundFee: null, deliveryFee: 0, costSince: null }) });
  let item = saved.products.find(p => p.itemId === '123');
  assert.equal(item.unitCost, 0); assert.equal(item.commissionRate, null); assert.equal(item.inboundFee, null); assert.equal(item.deliveryFee, 0); assert.equal(item.costSince, null);
  saved = s.updateProduct({ ...token(s), ...costs({ unitCost: null }) });
  assert.equal(saved.products.find(p => p.itemId === '123').unitCost, null);
  const file = path.join(baseDir, '.roas-data/coupang/A00012345/scope.json'), previous = fs.readFileSync(file, 'utf8');
  for (const invalid of [{ unitCost: '' }, { unitCost: '100' }, { unitCost: true }, { unitCost: -1 }, { unitCost: Infinity }, { unitCost: 1e12 + 1 }, { commissionRate: 101 }, { costSince: '2026-02-30' }, { costSince: '2026-10-28' }, { costSince: '' }, { unitCost: undefined }, { itemId: '999' }]) {
    const body = { ...token(s), ...costs(invalid) };
    rejected(() => s.updateProduct(body), invalid.itemId ? 409 : 400);
    assert.equal(fs.readFileSync(file, 'utf8'), previous);
  }
});

test('revision checks catch stale editors, scope changes, catalog imports and group writes', t => {
  const { s } = setup(t);
  const before = token(s);
  let current = s.saveGroups({ ...before, groups: [group()] });
  rejected(() => s.updateProduct({ ...before, ...costs() }), 409);
  rejected(() => s.saveGroups({ ...before, groups: [] }), 409);
  rejected(() => s.updateProduct(costs()), 409);
  const groupToken = token(s);
  current = s.updateProduct({ ...groupToken, ...costs() });
  rejected(() => s.saveGroups({ ...groupToken, groups: [] }), 409);
  const productToken = token(s);
  s.importCatalog({ products: [product('789', 'growth')] });
  rejected(() => s.updateProduct({ ...productToken, ...costs() }), 409);
  const importToken = token(s);
  s.saveScope({ products: [product('456', 'seller')] });
  rejected(() => s.saveGroups({ ...importToken, groups: [] }), 409);
  assert.ok(current.configured);
});

test('groups persist per vendor without changing finance scope or stored product metadata', t => {
  const { s, baseDir, service } = setup(t);
  const before = s.workspace(), file = path.join(baseDir, '.roas-data/coupang/A00012345/scope.json'), original = fs.readFileSync(file, 'utf8');
  const next = s.saveGroups({ ...token(s), groups: [group({ name: '  예시 그룹  ', itemIds: ['456', '123'] }), group({ id: 'empty', name: '비어 있는 그룹', itemIds: [] })] });
  assert.equal(next.scopeKey, before.scopeKey);
  assert.deepEqual(next.products, before.products);
  assert.equal(fs.readFileSync(file, 'utf8'), original);
  assert.deepEqual(next.groups[0], group({ itemIds: ['123', '456'] }));
  assert.deepEqual(service().workspace(), next);
  s.saveCredentials({ ...credentials, vendorId: 'A00054321' });
  s.importCatalog({ products: [product('123', 'growth'), product('456', 'seller')] });
  assert.deepEqual(s.workspace().groups, []);
  assert.notEqual(s.workspace().revision, before.revision, 'same catalog in another vendor never has the same edit revision');
  rejected(() => s.saveGroups({ scopeKey: next.scopeKey, revision: next.revision, groups: [] }), 409);
  s.saveCredentials(credentials);
  assert.deepEqual(s.workspace(), next);
  s.saveScope({ products: [product('456', 'seller')] });
  assert.deepEqual(s.workspace().groups[0].itemIds, ['456']);
  s.saveScope({ products: before.products });
  assert.deepEqual(s.workspace().groups, next.groups, 'temporarily unselected memberships remain stored');
  assert.deepEqual(s.saveGroups({ ...token(s), groups: [] }).groups, []);
});

test('group validation rejects invalid IDs, duplicate membership and unselected options without partial saves', t => {
  const { s, baseDir } = setup(t);
  s.saveGroups({ ...token(s), groups: [group()] });
  const file = path.join(baseDir, '.roas-data/coupang/A00012345/groups.json'), previous = fs.readFileSync(file, 'utf8');
  const invalidGroups = [null, Array.from({ length: 101 }, (_, i) => group({ id: 'g' + i })), [group({ id: '../x' })], [group({ id: '' })], [group({ name: ' ' })], [group({ name: 'x'.repeat(61) })], [group({ name: 'bad\nname' })], [group(), group()], [group({ itemIds: ['123', '123'] })], [group({ itemIds: ['999'] })], [group({ itemIds: ['0'] })], [group({ itemIds: [true] })], [group({ itemIds: Array(501).fill('123') })]];
  for (const groups of invalidGroups) {
    rejected(() => s.saveGroups({ ...token(s), groups }), 400);
    assert.equal(fs.readFileSync(file, 'utf8'), previous);
  }
});


test('analytics identifies the exact vendor workspace revision even when option scopes match', t => {
  const { s } = setup(t);
  const query = { since: date, until: date, channel: 'all', view: 'sales' };
  const first = s.analytics(query);
  assert.equal(first.workspaceRevision, s.workspace().revision);
  s.saveGroups({ ...token(s), groups: [group()] });
  const grouped = s.analytics(query);
  assert.equal(grouped.workspaceRevision, s.workspace().revision);
  assert.notEqual(grouped.workspaceRevision, first.workspaceRevision);
  assert.equal(grouped.scopeKey, first.scopeKey);
  s.updateProduct({ ...token(s), ...costs() });
  const edited = s.analytics(query);
  assert.equal(edited.workspaceRevision, s.workspace().revision);
  assert.notEqual(edited.workspaceRevision, grouped.workspaceRevision);
  s.saveCredentials({ ...credentials, vendorId: 'A00054321' });
  s.importCatalog({ products: [product('123', 'growth'), product('456', 'seller')] });
  const otherVendor = s.analytics(query);
  assert.equal(otherVendor.scopeKey, first.scopeKey);
  assert.equal(otherVendor.workspaceRevision, s.workspace().revision);
  assert.notEqual(otherVendor.workspaceRevision, first.workspaceRevision);
});


test('saving the visible group list preserves hidden members but respects explicit removal and deletion', t => {
  const { s } = setup(t);
  const allProducts = s.workspace().products;
  s.saveGroups({ ...token(s), groups: [group({ id: 'g1' }), group({ id: 'g2', name: '다른 그룹', itemIds: ['456'] })] });
  s.saveScope({ products: [product('456', 'seller')] });
  const narrowed = s.workspace();
  assert.deepEqual(narrowed.groups.find(g => g.id === 'g1').itemIds, []);
  s.saveGroups({ ...token(s), groups: narrowed.groups.map(g => g.id === 'g2' ? { ...g, name: '이름 수정' } : g).concat(group({ id: 'g3', name: '새 그룹', itemIds: ['456'] })) });
  s.saveScope({ products: allProducts });
  assert.deepEqual(s.workspace().groups.find(g => g.id === 'g1').itemIds, ['123']);
  assert.equal(s.workspace().groups.find(g => g.id === 'g2').name, '이름 수정');
  s.saveGroups({ ...token(s), groups: s.workspace().groups.map(g => g.id === 'g1' ? { ...g, itemIds: [] } : g) });
  s.saveScope({ products: [product('456', 'seller')] });
  s.saveGroups({ ...token(s), groups: s.workspace().groups.filter(g => g.id !== 'g2').map(g => ({ ...g, name: g.name + ' 수정' })) });
  s.saveScope({ products: allProducts });
  assert.deepEqual(s.workspace().groups.find(g => g.id === 'g1').itemIds, [], 'explicit removal of a selected option remains removed');
  assert.equal(s.workspace().groups.some(g => g.id === 'g2'), false, 'deleting a group also deletes all hidden memberships');
});

test('retained plus current memberships are capped atomically at 500 options per group', t => {
  const { s, baseDir } = setup(t);
  const products = Array.from({ length: 500 }, (_, i) => product(String(i + 1000), 'growth'));
  s.saveScope({ products });
  s.saveGroups({ ...token(s), groups: [group({ itemIds: products.map(p => p.itemId) })] });
  const file = path.join(baseDir, '.roas-data/coupang/A00012345/groups.json'), previous = fs.readFileSync(file, 'utf8');
  s.saveScope({ products: [product('9999', 'growth')] });
  assert.throws(() => s.saveGroups({ ...token(s), groups: [group({ itemIds: ['9999'] })] }), error => error.status === 400 && /이전 집계 대상.*500.*새 그룹/.test(error.message));
  assert.equal(fs.readFileSync(file, 'utf8'), previous);
  s.saveScope({ products });
  assert.equal(s.workspace().groups[0].itemIds.length, 500);
});
