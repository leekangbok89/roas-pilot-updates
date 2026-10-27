'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const { createService, signature, COSTS, range, normalize } = require('../integrations/coupang/service.cjs');
const now = Date.parse('2026-10-26T05:00:00Z');
const date = '2026-10-25';
const config = { vendorId: 'A00012345', accessKey: 'test-access-key', secretKey: 'test-secret-key' };
const rg = (quantity = 2, price = '10000') => ({ vendorId: config.vendorId, orderId: 70000000001, paidAt: Date.parse(date + 'T15:00:00+09:00'), orderItems: [{ vendorItemId: 123, productName: '위마망 백도씨', salesQuantity: quantity, unitSalesPrice: price, currency: 'KRW' }] });
function setup(t, fetchImpl = async () => ({ ok: true, json: async () => ({ code: 200, data: [] }) })) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'roas-coupang-')); t.after(() => fs.rmSync(baseDir, { recursive: true, force: true }));
  const protect = (mode, data) => mode === 'encrypt' ? Buffer.from(data).toString('base64') : Buffer.from(data, 'base64').toString();
  const s = createService({ baseDir, protect, fetchImpl, now: () => now, sleep: async () => {} }); s.saveCredentials(config); s.saveScope({ products: [{ itemId: '123', name: '위마망 백도씨', unitCost: 3000 }] });
  return { s, baseDir };
}
function entry(s, channel = 'growth', values = {}) {
  const report = s.report({ since: date, until: date }), row = report.daily.find(r => r.channel === channel);
  return { date, channel, scopeKey: report.scopeKey, basis: row.basis, reviewed: true, ...Object.fromEntries(COSTS.map(k => [k, 0])), ...values };
}
test('HMAC signs the exact encoded query and UTC date without logging credentials', () => {
  const query = 'createdAtFrom=2026-10-25%2B09%3A00', uri = '/test';
  const digest = crypto.createHmac('sha256', config.secretKey).update('261026T050000ZGET' + uri + query).digest('hex');
  assert.equal(signature(config, uri, query, now), 'CEA algorithm=HmacSHA256, access-key=test-access-key, signed-date=261026T050000Z, signature=' + digest);
});
test('strict date ranges and unsafe numeric IDs are rejected', () => {
  assert.throws(() => range('2026-02-30', '2026-02-30', now), /날짜/);
  assert.throws(() => range('2026-10-20', '2026-10-27', now), /날짜/);
  assert.throws(() => range('2026-10-18', date, now, 7), /7일/);
  assert.throws(() => normalize({ ...rg(), orderId: 9007199254740992 }, 'growth', date), /응답/);
  const invalid = rg(); invalid.orderItems[0].currency = 'USD'; assert.throws(() => normalize(invalid, 'growth', date), /통화/);
});
test('missing costs remain unknown, explicit zero completes a day, negative refund sales are supported', t => {
  const { s } = setup(t); let r = s.report({ since: date, until: date });
  assert.equal(r.summaries.growth.profit, null); assert.equal(r.daily[0].gross, null);
  assert.throws(() => s.saveLedger(entry(s, 'growth', { advertising: '' })), /모든 비용/);
  assert.throws(() => s.saveLedger(entry(s, 'growth', { reviewed: false })), /확인/);
  s.saveLedger(entry(s, 'growth')); r = s.report({ since: date, until: date });
  assert.equal(r.summaries.growth.profit, 0); assert.equal(r.summaries.all.profit, null);
  s.saveLedger(entry(s, 'seller', { netSales: -1000, returns: 500 }));
  r = s.report({ since: date, until: date }); assert.equal(r.summaries.all.profit, -1500);
});
test('paginates growth orders, deduplicates repeated rows, isolates brands and stores no customer information', async t => {
  const calls = [];
  const { s, baseDir } = setup(t, async (url, init) => {
    const u = new URL(url); calls.push({ url: u, init });
    const other = { ...rg(), orderId: 70000000002, orderItems: [{ ...rg().orderItems[0], vendorItemId: 456, productName: '트루버', salesQuantity: 10 }] };
    return { ok: true, json: async () => ({ code: 200, data: [{ ...rg(), receiver: { name: 'PRIVATE PERSON', addr1: 'PRIVATE ADDRESS' } }, other], nextToken: u.searchParams.has('nextToken') ? '' : 'next-page' }) };
  });
  await s.sync({ since: date, until: date, channel: 'growth' }); const r = s.report({ since: date, until: date });
  assert.equal(r.daily[0].gross, 20000); assert.equal(r.daily[0].quantity, 2); assert.equal(r.daily[0].estimatedProductCost, 6000);
  assert.equal(calls.length, 2); assert.equal(calls[1].url.searchParams.get('nextToken'), 'next-page'); assert.equal(calls[0].init.method, 'GET');
  const raw = fs.readFileSync(path.join(baseDir, '.roas-data/coupang/A00012345/orders/' + date + '-growth.json'), 'utf8');
  assert.ok(!raw.includes('PRIVATE')); assert.equal(s.products({ since: date, until: date }).products.length, 2);
  assert.ok(!JSON.stringify(s.status()).includes('test-secret-key'));
  assert.ok(!fs.readFileSync(path.join(baseDir, '.roas-private/coupang.dpapi'), 'utf8').includes('test-secret-key'));
});
test('calculates all costs once; changed order data invalidates a previously reconciled profit', async t => {
  let quantity = 2;
  const { s } = setup(t, async () => ({ ok: true, json: async () => ({ code: 200, data: [rg(quantity)] }) }));
  await s.sync({ since: date, until: date, channel: 'growth' });
  const original = entry(s, 'growth', { netSales: 19000, productCost: 6000, commission: 2000, advertising: 1000, inbound: 500, delivery: 1000, storage: 100, returns: 200, other: 50 }); s.saveLedger(original);
  assert.equal(s.report({ since: date, until: date }).summaries.growth.profit, 8150);
  // Re-fetching identical quantities should not invalidate a reviewed entry.
  await s.sync({ since: date, until: date, channel: 'growth' }); assert.equal(s.report({ since: date, until: date }).summaries.growth.profit, 8150);
  quantity = 3; await s.sync({ since: date, until: date, channel: 'growth' });
  const r = s.report({ since: date, until: date }); assert.equal(r.summaries.growth.profit, null); assert.equal(r.daily[0].stale, true);
  assert.throws(() => s.saveLedger(original), /変更|변경/);
});
test('changing selected products isolates the ledger; changing unit cost preserves reconciled totals', t => {
  const { s } = setup(t); const original = entry(s, 'growth', { netSales: 20000, productCost: 6000 }); s.saveLedger(original);
  s.saveScope({ products: [{ itemId: '123', name: '위마망', unitCost: 4000 }] }); assert.equal(s.report({ since: date, until: date }).summaries.growth.profit, 14000);
  s.saveScope({ products: [{ itemId: '456', name: '다른 상품', unitCost: null }] }); assert.equal(s.report({ since: date, until: date }).summaries.growth.profit, null);
  assert.throws(() => s.saveLedger(original), /선택/);
  s.saveCredentials({ ...config, vendorId: 'A00054321' }); assert.deepEqual(s.status().products, []);
});
test('failed pagination and authentication preserve saved data; upstream messages never expose keys', async t => {
  let mode = 'ok';
  const { s } = setup(t, async () => mode === 'auth' ? { ok: false, status: 403 } : { ok: true, json: async () => ({ code: 200, data: [rg()], nextToken: mode === 'loop' ? 'repeated' : '' }) });
  await s.sync({ since: date, until: date, channel: 'growth' });
  mode = 'loop'; await assert.rejects(s.sync({ since: date, until: date, channel: 'growth' }), /완료되지/);
  assert.equal(s.report({ since: date, until: date }).daily[0].gross, 20000);
  mode = 'auth'; await assert.rejects(s.sync({ since: date, until: date, channel: 'growth' }), /인증/);
  assert.equal(s.report({ since: date, until: date }).daily[0].gross, 20000);
});
test('seller paginates every status; same order and option stay separate for different shipments', async t => {
  const states = new Set();
  const { s } = setup(t, async url => {
    const u = new URL(url); states.add(u.searchParams.get('status')); assert.equal(u.searchParams.get('createdAtFrom'), date + '+09:00');
    const data = u.searchParams.get('status') === 'FINAL_DELIVERY' ? [11, 12].map(shipmentBoxId => ({ orderId: 70000000001, shipmentBoxId, orderedAt: date + 'T23:59:00', paidAt: '2026-10-26T00:01:00', orderItems: [{ vendorItemId: 123, vendorItemName: '위마망', shippingCount: 1, orderPrice: 10000 }] })) : [];
    return { ok: true, json: async () => ({ code: 200, data }) };
  });
  await s.sync({ since: date, until: date, channel: 'seller' });
  const r = s.report({ since: date, until: date }); assert.equal(states.size, 6); assert.equal(r.daily[1].gross, 20000); assert.equal(r.daily[1].quantity, 2);
});
test('unregistered product costs are unknown, and overlapping collections are rejected', async t => {
  let resolve;
  const { s } = setup(t, () => new Promise(r => { resolve = r; })); s.saveScope({ products: [{ itemId: '123', name: '위마망', unitCost: null }] });
  const op = s.sync({ since: date, until: date, channel: 'growth' }); await new Promise(r => setImmediate(r));
  await assert.rejects(s.sync({ since: date, until: date, channel: 'growth' }), /수집 중/);
  assert.throws(() => s.saveCredentials(config), /수집 중/);
  resolve({ ok: true, json: async () => ({ code: 200, data: [rg()] }) }); await op;
  assert.equal(s.report({ since: date, until: date }).daily[0].estimatedProductCost, null);
});
