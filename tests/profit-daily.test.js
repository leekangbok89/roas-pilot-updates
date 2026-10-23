'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const day = '2026-09-01';
const accounts = ['11111', '22222'];

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roas-profit-test-'));
  const serverFile = path.join(dir, 'server.js');
  fs.copyFileSync(path.join(__dirname, '..', 'server.js'), serverFile);
  const app = require(serverFile);
  t.after(() => { delete require.cache[serverFile]; fs.rmSync(dir, { recursive: true, force: true }); });
  const write = (relative, value) => {
    const file = path.join(dir, '.roas-data', relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value));
  };
  const costs = {};
  const saveCost = (channel, name, option, cost, delivery = 0) => {
    const key = crypto.createHash('sha256').update(JSON.stringify([channel, name, option])).digest('hex').slice(0, 24);
    costs[key] = { channel, name, option, cost, delivery };
    write('product-costs.json', costs);
  };
  const ads = (account, rows = [], currency = '') => write(`daily/${account}/${day}.json`, { account, date: day, rows, currency, savedAt: '2026-09-02T00:00:00Z' });
  for (const channel of ['naver', 'cafe24']) {
    write(`${channel}-orders/orders.json`, { orders: {} });
    write(`${channel}-orders/sync.json`, { days: { [day]: { checkedAt: '2026-09-02T00:00:00Z' } } });
  }
  write('profit-fees.json', { naver: 7, cafe24: 3.5 });
  for (const account of accounts) ads(account);
  const report = (ids = accounts) => app.profitDaily(day, day, { accounts: ids, fx: 1350 });
  const row = (ids = accounts) => report(ids).days[0];
  const order = (channel, net, items) => write(`${channel}-orders/orders.json`, { orders: { order1: { id: 'order1', [channel === 'naver' ? 'paymentDate' : 'date']: day, net, items, unverified: false } } });
  return { ...app, dir, write, saveCost, ads, order, report, row };
}

test('combined profit uses both channels, their own fees, all ad spend, and sold-unit product costs', t => {
  const f = fixture(t);
  f.order('naver', 300000, [{ name: '백도씨', option: '화이트', quantity: 2 }]);
  f.order('cafe24', 200000, [{ name: '백도씨 자사몰', option: '화이트', quantity: 1 }]);
  f.saveCost('naver', '백도씨', '화이트', 110000, 9000);
  f.saveCost('cafe24', '백도씨 자사몰', '화이트', 70000, 8000);
  f.ads('11111', [{ spend: '10', account_currency: 'USD' }], 'USD');
  f.ads('22222', [{ spend: '4500', account_currency: 'KRW' }], 'KRW');
  const r = f.row();
  assert.equal(r.revenue, 500000);
  assert.equal(r.fee, 28000);
  assert.equal(r.cost, 290000, 'separately entered delivery must not alter the requested formula');
  assert.equal(r.adSpend, 18000);
  assert.equal(r.profit, 164000);
  assert.equal(r.complete, true);
  assert.deepEqual(r.reasons, []);
  const ai = f.strategySnapshot(accounts, day, day, 1350).days[0];
  assert.equal(ai.estimatedContribution, r.profit, 'AI and chart/table must use the same formula');
  assert.equal(ai.fees, r.fee);
});

test('a collected zero-sales channel and a verified empty Meta day are valid zeros', t => {
  const f = fixture(t);
  f.order('naver', 100000, [{ name: '상품', option: '', quantity: 1 }]);
  f.saveCost('naver', '상품', '', 40000);
  const r = f.row();
  assert.equal(r.cafe24.revenue, 0);
  assert.equal(r.cafe24.cost, 0);
  assert.equal(r.adSpend, 0, 'empty snapshot confirms zero even without account currency');
  assert.equal(r.profit, 53000);
  assert.equal(r.complete, true);
});

test('no orders with actual ad expense yields a negative profit rather than a missing value', t => {
  const f = fixture(t);
  f.ads('11111', [{ spend: '10000' }], 'KRW');
  assert.equal(f.row().profit, -10000);
  assert.equal(f.row().complete, true);
});

