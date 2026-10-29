(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const view = document.body.dataset.coupangView;
  const channels = { all: '전체 배송', growth: '로켓그로스', seller: '판매자배송' };
  const sourceNames = { sellha: '셀하 손익 파일', ledger: '확인한 매출·비용', api: 'API 주문 · 반품 미확정', missing: '자료 없음', reconciled: '확인한 일별 합계' };
  const moneyFields = new Set(['sales', 'profitBeforeAds', 'sourceNetProfit', 'advertising', 'adSales', 'adProfitBeforeAds', 'adNetProfit', 'netProfit', 'unitCost', 'salePrice', 'otherCosts', 'acquisitionAdvertising', 'nonAdvertisingCosts', 'estimatedProfitBeforeAds']);
  const summable = ['quantity', 'adQuantity', 'organicQuantity', 'sales', 'profitBeforeAds', 'sourceNetProfit', 'advertising', 'adSales', 'adProfitBeforeAds', 'adNetProfit', 'netProfit', 'nonAdvertisingCosts', 'estimatedProductCost', 'estimatedCommission', 'estimatedFulfillment', 'estimatedProfitBeforeAds'];
  const series = [
    { key: 'sales', label: '매출', color: '#508fd1' },
    { key: 'profitBeforeAds', label: '이익금 · 광고비 차감 전', color: '#d75c78' },
    { key: 'advertising', label: '매출성장 광고비', color: '#c29b28' },
    { key: 'sourceNetProfit', label: '매출성장 차감 순이익', color: '#25966c' },
    { key: 'acquisitionAdvertising', label: '신규구매 광고비', color: '#dd874c' },
    { key: 'netProfit', label: '전체 광고비 반영 순이익', color: '#166974' },
    { key: 'estimatedProfitBeforeAds', label: '예상 이익 · 광고비 차감 전', color: '#8a70c8' }
  ];
  const columns = [
    { key: 'inventory', label: '재고', note: '현재 수집 자료에 재고가 없으면 표시하지 않습니다.' },
    { key: 'quantity', label: '판매량' }, { key: 'adQuantity', label: '광고 판매량' }, { key: 'organicQuantity', label: '일반 판매량' },
    { key: 'sales', label: '할인 후 매출' }, { key: 'profitBeforeAds', label: '이익금', note: '매출성장 광고비 차감 전 · 원가 및 기타비용 반영' },
    { key: 'nonAdvertisingCosts', label: '광고 외 비용 합계', note: '할인 후 매출 − 이익금. 원가·수수료 등의 합계이며 항목별 확정 비용은 아닙니다.' },
    { key: 'sourceNetProfit', label: '셀하 순이익', note: '이익금 − 매출성장 광고비. 신규고객확보 광고비 제외' },
    { key: 'advertising', label: '매출성장 광고비' }, { key: 'adSales', label: '광고 집행 매출' },
    { key: 'roas', label: '광고 ROAS', note: '광고 집행 매출 ÷ 매출성장 광고비 × 100' },
    { key: 'adProfitBeforeAds', label: '광고 집행 이익금' }, { key: 'adNetProfit', label: '광고 집행 순이익', note: '광고 집행 이익금 − 매출성장 광고비. 신규고객확보 광고비 제외' },
    { key: 'adReturnOnSpend', label: '광고 집행 순이익률', note: '광고 집행 순이익 ÷ 광고 집행비 × 100. 광고비가 0이면 미확인' },
    { key: 'unitCost', label: '개당 원가' }, { key: 'salePrice', label: '등록 판매가' },
    { key: 'estimatedProductCost', label: '예상 상품원가' }, { key: 'estimatedCommission', label: '예상 수수료' },
    { key: 'estimatedFulfillment', label: '예상 입출고·배송비' },
    { key: 'estimatedProfitBeforeAds', label: '예상 이익 · 광고비 차감 전', note: '저장된 판매금액 − 등록 원가 − 예상 수수료 − 예상 입출고·배송비. 광고비·반품·추가 정산비용 미확정' }
  ];
  ['estimatedProductCost', 'estimatedCommission', 'estimatedFulfillment', 'estimatedProfitBeforeAds'].forEach(k => moneyFields.add(k));
  const defaultColumns = columns.filter(c => !['salePrice'].includes(c.key)).map(c => c.key);
  let report = null, groups = [], pendingImport = null, loading = false, loadSequence = 0, parseSequence = 0, importSaving = false;
  let savedGroups = [];
  let pipelinePending = false, pipelineRefreshing = false, pipelineNeedsReload = false, pipelineTimer = null, pipelineStopped = false, pipelineStatus = null, lastRefreshFinishedAt = undefined, lastAdvertisingRevision = undefined;
  let historyActionPending = false, historyRequestError = '', lastHistoryStamp = undefined;
  let productDailyPage = 0, productDailyCache = null;
  const productDailyPageSize = 100;
  let expanded = new Set(), favoriteIds = new Set(readSetting('favorites', [])), visibleColumns = new Set(readSetting('columns', defaultColumns));
  const activeSeries = new Set(series.map(s => s.key));
  const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const isNumber = value => typeof value === 'number' && Number.isFinite(value);
  const number = value => isNumber(value) ? Math.round(value).toLocaleString('ko-KR') : '—';
  const won = value => isNumber(value) ? number(value) + '원' : '—';
  const percent = value => isNumber(value) ? value.toLocaleString('ko-KR', { maximumFractionDigits: 2 }) + '%' : '—';
  const sum = (rows, key) => rows.length && rows.every(row => isNumber(row[key])) ? rows.reduce((total, row) => total + row[key], 0) : null;
  const valueText = (value, key) => ['roas', 'adReturnOnSpend'].includes(key) ? percent(value) : moneyFields.has(key) ? won(value) : number(value);
  function displayedValue(row, key) {
    if (isNumber(row?.[key])) return row[key];
    return ['sales', 'quantity'].includes(key) && isNumber(row?.available?.[key]) ? row.available[key] : row?.[key];
  }
  function isPartialValue(row, key) { return ['sales', 'quantity'].includes(key) && !isNumber(row?.[key]) && isNumber(row?.available?.[key]); }
  function availableSum(rows, key) {
    const values = rows.map(row => displayedValue(row, key)).filter(isNumber);
    return values.length ? values.reduce((total, value) => total + value, 0) : null;
  }
  function salesStatus(row) { return isPartialValue(row, 'sales') ? '수집분 · 일부 미수집' : isNumber(displayedValue(row, 'sales')) ? '전체 조회 범위 확인' : '자료 없음'; }
  function readSetting(key, fallback) {
    try { const value = JSON.parse(localStorage.getItem('roas-coupang-analytics-' + key)); return Array.isArray(value) && value.every(x => typeof x === 'string') ? value : fallback; }
    catch (_) { return fallback; }
  }
  function saveSetting(key, value) { try { localStorage.setItem('roas-coupang-analytics-' + key, JSON.stringify(value)); } catch (_) {} }
  function element(tag, text, className) {
    const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node;
  }
  function message(text, error = false) { $('ca-message').textContent = text; $('ca-message').dataset.error = String(error); }
  function dateShift(date, days) { return new Date(Date.parse(date) + days * 86400000).toISOString().slice(0, 10); }
  function queryValues() { return { since: $('ca-since').value, until: $('ca-until').value, channel: $('ca-channel').value }; }
  function queryString() {
    const values = new URLSearchParams(queryValues()), group = $('ca-group')?.value || (view === 'dashboard' ? new URLSearchParams(location.search).get('group') : '');
    if (group) values.set('group',group);
    return values.toString();
  }
  function estimateMissingText(row) {
    const reasons = Array.isArray(row?.missingInputReasons) ? row.missingInputReasons.filter(value => typeof value === 'string') : [];
    if (reasons.length) return '계산 대기 · ' + reasons.slice(0, 3).join(' · ') + (reasons.length > 3 ? ' 외' : '');
    const names = { orders: '주문 미수집', unitCost: '상품 원가 미등록', costSince: '해당 날짜 원가 미등록', commissionRate: '수수료율 미등록', inboundFee: '입출고 요금 미등록', deliveryFee: '배송비 미등록' };
    const inputs = Array.isArray(row?.missingInputs) ? row.missingInputs : [];
    return inputs.length ? '계산 대기 · ' + [...new Set(inputs.map(key => names[key]).filter(Boolean))].join(' · ') : '저장된 주문과 등록 원가·수수료·배송비가 필요합니다.';
  }
  function costWarningText(row) {
    const warnings = Array.isArray(row?.costWarnings) ? row.costWarnings.filter(value => typeof value === 'string' && value) : [];
    if (warnings.length) return [...new Set(warnings)].join(' · ');
    const ids = Array.isArray(row?.zeroCostItemIds) ? [...new Set(row.zeroCostItemIds)] : [];
    return ids.length ? '원본 원가 0원 옵션 ' + ids.length + '개 · 원본의 0원을 적용한 참고 계산이며 실제 원가 확인이 필요합니다.' : '';
  }
  function localTimestamp(value) {
    const time = typeof value === 'string' ? Date.parse(value) : NaN;
    return Number.isFinite(time) ? new Date(time).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '아직 없음';
  }
  function pipelineState(status) {
    const automatic = status?.automatic || {}, history = status?.history || {};
    const running = status?.busy === true || automatic.running === true || history.running === true;
    const channelErrors = Object.entries(automatic.channels || {}).filter(([, value]) => value?.status === 'failed').map(([key, value]) => (channels[key] || key) + ': ' + (value.error || '수집 실패'));
    const error = typeof automatic.error === 'string' && automatic.error ? automatic.error : channelErrors.join(' · ');
    const title = !status?.configured ? '쿠팡 연결 필요' : history.running === true ? '과거 주문 수집·저장 중' : running ? '주문 수집·저장 중' : automatic.status === 'partial' ? '일부 저장 완료 · 오류 확인' : automatic.status === 'failed' || automatic.status === 'paused' ? '최근 갱신 중단 · 오류 확인' : automatic.enabled === false ? '자동 갱신 꺼짐' : '최근 7일 매시간 자동 저장';
    const verified = new Map();
    for (const channel of Object.values(automatic.channels || {})) for (const [field, priority] of [['unchangedDays', 1], ['newDays', 2], ['changedDays', 3]]) {
      for (const date of Array.isArray(channel?.verification?.[field]) ? channel.verification[field] : []) {
        if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && priority > (verified.get(date) || 0)) verified.set(date, priority);
      }
    }
    const datesFor = priority => [...verified].filter(([, value]) => value === priority).map(([date]) => date).sort();
    const newDates = datesFor(2), changedDates = datesFor(3), sameDates = datesFor(1);
    const verification = verified.size ? '확인 결과 · 신규 저장 ' + newDates.length + '일 · 변경 ' + changedDates.length + '일' + (changedDates.length ? ' (' + changedDates.map(date => date.slice(5)).join(', ') + ')' : '') + ' · 동일 ' + sameDates.length + '일 · 배송 방식별 확인분, 날짜 중복 제외' : '';
    return { running, title, error, disabled: !status?.configured || running, finishedAt: automatic.lastFinishedAt || null,
      detail: '최근 실행 ' + localTimestamp(automatic.lastStartedAt) + ' · 최근 완료 ' + localTimestamp(automatic.lastCompletedAt) + (automatic.enabled === false ? '' : ' · 다음 확인 ' + localTimestamp(automatic.nextRunAt)),
      range: automatic.since && automatic.until ? '갱신 대상 ' + automatic.since + ' ~ ' + automatic.until : '오늘을 포함한 최근 7일을 갱신합니다.', verification };
  }
  function renderStorageInfo() {
    const host = $('ca-storage-status'); if (!host) return;
    const storage = report?.storage;
    host.textContent = storage ? '선택 기간 저장 ' + (storage.storedDays || 0) + '/' + (storage.expectedDays || 0) + '일·배송방식 · 최근 저장 주문일 ' + (storage.latestOrderDate || '아직 없음') + ' · 마지막 저장 ' + localTimestamp(storage.lastSavedAt) : '선택 기간의 저장 범위를 확인합니다.';
    const note = $('ca-estimate-status'); if (!note) return;
    const summary = report?.summary || {};
    note.textContent = (isNumber(summary.estimatedProfitBeforeAds) ? '예상 이익 = 저장된 판매금액 − 등록 상품원가 − 예상 수수료 − 예상 입출고·배송비. 광고비·반품·보관비·추가 정산비용은 미확정입니다.' : estimateMissingText(summary)) + (!isNumber(report?.dailyReportSummary?.advertising ?? summary.advertising) ? ' 매출성장 광고비가 연결되지 않아 순이익 계산을 기다립니다.' : ' 매출성장 차감 순이익과 신규구매 광고비까지 반영한 순이익을 구분해 표시합니다.');
    const costWarning = costWarningText(summary); if (costWarning) note.textContent += ' ' + costWarning;
  }
  function renderPipeline(status) {
    pipelineStatus = status;
    const state = pipelineState(status), host = $('ca-auto-state'); if (!host) return state;
    host.textContent = state.title; host.dataset.error = String(!!state.error);
    $('ca-auto-detail').textContent = state.range + ' · ' + state.detail + (state.verification ? '\n' + state.verification : '');
    $('ca-auto-error').textContent = state.error; $('ca-auto-error').hidden = !state.error;
    $('ca-refresh-orders').disabled = pipelineRefreshing || historyActionPending || state.disabled;
    renderHistory(status, state);
    return state;
  }
  function renderHistory(status, state = pipelineState(status)) {
    const host = $('ca-history-state'); if (!host) return;
    const job = status?.history || {}, names = { idle: '아직 시작하지 않음', running: '수집 중', completed: '전체 수집 완료', partial: '일부 저장 · 오류 확인', failed: '수집 중단 · 오류 확인', paused: '수집 일시정지' };
    const total = Number.isFinite(job.totalDays) ? Math.max(0, job.totalDays) : 0, done = Number.isFinite(job.completedDays) ? Math.max(0, job.completedDays) : 0;
    host.textContent = !status?.configured ? '쿠팡 연결 후 과거 주문을 수집할 수 있습니다.' : (names[job.status] || '상태 확인') + (total ? ' · 저장/확인 ' + done + '/' + total + '일·배송방식' : '');
    const progress = $('ca-history-progress'); if (progress) { progress.max = Math.max(1, total); progress.value = Math.min(done, total); progress.hidden = !total; }
    const failures = Array.isArray(job.failures) && job.failures.length ? job.failures : job.lastFailure ? [job.lastFailure] : [];
    const detail = [job.since && job.until ? '대상 ' + job.since + ' ~ ' + job.until : '오늘 포함 최근 365일 · 판매자배송 + 로켓그로스', job.current ? (channels[job.current.channel] || '주문') + ' ' + job.current.since + ' ~ ' + job.current.until : '', job.skippedDays ? '기존 저장분 ' + job.skippedDays + '일·배송방식 재사용' : '', job.pauseRequested && job.running ? '현재 구간 저장 후 중지합니다.' : ''].filter(Boolean).join(' · ');
    if ($('ca-history-detail')) $('ca-history-detail').textContent = detail;
    const error = [historyRequestError, job.error || '', ...failures.map(failure => {
      const diagnosis = failure.diagnosis;
      return [failure.since && failure.until ? '오류 구간: ' + (channels[failure.channel] || '주문') + ' ' + failure.since + ' ~ ' + failure.until : '', diagnosis ? [Number.isInteger(diagnosis.httpStatus) ? 'HTTP ' + diagnosis.httpStatus : '', diagnosis.message || diagnosis.category || '', diagnosis.action || ''].filter(Boolean).join(' · ') : failure.error || ''].filter(Boolean).join(' · ');
    })].filter(Boolean).join('\n');
    if ($('ca-history-error')) { $('ca-history-error').textContent = error; $('ca-history-error').hidden = !error; }
    if ($('ca-history-start')) $('ca-history-start').disabled = pipelineRefreshing || historyActionPending || state.disabled;
    if ($('ca-history-resume')) $('ca-history-resume').disabled = pipelineRefreshing || historyActionPending || state.disabled || !['failed', 'paused', 'partial'].includes(job.status);
    if ($('ca-history-pause')) $('ca-history-pause').disabled = historyActionPending || !job.running || !!job.pauseRequested;
  }
  async function historyAction(action) {
    if (pipelineRefreshing || historyActionPending || !pipelineStatus?.configured) return;
    if (action === 'pause' ? !pipelineStatus.history?.running : pipelineState(pipelineStatus).running) return;
    historyActionPending = true; historyRequestError = ''; renderPipeline(pipelineStatus);
    try {
      const job = await request(action === 'pause' ? 'history-pause' : 'history', action === 'pause' ? {} : action === 'resume' ? { resume: true } : { mode: 'maximum' });
      renderPipeline({ ...pipelineStatus, busy: job.running === true, history: job });
      message(action === 'pause' ? '현재 구간을 저장한 후 과거 수집을 중지합니다. 저장된 자료는 유지됩니다.' : job.status === 'completed' ? '과거 주문의 저장 상태를 확인했습니다. 저장 자료를 다시 조회합니다.' : '과거 주문을 7일씩 나누어 수집합니다. 저장된 구간은 유지하며, ROAS Pilot 프로그램을 실행해 두면 계속 진행합니다.');
      pipelineNeedsReload = true; await loadPipelineStatus();
    } catch (error) { historyRequestError = error.message; message(error.message, true); }
    finally { historyActionPending = false; renderPipeline(pipelineStatus); schedulePipeline(pipelineState(pipelineStatus).running || pipelineNeedsReload); }
  }
  function schedulePipeline(running) {
    clearTimeout(pipelineTimer);
    if (!pipelineStopped && !document.hidden) pipelineTimer = setTimeout(loadPipelineStatus, running ? 5000 : 60000);
  }
  async function loadPipelineStatus() {
    if (pipelinePending || pipelineStopped || !$('ca-auto-state')) return;
    pipelinePending = true;
    try {
      const wasRunning = pipelineState(pipelineStatus).running, state = renderPipeline(await request('status'));
      const changed = lastRefreshFinishedAt !== undefined && (state.finishedAt && state.finishedAt !== lastRefreshFinishedAt || wasRunning && !state.running && state.finishedAt);
      lastRefreshFinishedAt = state.finishedAt;
      const job = pipelineStatus?.history || {}, historyStamp = [job.id || '', job.status || '', job.completedDays || 0].join(':');
      const historyChanged = lastHistoryStamp !== undefined && lastHistoryStamp !== historyStamp;
      lastHistoryStamp = historyStamp;
      const revision = pipelineStatus?.advertisingRevision;
      const hasRevision = revision === null || typeof revision === 'string';
      const advertisingChanged = hasRevision && lastAdvertisingRevision !== undefined && revision !== lastAdvertisingRevision;
      if (hasRevision) lastAdvertisingRevision = revision;
      if (changed || historyChanged || advertisingChanged) pipelineNeedsReload = true;
      if (pipelineNeedsReload && !loading && !importSaving) { pipelineNeedsReload = false; await load(); }
      schedulePipeline(state.running || pipelineNeedsReload);
    } catch (error) {
      $('ca-auto-state').textContent = '자동 저장 상태 확인 필요'; $('ca-auto-error').textContent = error.message; $('ca-auto-error').hidden = false; $('ca-refresh-orders').disabled = true; schedulePipeline(false);
    } finally { pipelinePending = false; }
  }
  function handleAdvertisingStorage(event) {
    if (event.key !== 'roas-coupang-ad-reports-change' || !event.newValue) return;
    let change; try { change = JSON.parse(event.newValue); } catch (_) { return; }
    const { since, until } = queryValues();
    if (!Array.isArray(change?.dates) || !change.dates.some(date => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= since && date <= until)) return;
    pipelineNeedsReload = true;
    if (!loading && !importSaving) { pipelineNeedsReload = false; load(); } else schedulePipeline(true);
  }
  async function refreshOrders() {
    if (pipelineRefreshing || pipelineState(pipelineStatus).disabled) return;
    pipelineRefreshing = true; $('ca-refresh-orders').disabled = true;
    try {
      const result = await request('refresh', {});
      if (result.automatic) renderPipeline({ ...pipelineStatus, busy: result.started === true, automatic: result.automatic });
      message(result.started === false ? '진행 중인 수집이 있습니다. 저장된 자료는 계속 조회할 수 있습니다.' : '최근 7일 주문 수집·저장을 시작했습니다. 완료되면 저장 자료로 다시 계산합니다.');
      await loadPipelineStatus();
    } catch (error) { message(error.message, true); $('ca-auto-error').textContent = error.message; $('ca-auto-error').hidden = false; }
    finally { pipelineRefreshing = false; if (pipelineStatus) renderPipeline(pipelineStatus); schedulePipeline(pipelineState(pipelineStatus).running); }
  }
  async function request(route, body) {
    const response = await fetch('/api/coupang/' + route, body === undefined ? { credentials: 'same-origin' } : {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-ROAS-Local-Action': 'yes' }, body: JSON.stringify(body)
    });
    let value; try { value = await response.json(); } catch (_) { throw Error('서버 응답을 읽을 수 없습니다. ROAS Pilot 프로그램을 확인해 주세요.'); }
    if (!response.ok) throw Error(value.error || '쿠팡 자료를 불러오지 못했습니다.'); return value;
  }
  function updateLinks() {
    document.querySelectorAll('.ca-subnav a').forEach(link => { const url = new URL(link.href); url.search = queryString(); link.href = url.pathname + url.search; });
    window.ROASCoupangNavigation?.update(new URLSearchParams(queryString()));
  }
  function clearResults() {
    window.CoupangThumbnails?.setContext(null);
    report = null; groups = []; productDailyPage = 0; productDailyCache = null; renderStorageInfo(); $('ca-summary').replaceChildren(); $('ca-coverage').textContent = '선택한 기간으로 저장 자료를 조회해 주세요.';
    if (view === 'dashboard') {
      $('ca-chart').replaceChildren(element('p', '조회한 자료가 여기에 표시됩니다.', 'ca-empty'));
      $('ca-daily-body').replaceChildren(); $('ca-product-daily-body').replaceChildren(); $('ca-chart-tooltip').hidden = true;
      if ($('ca-calculation-date')) { $('ca-calculation-date').replaceChildren(); $('ca-calculation-date').disabled = true; $('ca-calculation-body').replaceChildren(element('p', '저장 자료를 조회하면 날짜별 계산 근거를 확인할 수 있습니다.', 'helper')); }
      if ($('ca-product-pagination')) $('ca-product-pagination').replaceChildren();
    } else { $('ca-sales-body').replaceChildren(); $('ca-sales-count').textContent = ''; }
  }
  function validateQuery() {
    const { since, until } = queryValues();
    const valid = date => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
    if (!valid(since) || !valid(until) || since > until || until > today || Date.parse(until) - Date.parse(since) >= 366 * 86400000) throw Error('조회 기간은 미래 날짜를 제외하고 최대 366일로 선택해 주세요.');
  }
  async function load() {
    try { validateQuery(); } catch (error) { message(error.message, true); return; }
    const sequence = ++loadSequence; loading = true; clearResults(); updateLinks();
    const submit = $('ca-query').querySelector('[type="submit"]'); if (submit) submit.disabled = true;
    message('저장된 쿠팡 자료를 불러옵니다.');
    try {
      const results = await Promise.allSettled([request('analytics?' + queryString() + '&view=' + encodeURIComponent(view)), ...(view === 'sales' ? [request('workspace')] : [])]);
      if (sequence !== loadSequence) return;
      if (results[0].status === 'rejected') throw results[0].reason;
      report = results[0].value; window.CoupangThumbnails?.setContext(report);
      if (view === 'sales') updateGroupChoices(results[1]);
      render(); renderStorageInfo(); updateLinks(); history.replaceState(null, '', location.pathname + '?' + queryString());
      message(isNumber(displayedValue(report.summary, 'sales')) ? '저장 자료 조회 완료 · ' + report.since + ' ~ ' + report.until + ' · ' + channels[queryValues().channel] + (isPartialValue(report.summary, 'sales') ? ' · 수집된 매출을 먼저 표시합니다. 일부 날짜·배송 방식·상품 자료는 미수집입니다.' : '') : '조회 기간에 저장된 주문이 없습니다. 쿠팡 연결과 집계 상품을 확인한 뒤 최근 7일 주문을 수집·저장해 주세요.');
    } catch (error) {
      if (sequence !== loadSequence) return;
      message(error.message + ' 연결과 집계 상품은 ‘자료·연결 관리’에서 확인할 수 있습니다.', true);
      $('ca-coverage').textContent = '자료를 불러오지 못했습니다. 자료·연결 관리에서 API 연결과 집계 상품을 확인해 주세요.';
    } finally { if (sequence === loadSequence) { loading = false; if (submit) submit.disabled = false; } }
  }
  function setPreset(days) {
    const until = days === 0 ? today : dateShift(today, -1); $('ca-until').value = until;
    $('ca-since').value = days < 2 ? until : dateShift(until, -days + 1); $('ca-month').value = '';
    markPreset(days);
    load();
  }
  function markPreset(days) {
    document.querySelectorAll('[data-ca-preset]').forEach(button => {
      const active = Number(button.dataset.caPreset) === days;
      button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
    });
  }
  function renderCards() {
    const summary = report.summary || {}, host = $('ca-summary'); host.replaceChildren();
    for (const [key, title, note] of [
      ['sales', '매출', '저장된 주문 / 확인한 손익 자료'],
      ['estimatedProfitBeforeAds', 'API 예상 이익 · 광고비 차감 전', '등록 원가·수수료·물류비 반영 · 광고·반품·추가 비용 미확정'],
      ['profitBeforeAds', '이익금', '매출성장 광고비 차감 전'],
      ['advertising', '매출성장 광고비', '저장된 손익 자료 또는 매출성장 보고서'],
      ['sourceNetProfit', '매출성장 차감 순이익', '이익금 − 매출성장 광고비'],
      ['acquisitionAdvertising', '신규구매 광고비', '자동 수집 보고서 또는 일별 확인 비용'],
      ['netProfit', '전체 광고비 반영 순이익', '매출성장 차감 순이익 − 신규구매 광고비']
    ]) {
      const canonical = report.dailyReportSummary, canonicalKey = canonical && Object.hasOwn(canonical, key);
      const partial = canonicalKey ? canonical.partial?.[key] === true : isPartialValue(summary, key), amount = canonicalKey ? isNumber(canonical[key]) ? canonical[key] : isNumber(canonical.available?.[key]) ? canonical.available[key] : null : displayedValue(summary, key);
      const displayTitle = key === 'estimatedProfitBeforeAds' && summary.estimateSource === 'sellha' ? '등록 비용 기준 예상 이익 · 광고비 차감 전' : title;
      const estimated = canonicalKey && canonical.estimated?.[key] === true;
      const card = element('div', undefined, 'ca-card ca-card-' + key), label = element('small', displayTitle + (estimated ? ' · 예상' : '') + (partial ? ' · 수집분' : '')), value = element('strong', won(amount));
      if (isNumber(amount) && amount < 0) value.className = 'ca-negative';
      card.append(label, value, element('small', partial ? '일부 미수집 · 확인된 날짜 금액 합산 / 전체 기간 미확정' : key === 'estimatedProfitBeforeAds' && !isNumber(amount) ? estimateMissingText(summary) : note)); host.append(card);
      const costTypes = key === 'advertising' ? ['pa'] : key === 'acquisitionAdvertising' ? ['nca'] : key === 'netProfit' ? ['pa', 'nca'] : [];
      if (costTypes.some(type => report.daily.some(day => day.dailyReport?.advertisingSources?.[type]?.scope === 'account'))) card.append(element('small', '계정 전체 보고서 비용 · 원본 금액 적용'));
      if (key === 'estimatedProfitBeforeAds' && costWarningText(summary)) card.append(element('small', costWarningText(summary), 'ca-cost-warning'));
    }
    const coverage = report.coverage || {}, imported = Array.isArray(report.importedDates) ? report.importedDates : [];
    const last = report.lastImportedAt ? new Date(report.lastImportedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : null;
    $('ca-coverage').textContent = '조회 ' + report.since + ' ~ ' + report.until + ' · 셀하 파일 ' + (coverage.sellhaDays || 0) + '일 · API 자료 ' + (coverage.apiDays || 0) + '일 / ' + (coverage.totalDays || report.daily.length) + '일' +
      (imported.length ? ' · 셀하 저장 기간 ' + imported[0] + ' ~ ' + imported.at(-1) : ' · 셀하 파일 미등록') + (last ? ' · 마지막 저장 ' + last : '') + (coverage.fileScopeDays > 0 ? ' · 엑셀 포함 옵션 기준 · 기존/추후 추가한 다른 옵션은 해당 원본 합계에 포함하지 않습니다.' : '') + (isNumber(displayedValue(summary, 'sales')) ? ' · 수집된 매출은 누락 자료와 구분해 표시합니다. 미수집 부분은 0원으로 계산하지 않습니다.' : ' · 조회 기간에 저장된 주문·손익 파일이 없습니다. 연결 확인 후 최근 7일 주문 수집·저장을 이용하세요.');
    renderAcquisitionAdjustment();
  }
  function renderAcquisitionAdjustment() {
    const summary = report?.summary || {}, coverage = summary.acquisitionCoverage || {};
    const totals = report?.dailyReportSummary || summary;
    let panel = $('ca-acquisition-adjustment');
    if (!panel) {
      panel = element('section', undefined, 'panel ca-acquisition-panel'); panel.id = 'ca-acquisition-adjustment'; panel.setAttribute('aria-label','신규구매 광고비 반영');
      const filter = document.querySelector('.ca-filter-panel'); if (!filter) return;
      filter.after(panel);
    }
    panel.replaceChildren();
    panel.append(element('h2','신규구매 광고비 반영'));
    const cards = element('div',undefined,'ca-cards');
    for (const [key,label] of [['sourceNetProfit','매출성장 차감 이익'],['acquisitionAdvertising','신규구매 광고비'],['netProfit','전체 광고비 반영 이익']]) {
      const card = element('div',undefined,'ca-card'); card.append(element('small',label),element('strong',won(totals[key]))); cards.append(card);
    }
    panel.append(cards);
    const label = coverage.profitScope === 'file-sales-minus-account-nca' ? '가져온 전체 파일 매출의 이익 − 계정 전체 신규구매 광고비. 파일이 계정 전체 매출인지는 확인되지 않았습니다.' : coverage.profitScope === 'api-scope-minus-account-nca' ? 'API 조회 범위의 추정 이익 − 계정 전체 신규구매 광고비. 조회 범위가 계정 전체 매출인지는 확인되지 않았습니다.' : '기존에 확인한 신규구매 광고비·비용 장부를 우선 적용하며 같은 광고비를 다시 차감하지 않습니다.';
    const note = element('p',label + ' 신규구매 보고서 ' + (coverage.collectedDays || 0) + '/' + (coverage.totalDays || report.daily.length) + '일 · 자동 반영 ' + (coverage.appliedDays || 0) + '일. 상품 그룹과 검색 필터는 이 전체 합계를 변경하지 않습니다.','helper');
    if (!isNumber(totals.netProfit)) note.append(document.createTextNode(' 비용 또는 집계 범위가 확인되지 않은 날짜가 있어 전체 기간 이익은 —로 표시합니다.'));
    if (coverage.differenceDays) note.append(document.createTextNode(' 기존 입력과 수집 보고서의 신규구매 광고비가 다른 날짜가 '+coverage.differenceDays+'일 있습니다. 기존 확인 금액을 우선 적용했습니다.'));
    panel.append(note);
  }
  function sourceBadge(row) {
    const partial = isPartialValue(row, 'sales') || isPartialValue(row, 'quantity');
    const badge = element('span', (sourceNames[row.source] || '혼합 자료') + (partial ? ' · 수집분' : ''), 'ca-source'); badge.dataset.source = row.source || 'mixed';
    if (partial) { badge.classList.add('ca-source-partial'); badge.title = '수집분 · 일부 미수집: 확인된 매출과 수량만 표시합니다.'; }
    return badge;
  }
  function addCell(row, value, className) { const cell = element('td', value, className); row.append(cell); return cell; }
  function appendValueCell(tr, row, key) {
    const value = displayedValue(row, key), td = addCell(tr, valueText(value, key), 'ca-number');
    if (isNumber(value) && value < 0) td.classList.add('ca-negative');
    if (isPartialValue(row, key)) td.append(element('small', '수집분 · 일부 미수집', 'ca-partial-note'));
    if (key === 'estimatedProfitBeforeAds' && !isNumber(value)) { const reason = estimateMissingText(row); td.title = reason; }
    if (['estimatedProductCost', 'estimatedProfitBeforeAds'].includes(key) && costWarningText(row)) { td.title = costWarningText(row); td.append(element('small', '원본 0원 포함 · 확인 필요', 'ca-cost-warning')); }
    return td;
  }
  function noSalesContent() {
    const content = element('div'); content.append(element('p', '조회 기간에 저장된 주문·손익 파일이 없습니다.'));
    const collect = element('a', '주문 수집·연결 관리'); collect.href = '/coupang.html'; content.append(collect); return content;
  }
  function render() {
    renderCards();
    if (view === 'dashboard') { renderChart(); renderDaily(); renderProductDaily(); }
    else { buildGroups(); renderSales(); }
  }
  function svgNode(tag, attributes = {}, text) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value); if (text !== undefined) node.textContent = text; return node;
  }
  function chartDescription(row) { return row.date + ' · ' + series.filter(s => activeSeries.has(s.key)).map(s => s.label + ' ' + won(dailyValue(row, s.key)) + (dailyEstimated(row, s.key) ? ' (예상)' : '') + (isPartialValue(row, s.key) ? ' (수집분 · 일부 미수집)' : '')).join(' · '); }
  function renderChart() {
    const host = $('ca-chart'); host.replaceChildren(); $('ca-chart-tooltip').hidden = true;
    const rows = report.daily || [], chosenSeries = series.filter(s => activeSeries.has(s.key));
    const salesLegend = document.querySelector('[data-ca-series-label="sales"]'); if (salesLegend) salesLegend.textContent = '매출' + (rows.some(row => isPartialValue(row, 'sales')) ? ' · 수집분' : '');
    const values = rows.flatMap(row => chosenSeries.map(s => dailyValue(row, s.key))).filter(isNumber);
    if (!rows.length || !values.length) {
      if (chosenSeries.length && !isNumber(displayedValue(report.summary, 'sales'))) host.append(noSalesContent());
      else host.append(element('p', chosenSeries.length ? '선택한 지표에 확인된 값이 없습니다. 매출 지표를 선택하거나 손익 파일을 가져와 주세요.' : '표시할 지표를 선택해 주세요.', 'ca-empty'));
      return;
    }
    const width = 600, height = 380, left = 82, right = 22, top = 20, bottom = 45;
    const min = Math.min(0, ...values), maximum = Math.max(0, ...values), span = maximum - min || 1;
    const yMin = min < 0 ? min - span * .06 : 0, yMax = maximum + span * .08, yRange = yMax - yMin;
    const x = index => left + (width - left - right) * (rows.length === 1 ? .5 : index / (rows.length - 1));
    const y = value => top + (height - top - bottom) * (yMax - value) / yRange;
    const svg = svgNode('svg', { viewBox: '0 0 ' + width + ' ' + height, role: 'img', 'aria-label': '날짜별 매출과 이익 그래프. 그래프 아래 날짜별 상세 표에서도 값을 확인할 수 있습니다.' });
    for (let i = 0; i <= 4; i++) {
      const value = yMin + yRange * i / 4, position = y(value);
      svg.append(svgNode('line', { x1: left, x2: width - right, y1: position, y2: position, stroke: 'var(--app-chart-grid)', 'stroke-width': 1 }));
      svg.append(svgNode('text', { x: left - 10, y: position + 4, 'text-anchor': 'end' }, number(value)));
    }
    const labelStep = Math.max(1, Math.ceil(rows.length / 8));
    rows.forEach((row, index) => { if (index % labelStep === 0 || index === rows.length - 1) svg.append(svgNode('text', { x: x(index), y: height - 13, 'text-anchor': 'middle' }, row.date.slice(5))); });
    for (const s of chosenSeries) {
      let path = '', running = false;
      rows.forEach((row, index) => {
        const value = dailyValue(row, s.key); if (!isNumber(value)) { running = false; return; }
        path += (running ? ' L ' : ' M ') + x(index) + ',' + y(value); running = true;
      });
      svg.append(svgNode('path', { d: path, stroke: s.color, fill: 'none', 'stroke-width': 2.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
      rows.forEach((row, index) => { const value = dailyValue(row, s.key); if (isNumber(value)) svg.append(svgNode('circle', { cx: x(index), cy: y(value), r: rows.length < 45 ? 3.5 : 1.6, fill: s.color })); });
    }
    const cursor = svgNode('line', { x1: 0, x2: 0, y1: top, y2: height - bottom, stroke: 'var(--app-link)', 'stroke-dasharray': '4 4', visibility: 'hidden' }); svg.append(cursor);
    function show(index) {
      const row = rows[index], tooltip = $('ca-chart-tooltip'); cursor.setAttribute('x1', x(index)); cursor.setAttribute('x2', x(index)); cursor.setAttribute('visibility', 'visible');
      tooltip.replaceChildren(element('strong', row.date));
      for (const s of chosenSeries) { const p = element('div', s.label + '  ' + won(dailyValue(row, s.key)) + (dailyEstimated(row, s.key) ? ' (예상)' : '') + (isPartialValue(row, s.key) ? ' (수집분 · 일부 미수집)' : '')); p.style.borderLeft = '3px solid ' + s.color; p.style.paddingLeft = '8px'; tooltip.append(p); }
      tooltip.hidden = false; $('ca-chart-detail').textContent = chartDescription(row);
    }
    rows.forEach((row, index) => {
      const first = index === 0 ? left : (x(index - 1) + x(index)) / 2, last = index === rows.length - 1 ? width - right : (x(index + 1) + x(index)) / 2;
      const hit = svgNode('rect', { x: first, y: top, width: Math.max(1, last - first), height: height - top - bottom, fill: 'transparent', tabindex: index === 0 ? '0' : '-1', role: 'button', 'aria-label': chartDescription(row), 'data-chart-index': index });
      hit.append(svgNode('title', {}, chartDescription(row)));
      hit.addEventListener('pointerenter', () => show(index)); hit.addEventListener('focus', () => show(index));
      hit.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, index + (event.key === 'ArrowLeft' ? -1 : 1)));
        svg.querySelectorAll('[data-chart-index]').forEach(node => node.setAttribute('tabindex', '-1')); const target = svg.querySelector('[data-chart-index="' + next + '"]'); target.setAttribute('tabindex', '0'); target.focus();
      }); svg.append(hit);
    });
    svg.addEventListener('pointerleave', () => { $('ca-chart-tooltip').hidden = true; cursor.setAttribute('visibility', 'hidden'); });
    host.append(svg); $('ca-chart-detail').textContent = '그래프에 마우스를 올리거나 Tab과 방향키로 날짜별 값을 확인할 수 있습니다. 자료가 없는 날짜의 선은 연결하지 않습니다. 일부 미수집일은 수집된 매출만 표시합니다.';
  }
  const dailyDetailColumns = [
    ['quantity', '판매량'], ['adQuantity', '광고 판매량'], ['organicQuantity', '일반 판매량'], ['sales', '매출'], ['estimatedProductCost', '예상 상품원가'], ['estimatedCommission', '예상 수수료'], ['estimatedFulfillment', '예상 입출고·배송비'], ['estimatedProfitBeforeAds', '예상 이익 · 광고비 차감 전'], ['profitBeforeAds', '이익금'], ['nonAdvertisingCosts', '광고 외 비용 합계'], ['otherCosts', '확인한 기타비용'], ['advertising', '매출성장 광고비'], ['sourceNetProfit', '매출성장 차감 순이익'], ['adSales', '광고 집행 매출'], ['adProfitBeforeAds', '광고 집행 이익금'], ['adNetProfit', '광고 집행 순이익'], ['roas', '광고 ROAS'], ['adReturnOnSpend', '광고 집행 순이익률'], ['acquisitionAdvertising', '신규구매 광고비'], ['netProfit', '전체 광고비 반영 순이익']
  ];
  const dailyColumns = [['sales', '매출'], ['profitBeforeAds', '이익금'], ['advertising', '매출성장 광고비'], ['otherCosts', '기타비용'], ['sourceNetProfit', '매출성장 차감 순이익'], ['acquisitionAdvertising', '신규구매 광고비'], ['netProfit', '전체 광고비 반영 순이익']];
  let dailyDetails = false;
  let dailySort = { key: 'date', ascending: false };
  function dailyValue(row, key) {
    if (row?.dailyReport && Object.hasOwn(row.dailyReport, key)) return row.dailyReport[key];
    if (key === 'otherCosts' && row?.source === 'ledger' && isNumber(row?.sourceOtherCosts)) return row.sourceOtherCosts;
    const value = displayedValue(row, key);
    if (isNumber(value)) return value;
    if (key === 'profitBeforeAds') return row?.estimatedProfitBeforeAds;
    if (key === 'otherCosts') return row?.source === 'ledger' && isNumber(row?.sourceOtherCosts) ? row.sourceOtherCosts : isNumber(row?.estimatedOtherCosts) ? Math.round(row.estimatedOtherCosts) : row?.sourceOtherCosts;
    if (key === 'sourceNetProfit' && isNumber(row?.estimatedProfitBeforeAds) && isNumber(row?.advertising)) return row.estimatedProfitBeforeAds - row.advertising;
    if (key === 'netProfit' && isNumber(row?.acquisitionAdvertising)) { const beforeAcquisition = dailyValue(row, 'sourceNetProfit'); return isNumber(beforeAcquisition) ? beforeAcquisition - row.acquisitionAdvertising : value; }
    return value;
  }
  function dailyEstimated(row, key) {
    if (row?.dailyReport?.estimated && Object.hasOwn(row.dailyReport.estimated, key)) return row.dailyReport.estimated[key] === true;
    if (key === 'otherCosts') return row?.source !== 'ledger' && !isNumber(row?.otherCosts) && isNumber(row?.estimatedOtherCosts);
    return ['profitBeforeAds', 'sourceNetProfit', 'netProfit'].includes(key) && !isNumber(row?.profitBeforeAds) && isNumber(dailyValue(row, key));
  }
  function dailyTotal(rows, canonical) {
    if (canonical?.knownDays && canonical?.partial && canonical?.estimated) return { ...canonical, ...Object.fromEntries(dailyColumns.map(([key]) => [key, isNumber(canonical[key]) ? canonical[key] : isNumber(canonical.available?.[key]) ? canonical.available[key] : null])) };
    const total = { knownDays: {}, availableDays: {}, partialDays: {}, estimated: {}, partial: {}, totalDays: rows.length };
    for (const [key] of dailyColumns) {
      const known = rows.filter(row => isNumber(dailyValue(row, key)));
      const partialDays = known.filter(row => row?.dailyReport?.partial?.[key] === true || key === 'sales' && !isNumber(row?.sales) && isNumber(row?.available?.sales)).length;
      total[key] = known.length ? known.reduce((value, row) => value + dailyValue(row, key), 0) : null;
      total.availableDays[key] = known.length; total.partialDays[key] = partialDays;
      total.knownDays[key] = known.length - partialDays; total.partial[key] = partialDays > 0 || known.length < rows.length;
      total.estimated[key] = known.some(row => dailyEstimated(row, key));
    }
    return total;
  }
  function dailyShownColumns() { return dailyDetails ? [...dailyColumns, ...dailyDetailColumns.filter(([key]) => !dailyColumns.some(([main]) => main === key))] : dailyColumns; }
  function appendDailyCell(tr, row, key, total = false) {
    const value = total ? row[key] : dailyValue(row, key);
    const td = addCell(tr, isNumber(value) ? won(value) : ['advertising', 'acquisitionAdvertising'].includes(key) ? '자료 없음' : '—', 'ca-number');
    const estimated = total ? row.estimated[key] : dailyEstimated(row, key);
    if (estimated) td.append(element('small', '예상', 'ca-daily-estimate'));
    const partial = total ? row.partial?.[key] === true : row?.dailyReport?.partial?.[key] === true || key === 'sales' && !isNumber(row?.sales) && isNumber(row?.available?.sales);
    if (partial && isNumber(value)) {
      td.append(element('small', '수집분', 'ca-partial-note'));
      td.title = total ? '전체 확인 ' + (row.knownDays?.[key] || 0) + '일 · 부분 확인 ' + (row.partialDays?.[key] || 0) + '일' + (row.totalDays ? ' / 조회 ' + row.totalDays + '일' : '') + '의 수집분 합계' : '일부 배송 방식·상품 자료가 미수집입니다. 확인된 금액만 표시합니다.';
    }
    if (!total && ['advertising', 'acquisitionAdvertising'].includes(key)) {
      const source = row?.dailyReport?.advertisingSources?.[key === 'advertising' ? 'pa' : 'nca'];
      if (source?.scope === 'account' && isNumber(value)) td.append(element('small', '계정 전체', 'ca-ad-scope'));
      if (source) td.title = advertisingSourceText(row, key === 'advertising' ? 'pa' : 'nca');
    }
    return td;
  }
  function compareValues(a, b, key, ascending) {
    const av = displayedValue(a, key), bv = displayedValue(b, key); if (av == null && bv == null) return 0; if (av == null) return 1; if (bv == null) return -1;
    const order = typeof av === 'string' ? av.localeCompare(String(bv), 'ko') : av - bv; return ascending ? order : -order;
  }
  function renderDaily() {
    const header = element('tr'), shown = dailyShownColumns();
    for (const [key, title] of [['date', '일자'], ...shown]) {
      const th = element('th'), button = element('button', title + (dailySort.key === key ? dailySort.ascending ? ' ↑' : ' ↓' : ''));
      th.scope = 'col'; th.setAttribute('aria-sort', dailySort.key === key ? dailySort.ascending ? 'ascending' : 'descending' : 'none');
      button.type = 'button'; button.addEventListener('click', () => { dailySort = { key, ascending: dailySort.key === key ? !dailySort.ascending : false }; renderDaily(); }); th.append(button); header.append(th);
    }
    if (dailyDetails) header.append(element('th', '자료 기준')); $('ca-daily-head').replaceChildren(header);
    const host = $('ca-daily-body'); host.replaceChildren();
    host.closest('table').classList.toggle('ca-daily-expanded', dailyDetails);
    const totals = dailyTotal(report.daily, report.dailyReportSummary), total = element('tr', undefined, 'ca-totals-row');
    addCell(total, '합계');
    shown.forEach(([key]) => dailyColumns.some(([main]) => main === key) ? appendDailyCell(total, totals, key, true) : appendValueCell(total, report.summary, key));
    if (dailyDetails) addCell(total, '확인된 날짜 합계'); host.append(total);
    const sortRows = [...report.daily].sort((a, b) => compareValues({ ...a, [dailySort.key]: dailyValue(a, dailySort.key) }, { ...b, [dailySort.key]: dailyValue(b, dailySort.key) }, dailySort.key, dailySort.ascending));
    for (const row of sortRows) {
      const tr = element('tr'); const dateCell = addCell(tr, row.date); dateCell.title = sourceNames[row.source] || '혼합 자료';
      shown.forEach(([key]) => dailyColumns.some(([main]) => main === key) ? appendDailyCell(tr, row, key) : appendValueCell(tr, row, key));
      if (dailyDetails) addCell(tr).append(sourceBadge(row)); host.append(tr);
    }
    const note = $('ca-daily-note');
    if (note) {
      const groups = new Map();
      for (const [key, title] of dailyColumns) if (totals.partial[key] && (totals.availableDays?.[key] ?? totals.knownDays[key])) {
        const counts = (totals.knownDays[key] || 0) + ':' + (totals.partialDays?.[key] || 0), group = groups.get(counts) || { titles: [], known: totals.knownDays[key] || 0, partial: totals.partialDays?.[key] || 0 };
        group.titles.push(title); groups.set(counts, group);
      }
      const partial = [...groups.values()].map(group => group.titles.join('·') + ' 전체 확인 ' + group.known + '일 · 부분 확인 ' + group.partial + '일 / 조회 ' + report.daily.length + '일');
      note.textContent = '매출성장 차감 순이익 = 이익금 − 매출성장 광고비. 전체 광고비 반영 순이익 = 매출성장 차감 순이익 − 신규구매 광고비. 기타비용은 이익금에 이미 반영되어 있습니다. 신규구매 광고비가 미수집인 날은 최종 순이익을 계산하지 않습니다.' + (report.daily.some(row => ['pa', 'nca'].some(type => row.dailyReport?.advertisingSources?.[type]?.scope === 'account')) ? ' 계정 전체로 표시한 광고비는 보고서 원본 금액 전액을 현재 선택 상품의 이익에서 차감합니다. 상품별·배송 방식별로 배분하지 않으며 임의 부가세 보정을 하지 않습니다.' : '') + (partial.length ? ' 합계는 확인분 기준 (' + partial.join(' · ') + ').' : '') + (dailyColumns.some(([key]) => totals.estimated[key]) ? ' 예상 표시는 등록 원가·요금으로 계산한 값입니다.' : '');
    }
    renderDailyCalculation();
  }
  function advertisingSourceText(row, type) {
    const source = row?.dailyReport?.advertisingSources?.[type];
    if (!source) return '';
    const name = { 'pa-report': '매출성장 보고서', 'nca-report': '신규구매 보고서', 'saved-sales': '저장한 손익 자료', 'confirmed-ledger': '확인한 매출·비용', missing: '자료 없음' }[source.source] || '저장 자료';
    return name + (source.scope === 'account' ? ' · 계정 전체' : '') + (source.basis === 'report-original-amount' ? ' · 원본 금액' : '') + (source.filename ? ' · ' + source.filename : '') + (source.importedAt ? ' · 저장 ' + source.importedAt : '');
  }
  function dailyCalculationEvidence(row) {
    const source = row?.dailyReport?.source || row?.source || 'missing', basis = row?.dailyReport?.basis;
    const sourceLabel = { 'api-orders-gross': '저장 주문 · 반품·정산 미확정', 'saved-source': '가져온 손익 파일', 'confirmed-ledger': '확인한 매출·비용', 'saved-daily-report': '확인한 일별 합계', 'legacy-manual-reference': '기존에 입력한 일별 기준값', mixed: '주문·확인 자료 혼합', missing: '자료 없음' }[basis] || sourceNames[source] || '자료 기준 확인';
    const components = row?.dailyReport?.components || { productCost: row?.estimatedProductCost, commission: row?.estimatedCommission, fulfillment: row?.estimatedFulfillment, otherCostsRaw: row?.estimatedOtherCosts, estimatedProfitBeforeAds: row?.estimatedProfitBeforeAds };
    const sourceProfit = isNumber(row?.profitBeforeAds) ? row.profitBeforeAds : null;
    const calculatedProfit = components.estimatedProfitBeforeAds;
    const difference = isNumber(row?.dailyReport?.differences?.profitBeforeAds) ? row.dailyReport.differences.profitBeforeAds : isNumber(calculatedProfit) && isNumber(sourceProfit) ? calculatedProfit - sourceProfit : null;
    const hasApi = row?.dailyReport?.apiUnconfirmed === true || source === 'api' || row?.underlyingSource === 'api' || source === 'mixed' || row?.underlyingSource === 'mixed';
    const sourceNote = source === 'reconciled' ? '이 날짜에 저장한 전체 배송·선택 상품의 확인 합계입니다. 상품별 비용을 이 합계에서 역산하거나 배분하지 않습니다.' : source === 'sellha' ? '표의 이익금은 원본 손익 자료를 사용합니다. 등록 비용으로 다시 계산한 값은 아래에서 따로 비교합니다.' : hasApi ? '주문금액은 반품·할인·정산이 확정되기 전의 참고 매출입니다. 등록된 비용으로 예상 이익을 계산합니다.' : source === 'ledger' ? '직접 확인해 저장한 매출과 비용을 사용합니다.' : '날짜별 저장 자료와 적용 비용을 확인해 주세요.';
    const advertising = dailyValue(row, 'advertising'), net = dailyValue(row, 'sourceNetProfit'), acquisition = dailyValue(row, 'acquisitionAdvertising'), finalNet = dailyValue(row, 'netProfit');
    return { sourceLabel, sourceNote, components, sourceProfit, calculatedProfit, difference, hasApi,
      advertisingNote: !isNumber(advertising) ? '광고비 자료 없음 · 순이익 계산 대기' : !isNumber(net) ? '이익금 미확인 · 순이익 계산 대기' : '매출성장 차감 순이익은 이익금에서 매출성장 광고비를 한 번 차감한 값입니다.',
      acquisitionNote: !isNumber(acquisition) ? '신규구매 광고비 자료 없음 · 전체 광고비 반영 순이익 계산 대기' : !isNumber(finalNet) ? '매출성장 차감 순이익 미확인 · 전체 광고비 반영 순이익 계산 대기' : '전체 광고비 반영 순이익은 매출성장 차감 순이익에서 신규구매 광고비를 한 번 차감한 값입니다.',
      advertisingSources: ['pa', 'nca'].map(type => advertisingSourceText(row, type)).filter(Boolean),
      reasons: Array.isArray(row?.dailyReport?.reasons) ? row.dailyReport.reasons.filter(value => typeof value === 'string') : [],
      accountCostNote: ['pa', 'nca'].some(type => row?.dailyReport?.advertisingSources?.[type]?.scope === 'account') ? '계정 전체 광고 보고서의 원본 금액을 현재 선택 상품의 이익에서 전액 차감합니다. 상품별·배송 방식별 배분이나 임의 부가세 보정은 하지 않습니다.' : '',
      referenceNote: row?.dailyTotalsStatus?.reason || '', costWarning: costWarningText(row), missingCost: !isNumber(calculatedProfit) ? estimateMissingText(row) : '' };
  }
  function renderDailyCalculation() {
    const select = $('ca-calculation-date'), host = $('ca-calculation-body'); if (!select || !host) return;
    const selected = select.value, rows = [...(report?.daily || [])].sort((a, b) => b.date.localeCompare(a.date));
    select.replaceChildren();
    if (!rows.length) { select.disabled = true; host.replaceChildren(element('p', '조회 기간에 저장된 자료가 없습니다.', 'helper')); return; }
    for (const row of rows) { const option = element('option', row.date); option.value = row.date; select.append(option); }
    const known = rows.find(row => dailyColumns.some(([key]) => isNumber(dailyValue(row, key))));
    select.value = rows.some(row => row.date === selected) ? selected : (known || rows[0]).date; select.disabled = false;
    const row = rows.find(row => row.date === select.value), evidence = dailyCalculationEvidence(row); host.replaceChildren();
    host.append(element('strong', evidence.sourceLabel), element('p', evidence.sourceNote, 'helper'));
    if (evidence.referenceNote) host.append(element('p', evidence.referenceNote, 'helper ca-cost-warning'));
    if (evidence.hasApi && row.source === 'reconciled') host.append(element('p', '아래 등록 비용 계산은 현재 저장 주문 기준 참고값입니다. 위 확인 합계와 자료 기준이 다를 수 있습니다.', 'helper'));
    const list = element('dl', undefined, 'ca-calculation-values');
    for (const [label, value, raw] of [['자료에 저장된 이익금', evidence.sourceProfit], ['등록 비용으로 계산한 이익금', evidence.calculatedProfit], ['상품원가 합계', evidence.components.productCost, true], ['판매수수료', evidence.components.commission, true], ['입출고·배송비', evidence.components.fulfillment, true], ['표 기타비용', dailyValue(row, 'otherCosts')], ['매출성장 광고비', dailyValue(row, 'advertising')], ['매출성장 차감 순이익', dailyValue(row, 'sourceNetProfit')], ['신규구매 광고비', dailyValue(row, 'acquisitionAdvertising')], ['전체 광고비 반영 순이익', dailyValue(row, 'netProfit')]]) { list.append(element('dt', label), element('dd', raw && isNumber(value) ? value.toLocaleString('ko-KR', { maximumFractionDigits: 2 }) + '원' : won(value))); }
    host.append(list);
    if (isNumber(evidence.components.otherCostsRaw)) host.append(element('p', '등록 비용의 기타비용 합계 · 반올림 전 ' + evidence.components.otherCostsRaw.toLocaleString('ko-KR', { maximumFractionDigits: 2 }) + '원', 'helper'));
    if (isNumber(evidence.difference)) host.append(element('p', '등록 비용 계산 − 저장 자료 이익금: ' + (evidence.difference > 0 ? '+' : '') + won(evidence.difference) + '. 차이를 자동 보정률로 적용하지 않습니다.', 'helper'));
    host.append(element('p', evidence.advertisingNote, 'helper' + (!isNumber(dailyValue(row, 'advertising')) ? ' ca-cost-warning' : '')));
    host.append(element('p', evidence.acquisitionNote, 'helper' + (!isNumber(dailyValue(row, 'acquisitionAdvertising')) ? ' ca-cost-warning' : '')));
    for (const source of evidence.advertisingSources) host.append(element('p', source, 'helper'));
    if (evidence.accountCostNote) host.append(element('p', evidence.accountCostNote, 'helper'));
    for (const reason of evidence.reasons) if (reason !== evidence.referenceNote) host.append(element('p', reason, 'helper'));
    if (evidence.missingCost) host.append(element('p', evidence.missingCost, 'helper'));
    if (evidence.costWarning) host.append(element('p', evidence.costWarning, 'helper ca-cost-warning'));
  }
  function openReferenceImport() {
    const panel = $('ca-import'); if (!panel) return;
    panel.open = true; panel.scrollIntoView?.({ block: 'start', behavior: 'smooth' }); $('ca-file')?.focus({ preventScroll: true });
  }
  function changeText(current, previous) {
    if (!isNumber(current) || !isNumber(previous)) return '—'; const difference = current - previous;
    if (previous === 0) return difference === 0 ? '변동 없음' : difference > 0 ? '신규 · +' + number(difference) : '기준 0 · ' + number(difference);
    const change = difference / Math.abs(previous) * 100; return (difference > 0 ? '+' : '') + percent(change) + ' (' + (difference > 0 ? '+' : '') + number(difference) + ')';
  }
  function productDailyRows() {
    if (productDailyCache) return productDailyCache;
    if (Array.isArray(report.productDaily)) {
      productDailyCache = [...report.productDaily].sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name, 'ko'));
      return productDailyCache;
    }
    const items = report.items || [], byKey = new Map();
    for (const row of items) {
      const key = row.date + ':' + row.channel + ':' + (row.productId || row.itemId); if (!byKey.has(key)) byKey.set(key, []); byKey.get(key).push(row);
    }
    const rows = [...byKey.values()].filter(values => values[0].date).map(values => ({ date: values[0].date, channel: values[0].channel, productId: values[0].productId || values[0].itemId, name: values[0].name, quantity: sum(values, 'quantity'), sales: sum(values, 'sales'), available: { sales: availableSum(values, 'sales'), quantity: availableSum(values, 'quantity') }, source: values.every(r => r.source === values[0].source) ? values[0].source : 'mixed' }));
    rows.sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name, 'ko'));
    productDailyCache = rows; return productDailyCache;
  }
  function renderProductDaily() {
    const host = $('ca-product-daily-body'); host.replaceChildren();
    const rows = productDailyRows(), lookup = new Map(rows.map(row => [row.date + ':' + row.channel + ':' + row.productId, row]));
    const pages = Math.max(1, Math.ceil(rows.length / productDailyPageSize)); productDailyPage = Math.min(productDailyPage, pages - 1);
    const start = productDailyPage * productDailyPageSize;
    for (const row of rows.slice(start, start + productDailyPageSize)) {
      const previous = lookup.get(dateShift(row.date, -1) + ':' + row.channel + ':' + row.productId), comparable = previous && previous.source === row.source && row.source !== 'mixed';
      const tr = element('tr'); addCell(tr, row.date); addCell(tr, channels[row.channel]); const nameCell = addCell(tr, window.CoupangProductNames?.shortTitle(row) || row.name, 'ca-name'); nameCell.title = row.fullName || row.name; window.CoupangThumbnails?.decorate(nameCell, { productId: row.productId, name: row.name }); appendValueCell(tr, row, 'quantity');
      addCell(tr, changeText(row.quantity, comparable ? previous.quantity : null)); appendValueCell(tr, row, 'sales'); addCell(tr, changeText(row.sales, comparable ? previous.sales : null)); addCell(tr).append(sourceBadge(row)); host.append(tr);
    }
    if (!rows.length) { const tr = element('tr'), td = addCell(tr, undefined, 'ca-empty'); td.colSpan = 8; td.append(noSalesContent()); host.append(tr); }
    let pager = $('ca-product-pagination');
    if (!pager) { pager = element('nav', undefined, 'ca-toolbar'); pager.id = 'ca-product-pagination'; pager.setAttribute('aria-label', '상품별 일일 데이터 페이지'); pager.style.marginTop = '10px'; host.closest('.ca-scroll').after(pager); }
    pager.replaceChildren();
    const previous = element('button', '이전'), next = element('button', '다음'); previous.type = next.type = 'button'; previous.disabled = productDailyPage === 0; next.disabled = productDailyPage >= pages - 1;
    previous.addEventListener('click', () => { productDailyPage--; renderProductDaily(); }); next.addEventListener('click', () => { productDailyPage++; renderProductDaily(); });
    const count = element('span', rows.length ? (start + 1).toLocaleString('ko-KR') + '–' + Math.min(rows.length, start + productDailyPageSize).toLocaleString('ko-KR') + ' / ' + rows.length.toLocaleString('ko-KR') + '행 · ' + (productDailyPage + 1) + '/' + pages + '페이지' : '0행'); count.setAttribute('aria-live', 'polite'); pager.append(previous, count, next);
  }
  function aggregateRows(rows) {
    const result = Object.fromEntries(summable.map(key => [key, sum(rows, key)]));
    result.available = { sales: availableSum(rows, 'sales'), quantity: availableSum(rows, 'quantity') };
    result.adReturnOnSpend = result.advertising > 0 && isNumber(result.adNetProfit) ? result.adNetProfit / result.advertising * 100 : null;
    result.roas = isNumber(result.advertising) && result.advertising > 0 && isNumber(result.adSales) ? result.adSales / result.advertising * 100 : null;
    result.missingInputs = [...new Set(rows.flatMap(row => Array.isArray(row.missingInputs) ? row.missingInputs : []))];
    result.missingInputReasons = [...new Set(rows.flatMap(row => Array.isArray(row.missingInputReasons) ? row.missingInputReasons : []))];
    result.zeroCostItemIds = [...new Set(rows.flatMap(row => Array.isArray(row.zeroCostItemIds) ? row.zeroCostItemIds : []))];
    result.costWarnings = [...new Set(rows.flatMap(row => Array.isArray(row.costWarnings) ? row.costWarnings : []))];
    for (const key of ['unitCost', 'salePrice', 'inventory']) result[key] = rows.length && rows.every(r => isNumber(r[key]) && r[key] === rows[0][key]) ? rows[0][key] : null;
    result.source = rows.every(r => r.source === rows[0]?.source) ? rows[0]?.source : 'mixed'; return result;
  }
  function buildGroups() {
    const map = new Map();
    for (const item of report.items || []) {
      const key = String(item.productId || item.itemId); if (!map.has(key)) map.set(key, []); map.get(key).push(item);
    }
    groups = [...map].map(([id, rows]) => {
      const optionMap = new Map(); for (const row of rows) { const key = row.channel + ':' + row.itemId; if (!optionMap.has(key)) optionMap.set(key, []); optionMap.get(key).push(row); }
      const options = [...optionMap.values()].map(values => ({ ...aggregateRows(values), id: values[0].itemId, productId: id, name: values[0].name, fullName: values[0].fullName || values[0].name, optionName: values[0].optionName || values[0].name, channel: values[0].channel, rows: values }));
      return { ...aggregateRows(rows), id, name: rows[0].name, fullName: [...new Set(rows.map(row => row.fullName || row.name))].slice(0, 4).join('\n'), channel: [...new Set(rows.map(r => channels[r.channel]))].join(' + '), options, rows };
    });
  }
  function updateGroupChoices(result) {
    const select = $('ca-group'), selected = select.value || new URLSearchParams(location.search).get('group') || '';
    const workspace = result.status === 'fulfilled' ? result.value : null;
    const matched = workspace?.configured && workspace.scopeKey === report.scopeKey && workspace.revision === report.workspaceRevision;
    savedGroups = matched && Array.isArray(workspace.groups) ? workspace.groups : [];
    select.replaceChildren(); const all = element('option', '전체 그룹'); all.value = ''; select.append(all);
    for (const group of savedGroups) { const option = element('option', group.name); option.value = group.id; select.append(option); }
    select.value = savedGroups.some(group => group.id === selected) ? selected : '';
    $('ca-group-status').textContent = result.status === 'rejected' ? '상품 그룹을 불러오지 못했습니다. 전체 상품 표를 표시합니다. 다시 조회해 주세요.' : !matched ? '집계 상품이 변경되었습니다. 다시 조회하면 최신 그룹을 연결합니다.' : '상품 관리에서 만든 그룹으로 표와 CSV를 좁혀 봅니다. 위 전체 합계와 집계 대상은 유지됩니다.';
  }
  function filterProductGroups(productGroups, itemIds) {
    if (!itemIds) return productGroups;
    const chosen = new Set(itemIds.map(String));
    return productGroups.flatMap(group => {
      const options = group.options.filter(option => chosen.has(String(option.id)));
      if (!options.length) return [];
      const rows = options.flatMap(option => option.rows);
      return [{ ...group, ...aggregateRows(rows), options, rows, channel: [...new Set(options.map(option => channels[option.channel]))].join(' + ') }];
    });
  }
  function isFavorite(group) { return favoriteIds.has(group.id) || group.options.some(option => favoriteIds.has(String(option.id))); }
  function currentGroups() {
    const term = $('ca-search').value.trim().toLocaleLowerCase('ko-KR'), favoritesOnly = $('ca-favorites').checked;
    const [key, direction] = $('ca-sort').value.split(':');
    const selected = savedGroups.find(group => group.id === $('ca-group').value);
    return filterProductGroups(groups, selected ? selected.itemIds : null).filter(group => (!favoritesOnly || isFavorite(group)) && (!term || [group.id, group.name, group.fullName, ...group.options.flatMap(option => [option.id, option.name, option.fullName, option.optionName])].some(value => String(value || '').toLocaleLowerCase('ko-KR').includes(term))))
      .sort((a, b) => compareValues(a, b, key, direction === 'asc') || a.id.localeCompare(b.id));
  }
  function updateCostColumnButton() {
    const button = $('ca-show-cost-columns');
    if (button) button.hidden = ['estimatedProductCost', 'estimatedCommission', 'estimatedFulfillment', 'estimatedProfitBeforeAds'].every(key => visibleColumns.has(key));
  }
  function revealCostColumns() {
    for (const key of ['estimatedProductCost', 'estimatedCommission', 'estimatedFulfillment', 'estimatedProfitBeforeAds']) visibleColumns.add(key);
    document.querySelectorAll('#ca-column-options input[data-column-key]').forEach(input => { input.checked = visibleColumns.has(input.dataset.columnKey); });
    saveSetting('columns', [...visibleColumns]); updateCostColumnButton(); if (report) renderSales();
  }
  function salesHeader() {
    const tr = element('tr');
    for (const [title, label] of [['☆', '즐겨찾기'], ['상세', '옵션 자세히 보기'], ['상품 / 옵션 ID', '상품 / 옵션 ID'], ['구분', '배송 방식'], ['상품명 / 옵션명', '상품명 / 옵션명']]) { const th = element('th', title); th.scope = 'col'; th.title = label; th.setAttribute('aria-label', label); if (title === '상품명 / 옵션명') th.className = 'ca-name'; tr.append(th); }
    for (const column of columns.filter(c => visibleColumns.has(c.key))) {
      const th = element('th'), button = element('button', column.label); th.scope = 'col'; button.type = 'button'; if (column.note) button.title = column.note;
      const [sortKey, direction] = $('ca-sort').value.split(':'); if (sortKey === column.key) { button.textContent += direction === 'asc' ? ' ↑' : ' ↓'; th.setAttribute('aria-sort', direction === 'asc' ? 'ascending' : 'descending'); }
      button.addEventListener('click', () => { const newDirection = sortKey === column.key && direction === 'desc' ? 'asc' : 'desc'; $('ca-sort').value = column.key + ':' + newDirection; renderSales(); }); th.append(button); tr.append(th);
    }
    tr.append(element('th', '자료 기준')); $('ca-sales-head').replaceChildren(tr);
  }
  function appendNumbers(tr, row) {
    for (const column of columns.filter(c => visibleColumns.has(c.key))) appendValueCell(tr, row, column.key);
  }
  function renderSales() {
    salesHeader(); const host = $('ca-sales-body'); host.replaceChildren(); const shown = currentGroups(), fields = columns.filter(c => visibleColumns.has(c.key));
    const total = aggregateRows(shown.flatMap(group => group.rows)), totalRow = element('tr', undefined, 'ca-totals-row');
    const totalLabel = addCell(totalRow, '검색 결과 합계 · ' + shown.length + '개 상품'); totalLabel.colSpan = 5; appendNumbers(totalRow, total); addCell(totalRow, isPartialValue(total, 'sales') ? '수집분 · 일부 미수집' : '조회된 상품 자료 합계'); host.append(totalRow);
    const anyCollected = shown.some(group => isNumber(displayedValue(group, 'sales')));
    if (shown.length && !anyCollected) { const tr = element('tr'), td = addCell(tr, undefined, 'ca-empty'); td.colSpan = 6 + fields.length; td.append(noSalesContent()); host.append(tr); }
    for (const group of anyCollected ? shown : []) {
      const tr = element('tr', undefined, 'ca-group-row'), star = element('button', isFavorite(group) ? '★' : '☆', 'ca-star');
      star.type = 'button'; star.setAttribute('aria-label', group.name + ' 즐겨찾기'); star.setAttribute('aria-pressed', String(isFavorite(group)));
      star.addEventListener('click', () => { if (isFavorite(group)) { favoriteIds.delete(group.id); group.options.forEach(option => favoriteIds.delete(String(option.id))); } else favoriteIds.add(group.id); saveSetting('favorites', [...favoriteIds]); renderSales(); }); addCell(tr).append(star);
      const toggle = element('button', expanded.has(group.id) ? '접기' : '자세히', 'ca-expand'); toggle.type = 'button'; toggle.setAttribute('aria-expanded', String(expanded.has(group.id))); toggle.setAttribute('aria-label', group.name + ' 옵션 ' + (expanded.has(group.id) ? '접기' : '펼치기'));
      toggle.addEventListener('click', () => { if (expanded.has(group.id)) expanded.delete(group.id); else expanded.add(group.id); renderSales(); }); addCell(tr).append(toggle);
      addCell(tr, group.id); addCell(tr, group.channel); const nameCell = addCell(tr, undefined, 'ca-name'); nameCell.title = group.fullName || group.name; nameCell.append(element('strong', window.CoupangProductNames?.groupLabel(group.rows) || group.name), element('small', group.options.length + '개 옵션')); window.CoupangThumbnails?.decorate(nameCell, { productId: group.id, name: group.name });
      appendNumbers(tr, group); addCell(tr).append(sourceBadge(group)); host.append(tr);
      if (expanded.has(group.id)) for (const option of group.options) {
        const optionRow = element('tr', undefined, 'ca-option-row'); addCell(optionRow, ''); addCell(optionRow, '↳'); addCell(optionRow, option.id); addCell(optionRow, channels[option.channel]);
        const optionCell = addCell(optionRow, undefined, 'ca-name'); optionCell.title = option.optionName + '\n' + (option.fullName || option.name); optionCell.append(element('strong', option.optionName)); window.CoupangThumbnails?.decorate(optionCell, { itemId: option.id, productId: group.id, name: option.optionName }); appendNumbers(optionRow, option); addCell(optionRow).append(sourceBadge(option)); host.append(optionRow);
      }
    }
    if (!shown.length) { const tr = element('tr'), td = addCell(tr, groups.length ? '검색 조건에 맞는 상품이 없습니다.' : '상품 자료가 없습니다. 자료·연결 관리에서 집계 상품을 선택하고 주문을 수집하거나 손익 파일을 넣어 주세요.', 'ca-empty'); td.colSpan = 6 + fields.length; host.append(tr); }
    $('ca-sales-count').textContent = '전체 ' + groups.length + '개 상품 중 ' + shown.length + '개 · 옵션 ' + shown.reduce((n, g) => n + g.options.length, 0) + '개 · 매출·판매량은 수집분을 표시하며 미수집 부분은 0으로 간주하지 않습니다. 순이익은 확인된 셀하 기준입니다.';
    $('ca-expand-all').textContent = shown.length && shown.every(g => expanded.has(g.id)) ? '옵션 모두 접기' : '옵션 모두 펼치기';
  }
  function csvCell(value) {
    let text = value == null ? '' : String(value); if (/^[\s]*[=+\-@]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }
  function downloadCsv(name, rows) {
    if (!report) return message('자료를 먼저 조회해 주세요.', true);
    const blob = new Blob(['\ufeff' + rows.map(row => row.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob), link = element('a'); link.href = url; link.download = name + '_' + report.since + '_' + report.until + '.csv'; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function normalizeImportReports(reports) {
    if (!Array.isArray(reports) || !reports.length || reports.length > 31) throw Error('하루 단위 손익 자료를 한 번에 1~31개 선택해 주세요.');
    const seen = new Set();
    for (const entry of reports) {
      if (!entry || typeof entry.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date) || !Number.isFinite(Date.parse(entry.date)) || new Date(entry.date).toISOString().slice(0, 10) !== entry.date || entry.date > today) throw Error('손익 자료의 날짜를 확인해 주세요.');
      if (seen.has(entry.date)) throw Error(entry.date + ' 날짜가 중복됩니다. 같은 날짜 파일은 하나만 선택해 주세요.');
      seen.add(entry.date);
      if (!Array.isArray(entry.rows) || !entry.rows.length || entry.rows.length > 2000) throw Error(entry.date + ' 손익 옵션 행은 1~2,000개여야 합니다.');
      for (const row of entry.rows) {
        if (!row || !['growth', 'seller'].includes(row.channel)) throw Error(entry.date + ' 배송 방식을 확인해 주세요.');
        for (const key of ['quantity', 'sales', 'profitBeforeAds', 'advertising']) if (!isNumber(row[key])) throw Error(entry.date + ' 손익 금액·판매량이 숫자인지 확인해 주세요.');
        for (const key of ['adQuantity', 'organicQuantity', 'adSales', 'adProfitBeforeAds']) if (row[key] != null && !isNumber(row[key])) throw Error(entry.date + ' 광고 실적이 숫자인지 확인해 주세요.');
      }
    }
    return [...reports].sort((a, b) => a.date.localeCompare(b.date));
  }
  function normalizeDailyTotals(values) {
    if (values === undefined) return [];
    if (!Array.isArray(values) || values.length > 31) throw Error('일별 확인 합계는 최대 31일씩 넣어 주세요.');
    const seen = new Set();
    return values.map(row => {
      if (!row || !/^\d{4}-\d{2}-\d{2}$/.test(row.date) || !Number.isFinite(Date.parse(row.date)) || new Date(row.date).toISOString().slice(0, 10) !== row.date || row.date > today) throw Error('일별 확인 합계의 날짜를 확인해 주세요.');
      if (seen.has(row.date)) throw Error(row.date + ' 일별 확인 합계가 중복됩니다.'); seen.add(row.date);
      for (const key of ['sales', 'profitBeforeAds', 'advertising', 'otherCosts']) if (!isNumber(row[key]) || Math.abs(row[key]) > 1e12 || key === 'advertising' && row[key] < 0) throw Error(row.date + ' 일별 확인 합계의 금액을 확인해 주세요.');
      return { date: row.date, sales: row.sales, profitBeforeAds: row.profitBeforeAds, advertising: row.advertising, otherCosts: row.otherCosts };
    }).sort((a, b) => a.date.localeCompare(b.date));
  }
  function importTotals(entry) {
    const totals = Object.fromEntries(['quantity', 'adQuantity', 'organicQuantity', 'sales', 'profitBeforeAds', 'advertising', 'adSales', 'adProfitBeforeAds'].map(key => [key, sum(entry.rows, key)]));
    totals.nonAdvertisingCosts = totals.sales - totals.profitBeforeAds;
    totals.sourceNetProfit = totals.profitBeforeAds - totals.advertising;
    totals.adNetProfit = isNumber(totals.adProfitBeforeAds) ? totals.adProfitBeforeAds - totals.advertising : null;
    totals.adReturnOnSpend = totals.advertising > 0 && isNumber(totals.adNetProfit) ? totals.adNetProfit / totals.advertising * 100 : null;
    totals.roas = totals.advertising > 0 && isNumber(totals.adSales) ? totals.adSales / totals.advertising * 100 : null;
    return totals;
  }
  function normalizeImportProducts(products) {
    if (products === undefined) return undefined;
    if (!Array.isArray(products) || !products.length || products.length > 500) throw Error('원가 설정은 1~500개 옵션이어야 합니다.');
    const seen = new Set(), validId = value => typeof value === 'string' && /^[1-9]\d{0,19}$/.test(value) || Number.isSafeInteger(value) && value > 0;
    return products.map(product => {
      if (!product || typeof product !== 'object' || !validId(product.itemId) || typeof product.name !== 'string' || !product.name.trim() || product.name.length > 300) throw Error('원가 설정의 옵션 ID·상품명을 확인해 주세요.');
      const itemId = String(product.itemId); if (seen.has(itemId)) throw Error('원가 설정의 옵션 ID가 중복됩니다.'); seen.add(itemId);
      for (const key of ['unitCost', 'commissionRate', 'inboundFee', 'deliveryFee']) if (!isNumber(product[key]) || product[key] < 0 || product[key] > (key === 'commissionRate' ? 100 : 1e12)) throw Error('원가·수수료·입출고·배송비는 0 이상의 숫자여야 합니다.');
      if (product.costSince != null && (typeof product.costSince !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(product.costSince) || !Number.isFinite(Date.parse(product.costSince)) || new Date(product.costSince).toISOString().slice(0, 10) !== product.costSince)) throw Error('원가 적용 시작일을 확인해 주세요.');
      return { ...product, itemId };
    });
  }
  function catalogPreviewStats(products, existing) {
    const selectedIds = new Set((existing || []).map(product => String(product.itemId)));
    return { total: products.length, positive: products.filter(product => product.unitCost > 0).length, zero: products.filter(product => product.unitCost === 0).length,
      matched: products.filter(product => selectedIds.has(product.itemId)).length, added: products.filter(product => !selectedIds.has(product.itemId)).length };
  }
  function renderImportPreview(reports, dailyTotals = [], catalog = null) {
    const host = $('ca-import-preview'); host.replaceChildren();
    if (dailyTotals.length) {
      const confirmed = element('table', undefined, 'ca-table'), h = element('thead'), b = element('tbody'), titles = element('tr');
      for (const title of ['일자', ...dailyColumns.map(([, title]) => title)]) titles.append(element('th', title)); h.append(titles);
      const rows = dailyTotals.map(row => ({ ...row, sourceNetProfit: row.profitBeforeAds - row.advertising }));
      for (const row of [...rows, { date: '합계', ...Object.fromEntries(dailyColumns.map(([key]) => [key, sum(rows, key)])) }]) {
        const tr = element('tr', undefined, row.date === '합계' ? 'ca-totals-row' : undefined); addCell(tr, row.date); dailyColumns.forEach(([key]) => addCell(tr, won(row[key]))); b.append(tr);
      }
      confirmed.append(h, b); host.append(element('p', '확인한 일별 합계' + ' · 전체 배송·현재 집계 상품 기준. 상품·배송 방식별 금액으로 배분하지 않습니다.'), confirmed);
    }
    if (catalog) host.append(element('p', '원가 설정 ' + number(catalog.total) + '개 · 양수 원가 ' + number(catalog.positive) + '개 · 원본 0원 ' + number(catalog.zero) + '개 · 기존 옵션 매칭 ' + number(catalog.matched) + '개 · 신규 ' + number(catalog.added) + '개. 저장하면 해당 옵션의 원가·수수료·배송비를 파일 값으로 갱신합니다. 원본 0원은 실제 원가 확인이 필요한 참고값입니다.', 'helper ca-catalog-preview'));
    if (!reports.length) { host.hidden = false; return; }
    const table = element('table', undefined, 'ca-table'), head = element('thead'), body = element('tbody'), tr = element('tr');
    const fields = [['quantity', '판매량'], ['adQuantity', '광고 판매량'], ['organicQuantity', '일반 판매량'], ['sales', '할인 후 매출'], ['profitBeforeAds', '이익금'], ['nonAdvertisingCosts', '광고 외 비용 합계'], ['advertising', '광고 집행비'], ['sourceNetProfit', '셀하 순이익'], ['adSales', '광고 집행 매출'], ['adProfitBeforeAds', '광고 집행 이익금'], ['adNetProfit', '광고 집행 순이익'], ['roas', '광고 ROAS'], ['adReturnOnSpend', '광고 집행 순이익률']];
    for (const title of ['일자', '옵션 수', ...fields.map(c => c[1])]) { const th = element('th', title); th.scope = 'col'; tr.append(th); } head.append(tr);
    const totals = reports.map(entry => ({ ...importTotals(entry), date: entry.date, rows: entry.rows }));
    const combined = Object.fromEntries(fields.filter(([key]) => !['roas', 'adReturnOnSpend'].includes(key)).map(([key]) => [key, sum(totals, key)]));
    combined.adReturnOnSpend = combined.advertising > 0 && isNumber(combined.adNetProfit) ? combined.adNetProfit / combined.advertising * 100 : null;
    combined.roas = combined.advertising > 0 && isNumber(combined.adSales) ? combined.adSales / combined.advertising * 100 : null;
    for (const entry of [...totals, { ...combined, date: '합계', rows: reports.flatMap(r => r.rows) }]) {
      const row = element('tr', undefined, entry.date === '합계' ? 'ca-totals-row' : undefined); addCell(row, entry.date); addCell(row, number(entry.rows.length), 'ca-number');
      for (const [key] of fields) addCell(row, valueText(entry[key], key), 'ca-number'); body.append(row);
    }
    table.append(head, body); host.append(table); host.hidden = false;
  }
  function configureImportAcquisition(reports) {
    const batch = reports.length !== 1;
    $('ca-acquisition-fields').hidden = batch;
    $('ca-acquisition-note').textContent = batch
      ? '여러 날짜는 자료에 저장된 날짜별 신규고객확보 광고비만 반영합니다. 금액이 없으면 미확인으로 저장합니다. 이익금·셀하 순이익은 그대로 표시하며, 추가 광고비는 하루 파일씩 다시 선택해 확인할 수 있습니다.'
      : '신규고객확보 광고비는 가져올 파일의 하루 사용액입니다. 사용하지 않았다면 0을 입력하세요. 빈칸은 미확인으로 보관하며 추가 광고비 반영 순이익을 확정하지 않습니다.';
    for (const channel of ['growth', 'seller']) {
      const input = $('ca-acquisition-' + channel); input.disabled = batch;
      if (!batch) input.value = reports[0].acquisitionAdvertising?.[channel] ?? '';
    }
  }
  async function previewImport() {
    if (importSaving) return;
    const sequence = ++parseSequence, files = [...$('ca-file').files];
    pendingImport = null; $('ca-save').disabled = true; $('ca-import-preview').replaceChildren(); $('ca-import-preview').hidden = true;
    if (!files.length) return message('셀하 하루 단위 엑셀 또는 손익 설정 JSON 파일을 선택해 주세요.', true);
    $('ca-preview').disabled = true; $('ca-import-status').textContent = '손익 파일을 확인합니다.';
    try {
      if (files.length > 31) throw Error('하루 단위 엑셀은 한 번에 31개까지 선택할 수 있습니다.');
      const parsed = []; let dailyTotals = [], products;
      for (const file of files) {
        if (file.size > 12 * 1024 * 1024) throw Error('파일 하나의 크기는 12MB 이하여야 합니다.');
        if (/\.json$/i.test(file.name)) {
          if (files.length !== 1) throw Error('손익 설정 JSON은 하나만 선택해 주세요.');
          let data; try { data = JSON.parse((await file.text()).replace(/^\uFEFF/, '')); } catch (_) { throw Error('손익 설정 JSON 파일을 읽을 수 없습니다.'); }
          if (data?.schema !== 'roas-coupang-sales-v1') throw Error('ROAS Pilot 쿠팡 손익 설정 파일을 선택해 주세요.');
          dailyTotals = normalizeDailyTotals(data.dailyTotals);
          if (data.reports?.length) parsed.push(...normalizeImportReports(data.reports));
          else if (!dailyTotals.length) throw Error('저장할 손익 자료가 없습니다.');
          if (data.catalog !== undefined && (!data.catalog || typeof data.catalog !== 'object' || Array.isArray(data.catalog) || !Array.isArray(data.catalog.products))) throw Error('원가 설정의 옵션 목록을 확인해 주세요.');
          if (data.products !== undefined && data.catalog !== undefined) throw Error('원가 설정은 products 또는 catalog 중 한 곳에만 넣어 주세요.');
          products = normalizeImportProducts(data.products === undefined ? data.catalog?.products : data.products);
        } else {
          if (!window.CoupangSheets?.parseSales) throw Error('엑셀 읽기 기능을 불러오지 못했습니다. 페이지를 새로고침해 주세요.');
          parsed.push(await window.CoupangSheets.parseSales(file));
        }
      }
      if (sequence !== parseSequence || files.some((file, index) => $('ca-file').files[index] !== file) || $('ca-file').files.length !== files.length) return;
      const reports = parsed.length ? normalizeImportReports(parsed) : [], dates = [...new Set([...reports, ...dailyTotals].map(row => row.date))].sort(); let catalog;
      if (dates.length > 31) throw Error('손익 자료는 한 번에 31일씩 선택해 주세요.');
      if (products) {
        const current = await request('status'); if (!current.configured) throw Error('원가 설정을 저장하려면 먼저 쿠팡 연결을 등록해 주세요.');
        catalog = catalogPreviewStats(products, current.products);
      }
      if (sequence !== parseSequence) return;
      pendingImport = { reports, dailyTotals, ...(products ? { products } : {}) };
      renderImportPreview(reports, dailyTotals, catalog); configureImportAcquisition(reports);
      $('ca-import-scope-note').textContent = products ? '이 파일의 원가 설정을 한 번 저장하면 이후 자동 수집한 주문 계산에 계속 적용합니다. 파일에 포함된 옵션의 기존 원가·수수료·배송비는 위 미리보기 기준으로 갱신합니다.' : '새 옵션은 쿠팡 집계에 추가하고, 기존에 등록한 원가·수수료는 유지합니다. 다른 분석 메뉴의 브랜드 범위는 바뀌지 않습니다.';
      $('ca-import-status').textContent = dates.length + '일 · ' + dates[0] + ' ~ ' + dates.at(-1) + ' · 옵션 행 ' + number(reports.reduce((n, r) => n + r.rows.length, 0)) + '개' + (dailyTotals.length ? ' · 확인 합계 ' + dailyTotals.length + '일' : '') + (products ? ' · 원가 설정 포함' : '') + '. 아래 수치를 확인한 뒤 저장하세요. 같은 날짜는 교체하여 중복 합산하지 않습니다.'; $('ca-save').disabled = false;
    } catch (error) { if (sequence === parseSequence) { $('ca-import-status').textContent = error.message; message(error.message, true); } }
    finally { if (sequence === parseSequence) $('ca-preview').disabled = false; }
  }
  async function saveImport() {
    if (importSaving) return;
    if (!pendingImport) return message('손익 파일을 먼저 확인해 주세요.', true);
    const payload = pendingImport, reports = payload.reports.map(entry => ({ ...entry })), includeProducts = $('ca-include-products').checked;
    let products, dailyTotals;
    try { products = normalizeImportProducts(payload.products); dailyTotals = normalizeDailyTotals(payload.dailyTotals); } catch (error) { return message(error.message, true); }
    const dates = [...new Set([...reports, ...dailyTotals].map(row => row.date))].sort();
    if (!dates.length) return message('저장할 손익 자료가 없습니다.', true);
    if (products && !includeProducts) return message('원가 설정이 포함된 파일은 ‘파일의 모든 옵션을 쿠팡 집계에 포함’을 선택한 뒤 저장해 주세요.', true);
    if (reports.length === 1) {
      const acquisitionAdvertising = {};
      for (const channel of ['growth', 'seller']) {
        const raw = $('ca-acquisition-' + channel).value; const value = raw === '' ? null : Number(raw);
        if (value !== null && (!Number.isFinite(value) || value < 0 || value > 1e12)) return message('신규고객확보 광고비는 0 이상의 금액으로 입력해 주세요.', true); acquisitionAdvertising[channel] = value;
      }
      reports[0].acquisitionAdvertising = acquisitionAdvertising;
    }
    importSaving = true; ++parseSequence;
    const lockedInputs = ['ca-file', 'ca-acquisition-growth', 'ca-acquisition-seller', 'ca-include-products'].map(id => ({ input: $(id), disabled: $(id).disabled }));
    lockedInputs.forEach(({ input }) => { input.disabled = true; });
    $('ca-save').disabled = true; $('ca-preview').disabled = true;
    try {
      const result = await request('sales-import-batch', { reports, includeProducts, ...(products ? { products } : {}), ...(dailyTotals.length ? { dailyTotals } : {}) });
      if (pendingImport === payload) pendingImport = null;
      const results = Array.isArray(result.reports) ? result.reports : Array.isArray(result.results) ? result.results : [];
      const excluded = results.reduce((n, r) => n + (r.excluded || 0), 0);
      $('ca-import-status').textContent = dates.length + '일 손익 자료 저장 완료. ' + (products ? '원가·수수료·배송비 ' + number(result.catalogImported ?? products.length) + '개 갱신 · 원본 0원 ' + number(result.catalogZeroCosts ?? products.filter(product => product.unitCost === 0).length) + '개. 이후 자동 수집 주문에 적용합니다.' : includeProducts ? '파일의 옵션을 쿠팡 집계에 포함했습니다. 기존 등록 원가는 유지합니다.' : '기존 집계 대상만 반영합니다.') + (excluded ? ' 집계 제외 옵션 행 ' + number(excluded) + '개.' : '');
      $('ca-since').value = dates[0]; $('ca-until').value = dates.at(-1); $('ca-channel').value = 'all'; $('ca-month').value = ''; markPreset(null); await load();
    } catch (error) { message(error.message, true); $('ca-import-status').textContent = error.message; }
    finally { importSaving = false; lockedInputs.forEach(({ input, disabled }) => { input.disabled = disabled; }); $('ca-preview').disabled = false; $('ca-save').disabled = !pendingImport; }
  }
  $('ca-query').addEventListener('submit', event => { event.preventDefault(); load(); });
  $('ca-since').max = $('ca-until').max = today;
  for (const id of ['ca-since', 'ca-until']) $(id).addEventListener('change', () => { ++loadSequence; loading = false; $('ca-query').querySelector('[type="submit"]').disabled = false; clearResults(); updateLinks(); $('ca-month').value = ''; markPreset(null); });
  $('ca-channel').addEventListener('change', load);
  document.querySelectorAll('[data-ca-preset]').forEach(button => button.addEventListener('click', () => setPreset(Number(button.dataset.caPreset))));
  for (let i = 0; i < 24; i++) {
    const date = new Date(Date.parse(today)); date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() - i); const month = date.toISOString().slice(0, 7), option = element('option', date.getUTCFullYear() + '년 ' + (date.getUTCMonth() + 1) + '월'); option.value = month; $('ca-month').append(option);
  }
  $('ca-month').addEventListener('change', () => {
    const month = $('ca-month').value; if (!month) return; const next = new Date(month + '-01T00:00:00Z'); next.setUTCMonth(next.getUTCMonth() + 1);
    $('ca-since').value = month + '-01'; const last = dateShift(next.toISOString().slice(0, 10), -1), yesterday = dateShift(today, -1); $('ca-until').value = last < yesterday ? last : yesterday >= month + '-01' ? yesterday : today;
    markPreset(null); load();
  });
  $('ca-file').addEventListener('change', () => { if (importSaving) return; ++parseSequence; pendingImport = null; $('ca-save').disabled = true; $('ca-preview').disabled = false; $('ca-import-status').textContent = ''; $('ca-import-preview').replaceChildren(); $('ca-import-preview').hidden = true; });
  $('ca-preview').addEventListener('click', previewImport); $('ca-save').addEventListener('click', saveImport);
  if (view === 'dashboard') {
    for (const s of series) {
      const label = element('label'), input = element('input'); input.type = 'checkbox'; input.checked = true; input.style.accentColor = s.color;
      input.addEventListener('change', () => { if (input.checked) activeSeries.add(s.key); else activeSeries.delete(s.key); if (report) renderChart(); }); const text = element('span', ({profitBeforeAds:'이익금',advertising:'광고비',sourceNetProfit:'순이익금',estimatedProfitBeforeAds:'예상 이익'})[s.key] || s.label); label.title = s.label; text.dataset.caSeriesLabel = s.key; label.append(input, text); $('ca-legend').append(label);
    }
    $('ca-daily-details').addEventListener('click', () => {
      dailyDetails = !dailyDetails; $('ca-daily-details').setAttribute('aria-pressed', String(dailyDetails)); $('ca-daily-details').textContent = dailyDetails ? '세부 항목 접기' : '세부 항목'; if (report) renderDaily();
    });
    $('ca-daily-export').addEventListener('click', () => {
      if (!report) return;
      const totals = dailyTotal(report.daily, report.dailyReportSummary);
      downloadCsv('쿠팡_일일손익', [['일자', ...dailyColumns.map(c => c[1]), '자료 기준'], ['합계', ...dailyColumns.map(([key]) => totals[key]), '확인된 날짜 합계'], ...report.daily.map(row => [row.date, ...dailyColumns.map(([key]) => dailyValue(row, key)), (sourceNames[row.source] || '혼합 자료') + (dailyColumns.some(([key]) => dailyEstimated(row, key)) ? ' · 예상 포함' : '')])]);
    });
    $('ca-product-export').addEventListener('click', () => downloadCsv('쿠팡_상품별일일', [['일자', '배송 방식', '상품 ID', '상품명', '판매수량', '매출', '매출 집계 상태', '자료 기준'], ...(report ? productDailyRows() : []).map(row => [row.date, channels[row.channel], row.productId, row.name, displayedValue(row, 'quantity'), displayedValue(row, 'sales'), salesStatus(row), sourceNames[row.source] || '혼합 자료'])]));
  } else {
    if (![...visibleColumns].some(key => columns.some(c => c.key === key))) visibleColumns = new Set(defaultColumns);
    for (const column of [{ key: 'name', label: '상품명' }, ...columns]) for (const direction of ['desc', 'asc']) { const option = element('option', column.label + (direction === 'desc' ? ' 높은 순' : ' 낮은 순')); option.value = column.key + ':' + direction; $('ca-sort').append(option); }
    $('ca-sort').value = 'sales:desc';
    for (const column of columns) {
      const label = element('label'), check = element('input'); check.type = 'checkbox'; check.checked = visibleColumns.has(column.key); check.dataset.columnKey = column.key;
      check.addEventListener('change', () => { if (check.checked) visibleColumns.add(column.key); else visibleColumns.delete(column.key); saveSetting('columns', [...visibleColumns]); updateCostColumnButton(); if (report) renderSales(); }); label.append(check, element('span', column.label)); $('ca-column-options').append(label);
    }
    if ($('ca-show-cost-columns')) { $('ca-show-cost-columns').addEventListener('click', revealCostColumns); updateCostColumnButton(); }
    $('ca-search').addEventListener('input', () => { if (report) renderSales(); }); $('ca-sort').addEventListener('change', () => { if (report) renderSales(); }); $('ca-favorites').addEventListener('change', () => { if (report) renderSales(); });
    $('ca-group').addEventListener('change', () => { updateLinks(); history.replaceState(null,'',location.pathname+'?'+queryString()); if (report) renderSales(); });
    $('ca-compact').addEventListener('click', () => { const on = $('ca-compact').getAttribute('aria-pressed') !== 'true'; $('ca-compact').setAttribute('aria-pressed', String(on)); $('ca-compact').textContent = on ? '넓게 보기' : '간격 줄이기'; document.body.classList.toggle('ca-compact', on); document.body.classList.toggle('ca-roomy', !on); });
    $('ca-expand-all').addEventListener('click', () => { if (!report) return; const shown = currentGroups(), collapse = shown.every(group => expanded.has(group.id)); for (const group of shown) { if (collapse) expanded.delete(group.id); else expanded.add(group.id); } renderSales(); });
    $('ca-sales-export').addEventListener('click', () => { const fields = columns.filter(column => visibleColumns.has(column.key)); downloadCsv('쿠팡_상품별손익', [['행 구분', '상품 ID', '옵션 ID', '배송 방식', '상품명', '옵션명', '원래 상품명', ...fields.map(c => c.label), '매출 집계 상태', '자료 기준'], ...currentGroups().flatMap(group => [['상품 합계', group.id, '', group.channel, group.name, '', group.fullName || group.name, ...fields.map(c => displayedValue(group, c.key)), salesStatus(group), sourceNames[group.source] || '혼합 자료'], ...group.options.map(option => ['옵션', group.id, option.id, channels[option.channel], option.name, option.optionName, option.fullName || option.name, ...fields.map(c => displayedValue(option, c.key)), salesStatus(option), sourceNames[option.source] || '혼합 자료'])])]); });
  }
  window.addEventListener('storage', handleAdvertisingStorage);
  window.addEventListener('coupang-product-metadata', event => { if (report && event.detail?.vendorKey === report.vendorKey && event.detail?.scopeKey === report.scopeKey) load(); });
  $('ca-reference-import')?.addEventListener('click', openReferenceImport);
  $('ca-calculation-date')?.addEventListener('change', renderDailyCalculation);
  const initial = new URLSearchParams(location.search); $('ca-since').value = initial.get('since') || dateShift(today, -7); $('ca-until').value = initial.get('until') || dateShift(today, -1);
  const matchingPreset = [...document.querySelectorAll('[data-ca-preset]')].map(button => Number(button.dataset.caPreset)).find(days => {
    const until = days === 0 ? today : dateShift(today, -1), since = days < 2 ? until : dateShift(until, -days + 1);
    return $('ca-since').value === since && $('ca-until').value === until;
  });
  markPreset(matchingPreset === undefined ? null : matchingPreset);
  $('ca-channel').value = ['all', 'growth', 'seller'].includes(initial.get('channel')) ? initial.get('channel') : 'all'; load();
  if ($('ca-refresh-orders')) {
    $('ca-refresh-orders').addEventListener('click', refreshOrders); loadPipelineStatus();
    $('ca-history-start')?.addEventListener('click', () => historyAction('maximum'));
    $('ca-history-resume')?.addEventListener('click', () => historyAction('resume'));
    $('ca-history-pause')?.addEventListener('click', () => historyAction('pause'));
    window.addEventListener('pagehide', () => { pipelineStopped = true; clearTimeout(pipelineTimer); });
    window.addEventListener('pageshow', () => { if (pipelineStopped) { pipelineStopped = false; loadPipelineStatus(); } });
    document.addEventListener('visibilitychange', () => { if (document.hidden) clearTimeout(pipelineTimer); else loadPipelineStatus(); });
  }
})();
