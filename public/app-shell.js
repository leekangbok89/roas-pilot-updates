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
    // Keep legacy views and direct URLs available without promoting them.
    if (nav) {
      nav.querySelectorAll('[data-app-route="sales-impact"], [data-app-route="ga4"], [data-app-route="experiments"]').forEach(function (link) {
        link.remove();
      });
    }
    // Shared display analysis navigation, visible on all workspace pages.
    if (nav && !nav.querySelector('[data-app-route="display"]')) {
      var displayLink = document.createElement('a');
      displayLink.className = 'app-nav-link';
      displayLink.dataset.appRoute = 'display';
      displayLink.href = '/display-analysis.html';
      displayLink.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 21h8M12 18v3M7 13l3-3 3 2 4-5"/></svg><span>네이버 GFA 분석</span>';
      var costLink = nav.querySelector('[data-app-route="cost"]');
      if (costLink) nav.insertBefore(displayLink, costLink);
      else nav.appendChild(displayLink);
    }
    if (nav && !nav.querySelector('[data-app-route="detail"]')) {
      var detailLink = document.createElement('a');
      detailLink.className = 'app-nav-link';
      detailLink.dataset.appRoute = 'detail';
      detailLink.href = '/detail-analysis.html';
      detailLink.textContent = '상세페이지 분석';
      var settingsLink = nav.querySelector('[data-app-route="data-source"]');
      if (settingsLink) nav.insertBefore(detailLink, settingsLink);
      else nav.appendChild(detailLink);
    }
    if (nav && !nav.querySelector('[data-app-route="changes"]')) {
      var changeLink = document.createElement('a');
      changeLink.className = 'app-nav-link';
      changeLink.dataset.appRoute = 'changes';
      changeLink.href = '/ad-changes.html';
      changeLink.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="4" y="4" width="16" height="17" rx="2"/><path d="M8 2v5M16 2v5M4 10h16M8 14h8M8 17h5"/></svg><span>광고 변경 기록</span>';
      var dailyLink = nav.querySelector('[data-app-route="daily-compare"]');
      if (dailyLink) dailyLink.after(changeLink);
      else nav.appendChild(changeLink);
    }
    if (nav && !nav.querySelector('[data-app-route="search"]')) {
      var searchLink = document.createElement('a');
      searchLink.className = 'app-nav-link';
      searchLink.dataset.appRoute = 'search';
      searchLink.href = '/naver-search.html';
      searchLink.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="10" cy="10" r="6"/><path d="m15 15 6 6M7 12v-2M10 12V7M13 12V9"/></svg><span>검색광고 분석</span>';
      var displayItem = nav.querySelector('[data-app-route="display"]');
      if (displayItem) nav.insertBefore(searchLink, displayItem);
      else nav.appendChild(searchLink);
    }
    var links = Array.from(document.querySelectorAll('.app-nav-link'));
    links.forEach(function (link) {
      if (link.querySelector('svg')) return;
      var icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      icon.setAttribute('viewBox', '0 0 24 24'); icon.setAttribute('fill', 'none');
      icon.setAttribute('stroke', 'currentColor'); icon.setAttribute('stroke-width', '1.7'); icon.setAttribute('aria-hidden', 'true');
      var shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      shape.setAttribute('d', 'M4 4h16v16H4zM8 9h8M8 13h8M8 17h5');
      icon.appendChild(shape); link.insertBefore(icon, link.firstChild);
    });
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
      markActive(['cost','ga4','experiments','display','detail','changes','search'].indexOf(page) >= 0 ? page : 'overview');
      body.classList.add('app-route-ready');
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initializeShell, { once: true });
  else initializeShell();
})();

/* Read-only Meta spending strip shared by every workspace page and route.
   Unlike advertising attribution metrics, these are raw spending totals. */
