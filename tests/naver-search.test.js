'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { createSearchService, signature } = require('../integrations/naver-search/client.cjs');
const project = path.resolve(__dirname, '..');
const config = { customerId: '123456', apiKey: 'SYNTHETIC-API-KEY', secretKey: 'test-secret-key' };
const campaign = (id, name = id) => ({ nccCampaignId: id, name, campaignTp: 'WEB_SITE', status: 'ELIGIBLE' });
const day = (date, spend, purchases, revenue) => ({ dateStart: date, dateEnd: date, impCnt: 1000, clkCnt: 10, salesAmt: spend, ccnt: 99, convAmt: 999999, purchaseCcnt: purchases, purchaseConvAmt: revenue });
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roas-search-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let clock = Date.parse('2026-10-25T03:00:00Z');
  const requests = [], waits = [];
  let handler = url => url.pathname === '/ncc/campaigns' ? [campaign('cmp-a'), campaign('cmp-b')] : { data: [day('2026-10-24', url.searchParams.get('id') === 'cmp-a' ? 1100 : 3300, 2, 22000)] };
  const service = createSearchService({ baseDir: dir,
    now: () => clock, sleep: async ms => { waits.push(ms); },
    protect: (mode, value) => mode === 'encrypt' ? 'ENC:' + Buffer.from(value).toString('base64') : Buffer.from(value.slice(4), 'base64').toString(),
    fetchImpl: async (raw, options) => {
      const url = new URL(raw); requests.push({ url, options });
      const result = await handler(url, options);
      if (result instanceof Response) return result;
      return new Response(JSON.stringify(result), { status: 200 });
    } });
  return { service, dir, requests, waits, connect: async () => { const value = await service.save(config); await service.saveScope({ campaignIds: ['cmp-a', 'cmp-b'] }); return value; }, setHandler: value => { handler = value; }, advance: ms => { clock += ms; } };
}

test('Naver signing uses raw secret, timestamp, GET and URI without query', () => {
  assert.equal(signature('1792897200000', '/ncc/campaigns', 'test-secret-key'), 'Bi+/6Wgya2T0OlzAbIdi/A+MgK1hKb0LmVRsRKlNozM=');
});

test('credentials are verified before encrypted save; responses never include API keys', async t => {
  const f = fixture(t);
  const result = await f.service.save(config);
  assert.equal(result.configured, true); assert.equal(result.customerId, config.customerId);
  assert.equal(result.campaignCount, 2);
  const secretFile = path.join(f.dir, '.roas-private', 'naver-search.dpapi');
  const before = fs.readFileSync(secretFile, 'utf8');
  for (const secret of [config.apiKey, config.secretKey]) {
    assert.equal(before.includes(secret), false); assert.equal(JSON.stringify(result).includes(secret), false);
  }
  f.setHandler(() => new Response(JSON.stringify({ message: config.apiKey + config.secretKey }), { status: 403 }));
  await assert.rejects(f.service.save({ ...config, customerId: '654321' }), error => !error.message.includes(config.secretKey) && /인증/.test(error.message));
  assert.equal(fs.readFileSync(secretFile, 'utf8'), before);
  assert.equal(f.service.status().customerId, '123456');
  assert.ok(f.requests.every(request => request.options.method === 'GET' && request.url.origin === 'https://api.searchad.naver.com'));
});

test('purchase metrics remain distinct from total conversions; sums recalculate ratios', async t => {
  const f = fixture(t); await f.connect();
  const report = await f.service.report({ since: '2026-10-24', until: '2026-10-24' });
  assert.equal(report.summary.spend, 4400); assert.equal(report.summary.purchases, 4);
  assert.equal(report.summary.purchaseRevenue, 44000); assert.equal(report.summary.conversions, 198);
  assert.equal(report.summary.purchaseRoas, 1000); assert.equal(report.summary.cpc, 220);
  assert.equal(report.daily[0].spend, 4400); assert.equal(report.daily[0].complete, true);
  assert.equal(report.vatIncluded, true);
  const stats = f.requests.find(request => request.url.pathname === '/stats');
  assert.equal(stats.url.searchParams.get('timeIncrement'), '1');
  assert.ok(JSON.parse(stats.url.searchParams.get('fields')).includes('purchaseConvAmt'));
  assert.equal(stats.options.headers['X-Customer'], '123456');
  const count = f.requests.length;
  assert.equal((await f.service.report({ since: report.since, until: report.until })).cached, true);
  assert.equal(f.requests.length, count, 'fresh report must not make another API call');
});

