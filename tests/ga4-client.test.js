'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createGa4Service, validateDates, validateCredentials, buildReportRequests, METRICS } = require('../integrations/ga4/client.cjs');

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const credentials = () => ({ type: 'service_account', project_id: 'roas-test-project', client_email: 'roas-test@roas-test-project.iam.gserviceaccount.com', private_key: PEM,
  token_uri: 'https://untrusted.example/token', auth_uri: 'https://untrusted.example/auth' });
const PERIOD = { since: '2026-10-01', until: '2026-10-20', scope: 'all' };

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, redirected: false, json: async () => structuredClone(body) };
}
function row(dimensions, metrics) {
  return { dimensionValues: dimensions.map(value => ({ value })), metricValues: metrics.map(value => ({ value: String(value) })) };
}
function standardReport(body) {
  const result = { metricHeaders: body.metrics.map(metric => ({ name: metric.name, type: 'TYPE_FLOAT' })),
    dimensionHeaders: (body.dimensions || []).map(dimension => ({ name: dimension.name })),
    metadata: { timeZone: 'Asia/Seoul', currencyCode: 'KRW' }, propertyQuota: { tokensPerDay: { consumed: 1, remaining: 199999 } } };
  if (body.dateRanges[0].startDate === 'yesterday') return { ...result, rows: [], rowCount: 0 };
  const firstDimension = body.dimensions && body.dimensions[0] && body.dimensions[0].name;
  if (firstDimension === 'eventName') return { ...result, rows: [row(['purchase'], [3])], rowCount: 1 };
  if (firstDimension === 'sessionSource') return { ...result, rows: [
    row(['fb', 'paid_social', '캠페인 A', '120000000000000001', '130000000000000001', '140000000000000001'], [5, 6, 4, 4 / 6, 100, 12, 2, 50000]),
    row(['ig', 'cpc', '캠페인 B', '120000000000000002', '130000000000000002', '140000000000000002'], [5, 4, 2, .5, 150, 6, 0, 0])
  ], rowCount: 2 };
  if (firstDimension === 'landingPagePlusQueryString') return { ...result, rows: [row(['/product/test?variant=01'], [7, 10, 6, .6, 120, 18, 2, 50000])], rowCount: 1 };
  return { ...result, rows: [row([], [7, 10, 6, .6, 120, 18, 2, 50000])], rowCount: 1 };
}
function harness(t, overrides = {}) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'roas-ga4-client-'));
  t.after(() => fs.rmSync(baseDir, { recursive: true, force: true }));
  const secret = crypto.randomBytes(32), calls = [];
  let clock = Date.parse('2026-10-24T00:00:00Z'), tokenCount = 0, reportHook = null, networkHook = null;
  const protect = overrides.protect || ((mode, input) => {
    if (mode === 'encrypt') {
      const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', secret, iv);
      const encrypted = Buffer.concat([cipher.update(input, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
    }
    const packed = Buffer.from(input, 'base64'), decipher = crypto.createDecipheriv('aes-256-gcm', secret, packed.subarray(0, 12));
    decipher.setAuthTag(packed.subarray(12, 28));
    return Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]).toString('utf8');
  });
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (networkHook) return networkHook(url, options);
    if (url === 'https://oauth2.googleapis.com/token') {
      tokenCount++;
      return response(200, { access_token: 'test-access-token-' + tokenCount, expires_in: 3600, token_type: 'Bearer' });
    }
    assert.match(url, /^https:\/\/analyticsdata\.googleapis\.com\/v1beta\/properties\/[1-9]\d*:runReport$/);
    const body = JSON.parse(options.body);
    if (reportHook) {
      const result = await reportHook(url, body, options);
      if (result !== undefined) return result;
    }
    return response(200, standardReport(body));
  };
  const options = { baseDir, protect, fetchImpl, now: () => clock };
  const service = createGa4Service(options);
  return { service, options, baseDir, calls, protect, file: path.join(baseDir, '.roas-private', 'ga4.dpapi'),
    connect: input => service.save({ propertyId: '123456789', credentials: credentials(), ...input }),
    setNow: value => { clock = value; }, advance: value => { clock += value; },
    setReportHook: value => { reportHook = value; }, setNetworkHook: value => { networkHook = value; },
    tokens: () => tokenCount, reportCalls: () => calls.filter(call => call.url.includes(':runReport')) };
}

