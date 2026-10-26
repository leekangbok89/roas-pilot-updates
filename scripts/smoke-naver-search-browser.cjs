'use strict';
// Disposable install, synthetic API responses; no real Naver traffic or keys.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const source = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'roas-search-browser-'));
const base = 'http://127.0.0.1:3000';
const { chromium } = require(process.env.ROAS_PLAYWRIGHT_MODULE || 'playwright');
let child, browser, page, connected = false, scopeChosen = false, auto = true, failSave = false, stale = false, missing = false;
const errors = [], external = [], posted = [];
const status = () => ({ configured: connected, customerId: connected ? '123456' : '', scopeConfigured: connected && scopeChosen, scopeKey: scopeChosen ? 'scope-wemamang-a' : '', scopeCampaignIds: scopeChosen ? ['cmp-a'] : [], enabled: auto, running: false, lastSuccessAt: '2026-10-25T03:00:00Z', nextAutomaticAt: '2026-10-25T04:00:00Z' });
const metrics = { spend: 4400, impressions: 2000, clicks: 20, purchases: 4, purchaseRevenue: 44000, purchaseRoas: 1000, ctr: 1, cpc: 220, cpm: 2200 };
function result(url) {
  const range = new URL(url).searchParams;
  const values = { ...metrics, ...(missing ? { purchases: null, purchaseRevenue: null, purchaseRoas: null } : {}) };
  return { scopeKey: 'scope-wemamang-a', customerId: '123456', since: range.get('since'), until: range.get('until'), fetchedAt: '2026-10-25T03:00:00Z', cached: stale, stale,
    ...(stale ? { refreshError: '호출 한도: 저장 자료 유지' } : {}), summary: values,
    campaigns: [{ id: 'cmp-a', name: '<img data-injected src=x onerror="window.__injected=1"> 위마망', type: 'WEB_SITE', status: 'ELIGIBLE', ...values }],
    daily: [{ date: range.get('since'), ...values }], warnings: ['광고비 VAT 포함 · 구매 기여 기준'] };
}
async function main() {
  // Copy only server.js plus the two shell assets: exercise the old updater path.
  fs.mkdirSync(path.join(temp, 'public'));
  fs.copyFileSync(path.join(source, 'server.js'), path.join(temp, 'server.js'));
  for (const name of ['app-shell.css', 'app-shell.js']) fs.copyFileSync(path.join(source, 'public', name), path.join(temp, 'public', name));
  child = spawn(process.execPath, ['-e', "global.fetch=async()=>{throw Error('External fetch disabled');};require('./server').server.listen(3000,'127.0.0.1',()=>console.log('READY'));"], { cwd: temp, env: { ...process.env, WEB_PASSWORD: '', HOST: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    let log = ''; const timer = setTimeout(() => reject(Error('Server did not start: ' + log)), 10000);
    child.stdout.on('data', data => { log += data; if (log.includes('READY')) { clearTimeout(timer); resolve(); } });
    child.stderr.on('data', data => { log += data; });
    child.on('error', reject);
  });
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  await context.route('**/*', async route => {
    const request = route.request(), url = request.url();
    if (!url.startsWith(base + '/')) { external.push(url); return route.abort(); }
    if (!url.includes('/api/naver-search/')) return route.continue();
    const endpoint = new URL(url).pathname.split('/').pop();
    if (request.method() === 'POST') { assert.equal(request.headers()['x-roas-local-action'], 'yes'); posted.push({ endpoint, body: request.postDataJSON() }); }
    if (endpoint === 'credentials') {
      if (failSave) return route.fulfill({ status: 400, json: { error: '검색광고 인증에 실패했습니다.' } });
      connected = true;
      return route.fulfill({ json: { ...status(), campaignCount: 1 } });
    }
    if (endpoint === 'campaigns') return route.fulfill({ json: { campaignIds: scopeChosen ? ['cmp-a'] : [], campaigns: [{ id: 'cmp-a', name: '위마망 백도씨', type: 'WEB_SITE' }, { id: 'cmp-truver', name: '트루버 버너', type: 'SHOPPING' }, { id: 'cmp-unknown', name: '알 수 없는 캠페인', type: 'WEB_SITE' }] } });
    if (endpoint === 'scope') { assert.deepEqual(request.postDataJSON().campaignIds, ['cmp-a']); scopeChosen = true; }
    if (endpoint === 'settings') auto = request.postDataJSON().enabled;
    if (endpoint === 'disconnect') connected = false;
    return route.fulfill({ json: endpoint === 'report' ? result(url) : endpoint === 'test' ? { ok: true, campaignCount: 1 } : status() });
  });
  page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + '/naver-search.html');
  await page.waitForFunction(() => document.getElementById('search-badge').textContent === '연결 전');
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  assert.equal(await page.locator('#search-load').isDisabled(), true);
  await page.fill('#search-customer', '123456'); await page.fill('#search-key', 'SYNTHETIC-API-KEY'); await page.fill('#search-secret', 'SYNTHETIC-SECRET-KEY');
  await page.locator('#search-connect button').click();
  await page.locator('#search-scope-options input[value="cmp-a"]').waitFor();
  assert.equal(await page.locator('#search-report').isVisible(), false, 'Whole-account figures are hidden before explicit brand selection');
  assert.equal(await page.locator('#search-load').isDisabled(), true);
  assert.equal(await page.locator('#search-scope-options input:checked').count(), 0, 'No campaign is guessed from its name');
  await page.locator('#search-scope-options input[value="cmp-a"]').check();
  await page.locator('#search-scope-save').click();
  await page.waitForFunction(() => !document.getElementById('search-report').hidden && document.getElementById('search-load').disabled === false);
  assert.equal(await page.locator('#search-key').inputValue(), ''); assert.equal(await page.locator('#search-secret').inputValue(), '');
  assert.match(await page.locator('#search-metrics').innerText(), /4,400원/); assert.match(await page.locator('#search-metrics').innerText(), /1,000%/);
  assert.equal(await page.locator('[data-injected]').count(), 0); assert.equal(await page.evaluate(() => window.__injected), undefined);
  assert.match(await page.locator('#search-campaigns').innerText(), /<img data-injected/);
  assert.equal(await page.evaluate(() => JSON.stringify({ ...localStorage }).includes('SYNTHETIC')), false);
  assert.equal(posted[0].body.customerId, '123456');
  assert.equal(await page.locator('#search-campaigns').getByText('트루버 버너').count(), 0);
  await page.reload();
  await page.waitForFunction(() => !document.getElementById('search-report').hidden && !document.getElementById('search-load').disabled);
  assert.equal(await page.locator('#search-scope-options input[value="cmp-a"]').isChecked(), true);
  assert.equal(await page.locator('#search-scope-options input[value="cmp-truver"]').isChecked(), false);
  console.log('PASS explicit Wemamang-only scope persists across reload; Tru ver and unknown campaigns stay unchecked');
  console.log('PASS legacy upgrade: connect/save/clear keys, purchase metrics, safe campaign text, no browser secret storage');
  await page.locator('#search-auto').uncheck(); await page.waitForFunction(() => !document.getElementById('search-auto').disabled);
  assert.equal(auto, false); await page.locator('#search-auto').check(); await page.waitForFunction(() => !document.getElementById('search-auto').disabled);
  assert.equal(auto, true);
  stale = true; await page.locator('#search-refresh').click();
  await page.waitForFunction(() => document.getElementById('search-report-notice').textContent.includes('갱신 실패'));
  assert.match(await page.locator('#search-metrics').innerText(), /4,400원/);
  assert.match(await page.locator('#search-fetched').innerText(), /이전 저장 자료/);
  stale = false; missing = true; await page.waitForFunction(() => !document.getElementById('search-refresh').disabled); await page.locator('#search-refresh').click();
  await page.waitForFunction(() => document.getElementById('search-metrics').textContent.includes('미확인') && !document.getElementById('search-refresh').disabled);
  assert.match(await page.locator('#search-campaigns').innerText(), /미확인/);
  console.log('PASS auto preference, stale report timestamp/failure, missing purchase stays unknown');
  // Failed replacement must leave the connected account/report usable.
  await page.locator('#search-connection summary').click();
  await page.fill('#search-key', 'REPLACEMENT-API-KEY'); await page.fill('#search-secret', 'REPLACEMENT-SECRET-KEY'); failSave = true;
  await page.locator('#search-connect button').click();
  await page.waitForFunction(() => document.getElementById('search-message').textContent.includes('인증에 실패'));
  assert.equal(await page.locator('#search-load').isDisabled(), false); assert.equal(await page.locator('#search-key').inputValue(), '');
  await page.locator('#app-theme-toggle').click(); assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2);
    assert.equal(overflow, false, 'No page-level overflow at ' + width + 'px');
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('#app-nav-toggle').click();
  assert.equal(await page.locator('#app-nav [data-app-route="search"]').getAttribute('aria-current'), 'page');
  await page.keyboard.press('Escape');
  page.once('dialog', dialog => dialog.accept()); await page.locator('#search-disconnect').click();
  await page.waitForFunction(() => document.getElementById('search-badge').textContent === '연결 전');
  assert.equal(await page.locator('#search-report').isVisible(), false); assert.equal(await page.locator('#search-load').isDisabled(), true);
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  if (process.env.ROAS_SEARCH_SCREENSHOT) await page.screenshot({ path: process.env.ROAS_SEARCH_SCREENSHOT, fullPage: true });
  console.log('PASS failed replacement preserves connection, light/dark, desktop/mobile, navigation and disconnect');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await browser?.close();
  if (child && child.exitCode === null) await new Promise(resolve => { child.once('exit', resolve); child.kill('SIGTERM'); });
  fs.rmSync(temp, { recursive: true, force: true });
});
