(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const view = document.body.dataset.coupangView;
  const channels = { all: '전체 배송', growth: '로켓그로스', seller: '판매자배송' };
  const sourceNames = { sellha: '셀하 손익 파일', ledger: '확인한 매출·비용', api: 'API 주문 · 반품 미확정', missing: '자료 없음' };
  const moneyFields = new Set(['sales', 'profitBeforeAds', 'sourceNetProfit', 'advertising', 'adSales', 'adProfitBeforeAds', 'adNetProfit', 'netProfit', 'unitCost', 'salePrice', 'otherCosts', 'acquisitionAdvertising']);
  const summable = ['quantity', 'adQuantity', 'organicQuantity', 'sales', 'profitBeforeAds', 'sourceNetProfit', 'advertising', 'adSales', 'adProfitBeforeAds', 'adNetProfit', 'netProfit', 'estimatedProductCost', 'estimatedCommission', 'estimatedFulfillment'];
  const series = [
    { key: 'sales', label: '매출', color: '#508fd1' },
    { key: 'profitBeforeAds', label: '이익금 · 광고비 차감 전', color: '#d75c78' },
    { key: 'advertising', label: '매출성장 광고비', color: '#c29b28' },
    { key: 'sourceNetProfit', label: '셀하 순이익 · 신규광고 제외', color: '#25966c' }
  ];
  const columns = [
    { key: 'inventory', label: '재고', note: '현재 수집 자료에 재고가 없으면 표시하지 않습니다.' },
    { key: 'quantity', label: '판매량' }, { key: 'adQuantity', label: '광고 판매량' }, { key: 'organicQuantity', label: '일반 판매량' },
    { key: 'sales', label: '할인 후 매출' }, { key: 'profitBeforeAds', label: '이익금', note: '매출성장 광고비 차감 전 · 원가 및 기타비용 반영' },
    { key: 'sourceNetProfit', label: '셀하 순이익', note: '이익금 − 매출성장 광고비. 신규고객확보 광고비 제외' },
    { key: 'advertising', label: '매출성장 광고비' }, { key: 'adSales', label: '광고 집행 매출' },
    { key: 'roas', label: '광고 ROAS', note: '광고 집행 매출 ÷ 매출성장 광고비 × 100' },
    { key: 'adProfitBeforeAds', label: '광고 집행 이익금' }, { key: 'adNetProfit', label: '광고 집행 순이익', note: '광고 집행 이익금 − 매출성장 광고비. 신규고객확보 광고비 제외' },
    { key: 'unitCost', label: '개당 원가' }, { key: 'salePrice', label: '등록 판매가' },
    { key: 'estimatedProductCost', label: 'API 추정 상품원가' }, { key: 'estimatedCommission', label: 'API 추정 수수료' },
    { key: 'estimatedFulfillment', label: 'API 추정 입출고·배송비' }
  ];
  ['estimatedProductCost', 'estimatedCommission', 'estimatedFulfillment'].forEach(k => moneyFields.add(k));
  const defaultColumns = columns.filter(c => !['salePrice', 'estimatedProductCost', 'estimatedCommission', 'estimatedFulfillment'].includes(c.key)).map(c => c.key);
  let report = null, groups = [], pendingImport = null, loading = false, loadSequence = 0, parseSequence = 0, importSaving = false;
  let savedGroups = [];
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
  const valueText = (value, key) => key === 'roas' ? percent(value) : moneyFields.has(key) ? won(value) : number(value);
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
  function queryString() { return new URLSearchParams(queryValues()).toString(); }
  async function request(route, body) {
    const response = await fetch('/api/coupang/' + route, body === undefined ? { credentials: 'same-origin' } : {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-ROAS-Local-Action': 'yes' }, body: JSON.stringify(body)
    });
    let value; try { value = await response.json(); } catch (_) { throw Error('서버 응답을 읽을 수 없습니다. ROAS Pilot 프로그램을 확인해 주세요.'); }
    if (!response.ok) throw Error(value.error || '쿠팡 자료를 불러오지 못했습니다.'); return value;
  }
  function updateLinks() {
    document.querySelectorAll('.ca-subnav a').forEach(link => { const url = new URL(link.href); url.search = queryString(); link.href = url.pathname + url.search; });
  }
  function clearResults() {
    report = null; groups = []; productDailyPage = 0; productDailyCache = null; $('ca-summary').replaceChildren(); $('ca-coverage').textContent = '선택한 기간으로 저장 자료를 조회해 주세요.';
    if (view === 'dashboard') {
      $('ca-chart').replaceChildren(element('p', '조회한 자료가 여기에 표시됩니다.', 'ca-empty'));
      $('ca-daily-body').replaceChildren(); $('ca-product-daily-body').replaceChildren(); $('ca-chart-tooltip').hidden = true;
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
      report = results[0].value;
      if (view === 'sales') updateGroupChoices(results[1]);
      render(); history.replaceState(null, '', location.pathname + '?' + queryString());
      message(isNumber(displayedValue(report.summary, 'sales')) ? '저장 자료 조회 완료 · ' + report.since + ' ~ ' + report.until + ' · ' + channels[queryValues().channel] + (isPartialValue(report.summary, 'sales') ? ' · 수집된 매출을 먼저 표시합니다. 일부 날짜·배송 방식·상품 자료는 미수집입니다.' : '') : '조회 기간에 저장된 주문·손익 파일이 없습니다. 주문을 수집하거나 셀하 손익 엑셀을 가져와 주세요.');
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
      ['sales', '매출', '셀하 할인 후 매출 / API 주문금액'],
      ['profitBeforeAds', '이익금', '매출성장 광고비 차감 전'],
      ['advertising', '매출성장 광고비', '셀하 파일의 광고 집행비'],
      ['sourceNetProfit', '셀하 순이익', '신규고객확보 광고비 제외'],
      ['acquisitionAdvertising', '신규고객확보 광고비', '일별 추가 광고비 확인분'],
      ['netProfit', '전체 광고비 반영 순이익', '추가 광고비 확인한 날짜만 계산']
    ]) {
      const partial = isPartialValue(summary, key), amount = displayedValue(summary, key);
      const card = element('div', undefined, 'ca-card ca-card-' + key), label = element('small', title + (partial ? ' · 수집분' : '')), value = element('strong', won(amount));
      if (isNumber(amount) && amount < 0) value.className = 'ca-negative';
      card.append(label, value, element('small', partial ? '일부 미수집 · 확인된 매출만 합산 / 전체 기간 미확정' : note)); host.append(card);
    }
    const coverage = report.coverage || {}, imported = Array.isArray(report.importedDates) ? report.importedDates : [];
    const last = report.lastImportedAt ? new Date(report.lastImportedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : null;
    $('ca-coverage').textContent = '조회 ' + report.since + ' ~ ' + report.until + ' · 셀하 파일 ' + (coverage.sellhaDays || 0) + '일 · API 자료 ' + (coverage.apiDays || 0) + '일 / ' + (coverage.totalDays || report.daily.length) + '일' +
      (imported.length ? ' · 셀하 저장 기간 ' + imported[0] + ' ~ ' + imported.at(-1) : ' · 셀하 파일 미등록') + (last ? ' · 마지막 저장 ' + last : '') + (isNumber(displayedValue(summary, 'sales')) ? ' · 수집된 매출은 누락 자료와 구분해 표시합니다. 미수집 부분은 0원으로 계산하지 않습니다.' : ' · 조회 기간에 저장된 주문·손익 파일이 없습니다. 주문 수집 또는 손익 엑셀 가져오기를 이용하세요.');
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
    return td;
  }
  function noSalesContent() {
    const content = element('div'); content.append(element('p', '조회 기간에 저장된 주문·손익 파일이 없습니다.'));
    const collect = element('a', '주문 수집·연결 관리'), upload = element('a', '손익 엑셀 가져오기');
    collect.href = '/coupang.html'; upload.href = '#ca-import'; upload.style.marginLeft = '12px';
    upload.addEventListener('click', () => { $('ca-import').open = true; }); content.append(collect, upload); return content;
  }
  function render() {
    renderCards();
    if (view === 'dashboard') { renderChart(); renderDaily(); renderProductDaily(); }
    else { buildGroups(); renderSales(); }
  }
  function svgNode(tag, attributes = {}, text) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value); if (text !== undefined) node.textContent = text; return node;
  }
  function chartDescription(row) { return row.date + ' · ' + series.filter(s => activeSeries.has(s.key)).map(s => s.label + ' ' + won(displayedValue(row, s.key)) + (isPartialValue(row, s.key) ? ' (수집분 · 일부 미수집)' : '')).join(' · '); }
  function renderChart() {
    const host = $('ca-chart'); host.replaceChildren(); $('ca-chart-tooltip').hidden = true;
    const rows = report.daily || [], chosenSeries = series.filter(s => activeSeries.has(s.key));
    const salesLegend = document.querySelector('[data-ca-series-label="sales"]'); if (salesLegend) salesLegend.textContent = '매출' + (rows.some(row => isPartialValue(row, 'sales')) ? ' · 수집분' : '');
    const values = rows.flatMap(row => chosenSeries.map(s => displayedValue(row, s.key))).filter(isNumber);
    if (!rows.length || !values.length) {
      if (chosenSeries.length && !isNumber(displayedValue(report.summary, 'sales'))) host.append(noSalesContent());
      else host.append(element('p', chosenSeries.length ? '선택한 지표에 확인된 값이 없습니다. 매출 지표를 선택하거나 손익 파일을 가져와 주세요.' : '표시할 지표를 선택해 주세요.', 'ca-empty'));
      return;
    }
    const width = 900, height = 350, left = 82, right = 22, top = 20, bottom = 45;
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
        const value = displayedValue(row, s.key); if (!isNumber(value)) { running = false; return; }
        path += (running ? ' L ' : ' M ') + x(index) + ',' + y(value); running = true;
      });
      svg.append(svgNode('path', { d: path, stroke: s.color, fill: 'none', 'stroke-width': 2.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
      rows.forEach((row, index) => { const value = displayedValue(row, s.key); if (isNumber(value)) svg.append(svgNode('circle', { cx: x(index), cy: y(value), r: rows.length < 45 ? 3.5 : 1.6, fill: s.color })); });
    }
    const cursor = svgNode('line', { x1: 0, x2: 0, y1: top, y2: height - bottom, stroke: 'var(--app-link)', 'stroke-dasharray': '4 4', visibility: 'hidden' }); svg.append(cursor);
    function show(index) {
      const row = rows[index], tooltip = $('ca-chart-tooltip'); cursor.setAttribute('x1', x(index)); cursor.setAttribute('x2', x(index)); cursor.setAttribute('visibility', 'visible');
      tooltip.replaceChildren(element('strong', row.date));
      for (const s of chosenSeries) { const p = element('div', s.label + '  ' + won(displayedValue(row, s.key)) + (isPartialValue(row, s.key) ? ' (수집분 · 일부 미수집)' : '')); p.style.borderLeft = '3px solid ' + s.color; p.style.paddingLeft = '8px'; tooltip.append(p); }
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
  const dailyColumns = [
    ['sales', '매출'], ['profitBeforeAds', '이익금'], ['advertising', '매출성장 광고비'], ['otherCosts', '기타비용'], ['sourceNetProfit', '셀하 순이익'], ['acquisitionAdvertising', '신규고객확보 광고비'], ['netProfit', '전체 광고비 반영 순이익']
  ];
  let dailySort = { key: 'date', ascending: false };
  function compareValues(a, b, key, ascending) {
    const av = displayedValue(a, key), bv = displayedValue(b, key); if (av == null && bv == null) return 0; if (av == null) return 1; if (bv == null) return -1;
    const order = typeof av === 'string' ? av.localeCompare(String(bv), 'ko') : av - bv; return ascending ? order : -order;
  }
  function renderDaily() {
    const header = element('tr');
    for (const [key, title] of [['date', '일자'], ...dailyColumns]) {
      const th = element('th'), button = element('button', title + (dailySort.key === key ? dailySort.ascending ? ' ↑' : ' ↓' : ''));
      th.scope = 'col'; th.setAttribute('aria-sort', dailySort.key === key ? dailySort.ascending ? 'ascending' : 'descending' : 'none');
      button.type = 'button'; button.addEventListener('click', () => { dailySort = { key, ascending: dailySort.key === key ? !dailySort.ascending : false }; renderDaily(); }); th.append(button); header.append(th);
    }
    header.append(element('th', '자료 기준')); $('ca-daily-head').replaceChildren(header);
    const host = $('ca-daily-body'); host.replaceChildren();
    const total = element('tr', undefined, 'ca-totals-row'); addCell(total, '기간 합계'); dailyColumns.forEach(([key]) => appendValueCell(total, report.summary, key)); addCell(total, isPartialValue(report.summary, 'sales') ? '수집분 · 일부 미수집 / 이익은 전체 확인 후 계산' : '선택 기간 기준'); host.append(total);
    for (const row of [...report.daily].sort((a, b) => compareValues(a, b, dailySort.key, dailySort.ascending))) {
      const tr = element('tr'); addCell(tr, row.date);
      dailyColumns.forEach(([key]) => appendValueCell(tr, row, key));
      addCell(tr).append(sourceBadge(row)); host.append(tr);
    }
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
      const tr = element('tr'); addCell(tr, row.date); addCell(tr, channels[row.channel]); addCell(tr, row.name, 'ca-name'); appendValueCell(tr, row, 'quantity');
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
    result.roas = isNumber(result.advertising) && result.advertising > 0 && isNumber(result.adSales) ? result.adSales / result.advertising * 100 : null;
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
      const options = [...optionMap.values()].map(values => ({ ...aggregateRows(values), id: values[0].itemId, productId: id, name: values[0].name, optionName: values[0].optionName || values[0].name, channel: values[0].channel, rows: values }));
      return { ...aggregateRows(rows), id, name: rows[0].name, channel: [...new Set(rows.map(r => channels[r.channel]))].join(' + '), options, rows };
    });
  }
  function updateGroupChoices(result) {
    const select = $('ca-group'), selected = select.value;
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
  function currentGroups() {
    const term = $('ca-search').value.trim().toLocaleLowerCase('ko-KR'), favoritesOnly = $('ca-favorites').checked;
    const [key, direction] = $('ca-sort').value.split(':');
    const selected = savedGroups.find(group => group.id === $('ca-group').value);
    return filterProductGroups(groups, selected ? selected.itemIds : null).filter(group => (!favoritesOnly || favoriteIds.has(group.id)) && (!term || [group.id, group.name, ...group.options.flatMap(option => [option.id, option.name, option.optionName])].some(value => String(value || '').toLocaleLowerCase('ko-KR').includes(term))))
      .sort((a, b) => compareValues(a, b, key, direction === 'asc') || a.id.localeCompare(b.id));
  }
  function salesHeader() {
    const tr = element('tr');
    for (const title of ['즐겨찾기', '옵션', '상품 / 옵션 ID', '구분', '상품명 / 옵션명']) { const th = element('th', title); th.scope = 'col'; tr.append(th); }
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
      const tr = element('tr', undefined, 'ca-group-row'), star = element('button', favoriteIds.has(group.id) ? '★' : '☆', 'ca-star');
      star.type = 'button'; star.setAttribute('aria-label', group.name + ' 즐겨찾기'); star.setAttribute('aria-pressed', String(favoriteIds.has(group.id)));
      star.addEventListener('click', () => { if (favoriteIds.has(group.id)) favoriteIds.delete(group.id); else favoriteIds.add(group.id); saveSetting('favorites', [...favoriteIds]); renderSales(); }); addCell(tr).append(star);
      const toggle = element('button', expanded.has(group.id) ? '−' : '+', 'ca-expand'); toggle.type = 'button'; toggle.setAttribute('aria-expanded', String(expanded.has(group.id))); toggle.setAttribute('aria-label', group.name + ' 옵션 ' + (expanded.has(group.id) ? '접기' : '펼치기'));
      toggle.addEventListener('click', () => { if (expanded.has(group.id)) expanded.delete(group.id); else expanded.add(group.id); renderSales(); }); addCell(tr).append(toggle);
      addCell(tr, group.id); addCell(tr, group.channel); const nameCell = addCell(tr, undefined, 'ca-name'); nameCell.append(element('strong', group.name), element('small', group.options.length + '개 옵션'));
      appendNumbers(tr, group); addCell(tr).append(sourceBadge(group)); host.append(tr);
      if (expanded.has(group.id)) for (const option of group.options) {
        const optionRow = element('tr', undefined, 'ca-option-row'); addCell(optionRow, ''); addCell(optionRow, '↳'); addCell(optionRow, option.id); addCell(optionRow, channels[option.channel]);
        const optionCell = addCell(optionRow, undefined, 'ca-name'); optionCell.append(element('strong', option.optionName), element('small', option.name)); appendNumbers(optionRow, option); addCell(optionRow).append(sourceBadge(option)); host.append(optionRow);
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
  async function previewImport() {
    if (importSaving) return;
    const sequence = ++parseSequence;
    pendingImport = null; $('ca-save').disabled = true; const file = $('ca-file').files[0];
    if (!file) return message('셀하 손익 결과.xlsx 파일을 선택해 주세요.', true);
    $('ca-preview').disabled = true; $('ca-import-status').textContent = '손익 파일을 확인합니다.';
    try {
      if (!window.CoupangSheets?.parseSales) throw Error('엑셀 읽기 기능을 불러오지 못했습니다. 페이지를 새로고침해 주세요.');
      const parsed = await window.CoupangSheets.parseSales(file);
      if (sequence !== parseSequence || $('ca-file').files[0] !== file) return;
      pendingImport = parsed;
      $('ca-import-status').textContent = pendingImport.date + ' · ' + pendingImport.rows.length + '개 옵션 확인. 같은 날짜 파일은 이전 손익 자료를 교체하여 중복 합산하지 않습니다. 신규고객확보 광고비를 확인한 후 저장해 주세요.'; $('ca-save').disabled = false;
    } catch (error) { if (sequence === parseSequence) { $('ca-import-status').textContent = error.message; message(error.message, true); } }
    finally { if (sequence === parseSequence) $('ca-preview').disabled = false; }
  }
  async function saveImport() {
    if (importSaving) return;
    if (!pendingImport) return message('손익 파일을 먼저 확인해 주세요.', true);
    const payload = pendingImport, date = payload.date;
    const acquisitionAdvertising = {};
    for (const channel of ['growth', 'seller']) {
      const raw = $('ca-acquisition-' + channel).value; const value = raw === '' ? null : Number(raw);
      if (value !== null && (!Number.isFinite(value) || value < 0 || value > 1e12)) return message('신규고객확보 광고비는 0 이상의 금액으로 입력해 주세요.', true); acquisitionAdvertising[channel] = value;
    }
    importSaving = true; ++parseSequence;
    const lockedInputs = ['ca-file', 'ca-acquisition-growth', 'ca-acquisition-seller'].map(id => ({ input: $(id), disabled: $(id).disabled }));
    lockedInputs.forEach(({ input }) => { input.disabled = true; });
    $('ca-save').disabled = true; $('ca-preview').disabled = true;
    try {
      const result = await request('sales-import', { ...payload, acquisitionAdvertising });
      if (pendingImport === payload) pendingImport = null;
      $('ca-import-status').textContent = date + ' 손익 자료 저장 완료' + (Number.isFinite(result.imported) ? ' · ' + result.imported + '개 옵션' : '') + '. 집계 대상으로 선택한 상품만 통계에 반영합니다.';
      $('ca-since').value = $('ca-until').value = date; $('ca-month').value = ''; markPreset(null); await load();
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
  $('ca-file').addEventListener('change', () => { if (importSaving) return; ++parseSequence; pendingImport = null; $('ca-save').disabled = true; $('ca-preview').disabled = false; $('ca-import-status').textContent = ''; });
  $('ca-preview').addEventListener('click', previewImport); $('ca-save').addEventListener('click', saveImport);
  if (view === 'dashboard') {
    for (const s of series) {
      const label = element('label'), input = element('input'); input.type = 'checkbox'; input.checked = true; input.style.accentColor = s.color;
      input.addEventListener('change', () => { if (input.checked) activeSeries.add(s.key); else activeSeries.delete(s.key); if (report) renderChart(); }); const text = element('span', s.label); text.dataset.caSeriesLabel = s.key; label.append(input, text); $('ca-legend').append(label);
    }
    $('ca-daily-export').addEventListener('click', () => downloadCsv('쿠팡_일일손익', [['일자', ...dailyColumns.map(c => c[1]), '매출 집계 상태', '자료 기준'], ...(report?.daily || []).map(row => [row.date, ...dailyColumns.map(([key]) => displayedValue(row, key)), salesStatus(row), sourceNames[row.source] || '혼합 자료'])]));
    $('ca-product-export').addEventListener('click', () => downloadCsv('쿠팡_상품별일일', [['일자', '배송 방식', '상품 ID', '상품명', '판매수량', '매출', '매출 집계 상태', '자료 기준'], ...(report ? productDailyRows() : []).map(row => [row.date, channels[row.channel], row.productId, row.name, displayedValue(row, 'quantity'), displayedValue(row, 'sales'), salesStatus(row), sourceNames[row.source] || '혼합 자료'])]));
  } else {
    if (![...visibleColumns].some(key => columns.some(c => c.key === key))) visibleColumns = new Set(defaultColumns);
    for (const column of [{ key: 'name', label: '상품명' }, ...columns]) for (const direction of ['desc', 'asc']) { const option = element('option', column.label + (direction === 'desc' ? ' 높은 순' : ' 낮은 순')); option.value = column.key + ':' + direction; $('ca-sort').append(option); }
    $('ca-sort').value = 'sales:desc';
    for (const column of columns) {
      const label = element('label'), check = element('input'); check.type = 'checkbox'; check.checked = visibleColumns.has(column.key);
      check.addEventListener('change', () => { if (check.checked) visibleColumns.add(column.key); else visibleColumns.delete(column.key); saveSetting('columns', [...visibleColumns]); if (report) renderSales(); }); label.append(check, element('span', column.label)); $('ca-column-options').append(label);
    }
    $('ca-search').addEventListener('input', () => { if (report) renderSales(); }); $('ca-sort').addEventListener('change', () => { if (report) renderSales(); }); $('ca-favorites').addEventListener('change', () => { if (report) renderSales(); });
    $('ca-group').addEventListener('change', () => { if (report) renderSales(); });
    $('ca-compact').addEventListener('click', () => { const on = $('ca-compact').getAttribute('aria-pressed') !== 'true'; $('ca-compact').setAttribute('aria-pressed', String(on)); $('ca-compact').textContent = on ? '크게 보기' : '작게 보기'; document.body.classList.toggle('ca-compact', on); });
    $('ca-expand-all').addEventListener('click', () => { if (!report) return; const shown = currentGroups(), collapse = shown.every(group => expanded.has(group.id)); for (const group of shown) { if (collapse) expanded.delete(group.id); else expanded.add(group.id); } renderSales(); });
    $('ca-sales-export').addEventListener('click', () => { const fields = columns.filter(column => visibleColumns.has(column.key)); downloadCsv('쿠팡_상품별손익', [['행 구분', '상품 ID', '옵션 ID', '배송 방식', '상품명', '옵션명', ...fields.map(c => c.label), '매출 집계 상태', '자료 기준'], ...currentGroups().flatMap(group => [['상품 합계', group.id, '', group.channel, group.name, '', ...fields.map(c => displayedValue(group, c.key)), salesStatus(group), sourceNames[group.source] || '혼합 자료'], ...group.options.map(option => ['옵션', group.id, option.id, channels[option.channel], option.name, option.optionName, ...fields.map(c => displayedValue(option, c.key)), salesStatus(option), sourceNames[option.source] || '혼합 자료'])])]); });
  }
  const initial = new URLSearchParams(location.search); $('ca-since').value = initial.get('since') || dateShift(today, -7); $('ca-until').value = initial.get('until') || dateShift(today, -1);
  const matchingPreset = [...document.querySelectorAll('[data-ca-preset]')].map(button => Number(button.dataset.caPreset)).find(days => {
    const until = days === 0 ? today : dateShift(today, -1), since = days < 2 ? until : dateShift(until, -days + 1);
    return $('ca-since').value === since && $('ca-until').value === until;
  });
  markPreset(matchingPreset === undefined ? null : matchingPreset);
  $('ca-channel').value = ['all', 'growth', 'seller'].includes(initial.get('channel')) ? initial.get('channel') : 'all'; load();
})();
