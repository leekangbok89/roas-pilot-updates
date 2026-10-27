'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { createService } = require('../integrations/coupang/service.cjs');
const now = Date.parse('2026-10-27T05:00:00Z');
const date = '2026-10-26';
const credentials = { vendorId: 'A00012345', accessKey: 'synthetic-access-123', secretKey: 'synthetic-secret-456' };
const protect = (mode, value) => mode === 'encrypt' ? Buffer.from(value).toString('base64') : Buffer.from(value, 'base64').toString();
function setup(t, fetchImpl) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coupang-auth-check-'));
  t.after(() => fs.rmSync(baseDir, { recursive: true, force: true }));
  const service = () => createService({ baseDir, protect, fetchImpl, now: () => now, sleep: async () => {} });
  const s = service(); s.saveCredentials(credentials);
  return { s, baseDir, service, vendorDir: path.join(baseDir, '.roas-data/coupang', credentials.vendorId) };
}
const rejected = (message, status = 403, headers = {}) => new Response(JSON.stringify({ message, accessKey: credentials.accessKey, secretKey: credentials.secretKey, customer: 'PRIVATE CUSTOMER' }), { status, headers });
const accepted = () => ({ ok: true, json: async () => ({ code: 200, data: [] }) });
function safe(value) {
  const encoded = JSON.stringify(value);
  for (const text of [credentials.accessKey, credentials.secretKey, 'PRIVATE CUSTOMER', 'Bearer PRIVATE', '192.0.2.42']) assert.ok(!encoded.includes(text), 'diagnostic leaked ' + text);
}
test('authentication responses become fixed causes and safe remedies without exposing response fields', async t => {
  for (const [message, category, status] of [
    ['Not allowed IP 192.0.2.42', 'ip_not_allowed', 403],
    ['Specified signature is expired', 'signature_expired', 401],
    ['The API key has expired', 'key_expired', 401],
    ['Invalid access key', 'invalid_key', 401],
    ['An invalid signature error is returned', 'invalid_signature', 401],
    ['Sorry! Access denied', 'access_denied', 403],
    ['Unclassified upstream text Bearer PRIVATE', 'auth_unknown', 403]
  ]) {
    const { s, vendorDir } = setup(t, async () => rejected(message, status));
    const r = await s.diagnose({ channel: 'growth' });
    assert.equal(r.ok, false); assert.equal(r.keysReadable, true);
    assert.equal(r.checks[0].category, category); assert.equal(r.checks[0].httpStatus, status);
    assert.equal(r.checks[0].label, r.checks[0].message); assert.ok(r.checks[0].action.length > 10);
    safe(r); safe(s.status().connectionCheck);
    safe(JSON.parse(fs.readFileSync(path.join(vendorDir, 'connection-check.json'), 'utf8')));
    assert.equal(fs.existsSync(path.join(vendorDir, 'orders')), false);
  }
});
test('unsupported or failed body reads preserve HTTP identity and a fixed unknown reason', async t => {
  for (const response of [
    () => ({ ok: false, status: 403 }),
    () => ({ ok: false, status: 401, text: async () => { throw Error(credentials.secretKey); } }),
    () => ({ ok: false, status: 403, json: async () => ({ message: 'Not allowed IP', secretKey: credentials.secretKey }) }),
    () => ({ ok: false, status: 401, text: async () => 'x'.repeat(17000) + credentials.secretKey })
  ]) {
    const { s } = setup(t, async () => response());
    const r = await s.diagnose({ channel: 'growth' });
    assert.equal(r.ok, false); assert.ok([401, 403].includes(r.checks[0].httpStatus)); safe(r);
    await assert.rejects(s.sync({ since: date, until: date, channel: 'growth' }), /쿠팡 인증에 실패했습니다\./);
  }
});
test('oversized streamed auth bodies are cancelled at the bounded limit and are never persisted', async t => {
  let cancelled = false, pulls = 0;
  const { s, vendorDir } = setup(t, async () => new Response(new ReadableStream({
    pull(controller) { pulls++; controller.enqueue(new Uint8Array(8192).fill(120)); },
    cancel() { cancelled = true; }
  }), { status: 403 }));
  const r = await s.diagnose({ channel: 'growth' });
  assert.equal(r.checks[0].category, 'auth_unknown'); assert.equal(cancelled, true); assert.ok(pulls <= 5);
  assert.ok(fs.statSync(path.join(vendorDir, 'connection-check.json')).size < 3000); safe(r);
});
test('clock differences are diagnostic hints without changing the reported authentication cause', async t => {
  const { s } = setup(t, async () => rejected('Unknown cause', 401, { Date: new Date(now + 3600000).toUTCString() }));
  const r = await s.diagnose({ channel: 'growth' });
  assert.equal(r.checks[0].category, 'auth_unknown'); assert.equal(r.checks[0].clockOffsetSeconds, 3600);
  assert.match(r.checks[0].action, /시각이 5분 이상/); safe(r);
});
test('recent-day connection checks use one request per delivery type and preserve orders, scope and history', async t => {
  const calls = [];
  const { s, vendorDir, service } = setup(t, async url => { calls.push(new URL(url)); return accepted(); });
  s.saveScope({ products: [{ itemId: '123', name: '예시 상품', unitCost: 1000 }] });
  const orders = path.join(vendorDir, 'orders'); fs.mkdirSync(orders, { recursive: true });
  const snapshot = JSON.stringify({ date, channel: 'growth', vendorId: credentials.vendorId, rows: [] });
  fs.writeFileSync(path.join(orders, date + '-growth.json'), snapshot);
  const job = JSON.stringify({ status: 'failed', totalDays: 730, completedDays: 358, error: '이전 오류', current: null });
  fs.writeFileSync(path.join(vendorDir, 'history.json'), job);
  const beforeScope = fs.readFileSync(path.join(vendorDir, 'scope.json'), 'utf8');
  const r = await s.diagnose();
  assert.equal(r.ok, true); assert.equal(r.keysReadable, true); assert.equal(r.date, date); assert.equal(calls.length, 2);
  assert.deepEqual(r.checks.map(c => [c.channel, c.ok, c.httpStatus]), [['growth', true, 200], ['seller', true, 200]]);
  assert.equal(calls[0].searchParams.get('paidDateFrom'), '20261026'); assert.equal(calls[0].searchParams.get('paidDateTo'), '20261026');
  assert.equal(calls[1].searchParams.get('createdAtFrom'), date + '+09:00'); assert.equal(calls[1].searchParams.get('createdAtTo'), date + '+09:00');
  assert.equal(calls[1].searchParams.get('status'), 'FINAL_DELIVERY'); assert.equal(calls[1].searchParams.get('maxPerPage'), '50');
  assert.equal(fs.readFileSync(path.join(orders, date + '-growth.json'), 'utf8'), snapshot);
  assert.equal(fs.readFileSync(path.join(vendorDir, 'history.json'), 'utf8'), job);
  assert.equal(fs.readFileSync(path.join(vendorDir, 'scope.json'), 'utf8'), beforeScope);
  assert.deepEqual(service().status().connectionCheck, r); safe(r);
});
test('non-auth network and upstream failures do not claim that keys were rejected', async t => {
  for (const fetchImpl of [async () => { throw Error(credentials.secretKey); }, async () => ({ ok: false, status: 500 }), async () => ({ ok: true, json: async () => ({ code: 200, data: 'bad' }) })]) {
    const { s } = setup(t, fetchImpl);
    const r = await s.diagnose({ channel: 'seller' });
    assert.equal(r.ok, false); assert.equal(r.checks[0].label, '조회 실패 · 인증 판정 불가');
    assert.equal(r.checks[0].category, undefined); assert.ok(!r.checks[0].message.includes('인증에 실패')); safe(r);
  }
});
test('history retains the failed range, delivery type and safe reason without erasing saved progress', async t => {
  let mode = 'fail';
  const { s, vendorDir, service } = setup(t, async () => mode === 'fail' ? rejected('Not allowed IP 192.0.2.42') : accepted());
  const orders = path.join(vendorDir, 'orders'); fs.mkdirSync(orders, { recursive: true });
  for (let day = 1; day <= 7; day++) {
    const date = '2026-10-' + String(day).padStart(2, '0');
    fs.writeFileSync(path.join(orders, date + '-growth.json'), JSON.stringify({ date, channel: 'growth', vendorId: credentials.vendorId, rows: [] }));
  }
  s.startHistory({ since: '2026-10-01', until: '2026-10-14', channels: ['growth'] }); await s.waitForHistory();
  const h = s.historyStatus(); assert.equal(h.status, 'failed'); assert.equal(h.completedDays, 7); assert.equal(h.current, null);
  assert.deepEqual([h.lastFailure.channel, h.lastFailure.since, h.lastFailure.until], ['growth', '2026-10-08', '2026-10-14']);
  assert.equal(h.lastFailure.diagnosis.category, 'ip_not_allowed'); assert.equal(h.lastFailure.failedAt, new Date(now).toISOString());
  assert.deepEqual(service().historyStatus().lastFailure, h.lastFailure); safe(h);
  assert.equal(fs.readdirSync(orders).length, 7);
  mode = 'ok'; s.startHistory({ resume: true }); assert.equal(s.historyStatus().lastFailure, null); await s.waitForHistory();
  assert.equal(s.historyStatus().status, 'completed'); assert.equal(s.historyStatus().completedDays, 14);
});
test('diagnosis respects collection locks, validates channels, and uses the existing credential requirement', async t => {
  let release;
  const { s } = setup(t, () => new Promise(resolve => { release = resolve; }));
  await assert.rejects(s.diagnose({ channel: 'invalid' }), /배송 방식/);
  const pending = s.diagnose({ channel: 'growth' });
  await new Promise(resolve => setImmediate(resolve));
  assert.throws(() => s.saveCredentials(credentials), /수집 중/);
  assert.throws(() => s.startHistory({ since: date, until: date }), /수집 중/);
  await assert.rejects(s.diagnose(), /수집 중/);
  release(accepted()); await pending;
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coupang-no-keys-')); t.after(() => fs.rmSync(emptyDir, { recursive: true, force: true }));
  const other = createService({ baseDir: emptyDir, protect });
  // An absent credential file must be handled before any network request.
  await assert.rejects(other.diagnose(), /API 정보를 등록/);
});

