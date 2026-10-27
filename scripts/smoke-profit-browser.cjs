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

function connection(key) {
  return page.locator('#summary-connections-list [data-connection-key="' + key + '"]');
}
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
function roasSpendFixture(sameDay = false, unknownRevenue = false) {
  fixture();
  const since = sameDay ? '2026-09-04' : '2026-09-03', until = '2026-09-04';
  const adRow = (date, id, spend, revenue) => ({
    date_start: date, date_stop: date, ad_id: id, ad_name: 'Synthetic ROAS ' + id,
    account_currency: 'KRW', spend: String(spend), impressions: '1000', inline_link_clicks: '10',
    actions: revenue == null ? [] : [{ action_type: 'purchase', value: '1' }],
    action_values: revenue == null ? [] : [{ action_type: 'purchase', value: String(revenue) }]
  });
  for (const account of Object.values(accountIds)) {
    const save = (date, rows) => write('.roas-data/daily/' + account + '/' + date + '.json', {
      account, date, currency: 'KRW', savedAt: '2026-10-01T00:00:00Z', rows
    });
    const known = adRow(until, 'confirmed-purchase', 10, unknownRevenue ? null : 600);
    const unknown = adRow(since, 'unknown-purchase', 990, null);
    if (sameDay) save(until, [known, unknown]);
    else {
      save(since, [unknown]);
      save(until, [known]);
    }
  }
  return { since, until };
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
function historyFixture() {
  fs.rmSync(path.join(temp, '.roas-data'), { recursive: true, force: true });
  const naver = {}, cafe = {}, synced = {};
  for (const date of dates('2026-09-01', '2026-09-30')) {
    synced[date] = { checkedAt: '2026-10-24T00:00:00Z' };
    snapshot(accountIds.naver, date, date === '2026-09-15' ? 20000 : 0);
    snapshot(accountIds.cafe, date, date === '2026-09-15' ? 10000 : 0);
  }
  for (const date of ['2026-08-31', '2026-09-15', '2026-10-01']) {
    for (const [channel, target, revenue] of [['naver', naver, 300000], ['cafe24', cafe, 200000]]) {
      const value = { ...order(channel, date, revenue), items: [] };
      target[value.id] = value;
    }
  }
  write('.roas-data/naver-orders/orders.json', { orders: naver });
  write('.roas-data/naver-orders/sync.json', { days: synced });
  write('.roas-data/cafe24-orders/orders.json', { orders: cafe });
  write('.roas-data/cafe24-orders/sync.json', { days: synced });
  write('.roas-data/product-costs.json', {
    [key('naver', knownName, option)]: { channel: 'naver', name: knownName, option, cost: 150000 },
    [key('cafe24', knownName, option)]: { channel: 'cafe24', name: knownName, option, cost: 50000 }
  });
  write('.roas-data/profit-fees.json', { naver: 7, cafe24: 3.5 });
  // This opt-in marker exists only in the disposable fixture directory.
  write('.roas-data/browser-repair-fixture.json', { name: knownName, option });
  return { naver, cafe24: cafe };
}
function cafeRevenueRecoveryFixture(config = {}) {
  fixture();
  const selected = { since: '2026-09-03', until: '2026-09-04' };
  const cafe = {}, sync = {};
  for (const date of ['2026-08-31', '2026-10-01']) {
    const value = order('cafe24', date, 400000);
    cafe[value.id] = value;
    sync[date] = { checkedAt: '2026-10-24T00:00:00Z', count: 1 };
  }
  for (const date of dates(selected.since, selected.until)) {
    // A successful sync marker must not prevent a forced order-list re-fetch.
    // The missing headers cannot be recovered by the old detail-only action.
    sync[date] = { checkedAt: '2026-10-24T00:00:00Z', count: 1 };
  }
  write('.roas-data/cafe24-orders/orders.json', { orders: cafe });
  write('.roas-data/cafe24-orders/sync.json', { days: sync });
  const read = relative => JSON.parse(fs.readFileSync(path.join(temp, '.roas-data', relative), 'utf8'));
  const naverOrders = read('naver-orders/orders.json'), naverSync = read('naver-orders/sync.json');
  const octoberOrder = order('naver', '2026-10-01', 300000);
  naverOrders.orders[octoberOrder.id] = octoberOrder;
  naverSync.days['2026-10-01'] = { checkedAt: '2026-10-24T00:00:00Z', count: 1 };
  write('.roas-data/naver-orders/orders.json', naverOrders);
  write('.roas-data/naver-orders/sync.json', naverSync);
  snapshot(accountIds.naver, '2026-10-01', 20000);
  snapshot(accountIds.cafe, '2026-10-01', 10000);
  write('.roas-data/browser-cafe-recovery-fixture.json', { name: knownName, option, ...config });
  return { selected, outsideOrders: cafe };
}
function serverBootstrap() {
  const fs = require('node:fs');
  const path = require('node:path');
  global.fetch = async () => { throw Error('External network disabled during synthetic verification'); };
  const app = require('./server');
  const data = path.join(process.cwd(), '.roas-data');
  const marker = path.join(data, 'browser-repair-fixture.json');
  const actualRunner = app.enrichCostCatalog;
  // The setter is appended only to this disposable copy. The real POST route,
  // range validation, concurrency guards, and localPost checks stay unchanged.
  app.__setCatalogRunner(range => {
      if (!fs.existsSync(marker)) return actualRunner(range);
      const config = JSON.parse(fs.readFileSync(marker, 'utf8'));
      const calls = { body: range, naverIds: [], cafeIds: [], cafeEndpoints: [] };
      const record = () => {
        const dest = path.join(data, 'browser-repair-calls.json');
        fs.writeFileSync(dest + '.tmp', JSON.stringify(calls));
        fs.renameSync(dest + '.tmp', dest);
      };
      const released = async channel => {
        const release = path.join(data, 'browser-' + channel + '-release.json');
        const deadline = Date.now() + 20000;
        while (!fs.existsSync(release)) {
          if (Date.now() > deadline) throw Error('Synthetic ' + channel + ' response was not released');
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      };
      record();
      return actualRunner(range, {
        naverCredentials: () => ({ synthetic: true }),
        naverToken: async () => ({ token: 'synthetic-only' }),
        naverDetails: async ids => {
          calls.naverIds.push(...ids);record();
          await released('naver');
          throw Error('Synthetic Naver upstream failure');
        },
        cafeCredentials: () => ({ tokens: { access_token: 'synthetic-only' } }),
        cafeItems: async (order, diagnose) => {
          calls.cafeIds.push(order.id);record();
          await released('cafe');
          return app.cafeOrderItems(order, async endpoint => {
            calls.cafeEndpoints.push(endpoint);record();
            // Exercise the real fallback and parser used for older cached orders.
            if (endpoint.includes('/items?')) return { items: [] };
            return { order: { items: [{ product_name_default: config.name, option_value_default: config.option, quantity: 1 }] } };
          }, diagnose);
        },
        delay: async () => {}
      }).catch(error => { calls.error = error.message;record();throw error; });
  });
  const actualCafeRecovery = app.cafeRecoverOrders;
  app.__setCafeRecoveryRunner(range => {
    const marker = path.join(data, 'browser-cafe-recovery-fixture.json');
    if (!fs.existsSync(marker)) return actualCafeRecovery(range);
    const config = JSON.parse(fs.readFileSync(marker, 'utf8'));
    const calls = { body: range, dates: [], itemIds: [] };
    const record = () => {
      const dest = path.join(data, 'browser-cafe-recovery-calls.json');
      fs.writeFileSync(dest + '.tmp', JSON.stringify(calls));
      fs.renameSync(dest + '.tmp', dest);
    };
    record();
    return actualCafeRecovery(range, {
      credentials: () => config.authMissing ? null : { tokens: { access_token: 'synthetic-only' } },
      fetchDate: async date => {
        calls.dates.push(date);record();
        if (config.gated) {
          const release = path.join(data, 'browser-cafe-recovery-release-' + date + '.json');
          const deadline = Date.now() + 30000;
          while (!fs.existsSync(release)) {
            if (Date.now() > deadline) throw Error('Synthetic Cafe response was not released');
            await new Promise(resolve => setTimeout(resolve, 50));
          }
        }
        if ((config.failedDates || []).includes(date)) throw Error('Synthetic Cafe HTTP 503');
        const amount = date === '2026-09-03' ? '100000' : '200000';
        return [{ order_id: 'qa-cafe-recovered-' + date, payment_date: date + ' 10:00:00', paid: 'T',
          initial_order_amount: { payment_amount: amount }, actual_order_amount: { payment_amount: amount } }];
      },
      orderItems: async order => {
        calls.itemIds.push(order.id);record();
        if ((config.missingItemDates || []).some(date => order.id.endsWith(date))) return [];
        return [{ name: config.name, option: config.option, quantity: 1 }];
      },
      delay: async () => {}
    }).catch(error => { calls.error = error.message;record();throw error; });
  });
  app.server.listen(3000, '127.0.0.1', () => console.log('READY ' + app.server.address().port));
}
async function startServer() {
  for (const name of ['server.js', 'package.json', 'public', 'vendor']) {
    if (fs.existsSync(path.join(source, name))) fs.cpSync(path.join(source, name), path.join(temp, name), { recursive: true });
  }
  fs.appendFileSync(path.join(temp, 'server.js'), '\nmodule.exports.__setCatalogRunner=fn=>{enrichCostCatalog=fn;};\nmodule.exports.__setCafeRecoveryRunner=fn=>{cafeRecoverOrders=fn;};\n');
  fixture();
  const env = { ...process.env, META_ACCESS_TOKEN: '', META_AD_ACCOUNT_ID: '', OPENAI_API_KEY: '' };
  // Use the application's actual localhost port so browser mutations exercise
  // localPost unchanged, including Origin/Host checks. Never stop an existing server.
  child = spawn(process.execPath, ['-e', '(' + serverBootstrap.toString() + ')()'], {
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
  const summary=page.locator('#summary-cards');
  if(await summary.count() && !(await summary.evaluate(node=>node.classList.contains('summary-expanded')))){
    await page.evaluate(()=>{summaryDetailsExpanded=true;renderSummaryCards();});
  }
}
async function openDetails(selector, content) {
  const panel = page.locator(selector);
  assert.equal(await panel.count(), 1, 'One details panel exists: ' + selector);
  assert.equal(await panel.evaluate(node => node.tagName), 'DETAILS');
  if (!(await panel.evaluate(node => node.open))) await panel.locator(':scope > summary').click();
  assert.equal(await panel.evaluate(node => node.open), true, 'A real summary click opens ' + selector);
  await page.locator(content).waitFor({ state: 'visible' });
}
async function verifyOverviewFolds(requests) {
  const panels = [
    ['details.fold-panel:has(#channels)', '#channels'],
    ['details.fold-panel:has(#daily)', '#daily'],
    ['#profit-panel', '#profit-save-fees'],
    ['#budget-efficiency', '#budget-step'],
    ['#collection-status-panel', '#cafe-revenue-recover']
  ];
  assert.equal(await page.locator('details.fold-panel').count(), 5, 'The five secondary overview panels use native details');
  assert.equal(await page.locator('#ai-strategy,#ai-form,#ai-key,#ai-question,#ai-submit').count(), 0, 'Removed AI controls are absent rather than hidden');
  assert.equal(await page.getByText('AI 전략 회의실', { exact: true }).count(), 0);
  for (const [selector, content] of panels) {
    assert.equal(await page.locator(selector).evaluate(node => node.open), false, selector + ' starts closed');
    assert.equal(await page.locator(selector + ' > summary').isVisible(), true, 'Closed panels retain visible interactive summaries');
    assert.equal(await page.locator(content).isVisible(), false, 'Closed panel content is actually hidden: ' + content);
  }
  for (const [index, [selector, content]] of panels.entries()) {
    const panel = page.locator(selector), summary = panel.locator(':scope > summary');
    if (index % 2) { await summary.focus(); await page.keyboard.press('Enter'); }
    else await summary.click();
    assert.equal(await panel.evaluate(node => node.open), true, 'Mouse/keyboard opens the native panel');
    await page.locator(content).waitFor({ state: 'visible' });
    if (index % 2) { await summary.focus(); await page.keyboard.press('Enter'); }
    else await summary.click();
    assert.equal(await panel.evaluate(node => node.open), false, 'Mouse/keyboard closes the native panel');
    assert.equal(await page.locator(content).isVisible(), false);
  }
  assert.deepEqual(requests.filter(req => new URL(req.url).pathname.startsWith('/api/ai')), [], 'The removed AI workspace makes no startup API requests');
  check('overview: four panels start closed with hidden content, real clicks/Enter toggle them, and removed AI controls make no requests');
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
  await openDetails('#profit-panel', '#profit-table');
  const rows = await page.locator('#profit-table tbody tr').evaluateAll(nodes => nodes.map(node => Array.from(node.cells, cell => cell.textContent)));
  const index = rows.findIndex(cells => cells[0] === date);
  assert.ok(index >= 0, 'Profit table is missing ' + date);
  assert.equal(await page.locator('#profit-table tbody tr').nth(index).isVisible(), true, 'Verified profit rows must be visible after opening the panel');
  return rows[index];
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
  await openDetails('#profit-panel', '#profit-brand-list');
  const item = page.locator('#profit-brand-list tr').filter({ hasText: name });
  assert.equal(await item.count(), 1, 'Show one review row for exact ambiguous name');
  assert.equal(await item.isVisible(), true, 'Brand classification is performed on a visible review row');
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
  assert.equal(await page.locator('#profit-chart-status').isVisible(), false);
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
  await page.locator('#refresh-period-menu > summary').click();
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
async function verifyHistoryRepair(base, requests) {
  const before = historyFixture();
  const selected = { since: '2026-09-01', until: '2026-09-30' };
  const requestStart = requests.length;
  const read = relative => JSON.parse(fs.readFileSync(path.join(temp, '.roas-data', relative), 'utf8'));
  const diagnostic = async () => (await (await fetch(base + '/api/costs/catalog/diagnostics')).json()).job;
  const coverage = async () => {
    const params = new URLSearchParams({ ...selected, accounts: Object.values(accountIds).join(','), fx: '1350' });
    const response = await fetch(base + '/api/data/coverage?' + params);
    assert.equal(response.status, 200);
    return response.json();
  };
  await range(selected.since, selected.until);
  await page.locator('#chart-window').selectOption('1');
  assert.equal(await page.locator('#collection-status-panel').evaluate(node => node.open), false);
  await page.locator('#collection-status-panel > summary').click();
  await page.locator('#coverage-details > summary').click();
  assert.equal((await row('2026-09-15'))[5], '미확정', 'Stored payments without items must not become zero sales or a guessed loss');
  assert.equal(await page.locator('#graph circle[data-metric="profit"][data-point-date="2026-09-15"]').count(), 0);
  let current = await coverage();
  for (const channel of ['naver', 'cafe24']) {
    assert.equal(current.sources[channel].storedDays, 30);
    assert.equal(current.sources[channel].positiveOrders, 1);
    assert.equal(current.sources[channel].missingItemOrders, 1);
    assert.deepEqual(current.sources[channel].missingItemDates, [{ date: '2026-09-15', count: 1 }]);
    assert.deepEqual(current.sources[channel].missingDays, []);
  }
  assert.match(await page.locator('#coverage-table').innerText(), /상품 상세 미연결 1건/);
  assert.match(await page.locator('#coverage-table').innerText(), /매출이 0원이라는 뜻이 아닙니다/);
  const statusRead = page.waitForResponse(res => new URL(res.url()).pathname === '/api/costs/catalog/diagnostics');
  await page.locator('#history-repair-status-check').click();
  assert.equal((await statusRead).request().method(), 'GET');
  assert.ok(!requests.slice(requestStart).some(req => req.method === 'POST'), 'Loading coverage and checking progress must not start collection');

  const startedPromise = page.waitForResponse(res => new URL(res.url()).pathname === '/api/costs/catalog/refresh' && res.request().method() === 'POST');
  await page.locator('#history-repair').click();
  const started = await startedPromise;
  assert.equal(started.status(), 202, 'Use the real production POST route and localhost authorization');
  assert.deepEqual(started.request().postDataJSON(), selected, 'Explicit repair sends exactly the selected September dates');
  let job = await diagnostic();
  assert.equal(job.running, true);
  assert.equal(job.total, 2);
  for (const channel of ['naver', 'cafe24']) {
    assert.equal(job.sources[channel].total, 1);
    assert.equal(job.sources[channel].checked, 0);
    assert.equal(job.sources[channel].remaining, 1, 'Unattempted work is initialized as remaining work');
  }
  await page.waitForFunction(() => ['naver', 'cafe24'].every(channel => {
    const cells = document.querySelector('[data-repair-source="' + channel + '"]')?.cells;
    return cells?.[2]?.textContent === '0 / 1건' && cells?.[4]?.textContent === '1건';
  }));
  check('history: September coverage distinguishes stored payments from missing items; explicit repair posts the chosen range with truthful initial counts');

  write('.roas-data/browser-cafe-release.json', { release: true });
  await page.waitForFunction(() => Array.from(document.querySelectorAll('#profit-table tbody tr')).some(row => row.cells[0]?.textContent === '2026-09-15' && row.cells[5]?.textContent.includes('113,000원')), undefined, { timeout: 12000 });
  await idle();
  job = await diagnostic();
  assert.equal(job.running, true, 'Cafe progress and UI redraw occur before Naver finishes');
  assert.equal(job.sources.naver.status, '진행 중');
  assert.equal(job.sources.naver.checked, 0);
  assert.equal(job.sources.cafe24.status, '완료');
  assert.equal(job.sources.cafe24.checked, 1);
  assert.equal(job.sources.cafe24.restored, 1);
  assert.equal(job.sources.cafe24.remaining, 0);
  await scopeAmount('2026-09-15', 113000, true);
  const profitPoint = page.locator('#graph circle[data-metric="profit"][data-point-date="2026-09-15"]');
  assert.equal(await profitPoint.count(), 1);
  assert.equal(await profitPoint.getAttribute('data-partial'), 'true');
  assert.match(await profitPoint.locator('title').textContent(), /113,000원/);
  assert.match(await page.locator('[data-repair-source="naver"]').innerText(), /진행 중/);
  assert.match(await page.locator('[data-repair-source="cafe24"]').innerText(), /완료/);
  const api = await report(base, '2026-09-15', '2026-09-15');
  assert.equal(api.days[0].profit, null);
  assert.equal(api.days[0].confirmed.revenue, 200000);
  assert.equal(api.days[0].confirmed.fee, 7000);
  assert.equal(api.days[0].confirmed.cost, 50000);
  assert.equal(api.days[0].confirmed.profit, 113000);
  const cafeAfter = read('cafe24-orders/orders.json').orders;
  assert.equal(cafeAfter['cafe24-2026-09-15'].items[0].name, knownName);
  assert.equal(cafeAfter['cafe24-2026-09-15'].items[0].option, option);
  assert.equal(read('naver-orders/orders.json').orders['naver-2026-09-15'].items.length, 0);
  check('history: real Cafe item fallback repairs the cache and redraws 113,000 partial profit in table and graph while Naver remains blocked');

  write('.roas-data/browser-naver-release.json', { release: true });
  await page.waitForFunction(() => document.getElementById('history-repair').disabled === false, undefined, { timeout: 12000 });
  await idle();
  job = await diagnostic();
  assert.equal(job.running, false);
  assert.equal(job.sources.naver.status, '부분 완료');
  assert.equal(job.sources.naver.checked, 1);
  assert.equal(job.sources.naver.restored, 0);
  assert.equal(job.sources.naver.remaining, 1);
  assert.match(job.sources.naver.error, /Synthetic Naver upstream failure/);
  assert.equal(job.sources.cafe24.status, '완료');
  assert.equal(job.sources.cafe24.remaining, 0);
  assert.match(await page.locator('#history-repair-summary').innerText(), /일부 미완료/);
  await scopeAmount('2026-09-15', 113000, true);
  current = await coverage();
  assert.equal(current.sources.naver.missingItemOrders, 1);
  assert.equal(current.sources.cafe24.missingItemOrders, 0);
  assert.equal(current.profit.partialDays, 1);
  const calls = read('browser-repair-calls.json');
  assert.deepEqual(calls.body, selected);
  assert.deepEqual(calls.naverIds, ['naver-2026-09-15']);
  assert.deepEqual(calls.cafeIds, ['cafe24-2026-09-15']);
  assert.deepEqual(calls.cafeEndpoints, ['orders/cafe24-2026-09-15/items?shop_no=1', 'orders/cafe24-2026-09-15?shop_no=1&embed=items']);
  for (const channel of ['naver', 'cafe24']) {
    const after = read(channel + '-orders/orders.json').orders;
    for (const date of ['2026-08-31', '2026-10-01']) {
      assert.deepEqual(after[channel + '-' + date], before[channel][channel + '-' + date], 'Outside-period orders remain byte-for-byte equivalent');
    }
    assert.equal(after[channel + '-2026-09-15'].net, before[channel][channel + '-2026-09-15'].net, 'Repair preserves stored payment amounts');
    assert.equal(Object.keys(read(channel + '-orders/sync.json').days).length, 30, 'Repair does not manufacture collection days');
  }
  assert.equal(await page.locator('#since').inputValue(), selected.since);
  assert.equal(await page.locator('#until').inputValue(), selected.until);
  assert.equal(await page.locator('#chart-window').inputValue(), '1');
  const repairRequests = requests.slice(requestStart);
  assert.deepEqual(repairRequests.filter(req => req.method === 'POST').map(req => new URL(req.url).pathname), ['/api/costs/catalog/refresh']);
  assert.ok(repairRequests.filter(req => new URL(req.url).pathname === '/api/insights').every(req => new URL(req.url).searchParams.get('cacheOnly') === '1'));
  check('history: Naver failure remains explicit, Cafe results survive, August/October orders and sync dates stay unchanged, and redraws remain cache-only');
}


async function metricCardScreenshot(name) {
  if (!process.env.ROAS_METRICCARD_SCREENSHOT_DIR) return;
  fs.mkdirSync(process.env.ROAS_METRICCARD_SCREENSHOT_DIR, { recursive: true });
  if (name.startsWith('cards-')) await page.locator('.summary-settings').evaluate(heading => heading.scrollIntoView({ block: 'start', behavior: 'instant' }));
  await page.screenshot({ path: path.join(process.env.ROAS_METRICCARD_SCREENSHOT_DIR, name + '.png'), fullPage: false });
}
async function summaryKeys() {
  return page.locator('#summary-cards .summary-card').evaluateAll(cards => cards.map(card => card.dataset.summaryKey));
}
async function verifyMetricCards(requests) {
  fixture();
  await range('2026-09-01', '2026-09-07');
  await page.locator('#chart-window').selectOption('1');
  const defaults = ['spend', 'revenue', 'roas', 'cpa', 'purchases', 'ctr', 'impressions', 'clicks', 'smartstoreRevenue', 'mallRevenue', 'totalStoreRevenue', 'profit'];
  const storageKey = 'roas-overview-summary-cards-v1';
  assert.deepEqual(await summaryKeys(), defaults, 'New installs keep all twelve documented defaults');
  assert.equal(await page.locator('#summary-cards .summary-card-scope,#summary-cards .summary-card-state,#summary-cards .summary-card-badge').count(), 0, 'Cards contain values only');
  const connections = page.locator('#summary-connections');
  assert.equal(await connections.evaluate(node => node.open), false, 'Connection details start collapsed');
  assert.equal(await connections.evaluate(node => node === document.querySelector('main').lastElementChild), true, 'Connection details are at the bottom');
  await connections.locator(':scope > summary').click();
  assert.equal(await connection('spend').isVisible(), true, 'Clicking reveals the metric source details');
  await connections.locator(':scope > summary').click();
  for (const id of ['spend', 'revenue', 'roas', 'cpa', 'purchases', 'ctr', 'impressions', 'clicks']) {
    assert.equal(await page.locator('[id="' + id + '"]').count(), 1, 'Legacy metric ID remains unique: ' + id);
  }
  for (const width of [1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1100 });
    const layout = await page.locator('#summary-cards .summary-card').evaluateAll(cards => cards.map(card => {
      const box = card.getBoundingClientRect();
      return { slot: Number(card.dataset.summarySlot), x: box.x, y: box.y, right: box.right, width: box.width, height: box.height, text: card.querySelector('strong')?.textContent };
    }));
    assert.equal(layout.length, 12, width + 'px always shows twelve cards');
    assert.deepEqual(layout.map(card => card.slot), Array.from({ length: 12 }, (_, i) => i));
    for (let i = 0; i < 12; i++) {
      assert.ok(layout[i].width > 0 && layout[i].height > 0 && layout[i].text, 'Every configured card has a visible value');
      assert.ok(Math.abs(layout[i].y - layout[Math.floor(i / 6) * 6].y) < 1, width + 'px places exactly six cards in each row');
      assert.ok(layout[i].right <= width + 1, width + 'px cards stay inside the viewport');
      if (i % 6) assert.ok(layout[i].x >= layout[i - 1].right - 1, 'Adjacent cards do not overlap');
      if (i >= 6) assert.ok(Math.abs(layout[i].x - layout[i - 6].x) < 1, 'Second row columns align with the first row');
    }
    assert.ok(layout[6].y >= layout[0].y + layout[0].height, 'Twelve cards occupy two distinct rows');
  }
  check('cards: twelve default metrics retain unique legacy IDs and a six-column, two-row layout at1280/1440/1920px');

  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await metricCardScreenshot('cards-default-1440');
  const requestStart = requests.length;
  const originalStorage = await page.evaluate(key => localStorage.getItem(key), storageKey);
  await page.locator('#summary-edit').click();
  assert.equal(await page.locator('.summary-card-choice').count(), 12);
  await metricCardScreenshot('cards-edit-1440');
  await page.locator('#summary-choice-0').selectOption('cpc');
  assert.equal(await page.evaluate(key => localStorage.getItem(key), storageKey), originalStorage, 'Draft selection is not persisted');
  await page.locator('#summary-cancel').click();
  assert.deepEqual(await summaryKeys(), defaults, 'Cancel restores the previous card arrangement');
  assert.equal(await page.evaluate(key => localStorage.getItem(key), storageKey), originalStorage, 'Cancel leaves saved configuration intact');

  await page.locator('#summary-edit').click();
  await page.locator('#summary-choice-0').selectOption('cpc');
  await page.locator('#summary-save').click();
  const configured = ['cpc', ...defaults.slice(1)];
  assert.deepEqual(await summaryKeys(), configured, 'Saving applies the chosen card metric');
  assert.deepEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey), configured);
  assert.equal(await page.locator('#since').inputValue(), '2026-09-01');
  assert.equal(await page.locator('#until').inputValue(), '2026-09-07');
  assert.equal(await page.locator('#chart-window').inputValue(), '1');
  assert.deepEqual(requests.slice(requestStart).filter(req => new URL(req.url).pathname.startsWith('/api/')), [], 'Editing, cancelling, and saving cards only re-render already loaded data');
  check('cards: cancel preserves saved choices, save applies one chosen metric, and configuration makes no API requests');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await idle();
  await page.mouse.move(1000, 80);
  assert.deepEqual(await summaryKeys(), configured, 'Saved card choices survive a real page reload');
  const restoreStart = requests.length;
  await page.locator('#summary-edit').click();
  await page.locator('#summary-defaults').click();
  await page.locator('#summary-save').click();
  assert.deepEqual(await summaryKeys(), defaults);
  assert.deepEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey), defaults);
  assert.deepEqual(requests.slice(restoreStart).filter(req => new URL(req.url).pathname.startsWith('/api/')), [], 'Restoring defaults is also a local display change');
  check('cards: saved configuration survives reload, and restoring defaults returns all twelve original metrics without collection');

  const failedSaveStart = requests.length;
  await page.locator('#summary-edit').click();
  await page.locator('#summary-choice-0').selectOption('cpc');
  await page.evaluate(key => {
    window.__summaryOriginalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw new DOMException('Synthetic quota limit', 'QuotaExceededError');
      return window.__summaryOriginalSetItem.call(this, name, value);
    };
  }, storageKey);
  try {
    await page.locator('#summary-save').click();
    assert.equal(await page.locator('#summary-settings-status').getAttribute('data-error'), 'true');
    assert.match(await page.locator('#summary-settings-status').innerText(), /저장하지 못했습니다/);
    assert.equal(await page.locator('#summary-save').isVisible(), true, 'Failed save keeps the draft editable');
    assert.deepEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey), defaults, 'Failed save never overwrites the previous persisted layout');
  } finally {
    await page.evaluate(() => { Storage.prototype.setItem = window.__summaryOriginalSetItem; delete window.__summaryOriginalSetItem; });
  }
  await page.locator('#summary-cancel').click();
  assert.deepEqual(await summaryKeys(), defaults, 'Cancel after a failed save restores the previous cards');
  assert.deepEqual(requests.slice(failedSaveStart).filter(req => new URL(req.url).pathname.startsWith('/api/')), [], 'A failed local preference save never triggers data collection');
  await page.evaluate(key => localStorage.setItem(key, '{invalid-json'), storageKey);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await idle();
  await page.mouse.move(1000, 80);
  assert.deepEqual(await summaryKeys(), defaults, 'Invalid saved JSON falls back to twelve defaults');
  assert.equal(await page.locator('#summary-settings-status').getAttribute('data-error'), 'true');
  assert.match(await page.locator('#summary-settings-status').innerText(), /기본 구성/);
  await page.locator('#summary-edit').click();
  await page.locator('#summary-save').click();
  assert.deepEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey), defaults, 'A subsequent successful save repairs the malformed preference');
  check('cards: storage errors preserve saved choices and keep drafts editable; invalid JSON recovers to twelve defaults');
}

