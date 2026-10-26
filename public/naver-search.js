(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  let scopeReady = false, scopeKey = '', reportScope = '';
  let configured = false, busy = false, enabled = true, lastLoaded = 0, reportCustomer = '';
  const kstDate = time => new Date(time + 9 * 3600000).toISOString().slice(0, 10);
  const fmt = x => x == null ? '미확인' : Number(x).toLocaleString('ko-KR', { maximumFractionDigits: 2 });
  const won = x => x == null ? '미확인' : Math.round(x).toLocaleString('ko-KR') + '원';
  const pct = x => x == null ? '—' : fmt(x) + '%';
  const time = x => x ? new Date(x).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '아직 없음';
  function message(text, tone = 'info') { $('search-message').textContent = text; $('search-message').dataset.tone = tone; $('search-message').hidden = !text; }
  function setBusy(value) {
    busy = value;
    document.querySelectorAll('#search-connect input,#search-connect button,#search-scope-form input,#search-scope-form button,#search-query input,#search-query button,#search-auto,#search-test,#search-disconnect').forEach(el => { el.disabled = value; });
    ['search-test', 'search-disconnect', 'search-scope-reload', 'search-scope-save'].forEach(id => { $(id).disabled = value || !configured; });
    ['search-load', 'search-refresh'].forEach(id => { $(id).disabled = value || !configured || !scopeReady; });
    $('search-report').setAttribute('aria-busy', String(value));
  }
  async function request(url, body) {
    let response;
    try { response = await fetch(url, { method: body === undefined ? 'GET' : 'POST', cache: 'no-store', headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'X-ROAS-Local-Action': 'yes' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }
    catch { throw Error('로컬 프로그램 서버에 연결하지 못했습니다. ROAS Pilot이 실행 중인지 확인해 주세요.'); }
    let value;
    try { value = await response.json(); } catch { throw Error('프로그램 응답을 읽을 수 없습니다. 업데이트 후 새로고침해 주세요.'); }
    if (!response.ok) throw Error(value.error || '요청 실패 (HTTP ' + response.status + ')');
    return value;
  }
  async function status() {
    const value = await request('/api/naver-search/status');
    configured = value.configured; enabled = value.enabled; scopeReady = value.scopeConfigured === true; scopeKey = value.scopeKey || '';
    $('search-scope-status').textContent = scopeReady ? '저장된 선택 ' + value.scopeCampaignIds.length + '개' : '위마망 캠페인 선택 필요';
    if (!scopeReady) $('search-scope').open = true;
    $('search-badge').textContent = configured ? '연결됨 · 고객 ' + value.customerId : value.unreadable ? '저장된 연결 확인 필요' : '연결 전';
    $('search-identity').textContent = configured ? '고객 ID ' + value.customerId : '';
    if (!busy) { $('search-auto').checked = enabled; setBusy(false); }
    $('search-sync').textContent = value.running ? '수집 중 · ' + (value.progress || '조회 준비 중') : (configured ? '최근 수집: ' + time(value.lastSuccessAt) + (enabled ? ' · 다음 자동 점검: ' + time(value.nextAutomaticAt) : ' · 자동 갱신 꺼짐') : value.unreadable ? '저장된 연결을 읽지 못했습니다. 같은 Windows 사용자로 실행하거나 다시 등록해 주세요.' : '연결 후 자동 갱신을 시작합니다.');
    if (configured && !scopeReady) $('search-sync').textContent = '위마망 캠페인을 먼저 선택하고 저장해 주세요. 자동 수집은 선택 전까지 대기합니다.';
    if (value.error) $('search-sync').textContent += '\n최근 오류: ' + value.error;
    if (reportCustomer && (reportCustomer !== value.customerId || !scopeReady || reportScope !== scopeKey)) { $('search-report').hidden = true; $('search-empty').hidden = false; reportCustomer = ''; }
    return value;
  }
  function dates(days) { const end = Date.now(); $('search-until').value = kstDate(end); $('search-since').value = kstDate(end - (days - 1) * 86400000); }
  function cells(row, first, detail) {
    const tr = document.createElement('tr'), td = document.createElement('td');
    td.textContent = first;
    if (detail) { const small = document.createElement('small'); small.textContent = detail; td.appendChild(small); }
    tr.appendChild(td);
    for (const text of [won(row.spend), fmt(row.purchases), won(row.purchaseRevenue), pct(row.purchaseRoas), fmt(row.impressions), fmt(row.clicks), pct(row.ctr), won(row.cpc), won(row.cpm)]) { const cell = document.createElement('td'); cell.textContent = text; tr.appendChild(cell); }
    return tr;
  }
  function render(value) {
    if (!scopeReady || value.scopeKey !== scopeKey) throw Error('집계 범위가 변경되었습니다. 위마망 캠페인 선택을 확인하고 다시 조회해 주세요.');
    reportScope = value.scopeKey;
    reportCustomer = value.customerId; lastLoaded = Date.now();
    $('search-empty').hidden = true; $('search-report').hidden = false;
    $('search-period').textContent = value.since + ' ~ ' + value.until;
    $('search-fetched').textContent = '수집: ' + time(value.fetchedAt) + (value.stale ? ' · 이전 저장 자료' : value.cached ? ' · 저장 자료' : ' · API 갱신');
    const s = value.summary;
    $('search-metrics').replaceChildren();
    for (const [label, text] of [['광고비 · VAT 포함', won(s.spend)], ['구매완료', fmt(s.purchases)], ['구매완료 매출', won(s.purchaseRevenue)], ['구매 ROAS', pct(s.purchaseRoas)]]) {
      const card = document.createElement('div'); card.className = 'search-metric';
      const title = document.createElement('small'); title.textContent = label;
      const strong = document.createElement('strong'); strong.textContent = text;
      card.append(title, strong); $('search-metrics').appendChild(card);
    }
    $('search-campaigns').replaceChildren(...value.campaigns.map(row => cells(row, row.name, [row.type, row.id, row.status].filter(Boolean).join(' · '))));
    $('search-daily').replaceChildren(...value.daily.map(row => cells(row, row.date)));
    for (const id of ['search-campaigns', 'search-daily']) if (!$(id).children.length) { const tr = document.createElement('tr'), td = document.createElement('td'); td.colSpan = 10; td.textContent = '선택 기간에 반환된 성과가 없습니다.'; tr.appendChild(td); $(id).appendChild(tr); }
    $('search-warnings').replaceChildren(...value.warnings.map(text => { const li = document.createElement('li'); li.textContent = text; return li; }));
    const notice = value.refreshError ? '갱신 실패: ' + value.refreshError + '\n위 수치는 ' + time(value.fetchedAt) + '에 저장된 자료입니다.' : value.noData ? '선택 기간에 반환된 성과가 없습니다. 캠페인 운영 기간과 API 지원 범위를 확인해 주세요.' : value.stale ? '이전에 저장한 자료입니다. 새로 가져오기를 누르면 API로 갱신합니다.' : '';
    $('search-report-notice').textContent = notice; $('search-report-notice').hidden = !notice; $('search-report-notice').dataset.tone = 'warning';
  }
  async function load(refresh, cacheOnly = false) {
    if (busy || !configured || !scopeReady) return;
    setBusy(true); message(cacheOnly ? '저장 자료를 불러오는 중…' : '캠페인별 성과 조회 중…');
    const query = new URLSearchParams({ since: $('search-since').value, until: $('search-until').value, refresh: refresh ? '1' : '0', cacheOnly: cacheOnly ? '1' : '0' });
    try { const value = await request('/api/naver-search/report?' + query); render(value); message(value.refreshError ? '갱신에 실패하여 이전 저장 자료를 표시합니다.' : '성과 조회 완료', value.refreshError ? 'warning' : 'info'); }
    catch (error) { message(error.message, 'error'); }
    finally { setBusy(false); status().catch(() => {}); }
  }
  async function loadScope() {
    if (busy || !configured) return;
    setBusy(true);
    try {
      const value = await request('/api/naver-search/campaigns');
      $('search-scope-options').replaceChildren(...value.campaigns.map(row => {
        const label = document.createElement('label'), input = document.createElement('input'), text = document.createElement('span');
        input.type = 'checkbox'; input.value = row.id; input.name = 'campaignId'; input.checked = value.campaignIds.includes(row.id);
        text.textContent = row.name + ' · ' + row.type + ' · ' + row.id;
        label.append(input, text); return label;
      }));
      if (!value.campaigns.length) $('search-scope-options').textContent = '이 계정에서 선택할 캠페인이 없습니다.';
    } catch (error) { message(error.message, 'error'); }
    finally { setBusy(false); }
  }
  $('search-scope-reload').addEventListener('click', loadScope);
  $('search-scope-form').addEventListener('submit', async event => {
    event.preventDefault(); if (busy || !configured) return;
    const campaignIds = Array.from(document.querySelectorAll('#search-scope-options input:checked')).map(input => input.value);
    if (!campaignIds.length) { message('위마망 캠페인을 한 개 이상 선택해 주세요.', 'error'); return; }
    setBusy(true);
    let saved = false;
    try {
      await request('/api/naver-search/scope', { campaignIds });
      $('search-report').hidden = true; reportCustomer = ''; reportScope = '';
      await status(); $('search-scope').open = false; saved = true;
      message('위마망 캠페인 ' + campaignIds.length + '개를 집계 대상으로 저장했습니다.');
    } catch (error) { message(error.message, 'error'); }
    finally { setBusy(false); }
    if (saved) await load(false);
  });
  $('search-connect').addEventListener('submit', async event => {
    event.preventDefault(); if (busy) return;
    const input = { customerId: $('search-customer').value.trim(), apiKey: $('search-key').value.trim(), secretKey: $('search-secret').value.trim(), enabled: $('search-auto').checked };
    setBusy(true); message('네이버 연결 확인 후 암호화 저장 중…');
    let saved = false;
    try {
      const value = await request('/api/naver-search/credentials', input);
      configured = true; saved = true; $('search-key').value = ''; $('search-secret').value = '';
      $('search-report').hidden = true; reportCustomer = ''; $('search-connection').open = false;
      message('연결 완료 · ' + value.campaignCount + '개 캠페인 확인');
    } catch (error) { $('search-key').value = ''; $('search-secret').value = ''; message(error.message, 'error'); }
    finally { setBusy(false); }
    if (saved) { try { await status(); await loadScope(); if (scopeReady) await load(false); } catch (error) { message(error.message, 'error'); } }
  });
  $('search-test').addEventListener('click', async () => {
    if (busy) return; setBusy(true); message('저장된 연결 테스트 중…');
    try { const value = await request('/api/naver-search/test', {}); message('연결 성공 · ' + value.campaignCount + '개 캠페인 확인'); }
    catch (error) { message(error.message, 'error'); } finally { setBusy(false); }
  });
  $('search-disconnect').addEventListener('click', async () => {
    if (busy || !confirm('이 PC에 저장한 검색광고 인증정보를 삭제하고 자동 갱신을 중지할까요?')) return;
    setBusy(true);
    try { await request('/api/naver-search/disconnect', {}); configured = false; reportCustomer = ''; $('search-report').hidden = true; $('search-empty').hidden = false; $('search-connection').open = true; $('search-connect').reset(); await status(); message('검색광고 연결을 해제했습니다.'); }
    catch (error) { message(error.message, 'error'); } finally { setBusy(false); }
  });
  $('search-auto').addEventListener('change', async () => {
    if (!configured) return;
    const next = $('search-auto').checked; setBusy(true);
    try { await request('/api/naver-search/settings', { enabled: next }); enabled = next; message(next ? '매시간 최근 7일 자동 갱신을 켰습니다.' : '자동 갱신을 껐습니다. 기간 조회는 계속 사용할 수 있습니다.'); }
    catch (error) { $('search-auto').checked = enabled; message(error.message, 'error'); }
    finally { setBusy(false); }
  });
  $('search-query').addEventListener('submit', event => { event.preventDefault(); load(false); });
  $('search-refresh').addEventListener('click', () => load(true));
  document.querySelectorAll('[data-search-days]').forEach(button => button.addEventListener('click', () => { if (busy) return; dates(Number(button.dataset.searchDays)); if (configured) load(false); }));
  dates(7); $('search-since').max = $('search-until').max = kstDate(Date.now());
  status().then(async value => { if (value.configured) { $('search-connection').open = false; await loadScope(); if (scopeReady) load(false); } }).catch(error => message(error.message, 'error'));
  setInterval(() => {
    if (busy || document.hidden) return;
    status().then(value => { if (value.configured && enabled && Date.now() - lastLoaded >= 3600000) load(false); }).catch(() => {});
  }, 60000);
})();
