(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MonitoringExtract = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const clean = value => String(value == null ? '' : value).replace(/\u00a0/g, ' ').trim().normalize('NFC');
  const flat = value => clean(value).replace(/\s+/g, ' ');
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const fail = (message, code = 'INVALID_DATA') => { throw Object.assign(Error(message), { code }); };
  const all = (node, selector) => node && typeof node.querySelectorAll === 'function' ? Array.from(node.querySelectorAll(selector)) : [];
  const content = node => clean(node && (typeof node.innerText === 'string' ? node.innerText : node.textContent));
  function visible(node) {
    if (!node || node.nodeType !== undefined && node.nodeType !== 1) return false;
    const view = node.ownerDocument && node.ownerDocument.defaultView;
    for (let item = node; item && item.nodeType !== 9; item = item.parentElement) {
      if (item.hidden || item.getAttribute?.('aria-hidden') === 'true' || /^(?:STYLE|SCRIPT|TEMPLATE|NOSCRIPT)$/.test(item.tagName || '')) return false;
      if (view && typeof view.getComputedStyle === 'function') {
        const style = view.getComputedStyle(item);
        if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
      }
    }
    return !(view && node.getClientRects && !node.getClientRects().length);
  }
  function number(value, label, options = {}) {
    const raw = clean(value).replace(/(?:원|개|건|점)\s*$/, '').trim();
    if (!raw || /^(?:-|—|null)$/i.test(raw)) return null;
    if (options.free && /^(?:무료|무료배송)$/.test(raw)) return 0;
    if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(raw)) fail(label + ' 숫자를 읽지 못했습니다.');
    const result = Number(raw.replace(/,/g, ''));
    if (!Number.isFinite(result) || result < (options.min ?? 0) || result > (options.max ?? 1e14) || options.integer !== false && !Number.isSafeInteger(result)) fail(label + ' 값이 허용 범위를 벗어났습니다.');
    return result;
  }
  function rankNumber(value, label) { return number(value, label, { min: 1, max: 1000000 }); }
  function parseRank(value) {
    const raw = flat(value);
    if (!raw) return null;
    let result;
    const outside = /^(\d[\d,]*)\s*위\s*밖(?:\s|$)/.exec(raw);
    const ranked = /^(\d[\d,]*)\s*위(?:\s|[-–—]|$)/.exec(raw);
    if (/^(?:-|—|-위|null)(?:\s|$)/i.test(raw)) result = { rank: null, status: 'missing' };
    else if (/^(?:업데이트\s*중|수집\s*중|대기)/.test(raw)) result = { rank: null, status: 'pending' };
    else if (outside) result = { rank: null, status: 'outside', outsideLimit: rankNumber(outside[1], '순위 밖 기준') };
    else if (/^(?:순위\s*밖|미노출|outside)(?:\s|$)/i.test(raw)) result = { rank: null, status: 'outside' };
    else if (ranked) result = { rank: rankNumber(ranked[1], '순위'), status: 'ranked' };
    else if (/^(?:브랜드\s*묶음|묶음|광고)/.test(raw)) result = { rank: null, status: 'missing' };
    else fail('순위 셀을 읽지 못했습니다. 화면 형식을 확인하세요.');
    const group = /(?:브랜드\s*묶음|묶음)(?:\s*내)?\s*(\d[\d,]*)\s*위/.exec(raw);
    const ad = /광고\s*(?:순위)?\s*(\d[\d,]*)\s*위/.exec(raw);
    const adCount = /광고\s*(?:개수|수)\s*[:：]?\s*(\d[\d,]*)\s*(?:개|$)/.exec(raw);
    const page = /(?:^|[\s\-–—])(\d[\d,]*)\s*페이지\s*(\d[\d,]*)\s*위/.exec(raw);
    if (group) result.groupRank = rankNumber(group[1], '묶음 순위');
    if (ad) result.adRank = rankNumber(ad[1], '광고 순위');
    if (adCount) result.adCount = number(adCount[1], '광고 개수', { max: 1000000 });
    if (page && result.status === 'ranked') { result.page = rankNumber(page[1], '페이지'); result.position = rankNumber(page[2], '페이지 내 순위'); }
    return result;
  }
  function isoDate(year, month, day) {
    const date = String(year).padStart(4, '0') + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
    const time = Date.parse(date + 'T00:00:00Z');
    if (!Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== date) fail('순위표 날짜가 올바르지 않습니다.');
    return date;
  }
  function context(options = {}) {
    if (!/^\d{4}-\d\d-\d\d$/.test(options.today || '')) fail('수집 기준 날짜(today)가 필요합니다.');
    const [year, month, day] = options.today.split('-').map(Number);
    if (isoDate(year, month, day) !== options.today) fail('수집 기준 날짜가 올바르지 않습니다.');
    if (!Number.isInteger(options.year) || options.year < 2000 || options.year > year) fail('순위표의 기준 연도(year)가 필요합니다.');
    return options;
  }
  function parseDates(headers, options) {
    context(options);
    let year = options.year, previous = null;
    const result = [], seen = new Set();
    headers.forEach((value, index) => {
      const label = flat(value), full = /^(20\d{2})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{1,2})\s*\.?$/.exec(label), short = /^(\d{1,2})\s*[./]\s*(\d{1,2})\s*\.?$/.exec(label);
      if (!full && !short) return;
      const month = Number(full ? full[2] : short[1]), day = Number(full ? full[3] : short[2]);
      if (full) year = Number(full[1]);
      else if (previous && month > Number(previous.slice(5, 7))) year--;
      const date = isoDate(year, month, day);
      if (date > options.today || previous && date >= previous || seen.has(date)) fail('순위표 날짜·연도·정렬 순서를 확인하세요. 미래 날짜나 중복 날짜는 저장하지 않습니다.');
      seen.add(date); previous = date; result.push({ index, date });
    });
    if (result.length && Date.parse(result[0].date) - Date.parse(result[result.length - 1].date) > 366 * 86400000) fail('연도가 불명확한 순위표입니다. 날짜 범위를 나누어 수집하세요.');
    return result;
  }
  function sourceIdentity(value) {
    let url; try { url = new URL(value); } catch { fail('수집할 셀하 주소를 확인하세요.', 'SOURCE_UNSUPPORTED'); }
    const match = /^\/monitoring\/day\/(naver|coupang)\/?$/.exec(url.pathname), productId = url.searchParams.get('productId');
    if (url.protocol !== 'https:' || url.hostname !== 'sellha.kr' || url.username || url.password || url.port || !match || productId !== null && !/^[1-9]\d{0,39}$/.test(productId)) fail('셀하 일간 모니터링 화면만 수집할 수 있습니다.', 'SOURCE_UNSUPPORTED');
    if (match[1] === 'coupang' && productId && ['vendorItemId', 'itemId'].some(key => !/^[1-9]\d{0,39}$/.test(url.searchParams.get(key) || ''))) fail('쿠팡 상품은 판매자 옵션·상품 옵션 ID가 모두 있는 셀하 상세 주소가 필요합니다.', 'SOURCE_UNSUPPORTED');
    // Persist only routing fields, never arbitrary query strings or fragments.
    const canonical = new URL('https://sellha.kr/monitoring/day/' + match[1]);
    if (productId) canonical.searchParams.set('productId', productId);
    const classification = url.searchParams.get('classificationType');
    if (classification && /^[A-Za-z]{1,30}$/.test(classification)) canonical.searchParams.set('classificationType', classification);
    for (const key of ['vendorItemId', 'itemId']) {
      const value = url.searchParams.get(key);
      if (value !== null) { if (!/^[1-9]\d{0,39}$/.test(value)) fail('쿠팡 상품 옵션 ID를 확인하세요.', 'SOURCE_UNSUPPORTED'); canonical.searchParams.set(key, value); }
    }
    const team = url.searchParams.get('isTeamProduct');
    if (team === 'true' || team === 'false') canonical.searchParams.set('isTeamProduct', team);
    return { platform: match[1], productId, sourceUrl: canonical.href };
  }
  function parseProductText(value, hints = {}) {
    const text = clean(value), result = {};
    const metric = { price: ['(?:가격|쿠팡\\s*판매가)', true], wowPrice: ['와우\\s*할인가', true], shipping: ['배송비', true], reviews: ['리뷰', true], rating: ['평점', false] };
    for (const [key, [label, integer]] of Object.entries(metric)) {
      const match = new RegExp(label + '\\s*[:：]?\\s*((?:[\\d,]+(?:\\.\\d+)?)\\s*(?:원|개|건|점)|무료배송|무료|원|개|점|—|-(?!\\d))').exec(text);
      if (match) result[key] = number(match[1], label, { integer, max: key === 'rating' ? 5 : 1e14, free: key === 'shipping' });
    }
    let name = clean(hints.name), brand = clean(hints.brand);
    if (!name) name = clean(text.split(/(?:가격|쿠팡\s*판매가|와우\s*할인가)\s*[:：]?(?:\s|\d|원)/)[0]).replace(/^묶음\s*/, '');
    if (!name || name.length > 500 || /(?:등록 상품 수|폴더명|로그인|일간 모니터링)/.test(name)) fail('상품명 정보를 읽지 못했습니다.', 'SOURCE_NOT_READY');
    if (brand && name.startsWith(brand + '|')) name = clean(name.slice(brand.length + 1));
    result.name = name;
    if (brand) result.brand = brand;
    const category = /카테고리\s*[:：]?\s*([^\n#]+)(?:\n|$)/.exec(text);
    if (category) {
      const value = clean(category[1]).split('태그 키워드')[0].trim();
      if (value && !/^(?:키워드|카테고리)$/.test(value)) result.category = value;
    }
    const tags = [...text.matchAll(/(?:^|\n)\s*#\s*([^\n#]+)/g)].map(match => clean(match[1])).filter(Boolean);
    if (tags.length) result.tags = [...new Set(tags)].slice(0, 100);
    return result;
  }
  function directText(node) { return clean(Array.from(node?.childNodes || []).filter(child => child.nodeType === 3).map(child => child.textContent || '').join(' ')).replace(/^\|\s*/, ''); }
  const metricLabel = value => /^(?:가격|쿠팡\s*판매가|와우\s*할인가|리뷰|평점|배송비|카테고리|태그\s*키워드)$/.test(value);
  function nameHints(node) {
    for (const item of all(node, 'span')) {
      if (!visible(item)) continue;
      const spans = Array.from(item.children || []).filter(child => child.tagName === 'SPAN' && visible(child));
      const direct = directText(item);
      if (spans.length === 1 && direct && !metricLabel(direct) && content(spans[0]).length < 80 && direct.length > 3) return { brand: content(spans[0]), name: direct };
    }
    for (const item of all(node, 'div')) {
      const children = Array.from(item.children || []).filter(visible);
      if (children.length === 2 && children.every(child => child.tagName === 'SPAN') && content(children[0]).length < 80 && content(children[1]).length > content(children[0]).length && !metricLabel(content(children[0]))) return { brand: content(children[0]), name: content(children[1]) };
    }
    // Coupang's rendered title has a merchant badge image, not a brand span.
    for (const item of all(node, 'span')) {
      const direct = directText(item);
      if (visible(item) && direct.length > 4 && !metricLabel(direct) && !/^#|^[\d,.]+(?:원|개|점|건)$/.test(direct) && (all(item, 'img[alt="merchant_rocket"]').length || !item.children.length)) return { name: direct };
    }
    return {};
  }
  function productFromNode(node, identity, image) {
    const product = { platform: identity.platform, productId: identity.productId, ...parseProductText(content(node), nameHints(node)), sourceUrl: identity.sourceUrl };
    const tags = all(node, 'span').filter(visible).map(content).filter(value => /^#\s*[^#]+$/.test(value)).map(value => clean(value.replace(/^#\s*/, '')));
    if (tags.length) product.tags = [...new Set(tags)].slice(0, 100);
    const imageUrl = image?.getAttribute?.('src') || image?.src;
    if (imageUrl) { try { const url = new URL(imageUrl); if (url.protocol === 'https:' && !url.username && !url.password) product.imageUrl = url.href; } catch {} }
    return product;
  }
  function cells(row) { return Array.from(row?.children || []).filter(node => /^(?:TH|TD)$/.test(node.tagName || '') && visible(node)); }
  function parseRankTables(grids, identity, options) {
    const headerCandidates = [];
    for (let table = 0; table < grids.length; table++) for (let row = 0; row < grids[table].length; row++) {
      const values = grids[table][row];
      const hasVolume = flat(values[1]) === '검색량';
      if (flat(values[0]) === '키워드' && (hasVolume || identity.platform === 'coupang' && flat(values[1]) === '')) {
        const dates = parseDates(values, options);
        if (dates.length) headerCandidates.push({ table, row, values, dates, hasVolume });
      }
    }
    if (headerCandidates.length !== 1) fail(headerCandidates.length ? '순위표가 여러 개 표시되어 수집을 중단했습니다.' : '날짜별 순위표가 아직 준비되지 않았습니다.', 'SOURCE_NOT_READY');
    const header = headerCandidates[0], snapshots = new Map(), keywords = [], seen = new Set();
    for (let table = header.table; table < Math.min(grids.length, header.table + 2); table++) for (let row = table === header.table ? header.row + 1 : 0; row < grids[table].length; row++) {
      const values = grids[table][row], keyword = clean(values[0]);
      if (!keyword || keyword === '키워드' || values.length < 3) continue;
      const volumeText = clean(values[1]);
      if (header.hasVolume && !/^(?:[\d,]+|—|-)?$/.test(volumeText)) continue;
      if (keyword.length > 100 || seen.has(keyword)) fail('순위표 키워드가 중복되거나 올바르지 않습니다.');
      const observations = header.dates.map(column => ({ date: column.date, value: parseRank(values[column.index]) })).filter(item => item.value !== null);
      if (!observations.length) continue;
      const searchVolume = header.hasVolume ? number(volumeText, '검색량', { max: 1e12 }) : null;
      seen.add(keyword); keywords.push({ keyword, searchVolume });
      for (const item of observations) {
        if (!snapshots.has(item.date)) snapshots.set(item.date, { platform: identity.platform, productId: identity.productId, date: item.date, keywords: [] });
        snapshots.get(item.date).keywords.push({ keyword, ...item.value });
      }
    }
    if (!keywords.length) fail('순위표가 아직 비어 있습니다. 표시가 완료된 뒤 다시 수집하세요.', 'SOURCE_NOT_READY');
    return { keywords, snapshots: [...snapshots.values()].sort((a, b) => b.date.localeCompare(a.date)) };
  }
  function rollingSales(document) {
    const labels = all(document, 'div,span,p,h2,h3').filter(node => visible(node) && /^스마트\s*스토어\s*7일\s*구매\s*건수$/.test(flat(content(node))));
    for (const label of labels) {
      const sibling = label.nextElementSibling;
      if (sibling && visible(sibling) && /^(?:\d+|\d{1,3}(?:,\d{3})+)\s*건?$/.test(flat(content(sibling)))) return number(content(sibling), '7일 구매 건수');
    }
    return undefined;
  }
  function extractReviews(document, identity, options) {
    const result = [], seen = new Set();
    for (const node of all(document, '[data-review-id],[data-review-no],[itemprop="review"]')) {
      if (!visible(node)) continue;
      const id = node.getAttribute?.('data-review-id') || node.getAttribute?.('data-review-no');
      const body = all(node, '[data-review-content],[itemprop="reviewBody"]').find(visible), dateNode = all(node, 'time,[data-review-date],[itemprop="datePublished"]').find(visible), scoreNode = all(node, '[data-review-score],[itemprop="ratingValue"]').find(visible);
      if (!id || !body || !dateNode || !scoreNode) continue;
      const rawDate = flat(content(dateNode)), match = /^(20\d{2})\s*[.\/-]\s*(\d{1,2})\s*[.\/-]\s*(\d{1,2})(?:\.|\s|$)/.exec(rawDate);
      if (!match) continue;
      let date, score;
      try { date = isoDate(Number(match[1]), Number(match[2]), Number(match[3])); score = number(content(scoreNode), '리뷰 평점', { min: 1, max: 5 }); } catch { continue; }
      const bodyText = content(body);
      if (!Number.isInteger(score) || date > options.today || !bodyText || bodyText.length > 10000 || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(id) || ['constructor', 'prototype', '__proto__'].includes(id) || seen.has(id)) continue;
      seen.add(id); result.push({ platform: identity.platform, productId: identity.productId, id, date, rating: score, text: bodyText });
    }
    return result;
  }
  function extract(document, options = {}) {
    context(options);
    const view = options.view === undefined ? 'keywords' : options.view;
    if (!['keywords', 'reviews', 'sales'].includes(view)) fail('수집할 모니터링 항목을 확인하세요.');
    if (!document || !document.body || typeof document.querySelectorAll !== 'function') fail('화면 문서를 읽지 못했습니다.', 'SOURCE_NOT_READY');
    const identity = sourceIdentity(options.url || document.location?.href), body = content(document.body);
    if (all(document, 'input[type="password"]').some(visible) || /로그인이\s*필요|로그인\s*후\s*이용|세션이\s*만료/.test(body)) fail('셀하 로그인이 필요합니다. 로그인 후 다시 시작하세요.', 'AUTH_REQUIRED');
    if (/Access Denied|automated (?:traffic|requests)|비정상적인\s*접근|접근이\s*차단|보안문자|사람인지\s*확인|로봇이\s*아닙니다|Verify you are human/i.test(body)) fail('인증 또는 접근 제한으로 수집을 중단했습니다. 화면에서 직접 확인하세요.', 'SOURCE_BLOCKED');
    if (!identity.productId) {
      const products = [], snapshots = [], seen = new Set();
      for (const link of all(document, 'a[href*="productId="]')) {
        if (!visible(link)) continue;
        let item; try { item = sourceIdentity(new URL(link.getAttribute('href'), options.url).href); } catch { continue; }
        if (!item.productId || item.platform !== identity.platform || seen.has(item.productId)) continue;
        const image = all(link, 'img[alt="item-image"]').find(visible);
        if (!image) continue;
        const product = productFromNode(link, item, image);
        products.push(product); seen.add(item.productId);
        const metrics = Object.fromEntries(['price', 'wowPrice', 'shipping', 'reviews', 'rating'].filter(key => own(product, key)).map(key => [key, product[key]]));
        if (Object.keys(metrics).length) snapshots.push({ platform: item.platform, productId: item.productId, date: options.today, keywords: [], ...metrics });
      }
      const registeredCounts = [...body.matchAll(/등록\s*상품\s*수\s*([\d,]+)\s*개/g)].map(match => number(match[1], '등록 상품 수', { max: 600 }));
      if (new Set(registeredCounts).size > 1) fail('등록 상품 수가 일치하지 않습니다. 목록이 준비된 뒤 다시 수집하세요.', 'SOURCE_PARTIAL');
      const registered = registeredCounts[0];
      if (registered !== undefined && registered !== products.length) fail('등록 상품 ' + registered + '개 중 ' + products.length + '개만 표시되어 있습니다. 폴더·목록을 모두 펼친 뒤 다시 수집하세요.', 'SOURCE_PARTIAL');
      if (!products.length && registered !== 0) fail('등록 상품 목록이 아직 표시되지 않았습니다. 목록이 비어 있으면 수집할 상품을 먼저 등록하세요.', 'SOURCE_NOT_READY');
      if (products.length > 600) fail('한 번에 최대 600개 상품을 수집할 수 있습니다.');
      return { products, snapshots, source: '셀하 일간 모니터링 표시 자료', sourceUrl: identity.sourceUrl, capturedDate: options.today };
    }
    const image = all(document, 'img[alt="item-image"]').find(visible);
    if (!image) fail('상품 요약 정보가 아직 표시되지 않았습니다.', 'SOURCE_NOT_READY');
    let summary = image.parentElement;
    for (let count = 0; summary && count < 8; count++, summary = summary.parentElement) {
      const text = content(summary);
      if (/가격|쿠팡\s*판매가|와우\s*할인가/.test(text) && /리뷰/.test(text) && /배송비/.test(text) && /카테고리/.test(text)) break;
    }
    if (!summary || summary === document.body) fail('상품 요약 정보의 구조가 변경되었습니다.', 'SOURCE_NOT_READY');
    const product = productFromNode(summary, identity, image);
    let snapshots = [];
    if (view === 'keywords') {
      const grids = all(document, 'table').filter(visible).map(table => all(table, 'tr').filter(visible).map(row => cells(row).map(content)));
      const rank = parseRankTables(grids, identity, options); product.keywords = rank.keywords; snapshots = rank.snapshots;
    }
    const metrics = Object.fromEntries(['price', 'wowPrice', 'shipping', 'reviews', 'rating'].filter(key => own(product, key)).map(key => [key, product[key]]));
    const sales = rollingSales(document); if (sales !== undefined) metrics.rollingSales7d = sales;
    if (Object.keys(metrics).length) {
      let today = snapshots.find(item => item.date === options.today);
      if (!today) { today = { platform: identity.platform, productId: identity.productId, date: options.today, keywords: [] }; snapshots.unshift(today); }
      Object.assign(today, metrics);
    }
    const reviews = extractReviews(document, identity, options);
    return { products: [product], snapshots, ...(view === 'reviews' || reviews.length ? { reviews } : {}), source: '셀하 일간 모니터링 표시 자료', sourceUrl: identity.sourceUrl, capturedDate: options.today };
  }
  return Object.freeze({ extract, parseRank, parseDates, parseProductText, parseRankTables, sourceIdentity });
});