test('lazy constructor and unavailable DPAPI fail closed before a network request', async t => {
  let protectionCalls = 0;
  const h = harness(t, { protect: () => { protectionCalls++; throw Object.assign(new Error('unavailable-private-detail'), { status: 501 }); } });
  assert.equal(protectionCalls, 0);
  assert.equal(h.service.status().configured, false);
  await assert.rejects(h.connect(), error => error.status === 501 && !error.message.includes('unavailable-private-detail'));
  assert.equal(h.calls.length, 0);
  assert.equal(fs.existsSync(h.file), false);
});

test('JSON validation limits bytes, validates service accounts and RSA, rejects measurement IDs', async t => {
  const h = harness(t);
  await assert.rejects(h.connect({ propertyId: 'G-RZF6S41CF0' }), error => error.status === 400);
  await assert.rejects(h.connect({ credentials: '{invalid' }), error => error.code === 'GA4_CREDENTIAL_JSON');
  await assert.rejects(h.connect({ credentials: { ...credentials(), type: 'authorized_user' } }), error => error.code === 'GA4_CREDENTIAL_SCHEMA');
  await assert.rejects(h.connect({ credentials: { ...credentials(), private_key: 'sensitive-invalid-private-key' } }), error => error.code === 'GA4_CREDENTIAL_KEY' && !error.message.includes('sensitive-invalid'));
  await assert.rejects(h.connect({ credentials: JSON.stringify({ ...credentials(), huge: 'x'.repeat(65536) }) }), error => error.status === 413);
  const ec = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  assert.throws(() => validateCredentials({ ...credentials(), private_key: ec }), error => error.code === 'GA4_CREDENTIAL_KEY');
  assert.equal(h.calls.length, 0);
});

test('save signs a fixed-endpoint readonly JWT, verifies an actual property read, stores only ciphertext', async t => {
  const h = harness(t);
  const status = await h.connect({ credentials: JSON.stringify(credentials()) });
  assert.equal(status.configured, true);
  assert.equal(status.propertyId, '123456789');
  assert.equal(status.security, 'Windows DPAPI');
  assert.equal(status.clientEmail, credentials().client_email);
  assert.equal(status.projectId, 'roas-test-project');
  const oauth = h.calls[0];
  assert.equal(oauth.url, 'https://oauth2.googleapis.com/token');
  const form = new URLSearchParams(oauth.options.body);
  assert.equal(form.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
  const parts = form.get('assertion').split('.');
  const header = JSON.parse(Buffer.from(parts[0], 'base64url'));
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url'));
  assert.equal(header.alg, 'RS256');
  assert.equal(claims.iss, credentials().client_email);
  assert.equal(claims.aud, 'https://oauth2.googleapis.com/token');
  assert.equal(claims.scope, 'https://www.googleapis.com/auth/analytics.readonly');
  assert.equal(claims.iat, Date.parse('2026-10-24T00:00:00Z') / 1000);
  assert.equal(claims.exp - claims.iat, 3600);
  assert.equal(crypto.verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), publicKey, Buffer.from(parts[2], 'base64url')), true);
  assert.equal(h.reportCalls().length, 1);
  assert.deepEqual(JSON.parse(h.reportCalls()[0].options.body).metrics, [{ name: 'activeUsers' }]);
  for (const call of h.calls) {
    assert.equal(call.options.redirect, 'error');
    assert(call.options.signal instanceof AbortSignal);
    assert.equal(call.url.includes('untrusted.example'), false);
  }
  const ciphertext = fs.readFileSync(h.file, 'utf8');
  assert.equal(ciphertext.includes('PRIVATE KEY'), false);
  assert.equal(ciphertext.includes(credentials().client_email), false);
  const decrypted = JSON.parse(h.protect('decrypt', ciphertext));
  assert.equal(decrypted.credentials.token_uri, undefined);
  assert.equal(JSON.stringify(decrypted).includes('test-access-token-'), false);
  assert.equal(JSON.stringify(status).includes('private_key'), false);
  assert.equal(JSON.stringify(status).includes('access_token'), false);
  assert.equal(fs.readdirSync(path.dirname(h.file)).length, 1);
  if (process.platform !== 'win32') assert.equal(fs.statSync(h.file).mode & 0o777, 0o600);
  const restarted = createGa4Service(h.options);
  assert.deepEqual(restarted.status(), status);
});

