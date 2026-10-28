'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require(process.env.ROAS_PLAYWRIGHT_MODULE || 'playwright');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'roas-history-ui-'));
let child, browser;
const errors = [], external = [], posts = [], queries = [];
let state, releaseStart, startObserved;
const period = { since: '2026-08-30', until: '2026-10-28', channel: 'all' };
const idle = () => ({ status: 'idle', running: false, completedDays: 0, totalDays: 0 });
const job = () => ({ id: 'history-synthetic', mode: 'maximum', since: '2025-10-30', until: '2026-10-29', channels: ['growth', 'seller'], status: 'running', running: true, completedDays: 70, totalDays: 730, skippedDays: 56, current: { channel: 'growth', since: '2026-10-23', until: '2026-10-29' }, failures: [], error: null });
async function waitState(page, text) {
  await page.waitForFunction(value => document.getElementById('ca-history-state').textContent.includes(value), text, { timeout: 12000 });
  await page.waitForFunction(() => !document.querySelector('#ca-query [type=submit]').disabled);
}
async function poll(page) {
  // Returning to a visible tab checks progress immediately, without changing dates.
  const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/coupang/status');
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await response;
}
async function unchangedPeriod(page) {
  assert.equal(await page.locator('#ca-since').inputValue(), period.since);
  assert.equal(await page.locator('#ca-until').inputValue(), period.until);
  assert.equal(await page.locator('#ca-channel').inputValue(), period.channel);
  const url = new URL(page.url());
  for (const [key, value] of Object.entries(period)) assert.equal(url.searchParams.get(key), value);
}
async function exercise(context, base, file) {
  state = { configured: true, history: idle() };
  const firstPost = posts.length, firstQuery = queries.length;
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + '/' + file + '?' + new URLSearchParams(period));
  await page.locator('#ca-history-start:not(:disabled)').waitFor();
  if (await page.locator('.growth-supplemental').count()) assert.equal(await page.locator('.growth-supplemental').evaluate(node => node.open), false, 'History collection is visible while connection details stay collapsed');
  await page.locator('#ca-query [type=submit]:not(:disabled)').waitFor();
  assert.equal(await page.locator('#ca-history-resume').isDisabled(), true);
  assert.equal(await page.locator('#ca-history-pause').isDisabled(), true);
  assert.match(await page.locator('#ca-history-detail').innerText(), /365일.*판매자배송.*로켓그로스/);
  assert.ok(await page.locator('.ca-history-panel a[href="/coupang-collector.html"]').isVisible());
  let started;
  const observed = new Promise(resolve => { startObserved = resolve; });
  const held = new Promise(resolve => { releaseStart = resolve; });
  state.startGate = held;
  await page.locator('#ca-history-start').click();
  await observed;
  assert.equal(await page.locator('#ca-history-start').isDisabled(), true);
  assert.equal(await page.locator('#ca-refresh-orders').isDisabled(), true);
  await page.locator('#ca-history-start').evaluate(button => button.click());
  assert.equal(posts.length - firstPost, 1, 'Pending clicks cannot create duplicate jobs');
  releaseStart();
  await waitState(page, '70/730');
  started = posts.slice(firstPost);
  assert.deepEqual(started, [{ endpoint: 'history', body: { mode: 'maximum' } }]);
  assert.equal(await page.locator('#ca-history-progress').evaluate(node => node.max), 730);
  assert.equal(await page.locator('#ca-history-progress').evaluate(node => node.value), 70);
  assert.match(await page.locator('#ca-history-detail').innerText(), /로켓그로스 2026-10-23 ~ 2026-10-29/);
  assert.match(await page.locator('#ca-history-detail').innerText(), /기존 저장분 56/);
  assert.equal(await page.locator('#ca-refresh-orders').isDisabled(), true);
  await unchangedPeriod(page);
  await page.locator('#ca-history-pause').click();
  await page.waitForFunction(() => document.getElementById('ca-history-detail').textContent.includes('현재 구간 저장 후 중지'));
  assert.equal(await page.locator('#ca-history-pause').isDisabled(), true);
  assert.deepEqual(posts.at(-1), { endpoint: 'history-pause', body: {} });
  state.history = { ...state.history, running: false, status: 'paused', pauseRequested: false, current: null, completedDays: 84 };
  await page.reload();
  await waitState(page, '84/730');
  assert.match(await page.locator('#ca-history-state').innerText(), /일시정지/);
  assert.equal(posts.length - firstPost, 2, 'Reload reads the checkpoint without starting a job');
  await page.locator('#ca-history-resume:not(:disabled)').click();
  await waitState(page, '수집 중');
  assert.deepEqual(posts.at(-1), { endpoint: 'history', body: { resume: true } });
  const cause = '허용 IP·연동업체 설정 거절';
  state.history = { ...state.history, running: false, status: 'failed', current: null, error: '쿠팡 인증 실패', failures: ['growth', 'seller'].map(channel => ({ channel, since: '2026-10-23', until: '2026-10-29', error: cause, diagnosis: { httpStatus: 403, message: cause, action: 'WING의 허용 IP를 확인하세요. <img data-history-injected src=x>' } })) };
  await poll(page); await waitState(page, '수집 중단');
  const failure = await page.locator('#ca-history-error').innerText();
  assert.match(failure, /HTTP 403/); assert.match(failure, /허용 IP·연동업체 설정 거절/);
  assert.match(failure, /오류 구간: 로켓그로스 2026-10-23 ~ 2026-10-29/);
  assert.match(failure, /오류 구간: 판매자배송 2026-10-23 ~ 2026-10-29/);
  assert.equal(await page.locator('[data-history-injected]').count(), 0, 'Upstream diagnosis is rendered as text');
  assert.equal(await page.locator('#ca-history-resume').isDisabled(), false);
  assert.equal(await page.locator('#ca-history-progress').evaluate(node => node.value), 84, 'A failed run retains saved progress');
  assert.equal(posts.length - firstPost, 3, 'Status polling never retries an authorization failure');
  await unchangedPeriod(page);
  await page.locator('#ca-history-resume').click(); await waitState(page, '수집 중');
  const beforeCompletion = queries.length;
  state.history = { ...state.history, running: false, status: 'completed', completedDays: 730, error: null, failures: [], current: null };
  await poll(page); await waitState(page, '전체 수집 완료');
  assert.equal(await page.locator('#ca-history-progress').evaluate(node => node.value), 730);
  assert.equal(await page.locator('#ca-history-error').isHidden(), true);
  assert.equal(await page.locator('#ca-history-resume').isDisabled(), true);
  assert.ok(queries.length > beforeCompletion, 'Completion reloads saved analytics');
  assert.deepEqual(posts.slice(firstPost), [{ endpoint: 'history', body: { mode: 'maximum' } }, { endpoint: 'history-pause', body: {} }, { endpoint: 'history', body: { resume: true } }, { endpoint: 'history', body: { resume: true } }]);
  for (const query of queries.slice(firstQuery)) for (const [key, value] of Object.entries(period)) assert.equal(query[key], value, 'Collection preserves the selected reporting dates');
  await unchangedPeriod(page);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, file + ' fits mobile width');
  await page.close();
}
async function main() {
  // Exercise embedded assets: older installations may not have these public files.
  fs.copyFileSync(path.resolve(__dirname, '../server.js'), path.join(temp, 'server.js'));
  child = spawn(process.execPath, ['-e', "global.fetch=async()=>{throw Error('External traffic disabled');};const s=require('./server').server;s.listen(0,'127.0.0.1',()=>console.log('READY:'+s.address().port));"], { cwd: temp, env: { ...process.env, WEB_PASSWORD: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const port = await new Promise((resolve, reject) => { let log = ''; const timer = setTimeout(() => reject(Error('Server start: ' + log)), 10000); child.stdout.on('data', chunk => { log += chunk; const match = /READY:(\d+)/.exec(log); if (match) { clearTimeout(timer); resolve(Number(match[1])); } }); child.stderr.on('data', chunk => { log += chunk; }); child.on('error', reject); });
  const base = 'http://127.0.0.1:' + port;
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Asia/Seoul' });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== base) { external.push(request.url()); return route.abort(); }
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const endpoint = url.pathname.split('/').pop(), body = request.method() === 'POST' ? request.postDataJSON() : null;
    if (body) { assert.equal(request.headers()['x-roas-local-action'], 'yes'); posts.push({ endpoint, body }); }
    let json = {};
    if (endpoint === 'history' && body?.mode === 'maximum') { state.history = job(); startObserved(); await state.startGate; }
    if (endpoint === 'history' && body?.resume) state.history = { ...state.history, status: 'running', running: true, pauseRequested: false, error: null, failures: [] };
    if (endpoint === 'history-pause') state.history = { ...state.history, pauseRequested: true };
    if (endpoint === 'history' || endpoint === 'history-pause') json = state.history;
    if (endpoint === 'status') json = { configured: state.configured, products: [], busy: state.history.running, automatic: { enabled: true, status: 'idle', running: false }, history: state.history };
    if (endpoint === 'workspace') json = { revision: 'synthetic', scopeKey: 'synthetic', groups: [], products: [] };
    if (endpoint === 'analytics') {
      const values = Object.fromEntries(url.searchParams); queries.push(values);
      json = { since: values.since, until: values.until, channel: values.channel, summary: { sales: null, available: {} }, daily: [], items: [], productDaily: [], importedDates: [], coverage: { totalDays: 60 }, workspaceRevision: 'synthetic', scopeKey: 'synthetic' };
    }
    await route.fulfill({ json });
  });
  for (const file of ['coupang-dashboard.html', 'coupang-sales.html']) await exercise(context, base, file);
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log('PASS embedded dashboard/sales one-click history, duplicate guard, 730-day-method progress, pause/checkpoint/resume, two-channel 403, unchanged query dates, completion reload and mobile width');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { releaseStart?.(); await browser?.close(); child?.kill(); fs.rmSync(temp, { recursive: true, force: true }); });
