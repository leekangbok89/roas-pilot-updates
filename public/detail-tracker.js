/* ROAS Pilot detail tracker. Install once, after your Google tag / consent setup. */
(function (w, d) {
  'use strict';
  var c = w.ROAS_DETAIL_CONFIG || {};
  if (w.__roasDetailTracker || !/^G-[A-Z0-9]+$/.test(c.measurementId || '') || !/^\d+$/.test(c.productId || '')) return;
  var host = w.location.hostname.toLowerCase();
  if (host !== 'wemamang.com' && host !== 'www.wemamang.com' && host !== 'm.wemamang.com') return;
  var url = new URL(w.location.href);
  var product = url.searchParams.get('product_no') || (url.pathname.match(/\/product\/[^/]+\/(\d+)(?:\/|$)/) || [])[1];
  if (product !== String(c.productId)) return;
  w.__roasDetailTracker = { version: '1', events: 0, content: 0, youtube: 'not_detected' };
  var state = w.__roasDetailTracker;
  var root, parts = [], media = [], known = new WeakSet(), pageStarted = false, last = performance.now(), lastFlush = last, hidden = d.hidden;
  var marks = new Set(), observer, timer, stopped = false;
  var enabled = function () { return !c.requireConsent || w.ROAS_DETAIL_CONSENT === true; };
  function script(src) { var s = d.createElement('script'); s.async = true; s.src = src; d.head.appendChild(s); }
  function startTags() {
    w.dataLayer = w.dataLayer || [];
    w.gtag = w.gtag || function () { w.dataLayer.push(arguments); };
    var hasGoogleTag = Array.from(d.scripts).some(function (s) { return s.src.indexOf('googletagmanager.com/gtag/js') >= 0; });
    if (!hasGoogleTag && !(w.google_tag_manager && w.google_tag_manager[c.measurementId])) {
      script('https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(c.measurementId));
      w.gtag('js', new Date());
      w.gtag('config', c.measurementId, { send_page_view: false });
    }
    if (c.clarityProjectId && /^[a-z0-9]{4,32}$/.test(c.clarityProjectId) && !w.clarity) {
      w.clarity = function () { (w.clarity.q = w.clarity.q || []).push(arguments); };
      script('https://www.clarity.ms/tag/' + c.clarityProjectId);
    }
    if (typeof w.clarity === 'function') {
      w.clarity('set', 'rp_product_id', String(c.productId));
      w.clarity('set', 'rp_content_version', c.contentVersion);
    }
  }
  function emit(name, part, extra) {
    if (!enabled()) return;
    var params = Object.assign({ send_to: c.measurementId, rp_product_id: String(c.productId), rp_content_version: c.contentVersion,
      rp_content_id: part ? part.id : 'page', rp_content_type: part ? part.type : 'page', transport_type: 'beacon' }, extra || {});
    // No member, order, email, full asset URL or ad click identifier is collected here.
    w.gtag('event', name, params);
    state.events++;
    if (typeof w.clarity === 'function' && name !== 'rp_content_time') w.clarity('event', name + '_' + params.rp_content_id);
  }
  function once(name, part) {
    var key = name + ':' + (part ? part.id : 'page');
    if (!enabled() || marks.has(key)) return;
    marks.add(key); emit(name, part);
  }
  function visible(rect, top, bottom) {
    if (rect.width <= 0 || bottom <= top) return false;
    var height = w.innerHeight, width = w.innerWidth;
    return Math.max(0, Math.min(bottom, height) - Math.max(top, 0)) >= Math.min(bottom - top, height) * .5 &&
      Math.max(0, Math.min(rect.right, width) - Math.max(rect.left, 0)) >= Math.min(rect.width, width) * .5;
  }
  function onScreen(part) {
    var el = part.el;
    if (!el.isConnected || !el.getClientRects().length || w.getComputedStyle(el).visibility === 'hidden' || w.getComputedStyle(el).opacity === '0') return false;
    var rect = el.getBoundingClientRect();
    return visible(rect, rect.top + rect.height * part.from, rect.top + rect.height * part.to);
  }
  function addPart(el, id, type, from, to) {
    var p = { el: el, id: id, type: type, from: from, to: to, time: 0, pending: 0, reached: false };
    parts.push(p); state.content = parts.length; return p;
  }
  function videoSample(m, ended) {
    var playing, position, duration;
    try {
      playing = m.player ? m.player.getPlayerState() === 1 : !m.el.paused && !m.el.ended;
      position = m.player ? m.player.getCurrentTime() : m.el.currentTime;
      duration = m.player ? m.player.getDuration() : m.el.duration;
    } catch (_) { return; }
    if ((!playing && !ended) || !onScreen(m.part) || !Number.isFinite(duration) || duration <= 0 || d.hidden || !enabled()) { m.previous = null; return; }
    if (ended) position = duration;
    once('rp_video_start', m.part);
    // Count actual forward playback while visible. Seeking to the end cannot count as a full view.
    if (m.previous !== null && position >= m.previous && position - m.previous <= 2) {
      var a = Math.floor(m.previous * 4), b = Math.floor(position * 4);
      for (var i = a; i < b; i++) m.watched.add(i);
    }
    m.previous = position;
    var percent = m.watched.size / (duration * 4) * 100;
    [25, 50, 75, 100].forEach(function (n) { if (percent >= (n === 100 ? 98 : n)) once('rp_video_' + n, m.part); });
  }
  function scan() {
    if (!root) return;
    var images = Array.from(root.querySelectorAll('img'));
    images.forEach(function (el, index) {
      if (known.has(el) || !el.complete || el.naturalWidth < 200 || el.naturalHeight < 100) return;
      known.add(el);
      // Intrinsic image coordinates keep section identities consistent on mobile and desktop.
      var count = Math.min(50, Math.max(1, Math.ceil(el.naturalHeight / 1000)));
      for (var j = 0; j < count; j++) addPart(el, 'image_' + String(index + 1).padStart(3, '0') + '_p' + String(j + 1).padStart(2, '0'), 'image', j / count, (j + 1) / count);
    });
    root.querySelectorAll('video').forEach(function (el, index) {
      if (known.has(el)) return;
      known.add(el);
      var part = addPart(el, 'video_' + String(index + 1).padStart(3, '0'), 'video', 0, 1);
      var m = { el: el, part: part, previous: null, watched: new Set() }; media.push(m);
      el.addEventListener('seeking', function () { m.previous = null; });
      el.addEventListener('timeupdate', function () { if (pageStarted) videoSample(m); });
      el.addEventListener('ended', function () { if (pageStarted) videoSample(m, true); });
    });
    // YouTube only: adding API parameters here would reload an existing player.
    // Track reach for every iframe; playback requires enablejsapi=1 in the saved embed.
    root.querySelectorAll('iframe').forEach(function (el, index) {
      if (known.has(el)) return;
      known.add(el);
      var part = addPart(el, 'embed_' + String(index + 1).padStart(3, '0'), 'embed', 0, 1), u;
      try { u = new URL(el.src, w.location.href); } catch (_) { return; }
      if (!/^(www\.)?(youtube\.com|youtube-nocookie\.com)$/.test(u.hostname)) return;
      state.youtube = u.searchParams.get('enablejsapi') === '1' ? 'loading' : 'enablejsapi_required';
      if (state.youtube === 'enablejsapi_required') return;
      var tries = 0;
      function attach() {
        if (stopped) return;
        if (w.YT && w.YT.Player) {
          var player = new w.YT.Player(el, { events: { onReady: function () { state.youtube = 'ready'; } } });
          media.push({ el: el, part: part, player: player, previous: null, watched: new Set() });
        } else if (++tries < 30) w.setTimeout(attach, 1000);
      }
      if (!Array.from(d.scripts).some(function (s) { return s.src.indexOf('youtube.com/iframe_api') >= 0; })) script('https://www.youtube.com/iframe_api');
      attach();
    });
  }
  function flush() {
    parts.forEach(function (p) {
      if (p.reached && p.pending >= 1) { var ms = Math.floor(p.pending); p.pending -= ms; emit('rp_content_time', p, { rp_visible_ms: ms }); }
    });
  }
  function tick() {
    var now = performance.now(), delta = now - last; last = now;
    if (hidden || !enabled()) { media.forEach(function (m) { m.previous = null; }); return; }
    if (!pageStarted) { startTags(); pageStarted = true; once('rp_detail_view'); }
    // Ignore suspended-tab gaps instead of counting them as attention.
    if (delta > 1500) delta = 0;
    parts.forEach(function (p) {
      if (!onScreen(p)) return;
      p.time += delta; p.pending += delta;
      if (!p.reached && p.time >= 1000) { p.reached = true; once('rp_content_view', p); }
    });
    var r = root.getBoundingClientRect();
    if (r.height > 0) [25, 50, 75, 100].forEach(function (n) {
      if ((w.innerHeight - r.top) / r.height * 100 >= n) once('rp_scroll', { id: 'scroll_' + n, type: 'scroll' });
    });
    media.forEach(function (m) { videoSample(m); });
    if (now - lastFlush >= 15000) { flush(); lastFlush = now; }
  }
  function ready() {
    if (stopped) return;
    root = d.querySelector(c.rootSelector || '#prdDetail');
    if (!root) { if (++ready.tries < 60) w.setTimeout(ready, 500); return; }
    scan();
    observer = new MutationObserver(scan); observer.observe(root, { childList: true, subtree: true });
    root.addEventListener('load', scan, true);
    timer = w.setInterval(tick, 500); tick();
    d.addEventListener('click', function (e) {
      var button = e.target.closest('a,button'); if (!button) return;
      var action = button.getAttribute('onclick') || '';
      if (/product_submit\(\s*1\s*,/.test(action) || button.matches('[data-roas-buy]')) once('rp_buy_click');
      if (/product_submit\(\s*2\s*,/.test(action) || button.matches('[data-roas-cart],.actionCart')) once('rp_cart_click');
    }, true);
  }
  ready.tries = 0;
  d.addEventListener('visibilitychange', function () { if (!hidden) { tick(); flush(); } hidden = d.hidden; last = performance.now(); });
  w.addEventListener('pagehide', function () { if (!hidden) tick(); flush(); hidden = true; });
  w.addEventListener('pageshow', function () { hidden = d.hidden; last = performance.now(); });
  state.stop = function () { flush(); stopped = true; w.clearInterval(timer); if (observer) observer.disconnect(); };
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', ready, { once: true }); else ready();
})(window, document);