test('failed new property verification atomically preserves the previous valid connection', async t => {
  const h = harness(t);
  const old = await h.connect(), encryptedBefore = fs.readFileSync(h.file, 'utf8');
  h.setReportHook(url => url.includes('/987654321:') ? response(403, { error: { message: PEM } }) : undefined);
  await assert.rejects(h.connect({ propertyId: '987654321' }), error => error.status === 403 && !error.message.includes('PRIVATE KEY'));
  assert.equal(fs.readFileSync(h.file, 'utf8') === encryptedBefore, true);
  assert.deepEqual(h.service.status(), old);
  assert.equal(fs.readdirSync(path.dirname(h.file)).length, 1);
});

test('a failed first verification creates no settings or temporary plaintext', async t => {
  const h = harness(t);
  h.setReportHook(() => response(404, { error: { message: 'sensitive-response' } }));
  await assert.rejects(h.connect(), error => error.status === 404 && !error.message.includes('sensitive-response'));
  assert.equal(fs.existsSync(h.file), false);
  assert.equal(h.service.status().configured, false);
});

test('four separate report queries preserve nonadditive users and exact string ad IDs', async t => {
  const h = harness(t); await h.connect();
  const result = await h.service.report(PERIOD);
  assert.equal(h.reportCalls().length, 5);
  assert.equal(h.tokens(), 1);
  assert.equal(result.cached, false);
  assert.equal(result.summary.activeUsers, 7);
  assert.equal(result.acquisition.reduce((total, item) => total + item.activeUsers, 0), 10);
  assert.equal(result.summary.engagementRate, .6);
  assert.equal(result.summary.averageSessionDuration, 120);
  assert.equal(result.acquisition[0].adContent, '130000000000000001');
  assert.equal(result.acquisition[0].campaignId, '120000000000000001');
  assert.equal(result.acquisition[0].adsetId, '140000000000000001');
  assert.equal(result.acquisition[0].campaign, '캠페인 A');
  assert.equal(result.landingPages[0].landingPage, '/product/test?variant=01');
  assert.equal(result.timeZone, 'Asia/Seoul'); assert.equal(result.currencyCode, 'KRW');
  assert.equal(result.purchaseTracking.state, 'observed');
  assert.equal(result.purchaseTracking.eventCount, 3);
  assert.equal(result.purchaseTracking.scope, 'property');
  assert.equal(result.metadata.summary.propertyQuota.tokensPerDay.consumed, 1);
  const bodies = h.reportCalls().slice(1).map(call => JSON.parse(call.options.body));
  assert.equal(bodies.filter(body => !body.dimensions).length, 1);
  for (const body of bodies.filter(body => body.limit === '5000')) assert.deepEqual(body.orderBys, [{ metric: { metricName: 'sessions' }, desc: true }]);
});

test('Meta scope filters three session reports but never the property purchase audit', async t => {
  const h = harness(t); await h.connect();
  const result = await h.service.report({ ...PERIOD, scope: 'meta' });
  const bodies = h.reportCalls().slice(1).map(call => JSON.parse(call.options.body));
  const purchase = bodies.find(body => body.dimensions && body.dimensions[0].name === 'eventName');
  assert.deepEqual(purchase.dimensionFilter, { filter: { fieldName: 'eventName', stringFilter: { matchType: 'EXACT', value: 'purchase', caseSensitive: true } } });
  for (const body of bodies.filter(body => body !== purchase)) {
    const filters = body.dimensionFilter.andGroup.expressions.map(expression => expression.filter);
    assert.deepEqual(filters[0].inListFilter.values, ['fb', 'ig', 'an', 'msg', 'facebook', 'instagram']);
    assert.equal(filters[0].inListFilter.caseSensitive, false);
    assert(filters[1].inListFilter.values.includes('paid-social'));
    assert(filters[1].inListFilter.values.includes('paid'));
  }
  assert.equal(result.purchaseTracking.scope, 'property');
  assert(result.warnings.some(message => message.includes('속성 전체')));
});

