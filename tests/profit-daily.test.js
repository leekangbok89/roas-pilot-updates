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
  f.order('naver', 300000, [{ name: '위마망 백도씨', option: '화이트', quantity: 2 }]);
  f.order('cafe24', 200000, [{ name: '위마망 백도씨 자사몰', option: '화이트', quantity: 1 }]);
  f.saveCost('naver', '위마망 백도씨', '화이트', 110000, 9000);
  f.saveCost('cafe24', '위마망 백도씨 자사몰', '화이트', 70000, 8000);
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
  f.order('naver', 100000, [{ name: '위마망 상품', option: '', quantity: 1 }]);
  f.saveCost('naver', '위마망 상품', '', 40000);
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
  f.order('naver', 10000, [{ name: '위마망 증정상품', option: '', quantity: 1 }]);
  f.saveCost('naver', '위마망 증정상품', '', 0);
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
  f.order('naver', 100000, [{ name: '위마망 상품', option: '추가 옵션', quantity: 1 }]);
  const r = f.row();
  assert.equal(r.revenue, 100000);
  assert.equal(r.cost, null);
  assert.equal(r.profit, null);
  assert.equal(r.naver.missingOrders, 1);
  assert.deepEqual(r.naver.missingCostItems, [{ name: '위마망 상품', option: '추가 옵션', orders: 1, reason: '원가 미입력' }]);
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

test('Cafe24 order item API shape restores exact product, option and quantity without invented cost',async t=>{
 const f=fixture(t);
 const answer=await f.cafeOrderItems('20261024-0000001',async url=>{
  assert.match(url,/orders\/20261024-0000001\/items\?shop_no=1/);
  return {items:[{product_name:'백도씨 하이브리드',option_value:'화이트',quantity:2},{product_name:'필터',option_value:'',quantity:1}]};
 });
 assert.deepEqual(answer.map(x=>({name:x.name,option:x.option,quantity:x.quantity})),[
  {name:'백도씨 하이브리드',option:'화이트',quantity:2},{name:'필터',option:'',quantity:1}
 ]);
});
test('Cafe24 item details fallback to order embed and fail closed on missing quantity',async t=>{
 const f=fixture(t),requests=[];
 const items=await f.cafeOrderItems('20261024-0000002',async url=>{
  requests.push(url);
  if(url.includes('/items?'))return {items:[]};
  return {order:{items:[{product_name:'상품A',option_value_default:'기본',quantity:'3'},{product_name:'상품B',option_value:'추가',quantity:null}]}};
 });
 assert.equal(requests.length,2);
 assert.match(requests[1],/embed=items/);
 assert.deepEqual(items,[], 'If any purchased item is missing quantity, refuse an incomplete cost total');
});
test('Cafe24 order parsing accepts order-items response fields and refuses incomplete item counts',t=>{
 const f=fixture(t);
 assert.deepEqual(f.itemsFromCafeOrder({items:[{product_name:'위마망 상품',option_value:'블랙',quantity:2}]}).map(x=>x.quantity),[2]);
 assert.equal(f.itemsFromCafeOrder({items:[{product_name:'위마망 상품',option_value:'블랙'}]}).length,0);
});

test('Cafe24 fallback still runs when first item-list endpoint returns HTTP 404',async t=>{
 const f=fixture(t),seen=[];
 const recovered=await f.cafeOrderItems('20261024-100000',async url=>{
  seen.push(url);
  if(url.includes('/items?'))throw Error('카페24 주문 조회 HTTP 404');
  return {order:{items:[{product_name:'위마망 백도씨',option_value:'화이트',quantity:2}]}};
 },entry=>seen.push(entry.result));
 assert.deepEqual(recovered.map(x=>({name:x.name,option:x.option,quantity:x.quantity})),[{name:'위마망 백도씨',option:'화이트',quantity:2}]);
 assert.ok(seen.some(v=>v==='API 404'));
 assert.ok(seen.some(v=>v==='복구 성공'));
});
test('Cafe24 failed item schemas expose only field names and never invent missing quantities',async t=>{
 const f=fixture(t),status=[];
 const result=await f.cafeOrderItems('20261024-100001',async url=>{
  return {items:[{product_name:'위마망 상품',option_value:'블랙'}]};
 },entry=>status.push(entry));
 assert.equal(result.length,0);
 assert.ok(status.some(x=>x.result==='상품명·옵션·수량 일부 미확인'));
 assert.ok(status.every(x=>!x.detail.includes('20261024-100001')));
});
test('Cafe24 catalog diagnosis returns order counts and dates without order identifiers, amounts or credentials',t=>{
 const f=fixture(t);
 f.order('cafe24',40000,[]);
 const d=f.catalogDiagnostics();
 assert.equal(d.cafe24.total,1);
 assert.equal(d.cafe24.byDate[day],1);
 assert.equal(JSON.stringify(d).includes('order1'),false);
 assert.equal(JSON.stringify(d).includes('40000'),false);
});

