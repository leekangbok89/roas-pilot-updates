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
function createService({ baseDir, protect, fetchImpl = (...args) => fetch(...args), now = Date.now, sleep = ms => new Promise(r => setTimeout(r, ms)) }) {
  const privateFile = path.join(baseDir, '.roas-private', 'coupang.dpapi');
  const root = path.join(baseDir, '.roas-data', 'coupang');
  let busy = false, lastRequest = 0, historyActive = false, historyTask = null, automaticStarted = false;
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
  function status() {
    if (!fs.existsSync(privateFile)) return { configured: false, busy, products: [] };
    const c = config(), s = scope(c);
    return { configured: true, vendorId: c.vendorId, busy: busy || historyActive, products: s.products, scopeKey: s.key, apiVerified: read(path.join(dir(c), 'state.json'), {}), history: historyStatus(), backfill: read(path.join(dir(c), 'backfill.json'), {}), automatic: read(path.join(dir(c), 'automatic.json'), {}) };
  }
  function saveCredentials(v) {
    if (busy || historyActive) throw fail(409, '수집 중에는 연결 정보를 바꿀 수 없습니다.');
    const c = credentials(v); let encrypted;
    try { encrypted = protect('encrypt', JSON.stringify(c)); } catch { throw fail(500, 'Windows 계정 암호화에 실패했습니다. 기존 연결은 유지됩니다.'); }
    atomic(privateFile, encrypted); return status();
  }
  function saveScope(v) {
    const c = config();
    if (!Array.isArray(v?.products) || !v.products.length || v.products.length > 500) throw fail(400, '트루버·위마망 옵션을 1개 이상 선택하세요.');
    const products = v.products.map(p => {
      if (!id(p?.itemId) || typeof p.name !== 'string' || !p.name.trim() || p.name.length > 300 || (p.unitCost !== null && money(p.unitCost) === null)) throw fail(400, '옵션 ID·상품명·원가를 확인하세요.');
      return { ...scope(c).products.find(old=>old.itemId===String(p.itemId)), itemId: String(p.itemId), name: p.name.trim(), unitCost: p.unitCost === null ? null : money(p.unitCost) };
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
      return { itemId:String(p.itemId), name:p.name.trim(), unitCost:Number(p.unitCost)>0?Number(p.unitCost):null,
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
  async function get(c, uri, params) {
    const allowed = ['/v2/providers/rg_open_api/apis/api/v1/vendors/' + c.vendorId + '/rg/orders', '/v2/providers/openapi/apis/api/v5/vendors/' + c.vendorId + '/ordersheets'];
    if (!allowed.includes(uri)) throw fail(400, '지원하지 않는 쿠팡 조회입니다.');
    const query = new URLSearchParams(params).toString();
    for (let attempt = 0; attempt < 3; attempt++) {
    await sleep(Math.max(0, 1300 - (now() - lastRequest))); lastRequest = now();
    let r;
    try { r = await fetchImpl('https://api-gateway.coupang.com' + uri + '?' + query, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(25000), headers: { Authorization: signature(c, uri, query, now()), 'X-Requested-By': c.vendorId, Accept: 'application/json' } }); }
    catch { if (attempt < 2) { await sleep(1000 * 2 ** attempt); continue; } throw fail(502, '쿠팡 API에 연결하지 못했습니다. 인터넷 연결을 확인하세요.'); }
    if ((r.status === 429 || r.status >= 500) && attempt < 2) { await r.body?.cancel?.(); await sleep(2000 * 2 ** attempt); continue; }
    if (!r.ok) { await r.body?.cancel?.(); throw fail(r.status === 429 ? 429 : 502, [401, 403].includes(r.status) ? '쿠팡 인증에 실패했습니다. API 키·업체코드·허용 IP·PC 시간을 확인하세요.' : '쿠팡 API 조회 실패 (HTTP ' + r.status + '). 기존 저장 자료는 유지됩니다.'); }
    let v; try { v = await r.json(); } catch { throw fail(502, '쿠팡 API 응답 형식을 확인할 수 없습니다.'); }
    if (v?.code !== 200 || !Array.isArray(v.data)) throw fail(502, '쿠팡 API가 정상 목록을 반환하지 않았습니다.');
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
    if (busy || historyActive && !internal) throw fail(409, '쿠팡 자료를 수집 중입니다.'); busy = true;
    const result = { savedDays: [], channel: v.channel };
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
        atomic(path.join(dir(c), 'orders', date + '-' + v.channel + '.json'), JSON.stringify(snap)); result.savedDays.push(date);
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
    if (busy) throw fail(409, '쿠팡 자료를 수집 중입니다.');
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
    Object.assign(job, { status: 'running', pauseRequested: false, error: null, current: null, updatedAt: new Date(now()).toISOString() });
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
      } catch (e) { job.status = 'failed'; job.error = e.message || '쿠팡 수집에 실패했습니다.'; }
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
  async function automatic() {
    if (automaticStarted || historyActive || busy || !fs.existsSync(privateFile)) return { started: false };
    const c = config(), baseline = read(path.join(dir(c), 'backfill.json'), {}), channels = CHANNELS.filter(ch => baseline[ch]?.completedAt);
    if (!channels.length) return { started: false, reason: 'initial-year-incomplete' };
    const pending = read(historyFile(c), null);
    if (pending && pending.kind !== 'startup' && pending.status !== 'completed') return { started: false, reason: 'unfinished-collection' };
    automaticStarted = true;
    const file = path.join(dir(c), 'automatic.json'), state = read(file, {}), until = kstDay(now()), since = kstDay(now() - 6 * DAY);
    atomic(file, JSON.stringify({ ...state, lastStartedAt: new Date(now()).toISOString(), since, until, error: null }));
    startHistory({ since, until, channels }, 'startup');
    await historyTask;
    const result = historyStatus();
    atomic(file, JSON.stringify({ ...read(file, {}), ...(result.status === 'completed' ? { lastCompletedAt: new Date(now()).toISOString() } : {}), error: result.error || null }));
    return { started: true, history: result };
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
  function report(v) {
    const c = config(), days = range(v.since, v.until, now()), s = requireScope(c), entries = read(ledgerFile(c, s), {}), chosen = new Map(s.products.map(p => [p.itemId, p]));
    const daily = days.flatMap(date => CHANNELS.map(channel => {
      const snap = snapshot(c, date, channel), rows = snap?.rows.filter(r => chosen.has(r.itemId)) || [], entry = entries[date + ':' + channel] || null;
      const current = basis(snap), stale = !!entry && entry.basis !== current;
      const complete = !!entry && !stale && entry.reviewed && COSTS.every(k => Number.isFinite(entry[k]));
      const gross = snap ? rows.reduce((n, r) => n + r.gross, 0) : null;
      const unitCostKnown = !!snap && rows.every(r => chosen.get(r.itemId).unitCost !== null && (!chosen.get(r.itemId).costSince || date >= chosen.get(r.itemId).costSince));
      return { date, channel, gross, quantity: snap ? rows.reduce((n, r) => n + r.quantity, 0) : null,
        estimatedProductCost: unitCostKnown ? rows.reduce((n, r) => n + r.quantity * chosen.get(r.itemId).unitCost, 0) : null,
        estimatedCommission: snap && rows.every(r=>Number.isFinite(chosen.get(r.itemId).commissionRate)) ? rows.reduce((n,r)=>n+r.gross*chosen.get(r.itemId).commissionRate/100,0) : null,
        estimatedFulfillment: snap && rows.every(r=>Number.isFinite(chosen.get(r.itemId).inboundFee)&&Number.isFinite(chosen.get(r.itemId).deliveryFee)) ? rows.reduce((n,r)=>n+r.quantity*(chosen.get(r.itemId).inboundFee+chosen.get(r.itemId).deliveryFee),0) : null,
        fetchedAt: snap?.fetchedAt || null, basis: current, entry, stale, complete,
        profit: complete ? entry.netSales - COSTS.filter(k => k !== 'netSales').reduce((sum, k) => sum + entry[k], 0) : null };
    }));
    const summaries = Object.fromEntries([...CHANNELS, 'all'].map(ch => {
      const rows = daily.filter(r => ch === 'all' || r.channel === ch), complete = rows.every(r => r.complete);
      return [ch, { completeDays: rows.filter(r => r.complete).length, totalDays: rows.length, complete,
        netSales: complete ? rows.reduce((n, r) => n + r.entry.netSales, 0) : null, profit: complete ? rows.reduce((n, r) => n + r.profit, 0) : null }];
    }));
    return { since: v.since, until: v.until, scopeKey: s.key, products: s.products, daily, summaries,
      note: '주문 API 금액은 반품·할인·정산 비용이 확정된 매출이 아닙니다. 이익은 선택한 트루버·위마망 상품의 환불 반영 매출과 모든 비용을 확인한 날에만 계산합니다. 부가세 포함 현금 기준 예상 이익이며 인건비·임차료·세금은 기타 비용에 반영한 범위만 포함합니다.' };
  }
  return { status, saveCredentials, saveScope, importCatalog, products, sync, saveLedger, report, startHistory, historyStatus, pauseHistory, automatic, waitForHistory: () => historyTask };
}
module.exports = { createService, signature, normalize, money, apiMoney, orderDate, COSTS, range };
