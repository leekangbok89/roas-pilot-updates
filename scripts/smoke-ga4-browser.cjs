'use strict';

// Browser release gate: disposable localhost app copies and synthetic credentials.
// Real Google/Meta traffic is blocked in both the server and browser. Never copy
// the user's .env, saved data, or encrypted credentials into these installations.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const source = path.resolve(__dirname, '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'roas-ga4-browser-'));
const base = 'http://127.0.0.1:3000';
const assets = ['ga4.html', 'ga4.js', 'ga4.css'];
const keyMarker = 'SYNTHETIC-GA4-BROWSER-GATE-NOT-A-REAL-PRIVATE-KEY';
const credentialText = JSON.stringify({
  type: 'service_account', project_id: 'roas-ga4-browser-gate', private_key_id: 'synthetic-only',
  private_key: '-----BEGIN PRIVATE KEY-----\n' + keyMarker + '\n-----END PRIVATE KEY-----\n',
  client_email: 'ga4-browser-gate@example.invalid', client_id: '000000000000000000000',
  token_uri: 'https://oauth2.googleapis.com/token'
});
const rawAd = '<img data-ga4-injected src=x onerror="window.__ga4Injected=1">';
const rawPath = '/product/detail.html?product_no=42&payload=<svg data-ga4-injected onload="window.__ga4Injected=2"></svg>';
const warnings = [
  '개인정보 보호 기준점 적용 대상입니다. 일부 값이 보고되지 않을 수 있습니다.',
  '일부 차원 조합이 (other)로 묶였습니다. 전체값과 행별 합계가 다를 수 있습니다.',
  '샘플링된 보고서입니다. 사용 이벤트 비율 50%.',
  '데이터 처리 중: 최근 24~48시간 값은 달라질 수 있습니다.'
];
let child, browser, context, page, temp, scenario, serverLog = '', checks = 0;
const pageErrors = [], externalRequests = [], routeErrors = [];

function pass(message) { checks += 1; console.log('PASS [' + scenario + '] ' + message); }
function configured(value = true) {
  return { configured: value, propertyId: value ? '560644825' : '', clientEmail: value ? 'ga4-browser-gate@example.invalid' : '', verifiedAt: value ? '2026-10-24T04:00:00.000Z' : null };
}
function reportFor(url, mode) {
  const params = new URL(url).searchParams;
  const scope = params.get('scope') || 'all';
  const observed = mode !== 'unverified';
  const restricted = mode === 'restricted';
  const purchases = !observed || mode === 'zero' ? 0 : scope === 'meta' ? 2 : 5;
  const acquisition = Array.from({ length: 61 }, (_, index) => ({
    source: index % 2 ? 'ig' : 'fb', medium: 'paid_social',
    campaign: index === 0 ? '캠페인 ' + rawAd : '검색표본-' + String(index).padStart(3, '0'),
    campaignId: '120000000000000001', adsetId: '120000000000000002',
    adContent: index === 0 ? rawAd : index === 2 ? '(not set)' : String(120000000000000000n + BigInt(index)),
    metaAdName: index === 1 ? '저장된 Meta 광고명' : '', metaMatch: index === 1 ? 'matched' : index === 2 ? 'missing_utm' : 'unmatched',
    sessions: 100 - index, activeUsers: restricted && index === 0 ? null : 30 + index % 20,
    engagedSessions: 50 - Math.floor(index / 2), engagementRate: restricted && index === 0 ? null : 0.5,
    averageSessionDuration: 30 + index, screenPageViews: 200 - index,
    ecommercePurchases: restricted && index === 0 ? null : index < purchases ? 1 : 0,
    purchaseRevenue: restricted ? null : index < purchases ? 48000 : 0
  }));
  const landingPages = Array.from({ length: 53 }, (_, index) => ({
    landingPage: index === 0 ? rawPath : '/product/detail.html?product_no=' + (90000 + index),
    sessions: 80 - index, activeUsers: 20, engagedSessions: 20, engagementRate: 0.4,
    averageSessionDuration: 45, screenPageViews: 100,
    ecommercePurchases: index < purchases ? 1 : 0, purchaseRevenue: restricted ? null : 48000
  }));
  const users = mode === 'race-old' ? 111 : mode === 'race-new' ? 222 : scope === 'meta' ? 51 : 137;
  return {
    propertyId: '560644825', since: params.get('since'), until: params.get('until'), scope,
    fetchedAt: '2026-10-24T04:05:00.000Z', cached: false, currencyCode: 'KRW', timeZone: 'Asia/Seoul',
    summary: {
      activeUsers: users, sessions: 10000, engagedSessions: 3750, engagementRate: restricted ? null : 0.375,
      averageSessionDuration: restricted ? null : 75, screenPageViews: 23000,
      ecommercePurchases: purchases, purchaseRevenue: restricted ? null : purchases * 48000
    },
    acquisition, landingPages,
    purchaseTracking: { state: observed ? 'observed' : 'unverified', eventCount: observed ? 5 : 0 },
    warnings: restricted ? warnings.concat('수익 데이터 접근 권한이 제한되어 구매매출을 확인할 수 없습니다.') : warnings.slice(),
    rowCounts: { acquisition: 121, landingPages: 83 }, truncated: { acquisition: true, landingPages: true },
    metadata: {
      summary: { subjectToThresholding: true, dataLossFromOtherRow: true, samplingMetadatas: [{ samplesReadCount: '50', samplingSpaceSize: '100' }],
        schemaRestrictionResponse: restricted ? { activeMetricRestrictions: [{ metricName: 'purchaseRevenue', restrictedMetricTypes: ['REVENUE_DATA'] }] } : {} }
    }
  };
}

