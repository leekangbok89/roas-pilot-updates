'use strict';

// This store belongs only to daily product monitoring. It never reads or writes
// the sales/advertising stores and never invents observations for missing dates.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const LIMITS = Object.freeze({ products: 600, keywords: 3000, snapshotCells: 1000000, snapshots: 250000, fileBytes: 160 * 1024 * 1024 });
const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const fail = (message, status = 400) => { throw Object.assign(Error(message), { status }); };
const clone = value => JSON.parse(JSON.stringify(value));
function object(value, label = '입력') {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(label + ' 형식을 확인하세요.');
  return value;
}
function safeTree(value, depth = 0, budget = { count: 0 }) {
  if (++budget.count > 5000000 || depth > 12) fail('입력 자료가 너무 크거나 복잡합니다.');
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'string') { if (value.length > 10000) fail('입력 문자열이 너무 깁니다.'); return; }
  if (typeof value === 'number') { if (!Number.isFinite(value)) fail('유효한 숫자가 필요합니다.'); return; }
  if (Array.isArray(value)) { for (const item of value) safeTree(item, depth + 1, budget); return; }
  object(value);
  for (const key of Object.keys(value)) { if (BAD_KEYS.has(key)) fail('허용되지 않는 필드입니다.'); safeTree(value[key], depth + 1, budget); }
}
function text(value, max, label, empty = true) {
  if (typeof value !== 'string') fail(label + '는 문자로 입력하세요.');
  const result = value.trim().normalize('NFC');
  if (result.length > max || (!empty && !result) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(result)) fail(label + ' 길이와 내용을 확인하세요.');
  return result;
}
function id(value, label = 'ID') {
  const result = text(value, 100, label, false);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(result) || BAD_KEYS.has(result)) fail(label + ' 형식을 확인하세요.');
  return result;
}
function amount(value, label, { integer = false, max = 1e14, min = 0 } = {}) {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isSafeInteger(value))) fail(label + ' 숫자를 확인하세요.');
  return value;
}
function bool(value, label) { if (typeof value !== 'boolean') fail(label + '는 참/거짓이어야 합니다.'); return value; }
function alertSettings(value) {
  if (typeof value === 'boolean') return { enabled: value, threshold: 10 };
  object(value, '순위 알림');
  return { enabled: bool(value.enabled, '순위 알림 설정'), threshold: rank(value.threshold, '알림 순위') ?? fail('알림 순위를 입력하세요.') };
}
function platform(value) { if (!['naver', 'coupang'].includes(value)) fail('플랫폼은 네이버 또는 쿠팡이어야 합니다.'); return value; }
function externalId(value) {
  const result = text(value, 40, '상품 번호', false);
  if (!/^\d{1,40}$/.test(result)) fail('상품 번호는 전체 숫자를 문자로 입력하세요.');
  return result;
}
function url(value, label, market) {
  const raw = text(value, 2048, label);
  if (!raw) return '';
  let parsed; try { parsed = new URL(raw); } catch { fail(label + ' 주소를 확인하세요.'); }
  const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port && parsed.port !== '443' || !host.includes('.') || net.isIP(host.replace(/^\[|\]$/g, '')) || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(host)) fail(label + '는 공개 HTTPS 주소여야 합니다.');
  if (market && !(market === 'naver' ? /(?:^|\.)(?:naver\.com|naver\.me)$/.test(host) : /(?:^|\.)(?:coupang\.com|coupang\.page\.link)$/.test(host))) fail('선택한 플랫폼의 상품 주소를 입력하세요.');
  return parsed.href;
}
function keywords(value) {
  if (!Array.isArray(value) || value.length > LIMITS.keywords) fail('키워드 목록을 확인하세요.');
  const seen = new Set();
  return value.map(item => {
    const input = typeof item === 'string' ? { keyword: item } : object(item, '키워드');
    const keyword = text(input.keyword, 100, '키워드', false);
    if (seen.has(keyword)) fail('같은 키워드가 중복됩니다: ' + keyword);
    seen.add(keyword);
    return { keyword, searchVolume: own(input, 'searchVolume') ? amount(input.searchVolume, '검색량', { integer: true, max: 1e12 }) : null };
  });
}
function rank(value, label) { return amount(value, label, { integer: true, min: 1, max: 1000000 }); }
function observationKeyword(input, previous) {
  object(input, '순위 키워드');
  const keyword = text(input.keyword, 100, '키워드', false), result = previous ? { ...previous } : { keyword, rank: null, status: 'missing' };
  if (own(input, 'rank')) result.rank = rank(input.rank, '순위');
  if (own(input, 'status')) {
    if (!['ranked', 'outside', 'pending', 'missing'].includes(input.status)) fail('순위 상태를 확인하세요.');
    result.status = input.status;
    if (result.status !== 'ranked' && !own(input, 'rank')) result.rank = null;
  } else if (own(input, 'rank')) result.status = result.rank === null ? 'missing' : 'ranked';
  if (result.status === 'ranked' && result.rank === null || result.status !== 'ranked' && result.rank !== null) fail('순위와 순위 상태가 서로 다릅니다.');
  for (const key of ['outsideLimit', 'page', 'position']) {
    if (own(input, key)) result[key] = rank(input[key], key === 'outsideLimit' ? '순위 범위' : key === 'page' ? '순위 페이지' : '페이지 내 순위');
    const applicable = key === 'outsideLimit' ? result.status === 'outside' : result.status === 'ranked';
    if (!applicable && own(input, key) && result[key] !== null) fail('순위 상태와 순위 범위·페이지 정보가 서로 다릅니다.');
    // A previous observation's page or cutoff is not evidence for a different
    // rank state. Preserve explicit unknowns and clear stale metadata on change.
    if (!applicable && own(result, key)) result[key] = null;
  }
  for (const key of ['groupRank', 'adRank']) if (own(input, key)) result[key] = rank(input[key], key === 'groupRank' ? '묶음 순위' : '광고 순위');
  if (own(input, 'adCount')) result.adCount = amount(input.adCount, '광고 개수', { integer: true, max: 1000000 });
  if (own(input, 'searchVolume')) result.searchVolume = amount(input.searchVolume, '검색량', { integer: true, max: 1e12 });
  return result;
}
function validDate(value, today) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('관찰 날짜는 YYYY-MM-DD 형식이어야 합니다.');
  const parsed = Date.parse(value + 'T00:00:00Z');
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value || value < '2000-01-01' || value > today) fail('실제 존재하는 오늘 이전 관찰 날짜를 입력하세요.');
  return value;
}
function emptyState() { return { schema: 1, revision: 0, products: [], folders: [], snapshots: [], settings: {} }; }
function checkLimits(store) {
  if (store.products.length > LIMITS.products) fail('등록 상품은 보관 상품을 포함해 최대 600개입니다.');
  if (store.products.reduce((sum, product) => sum + product.keywords.length, 0) > LIMITS.keywords) fail('등록 키워드는 보관 상품을 포함해 최대 3,000개입니다.');
  if (store.snapshots.length > LIMITS.snapshots || store.snapshots.reduce((sum, snapshot) => sum + Math.max(1, snapshot.keywords.length), 0) > LIMITS.snapshotCells) fail('관찰 자료는 최대 1,000,000개 셀까지 저장할 수 있습니다.');
}