async function verifySummaryCardDrag(requests) {
  await page.waitForLoadState('networkidle');
  await page.setViewportSize({ width: 1440, height: 1100 });
  const storageKey = 'roas-overview-summary-cards-v1';
  const keys = () => page.locator('#summary-cards [data-summary-slot]').evaluateAll(cards => cards.map(card => card.dataset.summaryKey));
  const saved = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
  const original = await keys();
  const shifted = (list, from, to) => { const next = list.slice(); next.splice(to, 0, next.splice(from, 1)[0]); return next; };
  const card = slot => page.locator('#summary-cards [data-summary-slot="' + slot + '"]');
  const drag = async (from, to) => {
    // Use native browser mouse events and its real DataTransfer across grid rows.
    await card(from).locator('.summary-card-move').dragTo(card(to), { targetPosition: { x: 30, y: 20 } });
  };
  const requestStart = requests.length;
  await drag(0, 7);
  const reordered = shifted(original, 0, 7);
  assert.deepEqual(await keys(), reordered, 'Dragging forward inserts at the destination and shifts intervening cards');
  assert.deepEqual(await saved(), reordered, 'Normal view saves the new order immediately');
  await drag(7, 0);
  assert.deepEqual(await keys(), original, 'Dragging backward across rows restores the order');
  await card(0).dragTo(card(7), { sourcePosition: { x: 30, y: 20 }, targetPosition: { x: 30, y: 20 } });
  assert.deepEqual(await saved(), reordered, 'Dragging the card body also reorders without requiring the handle');
  await drag(7, 0);
  await drag(0, 0);
  assert.deepEqual(await saved(), original, 'Dropping on the same card is a no-op');
  await card(1).locator('.summary-card-move').dragTo(page.locator('#summary-edit'));
  assert.deepEqual(await keys(), original, 'Dropping outside the grid leaves order unchanged');
  assert.equal(await page.locator('.summary-card-dragging,.summary-card-drop-target').count(), 0, 'Cancelled drag removes drag markers');
  await drag(0, 7);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await idle();
  await page.waitForLoadState('networkidle');
  assert.deepEqual(await keys(), reordered, 'Auto-saved drag order survives reload');
  check('card drag: native forward/backward drags across rows, self/outside drops, and reload persistence');

  await page.locator('#summary-edit').click();
  await drag(7, 0);
  assert.deepEqual(await keys(), original, 'Editor previews the reordered cards');
  assert.deepEqual(await saved(), reordered, 'Editor drag does not save before confirmation');
  assert.equal(await page.locator('#summary-choice-0').inputValue(), original[0], 'Selectors follow the moved metric');
  await page.locator('#summary-cancel').click();
  assert.deepEqual(await keys(), reordered, 'Cancel restores the saved order');
  await page.locator('#summary-edit').click();
  await drag(7, 0);
  await page.locator('#summary-save').click();
  assert.deepEqual(await saved(), original, 'Save commits the editor drag');
  await card(0).locator('.summary-card-move').focus();
  await page.keyboard.press('ArrowRight');
  assert.deepEqual(await keys(), shifted(original, 0, 1), 'Keyboard moves the focused card');
  assert.equal(await card(1).locator('.summary-card-move').evaluate(node => node === document.activeElement), true, 'Keyboard focus follows the moved card');
  await page.keyboard.press('Home');
  assert.deepEqual(await saved(), original);
  await page.evaluate(key => {
    window.__dragSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw new DOMException('Synthetic quota limit', 'QuotaExceededError');
      return window.__dragSetItem.call(this, name, value);
    };
  }, storageKey);
  try {
    await drag(0, 7);
    assert.deepEqual(await keys(), original, 'Failed automatic save keeps the previous visible order');
    assert.deepEqual(await saved(), original, 'Failed automatic save preserves storage');
    assert.equal(await page.locator('#summary-settings-status').getAttribute('data-error'), 'true');
  } finally {
    await page.evaluate(() => { Storage.prototype.setItem = window.__dragSetItem; delete window.__dragSetItem; });
  }
  check('card drag: editor save/cancel, keyboard focus, and storage failure preserve the intended order');

  const sparse = ['spend', '', 'revenue', 'spend', '', 'profit', '', '', '', '', '', ''];
  await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: storageKey, value: sparse });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await idle();
  await page.waitForLoadState('networkidle');
  await drag(0, 5);
  const sparseReordered = shifted(sparse, 0, 5);
  assert.deepEqual(await saved(), sparseReordered, 'Duplicate metrics and hidden slots move by position');
  assert.deepEqual(await keys(), sparseReordered.filter(Boolean));
  await page.locator('#summary-edit').click();
  await drag(0, 11);
  assert.deepEqual(await keys(), shifted(sparseReordered, 0, 11), 'Empty editor slots can also be dragged');
  await page.locator('#summary-cancel').click();
  await page.locator('#summary-edit').click();
  await page.locator('#summary-defaults').click();
  await page.locator('#summary-save').click();
  await metricCardScreenshot('cards-draggable-1440');
  // Exclude reload requests: all other preference changes are local to the browser.
  assert.deepEqual(requests.slice(requestStart).filter(req => new URL(req.url).pathname.startsWith('/api/') && req.method !== 'GET'), [], 'Reordering never writes business data or invokes collection');
  check('card drag: sparse layouts, duplicate metrics, and empty editor slots keep their positional identity');
}

