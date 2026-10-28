'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { createService } = require('../integrations/coupang/service.cjs');
const clock = Date.parse('2026-10-29T03:00:00Z');
const credentials = { vendorId: 'A00012345', accessKey: 'synthetic-access-key', secretKey: 'synthetic-secret-key' };
function setup(t) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coupang-backfill-'));
  t.after(() => fs.rmSync(baseDir, { recursive: true, force: true }));
  const calls = [], blocked = new Set();
  const options = { baseDir, now: () => clock, protect: (_mode, value) => value, sleep: async () => {}, fetchImpl: async input => {
    const url = new URL(input), channel = url.pathname.endsWith('/rg/orders') ? 'growth' : 'seller'; calls.push({ url, channel });
    if (blocked.has(channel)) return new Response(JSON.stringify({ message: 'Not allowed IP' }), { status: 403 });
    return { ok: true, json: async () => ({ code: 200, data: [] }) };
  } };
  const s = createService(options); s.saveCredentials(credentials);
  const root = path.join(baseDir, '.roas-data', 'coupang', credentials.vendorId);
  const historyFile = path.join(root, 'history.json');
  const snapshotFile = (date, channel) => path.join(root, 'orders', date + '-' + channel + '.json');
  return { s, calls, blocked, root, historyFile, snapshotFile, recreate: () => createService(options) };
}
test('maximum collection covers 365 KST days once and queries both delivery methods from recent to old', async t => {
  const { s, calls } = setup(t), first = s.startHistory({ mode: 'maximum' });
  assert.equal(first.totalDays, 730); assert.equal(first.since, '2025-10-30'); assert.equal(first.until, '2026-10-29');
  assert.equal(s.startHistory({ mode: 'maximum' }).id, first.id, 'double clicks reuse the active checkpoint');
  await s.waitForHistory();
  const h = s.historyStatus(); assert.equal(h.status, 'completed'); assert.equal(h.completedDays, 730);
  assert.equal(calls.length, 53 * 7); assert.equal(calls[0].channel, 'growth'); assert.equal(calls[1].channel, 'seller'); assert.equal(calls[7].channel, 'growth');
  const growth = calls.filter(call => call.channel === 'growth');
  assert.equal(growth[0].url.searchParams.get('paidDateFrom'), '20261023');
  assert.equal(growth[0].url.searchParams.get('paidDateTo'), '20261029');
  assert.equal(growth.at(-1).url.searchParams.get('paidDateFrom'), '20251030');
  assert.ok(s.status().backfill.growth.completedAt); assert.ok(s.status().backfill.seller.completedAt);
});
test('a 403 stops only that delivery method and retry resumes missing days without replacing completed history', async t => {
  const { s, calls, blocked, snapshotFile } = setup(t); blocked.add('growth');
  const first = s.startHistory({ mode: 'maximum' }); await s.waitForHistory();
  const failed = s.historyStatus(); assert.equal(failed.status, 'failed'); assert.equal(failed.completedDays, 365);
  assert.equal(calls.filter(call => call.channel === 'growth').length, 1, 'auth failures are never retried by date');
  assert.equal(failed.done.growth.length, 0); assert.equal(failed.done.seller.length, 365);
  assert.equal(failed.failures.length, 1); assert.equal(failed.failures[0].diagnosis.category, 'ip_not_allowed');
  assert.equal(fs.existsSync(snapshotFile('2026-10-29', 'growth')), false, 'missing orders cannot become an empty snapshot');
  assert.deepEqual(s.status().backfill, {}, 'partial history is never marked complete');
  const saved = fs.readFileSync(snapshotFile('2026-10-29', 'seller'));
  blocked.clear(); calls.length = 0;
  assert.equal(s.startHistory({ mode: 'maximum' }).id, first.id); await s.waitForHistory();
  assert.equal(s.historyStatus().status, 'completed'); assert.equal(s.historyStatus().completedDays, 730);
  assert.equal(calls.length, 53); assert.ok(calls.every(call => call.channel === 'growth'));
  assert.deepEqual(fs.readFileSync(snapshotFile('2026-10-29', 'seller')), saved);
});
test('both authorization errors remain visible and no missing date is counted as collected', async t => {
  const { s, calls, blocked } = setup(t); blocked.add('growth'); blocked.add('seller');
  s.startHistory({ mode: 'maximum' }); await s.waitForHistory();
  const h = s.historyStatus(); assert.equal(calls.length, 2); assert.equal(h.completedDays, 0); assert.equal(h.status, 'failed');
  assert.deepEqual(h.failures.map(failure => failure.channel), ['growth', 'seller']);
  assert.match(h.error, /로켓그로스:/); assert.match(h.error, /판매자배송:/);
});
test('startup resumes an interrupted checkpoint and revalidates saved days before declaring completion', async t => {
  const { s, calls, historyFile, snapshotFile, recreate } = setup(t);
  s.startHistory({ since: '2026-10-01', until: '2026-10-14', channels: ['growth'] }); await s.waitForHistory();
  const h = JSON.parse(fs.readFileSync(historyFile)); h.status = 'running'; h.pauseRequested = false;
  fs.writeFileSync(historyFile, JSON.stringify(h)); fs.unlinkSync(snapshotFile('2026-10-01', 'growth'));
  fs.writeFileSync(snapshotFile('2026-10-02', 'growth'), JSON.stringify({ date: '2026-10-02', channel: 'growth', vendorId: credentials.vendorId, rows: [{ itemId: '123', gross: 'unknown' }] }));
  calls.length = 0; const restarted = recreate();
  const result = await restarted.automatic({ startup: true });
  assert.equal(result.reason, 'history-resumed'); assert.equal(calls.length, 1);
  assert.equal(restarted.historyStatus().id, h.id); assert.equal(restarted.historyStatus().completedDays, 14); assert.equal(restarted.historyStatus().status, 'completed');
  assert.equal((await restarted.automatic({ startup: true })).reason, 'startup-already-checked');
});
test('startup respects an explicit pause and an authorization failure', async t => {
  const { s, calls, blocked, historyFile, recreate } = setup(t); blocked.add('growth');
  s.startHistory({ since: '2026-10-01', until: '2026-10-14', channels: ['growth'] }); await s.waitForHistory(); calls.length = 0;
  assert.equal((await recreate().automatic({ startup: true })).reason, 'products-not-selected'); assert.equal(calls.length, 0);
  const h = JSON.parse(fs.readFileSync(historyFile)); h.status = 'running'; h.pauseRequested = true; fs.writeFileSync(historyFile, JSON.stringify(h));
  assert.equal((await recreate().automatic({ startup: true })).reason, 'products-not-selected'); assert.equal(calls.length, 0);
});
