'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const DAY = 86400000;
const at = date => Date.parse(date + 'T00:00:00Z');
const shift = (date, n) => new Date(at(date) + n * DAY).toISOString().slice(0, 10);
const validDate = date => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(at(date)) && new Date(at(date)).toISOString().slice(0, 10) === date;
const fail = (message, status = 400) => { throw Object.assign(Error(message), { status }); };
const channels = ['meta-naver', 'meta-cafe', 'meta-other', 'naver-search', 'naver-display', 'other'];
const levels = ['account', 'campaign', 'adset', 'ad', 'unlinked'];
function text(value, max = 500) { const s = String(value ?? '').trim(); if (s.length > max) fail('입력 내용이 너무 깁니다.'); return s; }
function validate(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('변경 기록 형식이 올바르지 않습니다.');
  const entry = {};
  for (const [key, max] of Object.entries({ date: 10, channel: 30, account: 40, level: 20, entityId: 100, entityName: 300, campaignId: 100, adsetId: 100, kind: 80, before: 2000, after: 2000, note: 4000 })) entry[key] = text(input[key], max);
  if (!validDate(entry.date) || entry.date < '2000-01-01' || entry.date > '2099-12-31') fail('실제 존재하는 변경 날짜를 선택하세요.');
  if (!channels.includes(entry.channel) || !levels.includes(entry.level)) fail('광고 채널과 대상 구분을 확인하세요.');
  entry.account = entry.account.replace(/^act_/, '');
  if (entry.channel.startsWith('meta-') && entry.account && !/^\d{5,30}$/.test(entry.account)) fail('Meta 광고 계정 ID는 숫자로 입력하세요.');
  if (!entry.kind || (!entry.before && !entry.after && !entry.note)) fail('변경 종류와 변경 전·후 내용 또는 메모를 입력하세요.');
  entry.windowDays = Number(input.windowDays ?? 7);
  if (![3, 7, 14, 28].includes(entry.windowDays)) fail('비교 기간은 3·7·14·28일 중 선택하세요.');
  return entry;
}
function createJournal({ baseDir, loadDay, today }) {
  const file = path.join(baseDir, '.roas-data', 'ad-changes.json');
  function read() {
    try {
      const v = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (v.schema !== 1 || !Array.isArray(v.entries)) throw Error('format');
      return v;
    } catch (e) {
      if (e.code === 'ENOENT') return { schema: 1, entries: [] };
      fail('광고 변경 기록 파일을 읽지 못했습니다. 기존 파일을 확인해 주세요.', 500);
    }
  }
  function write(store) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp-' + crypto.randomUUID();
    try { fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8'); fs.renameSync(tmp, file); }
    finally { fs.rmSync(tmp, { force: true }); }
  }
  function list() { return read().entries.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)); }
  function save(input) {
    const entry = validate(input), store = read(), id = input.id ? text(input.id, 100) : crypto.randomUUID();
    const index = store.entries.findIndex(e => e.id === id), previous = store.entries[index];
    if (input.id && !previous) fail('기록을 찾을 수 없습니다. 새로고침하세요.', 404);
    if (previous && Number(input.revision) !== previous.revision) fail('다른 화면에서 수정한 기록입니다. 새로고침 후 다시 수정하세요.', 409);
    if (!previous && store.entries.length >= 10000) fail('최대 10,000개까지 저장할 수 있습니다.');
    const now = new Date().toISOString();
    const result = { ...entry, id, revision: (previous?.revision || 0) + 1, createdAt: previous?.createdAt || now, updatedAt: now, ...(previous?.legacyKey ? { legacyKey: previous.legacyKey } : {}) };
    if (previous) store.entries[index] = result; else store.entries.push(result);
    write(store); return result;
  }
  function remove(input) {
    const store = read(), index = store.entries.findIndex(e => e.id === input.id);
    if (index < 0) fail('삭제할 기록이 없습니다.', 404);
    if (Number(input.revision) !== store.entries[index].revision) fail('기록이 변경됐습니다. 새로고침하세요.', 409);
    const removed = store.entries.splice(index, 1)[0];
    if (removed.legacyKey) store.legacyKeys = [...new Set([...(store.legacyKeys || []), removed.legacyKey])];
    write(store); return { ok: true };
  }
  function importLegacy(items) {
    if (!Array.isArray(items) || items.length > 500) fail('기존 기록은 한 번에 500개까지 가져올 수 있습니다.');
    const store = read(); let imported = 0;
    const seen = new Set([...(store.legacyKeys || []), ...store.entries.map(e => e.legacyKey).filter(Boolean)]);
    for (const item of items) {
      const raw = { date: item.date, kind: item.kind, ad: item.ad, note: item.note };
      const key = crypto.createHash('sha256').update(JSON.stringify(raw)).digest('hex');
      if (seen.has(key)) continue;
      seen.add(key);
      const entry = validate({ ...raw, channel: 'other', level: 'unlinked', entityName: item.ad || '기존 기록', windowDays: 7 });
      const now = new Date().toISOString();
      store.entries.push({ ...entry, id: crypto.randomUUID(), revision: 1, createdAt: now, updatedAt: now, legacyKey: key }); imported++;
    }
    if (store.entries.length > 10000) fail('최대 10,000개까지 저장할 수 있습니다.');
    if (imported || seen.size !== (store.legacyKeys || []).length) { store.legacyKeys = [...seen]; write(store); }
    return { imported, entries: list() };
  }
  function matches(entry, row) {
    return entry.level === 'account' || String(row[{ campaign: 'campaign_id', adset: 'adset_id', ad: 'ad_id' }[entry.level]] || '') === entry.entityId;
  }
  function overlaps(a, b) {
    if (a.id === b.id || a.account !== b.account || !a.channel.startsWith('meta-') || !b.channel.startsWith('meta-')) return false;
    if ([a, b].some(e => !e.account || e.level === 'unlinked' || (e.level !== 'account' && !e.entityId))) return false;
    if (a.level === 'account' || b.level === 'account') return true;
    if (a.level === b.level) return !!a.entityId && a.entityId === b.entityId;
    const higher = levels.indexOf(a.level) < levels.indexOf(b.level) ? a : b, lower = higher === a ? b : a;
    const parentId = higher.level === 'campaign' ? lower.campaignId : lower.adsetId;
    // Missing parent IDs cannot rule out overlap for manually linked entries.
    return !parentId || higher.entityId === parentId;
  }
  function action(values) {
    if (values == null) return 0;
    if (!Array.isArray(values)) return null;
    for (const type of ['purchase', 'omni_purchase', 'offsite_conversion.fb_pixel_purchase']) {
      const found = values.find(v => v.action_type === type);
      if (found) { return amount(found.value); }
    }
    return 0;
  }
  const amount = v => v !== undefined && v !== null && v !== '' && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : null;
  function period(entry, since, until, cache) {
    const dates = [], missingDays = [], pendingDays = [], daily = [], currencies = new Set();
    const sums = { spend: 0, purchases: 0, revenue: 0, clicks: 0, impressions: 0 };
    let rowCount = 0;
    for (let date = since; date <= until; date = shift(date, 1)) {
      dates.push(date);
      if (date >= today()) { pendingDays.push(date); continue; }
      const snapshot = loadDay(entry.account, date, cache);
      if (!snapshot) { missingDays.push(date); continue; }
      const total = { date, spend: 0, purchases: 0, revenue: 0, clicks: 0, impressions: 0, rowCount: 0 };
      const add = (obj, k, v) => { obj[k] = obj[k] == null || v == null ? null : obj[k] + v; };
      if (snapshot.currency) currencies.add(snapshot.currency);
      for (const row of snapshot.rows) {
        if (!matches(entry, row)) continue;
        rowCount++; total.rowCount++;
        if (row.account_currency) currencies.add(row.account_currency);
        const values = { spend: amount(row.spend), purchases: action(row.actions), revenue: action(row.action_values), clicks: row.inline_link_clicks == null ? 0 : amount(row.inline_link_clicks), impressions: amount(row.impressions) };
        for (const k of Object.keys(sums)) add(total, k, values[k]);
      }
      for (const k of Object.keys(sums)) add(sums, k, total[k]);
      daily.push(total);
    }
    const currency = currencies.size === 1 ? [...currencies][0] : null;
    const metrics = { ...sums, roas: sums.spend > 0 && sums.revenue != null ? 100 * sums.revenue / sums.spend : null, cpa: sums.purchases > 0 && sums.spend != null ? sums.spend / sums.purchases : null, cpc: sums.clicks > 0 && sums.spend != null ? sums.spend / sums.clicks : null, ctr: sums.impressions > 0 && sums.clicks != null ? 100 * sums.clicks / sums.impressions : null };
    return { since, until, days: dates.length, storedDays: daily.length, missingDays, pendingDays, daily, currency, currencies: [...currencies], rowCount, complete: !missingDays.length && !pendingDays.length, metrics };
  }
  function report(entry, all = list(), cache = new Map()) {
    const window = { before: { since: shift(entry.date, -entry.windowDays), until: shift(entry.date, -1) }, after: { since: shift(entry.date, 1), until: shift(entry.date, entry.windowDays) } };
    if (!entry.channel.startsWith('meta-')) return { entry, window, ready: false, status: '기록만 저장', notes: ['이 채널은 변경 기록과 메모를 저장합니다. 자동 성과 비교는 Meta 저장 데이터부터 지원합니다.'] };
    if (!entry.account || entry.level === 'unlinked' || (entry.level !== 'account' && !entry.entityId)) return { entry, window, ready: false, status: '광고 연결 필요', notes: ['광고 계정 ID와 대상 ID를 연결하면 변경 전후 성과를 비교할 수 있습니다. 이름만으로 다른 광고의 성과를 합치지 않습니다.'] };
    const before = period(entry, window.before.since, window.before.until, cache), after = period(entry, window.after.since, window.after.until, cache);
    const conflicts = all.filter(other => other.date >= window.before.since && other.date <= window.after.until && overlaps(entry, other)).map(e => ({ id: e.id, date: e.date, kind: e.kind }));
    const notes = [];
    if (!before.complete || !after.complete) notes.push('오늘과 미래 날짜는 집계에서 제외하며, 누락일을 0으로 채우지 않습니다. 양쪽 기간이 모두 채워진 뒤 비교하세요.');
    if (!before.currency || !after.currency || before.currency !== after.currency) notes.push('계정 통화가 미확인 또는 서로 달라 ROAS 변화 판단을 보류합니다.');
    if (conflicts.length) notes.push('비교 기간에 같은 대상 또는 상하위 대상의 다른 변경이 있습니다. 변경 효과가 섞일 수 있습니다.');
    if (before.metrics.purchases < 5 || after.metrics.purchases < 5) notes.push('한쪽 기간 구매가 5건 미만입니다. 구매 표본이 적어 결과가 쉽게 바뀔 수 있습니다.');
    const ready = before.complete && after.complete && before.currency && before.currency === after.currency && before.metrics.spend > 0 && after.metrics.spend > 0 && before.metrics.roas != null && after.metrics.roas != null;
    const status = after.pendingDays.length ? '관찰 중' : !before.complete || !after.complete ? '저장 데이터 부족' : !ready ? '성과 확인 필요' : conflicts.length ? '다른 변경과 겹침' : '비교 가능';
    const deltas = ready ? Object.fromEntries(['spend', 'purchases', 'revenue', 'roas', 'cpa', 'cpc', 'ctr'].map(k => [k, before.metrics[k] != null && after.metrics[k] != null ? after.metrics[k] - before.metrics[k] : null])) : null;
    return { entry, window, before, after, ready: !!ready, status, conflicts, deltas, notes };
  }
  function exportReport() {
    const entries = list(), cache = new Map();
    return { schema: 1, generatedAt: new Date().toISOString(), source: 'ROAS Pilot 광고 변경 기록', basis: 'Meta 저장 성과 / 원본 계정 통화 / 변경 당일 제외 / 전후 동일 일수 / 오늘·미래 제외. Meta 귀속 구매매출이며 실제 주문매출·순증 효과가 아님. 여러 광고의 우열은 기간·통화·표본·다른 변경과 함께 판단해야 함.', entries, reports: entries.map(entry => report(entry, entries, cache)) };
  }
  return { list, save, remove, importLegacy, report, exportReport };
}
module.exports = { createJournal, validate, shift, validDate };