test('explicit zero unit cost and exactly zero profit remain valid values', t => {
  const f = fixture(t);
  f.write('profit-fees.json', { naver: 0, cafe24: 0 });
  f.order('naver', 10000, [{ name: '증정상품', option: '', quantity: 1 }]);
  f.saveCost('naver', '증정상품', '', 0);
  f.ads('11111', [{ spend: 10000 }], 'KRW');
  assert.equal(f.row().cost, 0);
  assert.equal(f.row().profit, 0);
  assert.equal(f.row().complete, true);
});

test('duplicate configured account IDs are deducted once', t => {
  const f = fixture(t);
  f.ads('11111', [{ spend: '7' }], 'USD');
  const report = f.report('act_11111,11111');
  assert.deepEqual(report.accounts, ['11111']);
  assert.equal(report.days[0].adSpend, 9450);
  assert.equal(report.days[0].profit, -9450);
});

test('missing one of the configured account snapshots does not turn unknown spend into zero', t => {
  const f = fixture(t);
  fs.unlinkSync(path.join(f.dir, '.roas-data', 'daily', '22222', day + '.json'));
  const r = f.row();
  assert.equal(r.adSpend, null);
  assert.equal(r.adComplete, false);
  assert.equal(r.profit, null);
  assert.match(r.reasons.join(' '), /광고비 미확인.*22222/);
});

test('missing channel collection does not infer zero sales', t => {
  const f = fixture(t);
  f.write('cafe24-orders/sync.json', { days: {} });
  const r = f.row();
  assert.equal(r.revenue, null);
  assert.equal(r.profit, null);
  assert.match(r.reasons.join(' '), /카페24: 주문 수집 미완료/);
});

test('unregistered option cost is null with a recoverable product/option reason', t => {
  const f = fixture(t);
  f.order('naver', 100000, [{ name: '상품', option: '추가 옵션', quantity: 1 }]);
  const r = f.row();
  assert.equal(r.revenue, 100000);
  assert.equal(r.cost, null);
  assert.equal(r.profit, null);
  assert.equal(r.naver.missingOrders, 1);
  assert.deepEqual(r.naver.missingCostItems, [{ name: '상품', option: '추가 옵션', orders: 1, reason: '원가 미입력' }]);
});

test('legacy orders without item metadata surface the catalog recovery action', t => {
  const f = fixture(t);
  f.order('naver', 100000, []);
  const r = f.row();
  assert.equal(r.profit, null);
  assert.equal(r.naver.missingItemOrders, 1);
  assert.match(r.reasons.join(' '), /판매품 가져오기/);
});

test('unverified persisted orders cannot silently become a zero-sale day', t => {
  const f = fixture(t);
  f.write('cafe24-orders/orders.json', { orders: { broken: { id: 'broken', date: day, unverified: true } } });
  const r = f.row();
  assert.equal(r.cafe24.revenue, null);
  assert.equal(r.profit, null);
  assert.match(r.reasons.join(' '), /결제금액·상태 미확인/);
});

test('unknown currency or malformed amount on nonempty ad rows blocks a made-up profit', t => {
  const f = fixture(t);
  f.ads('11111', [{ spend: '10' }], 'EUR');
  assert.equal(f.row().profit, null);
  assert.match(f.row().reasons.join(' '), /통화 미확인/);
  f.ads('11111', [{ spend: null }], 'KRW');
  assert.equal(f.row().profit, null);
  assert.match(f.row().reasons.join(' '), /금액 미확인/);
});

test('no selected accounts is unknown, while legacy calls remain backward compatible', t => {
  const f = fixture(t);
  const r = f.row([]);
  assert.equal(r.profit, null);
  assert.match(r.reasons.join(' '), /광고 계정 미설정/);
  const legacy = f.profitDaily(day, day).days[0];
  assert.equal(legacy.revenue, 0);
  assert.equal(Object.hasOwn(legacy, 'profit'), false);
  assert.throws(() => f.row(['invalid']), /광고 계정 ID/);
});
