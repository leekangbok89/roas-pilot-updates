(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const num = value => typeof value === 'number' && Number.isFinite(value);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const count = value => num(value) ? value.toLocaleString('ko-KR') : '—';
  const money = value => num(value) ? count(value) + '원' : '—';
  const safeUrl = value => { try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password ? u.href : ''; } catch (_) { return ''; } };
  const bellIcon = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z"/><path d="M10 21h4M12 2V1"/></svg>';
  let state = {revision:0,products:[],folders:[],snapshots:[],settings:{}}, platform = 'naver', selectedId = null, detailTab = 'keywords', query = '', folderId = '', editingId = null, busy = false, loaded = false, order = [], importProductId = null;
  let historyIndex = new Map(), snapshotIndex = new Map(), keywordIndex = new Map(), latestKeywordIndex = new Map(), metricIndex = new Map();
  let view = {expanded:false,orientation:'horizontal',keywordSort:'saved',rankOptions:{normal:true,group:true,ads:true,adCount:false}};

  function applyViewSettings(settings) {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return;
    if (typeof settings.expanded === 'boolean') view.expanded = settings.expanded;
    if (['horizontal','vertical'].includes(settings.orientation)) view.orientation = settings.orientation;
    if (['saved','volume','rank'].includes(settings.keywordSort)) view.keywordSort = settings.keywordSort;
    if (settings.rankOptions && typeof settings.rankOptions === 'object' && !Array.isArray(settings.rankOptions)) {
      for (const key of ['normal','group','ads','adCount']) if (typeof settings.rankOptions[key] === 'boolean') view.rankOptions[key] = settings.rankOptions[key];
    }
  }

  function notify(message, error) {
    $('dm-status').hidden = !message;
    $('dm-status').textContent = message || '';
    $('dm-status').dataset.error = String(!!error);
  }
  function setBusy(value) {
    busy = value;
    document.body.dataset.monitoringBusy = String(value);
    document.querySelectorAll('[data-write], #dm-product-form button, #dm-folder-form button, #dm-keyword-form button, #dm-alert-form button, #dm-order-save, #dm-save-sort, #dm-orientation, #dm-zoom, #dm-detail-zoom, [data-rank-option]').forEach(el => { el.disabled = value; });
  }
  function hydrate(result) {
    if (!result || !Array.isArray(result.products) || !Array.isArray(result.snapshots) || !Array.isArray(result.folders) || !Number.isInteger(result.revision)) throw Error('모니터링 자료 형식이 올바르지 않습니다.');
    state = result;
    applyViewSettings(state.settings);
    // Build lookup tables once per revision, so rendering each rank cell does
    // not scan the full history for every keyword and comparison date.
    historyIndex = new Map(); snapshotIndex = new Map(); keywordIndex = new Map(); latestKeywordIndex = new Map(); metricIndex = new Map();
    for (const snapshot of state.snapshots) {
      if (!historyIndex.has(snapshot.productId)) historyIndex.set(snapshot.productId,[]);
      historyIndex.get(snapshot.productId).push(snapshot);
      if (!snapshotIndex.has(snapshot.productId)) snapshotIndex.set(snapshot.productId,new Map());
      snapshotIndex.get(snapshot.productId).set(snapshot.date,snapshot);
      keywordIndex.set(snapshot,new Map((snapshot.keywords || []).map(k=>[k.keyword,k])));
    }
    for (const [id, snapshots] of historyIndex) {
      snapshots.sort((a,b)=>b.date.localeCompare(a.date));
      const latest = new Map(), metrics = new Map();
      for (const snapshot of snapshots) {
        for (const k of snapshot.keywords || []) if (!latest.has(k.keyword)) latest.set(k.keyword,{keyword:k,date:snapshot.date});
        for (const key of ['price','shipping','reviews','rating']) if (!metrics.has(key) && Object.prototype.hasOwnProperty.call(snapshot,key)) metrics.set(key,snapshot[key]);
      }
      latestKeywordIndex.set(id,latest); metricIndex.set(id,metrics);
    }
    loaded = true;
  }
  async function load() {
    try {
      const response = await fetch('/api/monitoring/state', {cache:'no-store'}), result = await response.json();
      if (!response.ok) throw Error(result.error || '저장 자료를 불러오지 못했습니다.');
      hydrate(result);
      notify(''); render();
    } catch (error) {
      notify(error.message, true);
      if (!loaded) $('dm-cards').innerHTML = '<div class="dm-empty">저장 자료를 불러오지 못했습니다.<br><button id="dm-retry" type="button">다시 불러오기</button></div>';
    }
  }
  async function save(route, data, message) {
    if (busy || !loaded) return false;
    setBusy(true);
    try {
      const response = await fetch('/api/monitoring/' + route, {method:'POST',headers:{'Content-Type':'application/json','x-roas-local-action':'yes'},body:JSON.stringify({revision:state.revision,...data})});
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 409) { await load(); throw Error('다른 화면에서 자료가 변경되었습니다. 최신 자료를 불러왔으니 다시 저장하세요.'); }
        throw Error(result.error || '자료를 저장하지 못했습니다.');
      }
      hydrate(result); render(); notify(message || '저장했습니다.');
      return true;
    } catch (error) { notify(error.message, true); return false; }
    finally { setBusy(false); }
  }
  function activeProducts() { return state.products.filter(p => !p.archived); }
  function product() { return state.products.find(p => p.id === selectedId && !p.archived); }
  function histories(id) { return historyIndex.get(id) || []; }
  function currentMetric(p, key) {
    const metrics = metricIndex.get(p.id);
    return metrics?.has(key) ? metrics.get(key) : p[key];
  }
  function keywordsFor(p) {
    return (p.keywords || []).map(k => ({...k}));
  }
  function keywordAt(id, date, keyword) { const snapshot=snapshotIndex.get(id)?.get(date);return keywordIndex.get(snapshot)?.get(keyword); }
  function previousDate(date) { return new Date(Date.parse(date + 'T00:00:00Z') - 86400000).toISOString().slice(0,10); }
  function movement(p, date, keyword, field) {
    const latest = keywordAt(p.id,date,keyword), before = keywordAt(p.id,previousDate(date),keyword), key = field || 'rank';
    if (!num(latest?.[key]) || !num(before?.[key])) return '';
    const d = before[key] - latest[key];
    return d ? '<span class="' + (d > 0 ? 'dm-up' : 'dm-down') + '">' + (d > 0 ? '▲' : '▼') + Math.abs(d) + '</span>' : '<span class="dm-flat">-</span>';
  }
  function rankText(k) {
    if (!k || k.status === 'missing') return '—';
    if (k.status === 'pending') return '업데이트 중';
    if (k.status === 'outside') return num(k.outsideLimit) && k.outsideLimit > 0 ? count(k.outsideLimit) + '위 밖' : '순위 밖';
    return num(k.rank) ? count(k.rank) + '위' : '—';
  }
  function latestKeyword(p, name) {
    return latestKeywordIndex.get(p.id)?.get(name) || null;
  }
  function image(p, className) {
    const url = safeUrl(p.imageUrl);
    return url ? '<img class="' + className + '" src="' + esc(url) + '" alt="' + esc(p.name) + '" loading="lazy" referrerpolicy="no-referrer">' : '<span class="' + className + ' dm-image-placeholder" aria-label="썸네일 없음">▧</span>';
  }
  function card(p) {
    const keys = keywordsFor(p), keywords = keys.slice(0,3).map(k => {
      const latest = latestKeyword(p,k.keyword);
      return '<span class="dm-keyword-pill">' + esc(k.keyword) + ' <span>' + esc(rankText(latest?.keyword)) + '</span> ' + (latest ? movement(p,latest.date,k.keyword) : '') + '</span>';
    }).join('');
    return '<article class="dm-card"><div class="dm-card-head"><a class="dm-card-product" href="?product=' + encodeURIComponent(p.id) + '">' + image(p,'dm-product-image') + '<span class="dm-card-name">' + (p.brand ? esc(p.brand) + ' <span class="dm-divider">|</span> ' : '') + esc(p.name) + '</span></a><div class="dm-card-actions"><button type="button" data-write data-favorite="' + esc(p.id) + '" aria-label="' + esc(p.name) + ' 관심 상품" aria-pressed="' + !!p.favorite + '">' + (p.favorite ? '★' : '☆') + '</button><button type="button" data-alert="' + esc(p.id) + '" aria-label="' + esc(p.name) + ' 순위 알림">'+bellIcon+'</button></div></div><div class="dm-card-metrics"><div><span>가격</span><strong>' + money(currentMetric(p,'price')) + '</strong></div><div><span>배송비</span><strong>' + money(currentMetric(p,'shipping')) + '</strong></div><div><span>리뷰</span><strong>' + count(currentMetric(p,'reviews')) + (num(currentMetric(p,'reviews')) ? '개' : '') + '</strong></div><div><span>평점</span><strong>' + (num(currentMetric(p,'rating')) ? currentMetric(p,'rating').toFixed(1) + '점' : '—') + '</strong></div></div><div class="dm-keywords">' + keywords + (keys.length > 3 ? '<a class="dm-card-more" href="?product=' + encodeURIComponent(p.id) + '">더보기</a>' : '') + (!keys.length ? '<a class="dm-card-more" href="?product=' + encodeURIComponent(p.id) + '">키워드를 추가하세요</a>' : '') + '</div></article>';
  }
  const addCard = () => '<button type="button" class="dm-add-card" id="dm-add" data-write><span class="dm-add-plus">＋</span><span>모니터링하고 싶은<br><strong>' + (platform === 'naver' ? '네이버쇼핑' : '쿠팡') + '</strong> 아이템을 추가하세요.</span><span class="dm-add-note">상품과 키워드를 한곳에서 확인하세요.</span></button>';
  function renderList() {
    const products = activeProducts().filter(p => p.platform === platform), totalKeywords = products.reduce((sum,p) => sum + keywordsFor(p).length,0);
    $('dm-counts').innerHTML = '<span><i>🔸</i> 등록 상품 수 <strong>' + products.length + '개</strong><small>/ 600</small></span><span><i>🔸</i> 등록 키워드 수 <strong>' + count(totalKeywords) + '개</strong><small>/ 3000</small></span>';
    const importInfo=state.lastImport, latestDate=products.reduce((latest,p)=>{const date=histories(p.id)[0]?.date||'';return date>latest?date:latest;},'');
    $('dm-last-import').hidden=!importInfo&&!latestDate;
    $('dm-last-import').textContent=(latestDate?'최근 기록 '+latestDate:'')+(importInfo?' · 자료 출처 '+importInfo.source+(importInfo.at&&Number.isFinite(Date.parse(importInfo.at))?' · 가져온 시각 '+new Date(importInfo.at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}):''):'');
    const select = $('dm-folder-filter');
    select.innerHTML = '<option value="">전체 상품</option><option value="__none">미분류</option>' + state.folders.map(f => '<option value="' + esc(f.id) + '">' + esc(f.name) + '</option>').join('') + '<option value="__archived">보관 상품</option>';
    if (folderId && !['__none','__archived'].includes(folderId) && !state.folders.some(f => f.id === folderId)) folderId = '';
    select.value = folderId;
    const candidates=folderId==='__archived'?state.products.filter(p=>p.archived&&p.platform===platform):products;
    const filtered = candidates.filter(p => (!folderId || folderId==='__archived' || (folderId === '__none' ? !p.folderId : p.folderId === folderId)) && (!query || [p.name,p.brand,state.folders.find(f => f.id === p.folderId)?.name,...keywordsFor(p).map(k => k.keyword)].join(' ').toLowerCase().includes(query)));
    if (folderId || query || !state.folders.length) $('dm-cards').innerHTML = '<div class="dm-grid">' + addCard() + filtered.map(card).join('') + '</div>' + (!filtered.length && (query || folderId) ? '<p class="dm-empty">검색 조건에 맞는 상품이 없습니다.</p>' : '');
    else {
      const ungrouped = filtered.filter(p => !p.folderId), groups = state.folders.map(f => ({folder:f,products:filtered.filter(p => p.folderId === f.id)})).filter(g => g.products.length);
      $('dm-cards').innerHTML = '<div class="dm-grid">' + addCard() + ungrouped.map(card).join('') + '</div>' + groups.map(g => '<section class="dm-folder-section"><h2 class="dm-folder-head">▱ ' + esc(g.folder.name) + '<small>' + g.products.length + '개</small></h2><div class="dm-grid">' + g.products.map(card).join('') + '</div></section>').join('');
    }
    document.querySelectorAll('[data-platform]').forEach(el => el.setAttribute('aria-selected', String(el.dataset.platform === platform)));
  }
  function sortedKeywords(p) {
    const keys = keywordsFor(p);
    if (view.keywordSort === 'volume') keys.sort((a,b) => (num(b.searchVolume) ? b.searchVolume : -1) - (num(a.searchVolume) ? a.searchVolume : -1));
    if (view.keywordSort === 'rank') keys.sort((a,b) => (latestKeyword(p,a.keyword)?.keyword?.rank ?? Infinity) - (latestKeyword(p,b.keyword)?.keyword?.rank ?? Infinity));
    return keys;
  }
  function rankCell(p,date,key) {
    const k = keywordAt(p.id,date,key.keyword), options = view.rankOptions;
    const alert = p.alert?.enabled && num(k?.rank) && k.rank > (p.alert.threshold || 10);
    let result = '';
    if (options.normal) result += '<div class="dm-rank' + (alert ? ' dm-rank-alert' : '') + '"><strong>' + esc(rankText(k)) + '</strong>' + (num(k?.page) && num(k?.position) ? '<small> - ' + count(k.page) + '페이지 ' + count(k.position) + '위</small>' : '') + ' ' + movement(p,date,key.keyword) + '</div>';
    if (options.group && num(k?.groupRank)) result += '<div class="dm-rank-sub">브랜드묶음 <strong>내 ' + count(k.groupRank) + '위</strong> ' + movement(p,date,key.keyword,'groupRank') + '</div>';
    if (options.ads && num(k?.adRank)) result += '<div class="dm-rank-sub">광고 <strong>' + count(k.adRank) + '위</strong> ' + movement(p,date,key.keyword,'adRank') + '</div>';
    if (options.adCount && num(k?.adCount)) result += '<div class="dm-rank-sub">광고 개수 ' + count(k.adCount) + '개</div>';
    return result || '<span class="dm-muted">—</span>';
  }
  function renderRank(p) {
    const keys = sortedKeywords(p), dates = [...new Set(histories(p.id).map(s => s.date))];
    $('dm-rank-note').textContent = dates.length ? '저장된 자료 기준 · 최근 ' + dates[0] + ' · ' + dates.length + '일' : '순위 자료를 가져오면 날짜별 기록이 표시됩니다.';
    if (!keys.length || !dates.length) { $('dm-rank-table').innerHTML = '<div class="dm-empty">' + (!keys.length ? '모니터링할 키워드를 추가하세요.' : '저장된 순위 기록이 없습니다. 셀하에서 내려받은 자료를 가져오세요.') + '<br><button type="button" data-import>자료 가져오기</button></div>'; return; }
    if (view.orientation === 'vertical') {
      $('dm-rank-table').innerHTML = '<table class="dm-table"><thead><tr><th class="dm-sticky-key" scope="col">일자</th>' + keys.map(k => '<th scope="col">' + esc(k.keyword) + '<small>검색량 ' + count(k.searchVolume) + '</small></th>').join('') + '</tr></thead><tbody>' + dates.map(date => '<tr><th class="dm-sticky-key" scope="row">' + date + '</th>' + keys.map(k => '<td>' + rankCell(p,date,k) + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
    } else {
      $('dm-rank-table').innerHTML = '<table class="dm-table"><thead><tr><th class="dm-sticky-key" scope="col">키워드</th><th class="dm-sticky-volume" scope="col">검색량</th>' + dates.map(date => '<th scope="col" title="' + date + '">' + date.slice(5).replace('-','. ') + '</th>').join('') + '</tr></thead><tbody>' + keys.map(k => '<tr><th class="dm-sticky-key" scope="row">☰　' + esc(k.keyword) + '</th><td class="dm-sticky-volume">' + count(k.searchVolume) + '</td>' + dates.map(date => '<td>' + rankCell(p,date,k) + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
    }
  }
  function chart(values, key, label) {
    const points = values.filter(s => num(s[key])).slice().reverse();
    if (!points.length) return '';
    const width = 980, height = 230, pad = 38, max = Math.max(...points.map(s=>s[key]),1), min = Math.min(...points.map(s=>s[key]),0), range = max-min || 1;
    const timestamp = date => Date.parse(date+'T00:00:00Z'), firstDate = timestamp(points[0].date), dateRange = timestamp(points[points.length-1].date)-firstDate;
    const x = i => dateRange ? pad + (timestamp(points[i].date)-firstDate) * (width-pad*2) / dateRange : width/2, y = value => height-pad - (value-min)/range*(height-pad*2);
    // A missing day has no connecting line; horizontal spacing follows real dates.
    const path = points.map((s,i) => (i && previousDate(s.date)===points[i-1].date ? 'L' : 'M') + x(i).toFixed(2)+','+y(s[key]).toFixed(2)).join(' ');
    const ticks = Array.from({length:4},(_,i) => {const val=min+range*i/3,yy=y(val);return '<line x1="38" y1="'+yy+'" x2="942" y2="'+yy+'" stroke="#ececec"/><text x="30" y="'+(yy+4)+'" text-anchor="end" fill="#999" font-size="10">'+esc(Math.round(val).toLocaleString('ko-KR'))+'</text>';}).join('');
    return '<svg class="dm-review-chart" viewBox="0 0 980 230" role="img" aria-label="' + esc(label) + ' 날짜별 추이">'+ticks+'<path d="'+path+'" fill="none" stroke="#ffc226" stroke-width="2.5"/>' + points.map((s,i)=>'<circle cx="'+x(i)+'" cy="'+y(s[key])+'" r="3" fill="#ffc226"><title>'+esc(s.date+' '+label+' '+count(s[key]))+'</title></circle>').join('')+'<text x="38" y="222" font-size="11" fill="#888">'+points[0].date+'</text><text x="942" y="222" text-anchor="end" font-size="11" fill="#888">'+points[points.length-1].date+'</text></svg>';
  }
  function renderMetric(p) {
    const reviews = detailTab === 'reviews', label = reviews ? '리뷰' : '판매량', key = reviews ? 'reviews' : 'sales', all = histories(p.id), values = all.filter(s => num(s[key]));
    const headers = reviews ? ['일자','리뷰 수','전일 대비','평점','가격'] : ['일자','판매량','전일 대비','매출액','가격'];
    $('dm-metric-view').innerHTML = '<div class="dm-panel-head"><h2>'+label+' 모니터링</h2><button type="button" id="dm-metric-export">CSV 다운로드</button></div>' + (values.length ? chart(values,key,label) + '<div class="dm-table-scroll"><table class="dm-table dm-metric-table"><thead><tr>'+headers.map(h=>'<th scope="col">'+h+'</th>').join('')+'</tr></thead><tbody>'+all.map(s=>{const before=all.find(o=>o.date===previousDate(s.date)),delta=num(s[key])&&num(before?.[key])?s[key]-before[key]:null;return '<tr><td>'+s.date+'</td><td>'+count(s[key])+'</td><td>'+(delta===null?'—':(delta>0?'+':'')+count(delta))+'</td><td>'+(reviews?(num(s.rating)?s.rating.toFixed(1):'—'):money(s.salesAmount))+'</td><td>'+money(s.price)+'</td></tr>';}).join('')+'</tbody></table></div>' : '<div class="dm-empty">저장된 '+label+' 자료가 없습니다.<br>자료에 포함된 실제 '+label+'만 표시합니다.<br><button type="button" data-import>자료 가져오기</button></div>');
  }
  function renderDetail() {
    const p = product();
    if (!p) { selectedId = null; updateUrl(null,true); render(); return; }
    $('dm-product-summary').innerHTML = image(p,'dm-summary-image') + '<div class="dm-summary-content"><h1>' + (p.brand ? esc(p.brand)+' <span class="dm-divider">|</span> ' : '')+esc(p.name)+'</h1><div class="dm-summary-metrics"><span>가격 <strong>'+money(currentMetric(p,'price'))+'</strong></span><span>리뷰 <strong>'+count(currentMetric(p,'reviews'))+(num(currentMetric(p,'reviews'))?'개':'')+'</strong></span><span>배송비 <strong>'+money(currentMetric(p,'shipping'))+'</strong></span>'+(safeUrl(p.url)?'<a href="'+esc(safeUrl(p.url))+'" target="_blank" rel="noopener noreferrer">상품 보기 ↗</a>':'')+'</div><p class="dm-summary-category">카테고리　'+esc(p.category || '—')+'</p><div class="dm-tags"><span>태그 키워드</span> '+(p.tags || []).map(t=>'<span># '+esc(t)+'</span>').join('')+'</div></div>';
    $('dm-keyword-lines').value = (p.keywords||[]).map(k=>k.keyword+(num(k.searchVolume)?','+k.searchVolume:'')).join('\n');
    $('dm-alert-enabled').checked = !!p.alert?.enabled;
    $('dm-alert-threshold').value = p.alert?.threshold || 10;
    $('dm-keywords-view').hidden = detailTab !== 'keywords'; $('dm-metric-view').hidden = detailTab === 'keywords';
    document.querySelectorAll('[data-detail-tab]').forEach(el=>el.setAttribute('aria-selected',String(el.dataset.detailTab===detailTab)));
    $('dm-keyword-sort').value = view.keywordSort;
    $('dm-orientation').value = view.orientation;
    document.querySelectorAll('[data-rank-option]').forEach(el=>el.checked=!!view.rankOptions[el.dataset.rankOption]);
    if (detailTab === 'keywords') renderRank(p); else renderMetric(p);
  }
  function render() {
    $('dm-list').hidden = !!selectedId; $('dm-detail').hidden = !selectedId;
    $('app-main').classList.toggle('dm-expanded', !!view.expanded);
    $('dm-zoom').setAttribute('aria-pressed',String(!!view.expanded)); $('dm-zoom').textContent=view.expanded?'↔　기본보기':'↔　크게보기';
    $('dm-detail-zoom').textContent=view.expanded?'↔　기본보기':'↔　크게보기';
    if (selectedId) renderDetail(); else renderList();
  }
  function updateUrl(id, replace) {
    const url = new URL(location.href);
    if (id) url.searchParams.set('product',id); else url.searchParams.delete('product');
    if (platform === 'coupang') url.searchParams.set('platform','coupang'); else url.searchParams.delete('platform');
    history[replace?'replaceState':'pushState']({},'',url.pathname+url.search);
  }
  function openProduct(id, alert) {
    selectedId=id;detailTab='keywords';updateUrl(id);render();
    if (alert) $('dm-alert-form').closest('details').open=true;
    $('app-main').focus({preventScroll:true});window.scrollTo({top:0});
  }
  function parseKeywordLines(text) {
    const map = new Map();
    for (const line of text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean)) {
      const match=line.match(/^(.*?)[,\t]\s*([\d,]+)\s*$/), keyword=(match?match[1]:line).trim(), volume=match?Number(match[2].replace(/,/g,'')):null;
      if (keyword) map.set(keyword,{keyword,searchVolume:volume});
    }
    return [...map.values()];
  }
  function showDialog(id) { $(id).showModal(); }
  function editProduct(id) {
    editingId=id || null;
    const p = state.products.find(x=>x.id===id), form=$('dm-product-form');form.reset();
    form.elements.folderId.innerHTML='<option value="">미분류</option>'+state.folders.map(f=>'<option value="'+esc(f.id)+'">'+esc(f.name)+'</option>').join('');
    const values=p || {platform,folderId:['__none','__archived'].includes(folderId)?'':folderId};
    for (const key of ['platform','folderId','url','productId','brand','name','imageUrl','price','shipping','reviews','rating','category']) form.elements[key].value=values[key] ?? '';
    form.elements.platform.disabled=!!p;form.elements.productId.readOnly=!!p;
    form.elements.tags.value=(p?.tags || []).join(', ');form.elements.keywords.value=(p?.keywords || []).map(k=>k.keyword+(num(k.searchVolume)?','+k.searchVolume:'')).join('\n');
    $('dm-product-dialog-title').textContent=p?.archived?'보관 상품 복원':id?'모니터링 상품 편집':'모니터링 상품 추가';$('dm-archive').hidden=!id||!!p?.archived;$('dm-product-error').hidden=true;
    form.querySelector('button[type="submit"]').textContent=p?.archived?'복원':'저장';
    showDialog('dm-product-dialog');
  }
  async function submitProduct(event) {
    event.preventDefault(); const form=event.currentTarget, p=state.products.find(x=>x.id===editingId);
    const data={...(p || {}),archived:false};
    for (const key of ['platform','folderId','url','productId','brand','name','imageUrl','category']) data[key]=form.elements[key].value.trim();
    for (const key of ['price','shipping','reviews','rating']) data[key]=form.elements[key].value===''?null:Number(form.elements[key].value);
    data.tags=form.elements.tags.value.split(',').map(s=>s.trim()).filter(Boolean);data.keywords=parseKeywordLines(form.elements.keywords.value);
    if (await save('product',{product:data},'상품을 저장했습니다.')) $('dm-product-dialog').close();
    else {$('dm-product-error').textContent=$('dm-status').textContent;$('dm-product-error').hidden=false;}
  }
  function renderFolders() {
    $('dm-folders').innerHTML=state.folders.map(f=>'<form class="dm-folder-edit dm-toolbar" data-folder-edit="'+esc(f.id)+'"><span aria-hidden="true">▱</span><input required maxlength="120" aria-label="폴더 이름" value="'+esc(f.name)+'"><button type="submit" data-write>이름 저장</button></form>').join('') || '<p class="dm-empty">등록한 폴더가 없습니다.</p>';
  }
  function renderOrder() {
    $('dm-order-list').innerHTML=order.map((id,i)=>{const p=state.products.find(x=>x.id===id);return '<div class="dm-order-row"><span>'+esc(p.name)+'</span><button type="button" data-move="'+i+'" data-direction="-1" '+(!i?'disabled':'')+' aria-label="'+esc(p.name)+' 위로">↑</button><button type="button" data-move="'+i+'" data-direction="1" '+(i===order.length-1?'disabled':'')+' aria-label="'+esc(p.name)+' 아래로">↓</button></div>';}).join('');
  }
  function downloadCsv(headers,rows,name) {
    const cell=value=>{const text=String(value??'');return '"'+(/^[=+\-@\t\r]/.test(text)?"'":'')+text.replace(/"/g,'""')+'"';};
    const blob=new Blob(['\ufeff'+[headers,...rows].map(row=>row.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function exportRanks() {
    const p=product();if(!p)return;
    const rows=[];for(const s of histories(p.id))for(const k of s.keywords || [])rows.push([s.date,p.platform,p.productId,p.name,k.keyword,k.searchVolume??p.keywords?.find(x=>x.keyword===k.keyword)?.searchVolume??'',k.status,k.rank??'',k.groupRank??'',k.adRank??'',k.adCount??'',k.outsideLimit??'',k.page??'',k.position??'',s.price??'',s.shipping??'',s.reviews??'',s.rating??'',s.sales??'',s.salesAmount??'']);
    downloadCsv(['일자','마켓','상품ID','상품명','키워드','검색량','상태','순위','묶음순위','광고순위','광고개수','순위밖기준','페이지','페이지내순위','가격','배송비','리뷰수','평점','판매량','매출액'],rows,'일간모니터링-'+p.productId+'.csv');
  }
  function exportMetrics() {
    const p=product();if(!p)return;
    downloadCsv(['일자','마켓','상품ID','상품명','가격','배송비','리뷰수','평점','판매량','매출액'],histories(p.id).map(s=>[s.date,p.platform,p.productId,p.name,s.price??'',s.shipping??'',s.reviews??'',s.rating??'',s.sales??'',s.salesAmount??'']),'일간모니터링-'+p.productId+'-'+detailTab+'.csv');
  }
  function exportBackup() {
    if(!loaded){notify('자료를 불러온 뒤 내보내세요.',true);return;}
    const data={products:state.products,folders:state.folders,snapshots:state.snapshots,settings:state.settings||{},source:'ROAS Pilot 일간 모니터링 전체 자료'};
    const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json;charset=utf-8'});
    if(blob.size>160*1024*1024){notify('전체 자료가 160MiB를 넘어 다시 가져올 수 없습니다. 파일을 내보내지 않았습니다.',true);return;}
    const url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download='일간모니터링-전체자료-'+new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Seoul'})+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function startImport(id) { importProductId=id || null; $('dm-file').value=''; $('dm-file').click(); }
  async function importFile(event) {
    const file=event.target.files[0];if(!file)return;
    notify('자료를 읽고 있습니다.');
    try {
      if(!window.MonitoringImport?.parse)throw Error('자료 가져오기 기능을 불러오지 못했습니다. 화면을 새로고침하세요.');
      const data=await window.MonitoringImport.parse(file,state.products.find(p=>p.id===importProductId));
      if(await save('import',{...data,source:file.name},'자료를 가져왔습니다.'))render();
    } catch(error) {notify(error.message,true);}
  }
  function persistedSettings() { return {expanded:!!view.expanded,orientation:view.orientation,keywordSort:view.keywordSort,rankOptions:{...view.rankOptions}}; }
  async function toggleZoom() {view.expanded=!view.expanded;render();await save('settings',{settings:persistedSettings()},'화면 크기를 저장했습니다.');}

  document.addEventListener('click',async event=>{
    const target=event.target.closest('button,a');if(!target)return;
    if(target.matches('[data-close]')){target.closest('dialog').close();return;}
    if(target.id==='dm-retry'){await load();return;}
    if(target.id==='dm-add'){editProduct();return;}
    if(target.hasAttribute('data-favorite')){const p=state.products.find(p=>p.id===target.dataset.favorite);await save('product',{product:{...p,favorite:!p.favorite}},'관심 상품을 저장했습니다.');return;}
    if(target.hasAttribute('data-alert')){openProduct(target.dataset.alert,true);return;}
    if(target.matches('.dm-card-product,.dm-card-more')){event.preventDefault();const id=new URL(target.href).searchParams.get('product');if(state.products.find(p=>p.id===id)?.archived)editProduct(id);else openProduct(id);return;}
    if(target.hasAttribute('data-platform')){platform=target.dataset.platform;query='';$('dm-search').value='';folderId='';updateUrl(null);render();return;}
    if(target.hasAttribute('data-detail-tab')){detailTab=target.dataset.detailTab;renderDetail();return;}
    if(target.hasAttribute('data-import')){startImport(selectedId);return;}
    if(target.id==='dm-metric-export'){exportMetrics();return;}
    if(target.hasAttribute('data-move')){const index=Number(target.dataset.move),next=index+Number(target.dataset.direction);if(next>=0&&next<order.length){[order[index],order[next]]=[order[next],order[index]];renderOrder();}return;}
  });
  document.addEventListener('error',event=>{const img=event.target;if(img instanceof HTMLImageElement && img.closest('[data-monitoring]')){const placeholder=document.createElement('span');placeholder.className=img.className+' dm-image-placeholder';placeholder.textContent='▧';placeholder.setAttribute('aria-label','썸네일을 불러오지 못했습니다');img.replaceWith(placeholder);}},true);
  $('dm-search-form').addEventListener('submit',event=>{event.preventDefault();query=$('dm-search').value.trim().toLowerCase();renderList();});
  $('dm-search').addEventListener('input',()=>{query=$('dm-search').value.trim().toLowerCase();renderList();});
  $('dm-folder-filter').addEventListener('change',event=>{folderId=event.target.value;renderList();});
  $('dm-back').addEventListener('click',()=>{selectedId=null;updateUrl(null);render();});
  $('dm-edit').addEventListener('click',()=>editProduct(selectedId));
  $('dm-product-form').addEventListener('submit',submitProduct);
  $('dm-product-form').elements.url.addEventListener('change',event=>{const field=$('dm-product-form').elements.productId;if(field.value||editingId)return;try{const url=new URL(event.target.value),match=url.pathname.match(/\/(?:products|catalog)\/(\d+)/);field.value=url.searchParams.get('productId')||match?.[1]||'';}catch(_){} });
  $('dm-archive').addEventListener('click',async()=>{if(await save('archive',{id:editingId},'상품을 보관했습니다.')){$('dm-product-dialog').close();selectedId=null;updateUrl(null);render();}});
  $('dm-folder-add').addEventListener('click',()=>{renderFolders();showDialog('dm-folder-dialog');});
  $('dm-folder-form').addEventListener('submit',async event=>{event.preventDefault();if(await save('folder',{folder:{name:$('dm-folder-name').value.trim()}},'폴더를 추가했습니다.')){$('dm-folder-name').value='';renderFolders();}});
  $('dm-folders').addEventListener('submit',async event=>{event.preventDefault();const form=event.target;if(await save('folder',{folder:{id:form.dataset.folderEdit,name:form.querySelector('input').value.trim()}},'폴더 이름을 저장했습니다.'))renderFolders();});
  $('dm-order').addEventListener('click',()=>{order=activeProducts().map(p=>p.id);renderOrder();showDialog('dm-order-dialog');});
  $('dm-order-save').addEventListener('click',async()=>{if(await save('order',{ids:order},'상품 순서를 저장했습니다.'))$('dm-order-dialog').close();});
  $('dm-keyword-form').addEventListener('submit',async event=>{event.preventDefault();await save('keywords',{id:selectedId,keywords:parseKeywordLines($('dm-keyword-lines').value)},'키워드를 저장했습니다.');});
  $('dm-alert-form').addEventListener('submit',async event=>{event.preventDefault();const p=product();await save('product',{product:{...p,alert:{enabled:$('dm-alert-enabled').checked,threshold:Number($('dm-alert-threshold').value)}}},'순위 강조 기준을 저장했습니다.');});
  $('dm-keyword-sort').addEventListener('change',event=>{view.keywordSort=event.target.value;renderRank(product());});
  $('dm-save-sort').addEventListener('click',async()=>{await save('settings',{settings:persistedSettings()},'정렬 방식을 저장했습니다.');});
  $('dm-orientation').addEventListener('change',async event=>{view.orientation=event.target.value;renderRank(product());await save('settings',{settings:persistedSettings()},'표시 방향을 저장했습니다.');});
  document.querySelectorAll('[data-rank-option]').forEach(input=>input.addEventListener('change',async()=>{view.rankOptions[input.dataset.rankOption]=input.checked;renderRank(product());await save('settings',{settings:persistedSettings()},'순위 표시 옵션을 저장했습니다.');}));
  $('dm-zoom').addEventListener('click',toggleZoom);$('dm-detail-zoom').addEventListener('click',toggleZoom);
  $('dm-export').addEventListener('click',exportRanks);
  $('dm-backup').addEventListener('click',exportBackup);
  $('dm-import-list').addEventListener('click',()=>startImport(null));$('dm-import-detail').addEventListener('click',()=>startImport(selectedId));$('dm-file').addEventListener('change',importFile);
  window.addEventListener('popstate',()=>{selectedId=new URL(location.href).searchParams.get('product');platform=new URL(location.href).searchParams.get('platform')==='coupang'?'coupang':'naver';render();});
  const params=new URL(location.href).searchParams;selectedId=params.get('product');platform=params.get('platform')==='coupang'?'coupang':'naver';
  load();
})();
