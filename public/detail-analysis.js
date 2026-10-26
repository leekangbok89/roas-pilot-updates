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
  var thumbFrames = new Map(), thumbJobs = [], thumbActive = 0;
  function thumbKey(item, context) { return JSON.stringify([context.productId, context.contentVersion, item.id, item.url]); }
  function imageCanvas(image) {
    var width = image.videoWidth || image.naturalWidth, height = image.videoHeight || image.naturalHeight;
    if (!width || !height) throw Error('영상 장면을 읽을 수 없습니다.');
    var scale = Math.min(320 / width, 240 / height, 1), canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height); return canvas;
  }
  function videoFrame(url, anonymous) {
    return new Promise(function (resolve, reject) {
      var video = document.createElement('video'), finished = false;
      video.muted = true; video.playsInline = true; video.preload = 'auto';
      if (anonymous) video.crossOrigin = 'anonymous';
      var timer = setTimeout(function () { finish(Error('영상 서버에서 장면을 불러오지 못했습니다.')); }, 10000);
      function finish(error, canvas) { if (finished) return; finished = true; clearTimeout(timer); video.onloadeddata = video.onseeked = video.onerror = null; video.removeAttribute('src'); video.load(); error ? reject(error) : resolve(canvas); }
      function capture() { try { finish(null, imageCanvas(video)); } catch (error) { finish(error); } }
      video.onloadeddata = function () { var time = Number.isFinite(video.duration) ? Math.min(1, video.duration / 3) : 0;
        if (time > .01) { video.onseeked = capture; video.currentTime = time; } else capture(); };
      video.onerror = function () { finish(Error('영상 접근이 제한됐습니다. 썸네일을 직접 등록하세요.')); };
      video.src = url; video.load();
    });
  }
  function showThumb(slot, frame, title) {
    slot.replaceChildren();
    if (frame.data) { var img = document.createElement('img'); img.src = frame.data; img.alt = title + ' 썸네일'; slot.appendChild(img); }
    else { var canvas = document.createElement('canvas'); canvas.width = frame.canvas.width; canvas.height = frame.canvas.height;
      canvas.getContext('2d').drawImage(frame.canvas, 0, 0); canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', title + ' 썸네일'); slot.appendChild(canvas); }
    var badge = document.createElement('span'); badge.textContent = '▶'; badge.style.cssText = 'position:absolute;right:5px;bottom:2px;color:white;text-shadow:0 1px 3px black'; slot.appendChild(badge);
  }
  async function persistThumb(item, context, data) {
    var result = await api('detail-catalog', Object.assign({action:'thumbnail',id:item.id,thumbnail:data},context));
    if (catalog && catalog.productId === context.productId && catalog.contentVersion === context.contentVersion) {
      var saved = result.items.find(function (entry) { return entry.id === item.id; }), local = catalog.items.find(function (entry) { return entry.id === item.id; });
      if (saved && local) local.thumbnail = saved.thumbnail;
    }
  }
  function enqueueThumb(job) { thumbJobs.push(job); pumpThumbs(); }
  function pumpThumbs() { while (thumbActive < 2 && thumbJobs.length) {
    var job = thumbJobs.shift(); thumbActive++;
    Promise.resolve().then(job).catch(function () {}).finally(function () { thumbActive--; pumpThumbs(); });
  } }
  var thumbObserver = typeof IntersectionObserver === 'function' ? new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) { if (entry.isIntersecting) { thumbObserver.unobserve(entry.target); entry.target.__loadThumb(); } });
  }, {rootMargin:'200px'}) : null;
  function videoThumbnail(item, id) {
    var holder = document.createElement('div'); holder.className = 'video-thumb';
    var slot = document.createElement('a'); slot.href = item.url; slot.target = '_blank'; slot.rel = 'noopener noreferrer'; slot.title = '원본 영상 열기';
    slot.setAttribute('aria-label', (item.name || label(id)) + ' 원본 영상 열기');
    var context = {productId:catalog.productId,contentVersion:catalog.contentVersion}, key = thumbKey(item, context);
    slot.dataset.thumbKey = key; var message = document.createElement('small'); message.className = 'thumb-message';
    var placeholder = document.createElement('span'); placeholder.className = 'thumb-placeholder'; placeholder.textContent = '썸네일 준비 중'; slot.appendChild(placeholder);
    function display(frame) { thumbFrames.set(key,frame); document.querySelectorAll('.video-thumb a').forEach(function (node) { if (node.dataset.thumbKey === key) showThumb(node,frame,item.name || label(id)); }); }
    slot.__loadThumb = function () { enqueueThumb(async function () {
      if (!slot.isConnected) return;
      if (thumbFrames.has(key)) { showThumb(slot,thumbFrames.get(key),item.name || label(id)); return; }
      if (item.thumbnail || item.poster) { var img = document.createElement('img'); img.alt = (item.name || label(id)) + ' 썸네일'; img.src = item.thumbnail || item.poster;
        img.onerror = function () { placeholder.textContent = '썸네일 등록 필요'; slot.replaceChildren(placeholder); }; slot.replaceChildren(img); return; }
      var yt = item.type === 'embed' && item.url.match(/\/embed\/([A-Za-z0-9_-]{6,})/);
      if (yt) { var preview = document.createElement('img'); preview.alt = '외부 영상 썸네일'; preview.src = 'https://i.ytimg.com/vi/' + yt[1] + '/hqdefault.jpg'; preview.onerror = function () { placeholder.textContent = '썸네일 등록 필요'; slot.replaceChildren(placeholder); }; slot.replaceChildren(preview); return; }
      try {
        var canvas; try { canvas = await videoFrame(item.url, true); } catch (_) { canvas = await videoFrame(item.url, false); }
        if (thumbFrames.has(key)) { showThumb(slot,thumbFrames.get(key),item.name || label(id)); return; }
        var frame = {canvas:canvas}; try { frame.data = canvas.toDataURL('image/jpeg',.72); } catch (_) {}
        display(frame); if (frame.data) { try { await persistThumb(item,context,frame.data); } catch (_) { message.textContent = '저장되지 않아 다음 접속 시 다시 추출합니다.'; } }
      } catch (_) { placeholder.textContent = '썸네일 등록 필요'; slot.replaceChildren(placeholder); message.textContent = '서버 접근 제한 · 이미지나 원본 영상을 등록하세요.'; }
    }); };
    var upload = document.createElement('label'); upload.className = 'thumb-upload'; upload.tabIndex = 0; upload.setAttribute('role','button'); upload.appendChild(document.createTextNode('썸네일 등록 / 변경'));
    var input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*,video/mp4,video/webm'; input.setAttribute('aria-label',(item.name || label(id)) + ' 썸네일 파일'); upload.appendChild(input);
    upload.addEventListener('keydown',function(event){if(event.key==='Enter'||event.key===' '){event.preventDefault();input.click();}});
    input.addEventListener('change',async function () {
      var file = input.files[0]; if (!file) return; if (file.size > 100*1024*1024) { message.textContent = '100MB 이하의 파일을 선택하세요.'; return; }
      var url = URL.createObjectURL(file); input.disabled = true; message.textContent = '썸네일 생성 중…';
      try {
        var canvas = file.type.indexOf('video/') === 0 ? await videoFrame(url,false) : await new Promise(function (resolve,reject) { var img = new Image(); img.onload = function () { try { resolve(imageCanvas(img)); } catch(error) { reject(error); } }; img.onerror = function () { reject(Error('이미지 파일을 확인하세요.')); }; img.src = url; });
        var data = canvas.toDataURL('image/jpeg',.72); await persistThumb(item,context,data); display({data:data}); message.textContent = '썸네일 저장 완료';
      } catch (error) { message.textContent = error.message || '썸네일을 저장하지 못했습니다.'; }
      finally { URL.revokeObjectURL(url); input.disabled = false; input.value = ''; }
    });
    holder.append(slot,upload,message);
    if (thumbObserver) thumbObserver.observe(slot); else setTimeout(slot.__loadThumb,0);
    return holder;
  }
  function assetFor(id, context) {
    if (!catalog || !context || catalog.productId !== context.productId || catalog.contentVersion !== context.contentVersion) return null;
    return catalog.items.find(function (item) { return item.id === id.replace(/_p\d+$/, ''); }) || null;
  }
  function mediaIdentity(parent, item, id) {
    var box = document.createElement('div'); box.className = 'content-preview';
    if (item && item.url && /^https:\/\//.test(item.url)) {
      var link = document.createElement('a'); link.href = item.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.title = '원본 콘텐츠 열기';
      if (item.type === 'image') { var img = document.createElement('img'); img.src = item.url; img.alt = item.name || item.alt || label(id); img.loading = 'lazy'; img.referrerPolicy = 'no-referrer'; link.appendChild(img); }
      else box.appendChild(videoThumbnail(item,id));
      if (item.type === 'image') box.appendChild(link);
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
    if (report.state === 'setup_required') { notice('detail-status', '맞춤 측정기준 등록 필요: ' + report.missing.join(', '), true); $('detail-reference').open = true; $('detail-setup').open = true; return; }
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
    notice('detail-connection-status', connected ? 'GA4 연결됨 · 자사몰 설치와 맞춤 정의 등록 후 기간을 조회하세요.' : 'GA4 미연결 · GA4 연결 관리에서 기존 속성을 연결하세요.');
    if (!connected) notice('detail-status', 'GA4 미연결 · GA4 연결 관리에서 기존 속성을 연결하세요.', true);
  });
})();
