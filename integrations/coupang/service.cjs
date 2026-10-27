'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const CHANNELS = ['growth', 'seller'];
const COSTS = ['netSales', 'productCost', 'commission', 'advertising', 'inbound', 'delivery', 'storage', 'returns', 'other'];
const DAY = 86400000;
const fail = (status, message) => Object.assign(Error(message), { status });
const kstDay = ms => new Date(ms + 9 * 3600000).toISOString().slice(0, 10);
const validDay = s => typeof s === 'string' && /^\d{4}-\d\d-\d\d$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
const id = s => (typeof s === 'string' && /^[1-9]\d{0,19}$/.test(s)) || (Number.isSafeInteger(s) && s > 0);
const hash = x => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function money(x) {
  if (!['string', 'number'].includes(typeof x) || String(x).trim() === '') return null;
  const n = Number(x); return Number.isFinite(n) && n >= 0 && n <= 1e12 ? n : null;
}
function apiMoney(x) {
  if (!x || typeof x !== 'object') return money(x);
  if (x.currencyCode !== 'KRW' || !/^-?\d+$/.test(String(x.units ?? '')) || !Number.isInteger(Number(x.nanos ?? 0)) || Number(x.nanos ?? 0) < 0 || Number(x.nanos ?? 0) >= 1e9) return null;
  return money(Number(x.units) + Number(x.nanos ?? 0) / 1e9);
}
function orderDate(raw, channel) {
  const stamp = channel === 'growth' ? raw?.paidAt : raw?.orderedAt || raw?.paidAt;
  if (channel === 'growth' && (typeof stamp === 'number' || typeof stamp === 'string' && /^\d{13}$/.test(stamp)) && Number.isFinite(Number(stamp))) return kstDay(Number(stamp));
  if (typeof stamp === 'string' && validDay(stamp.slice(0, 10))) return /(?:Z|[+-]\d\d:\d\d)$/.test(stamp) && Number.isFinite(Date.parse(stamp)) ? kstDay(Date.parse(stamp)) : stamp.slice(0, 10);
  return null;
}
function range(since, until, now, max = 366) {
  if (!validDay(since) || !validDay(until) || since > until || until > kstDay(now) || (Date.parse(until) - Date.parse(since)) / DAY >= max) throw fail(400, '조회 날짜를 확인하세요. 최대 ' + max + '일이며 미래 날짜는 사용할 수 없습니다.');
  const days = []; for (let t = Date.parse(since); t <= Date.parse(until); t += DAY) days.push(new Date(t).toISOString().slice(0, 10)); return days;
}
function signature(config, uri, query, now) {
  const date = new Date(now).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '').slice(2);
  const digest = crypto.createHmac('sha256', config.secretKey).update(date + 'GET' + uri + query).digest('hex');
  return 'CEA algorithm=HmacSHA256, access-key=' + config.accessKey + ', signed-date=' + date + ', signature=' + digest;
}
function atomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true }); const temp = file + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
  try { fs.writeFileSync(temp, value, { flag: 'wx', mode: 0o600 }); fs.renameSync(temp, file); } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}
