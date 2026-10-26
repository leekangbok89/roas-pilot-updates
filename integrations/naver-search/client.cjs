'use strict';

// Embedded in server.js for installations whose updater copies only known files.
// All requests to Naver are GETs. Credentials never leave the local server.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const FIELDS = ['impCnt', 'clkCnt', 'salesAmt', 'ccnt', 'convAmt', 'purchaseCcnt', 'purchaseConvAmt'];
const KEYS = { impressions: 'impCnt', clicks: 'clkCnt', spend: 'salesAmt', conversions: 'ccnt', conversionRevenue: 'convAmt', purchases: 'purchaseCcnt', purchaseRevenue: 'purchaseConvAmt' };
const HOUR = 3600000;
const fail = (status, message) => Object.assign(Error(message), { status });
const kstDate = ms => new Date(ms + 9 * HOUR).toISOString().slice(0, 10);
const validDate = x => typeof x === 'string' && /^\d{4}-\d\d-\d\d$/.test(x) && Number.isFinite(Date.parse(x)) && new Date(x).toISOString().slice(0, 10) === x;

function credentials(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail(400, '검색광고 연결 정보를 입력해 주세요.');
  const text = key => typeof input[key] === 'string' ? input[key].trim() : '';
  const value = { customerId: text('customerId'), apiKey: text('apiKey'), secretKey: text('secretKey') };
  if (!/^[1-9]\d{0,19}$/.test(value.customerId)) throw fail(400, '검색광고의 숫자형 고객 ID(Customer ID)를 확인해 주세요.');
  if (['apiKey', 'secretKey'].some(key => !/^[\x21-\x7e]{8,512}$/.test(value[key]))) throw fail(400, '액세스라이선스와 비밀키를 모두 정확하게 입력해 주세요.');
  return value;
}
function dateRange(since, until, now) {
  if (!validDate(since) || !validDate(until) || since > until || until > kstDate(now)) throw fail(400, '조회 날짜를 확인해 주세요. 미래 날짜는 조회할 수 없습니다.');
  if ((Date.parse(until) - Date.parse(since)) / 86400000 >= 31) throw fail(400, '한 번에 최대 31일까지 조회할 수 있습니다.');
  return { since, until };
}
function signature(timestamp, uri, secretKey) {
  return crypto.createHmac('sha256', secretKey).update(timestamp + '.GET.' + uri).digest('base64');
}
function metric(raw) {
  if ((typeof raw !== 'number' && typeof raw !== 'string') || raw === '' || (typeof raw === 'string' && !raw.trim())) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
function ratios(row) {
  return { ...row,
    ctr: row.impressions > 0 && row.clicks !== null ? row.clicks / row.impressions * 100 : null,
    cpc: row.clicks > 0 && row.spend !== null ? row.spend / row.clicks : null,
    cpm: row.impressions > 0 && row.spend !== null ? row.spend / row.impressions * 1000 : null,
    purchaseRoas: row.spend > 0 && row.purchaseRevenue !== null ? row.purchaseRevenue / row.spend * 100 : null };
}
function aggregate(rows) {
  return ratios(Object.fromEntries(Object.keys(KEYS).map(key => [key, rows.length && rows.every(row => row[key] !== null) ? rows.reduce((sum, row) => sum + row[key], 0) : null])));
}
function atomic(filename, value) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const temp = filename + '.tmp-' + crypto.randomBytes(6).toString('hex');
  try { fs.writeFileSync(temp, value, { mode: 0o600, encoding: 'utf8', flag: 'wx' }); fs.renameSync(temp, filename); }
  finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}

