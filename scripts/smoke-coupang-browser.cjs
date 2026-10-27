'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require(process.env.ROAS_PLAYWRIGHT_MODULE || 'playwright');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'roas-coupang-ui-'));
const base = 'http://127.0.0.1:3000';
let child, browser, configured = false, selected = [], reviewed = false;
let historyJob = { status: 'idle', running: false, completedDays: 0, totalDays: 0 };
const posts = [], errors = [], external = [];
const malicious = '<img data-injected src=x onerror="window.__injected=1"> 위마망';
async function main() {
  // No integration/public files: verify installations with an older managedFiles list.
  fs.copyFileSync(path.resolve(__dirname, '../server.js'), path.join(temp, 'server.js'));
  child = spawn(process.execPath, ['-e', "global.fetch=async()=>{throw Error('External traffic disabled');};require('./server').server.listen(3000,'127.0.0.1',()=>console.log('READY'));"], { cwd: temp, env: { ...process.env, WEB_PASSWORD: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => { let log = ''; const timer = setTimeout(() => reject(Error('server start: ' + log)), 10000); child.stdout.on('data', b => { log += b; if (log.includes('READY')) { clearTimeout(timer); resolve(); } }); child.stderr.on('data', b => { log += b; }); child.on('error', reject); });
  const realStatus = await fetch(base + '/api/coupang/status'); assert.equal(realStatus.status, 200); assert.equal((await realStatus.json()).configured, false);
  assert.equal((await fetch(base + '/api/coupang/status', { headers: { Origin: 'https://evil.invalid' } })).status, 403);
  assert.equal((await fetch(base + '/api/coupang/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
  assert.equal((await fetch(base + '/api/coupang/report', { method: 'POST' })).status, 405);
  assert.equal((await fetch(base + '/api/coupang/history')).status, 409);
  assert.equal((await fetch(base + '/api/coupang/history', { method: 'POST', headers: { Origin: 'https://evil.invalid' }, body: '{}' })).status, 403);
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Asia/Seoul' });
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin !== base) { external.push(req.url()); return route.abort(); }
    if (!url.pathname.startsWith('/api/coupang/')) return route.continue();
    const endpoint = url.pathname.split('/').pop(), body = req.method() === 'POST' ? req.postDataJSON() : null;
    if (body) { assert.equal(req.headers()['x-roas-local-action'], 'yes'); posts.push({ endpoint, body }); }
    if (endpoint === 'credentials') { configured = true; selected = []; reviewed = false; }
    if (endpoint === 'scope') { selected = body.products; assert.deepEqual(selected.map(p => p.itemId), ['123']); }
    if (endpoint === 'ledger') { assert.equal(body.reviewed, true); reviewed = true; }
    let json = { configured, products: selected, vendorId: configured ? 'A00012345' : '', scopeKey: 'scope-a', history: historyJob };
    if (endpoint === 'history') {
      if (body && !body.resume) historyJob = { id: 'history-a', since: body.since, until: body.until, channels: body.channels, status: 'running', running: true, completedDays: 0, totalDays: 730, error: null };
      if (body?.resume) historyJob = { ...historyJob, status: 'running', running: true, error: null };
      json = historyJob;
    }
    if (endpoint === 'history-pause') json = historyJob = { ...historyJob, status: 'paused', running: false };
    if (endpoint === 'products') json = { products: [{ itemId: '123', name: malicious, unitCost: 3000 }, { itemId: '456', name: '트루버', unitCost: null }], selected: selected.map(p => p.itemId) };
    if (endpoint === 'sync') json = { savedDays: [body.since], channel: body.channel };
    if (endpoint === 'ledger') json = { saved: true };
    if (endpoint === 'report') {
      const date = url.searchParams.get('since'), input = posts.filter(p => p.endpoint === 'ledger').at(-1)?.body;
      const summary = { complete: reviewed, netSales: reviewed ? 19000 : null, profit: reviewed ? 11000 : null, completeDays: reviewed ? 1 : 0, totalDays: 1 };
      json = { since: date, until: date, scopeKey: 'scope-a', note: '입력 비용 범위의 예상 이익입니다.', products: selected,
        summaries: { growth: summary, seller: { complete: false, netSales: null, profit: null, completeDays: 0, totalDays: 1 }, all: { complete: false, netSales: null, profit: null, completeDays: reviewed ? 1 : 0, totalDays: 2 } },
        daily: ['growth', 'seller'].map(channel => ({ date, channel, quantity: channel === 'growth' ? 2 : null, gross: channel === 'growth' ? 20000 : null, estimatedProductCost: channel === 'growth' ? 6000 : null, fetchedAt: channel === 'growth' ? '2026-10-26T00:00:00Z' : null, basis: 'basis-' + channel, entry: channel === 'growth' && reviewed ? { ...input, netSales: 19000 } : null, profit: channel === 'growth' && reviewed ? 11000 : null, complete: channel === 'growth' && reviewed, stale: false })) };
    }
    return route.fulfill({ json });
  });
  const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.goto(base + '/coupang.html'); await page.waitForFunction(() => document.getElementById('cp-identity').textContent === '미연결');
  await page.mouse.move(1200, 500); await page.keyboard.press('Escape');
  assert.equal(await page.locator('#cp-channel').inputValue(), 'growth'); assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  assert.equal(await page.locator('[data-app-route=coupang][aria-current=page]').count(), 1);
  await page.fill('#cp-vendor', 'A00012345'); await page.fill('#cp-access', 'SYNTHETIC-ACCESS'); await page.fill('#cp-secret', 'SYNTHETIC-SECRET'); await page.locator('#cp-connect button').click();
  await page.waitForFunction(() => !document.getElementById('cp-connection').open);
  assert.equal(await page.locator('#cp-secret').inputValue(), ''); assert.equal(await page.locator('#cp-summary').innerText(), '');
  await page.locator('#cp-sync-growth').click(); await page.locator('#cp-products [data-item-id="123"]').waitFor();
  assert.equal(await page.locator('#cp-products input:checked').count(), 0); assert.equal(await page.locator('[data-injected]').count(), 0);
  assert.match(await page.locator('#cp-products').innerText(), /<img data-injected/);
  await page.locator('[data-item-id="123"]').check(); await page.locator('#cp-save-scope').click();
  await page.locator('#cp-daily button').first().waitFor(); assert.match(await page.locator('#cp-summary').innerText(), /20,000원/);
  assert.match(await page.locator('#cp-missing').innerText(), /미확인/);
  await page.locator('#cp-daily button').first().click(); assert.equal(await page.locator('#cp-cost-productCost').inputValue(), '6000');
  for (const key of ['netSales', 'commission', 'advertising', 'inbound', 'delivery', 'storage', 'returns', 'other']) await page.fill('#cp-cost-' + key, key === 'netSales' ? '19000' : key === 'commission' ? '2000' : '0');
  await page.locator('#cp-cost-form button[type=submit]').click(); assert.equal(posts.filter(p => p.endpoint === 'ledger').length, 0);
  await page.locator('#cp-reviewed').check(); await page.locator('#cp-cost-form button[type=submit]').click();
  await page.waitForFunction(() => document.getElementById('cp-summary').textContent.includes('11,000원'));
  assert.equal(posts.filter(p => p.endpoint === 'ledger').at(-1).body.basis, 'basis-growth');
  await page.selectOption('#cp-channel', 'all'); assert.match(await page.locator('#cp-missing').innerText(), /미확인/);
  assert.ok(!(await page.locator('#cp-summary').innerText()).includes('11,000원'), 'Missing seller costs must not produce a combined profit');
  // Changing editor channel must clear the previous channel's amounts and review.
  await page.selectOption('#cp-cost-channel', 'seller'); assert.equal(await page.locator('#cp-cost-productCost').inputValue(), '');
  assert.equal(await page.locator('#cp-reviewed').isChecked(), false);
  await page.locator('#cp-year').click();
  await page.waitForFunction(() => document.getElementById('cp-history-status').textContent.includes('0/730'));
  const historyPost = posts.filter(p => p.endpoint === 'history').at(-1).body;
  assert.deepEqual(historyPost.channels, ['growth', 'seller']);
  assert.equal((Date.parse(historyPost.until) - Date.parse(historyPost.since)) / 86400000, 364);
  await page.reload(); await page.waitForFunction(() => document.getElementById('cp-identity').textContent.includes('키 저장됨'));
  await page.mouse.move(1200, 500); await page.keyboard.press('Escape');
  assert.equal(await page.locator('#cp-since').inputValue(), historyPost.since);
  assert.equal(posts.filter(p => p.endpoint === 'history').length, 1, 'Reload only checks progress and does not restart collection');
  historyJob = { ...historyJob, status: 'failed', running: false, completedDays: 14, error: '테스트 수집 오류' };
  await page.waitForFunction(() => !document.getElementById('cp-resume').disabled, { timeout: 10000 });
  assert.match(await page.locator('#cp-history-detail').innerText(), /테스트 수집 오류/);
  await page.locator('#cp-resume').click(); await page.waitForFunction(() => document.getElementById('cp-history-status').textContent.includes('수집 중'));
  assert.equal(posts.filter(p => p.endpoint === 'history').at(-1).body.resume, true);
  historyJob = { ...historyJob, status: 'completed', running: false, completedDays: 730, error: null };
  await page.waitForFunction(() => document.getElementById('cp-history-status').textContent.includes('수집 완료'), { timeout: 10000 });
  assert.equal(await page.locator('#cp-resume').isDisabled(), true);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  assert.equal(await page.evaluate(() => JSON.stringify({ ...localStorage }).includes('SYNTHETIC')), false);
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log('PASS Coupang legacy fallback, local guards, brand selection, missing costs, 365-day background history, reload/resume, XSS and mobile width');
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => { await browser?.close(); child?.kill(); fs.rmSync(temp, { recursive: true, force: true }); });
