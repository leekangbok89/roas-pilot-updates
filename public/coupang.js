(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const channels = { growth: '로켓그로스', seller: '판매자배송', all: '전체' };
  const costs = { netSales: '환불 반영 매출', productCost: '상품 원가 합계', commission: '판매수수료', advertising: '쿠팡 광고비', inbound: '입출고·입고 운송비', delivery: '배송비', storage: '보관비', returns: '반품·회수 비용', other: '기타 비용' };
  const won = v => v === null || v === undefined ? '—' : Math.round(v).toLocaleString('ko-KR') + '원';
  let busy = false, selected = [], options = [], report = null, configured = false, editor = null, historyRunning = false, historyStamp = '', dirtyScope = false;
  function message(text) { $('cp-message').textContent = text; }
  async function request(route, data) {
    const r = await fetch('/api/coupang/' + route, data === undefined ? { credentials: 'same-origin' } : { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-ROAS-Local-Action': 'yes' }, body: JSON.stringify(data) });
    let v; try { v = await r.json(); } catch { throw Error('서버 응답을 읽을 수 없습니다.'); }
    if (!r.ok) throw Error(v.error || '쿠팡 요청 실패'); return v;
  }
  async function work(operation) {
    if (busy) return; busy = true;
    document.querySelectorAll('#app-main fieldset').forEach(e => { e.disabled = true; });
    try { await operation(); } catch (e) { message(e.message); }
    finally { busy = false; document.querySelectorAll('#app-main fieldset').forEach(e => { e.disabled = false; }); $('cp-catalog-save').disabled = !pendingCatalog; }
  }
  function period() { return { since: $('cp-since').value, until: $('cp-until').value }; }
  function renderOptions() {
    $('cp-products').replaceChildren();
    for (const p of options) {
      const label = document.createElement('label'), check = document.createElement('input'), text = document.createElement('span'), input = document.createElement('input');
      check.type = 'checkbox'; check.checked = selected.some(v => v.itemId === p.itemId); check.dataset.itemId = p.itemId;
      text.textContent = p.name + ' · ' + p.itemId + (p.source ? ' · 수수료 ' + p.commissionRate + '% · 입출고 ' + won(p.inboundFee) + ' · 배송 ' + won(p.deliveryFee) + (p.costSince ? ' · 원가 기준 ' + p.costSince : '') : '');
      input.type = 'number'; input.min = '0'; input.step = '0.01'; input.placeholder = '개당 원가 미등록'; input.value = p.unitCost ?? ''; input.dataset.costId = p.itemId; input.setAttribute('aria-label', p.name + ' 개당 원가');
      label.append(check, text, input); $('cp-products').append(label);
    }
    if (!options.length) $('cp-products').textContent = '주문을 수집해 상품을 불러오거나, 아래에서 옵션을 직접 추가하세요.';
  }
  async function loadOptions() {
    if (dirtyScope) return;
    const v = await request('products?' + new URLSearchParams(period()));
    options = v.products; renderOptions();
  }
  function recentDates(count) {
    const end = new Date(Date.now() + 9 * 3600000); end.setUTCDate(end.getUTCDate() - 1);
    const start = new Date(end); start.setUTCDate(start.getUTCDate() - count + 1);
    $('cp-since').value = start.toISOString().slice(0, 10); $('cp-until').value = end.toISOString().slice(0, 10);
    report = null; render();
  }
  function renderHistory(h) {
    h = h || { status: 'idle', completedDays: 0, totalDays: 0 };
    historyRunning = h.running === true;
    const names = { idle: '대기', running: '수집 중', completed: '수집 완료', failed: '수집 중단 · 오류 확인', paused: '수집 일시정지' };
    $('cp-history-progress').max = Math.max(1, h.totalDays || 0); $('cp-history-progress').value = h.completedDays || 0;
    $('cp-history-status').textContent = (names[h.status] || '상태 확인') + ' · 저장/확인 ' + (h.completedDays || 0) + '/' + (h.totalDays || 0) + '일·배송방식' + (h.skippedDays ? ' · 기존 저장분 ' + h.skippedDays + '일 재사용' : '');
    const failed = h.lastFailure, diagnosis = failed?.diagnosis;
    const failedRange = failed?.since && failed?.until ? '중단 구간: ' + (channels[failed.channel] || '배송 방식 확인') + ' ' + failed.since + ' ~ ' + failed.until : '';
    const failureCode = Number.isInteger(diagnosis?.httpStatus) ? 'HTTP ' + diagnosis.httpStatus : '';
    const failureDetail = diagnosis ? ['중단 원인: ' + (diagnosis.message || diagnosis.category || '상세 진단 확인'), failureCode, diagnosis.action || ''].filter(Boolean).join(' · ') : '';
    $('cp-history-detail').textContent = [h.kind === 'startup' ? '프로그램 실행 시 최근 7일 자동 재확인' : '', h.since && h.until ? '대상: ' + h.since + ' ~ ' + h.until : '', h.current ? channels[h.current.channel] + ' ' + h.current.since + ' ~ ' + h.current.until : '', failedRange, failureDetail, h.pauseRequested && h.running ? '현재 구간 저장 후 중지합니다.' : '', h.error || ''].filter(Boolean).join('\n');
    $('cp-resume').disabled = !['failed', 'paused'].includes(h.status); $('cp-pause').disabled = !h.running;
    return h;
  }
  async function historyStatus(refresh = false) {
    if (!configured) return;
    const previous = historyRunning, h = renderHistory(await request('history'));
    const stamp = [h.id, h.status, h.completedDays].join(':');
    if ((refresh || previous && !h.running) && stamp !== historyStamp) {
      if (!editor) { await loadOptions(); await loadReport(); }
      message(h.error || (h.status === 'completed' ? '수집 완료. 트루버·위마망 상품을 선택하여 저장하세요. 이미 선택한 상품은 저장 자료 조회로 확인할 수 있습니다.' : '완료된 자료는 저장되어 있습니다. 이어서 수집할 수 있습니다.'));
    }
    historyStamp = stamp;
  }
  async function startCollection(input) {
    if (!configured) throw Error('먼저 API 정보를 등록하세요.');
    renderHistory(await request('history', input));
    message('백그라운드 수집을 시작했습니다. 7일씩 나누어 저장합니다. 브라우저를 닫아도 계속되지만 ROAS Pilot 프로그램은 실행해 두세요.');
  }
  function activeRows() { const ch = $('cp-channel').value; return report ? report.daily.filter(r => ch === 'all' || r.channel === ch) : []; }
  function rowText(values) {
    const tr = document.createElement('tr'); for (const value of values) { const td = document.createElement('td'); td.textContent = value; tr.append(td); } return tr;
  }
  function render() {
    $('cp-summary').replaceChildren(); $('cp-daily').replaceChildren(); if (!report) return;
    const rows = activeRows(), summary = report.summaries[$('cp-channel').value];
    const collected = rows.filter(r => Number.isFinite(r.gross)), allApi = collected.length === rows.length;
    const gross = collected.length ? collected.reduce((sum, r) => sum + r.gross, 0) : null;
    const values = [[allApi ? '주문 API 판매금액 · 반품 미확정' : '주문 API 판매금액 · 수집분 · 반품 미확정', won(gross)], ['확인한 매출', won(summary.netSales)], ['입력 비용 반영 예상 이익', won(summary.profit)], ['매출·비용 확인', summary.completeDays + ' / ' + summary.totalDays + '일·배송방식']];
    for (const [label, text] of values) { const card = document.createElement('div'), small = document.createElement('small'), strong = document.createElement('strong'); card.className = 'cp-metric'; small.textContent = label; strong.textContent = text; card.append(small, strong); $('cp-summary').append(card); }
    for (const r of rows) {
      const tr = rowText([r.date, channels[r.channel], r.quantity ?? '—', won(r.gross), won(r.estimatedProductCost), won(r.estimatedCommission), won(r.estimatedFulfillment), won(r.entry?.netSales), won(r.profit), r.stale ? '주문 변경 · 재확인 필요' : r.complete ? '입력 비용 확인' : r.fetchedAt ? '비용 미확인' : 'API 미수집']);
      const td = document.createElement('td'), button = document.createElement('button'); button.type = 'button'; button.textContent = '비용 입력'; button.addEventListener('click', () => edit(r)); td.append(button); tr.append(td); $('cp-daily').append(tr);
    }
    $('cp-note').textContent = report.note;
    $('cp-missing').textContent = (!allApi ? 'API 저장 자료 ' + collected.length + '/' + rows.length + '일·배송방식 · 매출은 수집된 자료만 합산하며 미수집분은 0원으로 보지 않습니다. ' : '') + (summary.complete ? '선택 기간의 입력 비용을 모두 반영했습니다.' : '미확인 날짜가 있어 기간 전체 이익을 표시하지 않습니다. 비용이 없는 날도 매출·비용에 0을 입력하고 확인해 주세요.');
  }
  async function loadReport() {
    if (!selected.length) { report = null; render(); message('트루버·위마망 상품을 선택하고 저장하세요.'); return; }
    report = await request('report?' + new URLSearchParams(period())); render();
  }
  function edit(r) {
    editor = { date: r.date, channel: r.channel, basis: r.basis, scopeKey: report.scopeKey };
    $('cp-ledger').open = true; $('cp-date').value = r.date; $('cp-cost-channel').value = r.channel; $('cp-reviewed').checked = false;
    for (const key of Object.keys(costs)) $('cp-cost-' + key).value = r.entry?.[key] ?? (key === 'productCost' ? r.estimatedProductCost ?? '' : '');
    $('cp-ledger').scrollIntoView({ behavior: 'smooth', block: 'start' }); $('cp-cost-netSales').focus();
  }
  function renderConnection(v) {
    $('cp-vendor').value = v.vendorId || ''; $('cp-connection').open = !configured;
    $('cp-identity').textContent = configured ? v.vendorId + ' · 키 저장됨 · 각 배송 방식의 수집 버튼으로 연결 확인' : '미연결';
    for (const id of ['cp-access', 'cp-secret']) $(id).placeholder = configured ? '저장됨 · 변경할 때만 입력' : '미등록 · 발급받은 키 입력';
    $('cp-key-storage').textContent = configured ? '키 저장 확인 완료. 키는 저장 후 입력칸에 다시 표시하지 않습니다. 저장된 키로 연결 진단을 눌러 쿠팡 인증을 확인하세요.' : '키는 저장 후 입력칸에 다시 표시하지 않습니다. 먼저 발급받은 업체코드와 두 키를 입력하고 암호화 저장하세요.';
  }
  function renderDiagnosis(result) {
    const host = $('cp-diagnosis'); host.replaceChildren();
    if (!result) { host.dataset.state = 'idle'; host.textContent = '저장된 키로 연결 진단을 누르면 키 저장 상태와 배송 방식별 인증 결과를 확인할 수 있습니다.'; return; }
    host.dataset.state = result.ok ? 'success' : 'error';
    const title = document.createElement('strong'); title.textContent = result.keysReadable ? '키 저장 확인 완료 · 저장된 키를 읽었습니다.' : '쿠팡 연결 진단 결과'; host.append(title);
    const stamp = Date.parse(result.checkedAt), checked = Number.isFinite(stamp) ? new Date(stamp).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '확인 시각 없음';
    const when = document.createElement('p'); when.textContent = '진단 대상: ' + (result.date || '최근 하루') + ' · 확인 시각: ' + checked; host.append(when);
    for (const check of Array.isArray(result.checks) ? result.checks.slice(0, 2) : []) {
      const block = document.createElement('div'), heading = document.createElement('strong'), detail = document.createElement('p'); block.className = 'cp-diagnosis-check';
      const code = Number.isInteger(check.httpStatus) && check.httpStatus >= 100 && check.httpStatus <= 599 ? ' · HTTP ' + check.httpStatus : '';
      heading.textContent = (channels[check.channel] || '배송 방식 확인') + ' · ' + (check.ok ? '인증·접근 정상' : '진단 실패') + code;
      detail.textContent = check.label || check.message || (check.ok ? '쿠팡 API가 정상 응답했습니다.' : '원인을 확인하지 못했습니다.'); block.append(heading, detail);
      if (check.message && check.message !== detail.textContent) { const message = document.createElement('p'); message.textContent = check.message; block.append(message); }
      if (check.action) { const action = document.createElement('p'); action.textContent = '확인할 내용: ' + check.action; block.append(action); }
      host.append(block);
    }
    const note = document.createElement('p'); note.className = 'helper'; note.textContent = '연결 진단은 주문 수집 진행률을 바꾸지 않습니다. 인증 문제를 해결한 뒤 기존 수집 작업의 이어서 수집을 눌러주세요.'; host.append(note);
  }
  async function diagnoseConnection() {
    $('cp-connection').open = true;
    if (!configured) throw Error('먼저 쿠팡 API 정보를 암호화 저장하세요.');
    message('저장된 키로 로켓그로스·판매자배송의 최근 하루 API 연결을 진단합니다.');
    $('cp-diagnosis').textContent = '쿠팡 응답을 확인하고 있습니다.';
    try {
      const result = await request('diagnose', { channel: 'all' }); renderDiagnosis(result);
      message(result.ok ? '연결 진단 완료 · 두 배송 방식 모두 정상 응답했습니다. 기존 오류 기록은 이어서 수집을 실행하면 갱신됩니다.' : '연결 진단 완료 · 쿠팡 API 연결의 진단 결과와 확인할 내용을 아래에서 확인하세요.');
    } catch (error) { $('cp-diagnosis').textContent = '연결 진단을 완료하지 못했습니다. ' + error.message; throw error; }
  }
  async function status() {
    const v = await request('status'); configured = v.configured; selected = v.products || []; options = selected.slice();
    renderConnection(v); renderDiagnosis(v.connectionCheck);
    renderHistory(v.history);
    renderOptions(); return v;
  }
  let pendingCatalog = null;
  $('cp-catalog-file').addEventListener('change',()=>{pendingCatalog=null;$('cp-catalog-save').disabled=true;});
  $('cp-catalog-preview').addEventListener('click',()=>work(async()=>{
    pendingCatalog=null; const file=$('cp-catalog-file').files[0]; if(!file)throw Error('상품현황.xlsx를 선택하세요.');
    const {products}=await window.CoupangSheets.parseCatalog(file);
    pendingCatalog=products;$('cp-catalog-status').textContent=products.length+'개 옵션 매칭 준비 · 원가 등록 '+products.filter(p=>p.unitCost>0).length+'개 · 원가 0원 확인 필요 '+products.filter(p=>p.unitCost===0).length+'개. 매칭 저장을 누르면 기존 원가가 갱신됩니다.';
  }));
  $('cp-catalog-save').addEventListener('click',()=>work(async()=>{
    if(!pendingCatalog)throw Error('먼저 파일 확인을 누르세요.');
    const v=await request('catalog-import',{products:pendingCatalog});selected=v.products;dirtyScope=false;editor=null;pendingCatalog=null;
    await loadOptions();await loadReport();$('cp-catalog-status').textContent=v.imported+'개 옵션 저장 완료 · 원가 확인 필요 '+v.missingCost+'개';
    message('원가 매칭을 저장했습니다. 원가 기준일 이전 주문은 원가 미확인으로 표시합니다.');
  }));
  const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  $('cp-since').value = $('cp-until').value = $('cp-date').value = today;
  for (const name of ['cp-since', 'cp-until', 'cp-date']) $(name).max = today;
  for (const [key, name] of Object.entries(costs)) { const label = document.createElement('label'), input = document.createElement('input'); label.textContent = name + ' · 원'; input.type = 'number'; input.step = '0.01'; if (key !== 'netSales') input.min = '0'; input.required = true; input.id = 'cp-cost-' + key; input.placeholder = '없으면 0'; label.append(input); $('cp-cost-fields').append(label); }
  $('cp-connect').addEventListener('submit', e => { e.preventDefault(); work(async () => {
    try { await request('credentials', { vendorId: $('cp-vendor').value, accessKey: $('cp-access').value, secretKey: $('cp-secret').value }); }
    finally { $('cp-access').value = ''; $('cp-secret').value = ''; }
    report = null; render(); await status(); message('암호화 저장 완료. 각 배송 방식의 주문 수집 버튼으로 API 연결을 확인하세요.');
  }); });
  $('cp-diagnose').addEventListener('click', () => work(diagnoseConnection));
  for (const channel of ['growth', 'seller']) $('cp-sync-' + channel).addEventListener('click', () => work(async () => {
    if (!configured) throw Error('먼저 API 정보를 등록하세요.');
    const { since, until } = period();
    if ((Date.parse(until) - Date.parse(since)) / 86400000 >= 7) { await startCollection({ since, until, channels: [channel] }); return; }
    message(channels[channel] + ' 주문을 수집합니다. 판매자배송은 시간이 걸릴 수 있습니다.');
    let error;
    try { const v = await request('sync', { ...period(), channel }); message(channels[channel] + ' ' + v.savedDays.length + '일 저장 완료. 주문 API 자료는 반품·정산 확정 자료가 아닙니다.'); }
    catch (e) { error = e; }
    await loadOptions(); await loadReport(); if (error) throw error;
  }));
  $('cp-add').addEventListener('submit', e => { e.preventDefault();
    const itemId = $('cp-item-id').value.trim(), name = $('cp-item-name').value.trim();
    if (!/^[1-9]\d{0,19}$/.test(itemId) || !name) return message('쿠팡 옵션 ID와 상품명을 입력하세요.');
    if (options.some(p => p.itemId === itemId)) return message('이미 있는 옵션입니다. 체크하여 선택하세요.');
    const p = { itemId, name, unitCost: null }; options.push(p); selected.push(p); renderOptions(); $('cp-add').reset();
  });
  $('cp-save-scope').addEventListener('click', () => work(async () => {
    const products = [...document.querySelectorAll('#cp-products input[type=checkbox]:checked')].map(input => {
      const p = options.find(v => v.itemId === input.dataset.itemId), field = [...document.querySelectorAll('[data-cost-id]')].find(v => v.dataset.costId === p.itemId);
      return { ...p, unitCost: field.value === '' ? null : Number(field.value) };
    });
    const v = await request('scope', { products }); selected = v.products; dirtyScope = false; editor = null; report = null; await loadReport(); message('트루버·위마망 옵션 ' + products.length + '개를 집계 대상으로 저장했습니다.');
  }));
  $('cp-query').addEventListener('submit', e => { e.preventDefault(); work(async () => { await loadOptions(); await loadReport(); message(selected.length ? '저장된 자료를 조회했습니다.' : '수집한 상품 목록에서 트루버·위마망 상품을 체크하고 저장하세요.'); }); });
  for (const [id, checked] of [['cp-select-all', true], ['cp-select-none', false]]) $(id).addEventListener('click', () => {
    document.querySelectorAll('#cp-products input[type=checkbox]').forEach(input => { input.checked = checked; });
    dirtyScope = true;
  });
  $('cp-products').addEventListener('change', () => { dirtyScope = true; });
  $('cp-year').addEventListener('click', () => work(async () => { recentDates(365); await startCollection({ ...period(), channels: ['growth', 'seller'] }); }));
  $('cp-resume').addEventListener('click', () => work(async () => { const h = await request('history', { resume: true }); $('cp-since').value = h.since; $('cp-until').value = h.until; renderHistory(h); message('완료된 구간은 유지하고 미완료 구간부터 이어서 수집합니다.'); }));
  $('cp-pause').addEventListener('click', () => work(async () => { renderHistory(await request('history-pause', {})); message('현재 구간을 저장한 후 일시정지합니다.'); }));
  document.querySelectorAll('[data-cp-days]').forEach(button => button.addEventListener('click', () => { if (!busy) recentDates(Number(button.dataset.cpDays)); }));
  $('cp-channel').addEventListener('change', render);
  $('cp-cost-date-load').addEventListener('click', () => {
    const r = report?.daily.find(v => v.date === $('cp-date').value && v.channel === $('cp-cost-channel').value);
    if (r) edit(r); else message('입력할 날짜가 포함되도록 조회 기간을 먼저 바꾸세요.');
  });
  $('cp-cost-form').addEventListener('submit', e => { e.preventDefault(); work(async () => {
    const r = report?.daily.find(v => v.date === $('cp-date').value && v.channel === $('cp-cost-channel').value);
    if (!r) throw Error('입력할 날짜를 조회한 뒤 다시 저장하세요.');
    if (!editor || editor.date !== r.date || editor.channel !== r.channel || editor.scopeKey !== report.scopeKey) throw Error('이 날짜의 입력값 불러오기를 누른 뒤 비용을 확인하세요.');
    await request('ledger', { date: r.date, channel: r.channel, scopeKey: editor.scopeKey, basis: editor.basis, reviewed: $('cp-reviewed').checked,
      ...Object.fromEntries(Object.keys(costs).map(k => [k, $('cp-cost-' + k).value])) });
    await loadReport(); $('cp-reviewed').checked = false; message('매출·비용을 저장하고 예상 이익을 계산했습니다.');
  }); });
  function clearEditor() { editor = null; $('cp-reviewed').checked = false; for (const key of Object.keys(costs)) $('cp-cost-' + key).value = ''; }
  $('cp-date').addEventListener('change', clearEditor);
  $('cp-cost-channel').addEventListener('change', clearEditor);
  work(async () => { const v = await status(); if (v.history?.since) { $('cp-since').value = v.history.since; $('cp-until').value = v.history.until; } if (configured) { await loadOptions(); await loadReport(); } message(configured ? v.history?.error || '저장 자료를 불러왔습니다. 최근 1년 전체 수집으로 과거 주문을 가져올 수 있습니다.' : '쿠팡 API 정보를 등록한 뒤 각 배송 방식의 주문을 수집하세요.'); });
  setInterval(() => { if (!busy && configured && !document.hidden) historyStatus().catch(e => message(e.message)); }, 3000);
})();
