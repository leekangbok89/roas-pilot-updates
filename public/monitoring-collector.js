(function(){'use strict';
  const $=id=>document.getElementById(id),origin=location.origin,local=/^http:\/\/(127\.0\.0\.1|localhost):3000$/.test(origin),pending=new Set();let busy=false,extension=false,lastRunning=false,formTouched=false;
  const postHeaders={'Content-Type':'application/json','X-ROAS-Local-Action':'yes'};
  async function api(route,payload){const r=await fetch('/api/monitoring/collector/'+route,{cache:'no-store',...(payload===undefined?{}:{method:'POST',headers:postHeaders,body:JSON.stringify(payload)})}),result=await r.json();if(!r.ok)throw Error(result.error||'수집 연결 요청을 완료하지 못했습니다.');return result;}
  function error(message){$('mc-error').hidden=!message;$('mc-error').textContent=message||'';}
  function wake(){if(local)window.postMessage({source:'ROAS_MONITORING_LOCAL_UI',kind:'wake'},origin);}
  function render(s){$('mc-status').textContent=s.message||'수집 연결 대기';$('mc-progress').max=Math.max(s.total||0,1);$('mc-progress').value=s.completed||0;$('mc-count').textContent=(s.completed||0)+' / '+(s.total||0)+'개 화면 저장 확인'+(s.running?' · 진행 중':'');$('mc-last').textContent=s.lastSuccessAt?'마지막 저장 확인: '+new Date(s.lastSuccessAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}):'';const names={products:'상품 목록',keywords:'키워드 순위',reviews:'리뷰 본문',sales:'7일 구매 건수'},states={collected:'표시 자료 저장',empty:'원본에 자료 없음',extension_required:'셀하 확장프로그램 필요',unverified:'원본 확인 필요',not_supported:'원본 미지원',timeout:'표시 대기 시간 초과',blocked:'인증·접근 확인 필요',not_available:'원본 화면 없음'};$('mc-coverage').replaceChildren(...(s.sourceCoverage||[]).map(entry=>{const li=document.createElement('li');li.textContent=(names[entry.kind]||entry.kind)+': '+(states[entry.state]||entry.state)+(entry.records!==undefined?' · '+entry.records+'개 확인':'')+(entry.message?' — '+entry.message:'');return li;}));if(s.error)error(s.error);if(!formTouched){$('mc-platform').value=s.platform||'naver';$('mc-automatic').checked=s.automatic===true;$('mc-time').value=String(s.hour??8).padStart(2,'0')+':'+String(s.minute??15).padStart(2,'0');}if(s.running)wake();lastRunning=!!s.running;}
  async function load(){try{render(await api('status'));}catch(e){error(e.message);}}
  async function intent(route,data={}){if(busy)return;busy=true;error('');try{render(await api(route,data));wake();}catch(e){error(e.message);}finally{busy=false;}}
  $('mc-form').addEventListener('input',()=>{formTouched=true;});
  $('mc-form').addEventListener('submit',event=>{event.preventDefault();const [hour,minute]=$('mc-time').value.split(':').map(Number);intent('start',{mode:event.submitter?.dataset.mode||'full',platform:$('mc-platform').value,automatic:$('mc-automatic').checked,hour,minute});});
  $('mc-pause').addEventListener('click',()=>intent('pause'));$('mc-resume').addEventListener('click',()=>intent('resume'));
  window.addEventListener('message',async event=>{
    if(!local||event.source!==window||event.origin!==origin)return;const m=event.data;
    if(m?.source==='ROAS_MONITORING_EXTENSION_READY'){extension=true;$('mc-extension').textContent='Chrome 수집 연결을 확인했습니다.';wake();return;}
    if(m?.source!=='ROAS_MONITORING_EXTENSION'||typeof m.id!=='string'||m.id.length>100||!/^[a-f0-9]{64}$/.test(m.nonce||'')||pending.has(m.id)||pending.size>=10||!['connect','job','result','failure','start','pause','resume'].includes(m.operation))return;
    extension=true;$('mc-extension').textContent='Chrome 수집 연결을 확인했습니다.';pending.add(m.id);
    try{const result=await api(m.operation,m.payload||{});window.postMessage({source:'ROAS_MONITORING_RECEIVER',id:m.id,nonce:m.nonce,ok:true,result},origin);if(result?.status)render(result.status);else if(m.operation!=='connect'&&result?.running!==undefined)render(result);}
    catch(e){error(e.message);window.postMessage({source:'ROAS_MONITORING_RECEIVER',id:m.id,nonce:m.nonce,ok:false,error:e.message},origin);}finally{pending.delete(m.id);}
  });
  if(!local)$('mc-extension').textContent='실제 수집은 이 PC의 http://127.0.0.1:3000 화면에서 연결합니다.';
  load();setInterval(()=>{if(!document.hidden)load();},5000);
})();