function prepareInstallation() {
  temp = path.join(tempRoot, scenario);
  fs.mkdirSync(temp, { recursive: true });
  for (const relative of ['server.js', 'package.json', 'public', 'vendor']) {
    if (fs.existsSync(path.join(source, relative))) fs.cpSync(path.join(source, relative), path.join(temp, relative), { recursive: true });
  }
  assert.equal(fs.existsSync(path.join(temp, '.roas-private')), false);
  assert.equal(fs.existsSync(path.join(temp, '.env')), false);
  if (scenario === 'legacy-missing-ga4-assets') for (const name of assets) fs.rmSync(path.join(temp, 'public', name), { force: true });
  for (const name of assets) assert.equal(fs.existsSync(path.join(temp, 'public', name)), scenario === 'normal-install');
  // integrations/ga4 is deliberately absent too: old updaters only replace server.js.
  assert.equal(fs.existsSync(path.join(temp, 'integrations', 'ga4')), false);
  assert.ok(fs.readFileSync(path.join(temp, 'server.js'), 'utf8').includes('const bundledGa4Assets='), 'Run the GA4 bundler before this gate');
}

async function startServer() {
  serverLog = '';
  const bootstrap = "global.fetch=async()=>{console.error('GA4_GATE_EXTERNAL_FETCH_BLOCKED');throw Error('External network disabled in GA4 browser verification');};const app=require('./server');app.server.listen(3000,'127.0.0.1',()=>console.log('READY 3000'));";
  child = spawn(process.execPath, ['-e', bootstrap], {
    cwd: temp, env: { ...process.env, META_ACCESS_TOKEN: '', META_AD_ACCOUNT_ID: '', OPENAI_API_KEY: '', WEB_PASSWORD: '', HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', data => { serverLog += data; });
  child.stderr.on('data', data => { serverLog += data; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Disposable GA4 server did not start: ' + serverLog)), 10000);
    child.stdout.on('data', data => { if (String(data).includes('READY 3000')) { clearTimeout(timer); resolve(); } });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', () => { clearTimeout(timer); reject(Error('Disposable server exited; existing localhost services were not stopped: ' + serverLog)); });
  });
}

async function stopServer() {
  if (child && child.exitCode === null) {
    const running = child;
    await new Promise(resolve => {
      const timer = setTimeout(() => { if (running.exitCode === null) running.kill('SIGKILL'); resolve(); }, 3000);
      running.once('exit', () => { clearTimeout(timer); resolve(); });
      running.kill('SIGTERM');
    });
  }
  child = null;
}

async function verifyDelivery() {
  for (const [name, type] of [['ga4.html', 'text/html'], ['ga4.js', 'application/javascript'], ['ga4.css', 'text/css']]) {
    const response = await fetch(base + '/' + name);
    assert.equal(response.status, 200, name + ' must be served in both installation paths');
    assert.ok(response.headers.get('content-type').startsWith(type), name + ' MIME type');
    assert.equal(response.headers.get('cache-control'), 'no-cache');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(await response.text(), fs.readFileSync(path.join(source, 'public', name), 'utf8'), name + ' must match current shipped source, including embedded fallback');
  }
  assert.equal((await fetch(base + '/ga4-missing-file.js')).status, 404);
  const status = await (await fetch(base + '/api/ga4/status')).json();
  assert.equal(status.configured, false, 'Real unconfigured service must be reachable without any Google request');
  assert.equal(JSON.stringify(status).includes('private_key'), false);
  pass('actual server serves current HTML/JS/CSS with safe MIME/cache headers and real unconfigured status');
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function entered(gate) {
  let timer;
  try { return await Promise.race([gate.entered.promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Expected held GA4 request did not arrive')), 7000); })]); }
  finally { clearTimeout(timer); }
}

async function newContext() {
  const mock = { enabled: false, configured: false, mode: 'unverified', reportError: false, testError: false, calls: [], holds: {}, gates: [] };
  mock.holdNext = kind => {
    const gate = { entered: deferred(), release: deferred(), settled: deferred(), allowAbort: kind === 'report' };
    mock.holds[kind] = gate;
    mock.gates.push(gate);
    return gate;
  };
  context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  await context.addInitScript(() => {
    window.__ga4StorageWrites = [];
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (this === localStorage) window.__ga4StorageWrites.push({ key: String(key), value: String(value) });
      return original.call(this, key, value);
    };
  });
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== base) { externalRequests.push(request.url()); return route.abort(); }
    if (!url.pathname.startsWith('/api/ga4/')) return route.continue();
    const record = { url: request.url(), path: url.pathname, method: request.method(), headers: request.headers(), body: request.postData() || '' };
    mock.calls.push(record);
    if (!mock.enabled) return route.continue();
    const kind = url.pathname.split('/').pop();
    let status = 200, body;
    if (kind === 'status') body = configured(mock.configured);
    else if (kind === 'credentials') { mock.configured = true; body = configured(); }
    else if (kind === 'test') { status = mock.testError ? 403 : 200; body = mock.testError ? { error: 'GA4 속성 조회 권한을 확인해 주세요. (검증용 응답)' } : configured(); }
    else if (kind === 'disconnect') { mock.configured = false; body = configured(false); }
    else if (kind === 'report') { status = mock.reportError ? 403 : 200; body = mock.reportError ? { error: 'GA4 보고서 접근 권한이 없습니다. (검증용 응답)' } : reportFor(request.url(), mock.mode); }
    else { status = 404; body = { error: 'Unknown synthetic GA4 route' }; }
    const gate = mock.holds[kind];
    if (gate) {
      delete mock.holds[kind];
      gate.entered.resolve(record);
      await gate.release.promise;
    }
    try { await route.fulfill({ status, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body) }); }
    catch (error) { if (!gate || !gate.allowAbort) routeErrors.push(error.message); }
    finally { if (gate) gate.settled.resolve(); }
  });
  page = await context.newPage();
  page.on('pageerror', error => pageErrors.push(error.message));
  page.__ga4Mock = mock;
  return mock;
}

async function metric(label) {
  return page.locator('#ga4-metrics .metric').filter({ has: page.getByText(label, { exact: true }) }).locator('strong').innerText();
}
async function reportReady() {
  await page.waitForFunction(() => !document.getElementById('ga4-report').hidden && document.getElementById('ga4-report').getAttribute('aria-busy') === 'false');
}
async function quietFrame() { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
async function openConnection() {
  if (!(await page.locator('#ga4-connection').evaluate(node => node.open))) await page.locator('#ga4-connection > summary').click();
}
async function screenshot(name) {
  if (!process.env.ROAS_GA4_SCREENSHOT_DIR) return;
  fs.mkdirSync(process.env.ROAS_GA4_SCREENSHOT_DIR, { recursive: true });
  const filename = path.join(process.env.ROAS_GA4_SCREENSHOT_DIR, 'ga4-' + name + '.png');
  await page.screenshot({ path: filename, fullPage: true });
  console.log('SCREENSHOT ' + filename);
}
async function noHorizontalOverflow(width, name) {
  await page.setViewportSize({ width, height: width < 500 ? 844 : 1000 });
  await page.mouse.move(Math.min(width - 20, 600), 70);
  await quietFrame();
  const result = await page.evaluate(() => ({ width: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  assert.ok(result.document <= result.width + 1 && result.body <= result.width + 1, name + ' must contain wide tables without document overflow: ' + JSON.stringify(result));
}
async function noCredentialStorage(mock) {
  const storage = await page.evaluate(() => ({ local: Object.entries(localStorage), session: Object.entries(sessionStorage), writes: window.__ga4StorageWrites || [], visible: document.body.innerText }));
  for (const value of [JSON.stringify(storage.local), JSON.stringify(storage.session), JSON.stringify(storage.writes), storage.visible]) {
    assert.equal(value.includes(keyMarker), false, 'Private key fixture must never be persisted or displayed');
    assert.equal(value.includes('"private_key"'), false, 'Credential JSON must never be persisted or displayed');
  }
  for (const request of mock.calls.filter(call => call.body.includes(keyMarker))) {
    assert.equal(new URL(request.url).origin, base);
    assert.equal(request.path, '/api/ga4/credentials');
    assert.equal(request.method, 'POST');
  }
}

async function unconfiguredBrowser(mock) {
  await page.goto(base + '/ga4.html', { waitUntil: 'domcontentloaded' });
  await page.mouse.move(700, 70);
  await page.waitForFunction(() => document.getElementById('ga4-connection-badge').textContent === 'GA4 연결 필요');
  assert.equal(await page.locator('#ga4-connect-form').isVisible(), true);
  assert.equal(await page.locator('#ga4-query').isDisabled(), true);
  assert.equal(await page.locator('#ga4-report').isVisible(), false);
  assert.equal(mock.calls.some(call => call.path === '/api/ga4/report'), false, 'Unconfigured UI must not ask for Google reports');
  assert.equal(await page.locator('#app-nav [data-app-route="ga4"]').count(), 0, 'GA4 remains directly accessible without a sidebar menu item');
  await noHorizontalOverflow(1280, 'Unconfigured desktop');
  await noHorizontalOverflow(390, 'Unconfigured mobile');
  await page.setViewportSize({ width: 1280, height: 1000 });
  pass('real unconfigured UI has disabled queries, correct navigation and no overflow at 1280/390px');
}

async function syntheticUploadAndBootstrapRace(mock) {
  mock.enabled = true;
  const initialStatus = mock.holdNext('status');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await entered(initialStatus);
  await page.locator('#ga4-property-id').fill('560644825');
  await page.locator('#ga4-key-file').setInputFiles({ name: 'ga4-synthetic-service-account.json', mimeType: 'application/json', buffer: Buffer.from(credentialText) });
  await page.locator('#ga4-save').click();
  await reportReady();
  assert.equal(await page.locator('#ga4-key-file').inputValue(), '', 'File input must be cleared after credential submission');
  const upload = mock.calls.find(call => call.path === '/api/ga4/credentials');
  assert.ok(upload, 'Browser sends the selected synthetic file only to the local credentials endpoint');
  assert.equal(upload.headers['x-roas-local-action'], 'yes');
  assert.ok(upload.headers['content-type'].startsWith('application/json'));
  const body = JSON.parse(upload.body);
  assert.equal(body.propertyId, '560644825');
  assert.equal(body.credentials, credentialText);
  await noCredentialStorage(mock);
  initialStatus.release.resolve();
  await initialStatus.settled.promise;
  await quietFrame();
  assert.equal(await page.locator('#ga4-connection-badge').innerText(), 'GA4 연결됨', 'Late initial unconfigured response must not overwrite a successful connection');
  assert.equal(await page.locator('#ga4-report').isVisible(), true);
  assert.equal(await page.locator('#ga4-query').isEnabled(), true);
  pass('synthetic upload uses local POST + explicit action header, clears file input, never stores keys, and survives late bootstrap status');
}

async function verifyUnverifiedAndTables(mock) {
  assert.equal(await metric('활성 사용자'), '137', 'Summary unique users come from the separate overall report');
  const fixture = reportFor(mock.calls.filter(call => call.path === '/api/ga4/report').at(-1).url, 'unverified');
  assert.notEqual(fixture.acquisition.reduce((sum, row) => sum + row.activeUsers, 0), 137);
  assert.equal(await metric('참여율'), '37.5%', 'Summary ratio must not be recomputed from table rows');
  assert.equal(await metric('평균 세션 시간'), '1분 15초');
  assert.equal(await metric('GA4 구매'), '수신 미확인');
  assert.equal(await metric('GA4 구매매출'), '수신 미확인');
  assert.ok((await page.locator('#ga4-purchase-status').innerText()).includes('실제 주문이 없었다는 뜻은 아닙니다'));
  assert.equal(await page.locator('#ga4-acquisition-body tr').first().locator('td').last().innerText(), '미확인');
  assert.equal(await page.locator('#ga4-warning-list li').count(), warnings.length);
  for (const warning of warnings) assert.ok((await page.locator('#ga4-warnings').innerText()).includes(warning));
  assert.ok((await page.locator('#ga4-acquisition-total').innerText()).includes('121개 중'));
  assert.ok((await page.locator('#ga4-acquisition-body').innerText()).includes(rawAd));
  assert.ok((await page.locator('#ga4-landing-body').innerText()).includes(rawPath));
  assert.equal(await page.locator('#ga4-report [data-ga4-injected], #ga4-report img, #ga4-report iframe, #ga4-report script').count(), 0);
  assert.equal(await page.evaluate(() => window.__ga4Injected || 0), 0, 'Untrusted ad and landing strings must remain literal text');

  const before = mock.calls.length;
  assert.equal(await page.locator('#ga4-acquisition-body tr').count(), 50);
  await page.locator('#ga4-acquisition-next').click();
  assert.equal(await page.locator('#ga4-acquisition-body tr').count(), 11);
  assert.ok((await page.locator('#ga4-acquisition-page-status').innerText()).includes('51–61'));
  await page.locator('#ga4-acquisition-search').fill('검색표본-060');
  assert.equal(await page.locator('#ga4-acquisition-body tr').count(), 1);
  assert.ok((await page.locator('#ga4-acquisition-body').innerText()).includes('검색표본-060'));
  await page.locator('#ga4-acquisition-search').fill('no-such-synthetic-ad');
  assert.ok((await page.locator('#ga4-acquisition-body').innerText()).includes('검색 조건'));
  await page.locator('#ga4-acquisition-search').fill('');
  assert.equal(await page.locator('#ga4-acquisition-body tr').count(), 50);
  await page.locator('#ga4-landing-next').click();
  assert.equal(await page.locator('#ga4-landing-body tr').count(), 3);
  await page.locator('#ga4-landing-search').fill('product_no=90052');
  assert.equal(await page.locator('#ga4-landing-body tr').count(), 1);
  await page.locator('#ga4-landing-search').fill('');
  await page.locator('#ga4-acquisition-sort').selectOption('activeUsers');
  assert.equal(mock.calls.length, before, 'Search, sorting and pagination must use loaded data without recollection');
  await page.locator('#ga4-acquisition-sort').selectOption('sessions');
  await noHorizontalOverflow(1280, 'Loaded desktop with long raw strings');
  await screenshot('desktop');
  await noHorizontalOverflow(390, 'Loaded mobile with long raw strings');
  await screenshot('mobile');
  await page.setViewportSize({ width: 1280, height: 1000 });
  pass('unverified purchases never become actual zero orders; overall KPIs, quality warnings, text-safe raw data and local pagination/search stay correct');
}

async function verifyScopeDatesAndObserved(mock) {
  mock.mode = 'observed';
  const until = await page.locator('#ga4-until').inputValue();
  const date = new Date(until + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() - 2);
  const since = date.toISOString().slice(0, 10);
  const before = mock.calls.length;
  await page.locator('#ga4-since').fill(since);
  await page.locator('#ga4-since').press('Tab');
  await page.locator('#ga4-scope').selectOption('meta');
  assert.equal(await page.locator('#ga4-report').isVisible(), false, 'Changed conditions must hide the previous report');
  assert.equal(mock.calls.length, before, 'Manual date/source changes await explicit query');
  await page.locator('#ga4-query').click();
  await reportReady();
  const query = new URL(mock.calls.filter(call => call.path === '/api/ga4/report').at(-1).url).searchParams;
  assert.equal(query.get('since'), since);
  assert.equal(query.get('until'), until);
  assert.equal(query.get('scope'), 'meta');
  assert.ok((await page.locator('#ga4-period-label').innerText()).includes('Meta 유료 유입'));
  assert.equal(await metric('활성 사용자'), '51');
  assert.equal(await metric('GA4 구매'), '2');
  assert.ok((await metric('GA4 구매매출')).includes('96,000'));
  assert.ok((await page.locator('#ga4-purchase-status').innerText()).includes('5건'));
  mock.mode = 'zero';
  await page.locator('#ga4-refresh').click();
  await reportReady();
  assert.equal(new URL(mock.calls.filter(call => call.path === '/api/ga4/report').at(-1).url).searchParams.get('refresh'), '1');
  assert.equal(await metric('GA4 구매'), '0', 'Observed property purchase tracking can report a genuine zero for the selected source scope');
  assert.ok((await page.locator('#ga4-purchase-status').innerText()).includes('5건'));
  mock.mode = 'restricted';
  await page.locator('#ga4-refresh').click();
  await reportReady();
  for (const label of ['GA4 구매매출', '평균 세션 시간', '참여율']) assert.equal(await metric(label), '—', label + ' must preserve null rather than coercing it to zero');
  assert.equal(await page.locator('#ga4-acquisition-body tr').first().locator('td').last().innerText(), '—');
  assert.ok((await page.locator('#ga4-warnings').innerText()).includes('수익 데이터 접근 권한'));
  pass('source/date queries clear stale data, observed scoped purchases can be zero, refresh is explicit, and restricted/null metrics remain unknown');
}

async function verifyReportRaceAndErrors(mock) {
  mock.mode = 'race-old';
  const old = mock.holdNext('report');
  await page.locator('#ga4-refresh').click();
  await entered(old);
  await page.locator('#ga4-scope').selectOption('all');
  mock.mode = 'race-new';
  await page.locator('#ga4-query').click();
  await reportReady();
  assert.equal(await metric('활성 사용자'), '222');
  old.release.resolve();
  await old.settled.promise;
  await quietFrame();
  assert.equal(await metric('활성 사용자'), '222', 'An old/aborted response must not replace the latest source selection');
  assert.ok((await page.locator('#ga4-period-label').innerText()).includes('전체 유입'));
  mock.reportError = true;
  await page.locator('#ga4-refresh').click();
  await page.locator('#ga4-report-error').waitFor({ state: 'visible' });
  assert.ok((await page.locator('#ga4-report-error').innerText()).includes('접근 권한'));
  assert.equal(await page.locator('#ga4-report').isVisible(), false, 'Failed report must not leave stale numbers on screen');
  await openConnection();
  mock.testError = true;
  await page.locator('#ga4-test').click();
  await page.waitForFunction(() => document.getElementById('ga4-connection-badge').textContent === '연결 확인 필요');
  assert.ok((await page.locator('#ga4-connection-message').innerText()).includes('조회 권한'));
  mock.testError = false;
  await page.locator('#ga4-test').click();
  await page.waitForFunction(() => document.getElementById('ga4-connection-message').textContent.includes('조회 권한을 확인했습니다'));
  mock.reportError = false;
  mock.mode = 'observed';
  await page.locator('#ga4-query').click();
  await reportReady();
  await openConnection();
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#ga4-disconnect').click();
  await page.waitForFunction(() => document.getElementById('ga4-connection-badge').textContent === 'GA4 연결 필요');
  assert.equal(await page.locator('#ga4-report').isVisible(), false);
  assert.equal(await page.locator('#ga4-query').isDisabled(), true);
  assert.equal(await page.locator('#ga4-key-file').inputValue(), '');
  assert.equal(await page.locator('#ga4-saved-details').isVisible(), false);
  for (const call of mock.calls.filter(call => call.method === 'POST')) {
    assert.equal(call.headers['x-roas-local-action'], 'yes', call.path + ' must require a deliberate local action');
    assert.equal(new URL(call.url).origin, base);
  }
  await noCredentialStorage(mock);
  assert.equal(fs.existsSync(path.join(temp, '.roas-private', 'ga4.dpapi')), false, 'Mock credentials must never reach the real credential store');
  pass('request races preserve the latest report; permission errors stay explicit; test/disconnect use local action headers and clear the report');
}

async function runScenario() {
  prepareInstallation();
  await startServer();
  await verifyDelivery();
  const mock = await newContext();
  try {
    await unconfiguredBrowser(mock);
    if (scenario === 'legacy-missing-ga4-assets') {
      await syntheticUploadAndBootstrapRace(mock);
      await verifyUnverifiedAndTables(mock);
      await verifyScopeDatesAndObserved(mock);
      await verifyReportRaceAndErrors(mock);
    } else {
      mock.enabled = true; mock.configured = true; mock.mode = 'observed';
      await page.reload({ waitUntil: 'domcontentloaded' });
      await reportReady();
      assert.equal(await metric('활성 사용자'), '137');
      assert.equal(await metric('GA4 구매'), '5');
      await noHorizontalOverflow(1280, 'Normal installation desktop');
      await noHorizontalOverflow(390, 'Normal installation mobile');
      pass('normally installed assets also load connected reports without external resources or horizontal overflow');
    }
    assert.equal(serverLog.includes('GA4_GATE_EXTERNAL_FETCH_BLOCKED'), false, 'The real unconfigured server must not attempt any external request');
  } finally {
    for (const gate of mock.gates) gate.release.resolve();
  }
  await context.close(); context = null; page = null;
  await stopServer();
}

(async () => {
  const localModule = '/tmp/roas-pilot-ui-runtime/node_modules/playwright';
  const { chromium } = require(process.env.ROAS_PLAYWRIGHT_MODULE || (fs.existsSync(localModule) ? localModule : 'playwright'));
  const localBrowser = '/tmp/roas-pilot-browser/chromium_headless_shell-1194/chrome-linux/headless_shell';
  const executable = process.env.BROWSER_EXECUTABLE || (fs.existsSync(localBrowser) ? localBrowser : null);
  browser = await chromium.launch({ headless: true, ...(executable ? { executablePath: executable } : {}) });
  for (scenario of ['legacy-missing-ga4-assets', 'normal-install']) await runScenario();
  assert.deepEqual(pageErrors, [], 'No browser JavaScript errors');
  assert.deepEqual(routeErrors, [], 'No unexpected request interception errors');
  assert.deepEqual(externalRequests, [], 'No browser request may leave the disposable localhost origin');
  console.log('GA4 browser verification passed: ' + checks + ' checks across legacy embedded and normal installations; no real credentials or external network.');
})().catch(async error => {
  console.error('FAIL ' + error.stack);
  if (page) {
    console.error(JSON.stringify(await page.evaluate(() => ({
      url: location.href, badge: document.getElementById('ga4-connection-badge')?.textContent,
      connection: document.getElementById('ga4-connection-message')?.textContent,
      report: document.getElementById('ga4-report-status')?.textContent,
      error: document.getElementById('ga4-report-error')?.textContent
    })).catch(() => ({}))));
    await screenshot('failure').catch(() => {});
  }
  process.exitCode = 1;
}).finally(async () => {
  if (page && page.__ga4Mock) for (const gate of page.__ga4Mock.gates) gate.release.resolve();
  if (browser) await browser.close();
  await stopServer();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});
