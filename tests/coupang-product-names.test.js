'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const names = require('../public/coupang-product-names.js');
const ads = require('../public/coupang-ads.js');

test('compact titles favor verified names and keep full source names untouched', () => {
  const product = { name:'트루버 자충매트 캠핑 매트리스 에어 침대 차박 텐트 매트 · 샌드 8CM [싱글]', optionName:'샌드 8CM [싱글]' };
  const before = JSON.stringify(product);
  assert.equal(names.shortTitle(product), '트루버 자충매트');
  assert.equal(names.shortTitle({ name:'긴 판매명 텍스트', displayName:'위마망 백도씨' }), '위마망 백도씨');
  assert.equal(names.shortTitle({ name:'긴 판매명 텍스트', displayName:'위마망 접이식 포트' }), '위마망 접이식 포트');
  assert.equal(names.shortTitle({ name:'브랜드 제품 X100 추가 키워드' }), '브랜드 제품 X100');
  assert.equal(names.shortTitle({ name:'트루버 자충매트 8CM 추가 키워드' }), '트루버 자충매트');
  assert.ok(names.shortTitle({name:'[미사용] 트루버 자충매트'}).includes('[미사용]'));
  assert.equal(JSON.stringify(product), before);
  assert.equal(names.fullName(product), product.name);
  assert.equal(names.fullName({name:'기본명',fullName:'원래 긴 상품명'}),'원래 긴 상품명');
  assert.ok(Array.from(names.shortTitle({ name:'아주긴상품이름이공백도없이계속이어지는예시입니다한글' })).length <= 22);
});

test('single and double options aggregate only by actual product identity and preserve weighted advertising figures', () => {
  const row = (itemId, productId, optionName, advertising, adSales) => ({ itemId,productId,name:'예시 자충매트 긴 제목',displayName:'예시 자충매트',optionName,channel:'growth',advertising,adSales,adQuantity:1,organicQuantity:0,adProfitBeforeAds:adSales/2,source:'sellha' });
  const input = [row('101','700','8CM 싱글',1000,10000),row('102','700','8CM 더블',3000,20000),row('103','800','8CM 싱글',2000,12000)];
  const before = JSON.stringify(input), groups = ads.productGroups(input);
  assert.equal(groups.length,2,'similar short names never merge different actual product IDs');
  const combined = groups.find(group=>group.id==='700');
  assert.equal(combined.options.length,2); assert.equal(combined.advertising,4000);assert.equal(combined.adSales,30000);assert.equal(combined.roas,750);
  assert.deepEqual(combined.options.map(option=>option.name),['8CM 싱글','8CM 더블']);
  assert.equal(names.groupLabel(combined.rows),'예시 자충매트');
  assert.equal(JSON.stringify(input), before);
  const originalName = '원래 긴 상품명 검색어';
  const preserved = ads.productGroups([{...input[0],name:'기본명',fullName:originalName}],{search:'검색어'});
  assert.equal(preserved.length,1);assert.equal(preserved[0].options[0].fullName,originalName);
});

test('option-level favorite IDs remain effective after authoritative product metadata groups their rows', () => {
  const fs = require('node:fs'),path=require('node:path'),vm=require('node:vm');
  const source = fs.readFileSync(path.join(__dirname,'../public/coupang-analytics.js'),'utf8');
  const declaration=source.split('\n').find(line=>line.startsWith('  function isFavorite('));
  const context = vm.createContext({favoriteIds:new Set(['101'])});
  vm.runInContext(declaration+'\nglobalThis.check=isFavorite;',context);
  assert.equal(context.check({id:'700',options:[{id:'101'},{id:'102'}]}),true);
  assert.equal(context.check({id:'800',options:[{id:'103'}]}),false);
});
