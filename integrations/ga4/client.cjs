'use strict';

// Self-contained so the release builder can embed this module in server.js.
// Credentials are accepted only from a local settings action; never log them.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DATA_URL = 'https://analyticsdata.googleapis.com/v1beta/properties/';
const READ_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';
const MAX_CREDENTIAL_BYTES = 64 * 1024;
const MAX_ROWS = 5000;
const CACHE_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 20;
const METRICS = Object.freeze(['activeUsers', 'sessions', 'engagedSessions', 'engagementRate', 'averageSessionDuration', 'screenPageViews', 'ecommercePurchases', 'purchaseRevenue']);
const ACQUISITION_DIMENSIONS = Object.freeze(['sessionSource', 'sessionMedium', 'sessionCampaignName', 'sessionManualCampaignId', 'sessionManualAdContent', 'sessionManualTerm']);
const ACQUISITION_KEYS = Object.freeze(['source', 'medium', 'campaign', 'campaignId', 'adContent', 'adsetId']);
const DETAIL_DIMENSIONS = Object.freeze(['rp_product_id', 'rp_content_version', 'rp_content_id', 'rp_content_type']);
const DETAIL_DEFAULTS = Object.freeze({ productId: '458', contentVersion: 'v1', measurementId: 'G-RZF6S41CF0', clarityProjectId: '', rootSelector: '#prdDetail', requireConsent: false });
const DETAIL_PAGE_METRICS = Object.freeze(['screenPageViews', 'totalUsers', 'userEngagementDuration', 'eventCount', 'scrolledUsers']);

function detailMediaUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const u = new URL(value, 'https://wemamang.com/');
    if (u.protocol !== 'https:' || u.username || u.password || u.port) return '';
    if (!['wemamang.com','www.wemamang.com','m.wemamang.com','wemamang.mycafe24.com','www.youtube.com','www.youtube-nocookie.com'].includes(u.hostname) && !u.hostname.endsWith('.cafe24img.com')) return '';
    return u.href;
  } catch (_) { return ''; }
}
function parseDetailMedia(html) {
  const decode = value => value.replace(/&(?:amp|quot|apos|lt|gt|#\d+|#x[0-9a-f]+);/gi, token => {
    const entities = { '&amp;':'&','&quot;':'"','&apos;':"'",'&lt;':'<','&gt;':'>' };
    if (entities[token.toLowerCase()]) return entities[token.toLowerCase()];
    const number = token[2].toLowerCase() === 'x' ? parseInt(token.slice(3,-1),16) : Number(token.slice(2,-1));
    return number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : '';
  });
  const attrs = text => {
    const result = {};
    for (const m of text.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) result[m[1].toLowerCase()] = decode(m[2] ?? m[3] ?? m[4]);
    return result;
  };
  const source = String(html).replace(/<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '');
  let depth = 0, found = false, video = null;
  const counts = { img:0, video:0, iframe:0 }, items = [];
  for (const match of source.matchAll(/<\/?[a-z][^>]*>/gi)) {
    const token = match[0], closing = /^<\//.test(token), tag = (token.match(/^<\/?([\w-]+)/) || [,''])[1].toLowerCase();
    const a = attrs(token);
    if (!depth) { if (!found && !closing && a.id === 'prdDetail') { depth = 1; found = true; } continue; }
    if (tag === 'div') { depth += closing ? -1 : 1; if (!depth) break; }
    if (closing) { if (tag === 'video') video = null; continue; }
    if (tag === 'source' && video && !video.url) video.url = detailMediaUrl(a.src || '');
    if (!Object.hasOwn(counts, tag)) continue;
    const index = ++counts[tag], type = { img:'image',video:'video',iframe:'embed' }[tag];
    const item = { id:type + '_' + String(index).padStart(3,'0'), type, url:detailMediaUrl(a['ec-data-src'] || a['data-src'] || a.src || ''), poster:detailMediaUrl(a.poster || ''), alt:(a.alt || '').slice(0,150), name:'' };
    items.push(item); if (tag === 'video') video = item;
    if (items.length > 500) throw failure(400, '상세 콘텐츠가 너무 많습니다.', 'DETAIL_CATALOG_SIZE');
  }
  if (!found || !items.length) throw failure(422, '상세영역(#prdDetail)의 이미지·영상을 찾지 못했습니다.', 'DETAIL_CATALOG_EMPTY');
  for (const item of items) { try { item.filename = decodeURIComponent(new URL(item.url).pathname.split('/').pop()).slice(0,200); } catch (_) { item.filename = ''; } }
  return items;
}