test('missing purchases are unknown and a missing campaign never becomes a zero-filled total', async t => {
  const f = fixture(t); await f.connect();
  f.setHandler(url => {
    if (url.pathname === '/ncc/campaigns') return [campaign('cmp-a'), campaign('cmp-b')];
    if (url.searchParams.get('id') === 'cmp-b') return { data: [] };
    const row = day('2026-10-24', 1000, 3, 30000); delete row.purchaseCcnt; delete row.purchaseConvAmt;
    return { dailyStatResponse: { data: [row] } };
  });
  const r = await f.service.report({ since: '2026-10-24', until: '2026-10-24' });
  assert.equal(r.campaigns[0].purchases, null); assert.equal(r.campaigns[0].purchaseRevenue, null);
  assert.equal(r.summary.spend, null); assert.equal(r.summary.purchases, null);
  assert.equal(r.summary.purchaseRoas, null); assert.equal(r.daily[0].spend, null); assert.equal(r.daily[0].complete, false);
});

test('failed refresh and throttling retain the exact last report with stale warning', async t => {
  const f = fixture(t); await f.connect();
  const query = { since: '2026-10-24', until: '2026-10-24' };
  const old = await f.service.report(query);
  const file = path.join(f.dir, '.roas-data/naver-search/123456', f.service.status().scopeKey, '2026-10-24_2026-10-24.json');
  const before = fs.readFileSync(file, 'utf8');
  f.setHandler(() => new Response('secret server error ' + config.secretKey, { status: 429 }));
  const result = await f.service.report({ ...query, refresh: true });
  assert.equal(result.stale, true); assert.match(result.refreshError, /호출 한도/);
  assert.equal(result.fetchedAt, old.fetchedAt); assert.deepEqual(result.summary, old.summary);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.equal(JSON.stringify(result).includes(config.secretKey), false);
  assert.ok(f.waits.includes(1000) && f.waits.includes(2000), 'bounded exponential retry');
});

test('broken API shapes, absent cost and duplicate dates fail without overwriting a report', async t => {
  const f = fixture(t); await f.connect(); await f.service.saveScope({ campaignIds: ['cmp-a'] });
  for (const data of [{}, { data: [{ dateStart: '2026-10-24', purchaseCcnt: 1 }] }, { data: [day('2026-10-24', 1, 1, 1), day('2026-10-24', 1, 1, 1)] }]) {
    f.setHandler(url => url.pathname === '/ncc/campaigns' ? [campaign('cmp-a')] : data);
    await assert.rejects(f.service.report({ since: '2026-10-24', until: '2026-10-24', refresh: true }));
  }
  assert.equal(fs.existsSync(path.join(f.dir, '.roas-data/naver-search/123456', f.service.status().scopeKey, '2026-10-24_2026-10-24.json')), false);
});

test('date validation precedes network access and limits requests to valid past 31 days', async t => {
  const f = fixture(t); await f.connect(); const count = f.requests.length;
  for (const [since, until] of [['2026-02-30', '2026-03-01'], ['2026-10-26', '2026-10-26'], ['2026-10-25', '2026-10-24'], ['2026-09-01', '2026-10-24']]) {
    await assert.rejects(f.service.report({ since, until }), { status: 400 });
  }
  assert.equal(f.requests.length, count);
});

test('account switches isolate disk caches; disconnect stops collection and preserves other integrations', async t => {
  const f = fixture(t); await f.connect();
  const query = { since: '2026-10-24', until: '2026-10-24' }; await f.service.report(query);
  await f.service.save({ ...config, customerId: '654321' });
  assert.equal(f.service.status().scopeConfigured, false);
  await f.service.saveScope({ campaignIds: ['cmp-a'] });
  await assert.rejects(f.service.report({ ...query, cacheOnly: true }), { status: 404 });
  const other = path.join(f.dir, '.roas-private', 'naver-commerce.dpapi'); fs.writeFileSync(other, 'existing');
  f.service.remove(); const count = f.requests.length; await f.service.automatic();
  assert.equal(f.requests.length, count); assert.equal(fs.readFileSync(other, 'utf8'), 'existing');
  assert.equal(f.service.status().configured, false);
});

