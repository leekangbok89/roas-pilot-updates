(function(){
 'use strict';
 const $=id=>document.getElementById('other-cost-'+id);
 if(!$('form'))return;
 const numeric=['unitCost','quantity','delivery','fee','extra'],textFields=['date','title','recipient','product','memo'];
 const money=n=>Number(n||0).toLocaleString('ko-KR')+'원';
 const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 let saved={revision:0,entries:[]},editingId=null,busy=false,ready=false,catalog=[];
 const status=(text,error=false)=>{$('status').textContent=text;$('status').dataset.error=String(error);};
 const payload=()=>Object.fromEntries([...textFields.map(key=>[key,$(key).value]),...numeric.map(key=>[key,Number($(key).value)])]);
 function preview(){const p=payload(),amount=p.unitCost*p.quantity+p.delivery+p.fee+p.extra;$('preview').textContent=Number.isFinite(amount)?money(amount):'금액 확인 필요';}
 function lock(value){busy=value;for(const id of ['save','cancel','reload'])$(id).disabled=value||(id==='save'&&!ready);render();}
 async function api(method='GET',input){
  const response=await fetch('/api/costs/other-ad-costs',{method,cache:'no-store',headers:{'Content-Type':'application/json','x-roas-local-action':'yes'},...(input?{body:JSON.stringify(input)}:{})});
  const result=await response.json();if(!response.ok)throw Error(result.error||'기타 광고비 요청 실패');return result;
 }
 function reset(){editingId=null;$('form').reset();$('date').value=today();$('save').textContent='기타 광고비 저장';$('cancel').hidden=true;preview();}
 function render(){
  const from=$('from').value,until=$('until').value,invalid=from&&until&&from>until;
  const rows=invalid?[]:saved.entries.filter(entry=>(!from||entry.date>=from)&&(!until||entry.date<=until));
  $('total').textContent=money(rows.reduce((sum,entry)=>sum+entry.amount,0));$('count').textContent=invalid?'조회 날짜를 확인하세요.':rows.length+'건 · 발생일 기준';
  const root=$('list');root.replaceChildren();
  if(!rows.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=9;td.className='empty';td.textContent=ready?'조회 기간에 등록한 기타 광고비가 없습니다.':'목록을 불러오는 중입니다.';tr.append(td);root.append(tr);}
  for(const entry of rows){
   const tr=document.createElement('tr');
   for(const value of [entry.date,entry.title+(entry.recipient?' / '+entry.recipient:''),entry.product||'—',money(entry.unitCost)+' × '+entry.quantity,money(entry.delivery),money(entry.fee),money(entry.extra),money(entry.amount)]){const td=document.createElement('td');td.textContent=value;tr.append(td);}
   const actions=document.createElement('td'),memo=document.createElement('small');memo.textContent=entry.memo||'';actions.append(memo);
   const edit=document.createElement('button');edit.type='button';edit.textContent='수정';edit.disabled=busy;
   edit.onclick=()=>{editingId=entry.id;for(const key of [...textFields,...numeric])$(key).value=entry[key]??'';$('source').value='';$('save').textContent='수정 저장';$('cancel').hidden=false;preview();$('title').focus();status('수정 중 · 저장을 눌러 반영하세요.');};
   const remove=document.createElement('button');remove.type='button';remove.textContent='삭제';remove.disabled=busy;
   remove.onclick=async()=>{if(busy||!confirm(entry.date+' '+entry.title+' ('+money(entry.amount)+')을 삭제할까요?'))return;lock(true);try{saved=await api('DELETE',{id:entry.id,revision:saved.revision});if(editingId===entry.id)reset();status('삭제 완료 · 총 광고비와 예상 이익에 반영됩니다.');}catch(error){status(error.message,true);}finally{lock(false);}};
   actions.append(edit,remove);tr.append(actions);root.append(tr);
  }
 }
 async function load(){if(busy)return;lock(true);try{saved=await api();ready=true;status('기타 광고비 '+saved.entries.length+'건 불러오기 완료');}catch(error){status(error.message,true);}finally{lock(false);}}
 async function loadCatalog(){
  try{const response=await fetch('/api/costs/products',{cache:'no-store'});if(!response.ok)return;const data=await response.json();catalog=(data.items||[]).filter(row=>row.scope==='wemamang'&&Number.isFinite(row.effectiveCost??row.cost));
   $('source').replaceChildren(new Option('직접 입력',''));catalog.forEach((row,index)=>$('source').add(new Option((row.channel==='naver'?'스마트스토어':'카페24')+' · '+row.name+' / '+(row.option||'기본 옵션')+' · '+money(row.effectiveCost??row.cost),String(index))));
  }catch{/* Direct entry remains available when the sales catalog is unavailable. */}
 }
 $('source').onchange=()=>{if($('source').value==='')return;const row=catalog[Number($('source').value)];if(!row)return;$('product').value=row.name+(row.option?' / '+row.option:'');$('unitCost').value=row.effectiveCost??row.cost;preview();};
 $('form').oninput=preview;
 $('form').onsubmit=async event=>{event.preventDefault();if(busy||!ready)return;lock(true);try{saved=await api('POST',{...payload(),...(editingId?{id:editingId}:{}),revision:saved.revision});reset();status('저장 완료 · 총 광고비와 예상 이익에 반영됩니다. 한눈에 보기에서 다시 조회하세요.');}catch(error){status(error.message,true);}finally{lock(false);}};
 $('cancel').onclick=()=>{reset();status('수정을 취소했습니다.');};
 $('from').onchange=render;$('until').onchange=render;$('all').onclick=()=>{$('from').value='';$('until').value='';render();};
 $('reload').onclick=()=>{load();loadCatalog();};reset();load();loadCatalog();
})();