async function verifyOptionalCards(requests) {
  fixture();
  await range('2026-09-01', '2026-09-07');
  // The report becomes interactive before auxiliary product/status reads finish.
  // Drain those reads before attributing requests to card preference changes.
  await page.waitForLoadState('networkidle');
  await page.setViewportSize({ width: 1440, height: 1100 });
  const defaults = ['spend', 'revenue', 'roas', 'cpa', 'purchases', 'ctr', 'impressions', 'clicks', 'smartstoreRevenue', 'mallRevenue', 'totalStoreRevenue', 'profit'];
  const storageKey = 'roas-overview-summary-cards-v1';
  const visibleCards = () => page.locator('#summary-cards .summary-card:visible');
  const visibleKeys = () => visibleCards().evaluateAll(cards => cards.map(card => card.dataset.summaryKey));
  const savedKeys = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
  const noApiSince = (start, message) => assert.deepEqual(requests.slice(start).filter(req => new URL(req.url).pathname.startsWith('/api/')), [], message);
  const uniqueValueIds = async () => {
    const ids = await page.locator('#summary-cards [id]').evaluateAll(nodes => nodes.map(node => node.id));
    assert.equal(new Set(ids).size, ids.length, 'Configured visible cards never duplicate element IDs');
  };
  const five = defaults.map((key, index) => [0, 2, 5, 8, 11].includes(index) ? key : '');
  let requestStart = requests.length;
  await page.locator('#summary-edit').click();
  assert.equal(await page.locator('.summary-card-choice').count(), 12, 'Editing keeps all twelve available slots');
  const firstOptions = await page.locator('.summary-card-choice').evaluateAll(selects => selects.map(select => ({ value: select.options[0].value, label: select.options[0].textContent.trim() })));
  assert.ok(firstOptions.every(option => option.value === '' && option.label === '선택 안 함'), 'Every slot starts with the explicit no-selection choice');
  for (let index = 0; index < five.length; index++) if (!five[index]) await page.locator('#summary-choice-' + index).selectOption('');
  assert.equal(await page.locator('.summary-card-choice').count(), 12, 'Choosing empty slots does not remove their editor controls');
  await page.locator('#summary-save').click();
  assert.deepEqual(await savedKeys(), five, 'Persist all twelve positions including intentional empty strings');
  assert.deepEqual(await visibleKeys(), five.filter(Boolean));
  assert.equal(await page.locator('#summary-card-count').innerText(), '5개 표시 · 최대 12개');
  assert.match(await page.locator('#summary-settings-status').innerText(), /5개/);
  const layout = await visibleCards().evaluateAll(cards => cards.map(card => {
    const box = card.getBoundingClientRect();
    const grid = card.parentElement, scale = grid.getBoundingClientRect().width / grid.offsetWidth;
    return { x: box.x, y: box.y, right: box.right, gap: (parseFloat(getComputedStyle(grid).columnGap) || 0) * scale };
  }));
  assert.equal(layout.length, 5);
  for (let i = 0; i < layout.length; i++) {
    assert.ok(Math.abs(layout[i].y - layout[0].y) < 1, 'Five selected cards occupy one row');
    if (i) assert.ok(Math.abs(layout[i].x - layout[i - 1].right - layout[i].gap) < 1, 'Hidden middle slots leave no blank holes between visible cards');
  }
  await uniqueValueIds();
  noApiSince(requestStart, 'Choosing and saving fewer cards never requests data');
  await metricCardScreenshot('cards-five-visible-1440');
  check('optional cards: all twelve editors offer no-selection; five sparse choices save as twelve slots and display in one packed row');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await idle();
  await page.mouse.move(1000, 80);
  assert.deepEqual(await savedKeys(), five, 'Reload preserves intentional empty strings instead of replacing them with defaults');
  assert.deepEqual(await visibleKeys(), five.filter(Boolean));
  assert.equal(await page.locator('#summary-card-count').innerText(), '5개 표시 · 최대 12개');
  requestStart = requests.length;
  await page.locator('#summary-edit').click();
  assert.equal(await page.locator('.summary-card-choice').count(), 12);
  for (let index = 0; index < five.length; index++) assert.equal(await page.locator('#summary-choice-' + index).inputValue(), five[index]);
  await page.locator('#summary-choice-0').selectOption('');
  await page.locator('#summary-choice-1').selectOption('cost');
  await page.locator('#summary-cancel').click();
  assert.deepEqual(await visibleKeys(), five.filter(Boolean), 'Cancel discards both a newly hidden card and a newly added card');
  assert.deepEqual(await savedKeys(), five, 'Cancel keeps the prior sparse configuration unchanged');
  noApiSince(requestStart, 'Editing and cancelling a sparse layout remains local');
  check('optional cards: five-card layout and empty slots survive reload; cancelling additions/removals restores the saved choices');

  requestStart = requests.length;
  await page.locator('#summary-edit').click();
  for (let index = 0; index < 12; index++) await page.locator('#summary-choice-' + index).selectOption('');
  await page.locator('#summary-save').click();
  assert.equal(await visibleCards().count(), 0);
  assert.deepEqual(await savedKeys(), Array(12).fill(''));
  assert.equal(await page.locator('#summary-card-count').innerText(), '0개 표시 · 최대 12개');
  assert.match(await page.locator('#summary-settings-status').innerText(), /0개|모든 지표 카드를 숨겼습니다/);
  assert.equal(await page.getByText('지표 설정에서 표시할 지표를 선택해 주세요.', { exact: true }).isVisible(), true);
  assert.equal(await page.locator('#summary-edit').isVisible(), true, 'The settings entry stays available when no cards are shown');
  noApiSince(requestStart, 'Hiding all cards never requests data');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await idle();
  await page.mouse.move(1000, 80);
  assert.equal(await visibleCards().count(), 0, 'An all-empty saved layout stays empty after reload');
  assert.deepEqual(await savedKeys(), Array(12).fill(''));
  requestStart = requests.length;
  await page.locator('#summary-edit').click();
  assert.equal(await page.locator('.summary-card-choice').count(), 12, 'All slots can be added back from an empty layout');
  for (const [slot, metric] of [[0, 'spend'], [1, 'revenue'], [6, 'spend'], [11, 'profit']]) await page.locator('#summary-choice-' + slot).selectOption(metric);
  await page.locator('#summary-save').click();
  assert.deepEqual(await visibleKeys(), ['spend', 'revenue', 'spend', 'profit']);
  assert.equal(await page.locator('#summary-card-count').innerText(), '4개 표시 · 최대 12개');
  await uniqueValueIds();
  assert.equal(await page.locator('[id="spend"]').count(), 1, 'Selecting the same metric twice retains one unique legacy ID');
  await page.locator('#summary-edit').click();
  await page.locator('#summary-defaults').click();
  await page.locator('#summary-save').click();
  assert.deepEqual(await savedKeys(), defaults);
  assert.deepEqual(await visibleKeys(), defaults);
  assert.equal(await page.locator('#summary-card-count').innerText(), '12개 표시 · 최대 12개');
  await uniqueValueIds();
  noApiSince(requestStart, 'Adding cards back and restoring defaults are local display changes');
  check('optional cards: all-empty remains recoverable after reload, four cards can be added without duplicate IDs, and defaults restore all twelve');
}

