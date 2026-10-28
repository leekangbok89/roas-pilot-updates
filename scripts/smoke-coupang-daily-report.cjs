'use strict';
const assert = require('node:assert/strict');
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const { chromium } = require(process.env.ROAS_PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '../public');
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname.startsWith('/api/')) { res.setHeader('Content-Type', 'application/json'); return res.end('{}'); }
  const file = path.resolve(root, '.' + pathname);
  if (!file.startsWith(root + path.sep)) { res.statusCode = 403; return res.end(); }
  try { res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream'); res.end(fs.readFileSync(file)); }
  catch { res.statusCode = 404; res.end(); }
});
let browser;
async function main() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port, posts = [], errors = [];
  const daily = [
    { date: '2026-10-25', source: 'reconciled', sales: 100000, profitBeforeAds: 54000, advertising: 12000, otherCosts: 20000, sourceNetProfit: 42000, channels: [] },
    { date: '2026-10-26', source: 'reconciled', sales: 150000, profitBeforeAds: 82000, advertising: 18000, otherCosts: 28000, sourceNetProfit: 64000, channels: [] },
    { date: '2026-10-27', source: 'missing', sales: null, profitBeforeAds: null, advertising: null, otherCosts: null, sourceNetProfit: null, channels: [] }
  ];
  const moneyKeys = ['sales', 'profitBeforeAds', 'advertising', 'otherCosts', 'sourceNetProfit'];
  daily.forEach((day, index) => {
    day.dailyReport = { ...Object.fromEntries(moneyKeys.map(key => [key, day[key]])), source: day.source, basis: day.source === 'missing' ? 'missing' : 'saved-daily-report',
      estimated: Object.fromEntries(moneyKeys.map(key => [key, false])), partial: {},
      components: { productCost: index === 1 ? 40000 : null, commission: index === 1 ? 13000 : null, fulfillment: index === 1 ? 15000 : null, estimatedProfitBeforeAds: index === 1 ? 82000 : null }, differences: { profitBeforeAds: index === 1 ? 0 : null } };
  });
  const dailyReportSummary = { ...Object.fromEntries(moneyKeys.map(key => [key, null])), available: Object.fromEntries(moneyKeys.map(key => [key, daily.slice(0, 2).reduce((total, day) => total + day.dailyReport[key], 0)])),
    knownDays: Object.fromEntries(moneyKeys.map(key => [key, 2])), partial: Object.fromEntries(moneyKeys.map(key => [key, true])), estimated: Object.fromEntries(moneyKeys.map(key => [key, false])) };
  const summary = { sales: null, available: { sales: 250000 }, profitBeforeAds: null, advertising: null, sourceNetProfit: null };
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Asia/Seoul' });
  await context.route('**/api/coupang/**', async route => {
    const req = route.request(), url = new URL(req.url()), endpoint = url.pathname.split('/').pop();
    if (req.method() === 'POST') posts.push({ endpoint, body: req.postDataJSON() });
    let json = {};
    if (endpoint === 'status') json = { configured: true, automatic: { enabled: false }, products: [] };
    if (endpoint === 'analytics') json = { since: url.searchParams.get('since'), until: url.searchParams.get('until'), summary, dailyReportSummary, daily, items: [], productDaily: [], coverage: { totalDays: 3 }, importedDates: [] };
    if (endpoint === 'sales-import-batch') json = { reports: [{ date: '2026-10-25' }], dailyTotals: 2 };
    await route.fulfill({ json });
  });
  const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.goto(base + '/coupang-dashboard.html?since=2026-10-25&until=2026-10-27&channel=all');
  await page.waitForFunction(() => document.querySelectorAll('#ca-daily-head th').length === 6);
  assert.deepEqual(await page.locator('#ca-daily-head th').allTextContents(), ['일자 ↓', '매출', '이익금', '광고비', '기타비용', '순이익금']);
  assert.deepEqual(await page.locator('#ca-daily-body tr').first().locator('td').allTextContents(), ['합계', '250,000원수집분', '136,000원수집분', '30,000원수집분', '48,000원수집분', '106,000원수집분']);
  const unknown = await page.locator('#ca-daily-body tr').nth(1).locator('td').allTextContents();
  assert.deepEqual(unknown, ['2026-10-27', '—', '—', '자료 없음', '—', '—']);
  assert.match(await page.locator('#ca-daily-note').textContent(), /전체 확인 2일 · 부분 확인 0일 \/ 조회 3일/);
  for (const width of [1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(await page.locator('.ca-daily-panel .ca-scroll').evaluate(node => node.scrollWidth <= node.clientWidth + 1), true, 'six main columns must fit at ' + width);
  }
  await page.locator('#ca-daily-details').click(); assert.ok(await page.locator('#ca-daily-head th').count() > 6);
  await page.locator('#ca-daily-details').click(); assert.equal(await page.locator('#ca-daily-head th').count(), 6);
  await page.locator('#ca-calculation summary').click();
  assert.equal(await page.locator('#ca-calculation-date').inputValue(), '2026-10-26');
  assert.match(await page.locator('#ca-calculation-body').innerText(), /40,000원/);
  await page.locator('#ca-calculation-date').selectOption('2026-10-25');
  assert.match(await page.locator('#ca-calculation-body').innerText(), /역산하거나 배분하지 않습니다/);
  await page.locator('#ca-calculation-date').selectOption('2026-10-27');
  assert.match(await page.locator('#ca-calculation-body').innerText(), /광고비 자료 없음 · 순이익 계산 대기/);
  const downloadPromise = page.waitForEvent('download'); await page.locator('#ca-daily-export').click();
  const download = await downloadPromise, stream = await download.createReadStream();
  let csv = ''; for await (const chunk of stream) csv += chunk;
  assert.match(csv, /합계/);
  assert.match(csv, /106000/); assert.match(csv, /2026-10-27/);
  const settings = { schema: 'roas-coupang-sales-v1', reports: [], dailyTotals: daily.slice(0, 2).map(({ date, sales, profitBeforeAds, advertising, otherCosts }) => ({ date, sales, profitBeforeAds, advertising, otherCosts })), catalog: { products: [{ itemId: '123', name: '예시 상품', unitCost: 3000, commissionRate: 10, inboundFee: 100, deliveryFee: 200 }] } };
  await page.locator('#ca-reference-import').click();
  assert.equal(await page.locator('#ca-import').evaluate(node => node.open), true);
  await page.locator('#ca-file').setInputFiles({ name: 'synthetic-settings.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(settings)) });
  await page.locator('#ca-preview').click(); await page.locator('#ca-save:not(:disabled)').waitFor();
  assert.match(await page.locator('#ca-import-preview').innerText(), /106,000원/);
  await page.locator('#ca-save').click();
  await page.waitForFunction(() => document.getElementById('ca-import-status').textContent.includes('저장 완료'));
  assert.deepEqual(posts.map(p => p.endpoint), ['sales-import-batch'], 'catalogue costs and daily totals are saved atomically in one request');
  assert.equal(posts[0].body.products.length, 1); assert.equal(posts[0].body.products[0].unitCost, 3000);
  assert.equal(posts[0].body.dailyTotals.length, 2); assert.equal(posts[0].body.reports.length, 0);
  assert.deepEqual(errors, []);
  console.log('PASS canonical daily report, calculation evidence, missing ads, desktop fit, six columns, known subtotals, details, CSV and combined settings import');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { await browser?.close(); await new Promise(resolve => server.close(resolve)); });