function validateDetailSettings(input = {}) {
  const value = { productId: String(input.productId || ''), contentVersion: String(input.contentVersion || '').trim(),
    measurementId: String(input.measurementId || '').trim(), clarityProjectId: String(input.clarityProjectId || '').trim(), rootSelector: '#prdDetail', requireConsent: input.requireConsent === true };
  if (!/^[1-9]\d{0,10}$/.test(value.productId) || !/^[A-Za-z0-9_-]{1,32}$/.test(value.contentVersion) ||
      !/^G-[A-Z0-9]{4,20}$/.test(value.measurementId) || (value.clarityProjectId && !/^[a-z0-9]{4,32}$/.test(value.clarityProjectId))) {
    throw failure(400, '상품번호, 상세페이지 버전, G-로 시작하는 측정 ID와 Clarity 프로젝트 ID 형식을 확인해 주세요.', 'DETAIL_SETTINGS');
  }
  return value;
}
function buildDetailRequest(input, withTime = true) {
  validateDates(input.since, input.until);
  const config = validateDetailSettings(input);
  const expressions = [
    { filter: { fieldName: 'customEvent:rp_product_id', stringFilter: { matchType: 'EXACT', value: config.productId } } },
    { filter: { fieldName: 'customEvent:rp_content_version', stringFilter: { matchType: 'EXACT', value: config.contentVersion } } },
    { filter: { fieldName: 'eventName', inListFilter: { values: ['rp_detail_view','rp_content_view','rp_content_time','rp_video_start','rp_video_25','rp_video_50','rp_video_75','rp_video_100','rp_scroll','rp_buy_click','rp_cart_click'] } } }
  ];
  if (input.scope === 'meta') expressions.push(metaFilter());
  else if (input.scope && input.scope !== 'all') throw failure(400, '유입 범위를 확인해 주세요.', 'GA4_SCOPE');
  return { dateRanges: [{ startDate: input.since, endDate: input.until }],
    dimensions: ['eventName','customEvent:rp_content_id','customEvent:rp_content_type'].map(name => ({ name })),
    metrics: ['eventCount', ...(withTime ? ['customEvent:rp_visible_ms'] : [])].map(name => ({ name })),
    dimensionFilter: { andGroup: { expressions } }, limit: String(MAX_ROWS), returnPropertyQuota: true };
}
function buildDetailPageRequests(input) {
  validateDates(input.since, input.until);
  const config = validateDetailSettings(input);
  // Match the selected product on the Wemamang store, including mobile, query
  // parameters in any order, and Cafe24's /product/name/number/ URLs.
  const location = '^https?://(?:(?:www|m)\\.)?wemamang\\.com/(?:product/[^?#]*\\?(?:[^#]*&)?product_no=' + config.productId +
    '(?:[&#].*)?|product/[^/?#]+/' + config.productId + '(?:[/#?].*)?)$';
  const expressions = [{ filter: { fieldName: 'pageLocation', stringFilter: { matchType: 'FULL_REGEXP', value: location, caseSensitive: false } } }];
  if (input.scope === 'meta') expressions.push(metaFilter());
  else if (input.scope && input.scope !== 'all') throw failure(400, '유입 범위를 확인해 주세요.', 'GA4_SCOPE');
  const common = { dateRanges: [{ startDate: input.since, endDate: input.until }], dimensionFilter: { andGroup: { expressions } }, returnPropertyQuota: true };
  return {
    summary: { ...common, metrics: DETAIL_PAGE_METRICS.map(name => ({ name })) },
    daily: { ...common, dimensions: [{ name: 'date' }], metrics: DETAIL_PAGE_METRICS.map(name => ({ name })), limit: '93', orderBys: [{ dimension: { dimensionName: 'date' } }] },
    events: { ...common, dimensions: [{ name: 'eventName' }], metrics: [{ name: 'eventCount' }], limit: String(MAX_ROWS), orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }] }
  };
}
function assembleDetailPageReport(responses, context) {
  const warnings = [], metadata = {};
  for (const name of ['summary', 'daily', 'events']) metadata[name] = reportMetadata(responses[name], warnings, '상세페이지 기본 데이터');
  const summaryRows = responseRows(responses.summary);
  if (summaryRows.length > 1) throw failure(502, '상세페이지 요약 집계 응답을 확인할 수 없습니다.', 'DETAIL_PAGE_SUMMARY');
  const values = row => ({ ...row, averageEngagementSeconds: row.screenPageViews > 0 && row.userEngagementDuration !== null ? row.userEngagementDuration / row.screenPageViews : null });
  const summary = values(metricValues(responses.summary, summaryRows[0], DETAIL_PAGE_METRICS, warnings, '상세페이지 기본 데이터'));
  const dates = new Map(responseRows(responses.daily).map(row => {
    const date = dimensionValue(responses.daily, row, 'date').replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');
    return [date, values({ date, ...metricValues(responses.daily, row, DETAIL_PAGE_METRICS, warnings, '상세페이지 일별 데이터') })];
  }));
  const daily = [];
  for (let time = Date.parse(context.since + 'T00:00:00Z'); time <= Date.parse(context.until + 'T00:00:00Z'); time += 86400000) {
    const date = new Date(time).toISOString().slice(0, 10);
    daily.push(dates.get(date) || values({ date, ...metricValues(responses.daily, null, DETAIL_PAGE_METRICS, warnings, '상세페이지 일별 데이터') }));
  }
  const events = responseRows(responses.events).map(row => ({ name: dimensionValue(responses.events, row, 'eventName'),
    count: metricValues(responses.events, row, ['eventCount'], warnings, '상세페이지 이벤트').eventCount }));
  if (reportedRowCount(responses.events, events.length) > events.length) warnings.push('이벤트 종류가 많아 일부 행이 생략되었습니다. 기간을 줄여 조회하세요.');
  warnings.push('기본 데이터는 선택 상품의 실제 상세 URL에서 발생한 GA4 기록입니다. 상세 버전과 관계없이 집계하며, 기간 방문자는 중복을 제거하므로 일별 방문자 합계와 다를 수 있습니다.');
  return { state: summary.screenPageViews > 0 || summary.totalUsers > 0 || summary.eventCount > 0 ? 'ready' : summary.screenPageViews === null ? 'unavailable' : 'no_data',
    summary, daily, events, metadata, warnings: [...new Set(warnings)] };
}
function assembleDetailReport(response, context, withTime) {
  const warnings = [], content = new Map(), scroll = {};
  const emptyCount = metricValues(response, null, ['eventCount'], warnings, '상세페이지').eventCount;
  let views = emptyCount, buyClicks = emptyCount, cartClicks = emptyCount;
  const read = (row, name) => metricValues(response, row, [name], warnings, '상세페이지')[name];
  for (const row of responseRows(response)) {
    const event = dimensionValue(response, row, 'eventName'), id = dimensionValue(response, row, 'customEvent:rp_content_id'), type = dimensionValue(response, row, 'customEvent:rp_content_type');
    const count = read(row, 'eventCount');
    if (event === 'rp_detail_view') { views = count; continue; }
    if (event === 'rp_buy_click') { buyClicks = count; continue; }
    if (event === 'rp_cart_click') { cartClicks = count; continue; }
    if (event === 'rp_scroll') { scroll[id] = count; continue; }
    if (!['image','video','embed'].includes(type) || !/^(image_\d+_p\d+|video_\d+|embed_\d+)$/.test(id)) continue;
    if (!content.has(id)) content.set(id, { id, type, views: emptyCount, visibleMs: withTime && !restrictions(response).has('customEvent:rp_visible_ms') ? 0 : null, starts: emptyCount, video25: emptyCount, video50: emptyCount, video75: emptyCount, video100: emptyCount });
    const item = content.get(id);
    if (event === 'rp_content_view') item.views = count;
    if (event === 'rp_content_time' && withTime) item.visibleMs = read(row, 'customEvent:rp_visible_ms');
    const key = { rp_video_start: 'starts', rp_video_25: 'video25', rp_video_50: 'video50', rp_video_75: 'video75', rp_video_100: 'video100' }[event];
    if (key) item[key] = count;
  }
  const rows = [...content.values()].sort((a,b) => a.id.localeCompare(b.id, 'en', { numeric: true })).map(item => ({ ...item,
    reachRate: views > 0 && item.views !== null ? item.views / views : null,
    averageVisibleSeconds: item.views > 0 && item.visibleMs !== null ? item.visibleMs / item.views / 1000 : null,
    completionRate: item.starts > 0 && item.video100 !== null ? item.video100 / item.starts : null }));
  const meta = reportMetadata(response, warnings, '상세페이지');
  if (Number(response.rowCount) > (response.rows || []).length) warnings.push('GA4 응답이 5,000행을 초과해 일부 구간이 생략되었습니다. 기간을 줄여 조회하세요.');
  if (!withTime) warnings.push('rp_visible_ms 맞춤 측정항목을 등록하면 체류시간이 표시됩니다.');
  if (rows.some(item => item.reachRate > 1)) warnings.push('일부 구간 도달률이 100%를 넘습니다. 중복 설치 또는 최근 GA4 처리 상태를 확인하세요.');
  warnings.push('최근 데이터와 맞춤 정의는 반영에 24~48시간이 걸릴 수 있습니다. 구매·장바구니 수치는 버튼 클릭 의향이며 결제 완료 건수가 아닙니다.');
  return { ...context, state: rows.length || views > 0 ? 'ready' : views === null ? 'unavailable' : 'no_data', views, buyClicks, cartClicks, rows, scroll,
    metadata: meta, warnings: [...new Set(warnings)], cached: false };
}