async function verifySplitRoas(requests) {
  fixture();
  await range('2026-09-04');
  await page.setViewportSize({ width: 1440, height: 1100 });
  const storageKey = 'roas-overview-summary-cards-v1';
  const keys = ['roas', 'mallRoas', 'smartstoreRoas'];
  const labels = ['총 광고 ROAS', '자사몰 광고 ROAS', '스마트스토어 광고 ROAS'];
  const scopes = ['Meta · 전체 연결 계정', 'Meta · 자사몰 광고', 'Meta · 스마트스토어 광고'];
  const card = key => page.locator('#summary-cards .summary-card[data-summary-key="' + key + '"]');
  const assertRoas = async (expected, message) => {
    for (const [index, key] of keys.entries()) {
      assert.equal(await card(key).count(), 1, key + ': one configured card');
      assert.equal(await card(key).locator('strong').innerText(), expected[index] == null ? '—' : expected[index].toFixed(1) + '%', message + ': ' + key);
      assert.equal(await card(key).locator('.summary-card-label').innerText(), labels[index]);
      assert.equal(await connection(key).locator('.summary-card-scope').innerText(), scopes[index], 'Each ROAS card identifies its fixed Meta source');
    }
  };
  const showRoasAudit = async () => {
    await page.locator('#summary-connections').evaluate(node => { node.open = true; });
    const audit = page.locator('#summary-roas-audit');
    if (!(await audit.evaluate(details => details.open))) await audit.locator(':scope > summary').click();
    assert.match(await audit.innerText(), /전체 광고비/, 'The visible calculation explanation identifies the full-spend denominator');
  };
  const auditCell = (key, field) => page.locator('#summary-roas-audit-body [data-roas-key="' + key + '"] [data-roas-field="' + field + '"]');
  const configured = await summaryKeys();
  configured[3] = 'mallRoas';
  configured[4] = 'smartstoreRoas';
  const requestStart = requests.length;
  await page.locator('#summary-edit').click();
  for (const [index, key] of keys.entries()) {
    assert.equal(await page.locator('#summary-choice-2 option[value="' + key + '"]').innerText(), labels[index], 'All three ROAS choices are explicitly named');
    await page.locator('#summary-choice-' + (index + 2)).selectOption(key);
  }
  await page.locator('#summary-save').click();
  assert.deepEqual(await summaryKeys(), configured);
  assert.deepEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey), configured);
  // Meta attributes 300,000 won to each account, while real store orders total
  // 800,000 won. Combined ROAS is 600,000 / 30,000, never the unweighted 2,250%.
  await assertRoas([2000, 3000, 1500], 'ROAS uses Meta attributed revenue and all spend from the selected account scope');
  assert.equal(await page.locator('#spend').innerText(), money(30000));
  assert.equal(await page.locator('#revenue').innerText(), money(600000));
  assert.equal(await page.locator('#totalStoreRevenue').innerText(), money(800000));
  for (const key of keys) {
    const description = await card(key).getAttribute('title');
    assert.match(description, /Meta (?:귀속 )?구매매출.*전체 광고비/);
    assert.match(description, /상단 채널 필터와 관계없이/);
    assert.equal(await connection(key).locator('.summary-card-scope').getAttribute('title'), description);
  }
  assert.deepEqual(requests.slice(requestStart).filter(req => new URL(req.url).pathname.startsWith('/api/')), [], 'Selecting and saving the three ROAS cards only uses already loaded data');
  await metricCardScreenshot('cards-roas-split-1440');
  check('ROAS: three named choices save without API requests; total 2000%, mall 3000% and Smartstore 1500% retain explicit Meta sources');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await idle();
  await page.mouse.move(1000, 80);
  assert.deepEqual(await summaryKeys(), configured, 'All three ROAS selections survive a real reload');
  assert.deepEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey), configured);
  await range('2026-09-04');
  for (const channel of ['naver', 'cafe', 'all']) {
    await page.locator('#channel').selectOption(channel);
    await idle();
    await assertRoas([2000, 3000, 1500], 'ROAS scopes remain fixed under top channel filter ' + channel);
    assert.equal(await page.locator('#spend').innerText(), money(30000), 'The existing spend key now remains integrated under every top channel filter');
  }
  // September 1 has spend but no attributed purchase value; September 2 is a
  // confirmed empty day. Keep September 1 spend in the full-period denominator.
  await range('2026-09-01', '2026-09-04');
  await assertRoas([1200000 / 90000 * 100, 600000 / 30000 * 100, 600000 / 60000 * 100], 'ROAS includes all selected-period spend even when some purchase values are unknown');
  for (const key of keys) {
    assert.equal(await connection(key).locator('.summary-card-badge').innerText(), '확인분');
    assert.match(await connection(key).locator('.summary-card-state').innerText(), /3\/4일/);
  }
  check('ROAS: saved selections survive reload; fixed account scopes use confirmed purchase values divided by full-period spend');

  await page.evaluate(id => localStorage.setItem('roas-account-ids', JSON.stringify({ naver: id, cafe: id })), accountIds.naver);
  const duplicateStart = requests.length;
  await range('2026-09-04');
  await assertRoas([1500, null, null], 'A shared account is counted once and cannot produce separate channel ROAS');
  assert.equal(await page.locator('#spend').innerText(), money(20000), 'Shared-account spend is not doubled');
  assert.equal(await page.locator('#revenue').innerText(), money(300000), 'Shared-account attributed revenue is not doubled');
  const duplicateInsights = requests.slice(duplicateStart).filter(req => new URL(req.url).pathname === '/api/insights');
  assert.equal(duplicateInsights.length, 1, 'One shared account is requested once');
  assert.equal(new URL(duplicateInsights[0].url).searchParams.get('account'), accountIds.naver);
  for (const key of ['mallRoas', 'smartstoreRoas']) assert.match(await connection(key).locator('.summary-card-state').innerText(), /동일 광고계정.*채널 구분 필요/);
  for (const [ids, expected, absent] of [
    [{ naver: accountIds.naver, cafe: '' }, [1500, null, 1500], ['mallRoas']],
    [{ naver: '', cafe: accountIds.cafe }, [3000, 3000, null], ['smartstoreRoas']],
    [{ naver: '', cafe: '' }, [null, null, null], keys]
  ]) {
    await page.evaluate(ids => localStorage.setItem('roas-account-ids', JSON.stringify(ids)), ids);
    await range('2026-09-04');
    await assertRoas(expected, 'Disconnected accounts remain unavailable rather than zero');
    for (const key of absent) assert.equal(await connection(key).locator('.summary-card-state').innerText(), '광고계정 미연결');
  }
  await page.evaluate(ids => localStorage.setItem('roas-account-ids', JSON.stringify(ids)), accountIds);
  await range('2026-09-04');
  await assertRoas([2000, 3000, 1500], 'Reconnecting both accounts restores independent ROAS');
  check('ROAS: a shared account is fetched and summed once, separate channels require classification, and missing accounts show unavailable with connection guidance');

  for (const sameDay of [false, true]) {
    const selected = roasSpendFixture(sameDay);
    await range(selected.since, selected.until);
    await assertRoas([60, 60, 60], 'Full spend prevents 6000% inflation for ' + (sameDay ? 'different ads on one day' : 'different dates'));
    assert.equal(await page.locator('#spend').innerText(), money(2000));
    assert.equal(await page.locator('#revenue').innerText(), money(1200));
    for (const key of keys) assert.equal(await connection(key).locator('.summary-card-badge').innerText(), '확인분', 'A partially observed purchase value remains explicitly partial');
    await showRoasAudit();
    for (const key of keys) {
      assert.equal(await auditCell(key, 'revenue').isVisible(), true, 'Expanded calculation evidence is actually visible');
      assert.ok((await auditCell(key, 'revenue').innerText()).includes(money(key === 'roas' ? 1200 : 600)));
      assert.equal(await auditCell(key, 'spend').innerText(), money(key === 'roas' ? 2000 : 1000), 'Audit denominator contains all spend, without dropping unknown purchase rows');
      assert.ok((await auditCell(key, 'value').innerText()).includes('60.0%'));
    }
  }
  await metricCardScreenshot('cards-roas-full-spend-1440');
  check('ROAS: 600 confirmed purchase revenue divided by all 1000 spend renders 60%, not 6000%, for both separate dates and separate ads on one day');

  let selected = roasSpendFixture(false, true);
  await range(selected.since, '2026-09-05');
  await assertRoas([null, null, null], 'All unknown purchase values never become zero-percent ROAS, even beside a confirmed empty day');
  selected = roasSpendFixture(false);
  fs.unlinkSync(path.join(temp, '.roas-data/daily', accountIds.cafe, selected.since + '.json'));
  await range(selected.since, selected.until);
  await assertRoas([1200 / 1010 * 100, 6000, 60], 'Missing dates show explicitly partial saved-data ratios');
  await showRoasAudit();
  for (const key of ['roas', 'mallRoas']) {
    assert.match(await connection(key).locator('.summary-card-state').innerText(), /광고비 미확인 1\/2일.*전체 기간 미확정/);
    assert.ok((await auditCell(key, 'spend').innerText()).includes(money(key === 'roas' ? 1010 : 10)));
    assert.match(await auditCell(key, 'spend').innerText(), /확인분/, 'Incomplete spend is never presented as the full denominator');
    assert.match(await auditCell(key, 'value').innerText(), /확인분/);
    assert.match(await auditCell(key, 'status').innerText(), /광고비 미확인/);
  }
  check('ROAS: unknown revenue stays unavailable; missing dates show labelled saved-data ratios and preserve exact known spend');

  fixture();
  await range('2026-09-04');
  await page.locator('#summary-edit').click();
  await page.locator('#summary-defaults').click();
  await page.locator('#summary-save').click();
}

