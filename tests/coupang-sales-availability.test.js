'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createService } = require('../integrations/coupang/service.cjs');
const now = Date.parse('2026-10-27T05:00:00Z'), date = '2026-10-26';
const credentials = { vendorId: 'A00012345', accessKey: 'test-access-key', secretKey: 'test-secret-key' };
const protect = (mode, value) => mode === 'encrypt' ? Buffer.from(value).toString('base64') : Buffer.from(value, 'base64').toString();
const product = itemId => ({ itemId, productId: '7000', name: '예시 상품', productName: '예시 상품', optionName: itemId, channel: 'growth', unitCost: 3000, commissionRate: 10, inboundFee: 100, deliveryFee: 200 });
const sale = (values = {}) => ({ productId: '7000', itemId: '123', channel: 'growth', name: '예시 상품', optionName: '기본', quantity: 2, adQuantity: 1, organicQuantity: 1, sales: 20000, profitBeforeAds: 10000, advertising: 2000, adSales: 10000, adProfitBeforeAds: 5000, ...values });
function setup(t, rows = []) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coupang-available-'));
  t.after(() => fs.rmSync(baseDir, { recursive: true, force: true }));
  const s = createService({ baseDir, protect, now: () => now, sleep: async () => {}, fetchImpl: async () => ({ ok: true, json: async () => ({ code: 200, data: rows }) }) });
  s.saveCredentials(credentials); s.importCatalog({ products: [product('123')] });
  return s;
}
const week = { since: '2026-10-20', until: date, channel: 'all' };
test('growth-only collected API sales remain available in default all-channel seven-day views', async t => {
  const raw = { vendorId: credentials.vendorId, orderId: 700001, paidAt: Date.parse(date + 'T12:00:00+09:00'), orderItems: [{ vendorItemId: 123, salesQuantity: 2, unitSalesPrice: 10000, currency: 'KRW', productName: '예시 상품' }] };
  const s = setup(t, [raw]); await s.sync({ since: date, until: date, channel: 'growth' });
  for (const view of [undefined, 'sales', 'dashboard']) {
    const r = s.analytics({ ...week, view });
    assert.equal(r.summary.sales, null); assert.equal(r.summary.quantity, null); assert.equal(r.summary.netProfit, null);
    assert.deepEqual(r.summary.available, { sales: 20000, quantity: 2 });
    const day = r.daily.find(d => d.date === date);
    assert.equal(day.sales, null); assert.deepEqual(day.available, { sales: 20000, quantity: 2 });
    assert.deepEqual(day.channels.find(c => c.channel === 'seller').available, { sales: null, quantity: null });
    const knownItem = r.items.find(i => i.channel === 'growth' && i.available.sales !== null);
    assert.deepEqual(knownItem.available, { sales: 20000, quantity: 2 });
    if (view) assert.equal(knownItem.sales, null);
    if (view === 'dashboard') assert.deepEqual(r.productDaily[0].available, { sales: 20000, quantity: 2 });
    assert.ok(r.items.every(i => i.netProfit === null && i.roas === null));
  }
});
test('one-day Sellha import remains visible as collected revenue across a sparse seven-day period', t => {
  const s = setup(t); s.importSales({ date, rows: [sale()], acquisitionAdvertising: { growth: 0, seller: 0 } });
  const r = s.analytics({ ...week, view: 'sales' });
  assert.equal(r.summary.sales, null); assert.equal(r.summary.sourceNetProfit, null); assert.equal(r.summary.netProfit, null);
  assert.deepEqual(r.summary.available, { sales: 20000, quantity: 2 });
  assert.deepEqual(r.items[0].available, { sales: 20000, quantity: 2 });
  assert.equal(r.items[0].sales, null); assert.equal(r.items[0].roas, null);
  assert.deepEqual(r.daily[0].available, { sales: null, quantity: null });
});
test('partial selected-scope Sellha imports expose matched revenue without claiming full product coverage', t => {
  const s = setup(t); s.importCatalog({ products: [product('456')] });
  s.importSales({ date, rows: [sale(), sale({ itemId: '999', sales: 900000, quantity: 90 })], acquisitionAdvertising: { growth: 0 } });
  const r = s.analytics({ since: date, until: date, channel: 'growth', view: 'dashboard' });
  assert.equal(r.summary.sales, null); assert.equal(r.summary.netProfit, null);
  assert.deepEqual(r.summary.available, { sales: 20000, quantity: 2 });
  assert.deepEqual(r.daily[0].channels[0].available, { sales: 20000, quantity: 2 });
  assert.equal(r.productDaily.length, 1); assert.equal(r.productDaily[0].sales, null);
  assert.deepEqual(r.productDaily[0].available, { sales: 20000, quantity: 2 });
  assert.deepEqual(r.items.find(i => i.itemId === '456').available, { sales: null, quantity: null });
});
test('explicit collected zeros and signed refund subtotals remain distinct from no collection', async t => {
  const s = setup(t);
  const empty = s.analytics({ ...week, view: 'sales' });
  assert.deepEqual(empty.summary.available, { sales: null, quantity: null });
  assert.deepEqual(empty.items[0].available, { sales: null, quantity: null });
  await s.sync({ since: date, until: date, channel: 'growth' });
  const zero = s.analytics({ ...week, view: 'dashboard' });
  assert.equal(zero.summary.sales, null); assert.deepEqual(zero.summary.available, { sales: 0, quantity: 0 });
  s.importSales({ date, rows: [sale({ quantity: -1, adQuantity: 0, organicQuantity: -1, sales: -10000, profitBeforeAds: -5000, advertising: 0, adSales: 0, adProfitBeforeAds: 0 })] });
  const refund = s.analytics({ ...week, view: 'sales' });
  assert.deepEqual(refund.summary.available, { sales: -10000, quantity: -1 });
  assert.deepEqual(refund.items[0].available, { sales: -10000, quantity: -1 });
  assert.equal(refund.summary.netProfit, null);
});
test('complete periods retain exact strict totals and advertising calculations', t => {
  const s = setup(t);
  for (const day of ['2026-10-25', date]) s.importSales({ date: day, rows: [sale()], acquisitionAdvertising: { growth: 0, seller: 0 } });
  const r = s.analytics({ since: '2026-10-25', until: date, channel: 'all', view: 'sales' });
  assert.equal(r.summary.sales, 40000); assert.deepEqual(r.summary.available, { sales: 40000, quantity: 4 });
  assert.equal(r.summary.netProfit, 16000); assert.equal(r.items[0].sales, 40000);
  assert.deepEqual(r.items[0].available, { sales: 40000, quantity: 4 }); assert.equal(r.items[0].roas, 500);
});