function failure(status, message, code = 'GA4_ERROR') {
  return Object.assign(new Error(message), { status, code });
}
function safeProtectionError(error) {
  return failure(error && error.status === 501 ? 501 : 500,
    'Windows 사용자 계정 암호화가 필요합니다. 같은 Windows 사용자로 ROAS Pilot을 실행해 주세요.', 'GA4_ENCRYPTION_REQUIRED');
}
function propertyId(value) {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw failure(400, 'GA4 속성 ID는 숫자로 된 문자열을 입력해 주세요.', 'GA4_PROPERTY_ID');
  const result = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
  if (!/^[1-9]\d{0,19}$/.test(result)) throw failure(400, 'G-로 시작하는 측정 ID가 아닌 숫자형 GA4 속성 ID를 입력해 주세요.', 'GA4_PROPERTY_ID');
  return result;
}
function validateDates(since, until) {
  const valid = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number(value.slice(0, 4)) > 0 &&
    Number.isFinite(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
  if (!valid(since) || !valid(until) || since > until) throw failure(400, '조회 시작일과 종료일을 올바른 YYYY-MM-DD 날짜로 입력해 주세요.', 'GA4_DATES');
  const days = (Date.parse(until + 'T00:00:00Z') - Date.parse(since + 'T00:00:00Z')) / 86400000 + 1;
  if (days > 93) throw failure(400, 'GA4 조회 기간은 한 번에 최대 93일입니다.', 'GA4_DATE_RANGE');
  return { since, until };
}
function validateCredentials(input) {
  let serialized, value;
  try {
    serialized = typeof input === 'string' ? input : JSON.stringify(input);
    if (typeof serialized !== 'string') throw new Error('shape');
    if (Buffer.byteLength(serialized, 'utf8') > MAX_CREDENTIAL_BYTES) throw failure(413, '서비스 계정 JSON 파일은 64KiB 이하여야 합니다.', 'GA4_CREDENTIAL_SIZE');
    value = JSON.parse(serialized);
  } catch (error) {
    if (error && error.code === 'GA4_CREDENTIAL_SIZE') throw error;
    throw failure(400, '유효한 서비스 계정 JSON 파일을 선택해 주세요.', 'GA4_CREDENTIAL_JSON');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.type !== 'service_account' ||
      typeof value.client_email !== 'string' || value.client_email.length > 320 || !/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.gserviceaccount\.com$/.test(value.client_email) ||
      typeof value.private_key !== 'string' || value.private_key.length > 32768) {
    throw failure(400, '서비스 계정 유형, 이메일과 RSA 비공개 키가 포함된 JSON 파일이 필요합니다.', 'GA4_CREDENTIAL_SCHEMA');
  }
  let key;
  try {
    key = crypto.createPrivateKey({ key: value.private_key, format: 'pem' });
    if (key.asymmetricKeyType !== 'rsa' || (key.asymmetricKeyDetails && key.asymmetricKeyDetails.modulusLength < 2048)) throw new Error('RSA');
  } catch (_) {
    throw failure(400, '서비스 계정의 유효한 RSA 비공개 키를 확인해 주세요.', 'GA4_CREDENTIAL_KEY');
  }
  const projectId = value.project_id == null ? '' : value.project_id;
  if (typeof projectId !== 'string' || projectId.length > 128 || (projectId && !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(projectId))) {
    throw failure(400, '서비스 계정의 프로젝트 ID 형식을 확인해 주세요.', 'GA4_CREDENTIAL_PROJECT');
  }
  // Do not trust token_uri or any other URL in an uploaded key file.
  return { type: 'service_account', client_email: value.client_email, project_id: projectId,
    private_key: key.export({ format: 'pem', type: 'pkcs8' }).toString() };
}
function credentialIdentity(credentials) {
  return crypto.createHash('sha256').update(credentials.client_email + '\n' + credentials.private_key).digest('hex');
}
function configurationIdentity(config) {
  return config.propertyId + ':' + credentialIdentity(config.credentials);
}
function jwtAssertion(credentials, milliseconds) {
  const timestamp = Math.floor(milliseconds / 1000);
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = encode({ alg: 'RS256', typ: 'JWT' }) + '.' + encode({ iss: credentials.client_email, scope: READ_SCOPE,
    aud: TOKEN_URL, iat: timestamp, exp: timestamp + 3600 });
  try {
    return unsigned + '.' + crypto.sign('RSA-SHA256', Buffer.from(unsigned), credentials.private_key).toString('base64url');
  } catch (_) {
    throw failure(400, '서비스 계정 키로 인증 요청을 만들 수 없습니다. 키 파일을 다시 확인해 주세요.', 'GA4_SIGNING');
  }
}
function metaFilter() {
  return { andGroup: { expressions: [
    { filter: { fieldName: 'sessionSource', inListFilter: { values: ['fb', 'ig', 'an', 'msg', 'facebook', 'instagram'], caseSensitive: false } } },
    { filter: { fieldName: 'sessionMedium', inListFilter: { values: ['paid_social', 'paid social', 'paid-social', 'cpc', 'ppc', 'paid'], caseSensitive: false } } }
  ] } };
}
function buildReportRequests(since, until, scope) {
  validateDates(since, until);
  if (!['all', 'meta'].includes(scope)) throw failure(400, 'GA4 조회 범위를 확인해 주세요.', 'GA4_SCOPE');
  const common = { dateRanges: [{ startDate: since, endDate: until }], metrics: METRICS.map(name => ({ name })), returnPropertyQuota: true };
  if (scope === 'meta') common.dimensionFilter = metaFilter();
  return {
    summary: { ...common },
    acquisition: { ...common, dimensions: ACQUISITION_DIMENSIONS.map(name => ({ name })), limit: String(MAX_ROWS), orderBys: [{ metric: { metricName: 'sessions' }, desc: true }] },
    landingPages: { ...common, dimensions: [{ name: 'landingPagePlusQueryString' }], limit: String(MAX_ROWS), orderBys: [{ metric: { metricName: 'sessions' }, desc: true }] },
    purchase: { dateRanges: [{ startDate: since, endDate: until }], dimensions: [{ name: 'eventName' }], metrics: [{ name: 'eventCount' }],
      dimensionFilter: { filter: { fieldName: 'eventName', stringFilter: { matchType: 'EXACT', value: 'purchase', caseSensitive: true } } }, limit: '1', returnPropertyQuota: true }
  };
}
function responseRows(response) {
  if (!response || typeof response !== 'object' || Array.isArray(response) || (response.rows != null && !Array.isArray(response.rows))) {
    throw failure(502, 'Google Analytics 응답 형식을 확인할 수 없습니다. 잠시 후 다시 조회해 주세요.', 'GA4_RESPONSE');
  }
  return response.rows || [];
}
function validateReportResponse(response, requestBody) {
  const rows = responseRows(response);
  if (Object.prototype.hasOwnProperty.call(response, 'error')) {
    throw failure(502, 'GA4 보고서의 요청 지표와 응답 항목이 일치하지 않습니다. 잠시 후 다시 조회해 주세요.', 'GA4_RESPONSE_SCHEMA');
  }
  const requestedMetrics = requestBody.metrics.map(metric => metric.name);
  const requestedDimensions = (requestBody.dimensions || []).map(dimension => dimension.name);
  let normalized = response;
  if (!rows.length) {
    const metricHeadersMissing = response.metricHeaders == null || (Array.isArray(response.metricHeaders) && response.metricHeaders.length === 0);
    const dimensionHeadersMissing = response.dimensionHeaders == null || (Array.isArray(response.dimensionHeaders) && response.dimensionHeaders.length === 0);
    if (metricHeadersMissing || (requestedDimensions.length && dimensionHeadersMissing)) {
      normalized = { ...response, rows: [],
        metricHeaders: metricHeadersMissing ? requestedMetrics.map(name => ({ name })) : response.metricHeaders,
        dimensionHeaders: requestedDimensions.length && dimensionHeadersMissing ? requestedDimensions.map(name => ({ name })) : (response.dimensionHeaders || []) };
    }
  }
  if (!Array.isArray(normalized.metricHeaders) || !normalized.metricHeaders.length ||
      (requestedDimensions.length && !Array.isArray(normalized.dimensionHeaders))) {
    throw failure(502, 'Google Analytics 응답 형식을 확인할 수 없습니다. 잠시 후 다시 조회해 주세요.', 'GA4_RESPONSE');
  }
  const metrics = new Set(normalized.metricHeaders.map(header => header && header.name));
  const dimensions = new Set((Array.isArray(normalized.dimensionHeaders) ? normalized.dimensionHeaders : []).map(header => header && header.name));
  if (requestBody.metrics.some(metric => !metrics.has(metric.name)) ||
      requestedDimensions.some(name => !dimensions.has(name)) ||
      rows.some(row => !row || !Array.isArray(row.metricValues) || row.metricValues.length < normalized.metricHeaders.length ||
        (requestedDimensions.length > 0 && (!Array.isArray(row.dimensionValues) || row.dimensionValues.length < normalized.dimensionHeaders.length)))) {
    throw failure(502, 'GA4 보고서의 요청 지표와 응답 항목이 일치하지 않습니다. 잠시 후 다시 조회해 주세요.', 'GA4_RESPONSE_SCHEMA');
  }
  return normalized;
}
function unavailableEmpty(response) {
  const metadata = response.metadata || {};
  return !!(typeof metadata.emptyReason === 'string' && metadata.emptyReason.trim()) || !!metadata.subjectToThresholding ||
    (Array.isArray(metadata.dataTruncationReasons) && metadata.dataTruncationReasons.length > 0);
}
function restrictions(response) {
  const entries = response.metadata && response.metadata.schemaRestrictionResponse && response.metadata.schemaRestrictionResponse.activeMetricRestrictions;
  return new Set((Array.isArray(entries) ? entries : []).map(entry => entry && entry.metricName).filter(name => typeof name === 'string'));
}
function metricValues(response, row, names, warnings, label) {
  const restricted = restrictions(response);
  const headers = Array.isArray(response.metricHeaders) ? response.metricHeaders : [];
  const values = row && Array.isArray(row.metricValues) ? row.metricValues : [];
  const result = {};
  for (const name of names) {
    if (restricted.has(name)) { result[name] = null; continue; }
    if (!row) { result[name] = unavailableEmpty(response) ? null : 0; continue; }
    const index = headers.findIndex(header => header && header.name === name);
    const raw = index >= 0 && values[index] ? values[index].value : undefined;
    const number = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : typeof raw === 'number' ? raw : NaN;
    result[name] = Number.isFinite(number) ? number : null;
    if (result[name] === null) warnings.push(label + ': 일부 지표 값을 확인할 수 없어 빈 값으로 표시했습니다.');
  }
  return result;
}
function dimensionValue(response, row, name) {
  const headers = Array.isArray(response.dimensionHeaders) ? response.dimensionHeaders : [];
  const index = headers.findIndex(header => header && header.name === name);
  const value = index >= 0 && row && Array.isArray(row.dimensionValues) && row.dimensionValues[index] ? row.dimensionValues[index].value : undefined;
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}
function reportMetadata(response, warnings, label) {
  const metadata = response.metadata && typeof response.metadata === 'object' && !Array.isArray(response.metadata) ? structuredClone(response.metadata) : {};
  if (response.propertyQuota && typeof response.propertyQuota === 'object') metadata.propertyQuota = structuredClone(response.propertyQuota);
  if (metadata.subjectToThresholding) warnings.push(label + ': 개인정보 보호를 위한 데이터 기준점이 적용될 수 있습니다.');
  if (Array.isArray(metadata.samplingMetadatas) && metadata.samplingMetadatas.length) {
    const proportions = metadata.samplingMetadatas.slice(0, 3).map(sample => {
      const read = Number(sample.samplesReadCount), space = Number(sample.samplingSpaceSize);
      return Number.isFinite(read) && read >= 0 && Number.isFinite(space) && space > 0 ? '표본 ' + read + ' / 전체 ' + space + ', 약 ' + (read / space * 100).toFixed(1) + '%' : '';
    }).filter(Boolean);
    warnings.push(label + ': 표본 추출된 보고서입니다' + (proportions.length ? ' (' + proportions.join('; ') + ')' : '') + '.');
  }
  if (metadata.dataLossFromOtherRow) warnings.push(label + ': 일부 상세 항목이 (other) 행으로 합쳐졌을 수 있습니다.');
  if (restrictions(response).size) warnings.push(label + ': 접근이 제한된 지표는 0이 아닌 빈 값으로 표시했습니다.');
  const cleanReason = value => String(value).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0,300);
  if (typeof metadata.emptyReason === 'string' && metadata.emptyReason.trim()) warnings.push(label + ': 빈 보고서 사유: ' + cleanReason(metadata.emptyReason) + '. 확인되지 않은 요약 값은 빈 값으로 표시합니다.');
  if (Array.isArray(metadata.dataTruncationReasons) && metadata.dataTruncationReasons.length) {
    const reasons = metadata.dataTruncationReasons.slice(0,5).map(reason => {
      if (typeof reason === 'string') return cleanReason(reason);
      if (!reason || typeof reason !== 'object') return '';
      const detail = typeof reason.dataTruncationMessage === 'string' ? reason.dataTruncationMessage :
        typeof reason.dataTruncationType === 'string' ? reason.dataTruncationType : '일부 기간의 데이터가 제외되었습니다.';
      const dates = [];
      if (typeof reason.dataTruncationDate === 'string') dates.push(cleanReason(reason.dataTruncationDate) + ' 이전');
      if (Array.isArray(reason.dataTruncationDateRanges)) for (const range of reason.dataTruncationDateRanges.slice(0,3)) {
        if (range && typeof range.startDate === 'string' && typeof range.endDate === 'string') dates.push(cleanReason(range.startDate) + '~' + cleanReason(range.endDate));
      }
      return cleanReason(detail) + (dates.length ? ' (' + dates.join(', ') + ')' : '');
    }).filter(Boolean);
    warnings.push(label + ': 데이터 일부가 제외되었습니다.' + (reasons.length ? ' ' + reasons.join('; ') : ''));
  }
  return metadata;
}
function reportedRowCount(response, returned) {
  const count = Number(response.rowCount);
  return Number.isSafeInteger(count) && count >= returned ? count : returned;
}
function assembleReport(responses, context) {
  const warnings = [];
  const summaryRows = responseRows(responses.summary);
  if (summaryRows.length > 1) throw failure(502, 'GA4 요약 집계 응답을 확인할 수 없습니다.', 'GA4_SUMMARY_SHAPE');
  const acquisitionRows = responseRows(responses.acquisition);
  const landingRows = responseRows(responses.landingPages);
  const purchaseRows = responseRows(responses.purchase);
  const summary = metricValues(responses.summary, summaryRows[0], METRICS, warnings, '전체 요약');
  const acquisition = acquisitionRows.slice(0, MAX_ROWS).map(row => ({ ...Object.fromEntries(ACQUISITION_DIMENSIONS.map((name, i) => [ACQUISITION_KEYS[i], dimensionValue(responses.acquisition, row, name)])),
    ...metricValues(responses.acquisition, row, METRICS, warnings, '유입 분석') }));
  const landingPages = landingRows.slice(0, MAX_ROWS).map(row => ({ landingPage: dimensionValue(responses.landingPages, row, 'landingPagePlusQueryString'),
    ...metricValues(responses.landingPages, row, METRICS, warnings, '랜딩 페이지') }));
  const counts = purchaseRows.map(row => metricValues(responses.purchase, row, ['eventCount'], warnings, '구매 이벤트').eventCount);
  const eventCount = restrictions(responses.purchase).has('eventCount') || (!purchaseRows.length && unavailableEmpty(responses.purchase)) || counts.some(value => value === null) ? null : counts.reduce((a, b) => a + b, 0);
  const metadata = {};
  for (const [name, label] of [['summary', '전체 요약'], ['acquisition', '유입 분석'], ['landingPages', '랜딩 페이지'], ['purchase', '구매 이벤트']]) metadata[name] = reportMetadata(responses[name], warnings, label);
  const rowCounts = { acquisition: reportedRowCount(responses.acquisition, acquisitionRows.length), landingPages: reportedRowCount(responses.landingPages, landingRows.length) };
  const truncated = { acquisition: rowCounts.acquisition > acquisition.length, landingPages: rowCounts.landingPages > landingPages.length };
  if (truncated.acquisition) warnings.push('유입 분석: 전체 ' + rowCounts.acquisition + '행 중 세션 수 상위 ' + acquisition.length + '행만 표시합니다.');
  if (truncated.landingPages) warnings.push('랜딩 페이지: 전체 ' + rowCounts.landingPages + '행 중 세션 수 상위 ' + landingPages.length + '행만 표시합니다.');
  if (eventCount === null || eventCount === 0) warnings.push('선택 기간에 purchase 이벤트 수신을 확인하지 못했습니다. 태그 설치 시점과 구매 이벤트 설정을 확인해 주세요.');
  if (context.scope === 'meta') warnings.push('Meta 유입은 세션 소스·매체가 지정된 값과 일치한 방문입니다. 구매 이벤트 수신 확인은 속성 전체 기준이며 Meta 광고 귀속 구매수와 다릅니다.');
  return { ...context, cached: false, timeZone: typeof metadata.summary.timeZone === 'string' ? metadata.summary.timeZone : null,
    currencyCode: typeof metadata.summary.currencyCode === 'string' ? metadata.summary.currencyCode : null,
    summary, acquisition, landingPages, purchaseTracking: { state: eventCount > 0 ? 'observed' : 'unverified', eventCount, scope: 'property', since: context.since, until: context.until },
    metadata, warnings: [...new Set(warnings)], rowCounts, truncated };
}