test('changing the saved keys clears an earlier connection diagnosis without changing order/history data', async t => {
  const { s, vendorDir } = setup(t, async () => rejected('Not allowed IP'));
  await s.diagnose({ channel: 'growth' }); assert.equal(s.status().connectionCheck.ok, false);
  const history = JSON.stringify({ status: 'failed', completedDays: 358, totalDays: 730 });
  fs.writeFileSync(path.join(vendorDir, 'history.json'), history);
  s.saveCredentials({ ...credentials, accessKey: 'new-synthetic-access', secretKey: 'new-synthetic-secret' });
  assert.equal(s.status().connectionCheck, null);
  assert.equal(fs.readFileSync(path.join(vendorDir, 'history.json'), 'utf8'), history);
});
test('canonical error-message fields are classified independently of unrelated or malformed JSON fields', async t => {
  for (const [value, expected] of [
    [{ message: 'Specified signature is expired', accessKey: 'unknown access key', debug: 'API key has expired' }, 'signature_expired'],
    [{ message: 'Unclassified failure', accessKey: 'Invalid access key', debug: 'Not allowed IP' }, 'auth_unknown'],
    [{ error: { message: 'Not allowed IP', secretKey: credentials.secretKey } }, 'ip_not_allowed'],
    [{ errorMessage: 'Access key does not exist' }, 'invalid_key']
  ]) {
    const { s } = setup(t, async () => new Response(JSON.stringify(value), { status: 401 }));
    const r = await s.diagnose({ channel: 'growth' }); assert.equal(r.checks[0].category, expected); safe(r);
  }
});