test('server automatic collection covers seven KST days, waits one hour, and obeys off', async t => {
  const f = fixture(t); await f.connect();
  await f.service.automatic(); const count = f.requests.length;
  const stats = f.requests.find(request => request.url.pathname === '/stats');
  assert.deepEqual(JSON.parse(stats.url.searchParams.get('timeRange')), { since: '2026-10-19', until: '2026-10-25' });
  await f.service.automatic(); assert.equal(f.requests.length, count);
  f.advance(3600000); await f.service.automatic(); assert.ok(f.requests.length > count);
  f.service.settings({ enabled: false }); const after = f.requests.length;
  f.advance(3600000); await f.service.automatic(); assert.equal(f.requests.length, after);
});

test('existing mixed-account reports remain blocked until the user explicitly selects campaigns', async t => {
  const f = fixture(t); await f.service.save(config);
  const legacy = path.join(f.dir, '.roas-data/naver-search/123456/2026-10-24_2026-10-24.json');
  fs.mkdirSync(path.dirname(legacy), { recursive: true });
  const legacyText = JSON.stringify({ schema: 1, customerId: '123456', summary: { spend: 999999 }, campaigns: [{ id: 'truver' }] });
  fs.writeFileSync(legacy, legacyText);
  const count = f.requests.length;
  assert.equal(f.service.status().scopeConfigured, false);
  assert.equal(f.service.status().nextAutomaticAt, null);
  for (const cacheOnly of [false, true]) await assert.rejects(f.service.report({ since: '2026-10-24', until: '2026-10-24', cacheOnly }), { status: 409 });
  await f.service.automatic(); assert.equal(f.requests.length, count, 'No whole-account collection before selection');
  assert.equal(fs.readFileSync(legacy, 'utf8'), legacyText, 'Legacy reports are preserved, never shown as brand totals');
});

test('manual, daily and automatic reports query only saved Wemamang IDs; names never choose financial scope', async t => {
  const f = fixture(t); await f.service.save(config);
  f.setHandler(url => url.pathname === '/ncc/campaigns'
    ? [campaign('cmp-a', '위마망 백도씨'), campaign('cmp-b', '트루버 버너'), campaign('new-wema', '위마망 새 캠페인'), campaign('unknown', '일반 검색')]
    : { data: [day('2026-10-24', 1100, 2, 22000)] });
  const options = await f.service.campaignOptions();
  assert.equal(options.campaigns.length, 4); assert.deepEqual(options.campaignIds, []);
  await f.service.saveScope({ campaignIds: ['cmp-a'] });
  let count = f.requests.length;
  const r = await f.service.report({ since: '2026-10-24', until: '2026-10-24' });
  assert.deepEqual(r.campaigns.map(x => x.id), ['cmp-a']);
  assert.equal(r.summary.spend, 1100); assert.equal(r.summary.purchases, 2); assert.equal(r.daily[0].spend, 1100);
  assert.ok(f.requests.slice(count).filter(x => x.url.pathname === '/stats').every(x => x.url.searchParams.get('id') === 'cmp-a'));
  count = f.requests.length; await f.service.automatic();
  assert.ok(f.requests.slice(count).filter(x => x.url.pathname === '/stats').every(x => x.url.searchParams.get('id') === 'cmp-a'));
  assert.deepEqual(f.service.status().scopeCampaignIds, ['cmp-a'], 'New matching and unknown campaigns are never silently included');
});

test('scope changes isolate prior caches and refresh failures cannot return a different brand total', async t => {
  const f = fixture(t); await f.connect();
  const range = { since: '2026-10-24', until: '2026-10-24' };
  const all = await f.service.report(range); assert.equal(all.summary.spend, 4400);
  await f.service.saveScope({ campaignIds: ['cmp-a'] });
  assert.notEqual(f.service.status().scopeKey, all.scopeKey);
  await assert.rejects(f.service.report({ ...range, cacheOnly: true }), { status: 404 });
  f.setHandler(() => new Response('network failure', { status: 503 }));
  await assert.rejects(f.service.report({ ...range, refresh: true }), { status: 502 });
  assert.deepEqual(f.service.status().scopeCampaignIds, ['cmp-a']);
});