async function verifySplitSpend(requests) {
  fixture();
  await range('2026-09-04');
  await page.setViewportSize({ width: 1440, height: 1100 });
  const storageKey = 'roas-overview-summary-cards-v1';
  const keys = ['smartstoreSpend', 'mallSpend', 'spend'];
  const labels = ['스마트스토어 협력 메타 광고비', '자사몰 메타 광고비', '총 광고비'];
  const scopes = ['Meta · 스마트스토어 광고', 'Meta · 자사몰 광고', 'Meta · 전체 연결 계정'];
  const roasKeys = ['smartstoreRoas', 'mallRoas', 'roas'];
  const configured = [...keys, ...roasKeys, ...Array(6).fill('')];
  const card = key => page.locator('#summary-cards .summary-card[data-summary-key="' + key + '"]');
  const assertSpend = async (expected, message) => {
    for (const [index, key] of keys.entries()) {
      assert.equal(await card(key).count(), 1, key + ': one configured card');
      assert.equal(await card(key).locator('strong').innerText(), expected[index] == null ? '—' : money(expected[index]), message + ': ' + key);
      assert.equal(await card(key).locator('.summary-card-label').innerText(), labels[index]);
      assert.equal(await connection(key).locator('.summary-card-scope').innerText(), scopes[index], 'Each spend card identifies its fixed account scope');
    }
  };
  assert.equal(await page.locator('#ad-spend-breakdown,.ad-spend-heading').count(),0,'The removed fixed spend breakdown stays absent');
  assert.equal((await summaryKeys())[0], 'spend', 'Existing saved/default spend selections retain their original key');
  assert.equal(await card('spend').locator('.summary-card-label').innerText(), '총 광고비');
  const requestStart = requests.length;
  await page.locator('#summary-edit').click();
  assert.equal(await page.locator('.summary-card-choice').count(), 12);
  for (const [index, key] of keys.entries()) assert.equal(await page.locator('#summary-choice-0 option[value="' + key + '"]').innerText(), labels[index]);
  for (const [index, key] of configured.entries()) await page.locator('#summary-choice-' + index).selectOption(key);
  await page.locator('#summary-save').click();
  assert.deepEqual(await summaryKeys(), configured.filter(Boolean));
  assert.deepEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey), configured, 'Three spend and three ROAS selections preserve twelve stored positions including empty slots');
  assert.equal(await page.locator('#ad-spend-breakdown,.ad-spend-heading').count(),0,'Configuring KPI cards does not restore the removed spend breakdown');
  assert.equal(await page.locator('#summary-card-count').innerText(), '6개 표시 · 최대 12개');
  await assertSpend([20000, 10000, 30000], 'Integrated spend equals Smartstore plus mall spend');
  assert.deepEqual(await Promise.all(keys.map(key=>card(key).locator('strong').innerText())),[money(20000),money(10000),money(30000)],
  'Configurable overview cards keep the three Meta spending values after the fixed strip is removed');
  assert.deepEqual(await page.locator('#summary-roas-audit-body [data-roas-key]').evaluateAll(rows => rows.map(row => row.dataset.roasKey).sort()), roasKeys.slice().sort(), 'ROAS evidence contains only ROAS rows, never the three spend metrics');
  const layout = await page.locator('#summary-cards .summary-card').evaluateAll(cards => cards.map(card => {
    const box = card.getBoundingClientRect();
    return { x: box.x, y: box.y, right: box.right };
  }));
  assert.equal(layout.length, 6);
  for (const [index, box] of layout.entries()) {
    assert.ok(Math.abs(box.y - layout[0].y) < 1 && box.right <= 1441, 'Six spend/ROAS cards fit one row at 1440px');
    if (index) assert.ok(box.x >= layout[index - 1].right - 1, 'Adjacent spend/ROAS cards do not overlap');
  }
  assert.deepEqual(requests.slice(requestStart).filter(req => new URL(req.url).pathname.startsWith('/api/')), [], 'Selecting and saving spend cards does not request data');
  await page.locator('#summary-roas-audit').evaluate(details => { details.open = false; });
  await metricCardScreenshot('cards-three-spend-three-roas-1440');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await idle();
  await page.mouse.move(1000, 80);
  assert.deepEqual(await summaryKeys(), configured.filter(Boolean), 'Spend choices survive a real page reload');
  assert.deepEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey), configured);
  await range('2026-09-04');
  for (const channel of ['naver', 'cafe', 'all']) {
    await page.locator('#channel').selectOption(channel);
    await idle();
    await assertSpend([20000, 10000, 30000], 'Spend scopes ignore the top channel filter ' + channel);
    const values = await Promise.all(keys.map(key => card(key).locator('strong').innerText()));
    assert.equal(Number(values[0].replace(/[^\d]/g, '')) + Number(values[1].replace(/[^\d]/g, '')), Number(values[2].replace(/[^\d]/g, '')), 'The displayed total equals the displayed channel amounts');
  }
  check('spend: three fixed-scope choices save locally with three ROAS cards, keep empty slots across reload, ignore top filters, and never enter the ROAS audit');

  await range('2026-09-02');
  await assertSpend([0, 0, 0], 'A successfully collected empty day confirms zero spend');
  for (const key of keys) assert.equal(await connection(key).locator('.summary-card-badge').count(), 0, 'Confirmed empty spend has no partial badge');
  await range('2026-09-01');
  await assertSpend([20000, 10000, 30000], 'Spend includes ads with entirely unknown purchase revenue');
  for (const key of keys) assert.equal(await connection(key).locator('.summary-card-badge').count(), 0, 'Unknown purchases do not make complete spend partial');
  for (const key of roasKeys) assert.equal(await card(key).locator('strong').innerText(), '—', 'Unknown purchase revenue remains distinct from its known spend');
  for (const account of Object.values(accountIds)) {
    const relative = '.roas-data/daily/' + account + '/2026-09-04.json';
    const saved = JSON.parse(fs.readFileSync(path.join(temp, relative), 'utf8'));
    for (const row of saved.rows) {
      row.actions = [{ action_type: 'purchase', value: '0' }];
      row.action_values = [{ action_type: 'purchase', value: '0' }];
    }
    write(relative, saved);
  }
  await range('2026-09-04');
  await assertSpend([20000, 10000, 30000], 'Explicit zero purchase revenue never removes ad spend');
  for (const key of roasKeys) assert.equal(await card(key).locator('strong').innerText(), '0.0%');
  const selected = roasSpendFixture(false);
  fs.unlinkSync(path.join(temp, '.roas-data/daily', accountIds.cafe, selected.since + '.json'));
  await range(selected.since, selected.until);
  await assertSpend([1000, 10, 1010], 'Missing spend days retain only the known spend sum with explicit partial status');
  assert.equal(await connection('smartstoreSpend').locator('.summary-card-badge').count(), 0);
  for (const key of ['mallSpend', 'spend']) {
    assert.equal(await connection(key).locator('.summary-card-badge').innerText(), '확인분');
    assert.match(await connection(key).locator('.summary-card-state').innerText(), /확인 [12]\/2일.*광고비 일부 미확인/);
  }
  check('spend: verified empty dates show zero; unknown/zero purchases do not exclude spend; missing dates show the known sum with a partial badge and collection guidance');

  fixture();
  await page.evaluate(id => localStorage.setItem('roas-account-ids', JSON.stringify({ naver: id, cafe: id })), accountIds.naver);
  const duplicateStart = requests.length;
  await range('2026-09-04');
  await assertSpend([null, null, 20000], 'A shared account contributes once to integrated spend and cannot be split by channel');
  assert.equal(requests.slice(duplicateStart).filter(req => new URL(req.url).pathname === '/api/insights').length, 1, 'The shared account is fetched only once');
  for (const key of ['smartstoreSpend', 'mallSpend']) assert.match(await connection(key).locator('.summary-card-state').innerText(), /동일 광고계정.*구분/);
  for (const [ids, expected, absent] of [
    [{ naver: accountIds.naver, cafe: '' }, [20000, null, 20000], ['mallSpend']],
    [{ naver: '', cafe: accountIds.cafe }, [null, 10000, 10000], ['smartstoreSpend']],
    [{ naver: '', cafe: '' }, [null, null, null], keys]
  ]) {
    await page.evaluate(ids => localStorage.setItem('roas-account-ids', JSON.stringify(ids)), ids);
    await range('2026-09-04');
    await assertSpend(expected, 'Unconnected advertising accounts remain unavailable');
    for (const key of absent) assert.match(await connection(key).locator('.summary-card-state').innerText(), /광고계정 미연결/);
  }
  await page.evaluate(ids => localStorage.setItem('roas-account-ids', JSON.stringify(ids)), accountIds);
  await range('2026-09-04');
  await assertSpend([20000, 10000, 30000], 'Reconnecting both accounts restores independent channel spend');
  await page.locator('#summary-edit').click();
  await page.locator('#summary-defaults').click();
  await page.locator('#summary-save').click();
  check('spend: shared accounts are fetched and summed once with separate-channel guidance; absent accounts show unavailable and reconnect cleanly');
}