test('Explicit channel-specific alias restores missing option cost without changing stored source',t=>{
 const f=fixture(t),src='위마망 백도씨',target='위마망 백도씨';
 f.order('cafe24',300000,[{name:target,option:'화이트 신형',quantity:2}]);
 f.saveCost('cafe24',src,'화이트',85000);
 assert.equal(f.row().profit,null);
 const sourceKey=crypto.createHash('sha256').update(JSON.stringify(['cafe24',src,'화이트'])).digest('hex').slice(0,24);
 const result=f.linkCostAlias({channel:'cafe24',name:target,option:'화이트 신형',sourceKey});
 assert.equal(result.cost,85000);
 assert.equal(f.row().cost,170000);
 assert.equal(f.row().profit,119500);
 f.saveCost('cafe24',src,'화이트',90000);
 assert.equal(f.row().cost,180000,'Alias tracks updates to the original source cost');
 assert.equal(f.row().profit,109500);
 assert.equal(f.unlinkCostAlias({channel:'cafe24',name:target,option:'화이트 신형'}).unlinked,true);
 assert.equal(f.row().profit,null);
});
test('Cost alias disallows cross-channel mapping, fabricated target and blank source costs',t=>{
 const f=fixture(t);
 f.order('naver',100000,[{name:'위마망 아직 미연결',option:'기본',quantity:1}]);
 f.saveCost('cafe24','다른 채널','기본',34000);
 f.saveCost('naver','원가 미입력','기본',null);
 const key=(channel,name,variant)=>crypto.createHash('sha256').update(JSON.stringify([channel,name,variant])).digest('hex').slice(0,24);
 assert.throws(()=>f.linkCostAlias({channel:'naver',name:'위마망 아직 미연결',option:'기본',sourceKey:key('cafe24','다른 채널','기본')}),/동일한 판매 채널/);
 assert.throws(()=>f.linkCostAlias({channel:'naver',name:'위마망 아직 미연결',option:'기본',sourceKey:key('naver','원가 미입력','기본')}),/유효한 원가/);
 f.saveCost('naver','기존 상품','기본',25000);
 assert.throws(()=>f.linkCostAlias({channel:'naver',name:'주문에 없음',option:'기본',sourceKey:key('naver','기존 상품','기본')}),/실제 판매 주문/);
});
test('Directly saved option cost takes precedence over earlier cost alias',t=>{
 const f=fixture(t),sourceKey=crypto.createHash('sha256').update(JSON.stringify(['naver','기존','블랙'])).digest('hex').slice(0,24);
 f.order('naver',100000,[{name:'위마망 새 옵션명',option:'블랙',quantity:1}]);
 f.saveCost('naver','기존','블랙',10000);
 f.linkCostAlias({channel:'naver',name:'위마망 새 옵션명',option:'블랙',sourceKey});
 assert.equal(f.row().cost,10000);
 f.saveCost('naver','위마망 새 옵션명','블랙',19000);
 assert.equal(f.row().cost,19000);
});

test('Wemamang classification includes explicit keyword, excludes Truver, and requires confirmation for neither or both',t=>{
 const f=fixture(t);
 assert.equal(f.brandForProduct('위마망 백도씨',{}).scope,'wemamang');
 assert.equal(f.brandForProduct('트루버 사하라 프로',{}).scope,'excluded');
 assert.equal(f.brandForProduct('세척기 기타',{}).scope,'unclassified');
 assert.equal(f.brandForProduct('위마망 트루버 세트',{}).scope,'unclassified');
});
test('Only confirmed Wemamang order revenue and cost count; excluded Truver sale is not included',t=>{
 const f=fixture(t);
 f.write('naver-orders/orders.json',{orders:{
  a:{id:'a',paymentDate:day,net:100000,items:[{name:'위마망 백도씨',option:'화이트',quantity:1}]},
  b:{id:'b',paymentDate:day,net:300000,items:[{name:'트루버 사하라',option:'블랙',quantity:1}]}
 }});
 f.saveCost('naver','위마망 백도씨','화이트',40000);
 const r=f.row();assert.equal(r.naver.revenue,100000);assert.equal(r.naver.cost,40000);assert.equal(r.naver.excludedOrders,1);
 assert.equal(r.profit,53000);
});
test('Unclassified product blocks estimated profit until user chooses a brand',t=>{
 const f=fixture(t),name='무명 구성품';
 f.order('cafe24',100000,[{name,option:'하얀색',quantity:2}]);
 assert.equal(f.row().profit,null);
 assert.match(f.row().reasons.join(' '),/미분류 주문/);
 const pick=f.saveBrandScope({name,scope:'wemamang'});
 assert.equal(pick.classification.scope,'wemamang');
 f.saveCost('cafe24',name,'하얀색',12000);
 assert.equal(f.row().cafe24.revenue,100000);
 assert.equal(f.row().profit,72500);
});
test('User can explicitly exclude unclassified product, eliminating its revenue and cost',t=>{
 const f=fixture(t),name='중립 상품';
 f.order('cafe24',100000,[{name,option:'기본',quantity:1}]);
 f.saveBrandScope({name,scope:'excluded'});
 const r=f.row();assert.equal(r.cafe24.revenue,0);assert.equal(r.cafe24.cost,0);assert.equal(r.cafe24.excludedOrders,1);assert.equal(r.profit,0);
});
test('Mixed-brand orders stay unconfirmed rather than using full order value for Wemamang',t=>{
 const f=fixture(t);
 f.order('cafe24',200000,[{name:'위마망 부속',option:'',quantity:1},{name:'트루버 링가드',option:'',quantity:1}]);
 f.saveCost('cafe24','위마망 부속','',10000);
 const r=f.row();assert.equal(r.cafe24.revenue,null);assert.equal(r.profit,null);
 assert.match(r.reasons.join(' '),/혼합 주문/);
});
