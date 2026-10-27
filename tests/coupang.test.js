'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const { createService, signature, COSTS, range, normalize, apiMoney } = require('../integrations/coupang/service.cjs');
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
  s.saveScope({ products: s.products({ since: date, until: date }).products.map(p => ({ ...p, unitCost: p.itemId === '123' ? 3000 : 2000 })) });
  const combined = s.report({ since: date, until: date }).daily[0];
  assert.equal(combined.gross, 120000); assert.equal(combined.quantity, 12); assert.equal(combined.estimatedProductCost, 26000);
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
test('internationalized seller money objects are accepted only in KRW and preserve fractional amounts', () => {
  assert.equal(apiMoney({ currencyCode: 'KRW', units: '12345', nanos: 500000000 }), 12345.5);
  assert.equal(apiMoney({ currencyCode: 'USD', units: '12345', nanos: 0 }), null);
  assert.equal(apiMoney({ currencyCode: 'KRW', units: '', nanos: 0 }), null);
  assert.equal(apiMoney({ currencyCode: 'KRW', units: '1', nanos: 1000000000 }), null);
  const raw = { orderId: 1234, shipmentBoxId: 111, orderedAt: date + 'T12:00:00+09:00', orderItems: [{ vendorItemId: 123, shippingCount: 1, orderPrice: { currencyCode: 'KRW', units: '390000', nanos: 0 } }] };
  assert.equal(normalize(raw, 'seller', date)[0].gross, 390000);
});
test('a seven-day request partitions rows by KST date and writes explicit empty days only after all pages succeed', async t => {
  const calls = [];
  const { s } = setup(t, async url => {
    const u = new URL(url); calls.push(u);
    return { ok: true, json: async () => ({ code: 200, data: [rg()] }) };
  });
  await s.sync({ since: '2026-10-19', until: date, channel: 'growth' });
  assert.equal(calls.length, 1); assert.equal(calls[0].searchParams.get('paidDateFrom'), '20261019');
  assert.equal(calls[0].searchParams.get('paidDateTo'), '20261025');
  const r = s.report({ since: '2026-10-19', until: date });
  assert.equal(r.daily.find(r => r.date === '2026-10-19' && r.channel === 'growth').gross, 0);
  assert.equal(r.daily.find(r => r.date === date && r.channel === 'growth').gross, 20000);
});
test('year history starts immediately, uses 53 seven-day growth requests and retains daily snapshots across service restarts', async t => {
  const calls = [];
  const { s, baseDir } = setup(t, async url => { const u = new URL(url); calls.push(u); return { ok: true, json: async () => ({ code: 200, data: [] }) }; });
  const result = s.startHistory({ since: '2025-10-26', until: date, channels: ['growth'] });
  assert.equal(result.running, true); assert.equal(result.totalDays, 365);
  await s.waitForHistory(); const h = s.historyStatus(); assert.equal(h.status, 'completed'); assert.equal(h.completedDays, 365); assert.equal(calls.length, 53);
  for (const u of calls) { const f = u.searchParams.get('paidDateFrom'), z = u.searchParams.get('paidDateTo'); const dt = x => Date.parse(x.slice(0, 4) + '-' + x.slice(4, 6) + '-' + x.slice(6)); assert.ok(dt(z) - dt(f) <= 6 * 86400000); }
  const cache = path.join(baseDir, '.roas-data/coupang/A00012345/orders'); assert.equal(fs.readdirSync(cache).length, 365);
  const protect = (mode, data) => mode === 'encrypt' ? Buffer.from(data).toString('base64') : Buffer.from(data, 'base64').toString();
  const next = createService({ baseDir, protect, now: () => now });
  assert.equal(next.historyStatus().completedDays, 365); assert.equal(next.report({ since: '2025-10-26', until: date }).daily.length, 730);
});
test('both channels use independent seven-day windows and known snapshots are reused without duplicating totals', async t => {
  const calls = [];
  const { s } = setup(t, async url => { calls.push(new URL(url)); return { ok: true, json: async () => ({ code: 200, data: [] }) }; });
  const input = { since: '2026-10-01', until: '2026-10-14', channels: ['growth', 'seller'] };
  s.startHistory(input); await s.waitForHistory();
  assert.equal(calls.length, 14); assert.equal(s.historyStatus().completedDays, 28);
  assert.equal(calls.filter(u => u.pathname.endsWith('/rg/orders')).length, 2);
  s.startHistory(input); await s.waitForHistory(); assert.equal(calls.length, 14); assert.equal(s.historyStatus().skippedDays, 28);
  assert.equal(s.report({ since: '2026-10-01', until: '2026-10-14' }).daily.length, 28);
});
test('history failure checkpoints previous chunks and resumes after restart without marking failed days as zero', async t => {
  let failRequest = true; const calls = [];
  const { s, baseDir } = setup(t, async url => {
    const u = new URL(url); const start = u.searchParams.get('paidDateFrom'); calls.push(start);
    if (start === '20261008' && failRequest) return { ok: false, status: 403 };
    return { ok: true, json: async () => ({ code: 200, data: [] }) };
  });
  s.startHistory({ since: '2026-10-01', until: '2026-10-21', channels: ['growth'] }); await s.waitForHistory();
  assert.equal(s.historyStatus().status, 'failed'); assert.equal(s.historyStatus().completedDays, 7);
  assert.equal(s.report({ since: '2026-10-08', until: '2026-10-08' }).daily[0].gross, null);
  const file = path.join(baseDir, '.roas-data/coupang/A00012345/history.json'); const interrupted = JSON.parse(fs.readFileSync(file)); interrupted.status = 'running'; fs.writeFileSync(file, JSON.stringify(interrupted));
  assert.equal(s.historyStatus().status, 'paused');
  failRequest = false; s.startHistory({ resume: true }); await s.waitForHistory();
  assert.equal(s.historyStatus().status, 'completed'); assert.equal(s.historyStatus().completedDays, 21);
  assert.deepEqual(calls, ['20261001', '20261008', '20261008', '20261015']);
});
test('history pause finishes the active chunk, blocks account changes and resumes the rest', async t => {
  let resolve, first = true;
  const { s } = setup(t, async () => {
    if (first) { first = false; return new Promise(r => { resolve = r; }); }
    return { ok: true, json: async () => ({ code: 200, data: [] }) };
  });
  s.startHistory({ since: '2026-10-01', until: '2026-10-14', channels: ['growth'] });
  await new Promise(r => setImmediate(r)); assert.throws(() => s.saveCredentials(config), /수집 중/);
  s.pauseHistory(); resolve({ ok: true, json: async () => ({ code: 200, data: [] }) }); await s.waitForHistory();
  assert.equal(s.historyStatus().status, 'paused'); assert.equal(s.historyStatus().completedDays, 7);
  s.startHistory({ resume: true }); await s.waitForHistory(); assert.equal(s.historyStatus().completedDays, 14);
});
test('temporary rate limits retry with a new signed request while authorization failures stop without repeated attempts', async t => {
  let count = 0;
  const { s } = setup(t, async () => ++count === 1 ? { ok: false, status: 429 } : { ok: true, json: async () => ({ code: 200, data: [] }) });
  await s.sync({ since: date, until: date, channel: 'growth' }); assert.equal(count, 2);
});
test('automatic refresh collects recent seven days before a year backfill and preserves older saved history', async t => {
  const calls = [];
  const { s, baseDir } = setup(t, async url => { calls.push(new URL(url)); return { ok: true, json: async () => ({ code: 200, data: [] }) }; });
  assert.equal((await s.automatic()).started, true); assert.equal(calls.length, 7);
  assert.equal(s.historyStatus().status, 'idle');
  s.startHistory({ since: '2025-10-26', until: date, channels: ['growth', 'seller'] }); await s.waitForHistory();
  assert.ok(s.status().backfill.growth.completedAt); assert.ok(s.status().backfill.seller.completedAt);
  const oldFile = path.join(baseDir, '.roas-data/coupang/A00012345/orders/2025-10-26-growth.json'), oldBytes = fs.readFileSync(oldFile);
  calls.length = 0; const r = s.refresh(); await s.waitForRefresh(); assert.equal(r.started, true); assert.equal(calls.length, 7);
  for (const u of calls) {
    if (u.pathname.endsWith('/rg/orders')) { assert.equal(u.searchParams.get('paidDateFrom'), '20261020'); assert.equal(u.searchParams.get('paidDateTo'), '20261026'); }
    else { assert.equal(u.searchParams.get('createdAtFrom'), '2026-10-20+09:00'); assert.equal(u.searchParams.get('createdAtTo'), '2026-10-26+09:00'); }
  }
  assert.equal(s.historyStatus().kind, 'manual'); assert.equal(s.status().automatic.error, null); assert.ok(s.status().automatic.lastCompletedAt);
  assert.deepEqual(fs.readFileSync(oldFile), oldBytes); assert.equal((await s.automatic()).started, false); assert.equal(calls.length, 7);
});
test('recent refresh preserves unfinished history and failed refreshes retain saved data and allow explicit retry', async t => {
  let failing = false;
  const fetchImpl = async () => failing ? { ok: false, status: 403 } : { ok: true, json: async () => ({ code: 200, data: [] }) };
  const { s, baseDir } = setup(t, fetchImpl);
  s.startHistory({ since: '2025-10-26', until: date, channels: ['growth'] }); await s.waitForHistory();
  const file = path.join(baseDir, '.roas-data/coupang/A00012345/history.json'); const original = fs.readFileSync(file, 'utf8'), pending = JSON.parse(original);
  pending.status = 'running'; pending.kind = 'manual'; fs.writeFileSync(file, JSON.stringify(pending));
  assert.equal((await s.automatic()).started, true); assert.equal(JSON.parse(fs.readFileSync(file)).kind, 'manual');
  assert.equal(JSON.parse(fs.readFileSync(file)).status, 'running');
  fs.writeFileSync(file, original); failing = true; s.refresh(); await s.waitForRefresh(); assert.equal(s.historyStatus().status, 'completed'); assert.match(s.status().automatic.error, /인증/);
  const protect = (mode, data) => mode === 'encrypt' ? Buffer.from(data).toString('base64') : Buffer.from(data, 'base64').toString();
  failing = false; const next = createService({ baseDir, protect, now: () => now, sleep: async () => {}, fetchImpl });
  assert.equal((await next.automatic()).reason, 'not-due');
  assert.equal(next.refresh().started, true); await next.waitForRefresh(); assert.equal(next.historyStatus().status, 'completed');
  assert.equal(next.status().automatic.status, 'completed');
  assert.ok(fs.existsSync(path.join(baseDir, '.roas-data/coupang/A00012345/orders/2025-10-26-growth.json')));
});

