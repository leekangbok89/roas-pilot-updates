'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require(process.env.ROAS_PLAYWRIGHT_MODULE || 'playwright');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'roas-growth-mode-'));
let child, browser;
async function main() {
  // Navigation and growth assets must work from embedded fallbacks when an
  // old updater omits those files, with no saved business data.
  fs.copyFileSync(path.resolve(__dirname, '../server.js'), path.join(temp, 'server.js'));
  fs.cpSync(path.resolve(__dirname, '../public'), path.join(temp, 'public'), { recursive: true });
  for (const name of fs.readdirSync(path.join(temp, 'public'))) {
    if (name.startsWith('coupang') || name.startsWith('app-shell.') || name === 'growth-mode.css') fs.rmSync(path.join(temp, 'public', name));
  }
  child = spawn(process.execPath, ['-e', "global.fetch=async()=>{throw Error('External traffic disabled');};const s=require('./server').server;s.listen(0,'127.0.0.1',()=>console.log('READY:'+s.address().port));"], { cwd: temp, env: { ...process.env, WEB_PASSWORD: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const port = await new Promise((resolve, reject) => {
    let log = ''; const timer = setTimeout(() => reject(Error(log || 'server start timeout')), 10000);
    child.stdout.on('data', b => { log += b; const match = log.match(/READY:(\d+)/); if (match) { clearTimeout(timer); resolve(Number(match[1])); } });
    child.on('error', reject);
  });
  const base = 'http://127.0.0.1:' + port;
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
  const context = await browser.newContext({ viewport: { width: 1366, height: 1000 }, timezoneId: 'Asia/Seoul' });
  const page = await context.newPage(), errors = [], reads = [], writes = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', req => { const url = new URL(req.url()); if (url.pathname.startsWith('/api/')) { reads.push(url.pathname); if (req.method() !== 'GET') writes.push(url.pathname); } });
  await page.goto(base + '/coupang-dashboard.html');
  await page.waitForSelector('.growth-header');
  await page.evaluate(() => {
    localStorage.setItem('roas-pilot-theme', 'dark');
    localStorage.setItem('roas-growth-mode-test', 'preserved');
    localStorage.setItem('roas-coupang-analytics-columns', JSON.stringify(['sales', 'quantity']));
  });
  const pages = ['/coupang-dashboard.html', '/coupang-products.html', '/coupang-sales.html', '/coupang-ads.html', '/coupang.html'];
  for (const route of pages) {
    reads.length = 0;
    await page.goto(base + route); await page.waitForSelector('.growth-header');
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
    assert.equal(await page.locator('body').getAttribute('data-workspace'), 'sellha');
    assert.equal(await page.locator('#app-drawer, #app-nav-rail, .ca-subnav').count(), 0);
    assert.equal(new URL(await page.locator('.growth-navigation a[aria-current]').getAttribute('href'),base).pathname, route);
    assert.equal(await page.evaluate(() => localStorage.getItem('roas-pilot-theme')), 'dark');
    assert.equal(await page.evaluate(() => localStorage.getItem('roas-growth-mode-test')), 'preserved');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    assert.ok(reads.every(url => url.startsWith('/api/coupang/')), 'Growth must not fetch Naver/Meta reports: ' + reads.join(','));
    if (process.env.ROAS_GROWTH_SCREENSHOT_DIR) {
      fs.mkdirSync(process.env.ROAS_GROWTH_SCREENSHOT_DIR, { recursive: true });
      await page.screenshot({ path: path.join(process.env.ROAS_GROWTH_SCREENSHOT_DIR, path.basename(route, '.html') + '.png') });
    }
  }
  await page.goto(base + '/coupang-dashboard.html?since=2026-10-22&until=2026-10-28&channel=all&group=sample');
  await page.waitForSelector('.growth-header');
  for(const link of await page.locator('.growth-navigation a').all()){
    const target=new URL(await link.getAttribute('href'),base);
    if(target.pathname==='/daily-monitoring.html'){assert.equal(target.search,'');continue;}
    assert.equal(target.searchParams.get('since'),'2026-10-22');
    assert.equal(target.searchParams.get('until'),'2026-10-28');
    assert.equal(target.searchParams.get('channel'),'all');
    assert.equal(target.searchParams.get('group'),'sample');
  }
  await page.goto(base + '/coupang-products.html#cpm-groups-title');
  assert.equal(await page.locator('.growth-navigation a[aria-current]').textContent(), '그룹 관리');
  await page.locator('.growth-navigation a').filter({ hasText: '상품 리스트' }).click();
  assert.equal(await page.locator('.growth-navigation a[aria-current]').textContent(), '상품 리스트');
  await page.goto(base + '/coupang.html#cp-catalog');
  assert.equal(await page.locator('.growth-navigation a[aria-current]').textContent(), '자료·연결 관리');
  await page.locator('.growth-return').click(); await page.waitForSelector('.app-mode-entry');
  assert.equal(await page.locator('html').getAttribute('data-workspace'), 'naver');
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  assert.equal(await page.locator('#app-nav-rail').count(), 1);
  assert.equal(await page.locator('.growth-header').count(), 0);
  assert.equal(await page.locator('.app-mode-entry').getAttribute('href'), '/coupang-dashboard.html');
  await page.locator('.app-mode-entry').click(); await page.waitForSelector('.growth-header');
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
  assert.equal(await page.evaluate(() => localStorage.getItem('roas-pilot-theme')), 'dark');
  // Both directions and direct links retain their workspace on Back / Forward.
  await page.goBack(); await page.waitForSelector('.app-mode-entry');
  await page.goForward(); await page.waitForSelector('.growth-header');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  assert.equal(await page.locator('.growth-return').isVisible(), true);
  assert.deepEqual(writes, [], 'Switching modes must not write or collect business data');
  assert.deepEqual(errors, []);
  console.log('PASS separate growth navigation, all five pages, independent theme, unchanged saved settings, API isolation, mobile, history and legacy updater fallbacks');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { await browser?.close(); child?.kill('SIGTERM'); fs.rmSync(temp, { recursive: true, force: true }); });
