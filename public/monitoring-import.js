(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MonitoringImport = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const MAX_BYTES = 8 * 1024 * 1024, MAX_JSON_BYTES = 160 * 1024 * 1024, MAX_JSON_NODES = 5000000, MAX_CELLS = 500000, MAX_ROWS = 50000;
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const clean = value => String(value == null ? '' : value).trim().normalize('NFC');
  const header = value => clean(value).replace(/[\s_()（）]/g, '').toLowerCase();
  const fail = message => { throw Error(message); };
  const aliases = {
    date: ['날짜', '일자', 'date'], keyword: ['키워드', 'keyword'], rank: ['순위', '일반순위', 'rank'], status: ['상태', '순위상태', 'status'],
    searchVolume: ['검색량', 'searchVolume'], groupRank: ['묶음순위', 'groupRank'], adRank: ['광고순위', 'adRank'], adCount: ['광고개수', 'adCount'],
    outsideLimit: ['순위밖기준', '순위범위', 'outsideLimit'], page: ['페이지', 'page'], position: ['페이지내순위', 'position'],
    productId: ['상품ID', '상품번호', 'productId'], platform: ['플랫폼', '마켓', 'platform'], name: ['상품명', 'name'], brand: ['브랜드', 'brand'],
    price: ['가격', '판매가', '쿠팡판매가', 'price'], wowPrice: ['와우할인가', '와우가격', 'wowPrice'], shipping: ['배송비', 'shipping'], reviews: ['리뷰', '리뷰수', 'reviews'], rating: ['평점', '별점', 'rating'], sales: ['판매량', 'sales'], salesAmount: ['매출', '매출액', 'salesAmount'], rollingSales7d: ['7일구매건수', '최근7일구매건수', '스마트스토어7일구매건수', 'rollingSales7d'],
    reviewId: ['리뷰ID','reviewId'], reviewText: ['리뷰내용','리뷰본문','reviewText','text'], reviewTitle: ['제목','리뷰제목','title'], reviewOption: ['옵션','옵션명','option'], authorMasked: ['작성자표시','작성자','authorMasked'], imageUrls: ['사진URL','imageUrls'], videoUrls: ['동영상URL','videoUrls'], monthUse: ['한달사용리뷰','monthUse'], sourceOrder: ['원본순서','sourceOrder'], sourceUrl: ['원문URL','sourceUrl']
  };
  aliases.date.push('작성일','리뷰작성일');
  const metrics = ['price', 'wowPrice', 'shipping', 'reviews', 'rating', 'sales', 'salesAmount', 'rollingSales7d'];
  const fieldFor = value => Object.keys(aliases).find(key => aliases[key].some(alias => header(alias) === header(value)));
  function parseCSV(value, delimiter) {
    if (typeof value !== 'string' || value.length > MAX_BYTES) fail('자료는 8MB 이하로 넣으세요.');
    const text = value.replace(/^\uFEFF/, '');
    if (!delimiter) {
      // Inspect only the first record, so a comma inside a quoted field cannot select the separator.
      let quoted = false, commas = 0, tabs = 0;
      for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === '"') { if (quoted && text[i + 1] === '"') i++; else quoted = !quoted; }
        if (!quoted) { if (c === '\n' || c === '\r') break; if (c === ',') commas++; if (c === '\t') tabs++; }
      }
      delimiter = tabs > commas ? '\t' : ',';
    }
    if (!['\t', ','].includes(delimiter)) fail('CSV 구분자를 확인하세요.');
    const rows = []; let row = [], field = '', quoted = false, closed = false, cells = 0;
    const pushField = () => { if (++cells > MAX_CELLS) fail('자료의 셀 수가 너무 많습니다.'); row.push(field); field = ''; closed = false; };
    const pushRow = () => { pushField(); if (row.some(cell => clean(cell) !== '')) rows.push(row); if (rows.length > MAX_ROWS) fail('자료는 50,000행 이하로 나누어 넣으세요.'); row = []; };
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else { quoted = false; closed = true; } } else field += c; continue; }
      if (c === delimiter) { pushField(); continue; }
      if (c === '\r' || c === '\n') { if (c === '\r' && text[i + 1] === '\n') i++; pushRow(); continue; }
      if (closed) { if (c === ' ' || c === '\t' && delimiter !== '\t') continue; fail('CSV 따옴표 뒤의 구분자를 확인하세요.'); }
      if (c === '"') { if (field !== '') fail('CSV 따옴표 형식을 확인하세요.'); quoted = true; } else field += c;
    }
    if (quoted) fail('CSV 따옴표가 닫히지 않았습니다.');
    if (field !== '' || row.length || closed) pushRow();
    if (!rows.length) fail('가져올 자료가 없습니다.');
    return rows;
  }
  function number(value, label, { integer = true, min = 0, max = 1e14 } = {}) {
    const raw = clean(value);
    if (raw === '') return undefined;
    if (raw === '-' || raw.toLowerCase() === 'null') return null;
    const pattern = /^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/;
    if (!pattern.test(raw)) fail(label + ' 숫자를 확인하세요: ' + raw);
    const result = Number(raw.replace(/,/g, ''));
    if (!Number.isFinite(result) || result < min || result > max || integer && !Number.isSafeInteger(result)) fail(label + ' 숫자를 확인하세요: ' + raw);
    return result;
  }
  function rankValue(value, label) {
    const raw = clean(value);
    if (raw === '') return undefined;
    if (raw === '-' || raw === '-위' || raw.toLowerCase() === 'null') return null;
    return number(raw.replace(/위$/, '').trim(), label, { min: 1, max: 1000000 });
  }
  function parseRank(value) {
    const raw = clean(value);
    if (!raw) return {};
    if (/^(?:-|—|-위|null)$/i.test(raw)) return { rank: null, status: 'missing' };
    if (/업데이트\s*중|수집\s*중|대기/.test(raw)) return { rank: null, status: 'pending' };
    const outside = /^(\d[\d,]*)\s*위\s*밖$/.exec(raw);
    if (outside) return { rank: null, status: 'outside', outsideLimit: rankValue(outside[1], '순위 밖 기준') };
    if (/^(?:순위\s*밖|미노출|outside)$/i.test(raw)) return { rank: null, status: 'outside' };
    const match = /^(\d[\d,]*)\s*위(?:\s|[-–—]|$)/.exec(raw);
    const result = { rank: match ? rankValue(match[1], '순위') : rankValue(raw, '순위'), status: 'ranked' };
    if (result.rank == null) fail('순위 숫자를 확인하세요.');
    // Only labelled secondary values are read; page positions and delta arrows are not ranks.
    const group = /(?:브랜드\s*묶음|묶음)(?:\s*내)?\s*(\d[\d,]*)\s*위/.exec(raw);
    const ad = /광고\s*(?:순위)?\s*(\d[\d,]*)\s*위/.exec(raw);
    const count = /광고\s*(?:개수|수)\s*[:：]?\s*(\d[\d,]*)/.exec(raw);
    const pagination = /(?:^|[\s\-–—])(\d[\d,]*)\s*페이지\s*(\d[\d,]*)\s*위/.exec(raw);
    if (group) result.groupRank = rankValue(group[1], '묶음 순위');
    if (ad) result.adRank = rankValue(ad[1], '광고 순위');
    if (count) result.adCount = number(count[1], '광고 개수', { max: 1000000 });
    if (pagination) { result.page = rankValue(pagination[1], '페이지'); result.position = rankValue(pagination[2], '페이지 내 순위'); }
    return result;
  }
  function explicitStatus(value, observation) {
    const raw = clean(value);
    if (!raw) return observation;
    if (!['ranked', 'outside', 'pending', 'missing'].includes(raw)) fail('순위 상태는 ranked·outside·pending·missing 중 하나여야 합니다.');
    if (own(observation, 'status') && observation.status !== raw) fail('순위와 상태 열의 값이 다릅니다.');
    if (raw === 'ranked') { if (observation.rank == null) fail('ranked 상태에는 순위 숫자가 필요합니다.'); return { ...observation, status: raw }; }
    if (observation.rank != null) fail('순위와 상태 열의 값이 다릅니다.');
    return { ...observation, rank: null, status: raw };
  }
  function validDate(value, year) {
    const raw = clean(value); let match = /^(\d{4})[-./]\s*(\d{1,2})[-./]\s*(\d{1,2})\s*\.?$/.exec(raw);
    if (!match && year) { const short = /^(\d{1,2})\s*[./-]\s*(\d{1,2})\s*\.?$/.exec(raw); if (short) match = ['', String(year), short[1], short[2]]; }
    if (!match) fail('날짜에 연도를 포함하세요(YYYY-MM-DD): ' + raw);
    const date = match[1] + '-' + match[2].padStart(2, '0') + '-' + match[3].padStart(2, '0');
    const time = Date.parse(date + 'T00:00:00Z');
    if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== date || date < '2000-01-01') fail('실제 존재하는 날짜를 입력하세요: ' + raw);
    return date;
  }
  function sourceYear(name) {
    const years = [...String(name || '').matchAll(/(?:^|[^\d])(20\d{2})(?=[-_.\s]|\d{4}(?:[^\d]|$))/g)].map(match => match[1]);
    return new Set(years).size === 1 ? years[0] : undefined;
  }
  function identity(row, columns, selected) {
    const rawId = columns.productId === undefined ? '' : clean(row[columns.productId]);
    const rawPlatform = columns.platform === undefined ? '' : clean(row[columns.platform]);
    const market = rawPlatform === '네이버' ? 'naver' : rawPlatform === '쿠팡' ? 'coupang' : rawPlatform;
    if (market && !['naver', 'coupang'].includes(market)) fail('플랫폼은 네이버 또는 쿠팡으로 입력하세요.');
    if (rawId && !/^\d{1,40}$/.test(rawId)) fail('상품ID는 전체 숫자를 문자로 저장하세요.');
    if (selected) {
      if (!selected.id || !['naver', 'coupang'].includes(selected.platform) || !/^\d{1,40}$/.test(String(selected.productId || ''))) fail('선택한 상품 정보를 확인하세요.');
      if (rawId && rawId !== selected.productId || market && market !== selected.platform) fail('선택한 상품과 파일의 상품ID·플랫폼이 다릅니다.');
      return { productId: selected.id };
    }
    if (!rawId || !market) fail('상품을 선택한 뒤 가져오거나, 상품ID·플랫폼 열을 함께 넣으세요.');
    return { productId: rawId, platform: market };
  }
  function parseGrids(grids, product, filename) {
    if (!Array.isArray(grids) || !grids.length || grids.length > 20) fail('가져올 표를 확인하세요.');
    const observations = new Map(), products = new Map(), reviewRecords = new Map(); let recognized = 0, count = 0;
    function rememberProduct(row, columns, base) {
      if (product || !base.platform || columns.name === undefined || !clean(row[columns.name])) return;
      const name = clean(row[columns.name]);
      if (name.length > 500) fail('상품명은 500자 이하여야 합니다.');
      const key = base.platform + ':' + base.productId, previous = products.get(key);
      const candidate = { platform: base.platform, productId: base.productId, name };
      if (columns.brand !== undefined && clean(row[columns.brand])) candidate.brand = clean(row[columns.brand]);
      if (previous && (previous.name !== candidate.name || previous.brand && candidate.brand && previous.brand !== candidate.brand)) fail('같은 상품ID에 서로 다른 상품명·브랜드가 있습니다.');
      products.set(key, { ...previous, ...candidate });
    }
    function put(base, values) {
      const key = (base.platform || '') + ':' + base.productId + ':' + base.date;
      let target = observations.get(key);
      if (!target) { target = { ...base, keywords: [] }; observations.set(key, target); }
      const merge = (to, from, label) => { for (const [name, value] of Object.entries(from)) { if (value === undefined) continue; if (own(to, name) && to[name] !== value) fail(label + '에 서로 다른 값이 중복됩니다: ' + base.date); to[name] = value; } };
      const metricValues = Object.fromEntries(Object.entries(values).filter(([name]) => name !== 'keyword'));
      merge(target, metricValues, '같은 상품·날짜');
      if (values.keyword) {
        let keyword = target.keywords.find(item => item.keyword === values.keyword.keyword);
        if (!keyword) { keyword = { keyword: values.keyword.keyword }; target.keywords.push(keyword); }
        merge(keyword, values.keyword, '같은 키워드·날짜');
      }
      if (++count > MAX_CELLS) fail('가져올 순위 자료가 너무 많습니다.');
    }
    for (const grid of grids) {
      if (!Array.isArray(grid) || grid.length > MAX_ROWS) fail('가져올 표는 50,000행 이하여야 합니다.');
      let start = -1, columns, wideDates;
      for (let index = 0; index < Math.min(grid.length, 30); index++) {
        if (!Array.isArray(grid[index])) continue;
        const mapped = {}; let duplicate = false;
        grid[index].forEach((value, i) => { const name = fieldFor(value); if (name) { if (own(mapped, name)) duplicate = true; mapped[name] = i; } });
        const dates = [];
        if (mapped.keyword !== undefined && mapped.date === undefined) grid[index].forEach((value, i) => { if (/^\d{4}[-./]\s*\d{1,2}[-./]\s*\d{1,2}\s*\.?$|^\d{1,2}\s*[./-]\s*\d{1,2}\s*\.?$/.test(clean(value))) dates.push({ index: i, value }); });
        if (mapped.date !== undefined && (mapped.reviewId !== undefined || mapped.reviewText !== undefined || mapped.keyword !== undefined || metrics.some(name => mapped[name] !== undefined)) || mapped.keyword !== undefined && dates.length) {
          if (duplicate) fail('표에 같은 열 이름이 중복됩니다.');
          start = index; columns = mapped; wideDates = dates; break;
        }
      }
      if (start < 0) continue;
      recognized++;
      const year = sourceYear(filename) || sourceYear(grid.name);
      if (columns.reviewId !== undefined || columns.reviewText !== undefined) {
        if (columns.reviewId === undefined || columns.reviewText === undefined || columns.rating === undefined) fail('리뷰 표에는 리뷰ID·리뷰내용·별점 열이 필요합니다.');
        for (const row of grid.slice(start + 1)) {
          if (!Array.isArray(row) || !row.some(value => clean(value))) continue;
          const base = identity(row, columns, product), id = clean(row[columns.reviewId]);
          if (!id || id.length > 100) fail('리뷰 ID를 확인하세요.');
          rememberProduct(row, columns, base);
          const rating = number(row[columns.rating], '리뷰 별점', {min:1,max:5});
          if (rating == null) fail('리뷰 별점이 비어 있습니다.');
          const record = {...base,id,date:validDate(row[columns.date]),rating,text:clean(row[columns.reviewText])};
          if (record.text.length > 10000) fail('리뷰 본문은 10,000자 이하여야 합니다.');
          for (const [field, target] of [['reviewTitle','title'],['reviewOption','option'],['authorMasked','authorMasked'],['sourceUrl','sourceUrl']]) if (columns[field] !== undefined && clean(row[columns[field]])) record[target] = clean(row[columns[field]]);
          for (const field of ['imageUrls','videoUrls']) if (columns[field] !== undefined && clean(row[columns[field]])) record[field] = clean(row[columns[field]]).split(/\r?\n|\s*\|\s*/).map(clean).filter(Boolean);
          if (columns.sourceOrder !== undefined && clean(row[columns.sourceOrder])) record.sourceOrder = number(row[columns.sourceOrder], '원본 순서', {max:100000000});
          if (columns.monthUse !== undefined && clean(row[columns.monthUse])) {
            const value = clean(row[columns.monthUse]).toLowerCase();
            if (!['예','아니오','true','false','1','0'].includes(value)) fail('한달사용리뷰는 예/아니오로 입력하세요.');
            record.monthUse = ['예','true','1'].includes(value);
          }
          const key = (base.platform || '')+':'+base.productId+':'+id, previous=reviewRecords.get(key);
          if (previous && JSON.stringify(previous)!==JSON.stringify(record)) fail('같은 리뷰 ID에 서로 다른 자료가 있습니다.');
          reviewRecords.set(key,record);
        }
      } else if (wideDates.length) {
        const dates = wideDates.map(column => ({ index: column.index, date: validDate(column.value, year) }));
        if (new Set(dates.map(column => column.date)).size !== dates.length) fail('순위표에 같은 날짜 열이 중복됩니다.');
        for (const row of grid.slice(start + 1)) {
          if (!Array.isArray(row) || !row.some(value => clean(value))) continue;
          const keyword = clean(row[columns.keyword]); if (!keyword) continue;
          if (keyword.length > 100) fail('키워드는 100자 이하여야 합니다.');
          const base = identity(row, columns, product);
          rememberProduct(row, columns, base);
          const volume = columns.searchVolume === undefined ? undefined : number(row[columns.searchVolume], '검색량', { max: 1e12 });
          for (const date of dates) {
            if (!clean(row[date.index])) continue;
            const value = { keyword, ...parseRank(row[date.index]) }; if (volume !== undefined) value.searchVolume = volume;
            put({ ...base, date: date.date }, { keyword: value });
          }
        }
      } else for (const row of grid.slice(start + 1)) {
        if (!Array.isArray(row) || !row.some(value => clean(value))) continue;
        if (!clean(row[columns.date])) fail('관찰 날짜가 비어 있는 행이 있습니다.');
        const base = { ...identity(row, columns, product), date: validDate(row[columns.date]) }, values = {};
        rememberProduct(row, columns, base);
        for (const metric of metrics) if (columns[metric] !== undefined) {
          const value = number(row[columns[metric]], aliases[metric][0], { integer: metric !== 'rating', max: metric === 'rating' ? 5 : 1e14 });
          if (value !== undefined) values[metric] = value;
        }
        const keyword = columns.keyword === undefined ? '' : clean(row[columns.keyword]);
        if (keyword) {
          if (keyword.length > 100) fail('키워드는 100자 이하여야 합니다.');
          const rank = columns.rank === undefined ? {} : parseRank(row[columns.rank]);
          const value = { keyword, ...explicitStatus(columns.status === undefined ? '' : row[columns.status], rank) };
          for (const field of ['groupRank', 'adRank', 'adCount', 'searchVolume', 'outsideLimit', 'page', 'position']) if (columns[field] !== undefined) {
            const numeric = ['groupRank', 'adRank', 'outsideLimit', 'page', 'position'].includes(field) ? rankValue(row[columns[field]], aliases[field][0]) : number(row[columns[field]], aliases[field][0], { max: field === 'searchVolume' ? 1e12 : 1000000 });
            if (numeric !== undefined) { if (own(value, field) && value[field] !== numeric) fail('셀의 순위와 별도 순위 열이 다릅니다.'); value[field] = numeric; }
          }
          if (value.outsideLimit != null && value.status !== 'outside') fail('순위 밖 기준은 outside 상태에만 입력하세요.');
          if ((value.page != null || value.position != null) && value.status !== 'ranked') fail('페이지와 페이지 내 순위는 ranked 상태에만 입력하세요.');
          // A completely blank keyword row carries no observation and must not erase an old rank.
          if (Object.keys(value).length > 1) values.keyword = value;
        } else if (columns.rank !== undefined && clean(row[columns.rank]) || columns.status !== undefined && clean(row[columns.status])) fail('순위나 상태가 있는 행에는 키워드가 필요합니다.');
        if (Object.keys(values).length) put(base, values);
      }
    }
    if (!recognized) fail('날짜·키워드·순위 열 또는 키워드별 날짜 순위표를 찾지 못했습니다.');
    const snapshots = [...observations.values()];
    if (!snapshots.length && !reviewRecords.size) fail('가져올 관찰 값이 없습니다.');
    return { ...(products.size ? { products: [...products.values()] } : {}), snapshots, ...(reviewRecords.size ? {reviews:[...reviewRecords.values()]} : {}) };
  }
  function validateJSON(value) {
    let count = 0;
    function walk(item, depth) {
      if (++count > MAX_JSON_NODES || depth > 12) fail('JSON 자료가 너무 크거나 복잡합니다.');
      if (!item || typeof item !== 'object') return;
      for (const key of Object.keys(item)) { if (['__proto__', 'constructor', 'prototype'].includes(key)) fail('허용되지 않는 JSON 필드입니다.'); walk(item[key], depth + 1); }
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('JSON 자료 형식을 확인하세요.');
    walk(value, 0);
    for (const key of ['products','snapshots','reviews','alerts','folders']) if (value[key] !== undefined && !Array.isArray(value[key])) fail('JSON 상품·관찰·리뷰·알림·폴더 자료는 배열이어야 합니다.');
    if (!(value.products?.length || value.snapshots?.length || value.reviews?.length || value.folders?.length || own(value,'settings') || own(value,'alerts'))) fail('JSON 파일에 가져올 상품·관찰·리뷰 자료가 없습니다.');
    return Object.fromEntries(['products', 'snapshots', 'reviews', 'alerts', 'folders', 'settings', 'source'].filter(key => own(value, key)).map(key => [key, value[key]]));
  }
  async function parse(file, product) {
    if (!file || typeof file.name !== 'string' || typeof file.arrayBuffer !== 'function') fail('가져올 파일을 선택하세요.');
    const extension = file.name.toLowerCase().split('.').pop();
    const maxBytes = extension === 'json' ? MAX_JSON_BYTES : MAX_BYTES;
    const sizeError = extension === 'json' ? 'JSON 백업 파일은 160MB 이하로 넣으세요.' : '가져올 파일은 8MB 이하로 넣으세요.';
    if (!Number.isFinite(file.size) || file.size < 0 || file.size > maxBytes) fail(sizeError);
    if (extension === 'xlsx') {
      const reader = typeof window !== 'undefined' && window.CoupangSheets;
      if (!reader || typeof reader.readGrids !== 'function') fail('엑셀 읽기 기능을 불러오지 못했습니다. 새로고침 후 다시 시도하세요.');
      return parseGrids(await reader.readGrids(file), product, file.name);
    }
    if (!['json', 'csv', 'tsv'].includes(extension)) fail('JSON·CSV·TSV·XLSX 파일을 선택하세요.');
    const buffer = await file.arrayBuffer();
    if (buffer.byteLength > maxBytes) fail(sizeError);
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer); } catch { fail('파일을 UTF-8 형식으로 다시 저장하세요.'); }
    if (extension === 'json') { let value; try { value = JSON.parse(text); } catch { fail('JSON 파일의 문법을 확인하세요.'); } return validateJSON(value); }
    return parseGrids([parseCSV(text, extension === 'tsv' ? '\t' : undefined)], product, file.name);
  }
  return Object.freeze({ parse, parseCSV, parseGrids, parseRank });
});
