(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const pageSize = 50;
  const state = { configured: false, busy: false, loading: false, report: null, sequence: 0, connectionRevision: 0, controller: null, acquisitionPage: 0, landingPage: 0 };
  const integerFormat = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 });
  const text = value => value == null ? '' : String(value);
  const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
  const count = value => number(value) == null ? '—' : integerFormat.format(value);
  const percent = value => number(value) == null ? '—' : (value * 100).toLocaleString('ko-KR', { maximumFractionDigits: 1 }) + '%';
  const missing = value => !text(value).trim() || ['(not set)', '(none)'].includes(text(value).trim().toLowerCase());

  function node(tag, value, className) {
    const element = document.createElement(tag);
    if (value != null) element.textContent = text(value);
    if (className) element.className = className;
    return element;
  }

  function notice(id, message, tone) {
    const element = $(id);
    element.textContent = message || '';
    element.hidden = !message;
    element.dataset.tone = tone || 'info';
    element.setAttribute('role', tone === 'error' ? 'alert' : 'status');
  }

  function duration(value) {
    if (number(value) == null) return '—';
    const seconds = Math.max(0, Math.round(value));
    return seconds >= 60 ? Math.floor(seconds / 60).toLocaleString('ko-KR') + '분 ' + seconds % 60 + '초' : seconds + '초';
  }

  function currency(value, code) {
    if (number(value) == null) return '—';
    if (!/^[A-Z]{3}$/.test(text(code))) return value.toLocaleString('ko-KR', { maximumFractionDigits: 2 }) + ' (통화 미확인)';
    try { return new Intl.NumberFormat('ko-KR', { style: 'currency', currency: code, maximumFractionDigits: code === 'KRW' ? 0 : 2 }).format(value); }
    catch (_) { return value.toLocaleString('ko-KR', { maximumFractionDigits: 2 }) + ' ' + text(code); }
  }

  function localDate(value) {
    if (!value) return '아직 확인하지 않았습니다.';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '확인 시각 없음';
    return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Seoul' }).format(date) + ' (한국 시간)';
  }

  function todaySeoul() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  }

  function selectDays(days) {
    const until = todaySeoul();
    const since = new Date(until + 'T00:00:00Z');
    since.setUTCDate(since.getUTCDate() - days + 1);
    $('ga4-since').value = since.toISOString().slice(0, 10);
    $('ga4-until').value = until;
    document.querySelectorAll('[data-ga4-days]').forEach(button => button.classList.toggle('active', Number(button.dataset.ga4Days) === days));
  }

  function actionState() {
    $('ga4-save').disabled = state.busy;
    $('ga4-property-id').disabled = state.busy;
    $('ga4-key-file').disabled = state.busy;
    $('ga4-test').disabled = state.busy || !state.configured;
    $('ga4-disconnect').disabled = state.busy || !state.configured;
    $('ga4-query').disabled = state.busy || state.loading || !state.configured;
    $('ga4-refresh').disabled = state.busy || state.loading || !state.configured;
    $('ga4-report').setAttribute('aria-busy', String(state.loading));
  }

  async function api(path, options) {
    const response = await fetch(path, { credentials: 'same-origin', ...options });
    let body;
    try { body = await response.json(); }
    catch (_) { throw Error('프로그램 서버의 응답을 확인할 수 없습니다. 프로그램 실행 상태를 확인하세요.'); }
    if (!response.ok) throw Error(typeof body.error === 'string' ? body.error : '요청을 처리하지 못했습니다. 잠시 후 다시 시도하세요.');
    return body;
  }

  function post(path, body) {
    return api(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Roas-Local-Action': 'yes' }, body: JSON.stringify(body || {}), signal: AbortSignal.timeout(90000) });
  }

  function connectionStatus(status) {
    state.configured = status.configured === true;
    const badge = $('ga4-connection-badge');
    badge.textContent = state.configured ? 'GA4 연결됨' : 'GA4 연결 필요';
    badge.dataset.tone = state.configured ? 'success' : 'info';
    $('ga4-connection-summary').textContent = state.configured ? '속성 ' + text(status.propertyId) + ' · 이 PC에 암호화 저장' : '속성 ID와 JSON 파일을 등록하세요.';
    $('ga4-saved-details').hidden = !state.configured;
    $('ga4-saved-email').textContent = state.configured ? text(status.clientEmail) : '';
    $('ga4-verified-at').textContent = state.configured ? localDate(status.verifiedAt) : '';
    if (state.configured && status.propertyId) $('ga4-property-id').value = text(status.propertyId);
    $('ga4-connection').open = !state.configured;
    actionState();
  }

  function clearReport(message) {
    state.sequence += 1;
    if (state.controller) state.controller.abort();
    state.controller = null;
    state.loading = false;
    state.report = null;
    state.acquisitionPage = 0;
    state.landingPage = 0;
    $('ga4-report').hidden = true;
    $('ga4-before-report').hidden = false;
    $('ga4-empty-title').textContent = state.configured ? '선택한 기간의 데이터를 조회하세요.' : '연결을 마치면 유입 데이터를 확인할 수 있습니다.';
    $('ga4-report-status').textContent = message || (state.configured ? '기간 조회를 눌러 데이터를 확인하세요.' : 'GA4를 연결하면 조회할 수 있습니다.');
    notice('ga4-report-error', '');
    actionState();
  }

  function validPeriod() {
    const since = $('ga4-since').value;
    const until = $('ga4-until').value;
    const valid = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(new Date(value + 'T00:00:00Z').getTime()) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
    if (!valid(since) || !valid(until)) throw Error('시작일과 종료일을 확인하세요.');
    if (since > until) throw Error('시작일은 종료일보다 늦을 수 없습니다.');
    if ((new Date(until + 'T00:00:00Z') - new Date(since + 'T00:00:00Z')) / 86400000 >= 93) throw Error('한 번에 최대 93일을 조회할 수 있습니다. 기간을 줄여 주세요.');
    if (until > todaySeoul()) throw Error('종료일은 오늘까지 선택할 수 있습니다.');
    return { since, until, scope: $('ga4-scope').value };
  }

  function metric(label, value, detail, unverified) {
    const card = node('article', null, 'metric');
    card.append(node('span', label), node('strong', value, unverified ? 'ga4-unverified' : ''), node('small', detail));
    return card;
  }

  function purchaseObserved() {
    return state.report && state.report.purchaseTracking && state.report.purchaseTracking.state === 'observed';
  }

  function renderReport(report) {
    state.report = report;
    state.acquisitionPage = 0;
    state.landingPage = 0;
    $('ga4-before-report').hidden = true;
    $('ga4-report').hidden = false;
    const summary = report.summary || {};
    const observed = purchaseObserved();
    const scope = report.scope === 'meta' ? 'Meta 유료 유입' : '전체 유입';
    $('ga4-period-label').textContent = text(report.since) + ' ~ ' + text(report.until) + ' · ' + scope + (report.timeZone ? ' · ' + text(report.timeZone) : '');
    $('ga4-metrics').replaceChildren(
      metric('활성 사용자', count(summary.activeUsers), '선택 기간·범위 집계'),
      metric('세션', count(summary.sessions), '방문 횟수'),
      metric('참여율', percent(summary.engagementRate), '참여 세션 ' + count(summary.engagedSessions)),
      metric('평균 세션 시간', duration(summary.averageSessionDuration), '방문 전체의 지속시간'),
      metric('조회수', count(summary.screenPageViews), '페이지 · 화면 조회'),
      metric('GA4 구매', observed ? count(summary.ecommercePurchases) : '수신 미확인', observed ? '선택 범위의 구매 이벤트' : '구매 이벤트 확인 필요', !observed),
      metric('GA4 구매매출', observed ? currency(summary.purchaseRevenue, report.currencyCode) : '수신 미확인', observed ? '통화 ' + (report.currencyCode || '미확인') : '실제 주문매출과 별도', !observed)
    );
    notice('ga4-purchase-status', observed
      ? '이 기간 속성 전체에서 purchase 이벤트 ' + count(report.purchaseTracking.eventCount) + '건을 수신했습니다. 위 구매 지표는 선택한 유입 범위의 값입니다. 주문 누락·중복과 금액의 정확성은 별도 확인이 필요합니다.'
      : '구매 수신 미확인 · 이 기간 속성 전체에서 purchase 이벤트가 확인되지 않았습니다. 실제 주문이 없었다는 뜻은 아닙니다. 구매 추적 설정과 보고서 반영 여부를 확인하세요.', observed ? 'info' : 'warning');
    const warnings = Array.isArray(report.warnings) ? report.warnings.filter(item => typeof item === 'string' && item) : [];
    $('ga4-warning-list').replaceChildren(...warnings.map(item => node('li', item)));
    $('ga4-warnings').hidden = !warnings.length;
    $('ga4-no-data').hidden = !(number(summary.sessions) === 0);
    $('ga4-report-status').textContent = (report.cached ? '저장된 조회 결과 · ' : 'Google에서 가져옴 · ') + localDate(report.fetchedAt);
    renderAcquisition();
    renderLanding();
  }

  function rowsFor(type) {
    if (!state.report) return [];
    const list = type === 'acquisition' ? state.report.acquisition : state.report.landingPages;
    const needle = $(type === 'acquisition' ? 'ga4-acquisition-search' : 'ga4-landing-search').value.trim().toLocaleLowerCase('ko-KR');
    const sort = $(type === 'acquisition' ? 'ga4-acquisition-sort' : 'ga4-landing-sort').value;
    return (Array.isArray(list) ? list : []).filter(row => {
      if (!needle) return true;
      const values = type === 'acquisition' ? [row.source, row.medium, row.campaign, row.campaignId, row.adContent, row.adsetId, row.metaAdName] : [row.landingPage];
      return values.some(value => text(value).toLocaleLowerCase('ko-KR').includes(needle));
    }).slice().sort((a, b) => (number(b[sort]) || 0) - (number(a[sort]) || 0));
  }

  function pageRows(type, rows) {
    const key = type === 'acquisition' ? 'acquisitionPage' : 'landingPage';
    state[key] = Math.min(state[key], Math.max(0, Math.ceil(rows.length / pageSize) - 1));
    const start = state[key] * pageSize;
    const end = Math.min(start + pageSize, rows.length);
    $('ga4-' + type + '-page-status').textContent = rows.length ? count(rows.length) + '개 중 ' + count(start + 1) + '–' + count(end) + '개 · ' + count(state[key] + 1) + '/' + count(Math.ceil(rows.length / pageSize)) + ' 페이지' : '표시할 행이 없습니다.';
    $('ga4-' + type + '-prev').disabled = state[key] === 0;
    $('ga4-' + type + '-next').disabled = end >= rows.length;
    const field = type === 'acquisition' ? 'acquisition' : 'landingPages';
    const sourceRows = state.report[field] || [];
    const total = state.report.rowCounts && number(state.report.rowCounts[field]) != null ? state.report.rowCounts[field] : sourceRows.length;
    const truncated = state.report.truncated && state.report.truncated[field];
    $('ga4-' + type + '-total').textContent = truncated ? '전체 ' + count(total) + '개 중 세션 기준 상위 ' + count(sourceRows.length) + '개 수신' : '전체 ' + count(total) + '개';
    return rows.slice(start, end);
  }

  function emptyRow(columns) {
    const tr = node('tr');
    const td = node('td', '조회된 행이 없거나 검색 조건에 맞는 결과가 없습니다.', 'ga4-empty-cell');
    td.colSpan = columns;
    tr.append(td);
    return tr;
  }

  function purchases(value) {
    return purchaseObserved() ? count(value) : '미확인';
  }

  function renderAcquisition() {
    if (!state.report) return;
    const rows = pageRows('acquisition', rowsFor('acquisition'));
    const body = $('ga4-acquisition-body');
    const output = rows.map(row => {
      const tr = node('tr');
      const source = node('td');
      source.append(node('span', row.source || '(not set)'), node('small', row.medium || '(not set)'));
      const campaign = node('td');
      campaign.append(node('span', missing(row.campaign) ? '캠페인 미지정' : row.campaign));
      if (!missing(row.campaignId)) campaign.append(node('small', 'ID ' + text(row.campaignId)));
      const ad = node('td');
      const hasUtm = !missing(row.adContent);
      ad.append(node('span', row.metaAdName || (hasUtm ? text(row.adContent) : '광고 ID 없음')));
      if (row.metaAdName && hasUtm) ad.append(node('small', 'ID ' + text(row.adContent)));
      const matched = row.metaMatch === 'matched';
      const badge = node('span', matched ? 'Meta 광고 연결' : hasUtm ? 'UTM 값 · 광고명 미연결' : '광고 ID 없음', 'ga4-row-badge');
      if (matched) badge.dataset.tone = 'success';
      ad.append(document.createElement('br'), badge);
      tr.append(source, campaign, ad, node('td', count(row.sessions)), node('td', count(row.activeUsers)), node('td', percent(row.engagementRate)), node('td', duration(row.averageSessionDuration)), node('td', purchases(row.ecommercePurchases)));
      return tr;
    });
    body.replaceChildren(...(output.length ? output : [emptyRow(8)]));
  }

  function renderLanding() {
    if (!state.report) return;
    const rows = pageRows('landing', rowsFor('landing'));
    const output = rows.map(row => {
      const tr = node('tr');
      tr.append(node('td', missing(row.landingPage) ? '첫 페이지 미확인' : row.landingPage), node('td', count(row.sessions)), node('td', percent(row.engagementRate)), node('td', duration(row.averageSessionDuration)), node('td', purchases(row.ecommercePurchases)));
      return tr;
    });
    $('ga4-landing-body').replaceChildren(...(output.length ? output : [emptyRow(5)]));
  }

  async function loadReport(refresh) {
    if (!state.configured || state.busy) return;
    let period;
    try { period = validPeriod(); }
    catch (error) { notice('ga4-report-error', error.message, 'error'); return; }
    clearReport('GA4 데이터를 조회하고 있습니다…');
    const sequence = state.sequence;
    const controller = new AbortController();
    state.controller = controller;
    state.loading = true;
    $('ga4-empty-title').textContent = 'GA4 데이터를 조회하고 있습니다…';
    actionState();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 90000);
    try {
      const query = new URLSearchParams(period);
      if (refresh) query.set('refresh', '1');
      const report = await api('/api/ga4/report?' + query.toString(), { signal: controller.signal });
      if (sequence !== state.sequence) return;
      renderReport(report);
    } catch (error) {
      if (sequence !== state.sequence) return;
      const message = timedOut ? '조회 시간이 길어지고 있습니다. 잠시 후 다시 조회하거나 기간을 줄여 주세요.' : error.name === 'AbortError' ? '조회가 취소되었습니다.' : error.message;
      notice('ga4-report-error', message, 'error');
      $('ga4-empty-title').textContent = '데이터를 가져오지 못했습니다.';
      $('ga4-report-status').textContent = '조회 실패 · 연결과 선택 기간을 확인하세요.';
    } finally {
      clearTimeout(timer);
      if (sequence === state.sequence) {
        state.controller = null;
        state.loading = false;
        actionState();
      }
    }
  }

  async function saveConnection(event) {
    event.preventDefault();
    if (state.busy) return;
    const propertyId = $('ga4-property-id').value.trim();
    let file = $('ga4-key-file').files[0];
    if (!/^\d+$/.test(propertyId)) { notice('ga4-connection-message', 'GA4 속성 ID에 숫자를 입력하세요.', 'error'); return; }
    if (!file || !/\.json$/i.test(file.name)) { $('ga4-key-file').value = ''; notice('ga4-connection-message', '내려받은 서비스 계정 .json 파일을 선택하세요.', 'error'); return; }
    if (file.size > 65536) { $('ga4-key-file').value = ''; notice('ga4-connection-message', '인증파일이 64KB를 초과합니다. 서비스 계정 JSON 파일인지 확인하세요.', 'error'); return; }
    state.connectionRevision += 1;
    clearReport();
    state.busy = true;
    actionState();
    notice('ga4-connection-message', 'GA4 접근 권한을 확인한 뒤 암호화해 저장합니다…');
    let credentials = '';
    let success = false;
    try {
      credentials = await file.text();
      const status = await post('/api/ga4/credentials', { propertyId, credentials });
      connectionStatus(status);
      notice('ga4-connection-message', '연결을 확인하고 저장했습니다. 선택 기간 데이터를 가져옵니다.', 'success');
      success = true;
    } catch (error) {
      $('ga4-connection').open = true;
      notice('ga4-connection-message', error.name === 'TimeoutError' ? '연결 확인 시간이 초과되었습니다. 잠시 후 연결 상태를 다시 확인하세요.' : error.message, 'error');
    } finally {
      credentials = '';
      file = null;
      $('ga4-key-file').value = '';
      state.busy = false;
      actionState();
    }
    if (success) await loadReport(false);
  }

  async function testConnection() {
    if (state.busy || !state.configured) return;
    state.connectionRevision += 1;
    state.busy = true;
    actionState();
    notice('ga4-connection-message', 'Google에서 GA4 보고서 접근 권한을 확인합니다…');
    try {
      const status = await post('/api/ga4/test');
      connectionStatus(status);
      $('ga4-connection').open = true;
      notice('ga4-connection-message', 'GA4 보고서 조회 권한을 확인했습니다.', 'success');
    } catch (error) {
      $('ga4-connection-badge').textContent = '연결 확인 필요';
      $('ga4-connection-badge').dataset.tone = 'error';
      notice('ga4-connection-message', error.name === 'TimeoutError' ? '연결 확인 시간이 초과되었습니다. 잠시 후 다시 시도하세요.' : error.message, 'error');
    } finally { state.busy = false; actionState(); }
  }

  async function disconnect() {
    if (state.busy || !state.configured) return;
    if (!window.confirm('이 PC에 저장한 GA4 연결과 인증정보를 삭제할까요?')) return;
    state.connectionRevision += 1;
    clearReport();
    state.busy = true;
    actionState();
    try {
      const status = await post('/api/ga4/disconnect');
      connectionStatus({ ...status, configured: false });
      $('ga4-key-file').value = '';
      clearReport();
      notice('ga4-connection-message', '이 PC의 GA4 연결과 저장된 인증정보를 삭제했습니다.', 'success');
    } catch (error) { notice('ga4-connection-message', error.name === 'TimeoutError' ? '요청 시간이 초과되었습니다. 페이지를 새로 열어 연결 상태를 확인하세요.' : error.message, 'error'); }
    finally { state.busy = false; actionState(); }
  }

  function selectionChanged(clearPreset) {
    if (clearPreset) document.querySelectorAll('[data-ga4-days]').forEach(button => button.classList.remove('active'));
    clearReport(state.configured ? '조회 조건이 바뀌었습니다. 기간 조회를 눌러 확인하세요.' : 'GA4를 연결하면 조회할 수 있습니다.');
  }

  $('ga4-connect-form').addEventListener('submit', saveConnection);
  $('ga4-test').addEventListener('click', testConnection);
  $('ga4-disconnect').addEventListener('click', disconnect);
  $('ga4-report-form').addEventListener('submit', event => { event.preventDefault(); loadReport(false); });
  $('ga4-refresh').addEventListener('click', () => loadReport(true));
  $('ga4-since').addEventListener('change', () => selectionChanged(true));
  $('ga4-until').addEventListener('change', () => selectionChanged(true));
  $('ga4-scope').addEventListener('change', () => selectionChanged(false));
  document.querySelectorAll('[data-ga4-days]').forEach(button => button.addEventListener('click', () => { selectDays(Number(button.dataset.ga4Days)); selectionChanged(false); if (state.configured) loadReport(false); }));
  for (const type of ['acquisition', 'landing']) {
    const render = type === 'acquisition' ? renderAcquisition : renderLanding;
    const pageKey = type === 'acquisition' ? 'acquisitionPage' : 'landingPage';
    $('ga4-' + type + '-search').addEventListener('input', () => { state[pageKey] = 0; render(); });
    $('ga4-' + type + '-sort').addEventListener('change', () => { state[pageKey] = 0; render(); });
    $('ga4-' + type + '-prev').addEventListener('click', () => { state[pageKey] = Math.max(0, state[pageKey] - 1); render(); });
    $('ga4-' + type + '-next').addEventListener('click', () => { state[pageKey] += 1; render(); });
  }
  selectDays(7);
  $('ga4-since').max = $('ga4-until').max = todaySeoul();
  const initialConnectionRevision = state.connectionRevision;
  api('/api/ga4/status', { signal: AbortSignal.timeout(15000) }).then(status => {
    if (initialConnectionRevision !== state.connectionRevision) return;
    connectionStatus(status);
    if (state.configured) return loadReport(false);
  }).catch(error => {
    if (initialConnectionRevision !== state.connectionRevision) return;
    $('ga4-connection-badge').textContent = '연결 상태 확인 필요';
    $('ga4-connection-badge').dataset.tone = 'error';
    $('ga4-connection-summary').textContent = '서버 연결을 확인하세요.';
    notice('ga4-connection-message', error.name === 'TimeoutError' ? '프로그램 서버의 응답이 늦습니다. 프로그램 실행 상태를 확인하세요.' : error.message, 'error');
    actionState();
  });
})();