async function verifyCafeRevenueDiagnostic(base, requests) {
  const date = '2026-09-04';
  const cafeCard = () => page.locator('#summary-cards .summary-card[data-summary-key="mallRevenue"]');
  const cell = field => page.locator('#cafe-revenue-diagnostic-body [data-cafe-revenue-field="' + field + '"] td');
  const openFromCard = async label => {
    await page.locator('#summary-connections').evaluate(node => { node.open = true; });
    const button = connection('mallRevenue').locator('[data-cafe-revenue-diagnostic="open"]');
    assert.equal(await button.innerText(), label);
    await button.click();
    assert.equal(await page.locator('#cafe-revenue-diagnostic').evaluate(details => details.open), true, 'The card action opens the actual diagnostic details');
    assert.equal(await cell('cacheState').isVisible(), true);
  };
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
  const copiedReport = async diagnostic => {
    await page.locator('#cafe-revenue-copy').click();
    await page.waitForFunction(() => document.getElementById('cafe-revenue-copy-status').textContent.includes('복사했습니다'));
    const output = page.locator('#cafe-revenue-diagnostic-output');
    const text = await output.inputValue();
    assert.equal(await output.evaluate(node => node.readOnly), true);
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), text, 'The copy button writes the exact diagnostic report to the temporary browser clipboard');
    assert.equal(text.split('\n')[0], 'ROAS Pilot v' + diagnostic.version + ' · 카페24 주문매출 진단');
    assert.ok(text.includes('조회 기간: ' + date + ' ~ ' + date));
    assert.ok(text.includes(diagnostic.reason));
    return text;
  };

  fixture();
  const automatic = { ...order('cafe24', date, 200000, 1, scopeNames.excluded), id: 'qa-cafe-auto-excluded' };
  const manual = { ...order('cafe24', date, 100000, 1, scopeNames.cafeUnknown), id: 'qa-cafe-manual-excluded' };
  write('.roas-data/cafe24-orders/orders.json', { orders: { [automatic.id]: automatic, [manual.id]: manual } });
  write('.roas-data/cafe24-orders/sync.json', { days: { [date]: { checkedAt: '2026-10-24T00:00:00Z', count: 2 } } });
  await range(date);
  await chooseScope(scopeNames.cafeUnknown, 'excluded');
  let api = await report(base, date, date);
  let diagnostic = api.revenueDiagnostics.cafe24;
  assert.deepEqual(Object.fromEntries(['includedOrders', 'excludedOrders', 'autoExcludedOrders', 'manualExcludedOrders', 'confirmedRevenue', 'complete', 'zeroReason'].map(key => [key, diagnostic[key]])), {
    includedOrders: 0, excludedOrders: 2, autoExcludedOrders: 1, manualExcludedOrders: 1, confirmedRevenue: 0, complete: true, zeroReason: 'excluded'
  });
  assert.equal(api.days[0].cafe24.revenue, 0);
  assert.equal(api.days[0].complete, true, 'A valid zero from excluded orders can be complete');
  assert.equal(await cafeCard().locator('strong').innerText(), money(0));
  await amount(date, 228000);
  const viewStart = requests.length;
  await openFromCard('0원 원인 확인');
  for (const [field, value] of [['storedOrders', '2건'], ['includedOrders', '0건'], ['excludedOrders', '2건'], ['autoExcludedOrders', '1건'], ['manualExcludedOrders', '1건'], ['confirmedRevenue', money(0)]]) {
    assert.equal(await cell(field).innerText(), value);
  }
  assert.equal(await cell('cacheState').innerText(), '정상적으로 읽음');
  assert.equal(await page.locator('#cafe-revenue-diagnostic-summary').innerText(), diagnostic.reason);
  assert.match(diagnostic.reason, /제외/);
  const excludedCopy = await copiedReport(diagnostic);
  assert.ok(excludedCopy.includes('위마망 집계에서 제외: 2건'));
  assert.ok(excludedCopy.includes('상품명에 따라 자동 제외: 1건'));
  assert.ok(excludedCopy.includes('사용자 분류에 따라 제외: 1건'));
  assert.ok(!excludedCopy.includes(automatic.id) && !excludedCopy.includes(manual.id), 'The report contains aggregate counts rather than order identifiers');
  assert.deepEqual(requests.slice(viewStart).filter(req => new URL(req.url).pathname.startsWith('/api/')), [], 'Opening and copying an already loaded diagnosis does not recollect data');
  await metricCardScreenshot('cards-cafe-revenue-zero-diagnostic-1440');
  check('Cafe revenue: real automatic/manual exclusions produce a valid zero, the card opens counts and reason, and the copy button copies the exact aggregate report');

  for (const cacheState of ['invalid_json', 'missing']) {
    fixture();
    const sync = { days: { [date]: { checkedAt: '2026-10-24T00:00:00Z', count: 1 } } };
    write('.roas-data/cafe24-orders/sync.json', sync);
    const ordersFile = path.join(temp, '.roas-data/cafe24-orders/orders.json');
    if (cacheState === 'invalid_json') fs.writeFileSync(ordersFile, '{"orders":');
    else fs.unlinkSync(ordersFile);
    await range(date);
    api = await report(base, date, date);
    diagnostic = api.revenueDiagnostics.cafe24;
    assert.equal(diagnostic.cacheState, cacheState);
    assert.equal(diagnostic.complete, false);
    assert.equal(diagnostic.confirmedRevenue, null);
    assert.equal(diagnostic.storedOrders, null, 'Unreadable or absent orders cannot be reported as a confirmed empty cache');
    assert.equal(diagnostic.recordedDays, 1, 'A successful collection record remains visible after cache failure');
    assert.equal(diagnostic.recordedOrders, 1);
    assert.ok(diagnostic.cacheIssue);
    assert.equal(api.days[0].cafe24.revenue, null);
    assert.equal(api.days[0].cafe24.confirmed.revenue, null);
    assert.equal(api.days[0].cafe24.confirmedAvailable, false);
    assert.equal(api.days[0].profit, null);
    assert.equal(api.days[0].confirmed.profit, null);
    assert.equal(api.days[0].complete, false, 'Completed sync alone cannot manufacture completed profit from missing orders');
    assert.equal(await cafeCard().locator('strong').innerText(), '—');
    assert.equal(await page.locator('#profit').innerText(), '—');
    assert.equal((await row(date))[5], '미확정');
    await openFromCard('매출 미확정 원인 확인');
    assert.equal(await cell('cacheState').innerText(), cacheState === 'invalid_json' ? '저장 주문 자료 읽기 실패' : '저장 주문 자료 없음');
    assert.equal(await cell('storedOrders').innerText(), '미확인');
    assert.equal(await cell('confirmedRevenue').innerText(), '—');
    assert.equal(await cell('recordedDays').innerText(), '1일');
    assert.equal(await cell('recordedOrders').innerText(), '1건');
    assert.equal(await page.locator('#cafe-revenue-diagnostic-summary').innerText(), diagnostic.reason);
    const text = await copiedReport(diagnostic);
    assert.ok(text.includes(diagnostic.cacheIssue));
    assert.ok(text.includes('수집 기록의 주문 건수: 1건'));
    assert.ok(text.includes('집계 상태: 위마망 주문매출 미확정'));
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(temp, '.roas-data/cafe24-orders/sync.json'), 'utf8')), sync, 'Read-only diagnosis preserves the recorded collection evidence');
    assert.equal(fs.existsSync(ordersFile), cacheState !== 'missing');
    if (cacheState === 'invalid_json') assert.equal(fs.readFileSync(ordersFile, 'utf8'), '{"orders":', 'Displaying failure does not overwrite the unreadable cache');
  }
  await metricCardScreenshot('cards-cafe-revenue-missing-diagnostic-1440');
  check('Cafe revenue: corrupt and absent order caches with positive completed-sync counts show unknown revenue/profit, retain collection evidence, and never manufacture a completed zero');
  fixture();
  await range(date);
}