test('empty reports return real zeros and unverified purchase tracking without an installation-date assumption', async t => {
  const h = harness(t); await h.connect();
  h.setReportHook((url, body) => response(200, { metricHeaders: body.metrics.map(metric => ({ name: metric.name })), dimensionHeaders: (body.dimensions || []).map(dimension => ({ name: dimension.name })), rows: [], rowCount: 0 }));
  const result = await h.service.report({ since: '2026-06-01', until: '2026-06-10', scope: 'all' });
  for (const metric of METRICS) assert.equal(result.summary[metric], 0);
  assert.deepEqual(result.acquisition, []); assert.deepEqual(result.landingPages, []);
  assert.equal(result.purchaseTracking.state, 'unverified'); assert.equal(result.purchaseTracking.eventCount, 0);
  assert.equal(result.currencyCode, null); assert.equal(result.timeZone, null);
});

test('restricted metrics become null, and thresholding/sampling/quota and truncation are preserved', async t => {
  const h = harness(t); await h.connect();
  h.setReportHook((url, body) => {
    const result = standardReport(body);
    if (body.metrics.some(metric => metric.name === 'purchaseRevenue')) {
      result.metadata = { ...result.metadata, subjectToThresholding: true, dataLossFromOtherRow: true,
        samplingMetadatas: [{ samplesReadCount: '10', samplingSpaceSize: '100' }], schemaRestrictionResponse: { activeMetricRestrictions: [{ metricName: 'purchaseRevenue', restrictedMetricTypes: ['REVENUE_DATA'] }] } };
    }
    if (body.dimensions && body.dimensions[0].name === 'sessionSource') result.rowCount = 8000;
    return response(200, result);
  });
  const result = await h.service.report(PERIOD);
  assert.equal(result.summary.purchaseRevenue, null);
  assert.equal(result.acquisition[0].purchaseRevenue, null);
  assert.equal(result.landingPages[0].purchaseRevenue, null);
  assert.equal(result.truncated.acquisition, true); assert.equal(result.rowCounts.acquisition, 8000);
  assert.equal(result.truncated.landingPages, false);
  assert.equal(result.metadata.summary.subjectToThresholding, true);
  assert.equal(result.metadata.acquisition.samplingMetadatas[0].samplingSpaceSize, '100');
  for (const expected of ['빈 값', '기준점', '표본', '10.0%', '(other)', '8000행']) assert(result.warnings.some(message => message.includes(expected)));
});

test('emptyReason and data truncation retain unknown metrics instead of manufacturing zero', async t => {
  const h = harness(t); await h.connect();
  h.setReportHook((url, body) => response(200, { metricHeaders: body.metrics.map(metric => ({ name: metric.name })),
    dimensionHeaders: (body.dimensions || []).map(dimension => ({ name: dimension.name })), rows: [], rowCount: 0,
    metadata: { emptyReason: 'DATA_UNAVAILABLE', dataTruncationReasons: [{ dataTruncationType: 'DATA_TRUNCATION_TYPE_DATE_RANGE', dataTruncationMessage: 'Requested period is partly unavailable', dataTruncationDate: '2026-10-24', dataTruncationDateRanges: [{ startDate: '2026-10-01', endDate: '2026-10-23' }] }] } }));
  const result = await h.service.report(PERIOD);
  for (const metric of METRICS) assert.equal(result.summary[metric], null);
  assert.equal(result.purchaseTracking.eventCount, null);
  assert.equal(result.purchaseTracking.state, 'unverified');
  assert(result.warnings.some(message => message.includes('DATA_UNAVAILABLE')));
  for (const expected of ['Requested period is partly unavailable','2026-10-24 이전','2026-10-01~2026-10-23']) assert(result.warnings.some(message => message.includes(expected)));
  assert.equal(result.metadata.summary.dataTruncationReasons[0].dataTruncationType, 'DATA_TRUNCATION_TYPE_DATE_RANGE');
});

