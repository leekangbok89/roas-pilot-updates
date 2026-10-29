'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const extract = require('../public/monitoring-extract.js');
const ctx = { today: '2026-10-29', year: 2026 };

// A small semantic DOM fixture makes the renderer-independent extraction
// contract testable without installing a browser or a third-party DOM parser.
function text(value) { return { nodeType: 3, textContent: value }; }
function node(tag, attrs = {}, childNodes = []) {
  const element = {
    nodeType: 1, tagName: tag.toUpperCase(), attrs, childNodes: childNodes.map(child => typeof child === 'string' ? text(child) : child),
    getAttribute(name) { return this.attrs[name] ?? null; },
    get hidden() { return Object.hasOwn(this.attrs, 'hidden'); },
    get children() { return this.childNodes.filter(child => child.nodeType === 1); },
    get textContent() { return this.childNodes.map(child => child.textContent).join(''); },
    get innerText() { return this.childNodes.map(child => child.innerText ?? child.textContent).join('\n'); },
    querySelectorAll(selector) {
      const selectors = selector.split(',').map(s => s.trim());
      const matches = child => selectors.some(part => {
        const m = /^(\w+)?(?:\[([\w-]+)(?:(\*=|=)"([^"]*)")?\])?$/.exec(part);
        if (!m || m[1] && child.tagName !== m[1].toUpperCase()) return false;
        if (!m[2]) return true;
        const value = child.getAttribute(m[2]);
        return m[3] === '=' ? value === m[4] : m[3] === '*=' ? value !== null && value.includes(m[4]) : value !== null;
      });
      const found = [];
      function visit(current) { for (const child of current.children) { if (matches(child)) found.push(child); visit(child); } }
      visit(this); return found;
    }
  };
  for (const child of element.children) child.parentElement = element;
  Object.defineProperty(element, 'nextElementSibling', { get() { const siblings = this.parentElement?.children || [], i = siblings.indexOf(this); return siblings[i + 1] || null; } });
  return element;
}
function document(children, url) {
  const body = node('body', {}, children), doc = { nodeType: 9, body, location: { href: url }, querySelectorAll: selector => body.querySelectorAll(selector) };
  function assign(element) { element.ownerDocument = doc; for (const child of element.children) assign(child); }
  assign(body); return doc;
}
const metric = (label, value) => node('div', {}, [node('span', {}, [label]), node('span', {}, [value])]);
function card(id = '12345', options = {}) {
  return node('div', { draggable: 'true', ...options.cardAttrs }, [
    node('a', { href: '/monitoring/day/naver?productId=' + id + '&classificationType=product&isTeamProduct=false' }, [
      node('div', {}, [node('img', { alt: 'item-image', src: 'https://images.example.com/product.jpg' })]),
      node('span', {}, [node('span', {}, ['테스트브랜드']), '테스트브랜드 실제 상품']),
      metric('가격', '39,000원'), metric('배송비', '0원'), metric('리뷰', '0개'), metric('평점', '—')
    ])
  ]);
}
function summary() {
  return node('section', {}, [
    node('div', {}, [node('img', { alt: 'item-image', src: 'https://images.example.com/product.jpg' })]),
    node('div', {}, [
      node('div', {}, [node('span', {}, ['테스트브랜드']), node('span', {}, ['테스트브랜드 실제 상품'])]),
      metric('가격', '1,000원'), metric('리뷰', '8개'), metric('배송비', '무료배송'),
      node('div', {}, ['카테고리 ', node('span', {}, ['생활>주방'])]),
      node('div', {}, [node('span', {}, ['태그 키워드']), node('span', {}, ['# 실제태그'])])
    ])
  ]);
}
function table(rows, header = false) { return node('table', {}, [node(header ? 'thead' : 'tbody', {}, rows.map(row => node('tr', {}, row.map(value => node(header ? 'th' : 'td', {}, [value])))))]); }

test('only canonical Sellha monitoring routes and positive exact product identities are accepted', () => {
  assert.deepEqual(extract.sourceIdentity('https://sellha.kr/monitoring/day/naver?productId=123&classificationType=product&isTeamProduct=false&token=secret#fragment'), {
    platform: 'naver', productId: '123', sourceUrl: 'https://sellha.kr/monitoring/day/naver?productId=123&classificationType=product&isTeamProduct=false'
  });
  for (const url of ['https://evil.example/monitoring/day/naver?productId=123', 'https://sellha.kr/growth/dashboard', 'https://sellha.kr/monitoring/day/naver?productId=0', 'http://sellha.kr/monitoring/day/naver', 'https://x:y@sellha.kr/monitoring/day/naver']) assert.throws(() => extract.sourceIdentity(url), error => error.code === 'SOURCE_UNSUPPORTED');
});

test('rank states, range, pagination and secondary rank values preserve only observed information', () => {
  assert.deepEqual(extract.parseRank('53위 - 2페이지 13위\n▲ 3\n브랜드묶음내 1위\n광고 4위\n광고 개수 0개'), { rank: 53, status: 'ranked', groupRank: 1, adRank: 4, adCount: 0, page: 2, position: 13 });
  assert.deepEqual(extract.parseRank('53위'), { rank: 53, status: 'ranked' });
  assert.deepEqual(extract.parseRank('100위 밖'), { rank: null, status: 'outside', outsideLimit: 100 });
  assert.deepEqual(extract.parseRank('미노출'), { rank: null, status: 'outside' });
  assert.deepEqual(extract.parseRank('업데이트 중'), { rank: null, status: 'pending' });
  assert.deepEqual(extract.parseRank('-위'), { rank: null, status: 'missing' });
  assert.deepEqual(extract.parseRank('광고 2위'), { rank: null, status: 'missing', adRank: 2 });
  assert.equal(extract.parseRank(''), null);
  assert.throws(() => extract.parseRank('0위'));
  assert.throws(() => extract.parseRank('이상한 형식'));
});

test('date headers cross a real year boundary and reject future, duplicate or impossible dates', () => {
  const options = { today: '2027-01-02', year: 2027 };
  assert.deepEqual(extract.parseDates(['키워드', '검색량', '01. 02', '01. 01', '12. 31', ''], options), [
    { index: 2, date: '2027-01-02' }, { index: 3, date: '2027-01-01' }, { index: 4, date: '2026-12-31' }
  ]);
  assert.deepEqual(extract.parseDates(['2026-10-29', '2026-10-28'], ctx), [{ index: 0, date: '2026-10-29' }, { index: 1, date: '2026-10-28' }]);
  assert.throws(() => extract.parseDates(['10. 30'], ctx), /미래/);
  assert.throws(() => extract.parseDates(['10. 29', '10. 29'], ctx), /중복/);
  assert.throws(() => extract.parseDates(['02. 30'], ctx));
  assert.throws(() => extract.parseDates(['10. 29'], { today: ctx.today }));
});

test('split header and body tables preserve blanks, zero search volume and source ranks', () => {
  const result = extract.parseRankTables([
    [['상품명 키워드', '테스트']],
    [['키워드', '검색량', '10. 29', '10. 28', '']],
    [[' ', ' ', ' ', ' '], ['실제키워드', '0', '1위 - 1페이지 1위', '80위 밖', ''], ['다른키워드', '—', '업데이트 중', '']]
  ], { platform: 'naver', productId: '12345' }, ctx);
  assert.deepEqual(result.keywords, [{ keyword: '실제키워드', searchVolume: 0 }, { keyword: '다른키워드', searchVolume: null }]);
  assert.equal(result.snapshots.length, 2);
  assert.equal(result.snapshots[0].keywords.length, 2);
  assert.equal(result.snapshots[1].keywords.length, 1);
  assert.equal(result.snapshots[1].keywords[0].outsideLimit, 80);
  assert.equal(Object.hasOwn(result.snapshots[1].keywords[0], 'searchVolume'), false, 'current keyword volume must not become a historical volume');
  assert.throws(() => extract.parseRankTables([[['키워드', '검색량', '10. 29']], [['']]], { platform: 'naver', productId: '12345' }, ctx), error => error.code === 'SOURCE_NOT_READY');
});

test('product metrics distinguish explicit zero/free shipping, missing values and absent fields', () => {
  assert.deepEqual(extract.parseProductText('테스트 상품\n가격 0원\n배송비 무료배송\n리뷰 0개\n평점 —', { name: '테스트 상품' }), { name: '테스트 상품', price: 0, shipping: 0, reviews: 0, rating: null });
  const minimal = extract.parseProductText('테스트 상품\n가격 1,200원');
  assert.equal(minimal.price, 1200); assert.equal(Object.hasOwn(minimal, 'reviews'), false);
  assert.throws(() => extract.parseProductText('가격 1,000원'), error => error.code === 'SOURCE_NOT_READY');
});

test('list extraction reads semantic title spans and never replaces complete keyword lists with three pills', () => {
  const url = 'https://sellha.kr/monitoring/day/naver';
  const doc = document([card('12345'), card('98765', { cardAttrs: { hidden: true } })], url);
  const result = extract.extract(doc, { ...ctx, url });
  assert.equal(result.products.length, 1);
  assert.equal(result.products[0].name, '테스트브랜드 실제 상품');
  assert.equal(result.products[0].brand, '테스트브랜드');
  assert.equal(result.products[0].price, 39000);
  assert.equal(result.products[0].reviews, 0);
  assert.equal(Object.hasOwn(result.products[0], 'keywords'), false);
  assert.equal(result.snapshots[0].rating, null);
  assert.equal(result.snapshots[0].date, ctx.today);
});

test('detail extraction joins rendered tables and attaches current metadata only to today', () => {
  const url = 'https://sellha.kr/monitoring/day/naver?productId=12345&classificationType=product';
  const doc = document([summary(), table([['키워드', '검색량', '10. 29', '10. 28']], true), table([['키워드A', '700', '2위 - 1페이지 2위\n브랜드묶음내 1위', '1위']])], url);
  const result = extract.extract(doc, { ...ctx, url });
  assert.equal(result.products[0].name, '테스트브랜드 실제 상품');
  assert.equal(result.products[0].category, '생활>주방');
  assert.deepEqual(result.products[0].tags, ['실제태그']);
  assert.equal(result.snapshots[0].price, 1000); assert.equal(result.snapshots[0].shipping, 0);
  assert.equal(Object.hasOwn(result.snapshots[1], 'price'), false);
  assert.equal(Object.hasOwn(result.snapshots[0], 'sales'), false);
  assert.equal(result.snapshots[0].keywords[0].rank, 2);
  assert.equal(result.snapshots[0].keywords[0].groupRank, 1);
});

test('rolling seven-day quantity is separate from daily sales and requires an explicit numeric sibling', () => {
  const url = 'https://sellha.kr/monitoring/day/naver?productId=12345';
  const elements = [summary(), table([['키워드', '검색량', '10. 29']], true), table([['키워드A', '700', '2위']]), node('section', {}, [node('h3', {}, ['스마트 스토어 7일 구매 건수']), node('span', {}, ['12건'])])];
  let result = extract.extract(document(elements, url), { ...ctx, url });
  assert.equal(result.snapshots[0].rollingSales7d, 12);
  assert.equal(Object.hasOwn(result.snapshots[0], 'sales'), false);
  const chart = node('section', {}, [node('h3', {}, ['스마트 스토어 7일 구매 건수']), node('div', {}, ['1 2 3 4 5'])]);
  result = extract.extract(document(elements.slice(0, 3).concat(chart), url), { ...ctx, url });
  assert.equal(Object.hasOwn(result.snapshots[0], 'rollingSales7d'), false, 'chart axis numbers cannot become a sale count');
});

test('login, bot checks and incomplete pages stop collection instead of returning empty success', () => {
  const url = 'https://sellha.kr/monitoring/day/naver';
  assert.throws(() => extract.extract(document([node('input', { type: 'password' })], url), { ...ctx, url }), error => error.code === 'AUTH_REQUIRED');
  assert.throws(() => extract.extract(document([node('p', {}, ['Verify you are human'])], url), { ...ctx, url }), error => error.code === 'SOURCE_BLOCKED');
  assert.throws(() => extract.extract(document([node('p', {}, ['불러오는 중'])], url), { ...ctx, url }), error => error.code === 'SOURCE_NOT_READY');
  assert.throws(() => extract.extract(document([summary()], url), { ...ctx, url: url + '?productId=12345' }), error => error.code === 'SOURCE_NOT_READY');
});

test('Coupang variant routing, unknown ordinary price and distinct Wow price are preserved', () => {
  const url = 'https://sellha.kr/monitoring/day/coupang?productId=731&vendorItemId=8844&itemId=1873&isTeamProduct=false';
  const item = node('div', { draggable: 'true' }, [node('a', { href: url }, [
    node('img', { alt: 'item-image', src: 'https://thumbnail.coupangcdn.com/product.jpg' }),
    node('span', {}, [node('img', { alt: 'merchant_rocket', src: 'data:image/png;base64,AA==' }), '실제 요리용 토치, 실버, 1개']),
    metric('쿠팡판매가', '원'), metric('와우할인가', '29,800원'), metric('리뷰', '40개'), metric('배송비', '0원'), metric('평점', '4.3점')
  ])]);
  const result = extract.extract(document([item], 'https://sellha.kr/monitoring/day/coupang'), { ...ctx, url: 'https://sellha.kr/monitoring/day/coupang' });
  assert.equal(result.products[0].name, '실제 요리용 토치, 실버, 1개');
  assert.equal(result.products[0].price, null);
  assert.equal(result.products[0].wowPrice, 29800);
  assert.equal(result.snapshots[0].price, null);
  assert.equal(result.snapshots[0].wowPrice, 29800);
  assert.equal(result.products[0].sourceUrl, url);
  assert.deepEqual(extract.parseRank('216위 밖'), { rank: null, status: 'outside', outsideLimit: 216 });
  assert.equal(extract.parseProductText('실제 상품\n쿠팡판매가 0원\n와우할인가 29,800원').price, 0, 'detail zero stays observed zero rather than becoming Wow price');
  assert.throws(() => extract.sourceIdentity(url.replace('itemId=1873', 'itemId=bad')), error => error.code === 'SOURCE_UNSUPPORTED');
  assert.throws(() => extract.sourceIdentity('https://sellha.kr/monitoring/day/coupang?productId=731'), error => error.code === 'SOURCE_UNSUPPORTED');
  assert.throws(() => extract.sourceIdentity('https://sellha.kr/monitoring/day/coupang?productId=731&vendorItemId=8844'), error => error.code === 'SOURCE_UNSUPPORTED');
});

test('only visible complete review records are collected and customer identities are omitted', () => {
  const url = 'https://sellha.kr/monitoring/day/naver?productId=12345';
  const review = node('article', { 'data-review-id': 'review-100' }, [
    node('span', { 'data-review-author': 'private-user' }, ['사용자 닉네임']),
    node('time', {}, ['2026. 10. 28']), node('span', { 'data-review-score': '' }, ['4.0점']), node('p', { 'data-review-content': '' }, ['실제 표시된 후기입니다.'])
  ]);
  const hidden = node('article', { 'data-review-id': 'review-200', hidden: true }, [node('time', {}, ['2026. 10. 28']), node('span', { 'data-review-score': '' }, ['5점']), node('p', { 'data-review-content': '' }, ['숨김 후기'])]);
  const placeholders = node('article', { 'data-review-id': 'review-300' }, [node('p', { 'data-review-content': '' }, ['아직 로딩중'])]);
  const doc = document([summary(), table([['키워드', '검색량', '10. 29']], true), table([['키워드A', '700', '2위']]), review, hidden, placeholders], url);
  const result = extract.extract(doc, { ...ctx, url });
  assert.deepEqual(result.reviews, [{ platform: 'naver', productId: '12345', id: 'review-100', date: '2026-10-28', rating: 4, text: '실제 표시된 후기입니다.' }]);
  assert.equal(JSON.stringify(result.reviews).includes('private-user'), false);
  assert.equal(JSON.stringify(result.reviews).includes('닉네임'), false);

  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'monitoring-review-extraction-'));
  try {
    const { createService } = require('../integrations/monitoring/service.cjs');
    const monitoring = createService({ baseDir: directory, today: () => ctx.today });
    const saved = monitoring.importData({ ...result, revision: 0 });
    assert.equal(saved.reviews.length, 1);
    assert.equal(saved.reviews[0].rating, 4);
    assert.equal(saved.reviews[0].text, '실제 표시된 후기입니다.');
    assert.equal(saved.reviews[0].productId, saved.products[0].id);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('Coupang detail summary does not require the Naver 가격 label', () => {
  const url = 'https://sellha.kr/monitoring/day/coupang?productId=731&vendorItemId=8844&itemId=1873&isTeamProduct=false';
  const summary = node('section', {}, [
    node('div', {}, [node('img', { alt: 'item-image', src: 'https://thumbnail.coupangcdn.com/product.jpg' })]),
    node('div', {}, [node('span', {}, ['실제 요리용 토치, 실버, 1개'])]),
    metric('쿠팡판매가', '0원'), metric('와우할인가', '29,800원'), metric('리뷰', '40개'), metric('배송비', '0원'), metric('평점', '4.3점'),
    node('div', {}, ['카테고리 ', node('span', {}, ['쿠팡 홈 > 캠핑 > 가스토치'])])
  ]);
  const doc = document([summary, table([['키워드', '검색량', '10. 29']], true), table([['시어링토치', '700', '216위 밖']])], url);
  const result = extract.extract(doc, { ...ctx, url });
  assert.equal(result.products[0].name, '실제 요리용 토치, 실버, 1개');
  assert.equal(result.products[0].price, 0);
  assert.equal(result.products[0].wowPrice, 29800);
  assert.equal(result.snapshots[0].keywords[0].outsideLimit, 216);
});

test('registered-count evidence rejects collapsed or virtualized partial lists and distinguishes explicit empty', () => {
  const url = 'https://sellha.kr/monitoring/day/naver';
  const partial = document([node('div', {}, ['🔸 등록 상품 수', node('strong', {}, ['2개']), '/ 600']), card('12345')], url);
  assert.throws(() => extract.extract(partial, { ...ctx, url }), error => error.code === 'SOURCE_PARTIAL' && /2개 중 1개/.test(error.message));
  const complete = document([node('div', {}, ['등록 상품 수 1개 / 600']), card('12345')], url);
  assert.equal(extract.extract(complete, { ...ctx, url }).products.length, 1);
  const empty = document([node('div', {}, ['등록 상품 수 0개 / 600'])], url);
  const result = extract.extract(empty, { ...ctx, url });
  assert.deepEqual(result.products, []); assert.deepEqual(result.snapshots, []);
  assert.throws(() => extract.extract(document([], url), { ...ctx, url }), error => error.code === 'SOURCE_NOT_READY');
});

test('Coupang rank headers may omit the search-volume label without inventing volume', () => {
  const grids = [[['키워드', '', '10.29', '10.28']], [['시어링토치', '', '216위 밖', '14위 - 1페이지 14위']]];
  const result = extract.parseRankTables(grids, { platform: 'coupang', productId: '731' }, ctx);
  assert.deepEqual(result.keywords, [{ keyword: '시어링토치', searchVolume: null }]);
  assert.equal(result.snapshots[0].keywords[0].outsideLimit, 216);
  assert.equal(result.snapshots[1].keywords[0].rank, 14);
  assert.throws(() => extract.parseRankTables(grids, { platform: 'naver', productId: '12345' }, ctx), error => error.code === 'SOURCE_NOT_READY');
});

test('explicit review view reads visible reviews without requiring a hidden keyword table', () => {
  const url = 'https://sellha.kr/monitoring/day/naver?productId=12345';
  const review = node('article', { 'data-review-id': 'review-100' }, [node('time', {}, ['2026. 10. 28']), node('span', { 'data-review-score': '' }, ['4점']), node('p', { 'data-review-content': '' }, ['화면에 보이는 후기'])]);
  const result = extract.extract(document([summary(), review], url), { ...ctx, url, view: 'reviews' });
  assert.equal(result.reviews.length, 1); assert.equal(result.reviews[0].rating, 4);
  assert.equal(Object.hasOwn(result.products[0], 'keywords'), false, 'review collection cannot replace keyword registration');
  assert.deepEqual(result.snapshots[0].keywords, []);
  const empty = extract.extract(document([summary(), node('p', {}, ['확장프로그램을 설치해주세요'])], url), { ...ctx, url, view: 'reviews' });
  assert.deepEqual(empty.reviews, []);
  assert.equal(empty.snapshots[0].reviews, 8, 'no rendered review bodies does not replace observed aggregate count with zero');
});

test('explicit sales view reads only observed rolling-seven-day quantity without a keyword table', () => {
  const url = 'https://sellha.kr/monitoring/day/naver?productId=12345';
  const count = node('section', {}, [node('h3', {}, ['스마트 스토어 7일 구매 건수']), node('span', {}, ['0건'])]);
  const result = extract.extract(document([summary(), count], url), { ...ctx, url, view: 'sales' });
  assert.equal(result.snapshots[0].rollingSales7d, 0);
  assert.equal(Object.hasOwn(result.snapshots[0], 'sales'), false);
  assert.equal(Object.hasOwn(result.products[0], 'keywords'), false);
  const missing = extract.extract(document([summary(), node('h3', {}, ['스마트 스토어 7일 구매 건수'])], url), { ...ctx, url, view: 'sales' });
  assert.equal(Object.hasOwn(missing.snapshots[0], 'rollingSales7d'), false);
  assert.throws(() => extract.extract(document([summary()], url), { ...ctx, url }), error => error.code === 'SOURCE_NOT_READY');
});