function normalize(raw, channel, date) {
  if (!raw || !id(raw.orderId) || !Array.isArray(raw.orderItems)) throw fail(502, '쿠팡 주문 응답 형식을 확인할 수 없습니다. 기존 자료를 유지합니다.');
  const paidDay = orderDate(raw, channel);
  if (paidDay !== date) throw fail(502, '쿠팡 주문 날짜가 조회 날짜와 다릅니다. 기존 자료를 유지합니다.');
  return raw.orderItems.map(item => {
    if (!item || !id(item.vendorItemId)) throw fail(502, '쿠팡 옵션 ID를 확인할 수 없습니다.');
    const quantity = money(channel === 'growth' ? item.salesQuantity : item.shippingCount);
    const gross = channel === 'growth' ? money(item.unitSalesPrice) : apiMoney(item.orderPrice);
    if (quantity === null || !Number.isInteger(quantity) || gross === null || (channel === 'growth' && item.currency !== 'KRW')) throw fail(502, '쿠팡 주문 금액·수량·통화를 확인할 수 없습니다.');
    if (channel === 'seller' && !id(raw.shipmentBoxId)) throw fail(502, '쿠팡 배송번호를 확인할 수 없습니다.');
    return { key: String(raw.orderId) + ':' + String(raw.shipmentBoxId || '') + ':' + String(item.vendorItemId), orderId: String(raw.orderId),
      itemId: String(item.vendorItemId), name: String(item.productName || item.vendorItemName || '').slice(0, 300), quantity,
      gross: channel === 'growth' ? gross * quantity : gross };
  });
}
// API CDN paths are public image metadata. Relative vendor_inventory paths use
// Coupang's image CDN convention; browser load errors retain the placeholder.
function safeThumbnailUrl(value) {
  if (typeof value !== 'string' || !value || value.length > 2048 || /[\s\\\u0000-\u001f\u007f%?#]/.test(value)) return null;
  let raw = value;
  if (/^vendor_inventory\//.test(raw)) raw = 'https://image1.coupangcdn.com/image/' + raw;
  if (!/^https?:\/\/image[0-9]+\.coupangcdn\.com\/image\/[A-Za-z0-9/_\-.]+\.(?:jpg|jpeg|png|webp)$/i.test(raw)) return null;
  try {
    const url = new URL(raw);
    if (url.pathname.split('/').some(part => part === '.' || part === '..') || raw.split('/').some(part => part === '.' || part === '..')) return null;
    url.protocol = 'https:'; return url.href;
  } catch { return null; }
}
function createService({ baseDir, protect, fetchImpl = (...args) => fetch(...args), now = Date.now, sleep = ms => new Promise(r => setTimeout(r, ms)) }) {
  const privateFile = path.join(baseDir, '.roas-private', 'coupang.dpapi');
  const root = path.join(baseDir, '.roas-data', 'coupang');
  let busy = false, lastRequest = 0, historyActive = false, historyTask = null, refreshActive = false, refreshTask = null;
  let startupRefreshRequested = false, startupRefreshDone = false;
  let thumbnailActive = null, thumbnailTask = null;
  const productUri = '/v2/providers/seller_api/apis/api/v1/marketplace/seller-products';
  function read(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return fallback; throw fail(500, '쿠팡 저장 자료를 읽을 수 없습니다.'); } }
  function config() {
    if (!fs.existsSync(privateFile)) throw fail(409, '먼저 쿠팡 API 정보를 등록하세요.');
    try { return credentials(JSON.parse(protect('decrypt', fs.readFileSync(privateFile, 'utf8')))); }
    catch { throw fail(500, '저장한 쿠팡 연결 정보를 읽을 수 없습니다. 같은 Windows 사용자로 실행하거나 다시 등록하세요.'); }
  }
  function credentials(v) {
    const c = Object.fromEntries(['vendorId', 'accessKey', 'secretKey'].map(k => [k, typeof v?.[k] === 'string' ? v[k].trim() : '']));
    if (!/^A\d{6,20}$/.test(c.vendorId) || ['accessKey', 'secretKey'].some(k => !/^[A-Za-z0-9_+/=.-]{8,512}$/.test(c[k]))) throw fail(400, '업체코드·Access Key·Secret Key를 확인하세요.');
    return c;
  }
  const dir = c => path.join(root, c.vendorId);
  function scope(c) { return read(path.join(dir(c), 'scope.json'), { products: [], key: '' }); }
  function requireScope(c) { const s = scope(c); if (!s.products.length) throw fail(409, '집계할 트루버·위마망 옵션 ID를 먼저 선택하세요.'); return s; }
  function snapshot(c, date, channel) { return read(path.join(dir(c), 'orders', date + '-' + channel + '.json'), null); }
  const basis = snap => snap ? hash(snap.rows) : 'no-api-data';
  function ledgerFile(c, s) { return path.join(dir(c), 'ledgers', s.key + '.json'); }
  function productMetadata(p) {
    const extra = {};
    if (Object.hasOwn(p, 'productId')) {
      if (p.productId !== null && !id(p.productId)) throw fail(400, '상품 ID를 확인하세요.');
      extra.productId = p.productId === null ? null : String(p.productId);
    }
    for (const key of ['productName', 'optionName']) if (Object.hasOwn(p, key)) {
      if (typeof p[key] !== 'string' || p[key].length > 300) throw fail(400, '상품명·옵션명을 확인하세요.');
      extra[key] = p[key].trim();
    }
    if (Object.hasOwn(p, 'salePrice')) {
      if (p.salePrice !== null && money(p.salePrice) === null) throw fail(400, '판매가를 확인하세요.');
      extra.salePrice = p.salePrice === null ? null : money(p.salePrice);
    }
    if (Object.hasOwn(p, 'channel')) {
      if (p.channel !== null && !CHANNELS.includes(p.channel)) throw fail(400, '상품 배송 방식을 확인하세요.');
      extra.channel = p.channel;
    }
    return extra;
  }
  function status() {
    if (!fs.existsSync(privateFile)) return { configured: false, busy, products: [] };
    const c = config(), s = scope(c);
    return { configured: true, vendorId: c.vendorId, busy: busy || historyActive || refreshActive, products: s.products, scopeKey: s.key, apiVerified: read(path.join(dir(c), 'state.json'), {}), history: historyStatus(), backfill: read(path.join(dir(c), 'backfill.json'), {}), automatic: automaticStatus(c), connectionCheck: read(path.join(dir(c), 'connection-check.json'), null) };
  }
  function saveCredentials(v) {
    if (busy || historyActive || refreshActive) throw fail(409, '수집 중에는 연결 정보를 바꿀 수 없습니다.');
    const c = credentials(v); let encrypted;
    try { encrypted = protect('encrypt', JSON.stringify(c)); } catch { throw fail(500, 'Windows 계정 암호화에 실패했습니다. 기존 연결은 유지됩니다.'); }
    atomic(privateFile, encrypted);
    const previousCheck = path.join(dir(c), 'connection-check.json');
    if (fs.existsSync(previousCheck)) atomic(previousCheck, 'null');
    return status();
  }
  function saveScope(v) {
    const c = config();
    if (!Array.isArray(v?.products) || !v.products.length || v.products.length > 500) throw fail(400, '트루버·위마망 옵션을 1개 이상 선택하세요.');
    const products = v.products.map(p => {
      if (!id(p?.itemId) || typeof p.name !== 'string' || !p.name.trim() || p.name.length > 300 || (p.unitCost !== null && money(p.unitCost) === null)) throw fail(400, '옵션 ID·상품명·원가를 확인하세요.');
      return { ...scope(c).products.find(old=>old.itemId===String(p.itemId)), ...productMetadata(p), itemId: String(p.itemId), name: p.name.trim(), unitCost: p.unitCost === null ? null : money(p.unitCost) };
    }).sort((a, b) => a.itemId.localeCompare(b.itemId));
    if (new Set(products.map(p => p.itemId)).size !== products.length) throw fail(400, '중복 옵션 ID를 제거하세요.');
    // Costs belong to exactly this set of products; changing unit costs does not erase a reconciled ledger.
    atomic(path.join(dir(c), 'scope.json'), JSON.stringify({ products, key: hash(products.map(p => p.itemId)) })); return status();
  }
  function importCatalog(v) {
    const c = config(), previous = scope(c);
    if (!Array.isArray(v.products) || !v.products.length || v.products.length > 500) throw fail(400, '상품현황 옵션은 1~500개여야 합니다.');
    const incoming = v.products.map(p => {
      if (!id(p.itemId) || typeof p.name !== 'string' || !p.name.trim() || p.name.length > 300) throw fail(400, '옵션 ID·상품명을 확인하세요.');
      for (const k of ['unitCost','commissionRate','inboundFee','deliveryFee']) if (money(p[k]) === null) throw fail(400, '원가·수수료·배송비에 숫자가 필요합니다.');
      if (Number(p.commissionRate) > 100 || p.costSince && !validDay(p.costSince)) throw fail(400, '수수료율·원가 기준일을 확인하세요.');
      return { ...productMetadata(p), itemId:String(p.itemId), name:p.name.trim(), unitCost:Number(p.unitCost)>0?Number(p.unitCost):null,
        commissionRate:Number(p.commissionRate), inboundFee:Number(p.inboundFee), deliveryFee:Number(p.deliveryFee),
        costSince:p.costSince||null, source:'상품현황', importedAt:new Date(now()).toISOString() };
    });
    if (new Set(incoming.map(p=>p.itemId)).size !== incoming.length) throw fail(400, '중복 옵션 ID가 있습니다.');
    const merged = new Map(previous.products.map(p=>[p.itemId,p]));
    for (const p of incoming) merged.set(p.itemId,{...merged.get(p.itemId),...p});
    if (merged.size > 500) throw fail(400, '기존 상품을 포함해 500개를 초과합니다.');
    const products = [...merged.values()].sort((a,b)=>a.itemId.localeCompare(b.itemId));
    atomic(path.join(dir(c),'scope.json'), JSON.stringify({products,key:hash(products.map(p=>p.itemId))}));
    return {...status(), imported:incoming.length, missingCost:incoming.filter(p=>p.unitCost===null).length};
  }
  const displayText = value => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300) : '';
  function displayProducts(c, products) {
    // Product identity is presentation metadata; failure to read an optional
    // image cache must never prevent saved financial data from being shown.
    let entries; try { entries = thumbnailCache(c).entries; } catch { entries = new Map(); }
    return products.map(p => {
      const cached = entries.get(p.itemId);
      if (!cached || !id(cached.productId)) return { ...p };
      const unresolved = !id(p.productId) || String(p.productId) === String(p.itemId);
      if (!unresolved && String(p.productId) !== cached.productId) return { ...p };
      const result = { ...p, productId: unresolved ? cached.productId : p.productId };
      for (const key of ['productName', 'optionName']) if (!displayText(result[key]) && cached[key]) result[key] = cached[key];
      if (cached.displayName) result.displayName = cached.displayName;
      if (result.productId !== p.productId || result.productName !== p.productName || result.optionName !== p.optionName || result.displayName) result.fullName = p.name;
      return result;
    });
  }
  function workspaceState(c) {
    const s = scope(c), savedGroups = read(path.join(dir(c), 'groups.json'), []);
    if (!Array.isArray(savedGroups)) throw fail(500, '저장한 상품 그룹을 읽을 수 없습니다.');
    const selected = new Set(s.products.map(p => p.itemId));
    const groups = savedGroups.map(group => ({ id: group.id, name: group.name, itemIds: group.itemIds.filter(itemId => selected.has(itemId)) }));
    return { configured: true, vendorKey: hash(c.vendorId), scopeKey: s.key, revision: hash({ vendorId: c.vendorId, scope: s, groups: savedGroups }), products: displayProducts(c, s.products), groups };
  }
  function workspace() {
    if (!fs.existsSync(privateFile)) return { configured: false, scopeKey: '', revision: null, products: [], groups: [] };
    return workspaceState(config());
  }
  function editableWorkspace(v) {
    const c = config(), current = workspaceState(c);
    if (typeof v?.revision !== 'string' || typeof v?.scopeKey !== 'string' || v.revision !== current.revision || v.scopeKey !== current.scopeKey) throw fail(409, '상품·그룹 저장 내용이 변경됐습니다. 최신 자료를 다시 불러온 뒤 저장하세요.');
    return { c, current, s: requireScope(c) };
  }
  function updateProduct(v) {
    const { c, s } = editableWorkspace(v);
    if (!id(v.itemId)) throw fail(400, '옵션 ID를 확인하세요.');
    const itemId = String(v.itemId), product = s.products.find(p => p.itemId === itemId);
    if (!product) throw fail(409, '선택한 옵션이 현재 집계 대상에 없습니다. 상품 목록을 다시 불러오세요.');
    const costs = {};
    for (const key of ['unitCost', 'commissionRate', 'inboundFee', 'deliveryFee']) {
      if (!Object.hasOwn(v, key) || v[key] !== null && (typeof v[key] !== 'number' || !Number.isFinite(v[key]) || v[key] < 0 || v[key] > 1e12)) throw fail(400, '원가·수수료·배송비는 0 이상의 숫자 또는 미확인으로 입력하세요.');
      costs[key] = v[key];
    }
    if (costs.commissionRate !== null && costs.commissionRate > 100) throw fail(400, '수수료율은 0~100%로 입력하세요.');
    if (!Object.hasOwn(v, 'costSince') || v.costSince !== null && (!validDay(v.costSince) || v.costSince > kstDay(now()))) throw fail(400, '원가 기준일을 확인하세요. 미래 날짜는 사용할 수 없습니다.');
    const products = s.products.map(p => p.itemId === itemId ? { ...p, ...costs, costSince: v.costSince } : p);
    // Edit metadata in place: selection and its ledger/acquisition scope stay intact.
    atomic(path.join(dir(c), 'scope.json'), JSON.stringify({ ...s, products }));
    return workspaceState(c);
  }
  function saveGroups(v) {
    const { c, current } = editableWorkspace(v);
    if (!Array.isArray(v.groups) || v.groups.length > 100) throw fail(400, '상품 그룹은 최대 100개까지 저장할 수 있습니다.');
    const selected = new Set(current.products.map(p => p.itemId));
    const previous = read(path.join(dir(c), 'groups.json'), []);
    const groups = v.groups.map(group => {
      if (!group || typeof group.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(group.id) || typeof group.name !== 'string' || !group.name.trim() || group.name.trim().length > 60 || /[\u0000-\u001f\u007f]/.test(group.name)) throw fail(400, '그룹 ID·이름을 확인하세요. 이름은 1~60자로 입력하세요.');
      if (!Array.isArray(group.itemIds) || group.itemIds.length > 500 || group.itemIds.some(itemId => !id(itemId))) throw fail(400, '그룹에 포함할 옵션 ID를 확인하세요.');
      const itemIds = group.itemIds.map(String);
      if (new Set(itemIds).size !== itemIds.length || itemIds.some(itemId => !selected.has(itemId))) throw fail(400, '그룹에는 현재 집계 대상 옵션만 중복 없이 추가하세요.');
      // The browser sees only current selections. Preserve hidden memberships
      // on surviving groups while replacing all currently editable memberships.
      const retained = previous.find(saved => saved.id === group.id)?.itemIds.filter(itemId => !selected.has(itemId)) || [];
      const merged = [...retained, ...itemIds];
      if (merged.length > 500) throw fail(400, '이전 집계 대상 옵션을 포함해 그룹당 최대 500개까지 저장할 수 있습니다. 새 그룹으로 나누어 주세요.');
      return { id: group.id, name: group.name.trim(), itemIds: merged.sort((a, b) => a.localeCompare(b)) };
    });
    if (new Set(groups.map(group => group.id)).size !== groups.length) throw fail(400, '중복 그룹 ID를 제거하세요.');
    // Groups are a display filter and never alter the financial selection scope.
    atomic(path.join(dir(c), 'groups.json'), JSON.stringify(groups));
    return workspaceState(c);
  }
  const thumbnailErrors = {
    auth: '상품 이미지 인증에 실패했습니다. 자료·연결 관리에서 API 키·허용 IP·연동업체 설정을 확인한 뒤 다시 가져오세요.',
    rate: '쿠팡 API 요청 한도에 도달했습니다. 기존 이미지는 보존하며 잠시 후 다시 가져올 수 있습니다.',
    changed: '연결 정보나 집계 상품이 변경되어 이미지 가져오기를 중단했습니다. 최신 자료로 다시 조회하세요.',
    limit: '상품 이미지 조회 한도에 도달했습니다. 확인한 이미지는 보존했습니다.',
    api: '일부 상품 이미지를 확인하지 못했습니다. 기존 이미지는 보존하며 잠시 후 다시 가져올 수 있습니다.'
  };
  function thumbnailFile(c) { return path.join(dir(c), 'thumbnails.json'); }
  function thumbnailCache(c) {
    const raw = read(thumbnailFile(c), {}), entries = new Map();
    if (raw.vendorId && raw.vendorId !== c.vendorId) throw fail(500, '저장된 상품 이미지의 판매자를 확인하세요.');
    for (const entry of Array.isArray(raw.entries) ? raw.entries.slice(-2000) : []) {
      const url = safeThumbnailUrl(entry?.thumbnailUrl), productId = id(entry?.productId) ? String(entry.productId) : null;
      if (id(entry?.itemId) && (url || productId)) entries.set(String(entry.itemId), { itemId: String(entry.itemId), productId, thumbnailUrl: url,
        ...Object.fromEntries(['productName', 'optionName', 'displayName'].filter(key => displayText(entry[key])).map(key => [key, displayText(entry[key])])),
        checkedAt: typeof entry.checkedAt === 'string' ? entry.checkedAt.slice(0, 30) : null });
    }
    const attempt = raw.attempt && typeof raw.attempt === 'object' ? raw.attempt : null;
    return { entries, attempt };
  }
  function thumbnailStatus() {
    const idle = { running: false, status: 'idle', completed: 0, total: 0, error: null };
    if (!fs.existsSync(privateFile)) return { configured: false, vendorKey: null, scopeKey: '', needsSync: false, items: [], job: idle };
    const c = config(), s = scope(c), cache = thumbnailCache(c);
    const live = thumbnailActive && thumbnailActive.credentialKey === hash(c) && thumbnailActive.scopeKey === s.key;
    const attempt = live ? thumbnailActive.job : cache.attempt?.scopeKey === s.key ? cache.attempt : null;
    const statuses = ['waiting', 'running', 'completed', 'partial', 'failed', 'cancelled'];
    const running = !!(live && thumbnailActive.job.running);
    const status = attempt && statuses.includes(attempt.status) ? !running && ['waiting', 'running'].includes(attempt.status) ? 'paused' : attempt.status : 'idle';
    const job = { running, status, completed: Number.isInteger(attempt?.completed) && attempt.completed >= 0 ? Math.min(attempt.completed, 500) : 0,
      total: Number.isInteger(attempt?.total) && attempt.total >= 0 ? Math.min(attempt.total, 500) : 0, error: thumbnailErrors[attempt?.errorCode] || null };
    const missing = s.products.some(p => !cache.entries.get(p.itemId)?.thumbnailUrl);
    const age = Number.isFinite(attempt?.at) ? now() - attempt.at : Infinity;
    const cooldown = status === 'failed' ? 30 * 60000 : DAY;
    const needsSync = !!s.products.length && missing && !running && (!attempt || status === 'paused' || status === 'cancelled' || age >= cooldown);
    const items = displayProducts(c, s.products).map(p => ({ itemId: p.itemId, productId: p.productId || null, thumbnailUrl: cache.entries.get(p.itemId)?.thumbnailUrl || null,
      ...Object.fromEntries(['productName', 'optionName', 'displayName'].filter(key => displayText(p[key])).map(key => [key, p[key]])) }));
    return { configured: true, vendorKey: hash(c.vendorId), scopeKey: s.key, needsSync, items, job };
  }
  function startThumbnails(v = {}) {
    const c = config(), s = requireScope(c);
    if (v.vendorKey !== hash(c.vendorId) || v.scopeKey !== s.key) throw fail(409, '연결 정보나 집계 상품이 변경되었습니다. 최신 자료를 다시 조회하세요.');
    if (v.force !== undefined && typeof v.force !== 'boolean') throw fail(400, '상품 이미지 요청 형식을 확인하세요.');
    const current = thumbnailStatus();
    if (current.job.running || !v.force && !current.needsSync) return current;
    const cache = thumbnailCache(c), selected = new Map(s.products.map(p => [p.itemId, p]));
    const state = { credentialKey: hash(c), scopeKey: s.key, job: { scopeKey: s.key, at: now(), running: true, status: busy || historyActive ? 'waiting' : 'running', completed: 0, total: 0, errorCode: null } };
    thumbnailActive = state;
    const checkCurrent = () => {
      if (thumbnailActive !== state || hash(config()) !== state.credentialKey || scope(c).key !== s.key) throw Object.assign(fail(409, thumbnailErrors.changed), { thumbnailCode: 'changed' });
    };
    const persist = () => {
      checkCurrent();
      // Keep every current selected option when bounding older cached images.
      const entries = [...cache.entries.values()].sort((a, b) => Number(selected.has(a.itemId)) - Number(selected.has(b.itemId))).slice(-2000);
      atomic(thumbnailFile(c), JSON.stringify({ version: 1, vendorId: c.vendorId, entries, attempt: state.job }));
    };
    const guard = async () => {
      checkCurrent();
      while (busy || historyActive) { state.job.status = 'waiting'; await sleep(2000); checkCurrent(); }
      state.job.status = 'running';
    };
    const productGet = async (uri, params, kind) => { await guard(); const value = await get(c, uri, params, kind, guard); checkCurrent(); return value; };
    persist();
    thumbnailTask = (async () => {
      let partial = false, limited = false;
      try {
        const candidates = new Map(), knownProducts = new Set(s.products.filter(p => id(p.productId) && String(p.productId) !== String(p.itemId)).map(p => String(p.productId)));
        const allKnown = s.products.every(p => id(p.productId) && String(p.productId) !== String(p.itemId));
        for (const businessTypes of ['', 'rocketGrowth']) {
          const tokens = new Set(); let next = '';
          for (let page = 0; page < 100; page++) {
            const value = await productGet(productUri, { vendorId: c.vendorId, maxPerPage: '100', ...(businessTypes ? { businessTypes } : {}), ...(next ? { nextToken: next } : {}) }, 'product-list');
            for (const row of value.data) {
              if (!row || !id(row.sellerProductId) || row.vendorId !== undefined && row.vendorId !== c.vendorId) throw fail(502, '상품 목록을 확인할 수 없습니다.');
              if (allKnown && id(row.productId) && !knownProducts.has(String(row.productId))) continue;
              const candidateId = String(row.sellerProductId), priority = id(row.productId) && knownProducts.has(String(row.productId));
              if (candidates.has(candidateId)) { if (priority) candidates.set(candidateId, true); continue; }
              if (candidates.size < 500) candidates.set(candidateId, priority);
              else {
                limited = true;
                // Prefer a confirmed exposed-product match over an unknown summary,
                // while retaining a bounded subset that can still make progress.
                const replace = priority ? [...candidates].find(([, known]) => !known) : null;
                if (replace) { candidates.delete(replace[0]); candidates.set(candidateId, true); }
              }
            }
            next = value.nextToken || '';
            if (!next) break;
            if (typeof next !== 'string' || next.length > 2048 || tokens.has(next)) throw fail(502, '상품 목록 페이지를 확인할 수 없습니다.');
            tokens.add(next);
            if (page === 99) { limited = true; break; }
          }
        }
        state.job.total = candidates.size; persist();
        for (const sellerProductId of candidates.keys()) {
          try {
            const { data } = await productGet(productUri + '/' + sellerProductId, {}, 'product-detail');
            if (data.vendorId !== c.vendorId || String(data.sellerProductId) !== sellerProductId || !Array.isArray(data.items) || data.items.length > 1000) throw Object.assign(fail(502, '상품 판매자나 옵션을 확인할 수 없습니다.'), { thumbnailFatal: true });
            const updates = new Map();
            for (const item of data.items) {
              if (!item || typeof item !== 'object') continue;
              const identifiers = [item.vendorItemId, ...['rocketGrowthItemData', 'marketplaceItemData', 'marketPlaceItemData', 'rocketGrowthItem', 'marketPlaceItem'].map(key => item[key]?.vendorItemId)].filter(id).map(String);
              const images = (Array.isArray(item.images) ? item.images : []).filter(image => image?.imageType === 'REPRESENTATION').sort((a, b) => (Number.isFinite(a.imageOrder) ? a.imageOrder : Infinity) - (Number.isFinite(b.imageOrder) ? b.imageOrder : Infinity));
              let url = null;
              for (const image of images) { url = safeThumbnailUrl(image.cdnPath) || safeThumbnailUrl(image.vendorPath); if (url) break; }
              for (const itemId of new Set(identifiers)) if (selected.has(itemId)) {
                const previous = cache.entries.get(itemId), rawProduct = selected.get(itemId);
                const productId = id(data.productId) ? String(data.productId) : id(rawProduct.productId) && String(rawProduct.productId) !== itemId ? String(rawProduct.productId) : previous?.productId || null;
                if (!url && !productId) continue;
                const productName = displayText(data.displayProductName) || displayText(data.sellerProductName) || displayText(data.generalProductName);
                const general = displayText(data.generalProductName), brand = displayText(data.brand);
                const displayName = general ? (brand && !general.toLocaleLowerCase().includes(brand.toLocaleLowerCase()) ? (brand + ' ' + general).slice(0, 300) : general) : '';
                const entry = { itemId, productId, thumbnailUrl: url || previous?.thumbnailUrl || null,
                  ...(productName ? { productName } : {}), ...(displayText(item.itemName) ? { optionName: displayText(item.itemName) } : {}), ...(displayName ? { displayName } : {}), checkedAt: new Date(now()).toISOString() };
                if (updates.has(itemId) && (updates.get(itemId).thumbnailUrl !== entry.thumbnailUrl || updates.get(itemId).productId !== productId)) throw Object.assign(fail(502, '상품 이미지 중복을 확인할 수 없습니다.'), { thumbnailFatal: true });
                updates.set(itemId, entry);
              }
            }
            for (const [itemId, entry] of updates) cache.entries.set(itemId, entry);
          } catch (error) {
            if (error.thumbnailFatal || error.thumbnailCode || [401, 403, 429].includes(error.upstreamStatus) || error.status === 409) throw error;
            partial = true;
          }
          state.job.completed++; persist();
        }
        if (s.products.some(p => !cache.entries.get(p.itemId)?.thumbnailUrl)) partial = true;
        state.job.status = partial || limited ? 'partial' : 'completed'; state.job.errorCode = limited ? 'limit' : partial ? 'api' : null;
      } catch (error) {
        state.job.status = error.thumbnailCode === 'changed' ? 'cancelled' : 'failed';
        state.job.errorCode = error.thumbnailCode || ([401, 403].includes(error.upstreamStatus) ? 'auth' : error.upstreamStatus === 429 ? 'rate' : 'api');
      } finally {
        state.job.running = false;
        try { persist(); } catch {}
      }
    })();
    return thumbnailStatus();
  }
  // Only fixed categories leave this process; upstream bodies may contain keys,
  // customer fields, or arbitrary text and must never be returned or persisted.
  async function authDiagnosis(response) {
    const limit = 16384;
    let text = '';
    try {
      if (response.body && typeof response.body.getReader === 'function') {
        const reader = response.body.getReader(), chunks = []; let length = 0;
        try {
          while (true) {
            const part = await reader.read(); if (part.done) break;
            length += part.value.byteLength;
            if (length > limit) { await reader.cancel(); return classifyAuth('', response); }
            chunks.push(Buffer.from(part.value));
          }
          text = Buffer.concat(chunks, length).toString('utf8');
        } finally { reader.releaseLock?.(); }
      } else if (typeof response.text === 'function') {
        const value = await response.text();
        if (typeof value === 'string' && Buffer.byteLength(value) <= limit) text = value;
      } else if (typeof response.json === 'function') {
        const value = JSON.stringify(await response.json());
        if (typeof value === 'string' && Buffer.byteLength(value) <= limit) text = value;
      }
    } catch { text = ''; }
    finally { try { await response.body?.cancel?.(); } catch {} }
    return classifyAuth(text, response);
  }
  function classifyAuth(text, response) {
    // Classify the documented message fields, never credential/customer fields
    // that might be echoed elsewhere in an upstream JSON error response.
    try {
      const value = JSON.parse(text);
      text = typeof value === 'string' ? value : value && !Array.isArray(value) ? [value.message, value.errorMessage, typeof value.error === 'string' ? value.error : value.error?.message].filter(v => typeof v === 'string').map(v => v.slice(0, 2048)).join(' ') : '';
    } catch { if (/^\s*[\[{]/.test(text)) text = ''; }
    let category = 'auth_unknown';
    if (/not[\s_-]*allowed[\s_-]*ip|ip.{0,60}(?:not[\s_-]*(?:allowed|registered)|denied|whitelist)|(?:denied|unregistered).{0,20}ip/i.test(text)) category = 'ip_not_allowed';
    else if (/(?:api|access|secret)[\s_-]*key.{0,60}(?:expired|revoked)|expired.{0,30}(?:api|access|secret)[\s_-]*key/i.test(text)) category = 'key_expired';
    else if (/signature.{0,50}expired|request.{0,30}(?:expired|time.{0,15}skew)|time.{0,25}skew/i.test(text)) category = 'signature_expired';
    else if (/invalid.{0,30}access[\s_-]*key|access[\s_-]*key.{0,40}(?:invalid|not[\s_-]*found|unknown|does[\s_-]*not[\s_-]*exist|not[\s_-]*exist)|unknown.{0,20}access[\s_-]*key/i.test(text)) category = 'invalid_key';
    else if (/invalid.{0,20}signature|signature.{0,40}(?:mismatch|not[\s_-]*match)|hmac.{0,30}(?:invalid|error|fail)/i.test(text)) category = 'invalid_signature';
    else if (/access[\s!:_-]*denied|forbidden|not[\s_-]*authorized|permission[\s_-]*denied/i.test(text)) category = 'access_denied';
    const descriptions = {
      ip_not_allowed: ['허용 IP·연동업체 설정 거절', 'WING 추가판매정보의 OPEN API에서 연동 방식과 현재 공인 IP를 확인하세요. 수정했다면 최대 30분 뒤 다시 진단하세요.'],
      signature_expired: ['요청 서명 시간 만료', 'Windows 날짜·시간을 자동 설정하고 지금 동기화를 실행한 뒤 다시 진단하세요.'],
      key_expired: ['API 키 만료·해지', 'WING에서 API 키 유효기간을 확인하고 새로 발급한 키를 ROAS Pilot에 다시 저장하세요.'],
      invalid_key: ['Access Key 확인 필요', '업체코드와 같은 계정에서 발급한 Access Key·Secret Key를 확인해 다시 저장하세요.'],
      invalid_signature: ['인증 서명 불일치', '같은 발급 건의 Access Key·Secret Key인지 확인하고 Windows 시간을 동기화하세요.'],
      access_denied: ['쿠팡 접근 권한 거절', 'WING의 연동업체·허용 공인 IP·API 이용 권한을 확인하세요.'],
      auth_unknown: ['쿠팡 응답에서 인증 거절 사유를 구분하지 못했습니다.', 'WING의 업체코드·키 유효기간·연동 방식·허용 공인 IP와 Windows 시간을 확인하세요.']
    };
    const [message, action] = descriptions[category], result = { category, httpStatus: response.status, message, action };
    try {
      const serverTime = Date.parse(response.headers?.get?.('date') || ''), offset = Math.round((serverTime - now()) / 1000);
      if (Number.isSafeInteger(offset) && Math.abs(offset) > 300 && Math.abs(offset) <= 3155760000) {
        result.clockOffsetSeconds = offset;
        result.action += ' 응답 서버와 PC 시각이 5분 이상 다르게 감지됐으므로 Windows 시간도 확인하세요.';
      }
    } catch {}
    return result;
  }
  async function diagnose(v = {}) {
    const c = config();
    if (busy || historyActive || refreshActive) throw fail(409, '쿠팡 자료를 수집 중입니다. 일시정지 후 연결 진단을 실행하세요.');
    const channel = v.channel || 'all';
    if (![...CHANNELS, 'all'].includes(channel)) throw fail(400, '진단할 배송 방식을 확인하세요.');
    const date = kstDay(now() - DAY), checkedAt = new Date(now()).toISOString(), checks = [];
    busy = true;
    try {
      for (const ch of channel === 'all' ? CHANNELS : [channel]) {
        const uri = ch === 'growth' ? '/v2/providers/rg_open_api/apis/api/v1/vendors/' + c.vendorId + '/rg/orders' : '/v2/providers/openapi/apis/api/v5/vendors/' + c.vendorId + '/ordersheets';
        const params = ch === 'growth' ? { paidDateFrom: date.replaceAll('-', ''), paidDateTo: date.replaceAll('-', '') } : { createdAtFrom: date + '+09:00', createdAtTo: date + '+09:00', status: 'FINAL_DELIVERY', maxPerPage: '50' };
        try {
          await get(c, uri, params);
          checks.push({ channel: ch, ok: true, httpStatus: 200, label: '인증·접근 정상', message: '최근 하루 주문 조회에 정상 응답했습니다.', action: '이어서 수집으로 미완료 구간을 다시 수집할 수 있습니다.' });
        } catch (error) {
          if (error.diagnosis) checks.push({ channel: ch, ok: false, ...error.diagnosis, label: error.diagnosis.message });
          else checks.push({ channel: ch, ok: false, httpStatus: Number.isInteger(error.upstreamStatus) ? error.upstreamStatus : null, label: '조회 실패 · 인증 판정 불가', message: '쿠팡 요청이 완료되지 않아 인증 여부를 판정할 수 없습니다.', action: '인터넷 연결과 쿠팡 API 상태를 확인한 뒤 다시 진단하세요.' });
        }
      }
      const result = { configured: true, keysReadable: true, date, checkedAt, ok: checks.every(check => check.ok), checks };
      atomic(path.join(dir(c), 'connection-check.json'), JSON.stringify(result));
      return result;
    } finally { busy = false; }
  }
  async function get(c, uri, params, kind = 'orders', beforeRequest = null) {
    const allowed = ['/v2/providers/rg_open_api/apis/api/v1/vendors/' + c.vendorId + '/rg/orders', '/v2/providers/openapi/apis/api/v5/vendors/' + c.vendorId + '/ordersheets'];
    const productAllowed = kind === 'product-list' ? uri === productUri : kind === 'product-detail' && uri.startsWith(productUri + '/') && id(uri.slice(productUri.length + 1));
    if (kind === 'orders' ? !allowed.includes(uri) : !productAllowed) throw fail(400, '지원하지 않는 쿠팡 조회입니다.');
    const query = new URLSearchParams(params).toString();
    for (let attempt = 0; attempt < 3; attempt++) {
    await sleep(Math.max(0, 1300 - (now() - lastRequest)));
    if (beforeRequest) await beforeRequest();
    lastRequest = now();
    let r;
    try { r = await fetchImpl('https://api-gateway.coupang.com' + uri + '?' + query, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(25000), headers: { Authorization: signature(c, uri, query, now()), 'X-Requested-By': c.vendorId, Accept: 'application/json' } }); }
    catch { if (attempt < 2) { await sleep(1000 * 2 ** attempt); continue; } throw fail(502, '쿠팡 API에 연결하지 못했습니다. 인터넷 연결을 확인하세요.'); }
    if ((r.status === 429 || r.status >= 500) && attempt < 2 && (kind === 'orders' || r.status !== 429)) { await r.body?.cancel?.(); await sleep(2000 * 2 ** attempt); continue; }
    if (!r.ok) {
      if ([401, 403].includes(r.status)) {
        const diagnosis = await authDiagnosis(r);
        throw Object.assign(fail(502, '쿠팡 인증에 실패했습니다. [' + diagnosis.message + ' · HTTP ' + diagnosis.httpStatus + '] ' + diagnosis.action), { diagnosis, upstreamStatus: r.status });
      }
      await r.body?.cancel?.();
      throw Object.assign(fail(r.status === 429 ? 429 : 502, '쿠팡 API 조회 실패 (HTTP ' + r.status + '). 기존 저장 자료는 유지됩니다.'), { upstreamStatus: r.status });
    }
    let v; try { v = await r.json(); } catch { throw fail(502, '쿠팡 API 응답 형식을 확인할 수 없습니다.'); }
    if (kind === 'orders' ? v?.code !== 200 || !Array.isArray(v.data) : v?.code !== 'SUCCESS' || (kind === 'product-list' ? !Array.isArray(v.data) : !v.data || typeof v.data !== 'object' || Array.isArray(v.data))) throw fail(502, '쿠팡 API가 정상 자료를 반환하지 않았습니다.');
    return v;
    }
  }
  async function pages(c, uri, params, channel, dates) {
    const accepted = new Set(Array.isArray(dates) ? dates : [dates]);
    const tokens = new Set(), rows = new Map(); let next = '';
    for (let page = 0; page < 200; page++) {
      const v = await get(c, uri, next ? { ...params, nextToken: next } : params);
      for (const raw of v.data) {
        if (channel === 'growth' && raw.vendorId !== c.vendorId) throw fail(502, '쿠팡 판매자 ID가 일치하지 않습니다.');
        const date = orderDate(raw, channel);
        if (!accepted.has(date)) throw fail(502, '쿠팡 주문 날짜가 요청한 구간과 다릅니다. 기존 자료를 유지합니다.');
        for (const row of normalize(raw, channel, date).map(row => ({ ...row, date }))) {
          if (rows.has(row.key) && JSON.stringify(rows.get(row.key)) !== JSON.stringify(row)) throw fail(502, '쿠팡 주문 중복 자료가 일치하지 않습니다.');
          rows.set(row.key, row);
        }
      }
      next = v.nextToken || '';
      if (!next) return [...rows.values()];
      if (typeof next !== 'string' || next.length > 2048 || tokens.has(next)) throw fail(502, '쿠팡 페이지 수집이 완료되지 않았습니다.'); tokens.add(next);
    }
    throw fail(502, '쿠팡 페이지 수집 한도를 초과했습니다. 기존 자료는 유지됩니다.');
  }
  async function sync(v, internal = false) {
    const c = config(), days = range(v.since, v.until, now(), 7);
    if (!CHANNELS.includes(v.channel)) throw fail(400, '배송 방식을 확인하세요.');
    if (busy || (historyActive || refreshActive) && !internal) throw fail(409, '쿠팡 자료를 수집 중입니다.'); busy = true;
    const result = { savedDays: [], channel: v.channel, verification: { newDays: [], changedDays: [], unchangedDays: [] } };
    try {
      {
        let rows;
        if (v.channel === 'growth') rows = await pages(c, '/v2/providers/rg_open_api/apis/api/v1/vendors/' + c.vendorId + '/rg/orders', { paidDateFrom: v.since.replaceAll('-', ''), paidDateTo: v.until.replaceAll('-', '') }, 'growth', days);
        else {
          const all = new Map();
          for (const state of ['ACCEPT', 'INSTRUCT', 'DEPARTURE', 'DELIVERING', 'FINAL_DELIVERY', 'NONE_TRACKING']) {
            const part = await pages(c, '/v2/providers/openapi/apis/api/v5/vendors/' + c.vendorId + '/ordersheets', { createdAtFrom: v.since + '+09:00', createdAtTo: v.until + '+09:00', status: state, maxPerPage: '50' }, 'seller', days);
            for (const row of part) all.set(row.key, row);
          }
          rows = [...all.values()];
        }
        rows.sort((a, b) => a.key.localeCompare(b.key));
        for (const date of days) {
        const snap = { date, channel: v.channel, vendorId: c.vendorId, fetchedAt: new Date(now()).toISOString(), rows: rows.filter(row => row.date === date).map(({ date: ignored, ...row }) => row) };
        const previous = snapshot(c, date, v.channel);
        const kind = !previous || previous.vendorId !== c.vendorId || !Array.isArray(previous.rows) ? 'newDays'
          : hash(previous.rows) === hash(snap.rows) ? 'unchangedDays' : 'changedDays';
        atomic(path.join(dir(c), 'orders', date + '-' + v.channel + '.json'), JSON.stringify(snap)); result.savedDays.push(date);
        result.verification[kind].push(date);
        }
      }
      const stateFile = path.join(dir(c), 'state.json'); atomic(stateFile, JSON.stringify({ ...read(stateFile, {}), [v.channel]: new Date(now()).toISOString() }));
      return result;
    } catch (e) { e.message += ' · 이번 요청에서 저장 완료 ' + result.savedDays.length + '/' + days.length + '일'; throw e; }
    finally { busy = false; }
  }
  function historyFile(c) { return path.join(dir(c), 'history.json'); }
  function historyStatus() {
    const c = config(), job = read(historyFile(c), null);
    if (!job) return { status: 'idle', completedDays: 0, totalDays: 0, running: false };
    const running = historyActive && job.status === 'running';
    return { ...job, running, status: job.status === 'running' && !historyActive ? 'paused' : job.status,
      error: job.status === 'running' && !historyActive ? '프로그램이 재시작되었습니다. 이어서 수집을 누르면 저장된 구간 다음부터 계속합니다.' : job.error };
  }
  function saveHistory(c, job) { atomic(historyFile(c), JSON.stringify(job)); }
  function pauseHistory() {
    const c = config(), job = read(historyFile(c), null);
    if (job && historyActive) { job.pauseRequested = true; saveHistory(c, job); }
    return historyStatus();
  }
  function startHistory(v = {}, source = 'manual') {
    const c = config();
    if (historyActive) { if (v.resume === true) return historyStatus(); throw fail(409, '쿠팡 장기 수집이 진행 중입니다. 진행 상태를 확인하세요.'); }
    if (busy || refreshActive) throw fail(409, '쿠팡 자료를 수집 중입니다.');
    let job;
    if (v.resume === true) {
      job = read(historyFile(c), null);
      if (!job || job.status === 'completed') throw fail(409, '이어서 수집할 미완료 작업이 없습니다.');
      range(job.since, job.until, now());
    } else {
      const days = range(v.since, v.until, now()), channels = v.channels || (v.channel ? [v.channel] : CHANNELS);
      if (!Array.isArray(channels) || !channels.length || channels.some(ch => !CHANNELS.includes(ch)) || new Set(channels).size !== channels.length) throw fail(400, '수집할 배송 방식을 확인하세요.');
      const done = Object.fromEntries(channels.map(ch => [ch, []]));
      // Recent days can change as orders ship. Recollect them; older confirmed snapshots can be reused.
      const refreshFrom = kstDay(now() - 7 * DAY);
      for (const ch of channels) for (const date of days) {
        const snap = snapshot(c, date, ch);
        if (date < refreshFrom && snap?.vendorId === c.vendorId && snap.date === date && snap.channel === ch && Array.isArray(snap.rows)) done[ch].push(date);
      }
      job = { id: crypto.randomBytes(12).toString('hex'), kind: source, since: v.since, until: v.until, channels: [...channels], done,
        totalDays: days.length * channels.length, completedDays: Object.values(done).reduce((n, ds) => n + ds.length, 0), skippedDays: Object.values(done).reduce((n, ds) => n + ds.length, 0), startedAt: new Date(now()).toISOString() };
    }
    Object.assign(job, { status: 'running', pauseRequested: false, error: null, current: null, lastFailure: null, updatedAt: new Date(now()).toISOString() });
    saveHistory(c, job); historyActive = true;
    // Return immediately to the browser. Collection belongs to the local server, not the open tab.
    historyTask = Promise.resolve().then(async () => {
      try {
        const days = range(job.since, job.until, now());
        for (const ch of job.channels) for (let i = 0; i < days.length; i += 7) {
          const block = days.slice(i, i + 7), completed = new Set(job.done[ch]);
          if (block.every(d => completed.has(d))) continue;
          if (read(historyFile(c), {}).pauseRequested) { job.status = 'paused'; return; }
          job.current = { channel: ch, since: block[0], until: block.at(-1) }; saveHistory(c, job);
          const result = await sync({ ...job.current }, true);
          for (const date of result.savedDays) completed.add(date);
          job.done[ch] = [...completed].sort(); job.completedDays = Object.values(job.done).reduce((n, ds) => n + ds.length, 0);
          job.updatedAt = new Date(now()).toISOString();
          if (read(historyFile(c), {}).pauseRequested) job.pauseRequested = true;
          saveHistory(c, job);
        }
        job.status = 'completed';
      } catch (e) {
        job.status = 'failed'; job.error = e.message || '쿠팡 수집에 실패했습니다.';
        job.lastFailure = { ...(job.current || {}), failedAt: new Date(now()).toISOString(), ...(e.diagnosis ? { diagnosis: { ...e.diagnosis } } : {}) };
      }
      finally {
        job.current = null; job.updatedAt = new Date(now()).toISOString();
        try {
          saveHistory(c, job);
          if (job.status === 'completed' && (Date.parse(job.until) - Date.parse(job.since)) / DAY >= 364) {
            const file = path.join(dir(c), 'backfill.json'), baseline = read(file, {});
            for (const ch of job.channels) baseline[ch] = { since: job.since, until: job.until, completedAt: job.updatedAt };
            atomic(file, JSON.stringify(baseline));
          }
        } finally { historyActive = false; }
      }
    });
    historyTask.catch(() => {}); // Keep an I/O failure observable to waiters without an unhandled rejection.
    return historyStatus();
  }
  function automaticStatus(c) {
    const state = read(path.join(dir(c), 'automatic.json'), {});
    const interrupted = state.running === true && !refreshActive;
    return { enabled: true, intervalMinutes: 60, status: 'idle', ...state, running: refreshActive,
      ...(interrupted ? { status: 'paused', error: '이전 자동 수집 중 프로그램이 종료됐습니다. 최근 7일 수집을 다시 실행하세요.' } : {}) };
  }
  function refresh(v = {}, trigger = 'manual') {
    const c = config(); requireScope(c);
    if (refreshActive) return { started: false, reason: 'running', automatic: automaticStatus(c) };
    if (busy || historyActive) throw fail(409, '쿠팡 자료를 수집 중입니다. 완료 후 최근 7일 수집을 실행하세요.');
    const channels = v.channels === undefined ? CHANNELS : v.channels;
    if (!Array.isArray(channels) || !channels.length || channels.some(ch => !CHANNELS.includes(ch)) || new Set(channels).size !== channels.length) throw fail(400, '수집할 배송 방식을 확인하세요.');
    const file = path.join(dir(c), 'automatic.json'), previous = read(file, {}), stamp = new Date(now()).toISOString();
    const state = { ...previous, enabled: true, intervalMinutes: 60, running: true, status: 'running', trigger,
      since: kstDay(now() - 6 * DAY), until: kstDay(now()), lastStartedAt: stamp,
      nextRunAt: new Date(now() + 60 * 60000).toISOString(), error: null,
      channels: Object.fromEntries(channels.map(ch => [ch, { status: 'pending', savedDays: [], error: null }])) };
    atomic(file, JSON.stringify(state)); refreshActive = true;
    // Refresh orders into the existing durable daily store. The long-history
    // checkpoint is independent and must survive a recent refresh unchanged.
    refreshTask = Promise.resolve().then(async () => {
      try {
        for (const ch of channels) {
          state.channels[ch].status = 'running'; atomic(file, JSON.stringify(state));
          try {
            const result = await sync({ since: state.since, until: state.until, channel: ch }, true);
            state.channels[ch] = { status: 'completed', savedDays: result.savedDays, verification: result.verification, error: null, savedAt: new Date(now()).toISOString() };
          } catch (error) { state.channels[ch] = { status: 'failed', savedDays: [], error: error.message }; }
          atomic(file, JSON.stringify(state));
        }
        const failed = channels.filter(ch => state.channels[ch].status === 'failed');
        state.status = failed.length === channels.length ? 'failed' : failed.length ? 'partial' : 'completed';
        state.error = failed.map(ch => (ch === 'growth' ? '로켓그로스' : '판매자배송') + ': ' + state.channels[ch].error).join('\n') || null;
        if (!failed.length) state.lastCompletedAt = new Date(now()).toISOString();
      } finally {
        state.running = false; state.lastFinishedAt = new Date(now()).toISOString();
        try { atomic(file, JSON.stringify(state)); } finally { refreshActive = false; }
      }
      return automaticStatus(c);
    });
    refreshTask.catch(() => {});
    return { started: true, automatic: automaticStatus(c) };
  }
  async function automatic(v = {}) {
    if (v.startup === true) {
      if (startupRefreshDone) return { started: false, reason: 'startup-already-checked' };
      startupRefreshRequested = true;
    }
    if (refreshActive || historyActive || busy || !fs.existsSync(privateFile)) return { started: false, reason: 'busy-or-unconfigured' };
    const c = config(); if (!scope(c).products.length) return { started: false, reason: 'products-not-selected' };
    const state = read(path.join(dir(c), 'automatic.json'), {}), last = Date.parse(state.lastStartedAt || '');
    const startup = startupRefreshRequested && !startupRefreshDone;
    if (!startup && state.running !== true && Number.isFinite(last) && now() - last < 60 * 60000) return { started: false, reason: 'not-due', automatic: automaticStatus(c) };
    const result = refresh({}, startup ? 'startup' : 'scheduled');
    if (startup) { startupRefreshDone = true; startupRefreshRequested = false; }
    await refreshTask;
    return { ...result, automatic: automaticStatus(c) };
  }
  function products(v) {
    const c = config(), days = range(v.since, v.until, now()), found = new Map(scope(c).products.map(p => [p.itemId, p]));
    for (const date of days) for (const ch of CHANNELS) for (const row of snapshot(c, date, ch)?.rows || []) if (!found.has(row.itemId)) found.set(row.itemId, { itemId: row.itemId, name: row.name, unitCost: null });
    return { products: [...found.values()], selected: scope(c).products.map(p => p.itemId) };
  }
  function saveLedger(v) {
    const c = config(), s = requireScope(c); range(v.date, v.date, now());
    if (v.scopeKey !== s.key) throw fail(409, '상품 선택이 변경되었습니다. 화면을 새로고침하세요.');
    if (!CHANNELS.includes(v.channel) || v.reviewed !== true) throw fail(400, '배송 방식과 반품·비용 확인을 선택하세요.');
    const amounts = {};
    for (const key of COSTS) {
      // Net sales may be negative on refund-only days. Expenses remain non-negative.
      const val = key === 'netSales' && ['number', 'string'].includes(typeof v[key]) && String(v[key]).trim() !== '' && Math.abs(Number(v[key])) <= 1e12 ? Number(v[key]) : money(v[key]);
      if (val === null || !Number.isFinite(val)) throw fail(400, '모든 비용을 입력하세요. 비용이 없으면 0을 입력하세요.'); amounts[key] = val;
    }
    const snap = snapshot(c, v.date, v.channel);
    if (v.basis !== basis(snap)) throw fail(409, '주문 자료가 변경되었습니다. 다시 불러온 뒤 비용을 확인하세요.');
    const file = ledgerFile(c, s), entries = read(file, {}), key = v.date + ':' + v.channel;
    entries[key] = { date: v.date, channel: v.channel, scopeKey: s.key, ...amounts, reviewed: true, basis: basis(snap), savedAt: new Date(now()).toISOString() };
    atomic(file, JSON.stringify(entries)); return { saved: true };
  }
  // A Sellha export is a complete one-day replacement. It never adds to the
  // order API, and product header rows are deliberately not accepted here.
  function validateSales(v) {
    range(v?.date, v?.date, now());
    if (v.date < kstDay(now() - 365 * DAY)) throw fail(400, '최근 1년의 일별 손익 자료를 넣으세요.');
    if (!Array.isArray(v.rows) || !v.rows.length || v.rows.length > 2000) throw fail(400, '손익 옵션 행은 1~2000개여야 합니다.');
    const number = (value, nullable, negative, integer = false) => {
      if (nullable && (value === undefined || value === null)) return null;
      if (!['number', 'string'].includes(typeof value) || String(value).trim() === '') throw fail(400, '손익 자료에 필요한 숫자가 비어 있습니다.');
      const n = Number(value);
      if (!Number.isFinite(n) || Math.abs(n) > 1e12 || !negative && n < 0 || integer && !Number.isSafeInteger(n)) throw fail(400, '손익 금액·판매량을 확인하세요.');
      return n;
    };
    const rows = v.rows.map(p => {
      if (!p || !id(p.itemId) || !id(p.productId) || !CHANNELS.includes(p.channel) || typeof p.name !== 'string' || !p.name.trim() || p.name.length > 300 || p.optionName !== undefined && (typeof p.optionName !== 'string' || p.optionName.length > 300)) throw fail(400, '손익 자료의 상품·옵션 ID·이름·배송 방식을 확인하세요.');
      return { productId: String(p.productId), itemId: String(p.itemId), channel: p.channel, name: p.name.trim(), optionName: (p.optionName || '').trim(),
        quantity: number(p.quantity, false, true, true), sales: number(p.sales, false, true), profitBeforeAds: number(p.profitBeforeAds, false, true), advertising: number(p.advertising, false, false),
        adQuantity: number(p.adQuantity, true, true, true), organicQuantity: number(p.organicQuantity, true, true, true), adSales: number(p.adSales, true, true), adProfitBeforeAds: number(p.adProfitBeforeAds, true, true) };
    });
    if (new Set(rows.map(p => p.channel + ':' + p.itemId)).size !== rows.length) throw fail(400, '손익 자료의 옵션 ID·배송 방식이 중복됩니다.');
    if (v.acquisitionAdvertising !== undefined && (!v.acquisitionAdvertising || typeof v.acquisitionAdvertising !== 'object' || Array.isArray(v.acquisitionAdvertising))) throw fail(400, '신규고객확보 광고비를 확인하세요.');
    const acquisitionAdvertising = Object.fromEntries(CHANNELS.map(ch => [ch, number(v.acquisitionAdvertising?.[ch], true, false)]));
    return { date: v.date, rows, acquisitionAdvertising };
  }
  function salesWrite(c, s, report, importedAt, fileScoped = false) {
    const file = path.join(dir(c), 'sales', report.date + '.json');
    const chosen = new Set(s.products.map(p => p.itemId));
    // Only the explicit all-file-options import creates this provenance. Raw
    // request fields cannot declare a smaller authoritative file scope.
    const reportItemIds = [...new Set(report.rows.map(r => r.itemId))].sort((a, b) => a.localeCompare(b));
    const provenance = fileScoped ? { scopeMode: 'file', reportItemIds } : {};
    const acquisitionScopeKey = fileScoped ? hash(reportItemIds.filter(itemId => chosen.has(itemId))) : s.key;
    return { file, content: JSON.stringify({ ...report, ...provenance, vendorId: c.vendorId, acquisitionScopeKey, importedAt }),
      result: { saved: true, date: report.date, imported: report.rows.length,
        matched: report.rows.filter(p => chosen.has(p.itemId)).length, excluded: report.rows.filter(p => !chosen.has(p.itemId)).length,
        replaced: fs.existsSync(file), importedAt } };
  }
  function salesBasis(report) {
    if (!report) return null;
    // Reimporting the same source does not change its financial basis, while
    // replacing that source must invalidate an older whole-day confirmation.
    const fields = ['productId', 'itemId', 'channel', 'quantity', 'sales', 'profitBeforeAds', 'advertising', 'adQuantity', 'organicQuantity', 'adSales', 'adProfitBeforeAds'];
    const rows = report.rows.map(row => Object.fromEntries(fields.map(key => [key, row[key] ?? null])))
      .sort((a, b) => (a.channel + ':' + a.itemId).localeCompare(b.channel + ':' + b.itemId));
    return hash({ date: report.date, rows, scopeMode: report.scopeMode || 'selected', reportItemIds: Array.isArray(report.reportItemIds) ? [...report.reportItemIds].sort((a, b) => a.localeCompare(b)) : null });
  }
  function importSales(v) {
    const c = config(), s = requireScope(c), report = validateSales(v);
    const write = salesWrite(c, s, report, new Date(now()).toISOString());
    atomic(write.file, write.content); return write.result;
  }
  function importSalesBatch(v) {
    const c = config(), previous = scope(c);
    if (v?.schema !== undefined && v.schema !== 'roas-coupang-sales-v1') throw fail(400, '쿠팡 손익 묶음 파일 형식을 확인하세요.');
    const hasTotals = Array.isArray(v?.dailyTotals) && v.dailyTotals.length > 0;
    if (!Array.isArray(v?.reports) || v.reports.length > 31 || !v.reports.length && !hasTotals) throw fail(400, '손익 자료는 1~31일씩 저장하세요.');
    if (v.dailyTotals !== undefined && (!Array.isArray(v.dailyTotals) || v.dailyTotals.length > 31)) throw fail(400, '일일 보고서 합계는 최대 31일씩 저장하세요.');
    if (v.includeProducts !== undefined && typeof v.includeProducts !== 'boolean') throw fail(400, '파일의 옵션 추가 여부를 확인하세요.');
    // Validate the complete batch before changing either the selected products
    // or any date. An invalid later file must not leave earlier dates imported.
    const reports = v.reports.map(validateSales).sort((a, b) => a.date.localeCompare(b.date));
    if (new Set(reports.map(r => r.date)).size !== reports.length) throw fail(400, '같은 날짜의 손익 파일이 중복됩니다. 날짜별 파일을 하나씩 선택하세요.');
    const dailyTotals = (v.dailyTotals || []).map(row => {
      range(row?.date, row?.date, now());
      if (row.date < kstDay(now() - 365 * DAY)) throw fail(400, '최근 1년의 일일 보고서 합계를 넣으세요.');
      const values = {};
      for (const key of ['sales', 'profitBeforeAds', 'advertising', 'otherCosts']) {
        const value = row[key];
        if (!['number', 'string'].includes(typeof value) || String(value).trim() === '' || !Number.isFinite(Number(value)) || Math.abs(Number(value)) > 1e12 || key === 'advertising' && Number(value) < 0) throw fail(400, '일일 보고서 합계 금액을 확인하세요.');
        values[key] = Number(value);
      }
      return { date: row.date, ...values, sourceNetProfit: values.profitBeforeAds - values.advertising };
    }).sort((a, b) => a.date.localeCompare(b.date));
    if (new Set(dailyTotals.map(r => r.date)).size !== dailyTotals.length) throw fail(400, '일일 보고서 합계 날짜가 중복됩니다.');
    if (new Set([...reports, ...dailyTotals].map(r => r.date)).size > 31) throw fail(400, '손익 자료는 1~31일씩 저장하세요.');
    let s = previous;
    if (v.includeProducts === true) {
      const products = new Map(previous.products.map(p => [p.itemId, { ...p }])), imported = new Map();
      for (const report of reports) for (const r of report.rows) {
        const metadata = imported.get(r.itemId);
        imported.set(r.itemId, { ...r, channels: new Set([...(metadata?.channels || []), r.channel]) });
      }
      for (const [itemId, r] of imported) {
        const old = products.get(itemId);
        products.set(itemId, { ...old, itemId, name: old?.name || r.name, unitCost: old?.unitCost ?? null,
          productId: r.productId, productName: r.name, optionName: r.optionName,
          channel: r.channels.size === 1 ? [...r.channels][0] : null });
      }
      if (products.size > 500) throw fail(400, '기존 상품과 파일의 옵션을 합하면 500개를 초과합니다. 집계 상품을 확인하세요.');
      const selected = [...products.values()].sort((a, b) => a.itemId.localeCompare(b.itemId));
      s = { products: selected, key: hash(selected.map(p => p.itemId)) };
    }
    if (!s.products.length) throw fail(409, '집계할 옵션을 선택하거나 파일의 모든 옵션 추가를 선택하세요.');
    const importedAt = new Date(now()).toISOString();
    const writes = reports.map(report => salesWrite(c, s, report, importedAt, v.includeProducts === true));
    const stagedReports = new Map(writes.map(write => { const report = JSON.parse(write.content); return [report.date, report]; }));
    const itemIds = s.products.map(p => p.itemId).sort((a, b) => a.localeCompare(b));
    for (const total of dailyTotals) {
      const file = path.join(dir(c), 'daily-totals', total.date + '.json');
      const source = stagedReports.get(total.date) || read(path.join(dir(c), 'sales', total.date + '.json'), null);
      writes.push({ file, content: JSON.stringify({ ...total, vendorId: c.vendorId, scopeKey: s.key, itemIds, channel: 'all', salesBasis: salesBasis(source), importedAt }) });
    }
    if (v.includeProducts === true) writes.push({ file: path.join(dir(c), 'scope.json'), content: JSON.stringify(s) });
    // Keep originals until all replacements finish so a local disk failure can
    // roll back this request as well as validation failures.
    const originals = writes.map(({ file }) => fs.existsSync(file) ? fs.readFileSync(file) : null);
    let completed = 0;
    try { for (const write of writes) { atomic(write.file, write.content); completed++; } }
    catch (error) {
      for (let i = completed - 1; i >= 0; i--) {
        if (originals[i] === null) fs.unlinkSync(writes[i].file); else atomic(writes[i].file, originals[i]);
      }
      throw error;
    }
    const results = writes.slice(0, reports.length).map(write => write.result);
    const dates = [...new Set([...reports, ...dailyTotals].map(row => row.date))].sort();
    return { saved: true, reports: results, dailyTotals: dailyTotals.map(row => ({ date: row.date, saved: true })), days: dates.length, since: dates[0], until: dates.at(-1),
      imported: results.reduce((n, r) => n + r.imported, 0), matched: results.reduce((n, r) => n + r.matched, 0),
      excluded: results.reduce((n, r) => n + r.excluded, 0), addedProducts: s.products.length - previous.products.length, scopeKey: s.key, importedAt };
  }
  function analytics(v) {
    const c = config(), days = range(v.since, v.until, now()), s = requireScope(c), channel = v.channel || 'all';
    if (![...CHANNELS, 'all'].includes(channel)) throw fail(400, '조회 배송 방식을 확인하세요.');
    const view = v.view || null;
    if (view && !['dashboard', 'sales'].includes(view)) throw fail(400, '분석 화면을 확인하세요.');
    const selectedChannels = channel === 'all' ? CHANNELS : [channel], chosen = new Map(displayProducts(c, s.products).map(p => [p.itemId, p]));
    const ledgerRows = new Map(report(v).daily.map(r => [r.date + ':' + r.channel, r]));
    const fields = ['quantity', 'adQuantity', 'organicQuantity', 'sales', 'profitBeforeAds', 'advertising', 'adSales', 'adProfitBeforeAds', 'adNetProfit', 'nonAdvertisingCosts', 'otherCosts', 'sourceOtherCosts', 'sourceNetProfit', 'acquisitionAdvertising', 'netProfit', ...estimateFields()];
    const sum = (rows, field) => rows.every(r => Number.isFinite(r[field])) ? rows.reduce((total, row) => total + row[field], 0) : null;
    const empty = () => Object.fromEntries(fields.map(k => [k, null]));
    // Retain strict totals, while making the known sales portion visible when
    // another date, option, or delivery channel has not been collected yet.
    const availableFields = ['sales', 'quantity'];
    const addAvailable = (a, b) => Number.isFinite(a) ? a + (Number.isFinite(b) ? b : 0) : Number.isFinite(b) ? b : null;
    const available = rows => Object.fromEntries(availableFields.map(key => [key, rows.reduce((total, row) => addAvailable(total, row.available ? row.available[key] : row[key]), null)]));
    const items = [], itemTotals = new Map(), productTotals = new Map(), daily = [], seenImports = [], imports = new Map(), observedChannels = new Map();
    const itemFields = ['quantity', 'adQuantity', 'organicQuantity', 'sales', 'profitBeforeAds', 'advertising', 'adSales', 'adProfitBeforeAds', 'sourceNetProfit', 'netProfit', 'adNetProfit', 'nonAdvertisingCosts', 'sourceOtherCosts', ...estimateFields()];
    function addItem(row) {
      const display = chosen.get(row.itemId);
      if (display && String(row.productId) === String(display.productId)) {
        if (display.displayName) row.displayName = display.displayName;
        if (display.fullName) row.fullName = display.fullName;
        if (!row.optionName && display.optionName) row.optionName = display.optionName;
      }
      row.available = available([row]);
      if (!view) { items.push(row); return; }
      const key = row.channel + ':' + row.itemId;
      let total = itemTotals.get(key);
      if (!total) {
        total = { ...row, available: { ...row.available }, date: null, since: v.since, until: v.until, days: 1 }; itemTotals.set(key, total);
      } else {
        for (const field of itemFields) total[field] = Number.isFinite(total[field]) && Number.isFinite(row[field]) ? total[field] + row[field] : null;
        for (const field of availableFields) total.available[field] = addAvailable(total.available[field], row.available[field]);
        total.missingInputs = [...new Set([...(total.missingInputs || []), ...(row.missingInputs || [])])];
        total.missingInputReasons = total.missingInputs.map(estimateReason);
        if (total.estimateSource !== row.estimateSource) total.estimateSource = 'mixed';
        for (const field of ['unitCost', 'salePrice', 'inventory']) if (total[field] !== row[field]) total[field] = null;
        if (total.source !== row.source) total.source = 'mixed';
        total.days++;
      }
      if (view !== 'dashboard') return;
      const productKey = row.date + ':' + row.channel + ':' + row.productId;
      let product = productTotals.get(productKey);
      if (!product) {
        product = { date: row.date, channel: row.channel, productId: row.productId, name: row.name, ...(row.displayName ? { displayName: row.displayName } : {}), ...(row.fullName ? { fullName: row.fullName } : {}),
          quantity: row.quantity, sales: row.sales, available: { ...row.available }, source: row.source, hasData: row.source !== 'missing' };
        productTotals.set(productKey, product);
      } else {
        for (const field of ['quantity', 'sales']) product[field] = Number.isFinite(product[field]) && Number.isFinite(row[field]) ? product[field] + row[field] : null;
        for (const field of availableFields) product.available[field] = addAvailable(product.available[field], row.available[field]);
        if (product.source !== row.source) product.source = 'mixed';
        product.hasData ||= row.source !== 'missing';
      }
    }
    for (const date of days) {
      const imported = read(path.join(dir(c), 'sales', date + '.json'), null); imports.set(date, imported);
      if (imported && imported.vendorId !== c.vendorId) throw fail(500, '저장된 손익 자료의 판매자가 일치하지 않습니다.');
      for (const r of imported?.rows || []) if (chosen.has(r.itemId)) {
        const p = chosen.get(r.itemId); p.productId ||= r.productId; p.productName ||= r.name; p.optionName ||= r.optionName;
        if (!observedChannels.has(r.itemId)) observedChannels.set(r.itemId, new Set());
        observedChannels.get(r.itemId).add(r.channel);
      }
    }
    function estimates(p, quantity, sales, date, estimateSource) {
      return { unitCost: p.unitCost ?? null, salePrice: p.salePrice ?? null, inventory: null,
        ...estimateCosts(p, quantity, sales, date), estimateSource };
    }
    function applicable(p, ch) { return p.channel ? p.channel === ch : !observedChannels.has(p.itemId) || observedChannels.get(p.itemId).has(ch); }
    function missingItem(p, date, ch) {
      return { date, channel: ch, itemId: p.itemId, productId: p.productId || p.itemId, name: p.fullName || p.productName || p.name, optionName: p.optionName || '', source: 'missing',
        quantity: null, adQuantity: null, organicQuantity: null, sales: null, profitBeforeAds: null, advertising: null, adSales: null, adProfitBeforeAds: null,
        sourceNetProfit: null, netProfit: null, adNetProfit: null, nonAdvertisingCosts: null, sourceOtherCosts: null, adReturnOnSpend: null, roas: null, unitCost: p.unitCost ?? null, salePrice: p.salePrice ?? null, inventory: null,
        ...estimateCosts(p, null, null, date), estimateSource: null };
    }
    for (const date of days) {
      const imported = imports.get(date);
      if (imported) seenImports.push({ date, importedAt: imported.importedAt });
      const fileScoped = imported?.scopeMode === 'file' && Array.isArray(imported.reportItemIds);
      const reportItemIds = fileScoped ? new Set(imported.reportItemIds) : null;
      const effectiveFileIds = fileScoped ? [...reportItemIds].filter(itemId => chosen.has(itemId)).sort((a, b) => a.localeCompare(b)) : null;
      const acquisitionScopeKey = fileScoped ? hash(effectiveFileIds) : s.key;
      const fileSelectionChanged = fileScoped && imported.acquisitionScopeKey !== acquisitionScopeKey;
      const sourceScope = fileScoped ? { mode: 'file', fileProducts: reportItemIds.size, selectedFileProducts: effectiveFileIds.length, outsideFileProducts: chosen.size - effectiveFileIds.length } : { mode: 'selected' };
      const parts = [];
      for (const ch of selectedChannels) {
        const ledger = ledgerRows.get(date + ':' + ch), snap = snapshot(c, date, ch);
        const importedRows = (imported?.rows || []).filter(r => r.channel === ch && chosen.has(r.itemId));
        // Export rows identify an option's delivery type even for older catalog
        // imports that did not yet persist channel metadata.
        const expected = [...chosen.values()].filter(p => fileScoped ? reportItemIds.has(p.itemId) && imported.rows.some(r => r.itemId === p.itemId && r.channel === ch) : applicable(p, ch));
        const covered = !!imported && expected.every(p => importedRows.some(r => r.itemId === p.itemId));
        if (importedRows.length || imported && expected.length === 0) {
          const savedAcquisition = imported.acquisitionScopeKey === acquisitionScopeKey ? imported.acquisitionAdvertising[ch] : null;
          const acquisition = Number.isFinite(savedAcquisition) ? savedAcquisition : expected.length === 0 && importedRows.length === 0 && !fileSelectionChanged ? 0 : null;
          for (const r of importedRows) {
            const p = chosen.get(r.itemId);
            const calculated = estimates(p, r.quantity, r.sales, date, 'sellha');
            addItem({ ...r, date, source: 'sellha', nonAdvertisingCosts: r.sales - r.profitBeforeAds, adReturnOnSpend: r.advertising > 0 && Number.isFinite(r.adProfitBeforeAds) ? (r.adProfitBeforeAds - r.advertising) / r.advertising * 100 : null, sourceNetProfit: r.profitBeforeAds - r.advertising, netProfit: acquisition === 0 ? r.profitBeforeAds - r.advertising : null,
              sourceOtherCosts: Number.isFinite(calculated.estimatedProductCost) ? r.sales - r.profitBeforeAds - calculated.estimatedProductCost : null,
              adNetProfit: r.adProfitBeforeAds === null ? null : r.adProfitBeforeAds - r.advertising,
              roas: r.advertising > 0 && r.adSales !== null ? r.adSales / r.advertising * 100 : null, ...calculated });
          }
          for (const p of expected) if (!importedRows.some(r => r.itemId === p.itemId)) addItem(missingItem(p, date, ch));
          const sales = sum(importedRows, 'sales'), profitBeforeAds = sum(importedRows, 'profitBeforeAds'), advertising = sum(importedRows, 'advertising');
          const sourceNetProfit = profitBeforeAds - advertising;
          const calculated = aggregateEstimates(covered ? importedRows.map(r => ({ ...estimateCosts(chosen.get(r.itemId), r.quantity, r.sales, date), estimateSource: 'sellha' })) : [{ ...estimateCosts({}, null, null, date), estimateSource: 'sellha' }]);
          parts.push({ ...empty(), available: { sales, quantity: sum(importedRows, 'quantity') }, channel: ch, source: 'sellha', sourceScope, ...calculated, quantity: covered ? sum(importedRows, 'quantity') : null,
            sales: covered ? sales : null, profitBeforeAds: covered ? profitBeforeAds : null, advertising: covered ? advertising : null,
            ...Object.fromEntries(['adQuantity', 'organicQuantity', 'adSales', 'adProfitBeforeAds'].map(key => [key, covered ? sum(importedRows, key) : null])),
            adNetProfit: covered && sum(importedRows, 'adProfitBeforeAds') !== null ? sum(importedRows, 'adProfitBeforeAds') - advertising : null,
            nonAdvertisingCosts: covered ? sales - profitBeforeAds : null, sourceNetProfit: covered ? sourceNetProfit : null, acquisitionAdvertising: acquisition,
            sourceOtherCosts: covered && Number.isFinite(calculated.estimatedProductCost) ? sales - profitBeforeAds - calculated.estimatedProductCost : null,
            netProfit: covered && Number.isFinite(acquisition) ? sourceNetProfit - acquisition : null,
            complete: covered && Number.isFinite(acquisition), matchedProducts: importedRows.length, expectedProducts: expected.length });
          continue;
        }
        if (snap) {
          const grouped = new Map();
          for (const r of snap.rows || []) if (chosen.has(r.itemId)) {
            const previous = grouped.get(r.itemId) || { quantity: 0, sales: 0 };
            previous.quantity += r.quantity; previous.sales += r.gross; grouped.set(r.itemId, previous);
          }
          for (const p of chosen.values()) {
            if (!applicable(p, ch) && !grouped.has(p.itemId)) continue;
            const values = grouped.get(p.itemId) || { quantity: 0, sales: 0 };
            addItem({ date, channel: ch, itemId: p.itemId, productId: p.productId || p.itemId, name: p.fullName || p.productName || p.name, optionName: p.optionName || '', ...values,
              adQuantity: null, organicQuantity: null, profitBeforeAds: null, advertising: null, adSales: null, adProfitBeforeAds: null,
              sourceNetProfit: null, netProfit: null, adNetProfit: null, nonAdvertisingCosts: null, sourceOtherCosts: null, adReturnOnSpend: null, roas: null, source: 'api', ...estimates(p, values.quantity, values.sales, date, 'api') });
          }
        } else {
          for (const p of expected) addItem(missingItem(p, date, ch));
        }
        if (ledger?.complete) {
          const entry = ledger.entry, otherCosts = ['inbound', 'delivery', 'storage', 'returns', 'other'].reduce((n, k) => n + entry[k], 0);
          parts.push({ ...empty(), channel: ch, source: 'ledger', ...estimateValues(ledger), quantity: ledger.quantity, sales: entry.netSales,
            profitBeforeAds: ledger.profit + entry.advertising, nonAdvertisingCosts: entry.netSales - ledger.profit - entry.advertising, advertising: entry.advertising, otherCosts,
            sourceOtherCosts: entry.commission + otherCosts,
            sourceNetProfit: ledger.profit, netProfit: ledger.profit, complete: true });
        } else if (snap) {
          parts.push({ ...empty(), channel: ch, source: 'api', ...estimateValues(ledger), quantity: ledger.quantity, sales: ledger.gross, complete: false });
        } else {
          parts.push({ ...empty(), channel: ch, source: 'missing', ...estimateCosts({}, null, null, date), estimateSource: null, complete: false });
        }
      }
      const sources = new Set(parts.map(p => p.source));
      const source = sources.size > 1 ? 'mixed' : [...sources][0];
      const roas = row => Number.isFinite(row.adSales) && Number.isFinite(row.advertising) && row.advertising > 0 ? row.adSales / row.advertising * 100 : null;
      const adReturnOnSpend = row => Number.isFinite(row.adNetProfit) && Number.isFinite(row.advertising) && row.advertising > 0 ? row.adNetProfit / row.advertising * 100 : null;
      for (const part of parts) { part.fetchedAt = ledgerRows.get(date + ':' + part.channel)?.fetchedAt || null; if (!part.available) part.available = available([part]); part.roas = roas(part); part.adReturnOnSpend = adReturnOnSpend(part); }
      const day = { date, source, sourceScope, ...Object.fromEntries(fields.map(k => [k, sum(parts, k)])), ...aggregateEstimates(parts), available: available(parts), complete: parts.every(p => p.complete), channels: parts };
      const totals = channel === 'all' ? read(path.join(dir(c), 'daily-totals', date + '.json'), null) : null;
      if (totals && totals.vendorId === c.vendorId && totals.channel === 'all' && totals.scopeKey === s.key && totals.salesBasis === salesBasis(imported) && Array.isArray(totals.itemIds) && hash([...totals.itemIds].sort((a, b) => a.localeCompare(b))) === hash([...chosen.keys()].sort((a, b) => a.localeCompare(b)))) {
        // Reconciled whole-day values are a separate source. They never alter
        // option rows, delivery breakdowns, API snapshots or acquisition costs.
        Object.assign(day, { underlyingSource: day.source, source: 'reconciled', sales: totals.sales, profitBeforeAds: totals.profitBeforeAds, advertising: totals.advertising,
          otherCosts: totals.otherCosts, sourceOtherCosts: totals.otherCosts, sourceNetProfit: totals.profitBeforeAds - totals.advertising,
          nonAdvertisingCosts: totals.sales - totals.profitBeforeAds, available: { ...day.available, sales: totals.sales },
          dailyTotalsApplied: true, dailyTotals: { importedAt: totals.importedAt, scopeKey: totals.scopeKey, channel: 'all', basis: 'saved-daily-report' } });
        seenImports.push({ date, importedAt: totals.importedAt });
      }
      day.roas = roas(day); day.adReturnOnSpend = adReturnOnSpend(day); daily.push(day);
    }
    const summary = { ...Object.fromEntries(fields.map(k => [k, sum(daily, k)])), ...aggregateEstimates(daily), available: available(daily), complete: daily.every(d => d.complete) };
    summary.roas = Number.isFinite(summary.adSales) && Number.isFinite(summary.advertising) && summary.advertising > 0 ? summary.adSales / summary.advertising * 100 : null;
    summary.adReturnOnSpend = Number.isFinite(summary.adNetProfit) && Number.isFinite(summary.advertising) && summary.advertising > 0 ? summary.adNetProfit / summary.advertising * 100 : null;
    if (view) for (const item of itemTotals.values()) {
      item.roas = item.advertising > 0 && Number.isFinite(item.adSales) ? item.adSales / item.advertising * 100 : null;
      item.adReturnOnSpend = Number.isFinite(item.adNetProfit) && Number.isFinite(item.advertising) && item.advertising > 0 ? item.adNetProfit / item.advertising * 100 : null;
      items.push(item);
    }
    const savedParts = daily.flatMap(day => day.channels.filter(part => part.fetchedAt).map(part => ({ date: day.date, fetchedAt: part.fetchedAt })));
    const storage = { latestOrderDate: savedParts.map(part => part.date).sort().at(-1) || null, lastSavedAt: savedParts.map(part => part.fetchedAt).sort().at(-1) || null, storedDays: savedParts.length, expectedDays: days.length * selectedChannels.length };
    return { since: v.since, until: v.until, channel, storage, ...(view ? { view } : {}), scopeKey: s.key, vendorKey: hash(c.vendorId), workspaceRevision: workspaceState(c).revision, daily, items, summary,
      ...(view === 'dashboard' ? { productDaily: [...productTotals.values()].filter(p => p.hasData).map(({ hasData, ...p }) => p) } : {}),
      coverage: { fileScopeDays: daily.filter(d => d.sourceScope.mode === 'file').length, sellhaDays: daily.filter(d => d.channels.some(p => p.source === 'sellha')).length, apiDays: daily.filter(d => d.channels.some(p => p.source === 'api')).length, totalDays: days.length },
      importedDates: [...new Set(seenImports.map(d => d.date))], lastImportedAt: seenImports.map(d => d.importedAt).filter(Boolean).sort().at(-1) || null };
  }
  function estimateFields() { return ['estimatedProductCost', 'estimatedCommission', 'estimatedFulfillment', 'estimatedOtherCosts', 'estimatedProfitBeforeAds']; }
  function estimateReason(key) {
    return { orders: '저장된 주문 자료 없음', unitCost: '개당 원가 미등록', costSince: '해당 날짜에 적용할 원가 없음', commissionRate: '판매수수료율 미등록', inboundFee: '개당 입출고 요금 미등록', deliveryFee: '개당 배송비 미등록' }[key] || key;
  }
  function estimateCosts(product, quantity, sales, date) {
    const missingInputs = [];
    if (!Number.isFinite(quantity) || !Number.isFinite(sales)) {
      return { ...Object.fromEntries(estimateFields().map(key => [key, null])), missingInputs: ['orders'], missingInputReasons: [estimateReason('orders')] };
    }
    const costApplies = !product.costSince || date >= product.costSince;
    if (quantity !== 0) {
      if (!Number.isFinite(product.unitCost)) missingInputs.push('unitCost');
      if (!costApplies) missingInputs.push('costSince');
      if (!Number.isFinite(product.inboundFee)) missingInputs.push('inboundFee');
      if (!Number.isFinite(product.deliveryFee)) missingInputs.push('deliveryFee');
    }
    if (sales !== 0 && !Number.isFinite(product.commissionRate)) missingInputs.push('commissionRate');
    const estimatedProductCost = quantity === 0 ? 0 : Number.isFinite(product.unitCost) && costApplies ? quantity * product.unitCost : null;
    const estimatedCommission = sales === 0 ? 0 : Number.isFinite(product.commissionRate) ? sales * product.commissionRate / 100 : null;
    const estimatedFulfillment = quantity === 0 ? 0 : Number.isFinite(product.inboundFee) && Number.isFinite(product.deliveryFee) ? quantity * (product.inboundFee + product.deliveryFee) : null;
    const costs = [estimatedProductCost, estimatedCommission, estimatedFulfillment];
    return { estimatedProductCost, estimatedCommission, estimatedFulfillment,
      estimatedOtherCosts: [estimatedCommission, estimatedFulfillment].every(Number.isFinite) ? estimatedCommission + estimatedFulfillment : null,
      estimatedProfitBeforeAds: costs.every(Number.isFinite) ? sales - costs.reduce((total, value) => total + value, 0) : null,
      missingInputs, missingInputReasons: missingInputs.map(estimateReason) };
  }
  function aggregateEstimates(rows) {
    const missingInputs = [...new Set(rows.flatMap(row => row.missingInputs || []))];
    const sources = [...new Set(rows.map(row => row.estimateSource).filter(Boolean))];
    return { ...Object.fromEntries(estimateFields().map(key => [key, rows.every(row => Number.isFinite(row[key])) ? rows.reduce((total, row) => total + row[key], 0) : null])),
      missingInputs, missingInputReasons: missingInputs.map(estimateReason), estimateSource: sources.length > 1 ? 'mixed' : sources[0] || null };
  }
  function estimateValues(row) {
    return { ...Object.fromEntries(estimateFields().map(key => [key, row[key]])), missingInputs: row.missingInputs, missingInputReasons: row.missingInputReasons, estimateSource: row.estimateSource };
  }
  function report(v) {
    const c = config(), days = range(v.since, v.until, now()), s = requireScope(c), entries = read(ledgerFile(c, s), {}), chosen = new Map(s.products.map(p => [p.itemId, p]));
    const daily = days.flatMap(date => CHANNELS.map(channel => {
      const snap = snapshot(c, date, channel), rows = snap?.rows.filter(r => chosen.has(r.itemId)) || [], entry = entries[date + ':' + channel] || null;
      const current = basis(snap), stale = !!entry && entry.basis !== current;
      const complete = !!entry && !stale && entry.reviewed && COSTS.every(k => Number.isFinite(entry[k]));
      const gross = snap ? rows.reduce((n, r) => n + r.gross, 0) : null;
      const estimates = snap ? aggregateEstimates(rows.map(row => ({ ...estimateCosts(chosen.get(row.itemId), row.quantity, row.gross, date), estimateSource: 'api' }))) : { ...estimateCosts({}, null, null, date), estimateSource: null };
      if (snap) estimates.estimateSource = 'api';
      return { date, channel, gross, quantity: snap ? rows.reduce((n, r) => n + r.quantity, 0) : null, ...estimates,
        fetchedAt: snap?.fetchedAt || null, basis: current, entry, stale, complete,
        profit: complete ? entry.netSales - COSTS.filter(k => k !== 'netSales').reduce((sum, k) => sum + entry[k], 0) : null };
    }));
    const summaries = Object.fromEntries([...CHANNELS, 'all'].map(ch => {
      const rows = daily.filter(r => ch === 'all' || r.channel === ch), complete = rows.every(r => r.complete);
      return [ch, { ...aggregateEstimates(rows), completeDays: rows.filter(r => r.complete).length, totalDays: rows.length, complete,
        netSales: complete ? rows.reduce((n, r) => n + r.entry.netSales, 0) : null, profit: complete ? rows.reduce((n, r) => n + r.profit, 0) : null }];
    }));
    return { since: v.since, until: v.until, scopeKey: s.key, products: s.products, daily, summaries,
      note: '주문 API 금액은 반품·할인·정산 비용이 확정된 매출이 아닙니다. 이익은 선택한 트루버·위마망 상품의 환불 반영 매출과 모든 비용을 확인한 날에만 계산합니다. 부가세 포함 현금 기준 예상 이익이며 인건비·임차료·세금은 기타 비용에 반영한 범위만 포함합니다.' };
  }
  return { status, saveCredentials, diagnose, thumbnailStatus, startThumbnails, waitForThumbnails: () => thumbnailTask, saveScope, importCatalog, workspace, updateProduct, saveGroups, importSales, importSalesBatch, analytics, products, sync, saveLedger, report, startHistory, historyStatus, pauseHistory, refresh, automatic, waitForRefresh: () => refreshTask, waitForHistory: () => historyTask };
}
module.exports = { createService, safeThumbnailUrl, signature, normalize, money, apiMoney, orderDate, COSTS, range };