test('missing requested headers or an embedded error cannot verify or become an empty report', async t => {
  const h = harness(t);
  h.setReportHook(() => response(200, { metricHeaders: [{ name: 'wrongMetric' }], rows: [] }));
  await assert.rejects(h.connect(), error => error.code === 'GA4_RESPONSE_SCHEMA');
  assert.equal(fs.existsSync(h.file), false);
  h.setReportHook((url, body) => response(200, { ...standardReport(body), error: { message: 'sensitive-embedded-error' } }));
  await assert.rejects(h.connect(), error => error.code === 'GA4_RESPONSE_SCHEMA' && !error.message.includes('sensitive-embedded-error'));
  assert.equal(fs.existsSync(h.file), false);
  h.setReportHook(null); await h.connect();
  h.setReportHook((url, body) => {
    const result = standardReport(body);
    if (body.dimensions && body.dimensions[0].name === 'sessionSource') result.dimensionHeaders = [];
    return response(200, result);
  });
  await assert.rejects(h.service.report(PERIOD), error => error.code === 'GA4_RESPONSE_SCHEMA');
});

test('strict calendar dates and 93-day limit are validated before fetching', async t => {
  assert.deepEqual(validateDates('2024-02-29', '2024-02-29'), { since: '2024-02-29', until: '2024-02-29' });
  assert.doesNotThrow(() => validateDates('2026-01-01', '2026-04-03'));
  for (const values of [['2026-02-29', '2026-03-01'], ['2026-04-31', '2026-05-01'], ['2026-10-02', '2026-10-01'], ['2026-1-01', '2026-01-03'], ['2026-01-01', '2026-04-04']]) assert.throws(() => validateDates(...values), error => error.status === 400);
  const h = harness(t);
  await assert.rejects(h.service.report({ ...PERIOD, until: '2026-02-30' }), error => error.status === 400);
  assert.throws(() => buildReportRequests(PERIOD.since, PERIOD.until, 'invalid'), error => error.code === 'GA4_SCOPE');
  assert.equal(h.calls.length, 0);
});

test('report cache lasts five minutes, isolates dates/scope, and cannot be mutated by callers', async t => {
  const h = harness(t); await h.connect();
  const first = await h.service.report(PERIOD); first.summary.activeUsers = 999;
  const second = await h.service.report(PERIOD);
  assert.equal(second.cached, true); assert.equal(second.summary.activeUsers, 7);
  assert.equal(h.reportCalls().length, 5);
  await h.service.report({ ...PERIOD, scope: 'meta' });
  assert.equal(h.reportCalls().length, 9);
  h.advance(5 * 60 * 1000);
  assert.equal((await h.service.report(PERIOD)).cached, false);
  assert.equal(h.reportCalls().length, 13);
  assert.equal((await h.service.report({ ...PERIOD, refresh: true })).cached, false);
  assert.equal(h.tokens(), 1);
});

test('same in-flight report is singleflight and shares only one set of four queries', async t => {
  const h = harness(t); await h.connect();
  let release; const gate = new Promise(resolve => { release = resolve; });
  h.setReportHook(async () => { await gate; });
  const first = h.service.report(PERIOD), second = h.service.report(PERIOD);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.reportCalls().length, 5);
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.deepEqual(a, b); assert.notEqual(a, b);
  assert.equal(h.tokens(), 1);
});

test('401 reissues a token once and token expiry renews it without persisting tokens', async t => {
  const h = harness(t); await h.connect();
  let failed = false;
  h.setReportHook((url, body, options) => {
    if (!failed && !body.dimensions) { failed = true; return response(401, { error: { message: 'token-secret' } }); }
  });
  await h.service.report(PERIOD);
  assert.equal(h.tokens(), 2);
  h.setReportHook(null); h.advance(3600 * 1000);
  await h.service.report({ ...PERIOD, refresh: true });
  assert.equal(h.tokens(), 3);
  const plain = h.protect('decrypt', fs.readFileSync(h.file, 'utf8'));
  assert.equal(plain.includes('test-access-token-'), false);
});

