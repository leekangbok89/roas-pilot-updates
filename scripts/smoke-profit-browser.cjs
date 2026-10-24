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
const knownName = '위마망 브라우저 검증 상품';
const option = '기본';
const scopeOnly = process.argv.includes('--scope-only');
const scopeNames = {
  unknown: 'Wemamang 유리포트 교체품',
  both: '위마망 트루버 공용 부속',
  excluded: '트루버 캠핑 버너',
  cafeUnknown: '브랜드명 없는 카페24 부속'
};
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
      naver[date] = order('naver', date, 300000, 1, date === '2026-08-21' ? knownName : '위마망 원가 미입력 상품');
      snapshot(accountIds.naver, date, 20000);
      snapshot(accountIds.cafe, date, 10000);
      continue;
    }
    const day = Number(date.slice(8));
    if (![3, 5].includes(day)) naver[date] = order('naver', date, day === 4 ? 600000 : 300000, day === 4 ? 2 : 1, day === 8 ? '위마망 원가 미입력 상품' : knownName);
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
function scopeFixture(pattern = false) {
  fs.rmSync(path.join(temp, '.roas-data'), { recursive: true, force: true });
  const naver = {}, cafe = {}, ns = {}, cs = {};
  const range = pattern === 'long' ? dates('2026-08-01', '2026-09-10') : pattern ? dates('2026-10-18', '2026-10-24') : ['2026-09-01'];
  const counts = [2, 3, 4, 1, 4, 2, 0];
  function put(target, channel, date, suffix, revenue, name) {
    const id = channel + '-' + date + '-' + suffix;
    target[id] = { ...order(channel, date, revenue, 1, name), id };
  }
  for (const [index, date] of range.entries()) {
    ns[date] = cs[date] = { checkedAt: '2026-10-24T00:00:00Z' };
    put(naver, 'naver', date, 'known', 300000, knownName);
    put(naver, 'naver', date, 'truver', 900000, scopeNames.excluded);
    const count = pattern === 'long' ? 1 : pattern ? counts[index] : 2;
    for (let i = 0; i < count; i++) {
      put(naver, 'naver', date, 'unknown-' + i, i % 2 ? 50000 : 100000, i % 2 ? scopeNames.both : scopeNames.unknown);
    }
    if (pattern === true && index === 0) put(cafe, 'cafe24', date, 'unknown', 80000, scopeNames.cafeUnknown);
    snapshot(accountIds.naver, date, 20000);
    snapshot(accountIds.cafe, date, 10000);
  }
  write('.roas-data/naver-orders/orders.json', { orders: naver });
  write('.roas-data/naver-orders/sync.json', { days: ns });
  write('.roas-data/cafe24-orders/orders.json', { orders: cafe });
  write('.roas-data/cafe24-orders/sync.json', { days: cs });
  const costs = {};
  for (const [channel, name, cost] of [
    ['naver', knownName, 150000], ['naver', scopeNames.excluded, 100000],
    ['naver', scopeNames.unknown, 40000], ['naver', scopeNames.both, 10000],
    ['cafe24', scopeNames.cafeUnknown, 30000]
  ]) costs[key(channel, name, option)] = { channel, name, option, cost, delivery: 88888 };
  write('.roas-data/product-costs.json', costs);
  write('.roas-data/profit-fees.json', { naver: 7, cafe24: 3.5 });
}
async function startServer() {
  for (const name of ['server.js', 'package.json', 'public', 'vendor']) {
    if (fs.existsSync(path.join(source, name))) fs.cpSync(path.join(source, name), path.join(temp, name), { recursive: true });
  }
  fixture();
  const env = { ...process.env, META_ACCESS_TOKEN: '', META_AD_ACCOUNT_ID: '', OPENAI_API_KEY: '' };
  // Use the application's actual localhost port so browser mutations exercise
  // localPost unchanged, including Origin/Host checks. Never stop an existing server.
  child = spawn(process.execPath, ['-e', "global.fetch=async()=>{throw Error('External network disabled during synthetic verification');};const {server}=require('./server');server.listen(3000,'127.0.0.1',()=>console.log('READY '+server.address().port));"], {
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
    child.on('error', error => { clearTimeout(timeout); reject(error); });
    child.on('exit', code => { if (code) { clearTimeout(timeout); reject(Error('Synthetic HTTP server exited: ' + serverLog)); } });
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
async function scopeAmount(date, expected, partial) {
  const cells = await row(date);
  assert.ok(cells[5].includes(money(expected)), 'Visible confirmed scope profit: ' + cells.join(' | '));
  if (partial) assert.match(cells[6], /부분|확인분/);
  else assert.ok(!/부분|확인분/.test(cells[6]), 'Resolved scope should no longer be partial');
}
async function chooseScope(name, choice) {
  const item = page.locator('#profit-brand-list tr').filter({ hasText: name });
  assert.equal(await item.count(), 1, 'Show one review row for exact ambiguous name');
  page.once('dialog', dialog => dialog.accept());
  const response = page.waitForResponse(res => new URL(res.url()).pathname === '/api/brand-products' && res.request().method() === 'POST');
  await item.locator('[data-brand-choice="' + choice + '"]').click();
  assert.equal((await response).status(), 200, 'Real browser classification POST');
  await page.waitForFunction(name => !Array.from(document.querySelectorAll('#profit-brand-list tr')).some(row => row.textContent.includes(name)), name);
  await idle();
}
async function verifyScope(base, requests) {
  scopeFixture();
  let api = await report(base, '2026-09-01', '2026-09-01');
  let day = api.days[0];
  assert.equal(day.profit, null, 'Unclassified orders must not be silently included in full totals');
  assert.equal(day.confirmed.profit, 99000, 'Known Wemamang totals survive unrelated unclassified sales');
  assert.equal(day.confirmed.revenue, 300000);
  assert.equal(day.confirmed.cost, 150000);
  assert.equal(day.confirmed.fee, 21000);
  assert.equal(day.partial, true);
  assert.deepEqual(new Set(api.pendingProducts.map(x => x.name)), new Set([scopeNames.unknown, scopeNames.both]));
  const products = await (await fetch(base + '/api/costs/products')).json();
  assert.equal(products.items.find(x => x.name === scopeNames.unknown).cost, 40000);
  assert.equal(products.items.find(x => x.name === scopeNames.unknown).scope, 'unclassified', 'Saved cost is not a brand decision');
  assert.equal(products.items.find(x => x.name === scopeNames.excluded).scope, 'excluded', 'Korean Truver remains excluded with a saved cost');
  await range('2026-09-01');
  await page.locator('#chart-window').selectOption('1');
  await scopeAmount('2026-09-01', 99000, true);
  assert.ok((await pointTitles()).some(title => title.includes('99,000원')));
  assert.match(await page.locator('#profit-total').innerText(), /확인분|부분/);
  assert.match(await page.locator('#profit-chart-status').innerText(), /부분/);
  const review = await page.locator('#profit-brand-list').innerText();
  assert.ok(review.includes(scopeNames.unknown) && review.includes(scopeNames.both));
  assert.ok(!review.includes(scopeNames.excluded));
  check('scope: known Wemamang values remain visible as partial; saved costs do not guess brand; Truver is excluded');

  await chooseScope(scopeNames.unknown, 'wemamang');
  await scopeAmount('2026-09-01', 152000, true);
  api = await report(base, '2026-09-01', '2026-09-01');
  assert.equal(api.days[0].confirmed.profit, 152000);
  assert.equal(api.days[0].profit, null);
  assert.equal(api.pendingProducts.length, 1);
  await chooseScope(scopeNames.both, 'excluded');
  await scopeAmount('2026-09-01', 152000, false);
  api = await report(base, '2026-09-01', '2026-09-01');
  assert.equal(api.days[0].profit, 152000);
  assert.equal(api.days[0].complete, true);
  assert.equal(api.pendingProducts.length, 0);
  const savedCosts = JSON.parse(fs.readFileSync(path.join(temp, '.roas-data/product-costs.json'), 'utf8'));
  assert.equal(savedCosts[key('naver', scopeNames.excluded, option)].cost, 100000);
  check('scope: actual include/exclude buttons recalculate 99,000 → 152,000, then resolve full totals without deleting costs');

  scopeFixture('long');
  await range('2026-08-01', '2026-09-10');
  const partialPoints = page.locator('#graph circle[data-metric="profit"]');
  assert.equal(await partialPoints.count(), 41, 'Partial daily values retain markers beyond the old 35-point cutoff');
  const markerFill = await partialPoints.first().getAttribute('fill');
  assert.ok(['#fff', '#ffffff', 'white', 'none'].includes(String(markerFill).toLowerCase()), 'Partial marker is visually hollow');
  assert.ok(await page.locator('#graph path[stroke-dasharray]').count() > 0, 'Partial trend has a visually distinct dashed stroke');
  assert.ok((await pointTitles()).every(title => /부분|확인분/.test(title)), 'Partial point tooltips explicitly identify their scope');
  check('scope: 41 provisional daily values remain visible with hollow markers, dashed lines, and partial labels');

  scopeFixture(true);
  await range('2026-10-18', '2026-10-24');
  api = await report(base, '2026-10-18', '2026-10-24');
  assert.deepEqual(api.days.map(x => x.naver.unclassifiedOrders), [2, 3, 4, 1, 4, 2, 0]);
  assert.equal(api.days[0].cafe24.unclassifiedOrders, 1);
  for (const [index, date] of dates('2026-10-18', '2026-10-24').entries()) await scopeAmount(date, 99000, index < 6);
  assert.equal(await page.locator('#graph circle[data-metric="profit"]').count(), 7);
  assert.ok((await page.locator('#profit-total').innerText()).includes('693,000원'));
  assert.ok((await page.locator('#profit-brand-list').innerText()).includes(scopeNames.cafeUnknown));
  check('scope: reported 7-day unknown-order pattern keeps all known daily figures and lists both-channel names');

  const responsePromise = page.waitForResponse(res => new URL(res.url()).pathname === '/api/data/recent3/refresh' && res.request().method() === 'POST');
  await page.locator('#recent3-refresh').click();
  const started = await responsePromise;
  assert.equal(started.status(), 202);
  const period = await started.json();
  assert.equal((Date.parse(period.until) - Date.parse(period.since)) / 86400000, 2);
  await page.waitForFunction(() => document.getElementById('recent3-refresh').disabled === false, undefined, { timeout: 15000 });
  assert.equal(await page.locator('#since').inputValue(), '2026-10-18');
  assert.equal(await page.locator('#until').inputValue(), '2026-10-24');
  assert.equal(await page.locator('#chart-window').inputValue(), '1');
  const reads = requests.filter(req => new URL(req.url).pathname === '/api/insights');
  assert.ok(reads.length > 0 && reads.every(req => new URL(req.url).searchParams.get('cacheOnly') === '1'));
  assert.ok(!requests.some(req => req.method === 'POST' && /orders\/sync|catalog\/refresh/.test(new URL(req.url).pathname)));
  check('scope: normal reads remain cache-only; explicit recent-3-day action preserves current range and daily display');
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
    localStorage.setItem('roas-custom-chart-presets-v1', JSON.stringify([{ name: '통합 이익 검증', keys: ['profit'], window: 3, scale: 'absolute' }]));
  }, accountIds);
  await context.route('**/*', route => route.request().url().startsWith(base + '/') ? route.continue() : route.abort());
  page = await context.newPage();
  const pageErrors = [];
  const requests = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('request', request => requests.push({ url: request.url(), method: request.method() }));
  await page.goto(base + '/visual-overview.html');
  await idle();
  assert.equal(await page.locator('#chart-window').inputValue(),'1','Page load defaults to daily raw regardless of saved 3-day preset');
  if (!scopeOnly) {
  await page.locator('#custom-preset-buttons button').first().click();
  assert.equal(await page.locator('#chart-window').inputValue(),'1','Clicking saved preset never switches to 3-day automatically');
  await page.locator('#chart-window').selectOption('3');
  assert.equal(await page.locator('#chart-window').inputValue(),'3','3-day average applies when explicitly selected');
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
  }

  await verifyScope(base, requests);

  assert.deepEqual(pageErrors, [], 'Browser JavaScript errors');
  if (process.env.ROAS_PROFIT_SCREENSHOT) {
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