(function(){
 'use strict';
 const keys=['spend','smartstoreSpend','mallSpend','gfaSpend','searchSpend'];
 const labels=Object.freeze({
  spend:'총 광고비',
  smartstoreSpend:'스마트스토어 협력 메타 광고비',
  mallSpend:'자사몰 메타 광고비',gfaSpend:'GFA 광고비',searchSpend:'검색광고 (네이버쇼핑 + 파워링크)'
 });
 const rangeKey='roas-meta-spend-period-v1',fmt=new Intl.NumberFormat('ko-KR',{maximumFractionDigits:0});
 let refreshToken=0,mainNode=null,root=null,heading=null,lastSnapshot=null;
 const validDate=date=>/^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(date+'T00:00:00Z'));
 const asKRW=value=>Number.isFinite(value)?fmt.format(value)+'원':'—';
 function storedPeriod(){try{const x=JSON.parse(localStorage.getItem(rangeKey)||'null');if(validDate(x?.since)&&validDate(x?.until)&&x.since<=x.until)return x;}catch{}return null;}
 function defaultPeriod(){
  const d=new Date(),end=[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
  d.setDate(d.getDate()-6);
  return {since:[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-'),until:end};
 }
 function selection(){
  const sinceField=document.getElementById('since'),untilField=document.getElementById('until');
  const from=sinceField?.value,to=untilField?.value,local=validDate(from)&&validDate(to)&&from<=to;
  const saved=storedPeriod();
  const range=local?{since:from,until:to}:saved||defaultPeriod();
  if(local)try{localStorage.setItem(rangeKey,JSON.stringify(range));}catch{}
  let fx=Number(document.getElementById('fx-rate')?.value);
  if(!Number.isFinite(fx)||fx<=0){try{fx=Number(localStorage.getItem('roas-meta-spend-fx-v1'));}catch{}}
  if(!Number.isFinite(fx)||fx<=0)fx=1350;
  // Retain one selected exchange rate across workspace pages.
  if(document.getElementById('fx-rate'))try{localStorage.setItem('roas-meta-spend-fx-v1',String(fx));}catch{}
  let accounts={naver:'',cafe:''};
  try{
   const raw=JSON.parse(localStorage.getItem('roas-account-ids')||'{}')||{};
   accounts={naver:String(raw.naver||'').replace(/^act_/,''),cafe:String(raw.cafe||'').replace(/^act_/,'')};
  }catch{}
  return {...range,fx,accounts};
 }
 function ensure(){
  mainNode=document.getElementById('app-main');if(!mainNode)return false;
  const header=mainNode.querySelector('.app-page-head')||mainNode.firstElementChild;
  if(!header)return false;
  root=document.getElementById('ad-spend-breakdown');
  heading=mainNode.querySelector('.ad-spend-heading');
  if(!heading){heading=document.createElement('div');heading.className='ad-spend-heading';const h=document.createElement('h2');h.id='ad-spend-heading';h.textContent='광고비 구분';const note=document.createElement('p');note.id='ad-spend-note';note.className='small';heading.append(h,note);}
  if(!root){root=document.createElement('section');root.id='ad-spend-breakdown';root.className='metrics';root.setAttribute('aria-labelledby','ad-spend-heading');root.setAttribute('aria-live','polite');}
  // Overview already has this block in its chosen reading order after the
  // date/filter toolbar. Moving it to the header caused an unexpected layout
  // jump and collided with the page-specific grid rules.
  const spendHost=mainNode.querySelector('[data-ad-spend-host]');
  const existingPair=heading.parentElement===mainNode&&root.parentElement===mainNode&&root.previousElementSibling===heading;
  if(spendHost){
   if(heading.parentElement!==spendHost)spendHost.append(heading);
   if(root.parentElement!==spendHost)spendHost.append(root);
  }else if(!existingPair){
   if(heading.previousElementSibling!==header)header.after(heading);
   if(root.previousElementSibling!==heading)heading.after(root);
  }
  root.dataset.sharedSpendRoot='yes';
  return true;
 }
 function draw(data,range){
  if(!root)return;
  const note=document.getElementById('ad-spend-note');
  if(note)note.textContent='조회 기간 '+range.since+' ~ '+range.until+' · '+(data?.explanation||'광고비 데이터 조회 중…');
  root.replaceChildren();
  const metric=data?.scopes?.spend;
  const card=document.createElement('article');card.className='roas-spend-rollup';card.dataset.spendKey='spend';
  const trigger=document.createElement('button');trigger.className='roas-spend-rollup-trigger';trigger.type='button';
  trigger.setAttribute('aria-expanded','false');trigger.setAttribute('aria-controls','roas-spend-popover');
  const heading=document.createElement('small');heading.textContent='총 광고비';heading.className='roas-shared-spend-title';
  const money=document.createElement('strong');money.textContent=asKRW(metric?.value);money.className='roas-spend-total';
  const hint=document.createElement('small');hint.textContent='마우스를 올리거나 클릭해 내역 보기';hint.className='roas-spend-rollup-hint';
  trigger.append(heading,money,hint);
  if(metric?.partial){const partial=document.createElement('small');partial.textContent='확인분 · 일부 항목 미확인';trigger.append(partial);}
  const panel=document.createElement('div');panel.id='roas-spend-popover';panel.className='roas-spend-popover';panel.setAttribute('aria-label','광고비 상세 내역');
  for(const key of keys){
   const detail=data?.scopes?.[key];
   const line=document.createElement('div');line.className='roas-spend-line';line.dataset.spendLine=key;
   const name=document.createElement('span');name.textContent=labels[key];name.className='roas-spend-line-label';
   const amount=document.createElement('strong');amount.textContent=asKRW(detail?.value);amount.className='roas-spend-line-amount';
   const status=document.createElement('small');status.textContent=detail?.detail||'미확인';status.className='roas-spend-line-status';
   line.append(name,amount,status);panel.append(line);
  }
  const setOpen=open=>{card.classList.toggle('is-open',open);trigger.setAttribute('aria-expanded',String(open));};
  trigger.onclick=()=>setOpen(!card.classList.contains('is-open'));
  trigger.onkeydown=e=>{if(e.key==='Escape'){setOpen(false);e.stopPropagation();}};
  card.append(trigger,panel);root.append(card);
 }
 async function refresh(){
  if(!ensure())return;
  const request=++refreshToken,range=selection();
  lastSnapshot=null;
  if((Date.parse(range.until)-Date.parse(range.since))/86400000>731){draw(null,range);document.getElementById('ad-spend-note').textContent='조회 기간이 732일을 초과합니다.';return;}
  if(!root.querySelector('[data-spend-key]'))draw(null,range);
  root.setAttribute('aria-busy','true');
  try{
   const q=new URLSearchParams({since:range.since,until:range.until,naver:range.accounts.naver,cafe:range.accounts.cafe,fx:String(range.fx)});
   const response=await fetch('/api/meta/spend/summary?'+q,{cache:'no-store',signal:AbortSignal.timeout(25000)});
   const result=await response.json();
   if(!response.ok||!result.scopes)throw Error(result.error||'Meta 광고비 응답 확인 필요');
   if(request===refreshToken){
    lastSnapshot={...range,scopes:result.scopes};
    draw(result,range);root.setAttribute('aria-busy','false');
    window.dispatchEvent(new Event('roas:meta-spend-ready'));
   }
  }catch(error){
   if(request===refreshToken){draw(null,range);const note=document.getElementById('ad-spend-note');if(note)note.textContent=range.since+' ~ '+range.until+' · 광고비 확인 실패: '+error.message;root.setAttribute('aria-busy','false');}
  }
 }
 function requestRefresh(){}
 window.ROASMetaSpend=Object.freeze({labels,refresh:requestRefresh,getSnapshot:()=>lastSnapshot});
 function init(){
  // The fixed advertising-spend strip was removed from every workspace.
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