test('catalog import matches option IDs, preserves source zero costs with a notice, respects effective dates and survives manual scope save', async t => {
  const { s } = setup(t, async () => ({ok:true,json:async()=>({code:200,data:[rg()]})}));
  await s.sync({since:date,until:date,channel:'growth'});
  const catalog={products:[{itemId:'123',name:'위마망 백도씨',unitCost:3000,commissionRate:11.88,inboundFee:1182,deliveryFee:2172,costSince:date}]};
  const result=s.importCatalog(catalog); assert.equal(result.imported,1); assert.equal(result.missingCost,0);
  let row=s.report({since:date,until:date}).daily[0];
  assert.equal(row.estimatedProductCost,6000); assert.ok(Math.abs(row.estimatedCommission-2376)<1e-8); assert.equal(row.estimatedFulfillment,6708); assert.equal(row.profit,null);
  s.saveScope({products:[{itemId:'123',name:'위마망 백도씨',unitCost:3000}]}); assert.equal(s.status().products[0].commissionRate,11.88);
  const first=s.status(); assert.throws(()=>s.importCatalog({products:[...catalog.products,...catalog.products]}),/중복/); assert.deepEqual(s.status().products,first.products);
  s.importCatalog({products:[{...catalog.products[0],costSince:'2026-10-27'}]}); assert.equal(s.report({since:date,until:date}).daily[0].estimatedProductCost,null);
  s.importCatalog({products:[{...catalog.products[0],unitCost:0}]}); assert.equal(s.status().products[0].unitCost,0);
  assert.equal(s.status().products[0].productCostSourceZero,true);
  assert.equal(s.report({since:date,until:date}).daily[0].estimatedProductCost,0);
  assert.deepEqual(s.report({since:date,until:date}).daily[0].zeroCostItemIds,['123']);
});
