'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), http = require('node:http'), path = require('node:path');
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
  const base = 'http://127.0.0.1:' + server.address().port, posts = [], errors = [], external = [];
  let revision = 1;
  const state = { configured: true, vendorKey: 'synthetic-vendor', scopeKey: 'synthetic-scope', revision: 'r1', groups: [], products: [
    { itemId: '111', productId: '900', name: '합성 상품 파랑', productName: '합성 상품', optionName: '파랑', channel: 'growth', salePrice: 10000, unitCost: 1000, commissionRate: 8, inboundFee: 150, deliveryFee: 250, costSince: '2026-01-01' },
    { itemId: '222', productId: '900', name: '합성 상품 빨강', productName: '합성 상품', optionName: '빨강', channel: 'seller', salePrice: 12000, unitCost: 2000, commissionRate: 12, inboundFee: 0, deliveryFee: 400, costSince: '2026-02-01' },
    { itemId: '333', productId: '901', name: '별도 상품 초록', productName: '별도 상품', optionName: '초록', channel: 'growth', salePrice: 20000, unitCost: 3000, commissionRate: 9, inboundFee: 300, deliveryFee: 600, costSince: '2026-03-01' }
  ] };
  const initial = structuredClone(state.products), find = id => state.products.find(product => product.itemId === id);
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Asia/Seoul' });
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin !== base) { external.push(req.url()); return route.abort(); }
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const endpoint = url.pathname.split('/').pop();
    if (endpoint === 'workspace') return route.fulfill({ json: structuredClone(state) });
    if (endpoint === 'thumbnails') return route.fulfill({ json: { vendorKey: state.vendorKey, scopeKey: state.scopeKey, items: [], needsSync: false, job: { running: false, status: 'idle' } } });
    if (req.method() === 'POST') {
      const body = req.postDataJSON(); posts.push({ endpoint, body });
      assert.equal(req.headers()['x-roas-local-action'], 'yes');
      if (body.revision !== state.revision || body.scopeKey !== state.scopeKey) return route.fulfill({ status: 409, json: { error: 'Changed workspace' } });
      if (endpoint === 'products-update') {
        const ids = new Set(body.itemIds);
        for (const product of state.products) if (ids.has(product.itemId)) Object.assign(product, body.changes);
      } else if (endpoint === 'product-update') {
        for (const key of ['unitCost', 'commissionRate', 'inboundFee', 'deliveryFee', 'costSince']) find(body.itemId)[key] = body[key];
      } else throw Error('Unexpected mutation ' + endpoint);
      state.revision = 'r' + (++revision);
      return route.fulfill({ json: structuredClone(state) });
    }
    await route.fulfill({ json: {} });
  });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + '/coupang-products.html');
  await page.waitForFunction(() => document.getElementById('cpm-count').textContent.includes('3개 옵션'));
  const bulk = page.locator('#cpm-bulk-editor'), groupButton = page.locator('.cpm-bulk-product[data-product-id="900"]');
  await page.locator('#cpm-channel').selectOption('growth');
  assert.match(await page.locator('#cpm-count').textContent(), /2개 상품 · 2개 옵션/);
  await groupButton.click();
  assert.match(await page.locator('#cpm-bulk-scope').textContent(), /검색·배송 필터와 관계없이.*전체 2개 옵션/);
  assert.equal(await page.locator('#cpm-bulk-preview tbody tr').count(), 2, 'The product action includes the seller option hidden by the shipping filter');
  assert.match(await page.locator('#cpm-bulk-preview').innerText(), /옵션 ID 111/); assert.match(await page.locator('#cpm-bulk-preview').innerText(), /옵션 ID 222/);
  assert.equal(await page.locator('#cpm-bulk-mixed').isVisible(), true);
  for (const key of ['unitCost', 'commissionRate', 'inboundFee', 'deliveryFee', 'costSince']) {
    assert.equal(await page.locator('#cpm-bulk-use-' + key).isChecked(), key === 'unitCost');
    assert.equal(await page.locator('#cpm-bulk-' + key).isDisabled(), key !== 'unitCost');
  }
  assert.equal(await page.locator('#cpm-bulk-unitCost').inputValue(), '', 'Mixed old costs never silently choose the first option cost');
  assert.equal(await page.locator('#cpm-bulk-save').isDisabled(), true);
  await page.locator('#cpm-bulk-form').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  assert.match(await page.locator('#cpm-bulk-error').textContent(), /값을 입력/); assert.equal(posts.length, 0);
  await page.locator('#cpm-bulk-unitCost').fill('-1'); assert.equal(await page.locator('#cpm-bulk-save').isDisabled(), true);
  await page.locator('#cpm-bulk-cancel').click(); assert.equal(await bulk.isVisible(), false); assert.equal(posts.length, 0);
  await groupButton.click(); await page.locator('#cpm-bulk-unitCost').fill('5000'); await page.keyboard.press('Escape'); assert.equal(await bulk.isVisible(), false); assert.equal(posts.length, 0, 'Escape and cancel never save a draft');

  await groupButton.click(); await page.locator('#cpm-bulk-unitCost').fill('5000');
  assert.match(await page.locator('#cpm-bulk-preview').innerText(), /1,000원 → 5,000원/); assert.match(await page.locator('#cpm-bulk-preview').innerText(), /2,000원 → 5,000원/);
  assert.match(await page.locator('#cpm-bulk-fee-example').textContent(), /10,000원 × 8% = 800원/);
  await page.locator('#cpm-bulk-save').click(); await bulk.waitFor({ state: 'hidden' });
  assert.deepEqual(posts[0], { endpoint: 'products-update', body: { scopeKey: 'synthetic-scope', revision: 'r1', itemIds: ['111', '222'], changes: { unitCost: 5000 } } });
  for (const id of ['111', '222']) {
    assert.equal(find(id).unitCost, 5000);
    for (const key of ['commissionRate', 'inboundFee', 'deliveryFee', 'costSince']) assert.equal(find(id)[key], initial.find(p => p.itemId === id)[key], 'Cost-only edits preserve ' + key);
  }
  assert.deepEqual(find('333'), initial[2]);

  await page.locator('#cpm-channel').selectOption('all'); await page.locator('#cpm-expand').click();
  await page.locator('.cpm-option-row').filter({ hasText: '옵션 ID 222' }).locator('input[type=checkbox]').check();
  await page.locator('.cpm-option-row').filter({ hasText: '옵션 ID 333' }).locator('input[type=checkbox]').check();
  await page.locator('#cpm-channel').selectOption('growth');
  assert.equal(await page.locator('.cpm-option-row').filter({ hasText: '옵션 ID 222' }).count(), 0);
  assert.equal(await page.locator('#cpm-selected').textContent(), '선택 2개 옵션');
  await page.locator('#cpm-bulk-selected').click();
  const selectedText = await page.locator('#cpm-bulk-preview').innerText();
  assert.match(selectedText, /옵션 ID 222/); assert.match(selectedText, /옵션 ID 333/); assert.doesNotMatch(selectedText, /옵션 ID 111/);
  await page.locator('#cpm-bulk-use-unitCost').uncheck(); assert.equal(await page.locator('#cpm-bulk-save').isDisabled(), true);
  await page.locator('#cpm-bulk-use-deliveryFee').check(); await page.locator('#cpm-bulk-deliveryFee').fill('700');
  await page.locator('#cpm-bulk-save').click(); await bulk.waitFor({ state: 'hidden' });
  assert.deepEqual(posts[1].body, { scopeKey: 'synthetic-scope', revision: 'r2', itemIds: ['222', '333'], changes: { deliveryFee: 700 } });
  assert.equal(find('111').deliveryFee, 250); assert.equal(find('222').deliveryFee, 700); assert.equal(find('333').deliveryFee, 700);
  assert.equal(find('222').unitCost, 5000); assert.equal(find('333').unitCost, 3000);
  assert.equal(find('222').costSince, '2026-02-01'); assert.equal(find('333').costSince, '2026-03-01');

  await page.locator('#cpm-bulk-selected').click(); await page.locator('#cpm-bulk-unitCost').fill('6500');
  const frozenRevision = state.revision;
  state.products.push({ ...structuredClone(initial[2]), itemId: '444', optionName: '새 옵션' }); state.revision = 'r' + (++revision);
  const reload = page.waitForResponse(response => new URL(response.url()).pathname === '/api/coupang/workspace');
  // Exercise a concurrent accepted workspace response without exposing app internals.
  await page.locator('#cpm-reload').evaluate(button => button.click()); await reload;
  await page.waitForFunction(() => document.getElementById('cpm-selected').textContent === '선택 0개 옵션');
  assert.equal(await bulk.isVisible(), true); assert.equal(await page.locator('#cpm-bulk-unitCost').inputValue(), '6500');
  await page.locator('#cpm-bulk-save').click();
  await page.waitForFunction(() => document.getElementById('cpm-bulk-error').textContent.includes('다른 화면'));
  assert.equal(await bulk.isVisible(), true); assert.equal(await page.locator('#cpm-bulk-unitCost').inputValue(), '6500');
  assert.deepEqual(posts[2].body, { scopeKey: 'synthetic-scope', revision: frozenRevision, itemIds: ['222', '333'], changes: { unitCost: 6500 } });
  assert.equal(find('222').unitCost, 5000); assert.equal(find('333').unitCost, 3000); assert.equal(find('444').unitCost, 3000);
  await page.locator('#cpm-bulk-cancel').click();

  await page.locator('#cpm-channel').selectOption('all');
  const single = page.locator('.cpm-option-row').filter({ hasText: '옵션 ID 222' });
  await single.getByRole('button', { name: '비용 수정', exact: true }).click();
  assert.equal(await page.locator('#cpm-unit-cost').inputValue(), '5000'); assert.equal(await page.locator('#cpm-commission').inputValue(), '12');
  assert.equal(await page.locator('#cpm-inbound').inputValue(), '0'); assert.equal(await page.locator('#cpm-delivery').inputValue(), '700');
  await page.locator('#cpm-unit-cost').fill('5200'); await page.locator('#cpm-edit-save').click(); await page.locator('#cpm-editor').waitFor({ state: 'hidden' });
  assert.equal(posts[3].endpoint, 'product-update'); assert.equal(posts[3].body.itemId, '222'); assert.equal(find('222').unitCost, 5200);
  assert.equal(find('111').unitCost, 5000); assert.equal(find('333').unitCost, 3000);

  await page.setViewportSize({ width: 390, height: 844 }); await groupButton.click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'The table and bulk preview do not widen a mobile page');
  const box = await bulk.boundingBox(); assert.ok(box.width <= 390);
  assert.equal(await page.locator('#cpm-bulk-preview').evaluate(element => element.scrollWidth > element.clientWidth && getComputedStyle(element).overflowX === 'auto'), true);
  await page.keyboard.press('Escape'); assert.equal(posts.length, 4);
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log('PASS product-wide and exact-selection bulk edits, hidden options, opt-in fields, blank/zero safety, frozen IDs/revisions, atomic action headers, 409 draft retention, single-editor compatibility and contained mobile preview');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { await browser?.close(); await new Promise(resolve => server.close(resolve)); });
