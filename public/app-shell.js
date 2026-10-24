/* Shared navigation and theme. Loaded in the head so the saved theme precedes paint. */
(function () {
  'use strict';
  var themeKey = 'roas-pilot-theme';
  var root = document.documentElement;
  var savedTheme = 'dark';
  try { savedTheme = localStorage.getItem(themeKey) === 'light' ? 'light' : 'dark'; } catch (_) {}
  root.dataset.theme = savedTheme;
  root.style.colorScheme = savedTheme;

  function initializeShell() {
    var body = document.body;
    var rail = document.getElementById('app-nav-rail');
    var drawer = document.getElementById('app-drawer');
    var toggle = document.getElementById('app-nav-toggle');
    var main = document.getElementById('app-main');
    var themeToggle = document.getElementById('app-theme-toggle');
    var drawerThemeToggle = document.getElementById('app-theme-drawer-toggle');
    if (!body || !rail || !drawer || !toggle || !main) return;
    var pinned = false;
    var keyboard = false;
    var suppressFocus = false;
    function supportsHover() { return window.matchMedia('(any-hover: hover)').matches; }

    function setOpen(open) {
      body.classList.toggle('app-nav-open', open);
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? '메뉴 닫기' : '메뉴 열기');
      drawer.setAttribute('aria-hidden', String(!open));
      drawer.inert = !open;
    }
    function closeDrawer(restoreFocus) {
      pinned = false;
      setOpen(false);
      if (restoreFocus) {
        suppressFocus = true;
        toggle.focus({ preventScroll: true });
        suppressFocus = false;
      }
    }
    function insideMenu(target) {
      return target instanceof Node && (rail.contains(target) || drawer.contains(target));
    }
    function leaveMenu(event) {
      if (insideMenu(event.relatedTarget) || pinned) return;
      if (keyboard && drawer.contains(document.activeElement)) return;
      closeDrawer(false);
    }
    rail.addEventListener('pointerenter', function (event) {
      if (event.pointerType === 'touch' || !supportsHover()) return;
      if (!themeToggle || event.clientY < themeToggle.getBoundingClientRect().top - 4) setOpen(true);
    });
    rail.addEventListener('pointermove', function (event) {
      if (event.pointerType === 'touch' || !supportsHover()) return;
      if (themeToggle && event.clientY >= themeToggle.getBoundingClientRect().top - 4) {
        if (!pinned) closeDrawer(false);
      }
    });
    drawer.addEventListener('pointerenter', function (event) {
      if (event.pointerType !== 'touch' && supportsHover()) setOpen(true);
    });
    rail.addEventListener('pointerleave', leaveMenu);
    drawer.addEventListener('pointerleave', leaveMenu);
    toggle.addEventListener('focus', function () { if (!suppressFocus) setOpen(true); });
    toggle.addEventListener('click', function () {
      pinned = !pinned;
      setOpen(pinned);
    });
    drawer.addEventListener('focusin', function () { setOpen(true); });
    drawer.addEventListener('focusout', function (event) {
      if (!insideMenu(event.relatedTarget) && !pinned) closeDrawer(false);
    });
    document.addEventListener('pointerdown', function (event) {
      keyboard = false;
      if (!insideMenu(event.target)) closeDrawer(false);
    }, true);
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Tab') keyboard = true;
      if (event.key === 'Escape' && body.classList.contains('app-nav-open')) {
        event.preventDefault();
        closeDrawer(true);
      }
    });
    setOpen(false);

    function applyTheme(theme, persist) {
      var dark = theme !== 'light';
      root.dataset.theme = dark ? 'dark' : 'light';
      root.style.colorScheme = dark ? 'dark' : 'light';
      var label = dark ? '라이트 모드로 전환' : '다크 모드로 전환';
      [themeToggle, drawerThemeToggle].forEach(function (button) {
        if (!button) return;
        button.setAttribute('aria-label', label);
        button.setAttribute('title', label);
        button.setAttribute('aria-pressed', String(dark));
        var icon = button.querySelector('[data-theme-icon]');
        if (icon) icon.textContent = dark ? '☀' : '☾';
      });
      var text = document.getElementById('app-theme-label');
      if (text) text.textContent = label;
      if (persist) { try { localStorage.setItem(themeKey, root.dataset.theme); } catch (_) {} }
    }
    function toggleTheme(event) {
      event.stopPropagation();
      applyTheme(root.dataset.theme === 'dark' ? 'light' : 'dark', true);
    }
    if (themeToggle) themeToggle.addEventListener('click', toggleTheme);
    if (drawerThemeToggle) drawerThemeToggle.addEventListener('click', toggleTheme);
    window.addEventListener('storage', function (event) {
      if (event.key === themeKey || event.key === null) applyTheme(event.newValue, false);
    });
    applyTheme(root.dataset.theme, false);

    var nav = document.getElementById('app-nav');
    if (nav && !nav.querySelector('[data-app-route="experiments"]')) {
      var experimentalLink = document.createElement('a');
      experimentalLink.className = 'app-nav-link';
      experimentalLink.dataset.appRoute = 'experiments';
      experimentalLink.href = '/meta-experiments.html';
      experimentalLink.textContent = '메타 광고 실험실';
      var settingsLink = nav.querySelector('[data-app-route="data-source"]');
      if (settingsLink) nav.insertBefore(experimentalLink, settingsLink);
      else nav.appendChild(experimentalLink);
    }
    var links = Array.from(document.querySelectorAll('.app-nav-link'));
    function markActive(key) {
      links.forEach(function (link) {
        var active = link.dataset.appRoute === key;
        link.classList.toggle('active', active);
        if (active) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
      });
    }
    var page = body.dataset.appPage;
    var settings = ['data-source', 'naver-commerce', 'cafe24-oauth', 'setting-bar', 'fx-bar', 'history-audit', 'update-manager'];
    var views = {
      'ads-section': ['#date-controls', '#channel-bar', '#message', '#ads-section', '#detail'],
      'daily-compare': ['#daily-compare'],
      'sales-impact': ['#sales-impact'],
      'data-source': ['#settings-tabs', '#settings-panel-host']
    };
    var titles = { 'ads-section': '광고별 진단', 'daily-compare': '날짜별 비교', 'sales-impact': '전체 매출 분석', 'data-source': '설정 관리' };
    var descriptions = {
      'ads-section': '광고별 구매 성과와 진단 근거를 확인합니다.',
      'daily-compare': '두 기간의 광고 성과와 설정 변경 기록을 비교합니다.',
      'sales-impact': '쇼핑몰 주문 매출과 광고 성과를 같은 기간으로 살펴봅니다.',
      'data-source': '광고 계정, 쇼핑몰 연결, 수집 상태와 프로그램을 관리합니다.'
    };
    var selectors = Array.from(new Set(Object.keys(views).reduce(function (all, key) { return all.concat(views[key]); }, [])));
    function requestedRoute() {
      try { return decodeURIComponent(location.hash.slice(1)); } catch (_) { return ''; }
    }
    function renderRoute(key, focus) {
      var view = settings.indexOf(key) >= 0 ? 'data-source' : Object.prototype.hasOwnProperty.call(views, key) ? key : 'ads-section';
      selectors.forEach(function (selector) {
        var element = document.querySelector(selector);
        if (element) element.classList.toggle('workspace-hidden', views[view].indexOf(selector) < 0);
      });
      document.querySelectorAll('.charts,.kpis,#funnel').forEach(function (element) { element.classList.add('workspace-hidden'); });
      var title = document.getElementById('app-view-title');
      var description = document.getElementById('app-view-description');
      if (title) title.textContent = titles[view];
      if (description) description.textContent = descriptions[view];
      var exportButton = document.getElementById('export');
      if (exportButton) exportButton.hidden = view !== 'ads-section';
      if (view === 'data-source' && typeof window.roasShowSettingsPanel === 'function') window.roasShowSettingsPanel(settings.indexOf(key) >= 0 ? key : 'data-source');
      body.dataset.appView = view;
      document.title = 'ROAS Pilot | ' + titles[view];
      markActive(view);
      body.classList.add('app-route-ready');
      if (focus) main.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
    function navigate(key, focus) {
      if (location.hash !== '#' + key) history.pushState(null, '', '#' + key);
      renderRoute(key, focus);
    }
    links.forEach(function (link) {
      link.addEventListener('click', function (event) {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        var url = new URL(link.href, location.href);
        closeDrawer(false);
        if (page === 'index' && url.origin === location.origin && (url.pathname === '/' || url.pathname === '/index.html') && url.hash) {
          event.preventDefault();
          navigate(url.hash.slice(1), true);
        }
      });
    });
    if (page === 'index') {
      document.querySelectorAll('[data-settings]').forEach(function (tab) {
        tab.addEventListener('click', function () { navigate(tab.dataset.settings, false); });
      });
      window.addEventListener('hashchange', function () { renderRoute(requestedRoute(), false); });
      window.addEventListener('popstate', function () { renderRoute(requestedRoute(), false); });
      renderRoute(requestedRoute(), false);
    } else {
      markActive(page === 'cost' ? 'cost' : page === 'ga4' ? 'ga4' : page === 'experiments' ? 'experiments' : 'overview');
      body.classList.add('app-route-ready');
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initializeShell, { once: true });
  else initializeShell();
})();
