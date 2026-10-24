'use strict';

// Explicit integration check: node scripts/smoke-profit-browser.cjs
// Install Playwright separately; application runtime dependencies stay unchanged.
// All business data and the HTTP server live in a disposable application copy.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const source = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'roas-profit-browser-'));
const accountIds = { naver: '111111', cafe: '222222' };
const knownName = '브라우저 검증 상품';
const option = '기본';
const money = value => new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 }).format(value) + '원';
let child;
let browser;
let page;
let serverLog = '';
let checks = 0;

function check(name) {
  checks += 1;
  console.log('PASS ' + name);
}
function write(relative, data) {
  const dest = path.join(temp, relative);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, JSON.stringify(data));
}
function dates(first, last) {
  const result = [];
  for (let t = Date.parse(first + 'T00:00:00Z'); t <= Date.parse(last + 'T00:00:00Z'); t += 86400000) {
    result.push(new Date(t).toISOString().slice(0, 10));
  }
  return result;
}
function key(channel, name, variant) {
  return crypto.createHash('sha256').update(JSON.stringify([channel, name, variant])).digest('hex').slice(0, 24);
}
function order(channel, date, revenue, quantity = 1, name = knownName) {
  return {
    id: channel + '-' + date,
    ...(channel === 'naver' ? { paymentDate: date } : { date }),
    status: 'DELIVERED', unverified: false, gross: revenue, net: revenue, refund: 0,
    items: [{ name, option, quantity }]
  };
}
function snapshot(account, date, spend) {
  write('.roas-data/daily/' + account + '/' + date + '.json', {
    account, date, currency: spend ? 'KRW' : '', savedAt: '2026-10-01T00:00:00Z',
    rows: spend ? [{ date_start: date, date_stop: date, account_currency: 'KRW', spend: String(spend),
      impressions: '1000', inline_link_clicks: '10', actions: date === '2026-09-01' ? [] : [{ action_type: 'purchase', value: '1' }],
      action_values: date === '2026-09-01' ? [] : [{ action_type: 'purchase', value: '300000' }] }] : []
  });
}
function fixture(isolated = false) {
  fs.rmSync(path.join(temp, '.roas-data'), { recursive: true, force: true });
  const naver = {}, cafe = {}, ns = {}, cs = {};
  const range = isolated ? dates('2026-08-01', '2026-09-10') : dates('2026-09-01', '2026-09-10');
  for (const date of range) {
    ns[date] = { checkedAt: '2026-10-01T00:00:00Z' };
    cs[date] = { checkedAt: '2026-10-01T00:00:00Z' };
    if (isolated) {
      naver[date] = order('naver', date, 300000, 1, date === '2026-08-21' ? knownName : '원가 미입력 상품');
      snapshot(accountIds.naver, date, 20000);
      snapshot(accountIds.cafe, date, 10000);
      continue;
    }
    const day = Number(date.slice(8));
    if (![3, 5].includes(day)) naver[date] = order('naver', date, day === 4 ? 600000 : 300000, day === 4 ? 2 : 1, day === 8 ? '원가 미입력 상품' : knownName);
    if (day === 4) cafe[date] = order('cafe24', date, 200000, 2);
    snapshot(accountIds.naver, date, [2, 5].includes(day) ? 0 : 20000);
    if (day !== 9) snapshot(accountIds.cafe, date, [2, 5].includes(day) ? 0 : 10000);
    if (day === 10) delete cs[date];
  }
  write('.roas-data/naver-orders/orders.json', { orders: naver });
  write('.roas-data/naver-orders/sync.json', { days: ns });
  write('.roas-data/cafe24-orders/orders.json', { orders: cafe });
  write('.roas-data/cafe24-orders/sync.json', { days: cs });
  write('.roas-data/product-costs.json', {
    [key('naver', knownName, option)]: { channel: 'naver', name: knownName, option, cost: 150000, delivery: 88888 },
    [key('cafe24', knownName, option)]: { channel: 'cafe24', name: knownName, option, cost: 50000, delivery: 99999 }
  });
  write('.roas-data/profit-fees.json', { naver: 7, cafe24: 3.5 });
}
async function startServer() {
  for (const name of ['server.js', 'package.json', 'public', 'vendor']) {
    if (fs.existsSync(path.join(source, name))) fs.cpSync(path.join(source, name), path.join(temp, name), { recursive: true });
  }
  fixture();
  const env = { ...process.env, META_ACCESS_TOKEN: '', META_AD_ACCOUNT_ID: '', OPENAI_API_KEY: '' };
  child = spawn(process.execPath, ['-e', "global.fetch=async()=>{throw Error('External network disabled during synthetic verification');};const {server}=require('./server');server.listen(0,'127.0.0.1',()=>console.log('READY '+server.address().port));"], {
    cwd: temp, env, stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', data => { serverLog += data; });
  child.stderr.on('data', data => { serverLog += data; });
  const port = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error('Synthetic HTTP server did not start: ' + serverLog)), 10000);
    child.stdout.on('data', data => {
      const match = String(data).match(/READY (\d+)/);
      if (match) { clearTimeout(timeout); resolve(Number(match[1])); }
    });
    child.on('error', reject);
    child.on('exit', code => { if (code) reject(Error('Synthetic HTTP server exited: ' + serverLog)); });
  });
  return 'http://127.0.0.1:' + port;
}
async function report(base, since, until, accounts = Object.values(accountIds)) {
  const params = new URLSearchParams({ since, until, accounts: accounts.join(','), fx: '1350' });
  const response = await fetch(base + '/api/profit/daily?' + params);
  assert.equal(response.status, 200);
  return response.json();
}
async function idle() {
  await page.waitForFunction(() => document.getElementById('reload')?.disabled === false);
}
async function range(since, until = since) {
  await idle();
  // The date picker exposes readonly text inputs. Set the selected fixture dates,
  // then use the real refresh button and actual HTTP pipeline.
  await page.evaluate(({ since, until }) => {
    document.getElementById('since').value = since;
    document.getElementById('until').value = until;
  }, { since, until });
  await page.locator('#reload').click();
  await idle();
}
async function row(date) {
  const rows = await page.locator('#profit-table tbody tr').evaluateAll(nodes => nodes.map(node => Array.from(node.cells, cell => cell.textContent)));
  const found = rows.find(cells => cells[0] === date);
  assert.ok(found, 'Profit table is missing ' + date);
  return found;
}
async function amount(date, expected) {
  const cells = await row(date);
  assert.equal(cells[5], money(expected), 'Rendered profit for ' + date);
}
async function pointTitles() {
  return page.locator('#graph circle[data-metric="profit"] title').allTextContents();
}

