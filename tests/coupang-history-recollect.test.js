'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { createService } = require('../integrations/coupang/service.cjs');
const DAY = 86400000, initialClock = Date.parse('2026-11-02T06:00:00Z');
const dates = Array.from({ length: 365 }, (_, i) => new Date(initialClock - (364 - i) * DAY).toISOString().slice(0, 10));
const credentials = { vendorId: 'A00012345', accessKey: 'synthetic-access-key', secretKey: 'synthetic-secret-key' };
function setup(t) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coupang-recollect-'));
  t.after(() => fs.rmSync(baseDir, { recursive: true, force: true }));
  let clock = initialClock, gate = null;
  const calls = [], blocked = new Set();
  const options = { baseDir, now: () => clock, protect: (_mode, value) => value, sleep: async () => {}, fetchImpl: async input => {
    const url = new URL(input), channel = url.pathname.endsWith('/rg/orders') ? 'growth' : 'seller';
    calls.push({ url, channel });
    if (gate) await gate;
    if (blocked.has(channel)) return new Response(JSON.stringify({ message: 'Not allowed IP' }), { status: 403 });
    return { ok: true, json: async () => ({ code: 200, data: [] }) };
  } };
  const s = createService(options); s.saveCredentials(credentials);
  s.saveScope({ products: [{ itemId: '123', name: 'Synthetic option', unitCost: 1000 }] });
  const root = path.join(baseDir, '.roas-data', 'coupang', credentials.vendorId);
  const historyFile = path.join(root, 'history.json');
  const snapshotFile = (date, channel) => path.join(root, 'orders', date + '-' + channel + '.json');
  const backupFile = (job, date, channel) => path.join(root, 'history-backups', job.id, 'orders', date + '-' + channel + '.json');
  function seed() {
    fs.mkdirSync(path.join(root, 'orders'), { recursive: true });
    for (const date of dates) for (const channel of ['growth', 'seller']) fs.writeFileSync(snapshotFile(date, channel), JSON.stringify({
      date, channel, vendorId: credentials.vendorId, fetchedAt: '2020-01-01T00:00:00Z', rows: [{
        key: '100:200:123', orderId: '100', itemId: '123', name: 'Old synthetic order', quantity: 1, gross: 9000
      }]
    }));
  }
  return { s, calls, blocked, root, historyFile, snapshotFile, backupFile, seed, recreate: () => createService(options),
    advance: ms => { clock += ms; }, block: promise => { gate = promise; } };
}
test('forced maximum recollect fetches all saved dates and backs up original order bytes without touching other data', async t => {
  const a = setup(t); a.seed();
  const old = fs.readFileSync(a.snapshotFile(dates[0], 'growth'), 'utf8');
  const unrelated = ['sales/example.json', 'daily-totals/example.json', 'ledgers/example.json', 'ad-reports/pa/example.json', 'scope.json'];
  const before = new Map();
  for (const filename of unrelated) {
    const file = path.join(a.root, filename); fs.mkdirSync(path.dirname(file), { recursive: true });
    if (filename !== 'scope.json') fs.writeFileSync(file, '{"synthetic":"preserve"}');
    before.set(file, fs.readFileSync(file, 'utf8'));
  }
  const first = a.s.startHistory({ mode: 'maximum', force: true });
  assert.equal(first.force, true); assert.equal(first.skippedDays, 0); assert.equal(first.completedDays, 0);
  assert.equal(first.totalDays, 730); assert.equal(first.since, dates[0]); assert.equal(first.until, dates.at(-1));
  await a.s.waitForHistory();
  const result = a.s.historyStatus();
  assert.equal(result.status, 'completed'); assert.equal(result.completedDays, 730);
  assert.equal(result.backupReady, true); assert.equal(result.backupDays, 730);
  assert.equal(a.calls.length, 53 * 7);
  assert.equal(a.calls.filter(call => call.channel === 'growth').length, 53);
  assert.equal(a.calls[0].url.searchParams.get('paidDateFrom'), '20261027');
  assert.equal(a.calls.at(-7).url.searchParams.get('paidDateFrom'), '20251103');
  assert.equal(fs.readFileSync(a.backupFile(first, dates[0], 'growth'), 'utf8'), old);
  assert.deepEqual(JSON.parse(fs.readFileSync(a.snapshotFile(dates[0], 'growth'), 'utf8')).rows, []);
  for (const [file, content] of before) assert.equal(fs.readFileSync(file, 'utf8'), content);
});
test('failed recollect does not count old snapshots as completed; resume retains its force checkpoint and original backup', async t => {
  const a = setup(t); a.seed(); a.blocked.add('growth');
  const oldGrowth = fs.readFileSync(a.snapshotFile(dates[0], 'growth'), 'utf8');
  const first = a.s.startHistory({ mode: 'maximum', force: true }); await a.s.waitForHistory();
  const failed = a.s.historyStatus();
  assert.equal(failed.status, 'failed'); assert.equal(failed.completedDays, 365);
  assert.equal(failed.done.growth.length, 0); assert.equal(failed.done.seller.length, 365);
  assert.equal(fs.readFileSync(a.snapshotFile(dates[0], 'growth'), 'utf8'), oldGrowth);
  const seller = fs.readFileSync(a.snapshotFile(dates[0], 'seller'), 'utf8');
  const backup = fs.readFileSync(a.backupFile(first, dates[0], 'seller'), 'utf8');
  a.blocked.clear(); a.calls.length = 0;
  const resumed = a.s.startHistory({ resume: true }); assert.equal(resumed.id, first.id); assert.equal(resumed.force, true);
  await a.s.waitForHistory();
  assert.equal(a.s.historyStatus().status, 'completed'); assert.equal(a.calls.length, 53);
  assert.ok(a.calls.every(call => call.channel === 'growth'));
  assert.equal(fs.readFileSync(a.snapshotFile(dates[0], 'seller'), 'utf8'), seller);
  assert.equal(fs.readFileSync(a.backupFile(first, dates[0], 'seller'), 'utf8'), backup);
});
test('forced request does not resume an unfinished regular maximum checkpoint', async t => {
  const a = setup(t); a.seed();
  fs.writeFileSync(a.historyFile, JSON.stringify({ id: 'regular-checkpoint', force: false, mode: 'maximum',
    status: 'failed', since: dates[0], until: dates.at(-1), channels: ['growth', 'seller'],
    done: { growth: dates, seller: [] }, totalDays: 730, completedDays: 365 }));
  const job = a.s.startHistory({ mode: 'maximum', force: true });
  assert.notEqual(job.id, 'regular-checkpoint'); assert.equal(job.completedDays, 0); assert.equal(job.skippedDays, 0);
  await a.s.waitForHistory(); assert.equal(a.calls.length, 53 * 7);
});
test('active matching forced maximum is idempotent while a different collection intent is rejected', async t => {
  const a = setup(t); let release; a.block(new Promise(resolve => { release = resolve; }));
  const first = a.s.startHistory({ mode: 'maximum', force: true });
  assert.equal(a.s.startHistory({ mode: 'maximum', force: true }).id, first.id);
  assert.throws(() => a.s.startHistory({ mode: 'maximum', force: false }), { status: 409 });
  release(); a.block(null); await a.s.waitForHistory();
  assert.equal(a.s.historyStatus().status, 'completed');
});
test('completed forced run may be deliberately started again but automatic startup refreshes only the current week', async t => {
  const a = setup(t); a.seed();
  const first = a.s.startHistory({ mode: 'maximum', force: true }); await a.s.waitForHistory();
  const second = a.s.startHistory({ mode: 'maximum', force: true });
  assert.notEqual(second.id, first.id); assert.equal(second.completedDays, 0); assert.equal(second.skippedDays, 0);
  await a.s.waitForHistory();
  const checkpoint = fs.readFileSync(a.historyFile, 'utf8');
  const oldFile = fs.readFileSync(a.snapshotFile(dates[0], 'growth'), 'utf8');
  const backup = fs.readFileSync(a.backupFile(second, dates[0], 'growth'), 'utf8');
  a.advance(60000); a.calls.length = 0;
  const restarted = a.recreate(), result = await restarted.automatic({ startup: true });
  assert.equal(result.started, true); assert.equal(result.automatic.trigger, 'startup');
  assert.equal(a.calls.length, 7, 'one seven-day growth query and six seller state queries only');
  assert.equal(a.calls[0].url.searchParams.get('paidDateFrom'), '20261027');
  assert.equal(a.calls[0].url.searchParams.get('paidDateTo'), '20261102');
  assert.equal(fs.readFileSync(a.historyFile, 'utf8'), checkpoint);
  assert.equal(fs.readFileSync(a.snapshotFile(dates[0], 'growth'), 'utf8'), oldFile);
  assert.equal(fs.readFileSync(a.backupFile(second, dates[0], 'growth'), 'utf8'), backup);
});
test('interrupted forced run resumes its saved checkpoint automatically after verifying the current week', async t => {
  const a = setup(t); a.seed();
  const first = a.s.startHistory({ mode: 'maximum', force: true }); await a.s.waitForHistory();
  const saved = JSON.parse(fs.readFileSync(a.historyFile, 'utf8'));
  saved.status = 'running'; saved.pauseRequested = false; saved.done.growth = saved.done.growth.filter(date => date !== dates[0]);
  fs.writeFileSync(a.historyFile, JSON.stringify(saved));
  const backup = fs.readFileSync(a.backupFile(first, dates[0], 'growth'), 'utf8');
  a.calls.length = 0;
  const restarted = a.recreate(), result = await restarted.automatic({ startup: true });
  assert.equal(result.reason, 'history-resumed'); assert.equal(restarted.historyStatus().id, first.id);
  assert.equal(restarted.historyStatus().force, true); assert.equal(restarted.historyStatus().status, 'completed');
  assert.equal(a.calls.length, 8, 'seven recent-week API calls then one missing old growth block');
  assert.equal(a.calls.at(-1).url.searchParams.get('paidDateFrom'), '20251103');
  assert.equal(fs.readFileSync(a.backupFile(first, dates[0], 'growth'), 'utf8'), backup);
});
