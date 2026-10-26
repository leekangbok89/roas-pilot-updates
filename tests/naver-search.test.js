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
  const makeService = () => createSearchService({ baseDir: dir,
    now: () => clock, sleep: async ms => { waits.push(ms); },
    protect: (mode, value) => mode === 'encrypt' ? 'ENC:' + Buffer.from(value).toString('base64') : Buffer.from(value.slice(4), 'base64').toString(),
    fetchImpl: async (raw, options) => {
      const url = new URL(raw); requests.push({ url, options });
      const result = await handler(url, options);
      if (result instanceof Response) return result;
      return new Response(JSON.stringify(result), { status: 200 });
    } });
  const service = makeService();
  return { service, restart: makeService, dir, requests, waits, connect: async () => { const value = await service.save(config); await service.saveScope({ campaignIds: ['cmp-a', 'cmp-b'] }); return value; }, setHandler: value => { handler = value; }, advance: ms => { clock += ms; } };
}

async function historyFinished(service) {
  for (let i = 0; i < 2000; i++) {
    if (!service.status().history?.running) return service.status().history;
    await new Promise(resolve => setImmediate(resolve));
  }
  throw Error('Synthetic history job did not finish');
}
function historicalHandler(url) {
  if (url.pathname === '/ncc/campaigns') return [campaign('cmp-a'), campaign('cmp-b'), campaign('truver')];
  const range = JSON.parse(url.searchParams.get('timeRange')), rows = [];
  for (let time = Date.parse(range.since); time <= Date.parse(range.until); time += 86400000) rows.push(day(new Date(time).toISOString().slice(0, 10), 100, 1, 1000));
  return { data: rows };
}

test('June history runs in monthly chunks and saves scoped daily data and exact full-range totals', async t => {
  const f = fixture(t); await f.connect(); f.setHandler(historicalHandler);
  const started = f.service.startHistory(); assert.equal(started.running, true);
  await assert.rejects(f.service.saveScope({ campaignIds: ['cmp-b'] }), { status: 409 });
  const finished = await historyFinished(f.service);
  assert.equal(finished.since, '2026-06-01'); assert.equal(finished.until, '2026-10-25');
  assert.equal(finished.status, 'complete'); assert.equal(finished.completedRanges, 5); assert.equal(finished.confirmedDays, 147);
  const ranges = f.requests.filter(r => r.url.pathname === '/stats').map(r => JSON.parse(r.url.searchParams.get('timeRange')));
  assert.equal(ranges.length, 10); assert.ok(ranges.every(r => (Date.parse(r.until) - Date.parse(r.since)) / 86400000 < 31));
  assert.ok(f.requests.filter(r => r.url.pathname === '/stats').every(r => r.url.searchParams.get('id') !== 'truver'));
  const count = f.requests.length, result = f.service.historyReport();
  assert.equal(result.daily.length, 147); assert.equal(result.summary.spend, 29400); assert.equal(result.summary.purchases, 294); assert.equal(result.partial, false);
  assert.equal(f.requests.length, count, 'history viewing reads saved data without new API calls');
  const snapshot=f.service.spendSnapshot('2026-06-01','2026-10-25');assert.equal(Object.keys(snapshot.days).length,147);assert.equal(Object.values(snapshot.days).reduce((sum,day)=>sum+day.powerlink,0),29400,'saved monthly history feeds daily advertising statistics exactly once');
  assert.equal(f.restart().historyReport().summary.spend, 29400, 'the saved report survives service restart');
  f.service.saveSpendMapping({ ...f.service.spendMapping(), mappings: { 'cmp-a': 'gfa', 'cmp-b': 'gfa' } });
  const routed = f.service.spendSnapshot('2026-06-01', '2026-10-25');
  assert.equal(Object.values(routed.days).reduce((sum, day) => sum + day.gfa, 0), 29400, 'saved June history immediately uses the chosen GFA category');
  assert.equal(f.restart().historyReport().spendMapping.mappings['cmp-a'], 'gfa');
  assert.equal(f.requests.length, count, 'reclassifying historical data never refetches it');
});

test('failed historical month preserves earlier data and retry skips already saved months', async t => {
  const f = fixture(t); await f.connect();
  f.setHandler(url => url.pathname === '/stats' && JSON.parse(url.searchParams.get('timeRange')).since === '2026-07-01' ? new Response('unavailable', { status: 503 }) : historicalHandler(url));
  f.service.startHistory({ since: '2026-06-01', until: '2026-08-31' });
  let job = await historyFinished(f.service); assert.equal(job.status, 'failed'); assert.equal(job.completedRanges, 1);
  assert.equal(f.service.historyReport().daily.length, 30); assert.equal(f.service.historyReport().partial, true);
  f.setHandler(historicalHandler);f.service.startHistory({ since: '2026-06-01', until: '2026-08-31' });
  job = await historyFinished(f.service);assert.equal(job.status, 'complete');
  const june = f.requests.filter(r => r.url.pathname === '/stats' && JSON.parse(r.url.searchParams.get('timeRange')).since === '2026-06-01');
  assert.equal(june.length, 2, 'retry does not refetch or duplicate the saved June campaign rows');
  assert.equal(f.service.historyReport().daily.length, 92);
});

