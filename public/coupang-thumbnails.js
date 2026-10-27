(function () {
  'use strict';
  function safeImageUrl(value) {
    if (typeof value !== 'string' || value.length > 2048) return null;
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password || url.port || !/^(?:image|thumbnail)\d*\.coupangcdn\.com$/i.test(url.hostname)) return null;
      url.hash = ''; return url.href;
    } catch (_) { return null; }
  }
  function contextKey(value) { return value && typeof value.vendorKey === 'string' && value.vendorKey && typeof value.scopeKey === 'string' && value.scopeKey ? value.vendorKey + ':' + value.scopeKey : ''; }
  function matchingContext(a, b) { const key = contextKey(a); return !!key && key === contextKey(b); }
  function buildIndex(items) {
    const options = new Map(), products = new Map();
    for (const item of Array.isArray(items) ? items : []) {
      const url = safeImageUrl(item?.thumbnailUrl); if (!url) continue;
      if (item.itemId != null) options.set(String(item.itemId), url);
      if (item.productId != null && !products.has(String(item.productId))) products.set(String(item.productId), url);
    }
    return { options, products };
  }
  function findThumbnail(index, item) { return item?.itemId != null ? index.options.get(String(item.itemId)) || null : item?.productId != null ? index.products.get(String(item.productId)) || null : null; }
  const helpers = { safeImageUrl, contextKey, matchingContext, buildIndex, findThumbnail };
  if (typeof module !== 'undefined' && module.exports) module.exports = helpers;
  if (typeof document === 'undefined') return;
  const entries = new Map(), emptyIndex = () => ({ options: new Map(), products: new Map() });
  let context = null, state = null, index = emptyIndex(), sequence = 0, timer = null, starting = false, autoAttempt = '', failure = '', pruning = false;
  const element = (tag, className) => { const node = document.createElement(tag); if (className) node.className = className; return node; };
  function stopTimer() { if (timer !== null) clearTimeout(timer); timer = null; }
  function paint(entry) {
    const url = matchingContext(context, state) && entry.context === contextKey(context) ? findThumbnail(index, entry.item) : null;
    if (entry.url === url && (entry.image || !url || entry.failedUrl === url)) return;
    entry.url = url; entry.image = null; entry.box.replaceChildren(entry.fallback); entry.box.dataset.state = 'missing'; entry.box.title = '이미지 미등록';
    if (!url) return;
    if (entry.failedUrl === url) { entry.box.title = '이미지를 불러올 수 없습니다'; entry.box.dataset.state = 'error'; return; }
    const image = element('img'); image.alt = ''; image.loading = 'lazy'; image.decoding = 'async'; image.referrerPolicy = 'no-referrer'; image.width = image.height = 36;
    entry.image = image; entry.box.dataset.state = 'loading'; entry.box.title = '상품 이미지';
    image.addEventListener('load', () => { if (entry.image === image) entry.box.dataset.state = 'ready'; });
    image.addEventListener('error', () => { if (entry.image !== image) return; entry.failedUrl = url; entry.image = null; entry.box.replaceChildren(entry.fallback); entry.box.dataset.state = 'error'; entry.box.title = '이미지를 불러올 수 없습니다'; });
    image.src = url; entry.box.replaceChildren(image);
  }
  function paintAll() { for (const [container, entry] of entries) { if (!container.isConnected) entries.delete(container); else paint(entry); } }
  function showStatus() {
    const button = document.getElementById('cth-refresh'), label = document.getElementById('cth-status');
    const running = matchingContext(context, state) && state.job?.running;
    if (button) { button.disabled = !contextKey(context) || starting || !!running; button.textContent = starting || running ? '상품 이미지 확인 중' : '상품 이미지 새로고침'; }
    if (!label) return;
    let text = '상품 이미지는 쿠팡 연결과 집계 상품을 확인한 뒤 불러옵니다.';
    if (contextKey(context)) {
      if (starting) text = '쿠팡 상품 이미지를 확인합니다. 매출·손익 자료는 계속 볼 수 있습니다.';
      else if (matchingContext(context, state)) {
        const total = Array.isArray(state.items) ? state.items.length : 0, found = Array.isArray(state.items) ? state.items.filter(item => safeImageUrl(item.thumbnailUrl)).length : 0;
        text = '상품 이미지 ' + found.toLocaleString('ko-KR') + '/' + total.toLocaleString('ko-KR') + '개 · ' + (running ? state.job.status === 'waiting' ? '주문 수집이 끝나면 상품 이미지를 불러옵니다.' : '불러오는 중입니다. 이미지가 확인되는 순서대로 표시합니다.' : '이미지가 없는 옵션은 기본 아이콘으로 표시합니다.');
        if (state.job?.error) text += ' ' + String(state.job.error).slice(0, 300);
      } else text = state ? '조회 중 판매자나 집계 상품이 변경되었습니다. 저장 자료를 다시 읽어 주세요.' : '저장한 상품 이미지를 확인합니다.';
    }
    label.textContent = text + (failure ? ' ' + failure : '');
  }
  async function request(payload) {
    const response = await fetch('/api/coupang/thumbnails', payload === undefined ? { credentials: 'same-origin' } : { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-ROAS-Local-Action': 'yes' }, body: JSON.stringify(payload) });
    let data; try { data = await response.json(); } catch (_) { throw Error('상품 이미지 응답을 읽지 못했습니다.'); }
    if (!response.ok) throw Error(typeof data.error === 'string' ? data.error.slice(0, 300) : '상품 이미지를 불러오지 못했습니다.'); return data;
  }
  function applyState(data) { state = data; index = matchingContext(context, state) ? buildIndex(state.items) : emptyIndex(); failure = ''; paintAll(); showStatus(); }
  function poll() { stopTimer(); if (matchingContext(context, state) && state.job?.running) timer = setTimeout(refresh, 5000); }
  async function refresh() {
    if (!contextKey(context) || starting) return; stopTimer(); const token = ++sequence, captured = contextKey(context);
    try {
      const data = await request(); if (token !== sequence || captured !== contextKey(context)) return;
      applyState(data); poll();
      if (matchingContext(context, state) && state.needsSync === true && !state.job?.running && autoAttempt !== captured) { autoAttempt = captured; start(false); }
    } catch (error) { if (token === sequence) { failure = error.message; showStatus(); poll(); } }
  }
  async function start(force) {
    if (!contextKey(context) || starting || matchingContext(context, state) && state.job?.running) return;
    stopTimer(); const token = ++sequence, captured = contextKey(context); starting = true; failure = ''; showStatus();
    if (force) for (const entry of entries.values()) { entry.failedUrl = null; entry.url = undefined; }
    try {
      const data = await request({ vendorKey: context.vendorKey, scopeKey: context.scopeKey, force: !!force });
      if (token !== sequence || captured !== contextKey(context)) return; applyState(data); poll();
    } catch (error) { if (token === sequence) { failure = error.message; showStatus(); } }
    finally { if (token === sequence) { starting = false; paintAll(); showStatus(); } }
  }
  function setContext(value) {
    const next = contextKey(value) ? { vendorKey: value.vendorKey, scopeKey: value.scopeKey } : null;
    const changed = contextKey(next) !== contextKey(context); context = next;
    if (changed) { ++sequence; stopTimer(); state = null; index = emptyIndex(); starting = false; failure = ''; paintAll(); }
    showStatus(); if (contextKey(context)) refresh();
  }
  function decorate(container, item) {
    if (!container) return;
    let entry = entries.get(container);
    if (!entry) {
      const wrapper = element('span', 'cth-product'), label = element('span', 'cth-label'), box = element('span', 'cth-image'), fallback = element('span', 'cth-fallback');
      fallback.textContent = '▧'; fallback.setAttribute('aria-hidden', 'true'); box.setAttribute('aria-hidden', 'true'); box.title = '이미지 미등록'; box.append(fallback);
      while (container.firstChild) label.append(container.firstChild);
      wrapper.append(box, label); container.append(wrapper); container.classList.add('cth-cell');
      entry = { item, context: contextKey(context), box, fallback, image: null, url: undefined, failedUrl: null }; entries.set(container, entry);
    } else { entry.item = item; entry.context = contextKey(context); }
    paint(entry);
    if (!pruning) { pruning = true; Promise.resolve().then(() => { pruning = false; for (const [node] of entries) if (!node.isConnected) entries.delete(node); }); }
  }
  window.CoupangThumbnails = Object.freeze({ setContext, decorate, refresh, start });
  const button = document.getElementById('cth-refresh'); if (button) button.addEventListener('click', () => start(true)); showStatus();
  window.addEventListener('pagehide', () => { ++sequence; stopTimer(); starting = false; showStatus(); });
  window.addEventListener('pageshow', event => { if (event.persisted) refresh(); });
})();
