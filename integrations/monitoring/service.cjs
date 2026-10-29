'use strict';

// This store belongs only to daily product monitoring. It never reads or writes
// the sales/advertising stores and never invents observations for missing dates.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const LIMITS = Object.freeze({ products: 600, keywords: 3000, snapshotCells: 1000000, snapshots: 250000, reviews: 100000, alerts: 100000, fileBytes: 160 * 1024 * 1024 });
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
function alertSettings(value, previous) {
  const result = { enabled: false, threshold: 10, keywords: [], reviewEnabled: false, reviewStars: [1, 2, 3, 4, 5], mode: 'threshold', ...(previous || {}) };
  if (typeof value === 'boolean') return { ...result, enabled: value };
  object(value, '순위 알림');
  if (own(value, 'enabled')) result.enabled = bool(value.enabled, '순위 알림 설정');
  if (own(value, 'threshold')) result.threshold = rank(value.threshold, '알림 순위') ?? fail('알림 순위를 입력하세요.');
  if (own(value, 'keywords')) {
    if (!Array.isArray(value.keywords) || value.keywords.length > LIMITS.keywords) fail('알림 키워드 목록을 확인하세요.');
    result.keywords = [...new Set(value.keywords.map(keyword => text(keyword, 100, '알림 키워드', false)))];
  }
  if (own(value, 'reviewEnabled')) result.reviewEnabled = bool(value.reviewEnabled, '리뷰 알림 설정');
  if (own(value, 'reviewStars')) {
    if (!Array.isArray(value.reviewStars) || value.reviewStars.length > 5 || value.reviewStars.some(star => !Number.isInteger(star) || star < 1 || star > 5) || new Set(value.reviewStars).size !== value.reviewStars.length) fail('리뷰 알림 별점은 1~5점을 중복 없이 선택하세요.');
    result.reviewStars = [...value.reviewStars].sort((a, b) => a - b);
  }
  if (own(value, 'mode')) {
    if (!['daily', 'change', 'threshold'].includes(value.mode)) fail('순위 알림 방식은 daily·change·threshold 중 하나여야 합니다.');
    result.mode = value.mode;
  }
  return result;
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
function emptyState() { return { schema: 1, revision: 0, products: [], folders: [], snapshots: [], reviews: [], alerts: [], settings: {} }; }
function checkLimits(store) {
  if (store.products.length > LIMITS.products) fail('등록 상품은 보관 상품을 포함해 최대 600개입니다.');
  if (store.products.reduce((sum, product) => sum + product.keywords.length, 0) > LIMITS.keywords) fail('등록 키워드는 보관 상품을 포함해 최대 3,000개입니다.');
  if (store.reviews.length > LIMITS.reviews) fail('리뷰 기록은 최대 100,000개까지 저장할 수 있습니다.');
  if (store.alerts.length > LIMITS.alerts) fail('알림 기록은 최대 100,000개까지 저장할 수 있습니다.');
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
      // schema1 files written before review/notification support remain valid.
      if (!own(store, 'reviews')) store.reviews = [];
      if (!own(store, 'alerts')) store.alerts = [];
      if (!Array.isArray(store.reviews) || !Array.isArray(store.alerts)) throw Error('format');
      const productIds = new Set(store.products.map(product => product.id));
      if (store.reviews.some(review => !review || typeof review.id !== 'string' || !productIds.has(review.productId) || typeof review.date !== 'string' || !Number.isInteger(review.rating) || review.rating < 1 || review.rating > 5 || typeof review.text !== 'string') || new Set(store.reviews.map(review => review.productId + ':' + review.id)).size !== store.reviews.length) throw Error('format');
      if (store.alerts.some(alert => !alert || typeof alert.id !== 'string' || !productIds.has(alert.productId) || !['rank', 'review'].includes(alert.kind) || typeof alert.createdAt !== 'string' || alert.readAt !== null && typeof alert.readAt !== 'string') || new Set(store.alerts.map(alert => alert.id)).size !== store.alerts.length) throw Error('format');

      // Reject corrupt files instead of silently replacing a user's history.
      if (new Set(store.products.map(p => p.id)).size !== store.products.length || store.products.some(p => !p || !Array.isArray(p.keywords)) || store.snapshots.some(s => !s || !Array.isArray(s.keywords))) throw Error('format');
      for (const product of store.products) {
        if (!own(product, 'keywordSelection')) product.keywordSelection = 'source';
        else if (!['source', 'local'].includes(product.keywordSelection)) throw Error('format');
      }
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
    const result = previous ? { ...previous } : { id: requestedId || crypto.randomUUID(), platform: requestedPlatform || 'naver', productId: requestedExternal || '', name: '', brand: '', url: '', imageUrl: '', price: null, wowPrice: null, shipping: null, reviews: null, rating: null, category: '', tags: [], keywords: [], keywordSelection: 'source', folderId: null, favorite: false, alert: alertSettings(false), archived: false };
    for (const key of ['platform', 'productId', 'name', 'brand', 'category']) if (own(input, key)) result[key] = key === 'platform' ? platform(input[key]) : key === 'productId' ? externalId(input[key]) : text(input[key], key === 'name' || key === 'category' ? 500 : 100, key === 'name' ? '상품명' : key, key !== 'name');
    if (!result.productId || !result.name) fail('플랫폼·상품 번호·상품명을 입력하세요.');
    for (const key of ['vendorItemId', 'itemId']) if (own(input, key)) result[key] = input[key] === null || input[key] === '' ? null : externalId(input[key]);

    if (previous && (result.platform !== previous.platform || result.productId !== previous.productId)) fail('기존 상품의 플랫폼과 상품 번호는 변경할 수 없습니다. 새 상품으로 등록하세요.');
    for (const key of ['url', 'imageUrl']) if (own(input, key)) result[key] = url(input[key], key === 'url' ? '상품 URL' : '이미지 URL', key === 'url' ? result.platform : null);
    for (const key of ['price', 'wowPrice', 'shipping', 'reviews', 'rating']) if (own(input, key)) result[key] = amount(input[key], key, { integer: key !== 'rating', max: key === 'rating' ? 5 : key === 'reviews' ? 1e12 : 1e14 });
    if (own(input, 'tags')) {
      if (!Array.isArray(input.tags) || input.tags.length > 100) fail('태그는 최대 100개입니다.');
      result.tags = [...new Set(input.tags.map(tag => text(tag, 100, '태그', false)))];
    }
    if (own(input, 'keywords')) result.keywords = keywords(input.keywords);
    if (own(input, 'keywordSelection')) {
      if (!['source', 'local'].includes(input.keywordSelection)) fail('키워드 선택 방식은 source 또는 local이어야 합니다.');
      result.keywordSelection = input.keywordSelection;
    }

    if (own(input, 'folderId')) {
      result.folderId = input.folderId === null || input.folderId === '' ? null : id(input.folderId, '폴더 ID');
      if (result.folderId && !store.folders.some(folder => folder.id === result.folderId)) fail('상품을 넣을 폴더가 없습니다.', 404);
    }
    for (const key of ['favorite', 'archived']) if (own(input, key)) result[key] = bool(input[key], key);
    if (own(input, 'alert')) result.alert = alertSettings(input.alert, previous?.alert);
    const now = new Date().toISOString();
    result.createdAt = previous?.createdAt || now; result.updatedAt = now;
    if (previous) store.products[store.products.findIndex(product => product.id === previous.id)] = result; else store.products.push(result);
    return result;
  }
  function state() { return read(); }
  function saveProduct(input) {
    return transaction(input, store => {
      object(input.product, '상품');
      const existing = own(input.product, 'id') ? store.products.find(product => product.id === input.product.id) : store.products.find(product => product.platform === input.product.platform && product.productId === input.product.productId);
      const previous = existing ? { ...existing } : null;
      const metricKeys = ['price', 'wowPrice', 'shipping', 'reviews', 'rating'], effective = new Map();
      if (previous) {
        for (const snapshot of store.snapshots) {
          if (snapshot.productId !== previous.id) continue;
          for (const key of metricKeys) if (own(snapshot, key) && (!effective.has(key) || snapshot.date > effective.get(key).date)) effective.set(key, { date: snapshot.date, value: snapshot[key] });
        }
      }
      const saved = upsertProduct(store, input.product);
      // Only an explicit manual keyword edit changes ownership of this list.
      // Source imports use upsertProduct directly and retain source ownership.
      if (!previous || own(input.product, 'keywords') && JSON.stringify(previous.keywords) !== JSON.stringify(saved.keywords)) saved.keywordSelection = 'local';
      const changed = {};
      for (const key of metricKeys) {
        const previousValue = effective.has(key) ? effective.get(key).value : previous?.[key];
        if (own(input.product, key) && (previous ? previousValue !== saved[key] : saved[key] !== null)) changed[key] = saved[key];
      }
      // Explicit manual changes are observations of today, never rewrites of a
      // historical date. Sparse fields and explicit unknowns stay sparse/null.
      if (Object.keys(changed).length) {
        const date = validDate(currentDate(), currentDate());
        let snapshot = store.snapshots.find(row => row.productId === saved.id && row.date === date);
        if (!snapshot) { snapshot = { productId: saved.id, date, keywords: [] }; store.snapshots.push(snapshot); }
        Object.assign(snapshot, changed, { source: 'manual', updatedAt: new Date().toISOString() });
        store.snapshots.sort((a, b) => b.date.localeCompare(a.date) || a.productId.localeCompare(b.productId));
      }
    });
  }
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
    return transaction(input, store => {
      const folder = object(input.folder, '폴더');
      if (own(folder, 'remove') && bool(folder.remove, '폴더 삭제')) {
        if (!own(folder, 'id')) fail('삭제할 폴더를 찾을 수 없습니다.', 404);
        const folderId = id(folder.id, '폴더 ID'), index = store.folders.findIndex(item => item.id === folderId);
        if (index < 0) fail('삭제할 폴더를 찾을 수 없습니다.', 404);
        store.folders.splice(index, 1);
        // Deleting a grouping never deletes the products or their records.
        for (const product of store.products) if (product.folderId === folderId) product.folderId = null;
        return;
      }
      upsertFolder(store, folder);
    });
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
  function saveKeywords(input) { return transaction(input, store => { const product = getProduct(store, input.id); product.keywords = keywords(input.keywords); product.keywordSelection = 'local'; product.updatedAt = new Date().toISOString(); }); }
  function linkedProduct(store, input, label) {
    if (own(input, 'platform')) {
      const market = platform(input.platform), identity = externalId(input.productId);
      const product = store.products.find(item => item.platform === market && item.productId === identity);
      if (!product) fail(label + '에 연결할 상품이 없습니다.', 404);
      return product;
    }
    return getProduct(store, input.productId);
  }
  function isoTimestamp(value, label) {
    const raw = text(value, 64, label, false), time = Date.parse(raw);
    if (!Number.isFinite(time) || !/^\d{4}-\d{2}-\d{2}T/.test(raw)) fail(label + ' 날짜와 시간을 확인하세요.');
    return new Date(time).toISOString();
  }
  function reviewRecord(store, input, previous) {
    object(input, '리뷰');
    const product = linkedProduct(store, input, '리뷰');
    const result = previous ? { ...previous } : { id: id(input.id, '리뷰 ID'), productId: product.id, date: '', rating: null, text: '', title: '', authorMasked: '', option: '', imageUrls: [], sourceUrl: '', source: '' };
    result.id = id(input.id, '리뷰 ID'); result.productId = product.id;
    if (own(input, 'date')) result.date = validDate(input.date, currentDate());
    if (own(input, 'rating')) result.rating = amount(input.rating, '리뷰 별점', { integer: true, min: 1, max: 5 });
    if (!result.date || result.rating === null) fail('리뷰 날짜와 실제 별점이 필요합니다.');
    for (const [key, max] of [['text', 10000], ['title', 300], ['authorMasked', 80], ['option', 500], ['source', 300]]) if (own(input, key)) result[key] = text(input[key], max, '리뷰 ' + key);
    if (result.authorMasked && (!/[*＊•●]/.test(result.authorMasked) || /@|\d{6}/.test(result.authorMasked))) fail('리뷰 작성자는 마스킹된 표시명만 저장하세요.');
    if (own(input, 'imageUrls')) {
      if (!Array.isArray(input.imageUrls) || input.imageUrls.length > 20) fail('리뷰 이미지는 최대 20개입니다.');
      result.imageUrls = [...new Set(input.imageUrls.map(value => url(value, '리뷰 이미지 URL')))];
    }
    if (own(input, 'videoUrls')) {
      if (!Array.isArray(input.videoUrls) || input.videoUrls.length > 20) fail('리뷰 동영상은 최대 20개입니다.');
      result.videoUrls = [...new Set(input.videoUrls.map(value => url(value, '리뷰 동영상 URL')))];
    }
    if (own(input, 'sourceOrder')) result.sourceOrder = amount(input.sourceOrder, '원본 리뷰 순서', { integer: true, max: 100000000 });
    if (own(input, 'monthUse')) result.monthUse = bool(input.monthUse, '한달사용리뷰 표시');
    if (own(input, 'sourceUrl')) result.sourceUrl = url(input.sourceUrl, '리뷰 원문 URL', product.platform);
    const now = new Date().toISOString();
    result.firstSeenAt = previous?.firstSeenAt || (own(input, 'firstSeenAt') ? isoTimestamp(input.firstSeenAt, '리뷰 최초 수집 시각') : now); result.updatedAt = own(input, 'updatedAt') ? isoTimestamp(input.updatedAt, '리뷰 수정 시각') : now;
    return result;
  }
  function alertRecord(store, input) {
    object(input, '알림');
    if (!['rank', 'review'].includes(input.kind)) fail('알림 종류를 확인하세요.');
    const product = getProduct(store, input.productId);
    const result = { id: id(input.id, '알림 ID'), kind: input.kind, productId: product.id, date: validDate(input.date, currentDate()), createdAt: isoTimestamp(input.createdAt, '알림 생성 시각'), readAt: input.readAt == null ? null : isoTimestamp(input.readAt, '알림 확인 시각') };
    if (input.kind === 'rank') {
      result.keyword = text(input.keyword, 100, '알림 키워드', false);
      result.mode = own(input, 'mode') ? input.mode : 'threshold';
      if (!['daily', 'change', 'threshold'].includes(result.mode)) fail('알림 방식을 확인하세요.');
      for (const key of ['rank', 'oldRank', 'outsideLimit', 'oldOutsideLimit', 'threshold']) if (own(input, key)) result[key] = rank(input[key], '알림 순위');
      for (const key of ['status', 'oldStatus']) if (own(input, key)) { if (!['ranked', 'outside', 'pending', 'missing'].includes(input[key])) fail('알림 순위 상태를 확인하세요.'); result[key] = input[key]; }
    } else { result.reviewId = id(input.reviewId, '알림 리뷰 ID'); if (!store.reviews.some(review => review.productId === product.id && review.id === result.reviewId)) fail('알림에 연결할 리뷰가 없습니다.', 404); }
    return result;
  }
  const eventId = pieces => crypto.createHash('sha256').update(JSON.stringify(pieces)).digest('hex');
  function alertStatus(keyword, threshold) {
    if (keyword?.status === 'ranked' && typeof keyword.rank === 'number') return keyword.rank <= threshold;
    if (keyword?.status === 'outside' && typeof keyword.outsideLimit === 'number' && keyword.outsideLimit >= threshold) return false;
    return null;
  }
  function generateAlerts(store, before, touched, newReviews, date) {
    const now = new Date().toISOString(), existing = new Set(store.alerts.map(alert => alert.id));
    const oldDays = new Map(before.snapshots.map(snapshot => [snapshot.productId + ':' + snapshot.date, snapshot]));
    const baseline = new Set(before.snapshots.filter(snapshot => snapshot.keywords.some(keyword => ['ranked', 'outside'].includes(keyword.status))).map(snapshot => snapshot.productId));
    const reviewBaseline = new Set([...before.snapshots.map(snapshot => snapshot.productId), ...before.reviews.map(review => review.productId)]);
    const previousDate = new Date(Date.parse(date + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
    const append = event => { if (!existing.has(event.id)) { existing.add(event.id); store.alerts.push(event); } };
    for (const snapshot of touched) {
      if (snapshot.date !== date) continue;
      const product = getProduct(store, snapshot.productId), settings = alertSettings(product.alert || false);
      if (product.archived || !settings.enabled || !baseline.has(product.id)) continue;
      const oldSnapshot = oldDays.get(product.id + ':' + previousDate), oldKeywords = new Map((oldSnapshot?.keywords || []).map(keyword => [keyword.keyword, keyword]));
      for (const keyword of snapshot.keywords) {
        if (!['ranked', 'outside'].includes(keyword.status) || settings.keywords.length && !settings.keywords.includes(keyword.keyword)) continue;
        const old = oldKeywords.get(keyword.keyword), mode = settings.mode;
        let notify = mode === 'daily';
        if (mode === 'change') notify = !!old && ['ranked', 'outside'].includes(old.status) && (old.status !== keyword.status || old.rank !== keyword.rank);
        if (mode === 'threshold') {
          const oldValue = alertStatus(old, settings.threshold), value = alertStatus(keyword, settings.threshold);
          notify = oldValue !== null && value !== null && oldValue !== value;
        }
        if (!notify) continue;
        const parts = mode === 'daily' ? ['rank', mode, product.id, date, keyword.keyword] : ['rank', mode, product.id, date, keyword.keyword, old.status, old.rank, keyword.status, keyword.rank, settings.threshold];
        append({ id: eventId(parts), kind: 'rank', mode, productId: product.id, date, keyword: keyword.keyword, oldRank: old?.rank ?? null, rank: keyword.rank, oldStatus: old?.status || 'missing', status: keyword.status, oldOutsideLimit: old?.outsideLimit ?? null, outsideLimit: keyword.outsideLimit ?? null, threshold: settings.threshold, createdAt: now, readAt: null });
      }
    }
    for (const review of newReviews) {
      const product = getProduct(store, review.productId), settings = alertSettings(product.alert || false);
      if (!product.archived && settings.reviewEnabled && settings.reviewStars.includes(review.rating) && review.date === date && reviewBaseline.has(product.id)) append({ id: eventId(['review', product.id, review.id]), kind: 'review', productId: product.id, date, reviewId: review.id, createdAt: now, readAt: null });
    }
    store.alerts.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  }
  function importData(input) {
    return transaction(input, store => {
      for (const key of ['products', 'snapshots', 'folders', 'reviews', 'alerts']) if (own(input, key) && !Array.isArray(input[key])) fail('가져올 상품·관찰 자료·폴더·리뷰·알림은 목록이어야 합니다.');
      const incomingProducts = input.products || [], incomingSnapshots = input.snapshots || [], incomingFolders = input.folders || [], incomingReviews = input.reviews || [], incomingAlerts = input.alerts || [];
      if (!incomingProducts.length && !incomingSnapshots.length && !incomingFolders.length && !incomingReviews.length && !incomingAlerts.length && !(own(input, 'settings') && Object.keys(object(input.settings, '화면 설정')).length)) fail('가져올 상품 또는 관찰 자료가 없습니다.');
      if (incomingProducts.length > LIMITS.products || incomingSnapshots.length > LIMITS.snapshots || incomingFolders.length > 100 || incomingReviews.length > LIMITS.reviews || incomingAlerts.length > LIMITS.alerts) fail('가져올 자료가 너무 많습니다.');
      const before = { snapshots: store.snapshots.map(snapshot => ({ ...snapshot, keywords: snapshot.keywords.map(keyword => ({ ...keyword })) })), reviews: store.reviews.map(review => ({ ...review })) };
      const seenFolders = new Set();
      for (const folder of incomingFolders) { const saved = upsertFolder(store, folder); if (seenFolders.has(saved.id)) fail('가져올 폴더가 중복됩니다.'); seenFolders.add(saved.id); }
      if (own(input, 'settings')) applySettings(store, input.settings);
      const seenProducts = new Set();
      for (const product of incomingProducts) { const saved = upsertProduct(store, product); if (seenProducts.has(saved.id)) fail('가져올 상품이 중복됩니다.'); seenProducts.add(saved.id); }
      const snapshotMap = new Map(store.snapshots.map(snapshot => [snapshot.productId + ':' + snapshot.date, snapshot])), seenSnapshots = new Set(), touched = [];
      const dateLimit = currentDate();
      for (const snapshot of incomingSnapshots) {
        object(snapshot, '관찰 자료');
        const product = linkedProduct(store, snapshot, '관찰 자료');
        const date = validDate(snapshot.date, dateLimit), key = product.id + ':' + date;
        if (seenSnapshots.has(key)) fail('한 번의 가져오기에 같은 상품·날짜 관찰 자료가 중복됩니다.');
        seenSnapshots.add(key);
        const previous = snapshotMap.get(key), result = previous ? { ...previous } : { productId: product.id, date, keywords: [] };
        for (const metric of ['price', 'wowPrice', 'shipping', 'reviews', 'rating', 'sales', 'salesAmount', 'rollingSales7d']) if (own(snapshot, metric)) result[metric] = amount(snapshot[metric], metric, { integer: metric !== 'rating', max: metric === 'rating' ? 5 : 1e14 });
        if (own(snapshot, 'source')) result.source = text(snapshot.source, 300, '관찰 자료 출처');
        if (own(snapshot, 'keywords')) {
          if (!Array.isArray(snapshot.keywords) || snapshot.keywords.length > LIMITS.keywords) fail('관찰 키워드 목록을 확인하세요.');
          const values = new Map(result.keywords.map(value => [value.keyword, value])), seenKeywords = new Set();
          for (const keyword of snapshot.keywords) {
            const normalized = observationKeyword(keyword, values.get(text(object(keyword, '관찰 키워드').keyword, 100, '키워드', false)));
            if (seenKeywords.has(normalized.keyword)) fail('관찰 자료에 같은 키워드가 중복됩니다.');
            seenKeywords.add(normalized.keyword); values.set(normalized.keyword, normalized);
            if (!product.keywords.some(item => item.keyword === normalized.keyword)) product.keywords.push({ keyword: normalized.keyword, searchVolume: null });
          }
          result.keywords = [...values.values()];
        }
        result.updatedAt = new Date().toISOString(); snapshotMap.set(key, result);
        // Only a supplied ordinary rank/status is a new rank observation.
        // Updating price, search volume or an ad position cannot make an old
        // ordinary rank appear freshly collected for daily notifications.
        const freshlyObserved = new Set((snapshot.keywords || []).filter(keyword => own(keyword, 'rank') || own(keyword, 'status')).map(keyword => keyword.keyword.trim().normalize('NFC')));
        touched.push({ productId: product.id, date, keywords: result.keywords.filter(keyword => freshlyObserved.has(keyword.keyword)) });
      }
      store.snapshots = [...snapshotMap.values()].sort((a, b) => b.date.localeCompare(a.date) || a.productId.localeCompare(b.productId));
      // Resolve current search volume by observation date, independently from
      // whether a file lists its newest or oldest rows first.
      const latestVolumes = new Map();
      for (const snapshot of store.snapshots) for (const keyword of snapshot.keywords) {
        const key = snapshot.productId + ':' + keyword.keyword;
        if (own(keyword, 'searchVolume') && !latestVolumes.has(key)) latestVolumes.set(key, keyword.searchVolume);
      }
      for (const product of store.products) for (const keyword of product.keywords) { const key = product.id + ':' + keyword.keyword; if (latestVolumes.has(key)) keyword.searchVolume = latestVolumes.get(key); }
      const reviewMap = new Map(store.reviews.map(review => [review.productId + ':' + review.id, review])), newReviews = [], seenReviews = new Set();
      for (const review of incomingReviews) {
        object(review, '리뷰'); const product = linkedProduct(store, review, '리뷰'), reviewId = id(review.id, '리뷰 ID'), key = product.id + ':' + reviewId;
        if (seenReviews.has(key)) fail('같은 상품·리뷰 ID가 중복됩니다.');
        seenReviews.add(key); const previous = reviewMap.get(key), saved = reviewRecord(store, review, previous);
        if (!previous) newReviews.push(saved);
        reviewMap.set(key, saved);
      }
      store.reviews = [...reviewMap.values()].sort((a, b) => b.date.localeCompare(a.date) || a.productId.localeCompare(b.productId) || a.id.localeCompare(b.id));
      const alerts = new Map(store.alerts.map(alert => [alert.id, alert])), seenAlerts = new Set();
      for (const alert of incomingAlerts) { const saved = alertRecord(store, alert); if (seenAlerts.has(saved.id)) fail('가져올 알림이 중복됩니다.'); seenAlerts.add(saved.id); const previous = alerts.get(saved.id); if (previous && (previous.productId !== saved.productId || previous.kind !== saved.kind)) fail('같은 알림 ID를 다른 상품이나 종류로 바꿀 수 없습니다.', 409); alerts.set(saved.id, previous?.readAt && !saved.readAt ? { ...saved, readAt: previous.readAt } : saved); }
      store.alerts = [...alerts.values()];
      // Explicit alert backup restoration carries its own notification history;
      // it must not manufacture a new set of notifications while restoring.
      if (!own(input, 'alerts')) generateAlerts(store, before, touched, newReviews, dateLimit);
      store.lastImport = { source: own(input, 'source') ? text(input.source, 300, '자료 출처') : '파일 가져오기', at: new Date().toISOString(), products: incomingProducts.length, snapshots: incomingSnapshots.length, reviews: incomingReviews.length, folders: incomingFolders.length };
    });
  }
  function acknowledgeAlerts(input) {
    return transaction(input, store => {
      let wanted;
      if (own(input, 'ids')) {
        if (!Array.isArray(input.ids) || input.ids.length > LIMITS.alerts) fail('확인할 알림 목록을 확인하세요.');
        const ids = input.ids.map(value => id(value, '알림 ID')), known = new Set(store.alerts.map(alert => alert.id)); wanted = new Set(ids);
        if (wanted.size !== ids.length || ids.some(value => !known.has(value))) fail('확인할 알림이 없거나 중복됩니다.', 404);
      }
      const now = new Date().toISOString();
      for (const alert of store.alerts) if ((!wanted || wanted.has(alert.id)) && !alert.readAt) alert.readAt = now;
    });
  }
  function saveSettings(input) {
    return transaction(input, store => applySettings(store, input.settings));
  }
  return Object.freeze({ state, saveProduct, archiveProduct, saveFolder, saveOrder, importData, saveKeywords, saveSettings, acknowledgeAlerts });
}
module.exports = { createService, LIMITS };