test('test() performs a real read; changed property invalidates reports; removal deletes only GA4', async t => {
  const h = harness(t); await h.connect(); await h.service.report(PERIOD);
  const before = h.reportCalls().length; h.advance(1000);
  const verified = await h.service.test();
  assert.equal(h.reportCalls().length, before + 1);
  assert.equal(verified.verifiedAt, '2026-10-24T00:00:01.000Z');
  await h.connect({ propertyId: '987654321' });
  const changed = await h.service.report(PERIOD);
  assert.equal(changed.propertyId, '987654321'); assert.equal(changed.cached, false);
  const sibling = path.join(path.dirname(h.file), 'meta-token.keep'); fs.writeFileSync(sibling, 'unrelated');
  const removed = h.service.remove(); assert.equal(removed.configured, false);
  assert.equal(fs.existsSync(h.file), false); assert.equal(fs.readFileSync(sibling, 'utf8'), 'unrelated');
  await assert.rejects(h.service.report(PERIOD), error => error.code === 'GA4_NOT_CONFIGURED');
  const tokensBefore = h.tokens(); await h.connect(); assert.equal(h.tokens(), tokensBefore + 1);
});

test('bounded report cache evicts older queries after twenty distinct keys', async t => {
  const h = harness(t); await h.connect();
  for (let day = 1; day <= 21; day++) await h.service.report({ since: '2026-09-' + String(day).padStart(2, '0'), until: '2026-09-' + String(day).padStart(2, '0'), scope: 'all' });
  const old = await h.service.report({ since: '2026-09-01', until: '2026-09-01', scope: 'all' });
  assert.equal(old.cached, false);
  assert.equal(h.tokens(), 1);
});

test('HTTP, network, timeout and malformed-response errors never echo response bodies or secrets', async t => {
  const h = harness(t); await h.connect();
  h.setReportHook(() => response(500, { error: { message: PEM + 'access-token-sensitive' } }));
  await assert.rejects(h.service.report(PERIOD), error => error.status === 502 && !error.message.includes('PRIVATE KEY') && !error.message.includes('access-token-sensitive'));
  h.setReportHook(() => response(200, {}));
  await assert.rejects(h.service.report(PERIOD), error => error.code === 'GA4_RESPONSE');
  h.setNetworkHook(() => { throw new Error(PEM + 'JWT-sensitive'); });
  await assert.rejects(h.service.report(PERIOD), error => error.code === 'GA4_NETWORK' && !error.message.includes('PRIVATE KEY') && !error.message.includes('JWT-sensitive'));
  h.setNetworkHook(() => { throw Object.assign(new Error('sensitive'), { name: 'TimeoutError' }); });
  await assert.rejects(h.service.report(PERIOD), error => error.status === 504 && !error.message.includes('sensitive'));
});

test('redirect responses are rejected and configuration corruption is reported without plaintext', async t => {
  const h = harness(t); await h.connect();
  h.setNetworkHook(() => response(302, { location: 'https://untrusted.example' }));
  await assert.rejects(h.service.report(PERIOD), error => error.code === 'GA4_REDIRECT');
  fs.writeFileSync(h.file, 'corrupt-private-material');
  assert.throws(() => h.service.status(), error => error.code === 'GA4_CONFIG_DECRYPT' && !error.message.includes('corrupt-private-material'));
});

test('removing settings while save verifies cannot resurrect deleted credentials', async t => {
  const h = harness(t); await h.connect();
  let release; const gate = new Promise(resolve => { release = resolve; });
  h.setReportHook(async () => { await gate; });
  const pending = h.connect({ propertyId: '987654321' });
  await new Promise(resolve => setImmediate(resolve));
  h.service.remove(); release();
  await assert.rejects(pending, error => error.code === 'GA4_CONFIG_CHANGED');
  assert.equal(fs.existsSync(h.file), false);
});
