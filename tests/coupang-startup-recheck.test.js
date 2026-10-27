'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createService, COSTS } = require('../integrations/coupang/service.cjs');
const credentials = { vendorId: 'A00012345', accessKey: 'test-access-key', secretKey: 'test-secret-key' };
const protect = (mode, value) => mode === 'encrypt' ? Buffer.from(value).toString('base64') : Buffer.from(value, 'base64').toString();
const days = ['2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27'];
function setup(t) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coupang-startup-recheck-'));
  t.after(() => fs.rmSync(baseDir, { recursive: true, force: true }));
  let clock = Date.parse('2026-10-27T05:00:00Z'), failFetch = false;
  const calls = [], source = new Map([['2026-10-20', { quantity: 1, price: 7000 }], ['2026-10-25', { quantity: 2, price: 10000 }]]);
  const service = () => createService({ baseDir, protect, now: () => clock, sleep: async () => {}, fetchImpl: async url => {
    const u = new URL(url); calls.push(u);
    if (failFetch) return { ok: false, status: 403, text: async () => JSON.stringify({ message: 'not allowed IP' }) };
    const compact = day => day.replaceAll('-', '');
    const data = u.pathname.endsWith('/rg/orders') ? [...source].filter(([day]) => compact(day) >= u.searchParams.get('paidDateFrom') && compact(day) <= u.searchParams.get('paidDateTo')).map(([day, value]) => ({
      vendorId: credentials.vendorId, orderId: Number(day.replaceAll('-', '')),
      paidAt: Date.parse(day + 'T12:00:00+09:00'), orderItems: [{ vendorItemId: 123, productName: '예시 상품', salesQuantity: value.quantity, unitSalesPrice: value.price, currency: 'KRW' }]
    })) : [];
    return { ok: true, json: async () => ({ code: 200, data }) };
  } });
  const s = service(); s.saveCredentials(credentials);
  s.importCatalog({ products: [{ itemId: '123', productId: '7000', name: '예시 상품', channel: 'growth', unitCost: 3000, commissionRate: 10, inboundFee: 100, deliveryFee: 200 }] });
  const root = path.join(baseDir, '.roas-data/coupang', credentials.vendorId);
  const file = (day, channel = 'growth') => path.join(root, 'orders', day + '-' + channel + '.json');
  return { s, service, source, calls, root, file, advance: ms => { clock += ms; }, fail: () => { failFetch = true; } };
}
test('a new process rechecks the current KST seven days at startup within the persisted hour, exactly once per process', async t => {
  const { s, service, source, calls, file, advance } = setup(t);
  await s.sync({ since: '2026-10-20', until: '2026-10-20', channel: 'growth' });
  const previousWeek = fs.readFileSync(file('2026-10-20'), 'utf8'); calls.length = 0;
  assert.equal((await s.automatic({ startup: true })).started, true);
  assert.equal(calls.length, 7, 'one growth query and six seller status queries');
  const first = JSON.parse(fs.readFileSync(file('2026-10-25'), 'utf8'));
  assert.equal(first.rows[0].quantity, 2); assert.equal(first.rows[0].gross, 20000);
  assert.equal((await s.automatic({ startup: true })).started, false);
  s.status(); s.analytics({ since: days[0], until: days.at(-1), channel: 'all' });
  assert.equal(calls.length, 7, 'page/status/analytics reads do not trigger collection');
  source.set('2026-10-25', { quantity: 3, price: 12000 }); advance(30000);
  const restarted = service();
  assert.equal((await restarted.automatic()).started, false, 'interval polling still honors the persisted one-hour throttle');
  assert.equal(calls.length, 7);
  assert.equal((await restarted.automatic({ startup: true })).started, true);
  assert.equal(calls.length, 14);
  const recentQueries = calls.filter(u => u.pathname.endsWith('/rg/orders'));
  for (const u of recentQueries) { assert.equal(u.searchParams.get('paidDateFrom'), '20261021'); assert.equal(u.searchParams.get('paidDateTo'), '20261027'); }
  const changed = JSON.parse(fs.readFileSync(file('2026-10-25'), 'utf8'));
  assert.equal(changed.rows[0].quantity, 3); assert.equal(changed.rows[0].gross, 36000); assert.notEqual(changed.fetchedAt, first.fetchedAt);
  assert.equal(fs.readFileSync(file('2026-10-20'), 'utf8'), previousWeek, 'older snapshots outside today plus six days stay intact');
  assert.equal((await restarted.automatic({ startup: true })).started, false); assert.equal(calls.length, 14);
});
test('interval collection honors sixty minutes even after a startup bypass', async t => {
  const { s, calls, advance } = setup(t);
  await s.automatic({ startup: true }); assert.equal(calls.length, 7);
  advance(59 * 60000); assert.equal((await s.automatic()).started, false); assert.equal(calls.length, 7);
  advance(60000); assert.equal((await s.automatic()).started, true); assert.equal(calls.length, 14);
});
test('a startup check requested while another refresh runs stays pending and bypasses the hour after it finishes', async t => {
  const { s, calls } = setup(t);
  assert.equal(s.refresh({ channels: ['growth'] }).started, true);
  assert.equal((await s.automatic({ startup: true })).started, false);
  await s.waitForRefresh(); assert.equal(calls.length, 1);
  const deferred = await s.automatic();
  assert.equal(deferred.started, true); assert.equal(deferred.automatic.trigger, 'startup'); assert.equal(calls.length, 8);
  assert.equal((await s.automatic({ startup: true })).started, false); assert.equal(calls.length, 8);
});
test('sync verifies new, unchanged and changed stored rows; timestamps refresh while ledger validity depends on row changes', async t => {
  const { s, source, file, advance } = setup(t);
  const query = { since: days[0], until: days.at(-1), channel: 'growth' };
  const first = await s.sync(query);
  assert.deepEqual(first.verification, { newDays: days, changedDays: [], unchangedDays: [] });
  const snapshot = JSON.parse(fs.readFileSync(file('2026-10-25'), 'utf8'));
  const report = s.report({ since: '2026-10-25', until: '2026-10-25' }), day = report.daily.find(r => r.channel === 'growth');
  s.saveLedger({ date: '2026-10-25', channel: 'growth', scopeKey: report.scopeKey, basis: day.basis, reviewed: true,
    ...Object.fromEntries(COSTS.map(key => [key, 0])), netSales: 20000, productCost: 6000 });
  advance(1000);
  const unchanged = await s.sync(query);
  assert.deepEqual(unchanged.verification, { newDays: [], changedDays: [], unchangedDays: days });
  const rechecked = JSON.parse(fs.readFileSync(file('2026-10-25'), 'utf8'));
  assert.deepEqual(rechecked.rows, snapshot.rows); assert.notEqual(rechecked.fetchedAt, snapshot.fetchedAt);
  let current = s.report({ since: '2026-10-25', until: '2026-10-25' }).daily.find(r => r.channel === 'growth');
  assert.equal(current.stale, false); assert.equal(current.profit, 14000);
  source.set('2026-10-25', { quantity: 3, price: 12000 }); advance(1000);
  const changed = await s.sync(query);
  assert.deepEqual(changed.verification, { newDays: [], changedDays: ['2026-10-25'], unchangedDays: days.filter(day => day !== '2026-10-25') });
  current = s.report({ since: '2026-10-25', until: '2026-10-25' }).daily.find(r => r.channel === 'growth');
  assert.equal(current.gross, 36000); assert.equal(current.quantity, 3); assert.equal(current.stale, true); assert.equal(current.profit, null);
});
test('failed startup rechecks preserve prior saved snapshots and report the failure', async t => {
  const { s, service, file, advance, fail } = setup(t);
  await s.automatic({ startup: true });
  const before = days.flatMap(day => ['growth', 'seller'].map(channel => [file(day, channel), fs.readFileSync(file(day, channel), 'utf8')]));
  fail(); advance(30000);
  const restarted = service(), result = await restarted.automatic({ startup: true });
  assert.equal(result.started, true); assert.equal(result.automatic.status, 'failed');
  assert.ok(result.automatic.error);
  for (const [filename, bytes] of before) assert.equal(fs.readFileSync(filename, 'utf8'), bytes);
});
