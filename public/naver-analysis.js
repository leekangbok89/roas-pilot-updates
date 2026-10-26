(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const names = {powerlink:'네이버 파워링크',shopping:'네이버 쇼핑검색',gfa:'GFA 광고비'};
  const today = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  let state = null;
  async function api(method='GET',body) {
    const response = await fetch('/api/naver/ad-spend',{method,cache:'no-store',headers:{'Content-Type':'application/json','X-ROAS-Local-Action':'yes'},...(body?{body:JSON.stringify(body)}:{})});
    const result = await response.json();
    if(!response.ok)throw Error(result.error||'광고비 저장에 실패했습니다.');
    return result;
  }
  function message(text){$('cost-status').textContent=text;}
  function render(){
    $('cost-entries').replaceChildren();
    for(const entry of state.entries){
      const row=document.createElement('tr');
      for(const value of [entry.since+' ~ '+entry.until,names[entry.channel],entry.amount.toLocaleString('ko-KR')+'원',entry.since===entry.until?'일별 실제 입력':'기간 합계 균등 배분 · 추정']){
        const cell=document.createElement('td');cell.textContent=value;row.append(cell);
      }
      const actions=document.createElement('td'),edit=document.createElement('button'),remove=document.createElement('button');
      edit.type=remove.type='button';edit.className=remove.className='secondary';edit.textContent='수정';remove.textContent='삭제';
      edit.onclick=()=>{
        reset();$('cost-from').value=entry.since;$('cost-to').value=entry.until;$('cost-'+entry.channel).value=entry.amount;
        $('cost-'+entry.channel).focus();message('기존 기간과 금액을 불러왔습니다. 금액 수정 후 저장하세요. 기간 변경은 기존 내역 삭제 후 입력하세요.');
      };
      remove.onclick=async()=>{
        if(!confirm(entry.since+' ~ '+entry.until+' '+names[entry.channel]+' 광고비를 삭제할까요?'))return;
        remove.disabled=true;
        try{state=await api('DELETE',{id:entry.id,revision:state.revision});render();document.dispatchEvent(new Event('roas:meta-cache-updated'));message('광고비를 삭제하고 통계에 반영했습니다.');}
        catch(error){message(error.message);remove.disabled=false;}
      };
      actions.append(edit,' ',remove);row.append(actions);$('cost-entries').append(row);
    }
    if(!state.entries.length){const row=document.createElement('tr'),cell=document.createElement('td');cell.colSpan=5;cell.textContent='저장된 네이버 광고비가 없습니다.';row.append(cell);$('cost-entries').append(row);}
  }
  function reset(){for(const channel of Object.keys(names))$('cost-'+channel).value='';}
  async function save(since,until,amounts){
    if(!state)throw Error('저장 자료를 불러오지 못했습니다. 새로고침 후 다시 시도하세요.');
    state=await api('POST',{since,until,amounts,revision:state.revision});render();document.dispatchEvent(new Event('roas:meta-cache-updated'));
    message('저장 완료 · 총 광고비와 통합 예상 이익에 반영했습니다. 다른 화면에서는 새로고침해 주세요.');
  }
  $('cost-from').value=$('cost-to').value=today;
  $('cost-reset').onclick=reset;
  $('naver-cost-form').onsubmit=async event=>{
    event.preventDefault();const amounts={};
    for(const channel of Object.keys(names)){
      const value=$('cost-'+channel).value.replace(/,/g,'').trim();if(!value)continue;
      if(!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value))){message('광고비는 0 이상의 원 단위 숫자로 입력하세요.');$('cost-'+channel).focus();return;}
      amounts[channel]=Number(value);
    }
    if(!Object.keys(amounts).length){message('광고비를 한 항목 이상 입력하세요. 광고비가 없으면 0을 입력하세요.');return;}
    $('cost-save').disabled=true;
    try{await save($('cost-from').value,$('cost-to').value,amounts);}catch(error){message(error.message);}finally{$('cost-save').disabled=false;}
  };
  window.roasNaverSpend={saveGfa:async(since,until,amount)=>{
    $('cost-from').value=since;$('cost-to').value=until;reset();$('cost-gfa').value=amount;
    await save(since,until,{gfa:amount});
  }};
  api().then(value=>{state=value;render();message('기간과 광고비를 입력하세요. 저장된 광고비는 업데이트 후에도 유지됩니다.');}).catch(error=>message('불러오기 실패: '+error.message));
})();
