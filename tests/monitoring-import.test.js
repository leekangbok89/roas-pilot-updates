'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { parse, parseCSV, parseGrids, parseRank } = require('../public/monitoring-import.js');
const selected = { id: 'internal-1', platform: 'naver', productId: '123456789' };
test('CSV parses quoted comma, multiline rank cells, escaped quotes and trailing blank rows', () => {
  const rows = parseCSV('\uFEFF날짜,키워드,순위,검색량\r\n2026-10-29,"아기, 분유","10위 - 1페이지 10위\n▼1\n브랜드묶음내 1위","2,800"\r\n\r\n');
  assert.equal(rows.length, 2); assert.equal(rows[1][1], '아기, 분유');
  const { snapshots } = parseGrids([rows], selected);
  assert.deepEqual(snapshots[0], { productId: 'internal-1', date: '2026-10-29', keywords: [{ keyword: '아기, 분유', rank: 10, status: 'ranked', groupRank: 1, page: 1, position: 10, searchVolume: 2800 }] });
  assert.deepEqual(parseCSV('a,b\n"x""y",z'), [['a', 'b'], ['x"y', 'z']]);
  assert.throws(() => parseCSV('a,b\n"oops'), /따옴표/);
  assert.throws(() => parseCSV('a,b\n"x"oops,z'), /구분자/);
});
test('ranked, outside, pending and missing remain distinct and zero rank is invalid', () => {
  assert.deepEqual(parseRank('80위 밖'), { rank: null, status: 'outside', outsideLimit: 80 });
  assert.deepEqual(parseRank('업데이트 중'), { rank: null, status: 'pending' });
  assert.deepEqual(parseRank('-위'), { rank: null, status: 'missing' });
  assert.deepEqual(parseRank(''), {});
  assert.throws(() => parseRank('0'), /순위/);
  assert.deepEqual(parseRank('2위 - 1페이지 2위\n▲1\n브랜드묶음내 1위\n광고 3위 광고개수 0'), { rank: 2, status: 'ranked', groupRank: 1, adRank: 3, adCount: 0, page: 1, position: 2 });
});
test('sparse long rows merge keywords and preserve explicit zero and unknown values', () => {
  const rows = parseCSV('날짜,키워드,순위,광고개수,가격,배송비,리뷰,평점,판매량,매출\n2026-10-29,분유제조기,1,0,399000,0,145,5,0,0\n2026-10-29,분유포트,80위 밖,,,,,,,\n2026-10-28,,,-,-,,,,,');
  const { snapshots } = parseGrids([rows], selected);
  assert.equal(snapshots.length, 2); assert.equal(snapshots[0].keywords.length, 2);
  assert.equal(snapshots[0].sales, 0); assert.equal(snapshots[0].shipping, 0); assert.equal(snapshots[0].keywords[0].adCount, 0);
  assert.equal(snapshots[1].price, null); assert.equal('reviews' in snapshots[1], false);
  assert.deepEqual(parseGrids([[['날짜', '키워드', '순위'], ['2026-10-29', 'a', '1'], ['2026-10-29', 'a', '1']]], selected).snapshots[0].keywords.length, 1);
});
test('conflicting duplicate metrics and keyword ranks are rejected', () => {
  assert.throws(() => parseGrids([[['날짜', '키워드', '순위'], ['2026-10-29', 'a', '1'], ['2026-10-29', 'a', '2']]], selected), /다른 값/);
  assert.throws(() => parseGrids([[['날짜', '가격'], ['2026-10-29', '1'], ['2026-10-29', '2']]], selected), /다른 값/);
});
test('wide full dates parse exactly and month/day requires explicit filename year', () => {
  const grid = [['키워드', '검색량', '2026-10-29', '2026-10-28'], ['분유', '0', '2위 - 1페이지 2위', '80위 밖'], ['포트', '', '', '-']];
  const { snapshots } = parseGrids([grid], selected);
  assert.equal(snapshots.length, 2); assert.equal(snapshots[0].keywords[0].searchVolume, 0);
  assert.equal(snapshots[1].keywords.length, 2);
  const short = [['키워드', '검색량', '10. 29'], ['a', '', '1']];
  assert.throws(() => parseGrids([short], selected), /연도/);
  assert.equal(parseGrids([short], selected, '순위_2026-10-29.xlsx').snapshots[0].date, '2026-10-29');
  assert.throws(() => parseGrids([[['키워드', '2026-02-30'], ['a', '1']]], selected), /실제 존재/);
});
test('external identity is explicit and selected product mismatch rejects import', () => {
  const rows = [['날짜', '키워드', '순위', '상품ID', '플랫폼'], ['2026-10-29', 'a', '1', '123456789', '네이버']];
  assert.equal(parseGrids([rows]).snapshots[0].platform, 'naver');
  assert.equal(parseGrids([rows], selected).snapshots[0].productId, 'internal-1');
  assert.throws(() => parseGrids([rows], { ...selected, productId: '999' }), /다릅니다/);
  assert.throws(() => parseGrids([[['날짜', '키워드', '순위'], ['2026-10-29', 'a', '1']]]), /상품을 선택/);
});
test('bad numeric, dates, repeated headers and formula text are not coerced', () => {
  for (const value of ['NaN', '1e4', '=1+1', '12,34', '-1']) assert.throws(() => parseGrids([[['날짜', '리뷰'], ['2026-10-29', value]]], selected), /숫자/);
  assert.throws(() => parseGrids([[['날짜', '평점'], ['2026-10-29', '5.1']]], selected), /숫자/);
  assert.throws(() => parseGrids([[['날짜', '순위', '키워드', 'keyword'], ['2026-10-29', '1', 'a', 'a']]], selected), /중복/);
  assert.throws(() => parseGrids([[['날짜', '리뷰'], ['2026-02-30', '1']]], selected), /실제 존재/);
});
test('file parsing supports JSON without allowing unsafe keys and enforces byte size', async () => {
  const file = (text, name = 'monitor.json') => ({ name, size: Buffer.byteLength(text), arrayBuffer: async () => Uint8Array.from(Buffer.from(text)).buffer });
  assert.deepEqual(await parse(file('{"products":[{"id":"a"}]}')), { products: [{ id: 'a' }] });
  await assert.rejects(parse(file('{"snapshots":[],"__proto__":{}}')), /허용되지/);
  await assert.rejects(parse(file('{')), /문법/);
  await assert.rejects(parse({ ...file('{}', 'rank.csv'), size: 8 * 1024 * 1024 + 1 }), /8MB/);
  await assert.rejects(parse({ ...file('{}'), size: 160 * 1024 * 1024 + 1 }), /160MB/);
  assert.deepEqual(await parse({ ...file('{"products":[{"id":"a"}]}'), size: 160 * 1024 * 1024 }), { products: [{ id: 'a' }] });
  const result = await parse(file('날짜,키워드,순위\n2026-10-29,a,2', 'rank.csv'), selected);
  assert.equal(result.snapshots[0].keywords[0].rank, 2);
});
test('frontend rank CSV headers preserve every explicit rank status with blank numeric rank', () => {
  const headers = ['일자','마켓','상품ID','상품명','키워드','검색량','상태','순위','묶음순위','광고순위','광고개수','가격','리뷰수','평점','판매량','매출액'];
  const rows = [
    ['2026-10-29','naver','123456789','백도씨','분유',2800,'ranked',2,1,3,0,399000,145,5,0,0],
    ['2026-10-29','naver','123456789','백도씨','포트',0,'outside','','','','',399000,145,5,0,0],
    ['2026-10-28','naver','123456789','백도씨','포트','','pending','','','','','','','','',''],
    ['2026-10-27','naver','123456789','백도씨','포트','','missing','','','','','','','','','']
  ];
  const result = parseGrids([[headers, ...rows]]);
  assert.deepEqual(result.products, [{ platform: 'naver', productId: '123456789', name: '백도씨' }]);
  assert.equal(result.snapshots[0].keywords[0].adCount, 0);
  assert.deepEqual(result.snapshots.map(snapshot => snapshot.keywords.at(-1).status), ['outside', 'pending', 'missing']);
  assert.deepEqual(result.snapshots.map(snapshot => snapshot.keywords.at(-1).rank), [null, null, null]);
  assert.throws(() => parseGrids([[headers, [...rows[1].slice(0, 7), 1, ...rows[1].slice(8)]]]), /순위와 상태/);
  assert.throws(() => parseGrids([[headers, [...rows[2].slice(0, 6), 'ranked', ...rows[2].slice(7)]]]), /순위 숫자/);
  assert.throws(() => parseGrids([[headers, [...rows[2].slice(0, 6), 'unknown', ...rows[2].slice(7)]]]), /순위 상태/);
});
test('frontend metrics export headers retain shipping, zero and sparse missing fields', () => {
  const rows = [['일자','마켓','상품ID','상품명','가격','배송비','리뷰수','평점','판매량','매출액'], ['2026-10-29','coupang','123456789','매트',119000,0,0,4.8,0,0], ['2026-10-28','coupang','123456789','매트','','','','','','']];
  const result = parseGrids([rows]);
  assert.deepEqual(result.products, [{ platform: 'coupang', productId: '123456789', name: '매트' }]);
  assert.deepEqual(result.snapshots, [{ platform: 'coupang', productId: '123456789', date: '2026-10-29', keywords: [], price: 119000, shipping: 0, reviews: 0, rating: 4.8, sales: 0, salesAmount: 0 }]);
  const withShipping = [['일자','마켓','상품ID','상품명','키워드','상태','순위','배송비'], ['2026-10-29','naver','123456789','백도씨','포트','outside','',0]];
  assert.equal(parseGrids([withShipping]).snapshots[0].shipping, 0);
});
test('export-style CSV product metadata and observations can restore into a fresh monitoring store', t => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const { createService } = require('../integrations/monitoring/service.cjs');
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monitor-import-'));
  t.after(() => fs.rmSync(baseDir, { recursive: true, force: true }));
  const data = parseGrids([[['일자','마켓','상품ID','상품명','키워드','상태','순위','가격','배송비'], ['2026-10-29','naver','123456789','백도씨','분유','pending','',399000,0]]]);
  const store = createService({ baseDir, today: () => '2026-10-29' });
  const saved = store.importData({ revision: 0, ...data });
  assert.equal(saved.products.length, 1); assert.equal(saved.snapshots.length, 1);
  assert.deepEqual(saved.snapshots[0].keywords[0], { keyword: '분유', rank: null, status: 'pending' });
  assert.equal(saved.snapshots[0].shipping, 0);
});
test('cutoff and pagination are preserved only when explicitly observed, never inferred from a rank', () => {
  assert.deepEqual(parseRank('100위 밖'), { rank: null, status: 'outside', outsideLimit: 100 });
  assert.deepEqual(parseRank('미노출'), { rank: null, status: 'outside' });
  assert.deepEqual(parseRank('순위 밖'), { rank: null, status: 'outside' });
  assert.deepEqual(parseRank('53'), { rank: 53, status: 'ranked' });
  assert.deepEqual(parseRank('53위 - 2페이지 13위'), { rank: 53, status: 'ranked', page: 2, position: 13 });
  const wide = parseGrids([[['키워드', '2026-10-29', '2026-10-28'], ['분유', '100위 밖', '53위 - 2페이지 13위']]], selected);
  assert.equal(wide.snapshots[0].keywords[0].outsideLimit, 100);
  assert.equal(wide.snapshots[1].keywords[0].page, 2);
  assert.equal(wide.snapshots[1].keywords[0].position, 13);
});
test('current frontend CSV metadata columns roundtrip through the importer and backend', t => {
  const headers = ['일자','마켓','상품ID','상품명','키워드','검색량','상태','순위','묶음순위','광고순위','광고개수','순위밖기준','페이지','페이지내순위','가격','배송비','리뷰수','평점','판매량','매출액'];
  const rows = [
    ['2026-10-29','naver','123456789','백도씨','분유',2800,'ranked',53,1,3,0,'',2,13,399000,0,145,5,0,0],
    ['2026-10-28','naver','123456789','백도씨','분유',2800,'outside','','','','',100,'','',399000,0,145,5,0,0],
    ['2026-10-27','naver','123456789','백도씨','분유',2800,'outside','','','','','','','',399000,0,145,5,0,0]
  ];
  const imported = parseGrids([[headers, ...rows]]);
  assert.equal(imported.snapshots[0].keywords[0].page, 2); assert.equal(imported.snapshots[0].keywords[0].position, 13);
  assert.equal('outsideLimit' in imported.snapshots[0].keywords[0], false);
  assert.equal(imported.snapshots[1].keywords[0].outsideLimit, 100);
  assert.equal('outsideLimit' in imported.snapshots[2].keywords[0], false);
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const { createService } = require('../integrations/monitoring/service.cjs');
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monitor-metadata-'));
  t.after(() => fs.rmSync(baseDir, { recursive: true, force: true }));
  const saved = createService({ baseDir, today: () => '2026-10-29' }).importData({ revision: 0, ...imported });
  assert.equal(saved.snapshots[0].keywords[0].page, 2);
  assert.equal(saved.snapshots[0].keywords[0].position, 13);
  assert.equal(saved.snapshots[1].keywords[0].outsideLimit, 100);
  assert.throws(() => parseGrids([[headers, [...rows[0].slice(0, 11), 80, ...rows[0].slice(12)]]]), /outside 상태/);
  assert.throws(() => parseGrids([[headers, [...rows[1].slice(0, 12), 2, ...rows[1].slice(13)]]]), /ranked 상태/);
  assert.throws(() => parseGrids([[['날짜','키워드','순위','페이지'], ['2026-10-29','a','53위 - 2페이지 13위',3]]], selected), /별도 순위/);
});