function createGa4Service({ baseDir, protect, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  // Constructor is deliberately lazy: Linux tests and existing installations can load the app without DPAPI.
  const filename = path.join(path.resolve(baseDir || process.cwd()), '.roas-private', 'ga4.dpapi');
  const detailFilename = path.join(path.resolve(baseDir || process.cwd()), '.roas-private', 'detail-settings.json');
  const catalogFilename = path.join(path.dirname(detailFilename), 'detail-catalog.json');
  const tokens = new Map(), reports = new Map(), inFlight = new Map();
  let stored = null, saveSequence = 0;
  const currentTime = () => { const value = Number(now()); if (!Number.isFinite(value)) throw failure(500, '현재 시간을 확인할 수 없습니다.', 'GA4_CLOCK'); return value; };
  const timestamp = () => new Date(currentTime()).toISOString();
  const digest = value => value == null ? null : crypto.createHash('sha256').update(value).digest('hex');
  function clearTransient() { tokens.clear(); reports.clear(); inFlight.clear(); }
  function encryptedFile() {
    try {
      const value = fs.readFileSync(filename, 'utf8');
      if (!value || Buffer.byteLength(value, 'utf8') > 256 * 1024) throw new Error('size');
      return value;
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw failure(503, '저장된 GA4 연결 설정을 읽을 수 없습니다.', 'GA4_CONFIG_READ');
    }
  }
  function encrypted(config) {
    if (typeof protect !== 'function') throw safeProtectionError({ status: 501 });
    const plaintext = JSON.stringify(config);
    try {
      const result = protect('encrypt', plaintext);
      if (typeof result !== 'string' || !result.trim() || result === plaintext || result.includes('PRIVATE KEY') || result.includes('"private_key"')) throw new Error('unsafe');
      return result.trim();
    } catch (error) { throw safeProtectionError(error); }
  }
  function readConfig() {
    const raw = encryptedFile();
    if (raw === null) { if (stored) clearTransient(); stored = null; return null; }
    const hash = digest(raw);
    if (stored && stored.hash === hash) return stored.config;
    if (typeof protect !== 'function') throw safeProtectionError({ status: 501 });
    let config;
    try {
      const text = protect('decrypt', raw);
      if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > 128 * 1024) throw new Error('shape');
      const parsed = JSON.parse(text);
      if (!parsed || parsed.schemaVersion !== 1 || typeof parsed.savedAt !== 'string' || typeof parsed.verifiedAt !== 'string' || !Number.isFinite(Date.parse(parsed.savedAt)) || !Number.isFinite(Date.parse(parsed.verifiedAt))) throw new Error('schema');
      config = { schemaVersion: 1, propertyId: propertyId(parsed.propertyId), credentials: validateCredentials(parsed.credentials), savedAt: parsed.savedAt, verifiedAt: parsed.verifiedAt };
    } catch (error) {
      if (error && error.status === 501) throw safeProtectionError(error);
      throw failure(503, '저장된 GA4 연결을 해독할 수 없습니다. 같은 Windows 사용자로 실행하거나 키 파일을 다시 연결해 주세요.', 'GA4_CONFIG_DECRYPT');
    }
    if (!stored || configurationIdentity(stored.config) !== configurationIdentity(config)) clearTransient();
    stored = { hash, config };
    return config;
  }
  function safeStatus(config) {
    return { configured: !!config, propertyId: config ? config.propertyId : '', clientEmail: config ? config.credentials.client_email : '',
      projectId: config ? config.credentials.project_id : '', savedAt: config ? config.savedAt : null, verifiedAt: config ? config.verifiedAt : null, security: 'Windows DPAPI' };
  }
  function requireConfig() {
    const config = readConfig();
    if (!config) throw failure(400, '먼저 GA4 속성 ID와 서비스 계정 JSON 파일을 연결해 주세요.', 'GA4_NOT_CONFIGURED');
    return config;
  }
  function atomicWrite(ciphertext) {
    const temporary = filename + '.tmp-' + crypto.randomBytes(8).toString('hex');
    let handle;
    try {
      fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
      handle = fs.openSync(temporary, 'wx', 0o600);
      fs.writeFileSync(handle, ciphertext, 'utf8');
      fs.fsyncSync(handle); fs.closeSync(handle); handle = undefined;
      fs.renameSync(temporary, filename);
    } catch (_) {
      throw failure(500, 'GA4 연결 설정을 저장하지 못했습니다. 기존 연결은 유지됩니다.', 'GA4_CONFIG_WRITE');
    } finally {
      if (handle !== undefined) { try { fs.closeSync(handle); } catch (_) {} }
      try { fs.unlinkSync(temporary); } catch (_) {}
    }
  }
  async function request(url, options, label) {
    if (typeof fetchImpl !== 'function') throw failure(501, '현재 실행 환경에서 Google API에 연결할 수 없습니다.', 'GA4_FETCH_UNAVAILABLE');
    try {
      const response = await fetchImpl(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(20000) });
      if (!response || response.redirected || (response.status >= 300 && response.status < 400)) throw failure(502, 'Google API의 예상하지 못한 이동 응답을 거부했습니다.', 'GA4_REDIRECT');
      return response;
    } catch (error) {
      if (error && error.code === 'GA4_REDIRECT') throw error;
      const timeout = error && ['TimeoutError', 'AbortError'].includes(error.name);
      throw failure(timeout ? 504 : 502, label + (timeout ? ' 요청 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.' : ' 서버에 연결하지 못했습니다. 연결 상태를 확인해 주세요.'), timeout ? 'GA4_TIMEOUT' : 'GA4_NETWORK');
    }
  }
  async function jsonResponse(response) {
    try { return await response.json(); }
    catch (_) { throw failure(502, 'Google API 응답을 읽을 수 없습니다. 잠시 후 다시 시도해 주세요.', 'GA4_RESPONSE_JSON'); }
  }
  async function accessToken(credentials, rejectedToken) {
    const identity = credentialIdentity(credentials);
    let entry = tokens.get(identity);
    if (entry && rejectedToken && entry.token === rejectedToken) { entry.token = null; entry.expiresAt = 0; }
    if (entry && entry.pending) return entry.pending;
    if (entry && entry.token && entry.expiresAt > currentTime() + 60000) return entry.token;
    if (!entry) { entry = {}; tokens.set(identity, entry); }
    while (tokens.size > 4) tokens.delete(tokens.keys().next().value);
    const pending = (async () => {
      const assertion = jwtAssertion(credentials, currentTime());
      const response = await request(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString() }, 'Google 인증');
      if (!response.ok) throw failure(response.status === 429 ? 429 : 401, response.status === 429 ? 'Google 인증 요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.' : 'Google 서비스 계정 인증에 실패했습니다. 키의 유효성과 시스템 시간을 확인해 주세요.', 'GA4_AUTH_FAILED');
      const body = await jsonResponse(response);
      if (!body || typeof body.access_token !== 'string' || !body.access_token || body.access_token.length > 16384 || (body.token_type && String(body.token_type).toLowerCase() !== 'bearer')) throw failure(502, 'Google 인증 응답을 확인할 수 없습니다.', 'GA4_AUTH_RESPONSE');
      const lifetime = Number(body.expires_in);
      if (!Number.isFinite(lifetime) || lifetime <= 0) throw failure(502, 'Google 인증 만료 시간을 확인할 수 없습니다.', 'GA4_AUTH_RESPONSE');
      entry.token = body.access_token; entry.expiresAt = currentTime() + Math.min(lifetime, 3600) * 1000;
      return entry.token;
    })();
    entry.pending = pending;
    try { return await pending; }
    finally { if (entry.pending === pending) entry.pending = null; }
  }
  async function runReport(config, body) {
    let token = await accessToken(config.credentials);
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await request(DATA_URL + config.propertyId + ':runReport', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, 'GA4 조회');
      if (response.status === 401 && attempt === 0) { token = await accessToken(config.credentials, token); continue; }
      if (!response.ok) {
        const messages = { 400: 'GA4 조회 요청을 처리할 수 없습니다. 속성 ID와 조회 조건을 확인해 주세요.',
          401: 'GA4 인증이 거부되었습니다. 서비스 계정 키를 다시 연결해 주세요.',
          403: 'GA4 속성의 서비스 계정 접근 권한과 Google Analytics Data API 활성화 상태를 확인해 주세요.',
          404: 'GA4 속성을 찾을 수 없습니다. 숫자형 속성 ID와 접근 권한을 확인해 주세요.',
          429: 'GA4 조회 한도를 초과했습니다. 잠시 후 다시 조회해 주세요.' };
        throw failure(messages[response.status] ? response.status : 502, messages[response.status] || 'Google Analytics에서 조회를 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.', 'GA4_REPORT_HTTP');
      }
      const result = await jsonResponse(response);
      return validateReportResponse(result, body);
    }
    throw failure(401, 'GA4 인증을 다시 확인해 주세요.', 'GA4_AUTH_FAILED');
  }
  const verify = config => runReport(config, { dateRanges: [{ startDate: 'yesterday', endDate: 'today' }], metrics: [{ name: 'activeUsers' }], limit: '1', returnPropertyQuota: true });
  async function save(input = {}) {
    const candidate = { schemaVersion: 1, propertyId: propertyId(input.propertyId), credentials: validateCredentials(input.credentials), savedAt: timestamp(), verifiedAt: timestamp() };
    const sequence = ++saveSequence, previous = digest(encryptedFile());
    // Probe actual DPAPI before any network request. Nothing is written until verification succeeds.
    let ciphertext = encrypted(candidate);
    try {
      await verify(candidate);
      if (sequence !== saveSequence || digest(encryptedFile()) !== previous) throw failure(409, '검증 중 GA4 연결 설정이 변경되었습니다. 다시 시도해 주세요.', 'GA4_CONFIG_CHANGED');
      const verifiedAt = timestamp();
      if (candidate.verifiedAt !== verifiedAt) { candidate.verifiedAt = verifiedAt; ciphertext = encrypted(candidate); }
      atomicWrite(ciphertext);
      const verifiedToken = tokens.get(credentialIdentity(candidate.credentials));
      clearTransient();
      if (verifiedToken) tokens.set(credentialIdentity(candidate.credentials), verifiedToken);
      stored = { hash: digest(ciphertext), config: candidate };
      return safeStatus(candidate);
    } catch (error) {
      // Pending keys never replace a working configuration or write a cleartext file.
      throw error;
    }
  }
  async function test() {
    const config = requireConfig(), previous = stored.hash, sequence = saveSequence;
    await verify(config);
    if (sequence !== saveSequence || digest(encryptedFile()) !== previous) throw failure(409, '검증 중 GA4 연결 설정이 변경되었습니다. 다시 시도해 주세요.', 'GA4_CONFIG_CHANGED');
    const updated = { ...config, verifiedAt: timestamp() }, ciphertext = encrypted(updated);
    atomicWrite(ciphertext); stored = { hash: digest(ciphertext), config: updated };
    return safeStatus(updated);
  }
  function remove() {
    saveSequence++;
    try { fs.unlinkSync(filename); } catch (error) { if (error.code !== 'ENOENT') throw failure(500, 'GA4 연결 설정을 삭제하지 못했습니다.', 'GA4_CONFIG_REMOVE'); }
    stored = null; clearTransient();
    return safeStatus(null);
  }
  async function report(input = {}) {
    const scope = input.scope === undefined ? 'all' : input.scope;
    const requests = buildReportRequests(input.since, input.until, scope);
    if (input.refresh !== undefined && typeof input.refresh !== 'boolean') throw failure(400, '새로고침 옵션을 확인해 주세요.', 'GA4_REFRESH');
    const config = requireConfig(), identity = configurationIdentity(config);
    const cacheKey = [identity, input.since, input.until, scope].join('|');
    const cached = reports.get(cacheKey);
    if (!input.refresh && cached && currentTime() - cached.savedAt < CACHE_MS) return { ...structuredClone(cached.value), cached: true };
    if (inFlight.has(cacheKey)) return structuredClone(await inFlight.get(cacheKey));
    const work = (async () => {
      const names = ['summary', 'acquisition', 'landingPages', 'purchase'];
      const values = await Promise.all(names.map(name => runReport(config, requests[name])));
      const latest = readConfig();
      if (!latest || configurationIdentity(latest) !== identity) throw failure(409, '조회 중 GA4 연결이 변경되었습니다. 다시 조회해 주세요.', 'GA4_CONFIG_CHANGED');
      const result = assembleReport(Object.fromEntries(names.map((name, index) => [name, values[index]])), { since: input.since, until: input.until, scope, propertyId: config.propertyId, fetchedAt: timestamp() });
      reports.delete(cacheKey); reports.set(cacheKey, { savedAt: currentTime(), value: result });
      while (reports.size > MAX_CACHE_ENTRIES) reports.delete(reports.keys().next().value);
      return result;
    })();
    inFlight.set(cacheKey, work);
    try { return structuredClone(await work); }
    finally { if (inFlight.get(cacheKey) === work) inFlight.delete(cacheKey); }
  }
  function detailSettings(input) {
    if (input !== undefined) {
      const config = validateDetailSettings(input);
      fs.mkdirSync(path.dirname(detailFilename), { recursive: true, mode: 0o700 });
      const temp = detailFilename + '.tmp-' + crypto.randomBytes(8).toString('hex');
      try { fs.writeFileSync(temp, JSON.stringify(config), { mode: 0o600 }); fs.renameSync(temp, detailFilename); }
      finally { try { fs.unlinkSync(temp); } catch (_) {} }
      return config;
    }
    try { return validateDetailSettings(JSON.parse(fs.readFileSync(detailFilename, 'utf8'))); }
    catch (error) { if (error.code === 'ENOENT') return { ...DETAIL_DEFAULTS }; throw failure(503, '상세페이지 설정을 읽을 수 없습니다.', 'DETAIL_SETTINGS_READ'); }
  }
  async function detailReport(input = {}) {
    if (input.refresh !== undefined && typeof input.refresh !== 'boolean') throw failure(400, '새로고침 옵션을 확인해 주세요.', 'GA4_REFRESH');
    const settings = { ...detailSettings(), ...input }, body = buildDetailRequest(settings, false), pageRequests = buildDetailPageRequests(settings);
    const config = requireConfig(), identity = configurationIdentity(config);
    const key = ['detail', identity, input.since, input.until, settings.productId, settings.contentVersion, settings.scope || 'all'].join('|');
    const cached = reports.get(key);
    if (!input.refresh && cached && currentTime() - cached.savedAt < CACHE_MS) return { ...structuredClone(cached.value), cached: true };
    if (inFlight.has(key)) return structuredClone(await inFlight.get(key));
    const work = (async () => {
      const context = { since: input.since, until: input.until, productId: settings.productId, contentVersion: settings.contentVersion, scope: settings.scope || 'all', fetchedAt: timestamp() };
      const pageWork = async () => {
        const names = ['summary', 'daily', 'events'];
        const responses = await Promise.all(names.map(name => runReport(config, pageRequests[name])));
        return assembleDetailPageReport(Object.fromEntries(names.map((name, index) => [name, responses[index]])), context);
      };
      const trackingWork = async () => {
        let token = await accessToken(config.credentials);
        let reply = await request(DATA_URL + config.propertyId + '/metadata', { headers: { Authorization: 'Bearer ' + token } }, 'GA4 맞춤 정의 확인');
        if (reply.status === 401) {
          token = await accessToken(config.credentials, token);
          reply = await request(DATA_URL + config.propertyId + '/metadata', { headers: { Authorization: 'Bearer ' + token } }, 'GA4 맞춤 정의 확인');
        }
        if (!reply.ok) throw failure(reply.status === 403 ? 403 : 502, 'GA4 맞춤 정의를 확인하지 못했습니다. 연결 검사 후 다시 조회해 주세요.', 'DETAIL_METADATA');
        const metadata = await jsonResponse(reply);
        if (!Array.isArray(metadata.dimensions) || !Array.isArray(metadata.metrics)) throw failure(502, 'GA4 맞춤 정의 응답을 확인할 수 없습니다.', 'DETAIL_METADATA_SCHEMA');
        const dims = new Set(metadata.dimensions.map(item => item.apiName)), metrics = new Set(metadata.metrics.map(item => item.apiName));
        const missing = DETAIL_DIMENSIONS.filter(name => !dims.has('customEvent:' + name));
        if (missing.length) return { ...context, state: 'setup_required', missing, rows: [], warnings: ['GA4 관리자 → 맞춤 정의에서 이벤트 범위의 맞춤 측정기준을 등록하세요.'] };
        const withTime = metrics.has('customEvent:rp_visible_ms');
        if (withTime) body.metrics.push({ name: 'customEvent:rp_visible_ms' });
        return assembleDetailReport(await runReport(config, body), context, withTime);
      };
      // Native page records must remain usable even when the optional tracker's
      // custom definitions or report are unavailable (and vice versa).
      const [page, tracking] = await Promise.allSettled([pageWork(), trackingWork()]);
      const latest = readConfig();
      if (!latest || configurationIdentity(latest) !== identity) throw failure(409, '조회 중 GA4 연결이 변경되었습니다. 다시 조회해 주세요.', 'GA4_CONFIG_CHANGED');
      if (page.status === 'rejected' && tracking.status === 'rejected') throw page.reason;
      const tracked = tracking.status === 'fulfilled' ? tracking.value : { ...context, state: 'error', rows: [], scroll: {}, views: null, buyClicks: null, cartClicks: null,
        warnings: ['구간별 추적 보고서를 불러오지 못했습니다. ' + tracking.reason.message] };
      const pageAnalytics = page.status === 'fulfilled' ? page.value : { state: 'error', summary: null, daily: [], events: [], warnings: ['상세페이지 기본 데이터를 불러오지 못했습니다. ' + page.reason.message] };
      const result = { ...tracked, trackingState: tracked.state, pageAnalytics,
        state: tracked.state === 'ready' || pageAnalytics.state === 'ready' ? 'ready' : tracked.state,
        warnings: [...new Set([...(tracked.warnings || []), ...pageAnalytics.warnings])] };
      // Retry incomplete setup/errors on the next visit. Refresh always bypasses
      // the short cache, including when custom definitions were just registered.
      if (page.status === 'fulfilled' && tracking.status === 'fulfilled' && tracked.state !== 'setup_required') reports.set(key, { savedAt: currentTime(), value: result });
      while (reports.size > MAX_CACHE_ENTRIES) reports.delete(reports.keys().next().value);
      return result;
    })();
    inFlight.set(key, work);
    try { return structuredClone(await work); } finally { if (inFlight.get(key) === work) inFlight.delete(key); }
  }
  function catalogStore() {
    try { const value = JSON.parse(fs.readFileSync(catalogFilename,'utf8')); if (!value || value.schemaVersion !== 1 || !value.versions) throw Error(); return value; }
    catch (error) { if (error.code === 'ENOENT') return { schemaVersion:1, versions:{} }; throw failure(503,'저장된 콘텐츠 목록을 읽을 수 없습니다.','DETAIL_CATALOG_READ'); }
  }
  function catalogWrite(value) {
    fs.mkdirSync(path.dirname(catalogFilename),{recursive:true,mode:0o700});
    const temp = catalogFilename + '.tmp-' + crypto.randomBytes(8).toString('hex');
    try { fs.writeFileSync(temp,JSON.stringify(value),{mode:0o600}); fs.renameSync(temp,catalogFilename); }
    finally { try { fs.unlinkSync(temp); } catch (_) {} }
  }
  function catalogContext() { const s = detailSettings(); return { key:s.productId + ':' + s.contentVersion, productId:s.productId, contentVersion:s.contentVersion }; }
  async function detailCatalog(input) {
    const context = catalogContext(), initial = catalogStore(), previous = initial.versions[context.key];
    if (input === undefined) return previous || { productId:context.productId, contentVersion:context.contentVersion, items:[], importedAt:null };
    if (input.productId !== context.productId || input.contentVersion !== context.contentVersion) throw failure(409,'상품 또는 상세 버전이 변경됐습니다. 새로고침 후 다시 시도하세요.','DETAIL_CATALOG_CHANGED');
    let value;
    if (input.action === 'import') {
      const response = await request('https://wemamang.com/product/detail.html?product_no=' + context.productId, { headers:{'User-Agent':'ROAS-Pilot-Content-Catalog/1.0'} }, '상세 콘텐츠 목록');
      if (!response.ok) throw failure(502,'상세페이지를 불러오지 못했습니다.','DETAIL_CATALOG_FETCH');
      let html = '', bytes = 0;
      if (response.body && response.body[Symbol.asyncIterator]) {
        const chunks=[];
        for await (const chunk of response.body) { bytes += chunk.length; if (bytes > 3*1024*1024) throw failure(413,'상세페이지 크기가 너무 큽니다.','DETAIL_CATALOG_SIZE'); chunks.push(Buffer.from(chunk)); }
        html = Buffer.concat(chunks).toString('utf8');
      } else { html = await response.text(); if (Buffer.byteLength(html) > 3*1024*1024) throw failure(413,'상세페이지 크기가 너무 큽니다.','DETAIL_CATALOG_SIZE'); }
      const items = parseDetailMedia(html);
      const signature = list => JSON.stringify(list.map(item=>[item.id,item.url]));
      if (previous && signature(previous.items) !== signature(items)) throw failure(409,'현재 페이지의 순서·파일이 저장된 목록과 다릅니다. 기존 통계를 보존하려면 상세 버전을 변경하고 자사몰 설치코드도 교체한 후 불러오세요.','DETAIL_CATALOG_VERSION');
      value = {productId:context.productId,contentVersion:context.contentVersion,importedAt:timestamp(),items};
    } else if (input.action === 'thumbnail') {
      if (!previous) throw failure(400,'먼저 콘텐츠 목록을 불러오세요.','DETAIL_THUMBNAIL');
      value = structuredClone(previous);
      const item = value.items.find(item=>item.id === input.id && item.type !== 'image');
      const data = input.thumbnail;
      if (!item || typeof data !== 'string' || data.length > 85000 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(data)) throw failure(400,'썸네일 JPEG 형식을 확인하세요.','DETAIL_THUMBNAIL');
      const bytes = Buffer.from(data.split(',')[1],'base64');
      if (bytes.length < 4 || bytes.length > 63000 || bytes[0] !== 255 || bytes[1] !== 216 || bytes.at(-2) !== 255 || bytes.at(-1) !== 217) throw failure(400,'썸네일 JPEG 파일을 확인하세요.','DETAIL_THUMBNAIL');
      item.thumbnail = data;
    } else if (input.action === 'rename') {
      if (!previous || !Array.isArray(input.names) || input.names.length > 500) throw failure(400,'저장할 콘텐츠 이름을 확인하세요.','DETAIL_CATALOG_NAMES');
      value = structuredClone(previous);
      for (const change of input.names) {
        const item = value.items.find(item=>item.id === change.id);
        if (!item || typeof change.name !== 'string' || change.name.length > 80 || /[\u0000-\u001f]/.test(change.name)) throw failure(400,'콘텐츠 이름은 80자 이내로 입력하세요.','DETAIL_CATALOG_NAMES');
        item.name = change.name.trim();
      }
    } else throw failure(400,'콘텐츠 목록 작업을 확인하세요.','DETAIL_CATALOG_ACTION');
    if (catalogContext().key !== context.key) throw failure(409,'조회 중 상품·버전이 변경됐습니다.','DETAIL_CATALOG_CHANGED');
    const latest = catalogStore();
    if (input.action === 'import' && latest.versions[context.key] && JSON.stringify(latest.versions[context.key].items.map(item=>[item.id,item.url])) !== JSON.stringify(value.items.map(item=>[item.id,item.url]))) throw failure(409,'불러오는 동안 콘텐츠 목록이 변경됐습니다. 다시 확인하세요.','DETAIL_CATALOG_CHANGED');
    if (input.action === 'import') for (const item of value.items) { const old = latest.versions[context.key]?.items.find(old=>old.id===item.id); item.name = old?.name || ''; if (old?.thumbnail) item.thumbnail = old.thumbnail; }
    latest.versions[context.key] = value; catalogWrite(latest); return value;
  }
  return { status: () => safeStatus(readConfig()), save, test, remove, report, detailSettings, detailReport, detailCatalog };
}

module.exports = { createGa4Service, validateDates, validateCredentials, jwtAssertion, buildReportRequests, assembleReport, METRICS, ACQUISITION_DIMENSIONS,
  validateDetailSettings, buildDetailRequest, assembleDetailReport, buildDetailPageRequests, assembleDetailPageReport, DETAIL_PAGE_METRICS,
  DETAIL_DIMENSIONS, DETAIL_DEFAULTS, parseDetailMedia, detailMediaUrl };