function createService({ baseDir, today } = {}) {
  if (typeof baseDir !== 'string' || !baseDir) throw Error('Monitoring store requires baseDir');
  const file = path.join(baseDir, '.roas-data', 'daily-monitoring', 'state.json');
  const currentDate = typeof today === 'function' ? today : () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  function read() {
    try {
      if (fs.statSync(file).size > LIMITS.fileBytes) throw Error('oversized');
      const store = JSON.parse(fs.readFileSync(file, 'utf8'));
      object(store);
      if (store.schema !== 1 || !Number.isSafeInteger(store.revision) || store.revision < 0 || !Array.isArray(store.products) || !Array.isArray(store.folders) || !Array.isArray(store.snapshots) || !store.settings || typeof store.settings !== 'object' || Array.isArray(store.settings)) throw Error('format');
      // Reject corrupt files instead of silently replacing a user's history.
      if (new Set(store.products.map(p => p.id)).size !== store.products.length || store.products.some(p => !p || !Array.isArray(p.keywords)) || store.snapshots.some(s => !s || !Array.isArray(s.keywords))) throw Error('format');
      checkLimits(store);
      return store;
    } catch (error) {
      if (error.code === 'ENOENT') return emptyState();
      fail('일간 모니터링 저장 자료를 읽지 못했습니다. 기존 파일을 확인하세요.', 500);
    }
  }
  function commit(store) {
    const raw = JSON.stringify(store);
    if (Buffer.byteLength(raw, 'utf8') > LIMITS.fileBytes) fail('관찰 자료 파일이 너무 큽니다.');
    const temp = file + '.tmp-' + crypto.randomUUID();
    let descriptor;
    try {
      descriptor = fs.openSync(temp, 'wx', 0o600);
      fs.writeFileSync(descriptor, raw, 'utf8'); fs.fsyncSync(descriptor); fs.closeSync(descriptor); descriptor = undefined;
      fs.renameSync(temp, file);
    } finally { if (descriptor !== undefined) fs.closeSync(descriptor); fs.rmSync(temp, { force: true }); }
    return clone(store);
  }
  const lockFile = file + '.lock';
  const sameLockStat = (a, b) => a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
  function inspectLock() {
    let descriptor;
    try {
      // Reading through a descriptor lets the second stat detect a writer that
      // fills in its metadata while this process is inspecting an empty lock.
      const link = fs.lstatSync(lockFile);
      if (!link.isFile()) return false;
      descriptor = fs.openSync(lockFile, 'r');
      const before = fs.fstatSync(descriptor);
      if (!sameLockStat(link, before)) return false;
      const raw = before.size <= 4096 ? fs.readFileSync(descriptor, 'utf8') : null;
      const after = fs.fstatSync(descriptor);
      return sameLockStat(before, after) ? { stat: after, raw } : false;
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      return false;
    } finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
  }
  function removeUnchangedLock(observed) {
    const current = inspectLock();
    if (current === null) return true;
    if (!current || !sameLockStat(observed.stat, current.stat) || current.raw !== observed.raw) return false;
    // Recheck the path's inode as well as its contents before removing it. A
    // newly acquired or updated lock must survive another process's cleanup.
    try {
      if (!sameLockStat(current.stat, fs.lstatSync(lockFile))) return false;
      fs.unlinkSync(lockFile);
      return true;
    } catch (error) { return error.code === 'ENOENT'; }
  }
  function reclaimStaleLock() {
    const observed = inspectLock();
    if (observed === null) return true;
    if (!observed) return false;
    let metadata;
    try { metadata = JSON.parse(observed.raw); } catch {}
    const valid = metadata && typeof metadata === 'object' && !Array.isArray(metadata) && Number.isInteger(metadata.pid) && metadata.pid > 0 && metadata.pid <= 2147483647 && typeof metadata.createdAt === 'string' && Number.isFinite(Date.parse(metadata.createdAt));
    if (valid) {
      // EPERM means the owner may still be running. Only ESRCH establishes
      // that a recorded owner has exited; its age alone is never sufficient.
      try { process.kill(metadata.pid, 0); return false; }
      catch (error) { if (error.code !== 'ESRCH') return false; }
    } else if (Date.now() - observed.stat.mtimeMs <= 5 * 60 * 1000) return false;
    return removeUnchangedLock(observed);
  }
  function acquireLock() {
    for (let attempt = 0; attempt < 2; attempt++) {
      let descriptor;
      try {
        descriptor = fs.openSync(lockFile, 'wx', 0o600);
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        if (attempt === 0 && reclaimStaleLock()) continue;
        fail('다른 저장 작업이 진행 중입니다. 잠시 후 다시 시도하세요.', 409);
      }
      try {
        const raw = JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString(), token: crypto.randomUUID() });
        fs.writeFileSync(descriptor, raw, 'utf8');
        fs.fsyncSync(descriptor);
        return { descriptor, raw, stat: fs.fstatSync(descriptor) };
      } catch (error) {
        const stat = fs.fstatSync(descriptor);
        fs.closeSync(descriptor);
        try { if (sameLockStat(stat, fs.lstatSync(lockFile))) fs.unlinkSync(lockFile); } catch {}
        throw error;
      }
    }
    fail('다른 저장 작업이 진행 중입니다. 잠시 후 다시 시도하세요.', 409);
  }
  function transaction(input, mutate) {
    object(input); safeTree(input);
    if (!Number.isSafeInteger(input.revision) || input.revision < 0) fail('저장 버전(revision)이 필요합니다.');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    let lock;
    try {
      lock = acquireLock();
      const store = read();
      if (store.revision !== input.revision) fail('다른 화면에서 모니터링 자료가 변경됐습니다. 새로고침 후 다시 저장하세요.', 409);
      mutate(store); checkLimits(store);
      store.revision++;
      store.updatedAt = new Date().toISOString();
      return commit(store);
    } finally { if (lock) { fs.closeSync(lock.descriptor); removeUnchangedLock(lock); } }
  }
  function getProduct(store, productId) {
    const found = store.products.find(product => product.id === id(productId, '상품 ID'));
    if (!found) fail('등록된 상품을 찾을 수 없습니다.', 404);
    return found;
  }
  function upsertProduct(store, input) {
    object(input, '상품');
    const requestedId = own(input, 'id') ? id(input.id, '상품 ID') : null;
    let previous = requestedId && store.products.find(product => product.id === requestedId);
    const requestedPlatform = own(input, 'platform') ? platform(input.platform) : previous?.platform;
    const requestedExternal = own(input, 'productId') ? externalId(input.productId) : previous?.productId;
    const byIdentity = requestedPlatform && requestedExternal && store.products.find(product => product.platform === requestedPlatform && product.productId === requestedExternal);
    if (previous && byIdentity && previous.id !== byIdentity.id || !previous && requestedId && byIdentity && requestedId !== byIdentity.id) fail('이 플랫폼과 상품 번호가 이미 다른 상품으로 등록되어 있습니다.', 409);
    previous = previous || byIdentity;
    if (!previous && !requestedPlatform) fail('새 상품의 플랫폼을 선택하세요.');
    const result = previous ? { ...previous } : { id: requestedId || crypto.randomUUID(), platform: requestedPlatform || 'naver', productId: requestedExternal || '', name: '', brand: '', url: '', imageUrl: '', price: null, shipping: null, reviews: null, rating: null, category: '', tags: [], keywords: [], folderId: null, favorite: false, alert: { enabled: false, threshold: 10 }, archived: false };
    for (const key of ['platform', 'productId', 'name', 'brand', 'category']) if (own(input, key)) result[key] = key === 'platform' ? platform(input[key]) : key === 'productId' ? externalId(input[key]) : text(input[key], key === 'name' || key === 'category' ? 500 : 100, key === 'name' ? '상품명' : key, key !== 'name');
    if (!result.productId || !result.name) fail('플랫폼·상품 번호·상품명을 입력하세요.');
    if (previous && (result.platform !== previous.platform || result.productId !== previous.productId)) fail('기존 상품의 플랫폼과 상품 번호는 변경할 수 없습니다. 새 상품으로 등록하세요.');
    for (const key of ['url', 'imageUrl']) if (own(input, key)) result[key] = url(input[key], key === 'url' ? '상품 URL' : '이미지 URL', key === 'url' ? result.platform : null);
    for (const key of ['price', 'shipping', 'reviews', 'rating']) if (own(input, key)) result[key] = amount(input[key], key, { integer: key !== 'rating', max: key === 'rating' ? 5 : key === 'reviews' ? 1e12 : 1e14 });
    if (own(input, 'tags')) {
      if (!Array.isArray(input.tags) || input.tags.length > 100) fail('태그는 최대 100개입니다.');
      result.tags = [...new Set(input.tags.map(tag => text(tag, 100, '태그', false)))];
    }
    if (own(input, 'keywords')) result.keywords = keywords(input.keywords);
    if (own(input, 'folderId')) {
      result.folderId = input.folderId === null || input.folderId === '' ? null : id(input.folderId, '폴더 ID');
      if (result.folderId && !store.folders.some(folder => folder.id === result.folderId)) fail('상품을 넣을 폴더가 없습니다.', 404);
    }
    for (const key of ['favorite', 'archived']) if (own(input, key)) result[key] = bool(input[key], key);
    if (own(input, 'alert')) result.alert = alertSettings(input.alert);
    const now = new Date().toISOString();
    result.createdAt = previous?.createdAt || now; result.updatedAt = now;
    if (previous) store.products[store.products.findIndex(product => product.id === previous.id)] = result; else store.products.push(result);
    return result;
  }
  function state() { return read(); }
  function saveProduct(input) { return transaction(input, store => upsertProduct(store, input.product)); }
  function archiveProduct(input) { return transaction(input, store => { const product = getProduct(store, input.id); product.archived = true; product.updatedAt = new Date().toISOString(); }); }
  function upsertFolder(store, input) {
    object(input, '폴더');
    const folderId = own(input, 'id') ? id(input.id, '폴더 ID') : crypto.randomUUID(), name = text(input.name, 100, '폴더 이름', false);
    if (store.folders.some(folder => folder.id !== folderId && folder.name === name)) fail('같은 이름의 폴더가 있습니다.', 409);
    const index = store.folders.findIndex(folder => folder.id === folderId), folder = { id: folderId, name };
    if (index < 0) { if (store.folders.length >= 100) fail('폴더는 최대 100개입니다.'); store.folders.push(folder); } else store.folders[index] = folder;
    return folder;
  }
  function applySettings(store, input) {
    object(input, '화면 설정');
    if (Object.keys(input).length > 100 || Buffer.byteLength(JSON.stringify(input), 'utf8') > 16384) fail('화면 설정이 너무 큽니다.');
    store.settings = { ...store.settings, ...clone(input) };
    if (Object.keys(store.settings).length > 100 || Buffer.byteLength(JSON.stringify(store.settings), 'utf8') > 16384) fail('화면 설정이 너무 큽니다.');
  }
  function saveFolder(input) {
    return transaction(input, store => upsertFolder(store, input.folder));
  }
  function saveOrder(input) {
    return transaction(input, store => {
      // UI reorders active products only; archived records retain their order.
      if (!Array.isArray(input.ids)) fail('상품 순서 목록을 확인하세요.');
      const ids = input.ids.map(value => id(value, '상품 ID')), active = store.products.filter(product => !product.archived), wanted = new Set(ids);
      if (wanted.size !== ids.length || ids.length !== active.length || active.some(product => !wanted.has(product.id))) fail('보관 상품을 제외한 전체 상품을 중복 없이 정렬하세요.');
      const byId = new Map(active.map(product => [product.id, product]));
      store.products = [...ids.map(productId => byId.get(productId)), ...store.products.filter(product => product.archived)];
    });
  }
  function saveKeywords(input) { return transaction(input, store => { const product = getProduct(store, input.id); product.keywords = keywords(input.keywords); product.updatedAt = new Date().toISOString(); }); }
  function importData(input) {
    return transaction(input, store => {
      if (own(input, 'products') && !Array.isArray(input.products) || own(input, 'snapshots') && !Array.isArray(input.snapshots) || own(input, 'folders') && !Array.isArray(input.folders)) fail('가져올 상품·관찰 자료·폴더는 목록이어야 합니다.');
      const incomingProducts = input.products || [], incomingSnapshots = input.snapshots || [], incomingFolders = input.folders || [];
      if (!incomingProducts.length && !incomingSnapshots.length && !incomingFolders.length && !(own(input, 'settings') && Object.keys(object(input.settings, '화면 설정')).length)) fail('가져올 상품 또는 관찰 자료가 없습니다.');
      if (incomingProducts.length > LIMITS.products || incomingSnapshots.length > LIMITS.snapshots || incomingFolders.length > 100) fail('가져올 자료가 너무 많습니다.');
      // Restore folder identities before linking imported products. The entire
      // operation is committed only after every folder/product/day is valid.
      const seenFolders = new Set();
      for (const folder of incomingFolders) {
        const saved = upsertFolder(store, folder);
        if (seenFolders.has(saved.id)) fail('가져올 폴더가 중복됩니다.');
        seenFolders.add(saved.id);
      }
      if (own(input, 'settings')) applySettings(store, input.settings);
      const seenProducts = new Set();
      for (const product of incomingProducts) {
        const saved = upsertProduct(store, product);
        if (seenProducts.has(saved.id)) fail('가져올 상품이 중복됩니다.');
        seenProducts.add(saved.id);
      }
      const snapshotMap = new Map(store.snapshots.map(snapshot => [snapshot.productId + ':' + snapshot.date, snapshot])), seenSnapshots = new Set();
      const dateLimit = currentDate();
      for (const snapshot of incomingSnapshots) {
        object(snapshot, '관찰 자료');
        let product;
        if (own(snapshot, 'platform')) {
          const market = platform(snapshot.platform), identity = externalId(snapshot.productId);
          product = store.products.find(item => item.platform === market && item.productId === identity);
          if (!product) fail('관찰 자료에 연결할 상품이 없습니다.', 404);
        } else product = getProduct(store, snapshot.productId);
        const date = validDate(snapshot.date, dateLimit), key = product.id + ':' + date;
        if (seenSnapshots.has(key)) fail('한 번의 가져오기에 같은 상품·날짜 관찰 자료가 중복됩니다.');
        seenSnapshots.add(key);
        const previous = snapshotMap.get(key), result = previous ? { ...previous } : { productId: product.id, date, keywords: [] };
        for (const metric of ['price', 'shipping', 'reviews', 'rating', 'sales', 'salesAmount']) if (own(snapshot, metric)) result[metric] = amount(snapshot[metric], metric, { integer: metric !== 'rating', max: metric === 'rating' ? 5 : 1e14 });
        if (own(snapshot, 'keywords')) {
          if (!Array.isArray(snapshot.keywords) || snapshot.keywords.length > LIMITS.keywords) fail('관찰 키워드 목록을 확인하세요.');
          const values = new Map(result.keywords.map(value => [value.keyword, value])), seenKeywords = new Set();
          for (const keyword of snapshot.keywords) {
            const normalized = observationKeyword(keyword, values.get(text(object(keyword, '관찰 키워드').keyword, 100, '키워드', false)));
            if (seenKeywords.has(normalized.keyword)) fail('관찰 자료에 같은 키워드가 중복됩니다.');
            seenKeywords.add(normalized.keyword); values.set(normalized.keyword, normalized);
            // Observed keywords become selectable without removing the user's list.
            const registered = product.keywords.find(item => item.keyword === normalized.keyword);
            if (!registered) product.keywords.push({ keyword: normalized.keyword, searchVolume: normalized.searchVolume ?? null });
            else if (own(normalized, 'searchVolume')) registered.searchVolume = normalized.searchVolume;
          }
          result.keywords = [...values.values()];
        }
        result.updatedAt = new Date().toISOString(); snapshotMap.set(key, result);
      }
      store.snapshots = [...snapshotMap.values()].sort((a, b) => b.date.localeCompare(a.date) || a.productId.localeCompare(b.productId));
      store.lastImport = { source: own(input, 'source') ? text(input.source, 300, '자료 출처') : '파일 가져오기', at: new Date().toISOString(), products: incomingProducts.length, snapshots: incomingSnapshots.length, folders: incomingFolders.length };
    });
  }
  function saveSettings(input) {
    return transaction(input, store => applySettings(store, input.settings));
  }
  return Object.freeze({ state, saveProduct, archiveProduct, saveFolder, saveOrder, importData, saveKeywords, saveSettings });
}
module.exports = { createService, LIMITS };
