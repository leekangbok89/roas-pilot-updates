(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const channels = { growth: '로켓그로스', seller: '판매자배송' };
  const costFields = [['unitCost', 'cpm-unit-cost'], ['commissionRate', 'cpm-commission'], ['inboundFee', 'cpm-inbound'], ['deliveryFee', 'cpm-delivery']];
  let workspace = null, busy = false, expanded = new Set(), selected = new Set(), editing = null, renaming = null, deleting = null;
  const node = (tag, text, className) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (className) e.className = className; return e; };
  const known = value => typeof value === 'number' && Number.isFinite(value);
  const money = value => known(value) ? value.toLocaleString('ko-KR', { maximumFractionDigits: 2 }) + '원' : '미등록';
  const productId = p => p.productId || 'option:' + p.itemId;
  const productName = p => p.productName || p.name || '상품명 미등록';
  function message(text, error) { $('cpm-message').textContent = text; $('cpm-message').dataset.error = String(!!error); }
  async function request(route, payload) {
    const response = await fetch('/api/coupang/' + route, payload === undefined ? { credentials: 'same-origin' } : { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-ROAS-Local-Action': 'yes' }, body: JSON.stringify(payload) });
    let data; try { data = await response.json(); } catch { throw Error('서버 응답을 읽지 못했습니다. 다시 불러와 주세요.'); }
    if (!response.ok) { const error = Error(response.status === 409 ? '다른 화면에서 상품이나 그룹이 변경되었습니다. 수정 창이 열려 있다면 취소한 뒤 ‘저장 자료 새로 읽기’를 눌러 다시 시도하세요.' : data.error || '상품 관리 요청에 실패했습니다.'); error.status = response.status; throw error; }
    return data;
  }
  async function work(operation, errorTarget) {
    if (busy) return; busy = true;
    const controls = [...document.querySelectorAll('#app-main input, #app-main button, #app-main select')].map(e => [e, e.disabled]);
    controls.forEach(([e]) => { e.disabled = true; });
    try { await operation(); } catch (error) { message(error.message, true); if (errorTarget) $(errorTarget).textContent = error.message; }
    finally { busy = false; controls.forEach(([e, disabled]) => { if (e.isConnected) e.disabled = disabled; }); updateSelection(); }
  }
  function accept(data) {
    workspace = data; window.CoupangThumbnails?.setContext(data); const ids = new Set((data.products || []).map(p => p.itemId)); selected = new Set([...selected].filter(id => ids.has(id)));
    deleting = null; render();
  }
  function filteredProducts() {
    const query = $('cpm-search').value.trim().toLocaleLowerCase(), channel = $('cpm-channel').value, groupId = $('cpm-group').value;
    const membership = groupId ? new Set(groupId === '__ungrouped' ? (workspace?.groups || []).flatMap(g => g.itemIds) : (workspace?.groups || []).find(g => g.id === groupId)?.itemIds || []) : null;
    return (workspace?.products || []).filter(p => (channel === 'all' || (channel === 'unknown' ? !channels[p.channel] : p.channel === channel)) && (!$('cpm-missing').checked || !known(p.unitCost)) && (!membership || (groupId === '__ungrouped' ? !membership.has(p.itemId) : membership.has(p.itemId))) && (!query || [p.itemId, p.productId, p.productName, p.name, p.fullName, p.optionName].join(' ').toLocaleLowerCase().includes(query)));
  }
  function groupedProducts() {
    const map = new Map();
    for (const p of filteredProducts()) { const id = productId(p); if (!map.has(id)) map.set(id, { id, name: productName(p), fullName: p.fullName || p.name || productName(p), options: [] }); map.get(id).options.push(p); }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  }
  function checkBox(ids, label) {
    const input = node('input'); input.type = 'checkbox'; input.setAttribute('aria-label', label); input.checked = ids.length > 0 && ids.every(id => selected.has(id)); input.indeterminate = !input.checked && ids.some(id => selected.has(id));
    input.addEventListener('change', () => { for (const id of ids) if (input.checked) selected.add(id); else selected.delete(id); renderTable(); }); return input;
  }
  function renderSummary() {
    const products = workspace?.products || [];
    const counts = [['상품', new Set(products.map(productId)).size, '상품 ID 기준 · ID가 없으면 옵션별 표시'], ['등록 옵션', products.length, '기존에 선택한 집계 대상'], ['원가 미등록', products.filter(p => !known(p.unitCost)).length, '확인된 0원은 등록으로 구분'], ['분석용 그룹', (workspace?.groups || []).length, '집계 대상을 유지하며 분류']];
    $('cpm-summary').replaceChildren(...counts.map(([label, value, help]) => { const card = node('div', undefined, 'ca-card'); card.append(node('small', label), node('strong', value.toLocaleString('ko-KR') + '개'), node('p', help)); return card; }));
  }
  function renderGroupSelects() {
    const filter = $('cpm-group').value, assign = $('cpm-assign').value;
    $('cpm-group').replaceChildren(); $('cpm-assign').replaceChildren();
    for (const [value, label] of [['', '전체 그룹'], ['__ungrouped', '그룹 미지정']]) { const o = node('option', label); o.value = value; $('cpm-group').append(o); }
    const empty = node('option', '그룹 선택'); empty.value = ''; $('cpm-assign').append(empty);
    for (const group of workspace?.groups || []) for (const id of ['cpm-group', 'cpm-assign']) { const option = node('option', group.name + ' (' + group.itemIds.length + ')'); option.value = group.id; $(id).append(option); }
    $('cpm-group').value = [...$('cpm-group').options].some(o => o.value === filter) ? filter : '';
    $('cpm-assign').value = [...$('cpm-assign').options].some(o => o.value === assign) ? assign : '';
  }
  function renderTable() {
    const groups = groupedProducts(), rows = [], shown = groups.flatMap(g => g.options);
    $('cpm-count').textContent = '조회 결과 ' + groups.length.toLocaleString('ko-KR') + '개 상품 · ' + shown.length.toLocaleString('ko-KR') + '개 옵션';
    for (const group of groups) {
      const tr = node('tr', undefined, 'cpm-product-row'), choose = node('td'), name = node('td', undefined, 'ca-name'), title = node('div', undefined, 'cpm-product-name'), toggle = node('button', expanded.has(group.id) ? '접기' : '자세히', 'ca-expand');
      choose.append(checkBox(group.options.map(p => p.itemId), group.name + ' 조회 옵션 모두 선택')); toggle.type = 'button'; toggle.setAttribute('aria-expanded', String(expanded.has(group.id))); toggle.setAttribute('aria-label', group.name + ' 옵션 ' + (expanded.has(group.id) ? '접기' : '펼치기'));
      toggle.addEventListener('click', () => { if (expanded.has(group.id)) expanded.delete(group.id); else expanded.add(group.id); renderTable(); });
      title.title = group.fullName || group.name; title.append(toggle, node('strong', window.CoupangProductNames?.groupLabel(group.options) || group.name)); name.append(title, node('small', (group.id.startsWith('option:') ? '상품 ID 미등록' : '상품 ID ' + group.id) + ' · ' + group.options.length + '개 옵션'));
      window.CoupangThumbnails?.decorate(name, group.id.startsWith('option:') ? { itemId: group.options[0].itemId, name: group.name } : { productId: group.id, name: group.name });
      const channel = node('td', [...new Set(group.options.map(p => channels[p.channel] || '미분류'))].join(' / ')), detail = node('td', '옵션을 펼쳐 비용 확인'); detail.colSpan = 6;
      tr.append(choose, name, channel, detail, node('td', '')); rows.push(tr);
      if (!expanded.has(group.id)) continue;
      for (const p of group.options) {
        const option = node('tr', undefined, 'cpm-option-row'), select = node('td'), optionName = node('td', undefined, 'ca-name'); select.append(checkBox([p.itemId], (p.optionName || p.name) + ' 선택'));
        optionName.title = (p.optionName || p.name) + '\n' + (p.fullName || p.name || p.productName); optionName.append(node('strong', p.optionName || p.name), node('small', '옵션 ID ' + p.itemId, 'cpm-option-id'));
        window.CoupangThumbnails?.decorate(optionName, { itemId: p.itemId, productId: p.productId, name: p.optionName || p.name });
        option.append(select, optionName, node('td', channels[p.channel] || '미분류'));
        for (const key of ['salePrice', 'unitCost', 'commissionRate', 'inboundFee', 'deliveryFee']) { const value = key === 'commissionRate' ? known(p[key]) ? p[key].toLocaleString('ko-KR', { maximumFractionDigits: 2 }) + '%' : '미등록' : money(p[key]); const costCell = node('td', value, !known(p[key]) ? 'cpm-unknown' : ''); if (key === 'unitCost' && p.productCostSourceZero === true) costCell.append(node('small', '원본 0원 · 실제 원가 확인 필요', 'ca-cost-warning')); option.append(costCell); }
        option.append(node('td', p.costSince || '시작일 미지정')); const manage = node('td'), edit = node('button', '비용 수정'); edit.type = 'button'; edit.addEventListener('click', () => openEditor(p)); manage.append(edit); option.append(manage); rows.push(option);
      }
    }
    if (!rows.length) { const tr = node('tr'), td = node('td', workspace?.products?.length ? '조회 조건에 맞는 상품이 없습니다.' : '등록된 상품이 없습니다. 자료·연결 관리에서 상품현황 엑셀을 가져오거나 집계 대상을 선택하세요.', 'ca-empty'); td.colSpan = 10; if (!workspace?.products?.length) { const a = node('a', '상품현황 가져오기 ↗'); a.href = '/coupang.html#cp-catalog'; td.append(node('br'), a); } tr.append(td); rows.push(tr); }
    $('cpm-body').replaceChildren(...rows);
    const all = $('cpm-select-visible'); all.checked = shown.length > 0 && shown.every(p => selected.has(p.itemId)); all.indeterminate = !all.checked && shown.some(p => selected.has(p.itemId)); all.disabled = busy || !shown.length;
    $('cpm-expand').textContent = groups.length > 0 && groups.every(g => expanded.has(g.id)) ? '옵션 모두 접기' : '옵션 모두 펼치기'; updateSelection();
  }
  function updateSelection() {
    $('cpm-selected').textContent = '선택 ' + selected.size.toLocaleString('ko-KR') + '개 옵션';
    const hasGroup = !!$('cpm-assign').value;
    for (const id of ['cpm-add-members', 'cpm-remove-members']) $(id).disabled = busy || !selected.size || !hasGroup;
    $('cpm-clear-selection').disabled = busy || !selected.size;
    $('cpm-create').disabled = busy || !workspace?.configured || (workspace.groups || []).length >= 100;
  }
  function cloneGroups() { return (workspace?.groups || []).map(g => ({ id: g.id, name: g.name, itemIds: [...g.itemIds] })); }
  async function saveGroups(groups) { accept(await request('groups', { scopeKey: workspace.scopeKey, revision: workspace.revision, groups })); }
  function renderGroups() {
    $('cpm-groups').replaceChildren();
    for (const group of workspace?.groups || []) {
      const card = node('div', undefined, 'cpm-group-card'), name = node('strong', group.name), count = node('small', '현재 집계 ' + group.itemIds.length + '개 옵션'), show = node('button', '목록 보기'), rename = node('button', '이름 변경'), remove = node('button', deleting === group.id ? '이 그룹 삭제 확인' : '그룹 삭제');
      show.type = rename.type = remove.type = 'button'; show.addEventListener('click', () => { $('cpm-group').value = group.id; renderTable(); $('cpm-title').scrollIntoView({ block: 'start', behavior: 'auto' }); }); rename.addEventListener('click', () => { renaming = group.id; $('cpm-rename-name').value = group.name; $('cpm-rename-error').textContent = ''; $('cpm-rename-dialog').showModal(); $('cpm-rename-name').focus(); });
      remove.addEventListener('click', () => { if (deleting !== group.id) { deleting = group.id; renderGroups(); return; } work(async () => { await saveGroups(cloneGroups().filter(g => g.id !== group.id)); message('그룹을 삭제했습니다. 상품과 저장된 매출 자료는 보존됩니다.'); }); });
      card.append(name, count, show, rename, remove);
      if (deleting === group.id) { card.dataset.deleting = 'true'; const cancel = node('button', '취소'); cancel.type = 'button'; cancel.addEventListener('click', () => { deleting = null; renderGroups(); }); card.append(cancel, node('span', '그룹 분류만 삭제합니다.')); }
      $('cpm-groups').append(card);
    }
    if (!(workspace?.groups || []).length) $('cpm-groups').append(node('p', '그룹을 만든 뒤 목록의 옵션을 선택해 추가하세요.', 'helper'));
  }
  function render() { renderSummary(); renderGroupSelects(); renderTable(); renderGroups(); }
  function openEditor(p) {
    if (busy) return; editing = p.itemId; $('cpm-editor-name').textContent = (p.productName || p.name) + ' · ' + (p.optionName || p.name) + ' · 옵션 ID ' + p.itemId;
    for (const [key, id] of costFields) $(id).value = known(p[key]) ? p[key] : '';
    $('cpm-cost-since').value = p.costSince || ''; $('cpm-edit-error').textContent = ''; $('cpm-editor').showModal(); $('cpm-unit-cost').focus();
  }
  async function reload() {
    await work(async () => { const data = await request('workspace'); selected.clear(); accept(data); message(data.configured ? '저장된 상품과 그룹을 읽었습니다. 상품 관리에서는 집계 대상이 바뀌지 않습니다.' : '먼저 자료·연결 관리에서 쿠팡 키를 연결하고 상품을 등록해 주세요.'); });
  }
  $('cpm-edit-form').addEventListener('submit', event => {
    event.preventDefault(); if (!editing || !workspace) return;
    const payload = { scopeKey: workspace.scopeKey, revision: workspace.revision, itemId: editing };
    for (const [key, id] of costFields) payload[key] = $(id).value === '' ? null : Number($(id).value);
    payload.costSince = $('cpm-cost-since').value || null;
    if (costFields.some(([key]) => payload[key] !== null && (!known(payload[key]) || payload[key] < 0 || payload[key] > (key === 'commissionRate' ? 100 : 1e12)))) { $('cpm-edit-error').textContent = '비용과 수수료율을 확인하세요.'; return; }
    work(async () => { accept(await request('product-update', payload)); $('cpm-editor').close(); editing = null; message('옵션 비용을 저장했습니다. 매출 분석에서 자료를 다시 조회하면 반영됩니다.'); }, 'cpm-edit-error');
  });
  $('cpm-edit-cancel').addEventListener('click', () => { if (!busy) $('cpm-editor').close(); });
  $('cpm-editor').addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  $('cpm-create-group').addEventListener('submit', event => { event.preventDefault(); if (!workspace?.configured) return; const name = $('cpm-group-name').value.trim(); if (!name) return; const id = 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); work(async () => { await saveGroups([...cloneGroups(), { id, name, itemIds: [] }]); $('cpm-group-name').value = ''; $('cpm-assign').value = id; updateSelection(); message('그룹을 만들었습니다. 옵션을 선택한 뒤 그룹에 추가하세요.'); }); });
  $('cpm-rename-form').addEventListener('submit', event => { event.preventDefault(); const name = $('cpm-rename-name').value.trim(); if (!name || !renaming) return; work(async () => { await saveGroups(cloneGroups().map(g => g.id === renaming ? { ...g, name } : g)); $('cpm-rename-dialog').close(); renaming = null; message('그룹 이름을 저장했습니다.'); }, 'cpm-rename-error'); });
  $('cpm-rename-cancel').addEventListener('click', () => { if (!busy) $('cpm-rename-dialog').close(); }); $('cpm-rename-dialog').addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  for (const action of ['add', 'remove']) $('cpm-' + action + '-members').addEventListener('click', () => { const groupId = $('cpm-assign').value; if (!groupId || !selected.size) return; work(async () => { const groups = cloneGroups().map(g => g.id !== groupId ? g : { ...g, itemIds: action === 'add' ? [...new Set([...g.itemIds, ...selected])] : g.itemIds.filter(id => !selected.has(id)) }); await saveGroups(groups); message(action === 'add' ? '선택 옵션을 그룹에 추가했습니다.' : '선택 옵션을 그룹에서 제외했습니다.'); }); });
  $('cpm-select-visible').addEventListener('change', event => { for (const p of filteredProducts()) if (event.target.checked) selected.add(p.itemId); else selected.delete(p.itemId); renderTable(); });
  $('cpm-clear-selection').addEventListener('click', () => { selected.clear(); renderTable(); }); $('cpm-assign').addEventListener('change', updateSelection);
  $('cpm-search').addEventListener('input', renderTable); for (const id of ['cpm-channel', 'cpm-group', 'cpm-missing']) $(id).addEventListener('change', renderTable);
  $('cpm-expand').addEventListener('click', () => { const groups = groupedProducts(), collapse = groups.every(g => expanded.has(g.id)); for (const g of groups) if (collapse) expanded.delete(g.id); else expanded.add(g.id); renderTable(); });
  $('cpm-reload').addEventListener('click', reload);
  window.addEventListener('coupang-product-metadata', event => { if (workspace && !busy && !selected.size && !$('cpm-editor').open && !$('cpm-rename-dialog').open && !$('cpm-group-name').value.trim() && event.detail?.vendorKey === workspace.vendorKey && event.detail?.scopeKey === workspace.scopeKey) reload(); });
  const initialQuery = new URLSearchParams(location.search);
  if (['all', 'growth', 'seller'].includes(initialQuery.get('channel'))) $('cpm-channel').value = initialQuery.get('channel');
  function syncAnalysisLinks() {
    const query = new URLSearchParams();
    for (const key of ['since', 'until']) if (/^\d{4}-\d{2}-\d{2}$/.test(initialQuery.get(key) || '')) query.set(key, initialQuery.get(key));
    query.set('channel', ['growth', 'seller'].includes($('cpm-channel').value) ? $('cpm-channel').value : 'all');
    document.querySelectorAll('.ca-subnav a').forEach(link => { const url = new URL(link.href); url.search = query.toString(); link.href = url.pathname + url.search; });
  }
  $('cpm-channel').addEventListener('change', syncAnalysisLinks); syncAnalysisLinks();

  const dateParts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  $('cpm-cost-since').max = ['year', 'month', 'day'].map(key => dateParts.find(p => p.type === key).value).join('-');
  reload();
})();