async function verifyCafeRevenueRecovery(base, requests) {
  const read = relative => JSON.parse(fs.readFileSync(path.join(temp, '.roas-data', relative), 'utf8'));
  const cafeCard = () => page.locator('#summary-cards .summary-card[data-summary-key="mallRevenue"]');
  const status = async () => {
    const response = await fetch(base + '/api/cafe24/orders/recovery/status');
    assert.equal(response.status, 200);
    return (await response.json()).job;
  };
  const start = async (selector, selected) => {
    await page.locator('#collection-status-panel').evaluate(node => { node.open = true; });
    const responsePromise = page.waitForResponse(response => new URL(response.url()).pathname === '/api/cafe24/orders/recover' && response.request().method() === 'POST');
    await page.locator(selector).click();
    const response = await responsePromise;
    assert.equal(response.status(), 202, 'Explicit recovery uses the actual localhost-authorized server route');
    assert.deepEqual(response.request().postDataJSON(), selected, 'The job captures only the selected dates');
  };
  const finished = async () => {
    await page.waitForFunction(() => !document.getElementById('cafe-revenue-recover').disabled && !document.getElementById('reload').disabled, undefined, { timeout: 18000 });
    const job = await status();
    assert.equal(job.running, false);
    assert.ok(job.finishedAt);
    assert.ok((await page.locator('#cafe-revenue-recovery-summary').innerText()).includes(job.status));
    return job;
  };
  const release = selected => {
    for (const date of dates(selected.since, selected.until)) write('.roas-data/browser-cafe-recovery-release-' + date + '.json', { release: true });
  };
  const onlyRecoveryPosts = (since, count) => {
    const traffic = requests.slice(since);
    assert.deepEqual(traffic.filter(request => request.method === 'POST').map(request => new URL(request.url).pathname), Array(count).fill('/api/cafe24/orders/recover'), 'Cafe recovery must not start Meta, Smartstore, all-channel detail repair, or recent-three-day collection');
    assert.ok(traffic.filter(request => new URL(request.url).pathname === '/api/insights').every(request => new URL(request.url).searchParams.get('cacheOnly') === '1'), 'Ordinary ad reads remain cache-only');
  };
  const protectedFiles = () => {
    const output = {};
    const visit = relative => {
      const file = path.join(temp, '.roas-data', relative);
      if (fs.statSync(file).isDirectory()) for (const name of fs.readdirSync(file).sort()) visit(path.join(relative, name));
      else output[relative] = fs.readFileSync(file, 'utf8');
    };
    for (const relative of ['naver-orders', 'daily', 'product-costs.json', 'profit-fees.json']) visit(relative);
    return output;
  };

  const before = cafeRevenueRecoveryFixture({ gated: true });
  const { selected } = before, untouched = protectedFiles(), requestStart = requests.length;
  await page.reload();
  await idle();
  await page.locator('#collection-status-panel > summary').click();
  await page.mouse.move(1000, 80);
  await range(selected.since, selected.until);
  await page.locator('#summary-connections').evaluate(node => { node.open = true; });
  await connection('mallRevenue').locator('[data-cafe-revenue-diagnostic="open"]').click();
  assert.equal(await page.locator('#cafe-revenue-recover-diagnostic').isVisible(), true);
  assert.ok(requests.slice(requestStart).some(request => new URL(request.url).pathname === '/api/cafe24/orders/recovery/status' && request.method === 'GET'));
  onlyRecoveryPosts(requestStart, 0);
  await start('#cafe-revenue-recover-diagnostic', selected);
  let job = await status();
  assert.equal(job.running, true);
  assert.equal(job.total, 2);
  assert.equal(job.checkedDays, 0);
  assert.equal(job.ordersFetched, 0, 'A waiting response is not a successful empty order list');
  for (const id of ['cafe-revenue-recover', 'cafe-revenue-recover-diagnostic', 'history-repair', 'profit-repair', 'recent3-refresh']) {
    assert.equal(await page.locator('#' + id).isDisabled(), true, 'Competing collection is disabled while recovery runs: ' + id);
  }
  assert.equal(await page.locator('#reload').isDisabled(), false, 'Read-only date queries remain available');
  assert.match(await page.locator('#cafe-revenue-recovery-summary').innerText(), /2026-09-03 ~ 2026-09-04.*진행 중/);
  assert.deepEqual(read('browser-cafe-recovery-calls.json').dates, ['2026-09-03']);
  check('Cafe recovery: page load only reads status; an explicit diagnostic action captures the selected dates and locks competing collectors without treating a waiting response as zero orders');

  release(selected);
  job = await finished();
  assert.equal(job.status, '완료');
  for (const field of ['checkedDays', 'completedDays', 'ordersFetched', 'ordersRestored', 'itemsChecked', 'itemsRestored']) assert.equal(job[field], 2, field);
  assert.equal(job.failedDays, 0);
  assert.equal(job.itemsMissing, 0);
  assert.equal(job.backupCreated, true);
  assert.equal(await cafeCard().locator('strong').innerText(), money(300000), 'Completion redraws the recovered store revenue without a manual reload');
  await amount('2026-09-03', 16500);
  await amount('2026-09-04', 371000);
  assert.equal(await page.locator('#profit').innerText(), money(387500));
  const recovered = await report(base, selected.since, selected.until);
  assert.deepEqual(recovered.days.map(day => day.cafe24.revenue), [100000, 200000]);
  assert.ok(recovered.days.every(day => day.complete));
  assert.ok((await page.locator('#cafe-revenue-recovery-reason').innerText()).includes(recovered.revenueDiagnostics.cafe24.reason));
  const saved = read('cafe24-orders/orders.json').orders;
  for (const [id, previous] of Object.entries(before.outsideOrders)) assert.deepEqual(saved[id], previous, 'Recovery preserves orders outside its selected period');
  for (const date of dates(selected.since, selected.until)) {
    assert.equal(saved['qa-cafe-recovered-' + date].items[0].name, knownName);
    assert.equal(saved['qa-cafe-recovered-' + date].items[0].quantity, 1);
    assert.equal(read('cafe24-orders/sync.json').days[date].count, 1);
  }
  assert.deepEqual(protectedFiles(), untouched, 'Cafe recovery leaves all saved ads, Smartstore orders, costs and fees unchanged');
  assert.deepEqual(read('browser-cafe-recovery-calls.json').dates, ['2026-09-03', '2026-09-04'], 'Previously completed sync dates are actually fetched again');
  onlyRecoveryPosts(requestStart, 1);
  await page.locator('.summary-settings').evaluate(node => node.scrollIntoView({ block: 'start', behavior: 'instant' }));
  await metricCardScreenshot('cards-cafe-recovery-complete-1440');
  check('Cafe recovery: completed-sync dates regain missing order headers and items, automatically show 300,000 store revenue and 387,500 profit, and preserve unrelated channels and dates');

  cafeRevenueRecoveryFixture({ gated: true });
  await range(selected.since, selected.until);
  const reconnectStart = requests.length;
  await start('#cafe-revenue-recover', selected);
  await range('2026-10-01');
  assert.equal(await cafeCard().locator('strong').innerText(), money(400000));
  assert.match(await page.locator('#cafe-revenue-recovery-summary').innerText(), /2026-09-03 ~ 2026-09-04/);
  const reloadStart = requests.length;
  await page.reload();
  await idle();
  await page.locator('#collection-status-panel > summary').click();
  await page.mouse.move(1000, 80);
  await page.waitForFunction(() => document.getElementById('cafe-revenue-recover').disabled);
  assert.ok(requests.slice(reloadStart).some(request => new URL(request.url).pathname === '/api/cafe24/orders/recovery/status' && request.method === 'GET'), 'Reload reconnects to the running job by GET');
  onlyRecoveryPosts(reloadStart, 0);
  // The application initializes its ordinary date range on page load; explicitly
  // choose October again to test the completion refresh against the current view.
  await range('2026-10-01');
  const completionStart = requests.length;
  release(selected);
  job = await finished();
  assert.equal(job.status, '완료');
  assert.equal(await page.locator('#since').inputValue(), '2026-10-01');
  assert.equal(await page.locator('#until').inputValue(), '2026-10-01');
  assert.equal(await cafeCard().locator('strong').innerText(), money(400000), 'Finishing a September recovery does not replace the selected October view');
  assert.match(await page.locator('#cafe-revenue-recovery-reason').innerText(), /복구 기간은 2026-09-03 ~ 2026-09-04.*화면은 현재 선택한 2026-10-01 ~ 2026-10-01/);
  const completionReads = requests.slice(completionStart).filter(request => ['/api/overview/snapshot','/api/profit/daily'].includes(new URL(request.url).pathname));
  assert.ok(completionReads.length > 0, 'Completion performs a fresh financial read using the single-pass endpoint or its legacy fallback');
  assert.ok(completionReads.every(request => new URL(request.url).searchParams.get('since') === '2026-10-01' && new URL(request.url).searchParams.get('until') === '2026-10-01'));
  assert.deepEqual(read('browser-cafe-recovery-calls.json').body, selected);
  assert.deepEqual(read('browser-cafe-recovery-calls.json').dates, ['2026-09-03', '2026-09-04']);
  onlyRecoveryPosts(reconnectStart, 1);
  assert.deepEqual((await report(base, selected.since, selected.until)).days.map(day => day.cafe24.revenue), [100000, 200000]);
  check('Cafe recovery: changing to October and reloading reconnects with GET only, retains the September job, and refreshes the current October view when recovery finishes');

  for (const scenario of [
    { config: { authMissing: true }, expected: '인증 필요', reason: /OAuth/, completed: 0 },
    { config: { failedDates: ['2026-09-03', '2026-09-04'] }, expected: '실패', reason: /HTTP 503/, completed: 0 },
    { config: { failedDates: ['2026-09-04'] }, expected: '부분 완료', reason: /HTTP 503/, completed: 1 },
    { config: { missingItemDates: ['2026-09-04'] }, expected: '부분 완료', reason: /상품명·옵션·수량/, completed: 1 },
    { config: { name: scopeNames.excluded }, expected: '완료', reason: /제외/, completed: 2 }
  ]) {
    cafeRevenueRecoveryFixture(scenario.config);
    const previous = { ...order('cafe24', '2026-09-04', 70000), id: 'qa-cafe-preserved-failed-day' };
    if (scenario.config.failedDates) {
      const cache = read('cafe24-orders/orders.json');
      cache.orders[previous.id] = previous;
      write('.roas-data/cafe24-orders/orders.json', cache);
    }
    await range(selected.since, selected.until);
    const attemptStart = requests.length;
    await start('#cafe-revenue-recover', selected);
    job = await finished();
    assert.equal(job.status, scenario.expected);
    assert.equal(job.completedDays, scenario.completed);
    assert.match(await page.locator('#cafe-revenue-recovery-reason').innerText(), scenario.reason);
    assert.equal(await page.locator('#cafe-revenue-recovery-connect').isVisible(), !!scenario.config.authMissing);
    const api = await report(base, selected.since, selected.until);
    if (scenario.config.authMissing) {
      assert.deepEqual(read('browser-cafe-recovery-calls.json').dates, []);
      assert.equal(job.ordersFetched, 0);
      assert.equal(job.backupCreated, false);
    } else if (scenario.config.failedDates) {
      assert.deepEqual(read('cafe24-orders/orders.json').orders[previous.id], previous, 'A failed date preserves its previously saved order');
      assert.equal(job.failedDays, scenario.config.failedDates.length);
      assert.ok(api.days.filter(day => scenario.config.failedDates.includes(day.date)).every(day => day.complete === false && day.profit === null), 'Failed dates remain unconfirmed rather than completed zero profit');
    } else if (scenario.config.missingItemDates) {
      assert.equal(job.itemsMissing, 1);
      assert.equal(api.revenueDiagnostics.cafe24.missingItemOrders, 1);
      assert.equal(api.revenueDiagnostics.cafe24.complete, false);
      assert.equal(api.days[1].profit, null);
      assert.equal(read('cafe24-orders/orders.json').orders['qa-cafe-recovered-2026-09-04'].net, 200000, 'A missing item detail does not erase the known payment');
      await page.locator('#cafe-revenue-recovery-progress').evaluate(node => node.scrollIntoView({ block: 'start', behavior: 'instant' }));
      await metricCardScreenshot('cafe-recovery-partial-reason-1440');
    } else {
      assert.equal(api.revenueDiagnostics.cafe24.confirmedRevenue, 0);
      assert.equal(api.revenueDiagnostics.cafe24.zeroReason, 'excluded');
      assert.equal(await cafeCard().locator('strong').innerText(), money(0));
      assert.ok((await page.locator('#cafe-revenue-recovery-reason').innerText()).includes(api.revenueDiagnostics.cafe24.reason), 'A valid zero after recovery explains the exclusion instead of promising revenue');
    }
    onlyRecoveryPosts(attemptStart, 1);
  }
  check('Cafe recovery: authentication, failed dates and missing items stay explicit and unconfirmed; preserved orders survive failures and a legitimate excluded zero displays its actual reason');
  fixture();
  await range('2026-09-04');
}

