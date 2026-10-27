'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { createService } = require('../integrations/coupang/service.cjs');
const credentials = { vendorId: 'A00012345', accessKey: 'synthetic-access', secretKey: 'synthetic-secret' };
function setup(t) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coupang-refresh-'));
  t.after(() => fs.rmSync(baseDir, { recursive: true, force: true }));
  let time = Date.parse('2026-10-27T05:00:00Z'), failing = false, calls = 0, gate = null;
  const options = { baseDir, now: () => time, sleep: async () => {}, protect: (_mode, value) => value,
    fetchImpl: async url => { calls++; if (gate) await gate; if (failing && new URL(url).pathname.endsWith('ordersheets')) return { ok: false, status: 403 };
      return { ok: true, json: async () => ({ code: 200, data: [] }) }; } };
  const service = createService(options); service.saveCredentials(credentials);
  service.saveScope({ products: [{ itemId: '123', name: '예시 상품', unitCost: 1000 }] });
  return { service, baseDir, recreate: () => createService(options), calls: () => calls,
    advance: ms => { time += ms; }, fail: value => { failing = value; }, block: promise => { gate = promise; } };
}
test('automatic refresh is durable, hourly, and never refetches while reading stored reports', async t => {
  const a = setup(t), s = a.service;
  assert.equal((await s.automatic()).started, true); assert.equal(a.calls(), 7);
  const first = s.status().automatic;
  assert.equal(first.status, 'completed'); assert.equal(first.since, '2026-10-21'); assert.equal(first.until, '2026-10-27');
  assert.equal(first.intervalMinutes, 60); assert.equal(first.channels.growth.savedDays.length, 7);
  s.analytics({ since: '2026-10-21', until: '2026-10-27', channel: 'all' }); s.status();
  assert.equal(a.calls(), 7);
  assert.equal((await a.recreate().automatic()).reason, 'not-due'); assert.equal(a.calls(), 7);
  a.advance(3600000); assert.equal((await s.automatic()).started, true); assert.equal(a.calls(), 14);
});
test('background refresh returns immediately, rejects races and saves partial success without erasing previous data', async t => {
  const a = setup(t), s = a.service;
  await s.automatic(); const sellerFile = path.join(a.baseDir, '.roas-data/coupang/A00012345/orders/2026-10-27-seller.json');
  const old = fs.readFileSync(sellerFile); a.fail(true);
  let release; a.block(new Promise(resolve => { release = resolve; }));
  const r = s.refresh(); assert.equal(r.started, true); assert.equal(r.automatic.running, true);
  assert.equal(s.refresh().reason, 'running'); assert.throws(() => s.saveCredentials(credentials), /수집/);
  assert.throws(() => s.startHistory({ since: '2026-10-20', until: '2026-10-27' }), /수집/);
  release(); a.block(null); await s.waitForRefresh();
  const state = s.status().automatic; assert.equal(state.running, false); assert.equal(state.status, 'partial');
  assert.equal(state.channels.growth.status, 'completed'); assert.equal(state.channels.seller.status, 'failed');
  assert.match(state.error, /인증/); assert.deepEqual(fs.readFileSync(sellerFile), old);
  assert.equal((await s.automatic()).reason, 'not-due');
});
test('restart exposes interrupted status and resumes recent refresh without replacing manual checkpoints', async t => {
  const a = setup(t), file = path.join(a.baseDir, '.roas-data/coupang/A00012345/automatic.json');
  fs.writeFileSync(file, JSON.stringify({ running: true, status: 'running', lastStartedAt: '2026-10-27T05:00:00Z' }));
  const next = a.recreate(); assert.equal(next.status().automatic.status, 'paused'); assert.equal(next.status().automatic.running, false);
  assert.equal((await next.automatic()).started, true); assert.equal(next.status().automatic.status, 'completed');
  assert.throws(() => next.refresh({ channels: ['growth', 'growth'] }), /배송/);
});
