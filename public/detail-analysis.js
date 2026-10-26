(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); }, settings, connected = false, sequence = 0, catalog = null, lastReport = null;
  function notice(id, message, error) { var e = $(id); e.textContent = message; e.hidden = false; e.dataset.error = String(!!error); }
  async function api(path, input) {
    var response = await fetch('/api/ga4/' + path, input === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-roas-local-action': 'yes' }, body: JSON.stringify(input) });
    var result = await response.json(); if (!response.ok) throw Error(result.error || '연결 요청에 실패했습니다.'); return result;
  }
  function fill(value) {
    settings = value;
    $('detail-product').value = value.productId; $('detail-version').value = value.contentVersion;
    $('detail-measurement').value = value.measurementId; $('detail-clarity').value = value.clarityProjectId; $('detail-consent').checked = value.requireConsent;
    var clarity = $('clarity-dashboard'); clarity.classList.toggle('detail-link-disabled', !value.clarityProjectId);
    if (value.clarityProjectId) clarity.href = 'https://clarity.microsoft.com/projects/view/' + encodeURIComponent(value.clarityProjectId) + '/dashboard';
    $('detail-visit').href = 'https://wemamang.com/product/detail.html?product_no=' + encodeURIComponent(value.productId);
  }
  async function installCode() {
    var response = await fetch('/detail-tracker.js'); if (!response.ok) throw Error('설치코드를 불러오지 못했습니다.');
    var source = await response.text();
    $('install-code').value = '<script>\nwindow.ROAS_DETAIL_CONFIG = ' + JSON.stringify(settings) + ';\n' + source.replace(/<\/script/gi, '<\\/script') + '\n</script>';
    $('install-output').hidden = false;
  }
  var num = function (value) { return value === null || value === undefined || !Number.isFinite(Number(value)) ? '—' : Number(value).toLocaleString('ko-KR', { maximumFractionDigits: 1 }); };
  var pct = function (value) { return value === null || value === undefined ? '—' : num(value * 100) + '%'; };
  function label(id) {
    var m = id.match(/^image_(\d+)_p(\d+)$/); if (m) return '이미지 ' + Number(m[1]) + ' · 구간 ' + Number(m[2]);
    if (/^image_\d+$/.test(id)) return '이미지 ' + Number(id.split('_')[1]);
    return id.replace(/^video_0*/, '영상 ').replace(/^embed_0*/, '외부 영상 ');
  }
  function cell(tr, text) { var td = document.createElement('td'); td.textContent = text; tr.appendChild(td); return td; }
  function assetFor(id, context) {
    if (!catalog || !context || catalog.productId !== context.productId || catalog.contentVersion !== context.contentVersion) return null;
    return catalog.items.find(function (item) { return item.id === id.replace(/_p\d+$/, ''); }) || null;
  }
  function mediaIdentity(parent, item, id) {
    var box = document.createElement('div'); box.className = 'content-preview';
    if (item && item.url && /^https:\/\//.test(item.url)) {
      var link = document.createElement('a'); link.href = item.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.title = '원본 콘텐츠 열기';
      if (item.type === 'image') { var img = document.createElement('img'); img.src = item.url; img.alt = item.name || item.alt || label(id); img.loading = 'lazy'; img.referrerPolicy = 'no-referrer'; link.appendChild(img); }
      else if (item.type === 'video') { var video = document.createElement('video'); video.src = item.url; video.controls = true; video.preload = 'none'; video.setAttribute('aria-label', item.name || label(id)); box.appendChild(video); link.textContent = '원본 열기 ↗'; }
      else link.textContent = '외부 영상 열기 ↗';
      box.appendChild(link);
    }
    var text = document.createElement('div'), title = document.createElement('strong'), detail = document.createElement('small'), file = document.createElement('small');
    title.textContent = item && item.name ? item.name : label(id); detail.textContent = label(id) + ' · ' + id;
    file.textContent = item ? item.filename || '파일명 없음' : '파일 연결 없음 · 콘텐츠 목록을 불러오세요';
    text.append(title, detail, file); box.appendChild(text); parent.appendChild(box);
  }
  function renderCatalog(value) {
    catalog = value; $('catalog-body').replaceChildren();
    value.items.forEach(function (item) {
      var tr = document.createElement('tr'); mediaIdentity(cell(tr, ''), item, item.id);
      var input = document.createElement('input'); input.className = 'catalog-name'; input.value = item.name || ''; input.maxLength = 80; input.dataset.contentId = item.id;
      input.setAttribute('aria-label', label(item.id) + ' 분석 이름'); input.placeholder = item.alt || '예: 100℃ 가열 설명'; cell(tr, '').appendChild(input); $('catalog-body').appendChild(tr);
    });
    $('catalog-save').disabled = !value.items.length;
    $('catalog-message').textContent = value.items.length ? value.items.length + '개 콘텐츠 · 상품 ' + value.productId + ' / ' + value.contentVersion + ' · 이름을 입력한 뒤 저장하세요.' : '아직 연결된 파일이 없습니다. 자사몰 콘텐츠 불러오기를 누르세요.';
  }
  async function loadCatalog() {
    catalog = null; $('catalog-body').replaceChildren(); $('catalog-save').disabled = true;
    try { var value = await api('detail-catalog'); if (settings && value.productId === settings.productId && value.contentVersion === settings.contentVersion) renderCatalog(value); }
    catch (error) { catalog = null; notice('catalog-message', error.message, true); }
  }
  async function changeCatalog(action) {
    if (!settings) return;
    var context = { productId: settings.productId, contentVersion: settings.contentVersion };
    var names = Array.from(document.querySelectorAll('.catalog-name')).map(function (input) { return { id:input.dataset.contentId, name:input.value }; });
    $('catalog-import').disabled = $('catalog-save').disabled = true;
    notice('catalog-message', action === 'import' ? '자사몰의 현재 이미지·영상을 확인하고 있습니다…' : '이름을 저장하고 있습니다…');
    try {
      var result = await api('detail-catalog', Object.assign({ action:action, names:names }, context));
      if (settings.productId !== context.productId || settings.contentVersion !== context.contentVersion) return;
      renderCatalog(result); if (lastReport) render(lastReport);
      notice('catalog-message', action === 'import' ? result.items.length + '개 콘텐츠를 불러왔습니다. 이름을 붙인 뒤 저장하세요.' : '이름을 저장했습니다. 통계에도 같은 이름으로 표시됩니다.');
    } catch (error) { notice('catalog-message', error.message, true); }
    finally { $('catalog-import').disabled = false; $('catalog-save').disabled = !catalog || !catalog.items.length; }
  }
  function render(report) {
    lastReport = report;
    $('detail-results').hidden = true; $('detail-empty').hidden = false;
    if (report.state === 'setup_required') { notice('detail-status', '맞춤 측정기준 등록 필요: ' + report.missing.join(', '), true); $('detail-setup').open = true; return; }
    if (report.state === 'unavailable') { notice('detail-status', 'GA4 제한으로 수치를 확인할 수 없습니다. ' + (report.warnings || []).join(' '), true); return; }
    if (report.state === 'no_data') { notice('detail-status', '선택한 상품·버전·기간의 추적 이벤트가 아직 없습니다. 설치 상태와 GA4 반영 시간을 확인하세요.'); return; }
    $('detail-results').hidden = false; $('detail-empty').hidden = true;
    $('detail-views').textContent = num(report.views); $('detail-buy').textContent = num(report.buyClicks); $('detail-cart').textContent = num(report.cartClicks);
    $('detail-scroll').replaceChildren();
    [25,50,75,100].forEach(function (n) { var a = document.createElement('article'), title = document.createElement('span'), strong = document.createElement('strong');
      title.textContent = n + '% 지점'; var count = report.scroll['scroll_' + n]; strong.textContent = pct(report.views > 0 && count !== null ? (count || 0) / report.views : null);
      a.append(title, strong); $('detail-scroll').appendChild(a); });
    $('detail-content-body').replaceChildren();
    report.rows.forEach(function (r) {
      var tr = document.createElement('tr'); mediaIdentity(cell(tr, ''), assetFor(r.id, report), r.id); cell(tr, num(r.views)); var reach = cell(tr, pct(r.reachRate));
      var bar = document.createElement('div'), span = document.createElement('span'); bar.className = 'detail-bar'; span.style.width = Math.max(0, Math.min(100, (r.reachRate || 0) * 100)) + '%'; bar.appendChild(span); reach.appendChild(bar);
      cell(tr, r.averageVisibleSeconds === null ? '—' : num(r.averageVisibleSeconds) + '초');
      [r.starts,r.video25,r.video50,r.video75].forEach(function (v) { cell(tr, r.type === 'image' ? '—' : num(v)); });
      cell(tr, r.type === 'image' ? '—' : pct(r.completionRate)); $('detail-content-body').appendChild(tr);
    });
    $('detail-warnings').replaceChildren(); (report.warnings || []).forEach(function (message) { var li = document.createElement('li'); li.textContent = message; $('detail-warnings').appendChild(li); });
    notice('detail-status', (report.cached ? '저장 보고서' : 'GA4 조회 완료') + ' · ' + report.since + ' ~ ' + report.until + ' · 상품 ' + report.productId + ' / ' + report.contentVersion);
  }
  async function query(refresh) {
    if (!connected) { notice('detail-status', '먼저 GA4 연결 관리에서 기존 속성을 연결하세요.', true); return; }
    var current = ++sequence; $('detail-query').disabled = $('detail-refresh').disabled = true;
    notice('detail-status', 'GA4 맞춤 정의와 추적 이벤트를 확인하고 있습니다…');
    $('detail-results').hidden = true; $('detail-empty').hidden = false;
    try { var report = await api('detail-report?' + new URLSearchParams({ since: $('detail-since').value, until: $('detail-until').value, scope: $('detail-scope').value, refresh: refresh ? '1' : '0' })); if (current === sequence) render(report); }
    catch (error) { if (current === sequence) notice('detail-status', error.message, true); }
    finally { if (current === sequence) $('detail-query').disabled = $('detail-refresh').disabled = false; }
  }
  $('detail-settings-form').addEventListener('submit', async function (e) {
    e.preventDefault(); $('settings-save').disabled = true;
    try {
      var value = await api('detail-settings', { productId: $('detail-product').value, contentVersion: $('detail-version').value, measurementId: $('detail-measurement').value, clarityProjectId: $('detail-clarity').value, requireConsent: $('detail-consent').checked });
      sequence++; $('detail-query').disabled = $('detail-refresh').disabled = false;
      $('detail-results').hidden = true; $('detail-empty').hidden = false; lastReport = null; catalog = null; fill(value); await loadCatalog(); await installCode();
      notice('settings-message', '설정을 저장했습니다. 생성된 코드를 카페24에 적용해야 수집이 시작됩니다.');
    } catch (error) { notice('settings-message', error.message, true); } finally { $('settings-save').disabled = false; }
  });
  $('copy-code').addEventListener('click', async function () {
    try { await navigator.clipboard.writeText($('install-code').value); notice('settings-message', '설치코드를 복사했습니다.'); }
    catch (_) { $('install-code').focus(); $('install-code').select(); notice('settings-message', '복사 권한을 확인할 수 없습니다. 선택된 코드를 Ctrl+C로 복사하세요.'); }
  });
  $('detail-report-form').addEventListener('submit', function (e) { e.preventDefault(); query(false); });
  $('detail-refresh').addEventListener('click', function () { if ($('detail-report-form').reportValidity()) query(true); });
  $('catalog-import').addEventListener('click', function () { changeCatalog('import'); });
  $('catalog-save').addEventListener('click', function () { changeCatalog('rename'); });
  function iso(date) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date); }
  $('detail-until').value = iso(new Date()); $('detail-since').value = iso(new Date(Date.now() - 6 * 86400000));
  Promise.allSettled([api('status'),api('detail-settings')]).then(async function (results) {
    if (results[1].status === 'fulfilled') { fill(results[1].value); await loadCatalog(); try { await installCode(); } catch (error) { notice('settings-message', error.message, true); } }
    else { notice('detail-status', results[1].reason.message, true); return; }
    if (results[0].status === 'rejected') { notice('detail-status', results[0].reason.message, true); return; }
    connected = results[0].value.configured;
    notice('detail-status', connected ? 'GA4 연결됨 · 자사몰 설치와 맞춤 정의 등록 후 기간을 조회하세요.' : 'GA4 미연결 · GA4 연결 관리에서 기존 속성을 연결하세요.');
  });
})();