test('invalid selections preserve the saved scope and missing selected IDs do not become partial or all-account totals', async t => {
  const f = fixture(t); await f.connect();
  const before = f.service.status().scopeKey;
  for (const campaignIds of [[], ['missing-campaign'], ['../other'], ['cmp-a', 42]]) {
    await assert.rejects(f.service.saveScope({ campaignIds }), { status: 400 });
    assert.equal(f.service.status().scopeKey, before);
  }
  f.setHandler(url => url.pathname === '/ncc/campaigns' ? [campaign('unselected')] : { data: [day('2026-10-24', 1000000, 9, 9000000)] });
  const count = f.requests.length;
  await assert.rejects(f.service.report({ since: '2026-10-24', until: '2026-10-24' }), { status: 409 });
  assert.equal(f.requests.slice(count).some(x => x.url.pathname === '/stats'), false);
});

function serverFixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roas-search-server-'));
  const file = path.join(dir, 'server.js'); fs.copyFileSync(path.join(project, 'server.js'), file); fs.mkdirSync(path.join(dir, 'public'));
  const app = require(file);
  t.after(() => { delete require.cache[file]; fs.rmSync(dir, { recursive: true, force: true }); });
  const request = (url, { method = 'GET', headers = {}, body = '' } = {}) => new Promise((resolve, reject) => {
    const req = Readable.from(body ? [Buffer.from(body)] : []); Object.assign(req, { url, method, headers: { host: '127.0.0.1:3000', ...headers } });
    const result = {};
    const res = { writeHead(status, values) { result.status = status; result.headers = values; }, end(value) { result.body = Buffer.isBuffer(value) ? value.toString() : String(value ?? ''); resolve(result); } };
    Promise.resolve(app.server.listeners('request')[0](req, res)).catch(reject);
  });
  return { dir, request };
}

test('legacy updater boots embedded search assets without installing client or UI files', async t => {
  const f = serverFixture(t);
  for (const name of ['naver-search.html', 'naver-search.js', 'naver-search.css']) {
    const r = await f.request('/' + name + '?legacy=1'); assert.equal(r.status, 200);
    assert.equal(r.body, fs.readFileSync(path.join(project, 'public', name), 'utf8'));
    assert.equal(fs.existsSync(path.join(f.dir, 'public', name)), false);
  }
  const status = await f.request('/api/naver-search/status'); assert.equal(status.status, 200);
  assert.equal(JSON.parse(status.body).configured, false); assert.equal(status.headers['Cache-Control'], 'no-store');
  assert.equal((await f.request('/api/naver-search/report?since=2026-10-24&until=2026-10-24')).status, 400);
  assert.equal((await f.request('/.roas-private/naver-search.dpapi')).status, 404);
  assert.equal((await f.request('/integrations/naver-search/client.cjs')).status, 404);
});

test('search endpoints reject cross-origin requests, wrong methods, missing action headers and malformed payloads', async t => {
  const f = serverFixture(t);
  for (const endpoint of ['credentials', 'settings', 'test', 'disconnect', 'scope']) {
    const url = '/api/naver-search/' + endpoint;
    assert.equal((await f.request(url)).status, 405);
    for (const headers of [{}, { 'x-roas-local-action': 'yes', origin: 'https://evil.invalid' }, { 'x-roas-local-action': 'yes', host: 'evil.invalid:3000' }]) {
      assert.equal((await f.request(url, { method: 'POST', headers, body: '{}' })).status, 403);
    }
  }
  for (const endpoint of ['status', 'report', 'campaigns']) {
    assert.equal((await f.request('/api/naver-search/' + endpoint, { headers: { host: 'evil.invalid:3000' } })).status, 403);
    assert.equal((await f.request('/api/naver-search/' + endpoint, { method: 'POST' })).status, 405);
  }
  const headers = { 'x-roas-local-action': 'yes' };
  for (const body of ['{"secretKey":"DO-NOT-ECHO"', '["DO-NOT-ECHO"]', '{"secretKey":"DO-NOT-ECHO' + 'x'.repeat(9000) + '"}']) {
    const r = await f.request('/api/naver-search/credentials', { method: 'POST', headers, body });
    assert.ok([400, 413].includes(r.status)); assert.equal(r.body.includes('DO-NOT-ECHO'), false);
  }
  assert.equal(fs.existsSync(path.join(f.dir, '.roas-private')), false);
});
