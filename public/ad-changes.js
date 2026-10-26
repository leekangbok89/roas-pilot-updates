(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const fields = ['date','channel','account','level','entityId','entityName','kind','before','after','note','windowDays'];
  const channelNames = {'meta-naver':'메타 → 네이버 스마트스토어','meta-cafe':'메타 → 카페24 자사몰','meta-other':'메타 → 기타','naver-search':'네이버 검색광고','naver-display':'네이버 디스플레이(GFA)',other:'기타 / 이전 기록'};
  const levelNames = {account:'계정 전체',campaign:'캠페인',adset:'광고세트',ad:'광고',unlinked:'미연결 메모'};
  const safe = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt = n => n == null ? '—' : Number(n).toLocaleString('ko-KR',{maximumFractionDigits:2});
  const today = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const shift = (date,n) => new Date(Date.parse(date+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
  let entries = [], editing = null, targets = [], selectedReport = null, reportSequence = 0, targetSequence = 0, parents = {};
  let accounts = {};
  try { accounts = JSON.parse(localStorage.getItem('roas-account-ids') || '{}') || {}; } catch (_) {}
  async function api(url, data, method = 'POST') {
    const resp = await fetch(url, data === undefined ? {credentials:'same-origin'} : {method,credentials:'same-origin',headers:{'Content-Type':'application/json','X-ROAS-Local-Action':'yes'},body:JSON.stringify(data)});
    let value; try { value = await resp.json(); } catch (_) { throw Error('서버 응답을 확인할 수 없습니다.'); }
    if (!resp.ok) throw Error(value.error || '요청 실패');
    return value;
  }
  function status(message, error = false) { $('status').textContent = message; $('status').classList.toggle('error', error); }
  function clearTargets() { targetSequence++; targets=[]; parents={}; $('target').replaceChildren(new Option('직접 입력 또는 저장된 광고에서 선택','')); $('target-status').textContent=''; }
  function linkedAccount() {
    const key = $('channel').value === 'meta-naver' ? 'naver' : $('channel').value === 'meta-cafe' ? 'cafe' : '';
    $('account').value = String(accounts[key] || '').replace(/^act_/, '');
  }
  function updateChannelControls() {
    const meta = $('channel').value.startsWith('meta-');
    $('meta-picker').hidden = !meta;
    $('load-targets').disabled = !meta;
    $('target').disabled = !meta;
    $('account').placeholder = meta ? '선택 입력 · 설정에 등록된 Meta 계정 자동 입력' : '선택 입력 · 비워두어도 저장됩니다';
    $('entityId').placeholder = meta ? '선택 입력 · 불러온 광고를 선택하면 자동 입력' : '선택 입력 · 비워두어도 저장됩니다';
  }
  function reset() {
    $('entry-form').reset(); editing=null;parents={};$('date').value=today;linkedAccount();clearTargets();updateChannelControls();
    $('form-title').textContent='변경사항 추가';$('save').textContent='기록 저장';
  }
  function render() {
    const from=$('filter-from').value,to=$('filter-to').value,channel=$('filter-channel').value,q=$('search').value.trim().toLowerCase();
    if(from&&to&&from>to){$('entries').innerHTML='<tr><td colspan="5">필터 시작일과 종료일을 확인하세요.</td></tr>';$('count').textContent='';return;}
    const found=entries.filter(e=>(!from||e.date>=from)&&(!to||e.date<=to)&&(!channel||e.channel===channel)&&(!q||[e.account,e.entityId,e.entityName,e.kind,e.before,e.after,e.note].join(' ').toLowerCase().includes(q)));
    $('count').textContent='· '+found.length+' / '+entries.length+'건';
    $('entries').innerHTML=found.map(e=>'<tr data-id="'+safe(e.id)+'"><td>'+safe(e.date)+(e.date>today?'<br><span class="tag">예정</span>':'')+'</td><td>'+safe(channelNames[e.channel])+'<br><strong>'+safe(e.entityName||levelNames[e.level])+'</strong><br><small>'+safe(levelNames[e.level])+(e.entityId?' · '+safe(e.entityId):'')+'</small></td><td><span class="tag">'+safe(e.kind)+'</span><p>'+safe(e.before||'미기록')+' → <span class="changed">'+safe(e.after||'미기록')+'</span></p></td><td class="preserve">'+safe(e.note||'—')+'</td><td><div class="actions"><button type="button" data-action="compare">성과 보기</button><button type="button" data-action="edit">수정</button><button type="button" data-action="delete">삭제</button></div></td></tr>').join('')||'<tr><td colspan="5">'+(entries.length?'조건에 맞는 기록이 없습니다.':'아직 기록이 없습니다. 변경일과 변경 내용을 입력해 첫 기록을 남겨보세요.')+'</td></tr>';
  }
  async function load() {
    const value=await api('/api/ad-changes'); entries=value.entries;render();
  }
  function edit(entry) {
    reset();editing=entry;
    for(const f of fields)$(f).value=entry[f]??'';
    updateChannelControls();
    parents={campaignId:entry.campaignId,adsetId:entry.adsetId};
    $('form-title').textContent='변경 기록 수정';$('save').textContent='수정 저장';$('date').focus();$('entry-form').scrollIntoView({behavior:'smooth',block:'start'});
  }
  async function showReport(id, scroll = true) {
    const sequence=++reportSequence;selectedReport=id;$('comparison').hidden=false;$('report-body').replaceChildren();$('report-status').textContent='저장 성과를 불러오는 중입니다.';
    if(scroll)$('comparison').scrollIntoView({behavior:'smooth',block:'start'});
    try {
      const r=await api('/api/ad-changes/report?id='+encodeURIComponent(id));if(sequence!==reportSequence)return;
      $('comparison-title').textContent=r.entry.date+' · '+(r.entry.entityName||levelNames[r.entry.level])+' · 변경 전후 성과';
      $('report-status').textContent=r.status+' · 변경 당일 제외, 전후 각 '+r.entry.windowDays+'일';
      let html='<p>변경 전 '+safe(r.window.before.since)+' ~ '+safe(r.window.before.until)+' / 변경 후 '+safe(r.window.after.since)+' ~ '+safe(r.window.after.until)+'</p>';
      if(r.before&&r.after){
        html+='<p>완료된 날짜의 저장 자료: 전 '+r.before.storedDays+'/'+r.before.days+'일 · 후 '+r.after.storedDays+'/'+r.after.days+'일 · 통화 '+safe(r.before.currency||'미확인')+' / '+safe(r.after.currency||'미확인')+'</p>';
        const metrics=[['spend','광고비',''],['purchases','구매','건'],['revenue','Meta 구매매출',''],['roas','구매 ROAS','%'],['cpa','구매 CPA',''],['cpc','링크 CPC',''],['ctr','링크 CTR','%']];
        html+='<div class="scroll"><table class="comparison-metrics"><thead><tr><th>지표 (원본 계정 통화)</th><th>변경 전'+(!r.before.complete?' · 일부 기간':'')+'</th><th>변경 후'+(!r.after.complete?' · 일부 기간':'')+'</th><th>변화</th></tr></thead><tbody>'+metrics.map(([key,name,unit])=>{const d=r.deltas?.[key];return '<tr><td>'+name+'</td><td>'+fmt(r.before.metrics[key])+unit+'</td><td>'+fmt(r.after.metrics[key])+unit+'</td><td>'+(d==null?'—':(d>0?'+':'')+fmt(d)+(key==='roas'||key==='ctr'?'%p':unit))+'</td></tr>';}).join('')+'</tbody></table></div>';
        const gaps=[['변경 전 누락일',r.before.missingDays],['변경 후 누락일',r.after.missingDays],['오늘·미래 날짜',r.after.pendingDays]];
        for(const [label,days] of gaps)if(days.length)html+='<p>'+label+': '+safe(days.join(', '))+'</p>';
      }
      if(r.notes?.length)html+='<div class="notice">'+r.notes.map(safe).join('<br>')+'</div>';
      if(r.conflicts?.length)html+='<p>겹치는 변경: '+r.conflicts.map(e=>safe(e.date+' '+e.kind)).join(' / ')+'</p>';
      html+='<p class="helper">성과 차이만으로 가장 좋은 광고나 변경의 효과를 확정하지 않습니다. 분석자료에 변경 이력·누락일·일별 수치를 함께 포함합니다.</p>';
      $('report-body').innerHTML=html;
    }catch(e){if(sequence===reportSequence)$('report-status').textContent='조회 실패: '+e.message;}
  }
  $('entry-form').addEventListener('submit',async event=>{
    event.preventDefault();const data=Object.fromEntries(fields.map(f=>[f,$(f).value]));
    const input={...data,...parents,...(editing?{id:editing.id,revision:editing.revision}:{})};
    $('save').disabled=true;
    try{await api('/api/ad-changes',input);reset();await load();status('변경 기록을 저장했습니다.');if(selectedReport)await showReport(selectedReport,false);}
    catch(e){status('저장 실패: '+e.message,true);}finally{$('save').disabled=false;}
  });
  $('cancel').addEventListener('click',reset);
  $('channel').addEventListener('change',()=>{linkedAccount();clearTargets();updateChannelControls();$('entityId').value='';$('entityName').value='';});
  $('account').addEventListener('input',()=>{clearTargets();$('entityId').value='';});
  $('level').addEventListener('change',()=>{clearTargets();$('entityId').value='';$('entityName').value='';});
  $('entityId').addEventListener('input',()=>{parents={};$('target').value='';});
  $('date').addEventListener('change',clearTargets);
  $('load-targets').addEventListener('click',async()=>{
    const account=$('account').value.trim().replace(/^act_/,''),date=$('date').value,level=$('level').value;
    if(!$('channel').value.startsWith('meta-')||!/^\d{5,30}$/.test(account)||!date||!['campaign','adset','ad'].includes(level)){$('target-status').textContent='Meta 광고 계정 ID와 변경일, 캠페인·광고세트·광고 구분을 선택하세요.';return;}
    clearTargets();const sequence=targetSequence;$('load-targets').disabled=true;$('target-status').textContent='저장된 광고를 읽는 중입니다.';
    try{
      const until=date<today?date:today,since=shift(until,-59);
      const value=await api('/api/insights?'+new URLSearchParams({account,since,until,cacheOnly:'1'}));if(sequence!==targetSequence)return;
      const map=new Map();for(const r of value.rows||[]){const id=r[level+'_id'];if(id)map.set(String(id),{id:String(id),name:r[level+'_name']||String(id),campaignId:r.campaign_id||'',adsetId:r.adset_id||''});}
      targets=[...map.values()].sort((a,b)=>a.name.localeCompare(b.name));
      targets.forEach((t,i)=>$('target').add(new Option(t.name+' · '+t.id,String(i))));
      $('target-status').textContent=targets.length?targets.length+'개 대상 · 변경일 기준 최근 60일 저장 자료':'저장된 대상이 없습니다. 이름과 ID를 직접 입력할 수 있습니다.';
    }catch(e){if(sequence===targetSequence)$('target-status').textContent='불러오기 실패: '+e.message;}finally{$('load-targets').disabled=false;}
  });
  $('target').addEventListener('change',()=>{const t=targets[$('target').value];if(!t)return;$('entityId').value=t.id;$('entityName').value=t.name;parents={campaignId:t.campaignId,adsetId:t.adsetId};});
  $('entries').addEventListener('click',async event=>{
    const button=event.target.closest('[data-action]'),row=button?.closest('[data-id]');if(!row)return;
    const entry=entries.find(e=>e.id===row.dataset.id);if(!entry)return;
    if(button.dataset.action==='edit')return edit(entry);
    if(button.dataset.action==='compare')return showReport(entry.id);
    if(!confirm(entry.date+' '+(entry.entityName||levelNames[entry.level])+' 기록을 삭제할까요?'))return;
    button.disabled=true;
    try{await api('/api/ad-changes',{id:entry.id,revision:entry.revision},'DELETE');if(editing?.id===entry.id)reset();if(selectedReport===entry.id){selectedReport=null;reportSequence++;$('comparison').hidden=true;}await load();status('기록을 삭제했습니다.');}catch(e){status('삭제 실패: '+e.message,true);button.disabled=false;}
  });
  for(const id of ['filter-from','filter-to','filter-channel','search'])$(id).addEventListener('input',render);
  $('clear-filter').addEventListener('click',()=>{for(const id of ['filter-from','filter-to','filter-channel','search'])$(id).value='';render();});
  $('refresh').addEventListener('click',async()=>{try{await load();status('기록을 새로 불러왔습니다.');if(selectedReport)await showReport(selectedReport,false);}catch(e){status(e.message,true);}});
  $('export').addEventListener('click',async()=>{
    $('export').disabled=true;try{const report=await api('/api/ad-changes/export');const blob=new Blob([JSON.stringify(report,null,2)],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='ROAS-Pilot-ad-changes-'+today+'.json';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);status('전체 변경 이력과 전후 성과를 내보냈습니다. 분석을 요청할 때 이 파일을 첨부하세요.');}catch(e){status('내보내기 실패: '+e.message,true);}finally{$('export').disabled=false;}
  });
  async function initialize(){
    reset();try{
      await load();let legacy=[];try{const v=JSON.parse(localStorage.getItem('roas-pilot-changelog-v1')||'[]');if(Array.isArray(v))legacy=v;}catch(_){}
      if(legacy.length){try{const result=await api('/api/ad-changes/import-legacy',{items:legacy});entries=result.entries;render();status('저장된 기록 '+entries.length+'건 · 이전 브라우저 메모 '+result.imported+'건을 가져왔습니다. 가져온 기록의 채널과 광고 ID를 수정해 연결하세요.');}catch(e){status('이전 메모 가져오기 실패: '+e.message+' · 기존 메모는 브라우저에 보존돼 있습니다.',true);}}
      else status('저장된 기록 '+entries.length+'건 · 날짜와 변경 내용을 입력하세요.');
    }catch(e){status('불러오기 실패: '+e.message,true);}
  }
  initialize();
})();