test('interrupted history resumes after restart even when recent-day automatic refresh is disabled', async t => {
  const f = fixture(t); await f.connect();f.setHandler(historicalHandler);
  f.service.startHistory({ since: '2026-06-01', until: '2026-07-31' });await historyFinished(f.service);
  f.service.settings({ enabled: false });
  const file = path.join(f.dir, '.roas-data/naver-search/123456', f.service.status().scopeKey, 'history.json');
  const job = JSON.parse(fs.readFileSync(file));job.status = 'running';fs.writeFileSync(file, JSON.stringify(job));
  const restarted = f.restart();assert.equal(restarted.status().history.status, 'paused');
  const count = f.requests.length;await restarted.automatic();await historyFinished(restarted);
  assert.equal(restarted.status().history.status, 'complete');assert.equal(f.requests.length, count);
  await restarted.saveScope({ campaignIds: ['cmp-b'] });assert.equal(restarted.status().history, null);
  assert.throws(() => restarted.historyReport(), { status: 404 }, 'a new campaign scope cannot read old historical totals');
});

test('history never turns absent dates into zeros and validates ranges before starting work', async t => {
  const f = fixture(t);await f.connect();
  for (const input of [null, [], { since: '2026-02-30' }, { since: '2026-10-26' }, { since: '2024-06-01' }]) assert.throws(() => f.service.startHistory(input), { status: 400 });
  assert.equal(f.service.status().history, null);
  f.setHandler(url => url.pathname === '/ncc/campaigns' ? [campaign('cmp-a'), campaign('cmp-b')] : { data: [] });
  f.service.startHistory({ since: '2026-06-01', until: '2026-06-30' });
  const job = await historyFinished(f.service);assert.equal(job.status, 'partial');assert.equal(job.confirmedDays, 0);
  assert.equal(f.service.historyReport().summary.spend, null);assert.equal(f.service.historyReport().partial, true);
});

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
  for (const endpoint of ['credentials', 'settings', 'test', 'disconnect', 'scope', 'history']) {
    const url = '/api/naver-search/' + endpoint;
    assert.equal((await f.request(url)).status, 405);
    for (const headers of [{}, { 'x-roas-local-action': 'yes', origin: 'https://evil.invalid' }, { 'x-roas-local-action': 'yes', host: 'evil.invalid:3000' }]) {
      assert.equal((await f.request(url, { method: 'POST', headers, body: '{}' })).status, 403);
    }
  }
  for (const endpoint of ['status', 'report', 'campaigns', 'history-report']) {
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

test('overview spend snapshot splits selected shopping and Powerlink caches without API calls or overlap duplication', async t => {
  const f=fixture(t);await f.connect();
  let shopping=1200;
  f.setHandler(url=>url.pathname==='/ncc/campaigns'?[{...campaign('cmp-a'),campaignTp:'SHOPPING'},campaign('cmp-b'),campaign('truver')]:{data:[day('2026-10-23',url.searchParams.get('id')==='cmp-a'?shopping:300,1,1000),day('2026-10-24',url.searchParams.get('id')==='cmp-a'?0:500,1,1000)]});
  await f.service.report({since:'2026-10-23',until:'2026-10-24'});
  let count=f.requests.length,s=f.service.spendSnapshot('2026-10-23','2026-10-24');
  assert.equal(f.requests.length,count);assert.equal(s.days['2026-10-23'].shopping,1200);assert.equal(s.days['2026-10-23'].powerlink,300);assert.equal(s.days['2026-10-24'].shopping,0);assert.equal(s.days['2026-10-24'].powerlink,500);
  assert.equal(f.requests.some(r=>r.url.searchParams.get('id')==='truver'),false);
  shopping=1700;f.advance(1000);
  f.setHandler(url=>url.pathname==='/ncc/campaigns'?[{...campaign('cmp-a'),campaignTp:'SHOPPING'},campaign('cmp-b')]:{data:[day('2026-10-23',url.searchParams.get('id')==='cmp-a'?shopping:400,1,1000)]});
  await f.service.report({since:'2026-10-23',until:'2026-10-23'});
  s=f.service.spendSnapshot('2026-10-23','2026-10-24');assert.equal(s.days['2026-10-23'].shopping,1700);assert.equal(s.days['2026-10-23'].powerlink,400);assert.equal(s.days['2026-10-24'].powerlink,500);
  await f.service.saveScope({campaignIds:['cmp-b']});count=f.requests.length;
  assert.deepEqual(f.service.spendSnapshot('2026-10-23','2026-10-24').days,{});assert.equal(f.requests.length,count);
});

test('legacy mixed multi-day search caches require refresh and incomplete daily rows stay unknown',async t=>{
 const f=fixture(t);await f.connect();
 f.setHandler(url=>url.pathname==='/ncc/campaigns'?[{...campaign('cmp-a'),campaignTp:'SHOPPING'},campaign('cmp-b')]:{data:[day('2026-10-23',100,1,1000),day('2026-10-24',200,1,1000)]});
 await f.service.report({since:'2026-10-23',until:'2026-10-24'});
 const file=path.join(f.dir,'.roas-data/naver-search/123456',f.service.status().scopeKey,'2026-10-23_2026-10-24.json'),r=JSON.parse(fs.readFileSync(file));
 const rows=r.campaignDaily;delete r.campaignDaily;fs.writeFileSync(file,JSON.stringify(r));assert.equal(f.service.spendSnapshot('2026-10-23','2026-10-24').days['2026-10-23'].shopping,null);
 r.campaignDaily=rows.filter(row=>row.id==='cmp-a');fs.writeFileSync(file,JSON.stringify(r));const s=f.service.spendSnapshot('2026-10-23','2026-10-24');assert.equal(s.days['2026-10-23'].shopping,null);assert.equal(s.days['2026-10-23'].powerlink,null);
});

test('campaign spend mapping immediately reclassifies saved costs, groups each campaign once, persists and leaves performance unchanged',async t=>{
 const f=fixture(t);await f.connect();const range={since:'2026-10-24',until:'2026-10-24'};
 const original=await f.service.report(range),scope=f.service.status().scopeKey,count=f.requests.length;
 let mapping=f.service.spendMapping();assert.deepEqual(mapping.mappings,{'cmp-a':'auto','cmp-b':'auto'});
 mapping=f.service.saveSpendMapping({...mapping,mappings:{'cmp-a':'shopping','cmp-b':'gfa'}});
 let costs=f.service.spendSnapshot(range.since,range.until).days[range.since];assert.equal(costs.shopping,1100);assert.equal(costs.gfa,3300);assert.equal(costs.powerlink,null);
 assert.equal(f.requests.length,count,'mapping saved costs does not collect from Naver');assert.equal(f.service.status().scopeKey,scope,'mapping does not invalidate selected campaign caches');
 let report=await f.service.report({...range,cacheOnly:true});assert.deepEqual(report.summary,original.summary);assert.equal(report.spendMapping.mappings['cmp-b'],'gfa');
 assert.deepEqual(f.restart().spendMapping(),mapping);
 mapping=f.service.saveSpendMapping({...mapping,mappings:{'cmp-a':'gfa'}});costs=f.service.spendSnapshot(range.since,range.until).days[range.since];assert.equal(costs.gfa,4400);assert.equal(costs.shopping,null);
 mapping=f.service.saveSpendMapping({...mapping,mappings:{'cmp-b':'exclude'}});costs=f.service.spendSnapshot(range.since,range.until).days[range.since];assert.equal(costs.gfa,1100);
 mapping=f.service.saveSpendMapping({...mapping,mappings:{'cmp-a':'exclude'}});costs=f.service.spendSnapshot(range.since,range.until).days[range.since];assert.equal(costs.gfa,null);assert.equal(costs.shopping,null);assert.equal(costs.powerlink,null);
 assert.equal((await f.service.report({...range,cacheOnly:true})).summary.spend,4400,'excluding statistical costs retains the original campaign performance');
 f.service.saveSpendMapping({...mapping,mappings:{'cmp-a':'auto','cmp-b':'auto'}});assert.equal(f.service.spendSnapshot(range.since,range.until).days[range.since].powerlink,4400);
});

test('mapping rejects stale customer, scope and revision, validates targets atomically and preserves mappings across campaign selection changes',async t=>{
 const f=fixture(t);await f.connect();const mapping=f.service.spendMapping();
 for(const patch of [{customerId:'654321'},{scopeKey:'other'},{revision:99}])assert.throws(()=>f.service.saveSpendMapping({...mapping,...patch}),{status:409});
 for(const mappings of [{},{'unselected':'gfa'},{'cmp-a':'meta'},{'cmp-a':null},{'cmp-a':'shopping','cmp-b':'invalid'},[]]){assert.throws(()=>f.service.saveSpendMapping({...mapping,mappings}),{status:400});assert.deepEqual(f.service.spendMapping(),mapping);}
 const saved=f.service.saveSpendMapping({...mapping,mappings:{'cmp-a':'shopping','cmp-b':'gfa'}});assert.throws(()=>f.service.saveSpendMapping({...mapping,mappings:{'cmp-a':'powerlink'}}),{status:409});assert.deepEqual(f.service.spendMapping(),saved);
 await f.service.saveScope({campaignIds:['cmp-a']});assert.throws(()=>f.service.saveSpendMapping(saved),{status:409});let smaller=f.service.spendMapping();f.service.saveSpendMapping({...smaller,mappings:{'cmp-a':'powerlink'}});
 await f.service.saveScope({campaignIds:['cmp-a','cmp-b']});assert.deepEqual(f.service.spendMapping().mappings,{'cmp-a':'powerlink','cmp-b':'gfa'});
 await f.service.save({...config,customerId:'654321'});await f.service.saveScope({campaignIds:['cmp-a','cmp-b']});assert.deepEqual(f.service.spendMapping().mappings,{'cmp-a':'auto','cmp-b':'auto'});
});

test('legacy and unknown campaign types are routed only when saved detail supports the chosen mapping',async t=>{
 const f=fixture(t);await f.connect();const range={since:'2026-10-23',until:'2026-10-24'};
 f.setHandler(url=>url.pathname==='/ncc/campaigns'?[campaign('cmp-a'),campaign('cmp-b')]:{data:[day(range.since,100,1,1000),day(range.until,0,0,0)]});await f.service.report(range);
 const file=path.join(f.dir,'.roas-data/naver-search/123456',f.service.status().scopeKey,range.since+'_'+range.until+'.json'),cached=JSON.parse(fs.readFileSync(file));delete cached.campaignDaily;fs.writeFileSync(file,JSON.stringify(cached));
 f.service.saveSpendMapping({...f.service.spendMapping(),mappings:{'cmp-a':'gfa','cmp-b':'gfa'}});let s=f.service.spendSnapshot(range.since,range.until);assert.equal(s.days[range.since].gfa,200);assert.equal(s.days[range.until].gfa,0);
 f.service.saveSpendMapping({...f.service.spendMapping(),mappings:{'cmp-a':'shopping'}});s=f.service.spendSnapshot(range.since,range.until);assert.equal(s.days[range.since].shopping,null);assert.equal(s.days[range.since].gfa,null,'mixed legacy totals must not be guessed');
 await f.service.saveScope({campaignIds:['cmp-a']});f.setHandler(url=>url.pathname==='/ncc/campaigns'?[{...campaign('cmp-a'),campaignTp:'UNKNOWN'}]:{data:[day(range.until,700,1,1000)]});await f.service.report({since:range.until,until:range.until});f.service.saveSpendMapping({...f.service.spendMapping(),mappings:{'cmp-a':'auto'}});assert.equal(f.service.spendSnapshot(range.until,range.until).days[range.until].gfa,null);
 f.service.saveSpendMapping({...f.service.spendMapping(),mappings:{'cmp-a':'gfa'}});assert.equal(f.service.spendSnapshot(range.until,range.until).days[range.until].gfa,700);
 fs.writeFileSync(path.join(f.dir,'.roas-data/naver-search/123456/spend-mapping.json'),'broken');assert.deepEqual(f.service.spendSnapshot(range.until,range.until).days,{},'damaged mapping must not silently restore automatic categories');assert.throws(()=>f.service.spendMapping(),{status:500});
});

test('spend mapping API protects writes and limits payloads while allowing only GET and POST',async t=>{
 const f=serverFixture(t),url='/api/naver-search/spend-mapping';
 assert.equal((await f.request(url)).status,400,'no connected account');
 for(const method of ['PUT','DELETE'])assert.equal((await f.request(url,{method})).status,405);
 for(const headers of [{},{'x-roas-local-action':'yes',origin:'https://evil.invalid'},{'x-roas-local-action':'yes',host:'evil.invalid:3000'}])assert.equal((await f.request(url,{method:'POST',headers,body:'{}'})).status,403);
 assert.equal((await f.request(url,{headers:{host:'evil.invalid:3000'}})).status,403);
 const headers={'x-roas-local-action':'yes'};for(const body of ['["PRIVATE"]','{broken'])assert.equal((await f.request(url,{method:'POST',headers,body})).status,400);
 assert.equal((await f.request(url,{method:'POST',headers,body:JSON.stringify({mappings:{a:'x'.repeat(65536)}})})).status,413);
});