async function hoverVisibleProfitPoints(label) {
  await page.locator('#graph').evaluate(graph => graph.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await page.waitForFunction(() => {
    const graph = document.getElementById('graph'), svg = graph?.querySelector('svg');
    return svg && Math.abs(svg.viewBox.baseVal.width - graph.clientWidth) < 1;
  });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const points = page.locator('#graph circle[data-metric="profit"][data-point-date]');
  const count = await points.count();
  assert.ok(count >= 3, label + ' has enough date points to verify both edges and the middle');
  for (const index of [...new Set([0, Math.floor(count / 2), count - 1])]) {
    const point = await points.nth(index).evaluate(circle => {
      const screen = new DOMPoint(circle.cx.baseVal.value, circle.cy.baseVal.value).matrixTransform(circle.getScreenCTM());
      return { x: screen.x, y: screen.y, svgX: circle.cx.baseVal.value, date: circle.dataset.pointDate, label: circle.querySelector('title').textContent.split(' · ')[0] };
    });
    await page.mouse.move(point.x, point.y);
    try {
      await page.waitForFunction(() => getComputedStyle(document.getElementById('roas-chart-hover')).display !== 'none', undefined, { timeout: 2000 });
    } catch (error) {
      console.error('Hover geometry', label, index, point, await page.evaluate(point => {
        const graph = document.getElementById('graph'), svg = graph.querySelector('svg'), box = graph.getBoundingClientRect(), matrix = svg.getScreenCTM();
        return { graph: { x:box.x,y:box.y,width:box.width,height:box.height }, viewBox:svg.getAttribute('viewBox'), clientWidth:graph.clientWidth, matrix:{a:matrix.a,b:matrix.b,c:matrix.c,d:matrix.d,e:matrix.e,f:matrix.f}, target:document.elementFromPoint(point.x,point.y)?.outerHTML.slice(0,500) };
      }, point));
      throw error;
    }
    const actual = await page.evaluate(() => {
      const tip = document.getElementById('roas-chart-hover'), cross = document.querySelector('#graph [data-chart-crosshair]'), graph = document.getElementById('graph');
      const tipBox = tip.getBoundingClientRect(), graphBox = graph.getBoundingClientRect();
      const screen = new DOMPoint(Number(cross.getAttribute('x1')), Number(cross.getAttribute('y1'))).matrixTransform(cross.getScreenCTM());
      return { date: tip.dataset.pointDate, title: tip.querySelector('strong')?.textContent, crossDate: cross.dataset.pointDate, crossX: Number(cross.getAttribute('x1')), screenX: screen.x,
        tip: { left: tipBox.left, right: tipBox.right, top: tipBox.top, bottom: tipBox.bottom }, graph: { left: graphBox.left, right: graphBox.right, top: graphBox.top, bottom: graphBox.bottom } };
    });
    assert.equal(actual.date, point.date, label + ': pointer at the rendered SVG point selects its actual date');
    assert.equal(actual.crossDate, point.date, label + ': crosshair and tooltip use the same bucket');
    assert.ok(actual.title.startsWith(point.label + ' · '), label + ': tooltip header matches the rendered daily/averaged label');
    assert.ok(Math.abs(actual.crossX - point.svgX) < 0.1 && Math.abs(actual.screenX - point.x) < 1, label + ': crosshair intersects the rendered point');
    assert.ok(actual.tip.left >= actual.graph.left - 1 && actual.tip.right <= actual.graph.right + 1 && actual.tip.top >= actual.graph.top - 1 && actual.tip.bottom <= actual.graph.bottom + 1,
      label + ': tooltip stays inside the graph at both edges: ' + JSON.stringify(actual));
  }
}
async function verifyResponsiveHover(requests) {
  scopeFixture('long');
  await range('2026-08-01', '2026-09-10');
  await page.locator('#custom-preset-buttons button').first().click();
  const requestStart = requests.length;
  for (const window of ['1', '3', '5', '7']) {
    await page.locator('#chart-window').selectOption(window);
    for (const width of [1280, 1440, 1920, 1280]) {
      await page.setViewportSize({ width, height: 1100 });
      await hoverVisibleProfitPoints(window + '-day at' + width + 'px');
      if (window === '1' && width === 1920) await metricCardScreenshot('hover-wide-1920');
    }
    check('hover: ' + window + '-day first/middle/last dates, crosshair and contained tooltip match real screenCTM coordinates through1280→1440→1920→1280px resizing');
  }
  await page.setViewportSize({ width: 1440, height: 1100 });
  try {
    await page.evaluate(() => { document.body.style.zoom = '1.25'; });
    for (const window of ['1', '7']) {
      await page.locator('#chart-window').selectOption(window);
      await hoverVisibleProfitPoints(window + '-day with125% CSS zoom');
    }
    const bounds = await page.locator('#graph').boundingBox();
    await page.mouse.move(bounds.x + 2, bounds.y + bounds.height / 2);
    assert.equal(await page.locator('#roas-chart-hover').isVisible(), false, 'Pointer in the outer SVG gutter must not select a wrong edge date');
  } finally {
    await page.evaluate(() => document.body.style.removeProperty('zoom'));
  }
  await page.locator('#chart-window').selectOption('1');
  assert.deepEqual(requests.slice(requestStart).filter(req => new URL(req.url).pathname.startsWith('/api/')), [], 'Resizing, averaging, and hover do not recollect data');
  check('hover: actual point alignment survives125% CSS zoom; outer gutters hide the tooltip and all interactions remain local');
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
  // Playwright starts at (0,0), the intentional hover target for the drawer.
  // Move into the workspace before interacting with content beneath that overlay.
  await page.mouse.move(1000, 80);
  await verifyOverviewFolds(requests);
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
  await openDetails('#profit-troubleshooting', '#profit-troubleshooting-body');
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
    assert.equal(await page.locator('#profit-chart-status').isVisible(), false);
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
  await verifyHistoryRepair(base, requests);
  if (!scopeOnly) {
    await verifyMetricCards(requests);
    await verifySummaryCardDrag(requests);
    await verifyOptionalCards(requests);
    await verifySplitRoas(requests);
    await verifySplitSpend(requests);
    await verifyCafeRevenueDiagnostic(base, requests);
    await verifyCafeRevenueRecovery(base, requests);
    await verifyResponsiveHover(requests);
  }

  assert.deepEqual(pageErrors, [], 'Browser JavaScript errors');
  assert.deepEqual(requests.filter(req => new URL(req.url).pathname.startsWith('/api/ai')), [], 'Removed AI controls never issue requests during overview interactions');
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