(async () => {
  const base = await startServer();
  const data = await report(base, '2026-09-01', '2026-09-10');
  const byDate = new Map(data.days.map(day => [day.date, day]));
  const expected = [99000, 129000, -30000, 321000, 0, 99000, 99000];
  expected.forEach((value, i) => assert.equal(byDate.get('2026-09-0' + (i + 1)).profit, value));
  assert.equal(byDate.get('2026-09-04').cost, 400000, 'Costs use sold quantity and exclude saved delivery charges');
  assert.equal(byDate.get('2026-09-04').fee, 49000, 'Each channel uses its own rate');
  assert.equal(byDate.get('2026-09-02').adSpend, 0, 'Empty cached account-day confirms zero spend');
  for (const date of ['2026-09-08', '2026-09-09', '2026-09-10']) assert.equal(byDate.get(date).profit, null);
  check('real HTTP: fee + quantity formula; verified zero sales/spend; negative profit; unknown costs/ads/orders remain null');
  const duplicate = await report(base, '2026-09-01', '2026-09-01', [accountIds.naver, accountIds.naver]);
  assert.equal(duplicate.days[0].profit, 109000);
  check('real HTTP: duplicate account IDs deduct spend once');
  if (process.argv.includes('--api-only')) {
    console.log('API-only verification passed; browser checks were explicitly skipped.');
    return;
  }

  const { chromium } = require(process.env.ROAS_PLAYWRIGHT_MODULE || 'playwright');
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  await context.addInitScript(ids => {
    localStorage.setItem('roas-account-ids', JSON.stringify(ids));
    localStorage.setItem('roas-custom-chart-presets-v1', JSON.stringify([{ name: '통합 이익 검증', keys: ['profit'], window: 1, scale: 'absolute' }]));
  }, accountIds);
  await context.route('**/*', route => route.request().url().startsWith(base + '/') ? route.continue() : route.abort());
  page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(base + '/visual-overview.html');
  await idle();
  await range('2026-09-01', '2026-09-07');
  await page.locator('#chart-window').selectOption('1');
  for (let i = 0; i < expected.length; i++) await amount('2026-09-0' + (i + 1), expected[i]);
  assert.equal(await page.locator('#profit-total').innerText(), money(717000));
  assert.equal(await page.locator('#graph path[data-metric="profit"]').count(), 1);
  assert.equal((await pointTitles()).length, 7);
  assert.ok((await pointTitles()).some(text => text.includes('-30,000원')));
  assert.ok((await pointTitles()).some(text => text.endsWith(': 0원')));
  check('browser: actual API values match table, total, positive/negative/zero SVG points');
  await range('2026-09-01');
  assert.equal(await page.locator('#revenue').innerText(), '—', 'Meta purchase attribution is absent');
  await amount('2026-09-01', 99000);
  assert.equal(await page.locator('#profit-total').innerText(), money(99000));
  assert.ok((await pointTitles()).some(title => title.includes('99,000원')));
  await page.locator('#profit-troubleshooting').evaluate(el => { el.open = true; });
  assert.ok((await page.locator('#profit-troubleshooting-body').innerText()).includes('Meta 구매 전환매출과 무관'));
  check('browser: actual store profit graph works with zero Meta purchase conversions');
  await range('2026-09-01', '2026-09-07');

  for (const channel of ['naver', 'cafe', 'all']) {
    await page.locator('#channel').selectOption(channel);
    await idle();
    assert.equal(await page.locator('#profit-total').innerText(), money(717000));
    await amount('2026-09-01', 99000);
  }
  check('browser: integrated profit stays invariant across all channel filters');

  await range('2026-09-02', '2026-09-07');
  for (const [window, values] of [['3', [49500, 140000, 99000]], ['5', [105000, 99000]], ['7', [103000]]]) {
    await page.locator('#chart-window').selectOption(window);
    const titles = await pointTitles();
    assert.equal(titles.length, values.length, window + '-day clipped point count');
    values.forEach((value, i) => assert.ok(titles[i].endsWith(': ' + money(value)), window + '-day mean: ' + titles[i]));
    await page.locator('#graph circle[data-metric="profit"]').first().hover({ force: true });
    assert.ok((await page.locator('#roas-chart-hover').innerText()).includes(money(values[0])));
  }
  check('browser: nonoverlapping 3/5/7-day averages clip range edges and match hover values');

  for (const [date, reason] of [['2026-09-08', '원가'], ['2026-09-09', '광고비'], ['2026-09-10', '수집']]) {
    await range(date);
    await page.locator('#chart-window').selectOption('1');
    const cells = await row(date);
    assert.equal(cells[5], '미확정');
    assert.ok(cells[6].includes(reason));
    assert.equal(await page.locator('#graph circle[data-metric="profit"]').count(), 0);
    assert.ok((await page.locator('#profit-chart-status').innerText()).length > 0);
  }
  check('browser: missing costs/ads/orders show reasons and never appear as zero profit');

  await page.evaluate(id => localStorage.setItem('roas-account-ids', JSON.stringify({ naver: id, cafe: id })), accountIds.naver);
  await range('2026-09-01');
  await amount('2026-09-01', 109000);
  assert.equal(await page.locator('#spend').innerText(), money(20000));
  check('browser: duplicate account mapping does not double count total spend or profit');
  await page.evaluate(ids => localStorage.setItem('roas-account-ids', JSON.stringify(ids)), accountIds);

  fixture(true);
  await range('2026-08-01', '2026-09-10');
  await page.locator('#chart-window').selectOption('1');
  assert.equal(await page.locator('#profit-table tbody tr').count(), 41);
  assert.equal(await page.locator('#graph circle[data-metric="profit"]').count(), 1);
  assert.equal(await page.locator('#graph circle[data-metric="profit"]').first().getAttribute('data-point-date'), '2026-08-21');
  assert.ok((await pointTitles())[0].includes('99,000원'));
  await page.locator('#graph circle[data-metric="profit"]').hover({ force: true });
  assert.ok((await page.locator('#roas-chart-hover').innerText()).includes('99,000원'));
  check('browser: isolated valid profit remains visible across more than 35 daily points');

  assert.deepEqual(pageErrors, [], 'Browser JavaScript errors');
  if (process.env.ROAS_PROFIT_SCREENSHOT) {
    fixture();
    await range('2026-09-01', '2026-09-07');
    await page.screenshot({ path: process.env.ROAS_PROFIT_SCREENSHOT, fullPage: true });
  }
  console.log('Profit integration verification passed: ' + checks + ' checks, no browser JavaScript errors.');
})().catch(async error => {
  console.error('FAIL ' + error.stack);
  if (page) {
    console.error(JSON.stringify(await page.evaluate(() => ({ status: document.getElementById('updated')?.textContent, alert: document.getElementById('alert')?.textContent, profit: document.getElementById('profit-status')?.textContent, chart: document.getElementById('profit-chart-status')?.textContent })).catch(() => ({}))));
  }
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close();
  if (child && child.exitCode === null) child.kill('SIGTERM');
  fs.rmSync(temp, { recursive: true, force: true });
});