function createSearchService({ baseDir, protect, fetchImpl = (...args) => fetch(...args), now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  const privateFile = path.join(baseDir, '.roas-private', 'naver-search.dpapi');
  const dataDir = path.join(baseDir, '.roas-data', 'naver-search');
  const stateFile = path.join(dataDir, 'state.json');
  let active = false, progress = '', lastRequestAt = 0, memo, memoStamp;
  const readJson = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
  function state() { return readJson(stateFile) || { enabled: true, lastAttemptAt: null, lastSuccessAt: null, error: null }; }
  function setState(values) { atomic(stateFile, JSON.stringify({ ...state(), ...values })); }
  function scope(config) {
    if (!config) return null;
    const value = readJson(path.join(dataDir, config.customerId, 'scope.json'));
    if (value?.customerId !== config.customerId || !Array.isArray(value.campaignIds) || !value.campaignIds.length || value.campaignIds.some(id => typeof id !== 'string' || !/^[\w-]{1,100}$/.test(id))) return null;
    const campaignIds = [...new Set(value.campaignIds)].sort();
    return { campaignIds, key: crypto.createHash('sha256').update(JSON.stringify(campaignIds)).digest('hex') };
  }
  function requireScope(config) {
    const selected = scope(config);
    if (!selected) throw fail(409, '먼저 집계할 위마망 캠페인을 선택하고 저장해 주세요. 전체 계정 자료는 표시하지 않습니다.');
    return selected;
  }
  function read() {
    if (!fs.existsSync(privateFile)) { memo = null; memoStamp = null; return null; }
    const stat = fs.statSync(privateFile), stamp = stat.mtimeMs + ':' + stat.size;
    if (memo && memoStamp === stamp) return memo;
    try {
      const raw = JSON.parse(protect('decrypt', fs.readFileSync(privateFile, 'utf8')));
      memo = { ...credentials(raw), verifiedAt: raw.verifiedAt || null };
      memoStamp = stamp;
      return memo;
    } catch { throw fail(500, '저장된 검색광고 연결을 읽을 수 없습니다. 같은 Windows 사용자로 실행하거나 연결 정보를 다시 등록해 주세요.'); }
  }
  function status() {
    let saved, unreadable = false;
    try { saved = read(); } catch { unreadable = true; }
    const s = state(), selected = scope(saved);
    return { configured: !!saved, unreadable, customerId: saved?.customerId || '', verifiedAt: saved?.verifiedAt || null,
      scopeConfigured: !!selected, scopeCampaignIds: selected?.campaignIds || [], scopeKey: selected?.key || '',
      enabled: s.enabled !== false, intervalMinutes: 60, recentDays: 7, running: active, progress,
      lastSuccessAt: s.lastSuccessAt, lastAttemptAt: s.lastAttemptAt, error: s.error,
      nextAutomaticAt: saved && selected && s.enabled !== false ? new Date(Math.max(now(), Date.parse(s.lastAttemptAt || '') + HOUR || 0)).toISOString() : null };
  }
  async function exclusive(operation) {
    if (active) throw fail(409, '검색광고 작업이 진행 중입니다. 잠시 후 다시 시도해 주세요.');
    active = true;
    try { return await operation(); } finally { active = false; progress = ''; }
  }
  async function get(config, uri, params = {}) {
    // Fixed allowlist: never sign a URL or a method supplied by a browser.
    if (!['/ncc/campaigns', '/stats'].includes(uri)) throw fail(400, '지원하지 않는 검색광고 조회입니다.');
    const url = new URL('https://api.searchad.naver.com' + uri);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    for (let attempt = 0; attempt < 3; attempt++) {
      await sleep(Math.max(0, 300 - (now() - lastRequestAt)));
      lastRequestAt = now();
      const timestamp = String(now());
      let response;
      try {
        response = await fetchImpl(url.toString(), { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(20000), headers: {
          'X-Timestamp': timestamp, 'X-API-KEY': config.apiKey, 'X-Customer': config.customerId,
          'X-Signature': signature(timestamp, uri, config.secretKey), 'Accept': 'application/json' } });
      } catch { throw fail(502, '네이버 검색광고에 연결하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.'); }
      if ((response.status === 429 || response.status >= 500) && attempt < 2) {
        await response.body?.cancel?.();
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      if (!response.ok) {
        if ([401, 403].includes(response.status)) throw fail(400, '검색광고 인증에 실패했습니다. 고객 ID·액세스라이선스·비밀키와 PC 시간을 확인해 주세요.');
        if (response.status === 429) throw fail(429, '네이버 검색광고 호출 한도에 도달했습니다. 저장된 자료는 유지됩니다. 잠시 후 다시 조회해 주세요.');
        throw fail(502, '네이버 검색광고 조회 실패 (HTTP ' + response.status + '). 고객 ID와 해당 상품의 API 지원 범위를 확인해 주세요.');
      }
      try { return await response.json(); } catch { throw fail(502, '네이버 검색광고 응답 형식을 확인할 수 없습니다.'); }
    }
  }
  async function campaigns(config) {
    const rows = await get(config, '/ncc/campaigns');
    if (!Array.isArray(rows) || rows.some(row => !row || typeof row.nccCampaignId !== 'string' || !/^[\w-]{1,100}$/.test(row.nccCampaignId)) || new Set(rows.map(row => row.nccCampaignId)).size !== rows.length) throw fail(502, '검색광고 캠페인 목록 형식을 확인할 수 없습니다.');
    return rows;
  }
  async function save(input) {
    const config = credentials(input);
    if (input.enabled != null && typeof input.enabled !== 'boolean') throw fail(400, '자동 갱신 설정을 확인해 주세요.');
    return exclusive(async () => {
      progress = '연결 확인 중';
      const rows = await campaigns(config);
      config.verifiedAt = new Date(now()).toISOString();
      let ciphertext;
      try { ciphertext = protect('encrypt', JSON.stringify(config)); }
      catch { throw fail(500, 'Windows 사용자 계정 암호화에 실패했습니다. 기존 연결 정보는 유지됩니다.'); }
      atomic(privateFile, ciphertext);
      memo = null; memoStamp = null;
      setState({ enabled: input.enabled !== false, lastAttemptAt: null, lastSuccessAt: null, error: null });
      return { ...status(), campaignCount: rows.length };
    });
  }
  const requireConfig = () => { const config = read(); if (!config) throw fail(400, '먼저 네이버 검색광고를 연결해 주세요.'); return config; };
  const cacheFile = (config, range) => path.join(dataDir, config.customerId, requireScope(config).key, range.since + '_' + range.until + '.json');
  function cached(config, range) {
    const value = readJson(cacheFile(config, range));
    const selected = requireScope(config);
    return value?.schema === 2 && value.scopeKey === selected.key && value.customerId === config.customerId && value.since === range.since && value.until === range.until && Array.isArray(value.campaigns) && value.campaigns.length === selected.campaignIds.length && new Set(value.campaigns.map(row => row.id)).size === selected.campaignIds.length && value.campaigns.every(row => selected.campaignIds.includes(row.id)) && Array.isArray(value.daily) && validDate(value.since) && Number.isFinite(Date.parse(value.fetchedAt)) ? value : null;
  }
  async function collect(config, range) {
    const selected = requireScope(config), all = await campaigns(config), output = [], days = new Map();
    const list = all.filter(row => selected.campaignIds.includes(row.nccCampaignId));
    if (list.length !== selected.campaignIds.length) throw fail(409, '선택한 캠페인 중 일부를 조회할 수 없습니다. 위마망 캠페인 선택을 다시 확인해 주세요.');
    for (const [index, campaign] of list.entries()) {
      progress = (index + 1) + '/' + list.length + ' 캠페인 조회 중';
      const raw = await get(config, '/stats', { id: campaign.nccCampaignId, fields: JSON.stringify(FIELDS), timeRange: JSON.stringify(range), timeIncrement: '1' });
      const data = raw?.dailyStatResponse?.data ?? raw?.data;
      if (!Array.isArray(data)) throw fail(502, '검색광고 일별 성과 응답 형식을 확인할 수 없습니다. 저장된 자료는 유지됩니다.');
      const seen = new Set();
      const normalized = data.map(row => {
        const date = row?.dateStart;
        if (!validDate(date) || date < range.since || date > range.until || (row.dateEnd && row.dateEnd !== date) || seen.has(date)) throw fail(502, '검색광고 일별 날짜를 확인할 수 없습니다. 저장된 자료는 유지됩니다.');
        seen.add(date);
        const item = { date, ...Object.fromEntries(Object.entries(KEYS).map(([key, field]) => [key, metric(row[field])])) };
        if (['spend', 'clicks', 'impressions'].some(key => item[key] === null)) throw fail(502, '검색광고 광고비·클릭·노출 지표가 누락되어 갱신을 완료하지 못했습니다.');
        if (!days.has(date)) days.set(date, []);
        days.get(date).push(item);
        return item;
      });
      output.push({ id: campaign.nccCampaignId, name: String(campaign.name || campaign.nccCampaignId).slice(0, 300), type: String(campaign.campaignTp || ''), status: String(campaign.status || ''), noData: !data.length, ...aggregate(normalized) });
    }
    const daily = Array.from(days, ([date, rows]) => ({ date, complete: rows.length === list.length, campaignsReported: rows.length,
      ...aggregate(rows.length === list.length ? rows : []) })).sort((a, b) => a.date.localeCompare(b.date));
    const warnings = ['광고비는 네이버 API의 부가세 포함 금액입니다. 구매는 검색광고의 광고 기여 기준이며 쇼핑몰 전체 주문매출과 다릅니다.', '선택하여 저장한 위마망 캠페인만 집계합니다. 선택한 캠페인이 조회되지 않으면 집계 범위를 다시 확인해야 합니다.'];
    if (output.some(row => row.purchases === null || row.purchaseRevenue === null)) warnings.push('구매 지표가 없거나 응답되지 않은 캠페인은 미확인으로 표시합니다. 전체 전환을 구매로 대체하지 않습니다.');
    if (output.some(row => row.noData)) warnings.push('일별 성과가 반환되지 않은 캠페인은 미확인으로 표시하며 합계도 확정하지 않습니다.');
    if (daily.some(row => !row.complete)) warnings.push('일부 캠페인의 성과가 반환되지 않은 날짜는 일별 합계를 미확인으로 표시합니다.');
    const result = { schema: 2, scopeKey: selected.key, scopeCampaignIds: selected.campaignIds, customerId: config.customerId, ...range, fetchedAt: new Date(now()).toISOString(), currency: 'KRW', vatIncluded: true, campaigns: output, daily, summary: aggregate(output), warnings, noData: !daily.length };
    // Commit only after every campaign succeeds. Failed refreshes retain the last report.
    atomic(cacheFile(config, range), JSON.stringify(result));
    return result;
  }
  async function report({ since, until, refresh = false, cacheOnly = false }) {
    const range = dateRange(since, until, now()), config = requireConfig(), saved = cached(config, range);
    if (cacheOnly || (!refresh && saved && now() - Date.parse(saved.fetchedAt) < 5 * 60000)) {
      if (!saved) throw fail(404, '이 기간의 저장된 검색광고 성과가 없습니다. 기간 조회를 눌러주세요.');
      return { ...saved, cached: true, stale: now() - Date.parse(saved.fetchedAt) >= 5 * 60000 };
    }
    return exclusive(async () => {
      try {
        if (since === kstDate(now() - 6 * 86400000) && until === kstDate(now())) setState({ lastAttemptAt: new Date(now()).toISOString() });
        const value = await collect(config, range);
        setState({ lastSuccessAt: value.fetchedAt, error: null });
        return { ...value, cached: false, stale: false };
      } catch (error) {
        setState({ error: error.message });
        if (saved) return { ...saved, cached: true, stale: true, refreshError: error.message };
        throw error;
      }
    });
  }
  async function automatic() {
    if (active) return;
    let config; try { config = read(); } catch { return; }
    if (!config || !scope(config)) return;
    const s = state();
    if (s.enabled === false || (s.lastAttemptAt && now() - Date.parse(s.lastAttemptAt) < HOUR)) return;
    return exclusive(async () => {
      setState({ lastAttemptAt: new Date(now()).toISOString() });
      try {
        const value = await collect(config, { since: kstDate(now() - 6 * 86400000), until: kstDate(now()) });
        setState({ lastSuccessAt: value.fetchedAt, error: null });
      } catch (error) { setState({ error: error.message }); }
    });
  }
  return { status, save, report, automatic,
    campaignOptions: () => exclusive(async () => {
      const config = requireConfig(), selected = scope(config);
      return { customerId: config.customerId, campaignIds: selected?.campaignIds || [], campaigns: (await campaigns(config)).map(row => ({ id: row.nccCampaignId, name: String(row.name || row.nccCampaignId).slice(0, 300), type: String(row.campaignTp || ''), status: String(row.status || '') })) };
    }),
    saveScope: input => exclusive(async () => {
      const config = requireConfig(), ids = input?.campaignIds;
      if (!Array.isArray(ids) || !ids.length || ids.length > 500 || ids.some(id => typeof id !== 'string' || !/^[\w-]{1,100}$/.test(id))) throw fail(400, '집계할 위마망 캠페인을 한 개 이상 선택해 주세요.');
      const unique = [...new Set(ids)].sort(), available = new Set((await campaigns(config)).map(row => row.nccCampaignId));
      if (unique.some(id => !available.has(id))) throw fail(400, '현재 계정에서 확인되지 않는 캠페인이 있습니다. 목록을 새로 불러와 주세요.');
      atomic(path.join(dataDir, config.customerId, 'scope.json'), JSON.stringify({ customerId: config.customerId, campaignIds: unique }));
      setState({ lastAttemptAt: null, lastSuccessAt: null, error: null });
      return status();
    }),
    test: () => exclusive(async () => ({ ok: true, campaignCount: (await campaigns(requireConfig())).length })),
    settings: input => {
      if (active) throw fail(409, '검색광고 작업이 진행 중입니다. 잠시 후 다시 시도해 주세요.');
      requireConfig();
      if (typeof input.enabled !== 'boolean') throw fail(400, '자동 갱신 설정을 확인해 주세요.');
      setState({ enabled: input.enabled }); return status();
    },
    remove: () => {
      if (active) throw fail(409, '검색광고 작업이 진행 중입니다. 잠시 후 다시 시도해 주세요.');
      try { fs.unlinkSync(privateFile); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      memo = null; memoStamp = null;
      setState({ enabled: false, error: null }); return status();
    } };
}
module.exports = { createSearchService, signature, credentials, dateRange, aggregate };
