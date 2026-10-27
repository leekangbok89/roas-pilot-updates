(function () {
  'use strict';
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const metrics = [
    ['advertising', '매출성장 광고비'], ['adSales', '광고 집행 매출'], ['roas', '광고 ROAS'],
    ['adQuantity', '광고 판매량'], ['organicQuantity', '일반 판매량'],
    ['adProfitBeforeAds', '광고 집행 이익금'], ['adNetProfit', '광고 이익 · 신규광고 제외']
  ];
  const channelNames = { growth: '로켓그로스', seller: '판매자배송', all: '전체 배송' };
  const sourceNames = { sellha: '셀하 손익 파일', api: 'API 주문 · 광고 자료 없음', missing: '자료 없음', mixed: '혼합 자료 · 일부 미수집' };
  function aggregate(rows) {
    const result = {};
    for (const [key] of metrics) {
      if (key === 'roas' || key === 'adNetProfit') continue;
      result[key] = rows.length && rows.every(row => finite(row[key])) ? rows.reduce((total, row) => total + row[key], 0) : null;
    }
    result.roas = result.advertising > 0 && finite(result.adSales) ? result.adSales / result.advertising * 100 : null;
    result.adNetProfit = finite(result.adProfitBeforeAds) && finite(result.advertising) ? result.adProfitBeforeAds - result.advertising : null;
    result.source = rows.length && rows.every(row => row.source === rows[0].source) ? rows[0].source : 'mixed';
    return result;
  }
  function productGroups(rows, filters = {}) {
    const search = String(filters.search || '').trim().toLocaleLowerCase('ko-KR');
    const allowed = Array.isArray(filters.itemIds) ? new Set(filters.itemIds.map(String)) : null;
    const map = new Map();
    for (const row of rows || []) {
      if (allowed && !allowed.has(String(row.itemId))) continue;
      if (search && ![row.productId, row.itemId, row.name, row.optionName].some(value => String(value || '').toLocaleLowerCase('ko-KR').includes(search))) continue;
      const id = String(row.productId || row.itemId);
      if (!map.has(id)) map.set(id, []);
      map.get(id).push(row);
    }
    return [...map].map(([id, selected]) => {
      const options = new Map();
      for (const row of selected) {
        const key = row.channel + ':' + row.itemId;
        if (!options.has(key)) options.set(key, []);
        options.get(key).push(row);
      }
      return { ...aggregate(selected), id, name: selected[0].name || id, rows: selected,
        channel: [...new Set(selected.map(row => channelNames[row.channel] || row.channel))].join(' + '),
        options: [...options].map(([key, values]) => ({ ...aggregate(values), key, itemId: String(values[0].itemId), name: values[0].optionName || values[0].name || values[0].itemId, channel: channelNames[values[0].channel] || values[0].channel })) };
    }).filter(group => !filters.lossOnly || finite(group.adNetProfit) && group.adNetProfit < 0);
  }
  function compare(a, b, key, ascending) {
    if (key === 'name') return String(a.name).localeCompare(String(b.name), 'ko-KR') * (ascending ? 1 : -1);
    const av = a[key], bv = b[key];
    if (!finite(av) || !finite(bv)) return finite(av) ? -1 : finite(bv) ? 1 : 0;
    return (av - bv) * (ascending ? 1 : -1);
  }
  function csvCell(value) {
    let text = value === null || value === undefined ? '' : String(value);
    if (/^[\s]*[=+@\-]/.test(text) && !finite(value)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }
  const helpers = { aggregate, productGroups, compare, csvCell };
  if (typeof module !== 'undefined' && module.exports) module.exports = helpers;
  if (typeof document === 'undefined') return;
  const $ = id => document.getElementById(id);
  const el = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
  const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const shift = (date, days) => new Date(Date.parse(date) + days * 86400000).toISOString().slice(0, 10);
  const format = (value, key) => !finite(value) ? '—' : value.toLocaleString('ko-KR', { maximumFractionDigits: key === 'roas' ? 2 : 0 }) + (key === 'roas' ? '%' : key.endsWith('Quantity') ? '' : '원');
  let report = null, savedGroups = [], expanded = new Set(), sequence = 0, shown = [];
  function message(text, error = false) { $('cad-message').textContent = text; $('cad-message').dataset.error = String(error); }
  function query() { return { since: $('cad-since').value, until: $('cad-until').value, channel: $('cad-channel').value }; }
  function syncLinks() {
    const search = new URLSearchParams(query()).toString();
    document.querySelectorAll('.ca-subnav a').forEach(link => { const url = new URL(link.href); url.search = search; link.href = url.pathname + url.search; });
    $('cad-import-link').href = '/coupang-sales.html?' + search + '#ca-import';
  }
  async function get(route) {
    const response = await fetch('/api/coupang/' + route, { credentials: 'same-origin' });
    let data; try { data = await response.json(); } catch (_) { throw Error('서버 응답을 읽을 수 없습니다. ROAS Pilot 프로그램을 확인해 주세요.'); }
    if (!response.ok) throw Error(data.error || '쿠팡 자료를 불러오지 못했습니다.');
    return data;
  }
  function clear() { report = null; shown = []; $('cad-summary').replaceChildren(); $('cad-body').replaceChildren(); $('cad-count').textContent = ''; }
  function markPreset(days) { document.querySelectorAll('[data-cad-preset]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.cadPreset) === days))); }
  async function load() {
    const values = query(), valid = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
    if (!valid(values.since) || !valid(values.until) || values.since > values.until || values.until > today || Date.parse(values.until) - Date.parse(values.since) >= 366 * 86400000) return message('조회 기간은 미래 날짜를 제외하고 최대 366일로 선택해 주세요.', true);
    const token = ++sequence; clear(); syncLinks(); $('cad-refresh').disabled = true; message('저장된 상품별 광고 자료를 불러옵니다.');
    $('cad-coverage').textContent = values.since + ' ~ ' + values.until + ' 조회 중';
    try {
      const results = await Promise.allSettled([get('analytics?' + new URLSearchParams(values) + '&view=sales'), get('workspace')]);
      if (token !== sequence) return;
      if (results[0].status === 'rejected') throw results[0].reason;
      report = results[0].value;
      const previous = $('cad-group').value;
      const workspaceMatches = results[1].status === 'fulfilled' && results[1].value.revision === report.workspaceRevision && results[1].value.scopeKey === report.scopeKey;
      savedGroups = workspaceMatches && Array.isArray(results[1].value.groups) ? results[1].value.groups : [];
      $('cad-group').replaceChildren(el('option', '전체 상품')); $('cad-group').firstChild.value = '';
      savedGroups.forEach(group => { const option = el('option', group.name); option.value = group.id; $('cad-group').append(option); });
      if (savedGroups.some(group => group.id === previous)) $('cad-group').value = previous;
      render(); history.replaceState(null, '', location.pathname + '?' + new URLSearchParams(values));
      const coverage = report.coverage || {};
      $('cad-coverage').textContent = report.since + ' ~ ' + report.until + ' · ' + channelNames[values.channel] + ' · 셀하 파일 ' + (coverage.sellhaDays || 0) + '/' + (coverage.totalDays || 0) + '일 · API 자료 ' + (coverage.apiDays || 0) + '일. 미수집 날짜·옵션이 있으면 광고 기간 합계는 —로 표시합니다.';
      const known = (report.items || []).some(row => metrics.some(([key]) => finite(row[key])));
      message((known ? '상품별 광고 자료 조회 완료. ' : '선택한 기간의 광고 실적을 확인할 수 없습니다. 손익 엑셀을 가져오거나 파일이 저장된 날짜를 선택해 주세요. ') + (results[1].status === 'rejected' ? '상품 그룹을 불러오지 못해 전체 상품을 표시합니다.' : !workspaceMatches ? '조회 중 판매자·상품·그룹 설정이 변경되어 그룹을 적용하지 않았습니다. 저장 자료 조회를 다시 눌러 주세요.' : '신규고객확보 광고비는 이 표의 광고 이익에서 제외됩니다.'));
    } catch (error) { if (token === sequence) { message(error.message + ' 자료·연결 관리에서 연결 상태를 확인해 주세요.', true); $('cad-coverage').textContent = '조회 실패 · 저장 자료를 다시 조회해 주세요.'; } }
    finally { if (token === sequence) $('cad-refresh').disabled = false; }
  }
  function valueCell(tr, row, key) { const cell = el('td', format(row[key], key), 'ca-number'); if (finite(row[key]) && row[key] < 0) cell.classList.add('ca-negative'); tr.append(cell); }
  function render() {
    if (!report) return;
    const selected = savedGroups.find(group => group.id === $('cad-group').value);
    shown = productGroups(report.items, { search: $('cad-search').value, itemIds: selected?.itemIds, lossOnly: $('cad-loss').checked });
    const [sortKey, direction] = $('cad-sort').value.split(':'); shown.sort((a, b) => compare(a, b, sortKey, direction === 'asc') || a.id.localeCompare(b.id));
    const rows = shown.flatMap(group => group.rows), total = aggregate(rows), summary = $('cad-summary'); summary.replaceChildren();
    for (const [key, label] of [metrics[0], metrics[1], metrics[2], metrics[3], metrics[6]]) {
      const card = el('div', undefined, 'ca-card'), value = el('strong', format(total[key], key)); if (finite(total[key]) && total[key] < 0) value.className = 'ca-negative';
      card.append(el('small', label), value, el('small', key === 'adNetProfit' ? '신규고객확보 광고비 제외' : finite(total[key]) ? '현재 표의 상품 합계' : '일부 미수집 또는 자료 없음')); summary.append(card);
    }
    $('cad-count').textContent = shown.length + '개 상품 · ' + rows.length + '개 옵션·배송 방식' + (selected ? ' · 그룹: ' + selected.name : '') + ' · 모든 금액은 선택한 기간 기준입니다.';
    const head = el('tr'); for (const label of ['옵션', '상품 / 옵션', '배송 방식', ...metrics.map(entry => entry[1]), '자료 기준']) { const th = el('th', label); th.scope = 'col'; head.append(th); } $('cad-head').replaceChildren(head);
    const host = $('cad-body'); host.replaceChildren();
    if (!shown.length) {
      const tr = el('tr'), cell = el('td', rows.length ? '' : '조건에 맞는 상품이 없습니다. 검색·그룹·광고 손실 필터를 확인해 주세요.', 'ca-empty'); cell.colSpan = 11; tr.append(cell); host.append(tr);
    } else {
      const tr = el('tr', undefined, 'ca-totals-row'), label = el('td', '현재 표 합계'); label.colSpan = 3; tr.append(label); metrics.forEach(([key]) => valueCell(tr, total, key)); tr.append(el('td', '미수집은 0원으로 계산하지 않음')); host.append(tr);
      for (const group of shown) {
        const tr = el('tr', undefined, 'ca-group-row'), toggleCell = el('td'), toggle = el('button', expanded.has(group.id) ? '−' : '+', 'ca-expand'); toggle.type = 'button'; toggle.setAttribute('aria-label', group.name + ' 옵션 ' + (expanded.has(group.id) ? '접기' : '펼치기')); toggle.setAttribute('aria-expanded', String(expanded.has(group.id))); toggle.addEventListener('click', () => { if (expanded.has(group.id)) expanded.delete(group.id); else expanded.add(group.id); render(); }); toggleCell.append(toggle); tr.append(toggleCell);
        const name = el('td', group.name, 'ca-name'); name.append(el('small', '상품 ID ' + group.id + ' · ' + group.options.length + '개 옵션·배송 방식')); tr.append(name, el('td', group.channel)); metrics.forEach(([key]) => valueCell(tr, group, key)); tr.append(el('td', sourceNames[group.source] || '혼합 자료')); host.append(tr);
        if (expanded.has(group.id)) for (const option of group.options) { const child = el('tr', undefined, 'ca-option-row'); child.append(el('td', '')); const name = el('td', option.name, 'ca-name'); name.append(el('small', '옵션 ID ' + option.itemId)); child.append(name, el('td', option.channel)); metrics.forEach(([key]) => valueCell(child, option, key)); child.append(el('td', sourceNames[option.source] || '혼합 자료')); host.append(child); }
      }
    }
    const collapse = shown.length > 0 && shown.every(group => expanded.has(group.id)); $('cad-expand').textContent = collapse ? '옵션 모두 접기' : '옵션 모두 펼치기'; $('cad-expand').disabled = !shown.length; $('cad-export').disabled = !shown.length;
  }
  function download() {
    if (!shown.length || !report) return;
    const rows = [['시작일', '종료일', '행 구분', '상품 ID', '옵션 ID', '상품명 / 옵션명', '배송 방식', ...metrics.map(entry => entry[1]), '자료 기준']];
    for (const group of shown) { rows.push([report.since, report.until, '상품 합계', group.id, '', group.name, group.channel, ...metrics.map(([key]) => group[key]), sourceNames[group.source] || '혼합 자료']); for (const option of group.options) rows.push([report.since, report.until, '옵션', group.id, option.itemId, option.name, option.channel, ...metrics.map(([key]) => option[key]), sourceNames[option.source] || '혼합 자료']); }
    const blob = new Blob(['\ufeff' + rows.map(row => row.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }), url = URL.createObjectURL(blob), link = el('a'); link.href = url; link.download = '쿠팡_상품별광고_' + report.since + '_' + report.until + '.csv'; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  $('cad-query').addEventListener('submit', event => { event.preventDefault(); load(); });
  for (const id of ['cad-search', 'cad-group', 'cad-sort', 'cad-loss']) $(id).addEventListener(id === 'cad-search' ? 'input' : 'change', render);
  for (const id of ['cad-since', 'cad-until']) { $(id).max = today; $(id).addEventListener('change', () => { ++sequence; clear(); $('cad-refresh').disabled = false; $('cad-month').value = ''; markPreset(null); syncLinks(); message('변경한 기간으로 저장 자료 조회를 눌러 주세요.'); }); }
  $('cad-channel').addEventListener('change', load);
  document.querySelectorAll('[data-cad-preset]').forEach(button => button.addEventListener('click', () => { const days = Number(button.dataset.cadPreset); $('cad-until').value = shift(today, -1); $('cad-since').value = shift(today, -days); $('cad-month').value = ''; markPreset(days); load(); }));
  for (let index = 0; index < 24; index++) { const date = new Date(today + 'T00:00:00Z'); date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() - index); const option = el('option', date.getUTCFullYear() + '년 ' + (date.getUTCMonth() + 1) + '월'); option.value = date.toISOString().slice(0, 7); $('cad-month').append(option); }
  $('cad-month').addEventListener('change', () => { const month = $('cad-month').value; if (!month) return; const next = new Date(month + '-01T00:00:00Z'); next.setUTCMonth(next.getUTCMonth() + 1); $('cad-since').value = month + '-01'; const last = shift(next.toISOString().slice(0, 10), -1), yesterday = shift(today, -1); $('cad-until').value = last < yesterday ? last : yesterday >= month + '-01' ? yesterday : today; markPreset(null); load(); });
  $('cad-expand').addEventListener('click', () => { const collapse = shown.every(group => expanded.has(group.id)); shown.forEach(group => { if (collapse) expanded.delete(group.id); else expanded.add(group.id); }); render(); }); $('cad-export').addEventListener('click', download);
  const initial = new URLSearchParams(location.search); $('cad-since').value = initial.get('since') || shift(today, -1); $('cad-until').value = initial.get('until') || shift(today, -1); $('cad-channel').value = ['all', 'growth', 'seller'].includes(initial.get('channel')) ? initial.get('channel') : 'all';
  markPreset($('cad-since').value === shift(today, -1) && $('cad-until').value === shift(today, -1) ? 1 : null); load();
})();
