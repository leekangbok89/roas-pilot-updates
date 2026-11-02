/* Uses visible report controls only. No private API routes or credential access. */
const text=e=>(e.innerText||e.textContent||'').trim().replace(/\s+/g,' ');
const visible=e=>!!(e.getClientRects().length)&&getComputedStyle(e).visibility!=='hidden';
const controls=()=>[...document.querySelectorAll('button,a,[role="button"],[role="combobox"]')].filter(visible);
function radio(label){const list=[...document.querySelectorAll('label')].filter(visible),match=list.find(e=>text(e)===label||text(e).startsWith(label+' '));if(match){const r=match.querySelector('input[type="radio"]');if(r&&!r.checked)match.click();return true;}const r=[...document.querySelectorAll('[role="radio"]')].find(e=>visible(e)&&text(e)===label);if(r){if(r.getAttribute('aria-checked')!=='true')r.click();return true;}return false;}
const wait=ms=>new Promise(r=>setTimeout(r,ms));
function input(el,value){if(el.readOnly||el.disabled)return false;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));el.dispatchEvent(new Event('blur',{bubbles:true}));return true;}
const normalDate=value=>{const m=/^(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})(?:\s*일|\.)?$/.exec(String(value||'').trim());return m?m[1]+'-'+m[2].padStart(2,'0')+'-'+m[3].padStart(2,'0'):null;};
const enabled=e=>!e.disabled&&e.getAttribute('aria-disabled')!=='true'&&!/disabled/i.test(String(e.className))&&!e.closest('[aria-disabled="true"],.ant-picker-cell-disabled,.ant-calendar-disabled-cell');
function dateCells(){return [...document.querySelectorAll('td[title],[data-date],[role="gridcell"][aria-label],button[aria-label]')].filter(visible).map(e=>({e,date:normalDate(e.getAttribute('title'))||normalDate(e.getAttribute('data-date'))||normalDate(e.getAttribute('aria-label'))})).filter(x=>x.date);}
function monthButton(previous){
 const selector=previous?'.ant-picker-header-prev-btn,.ant-calendar-prev-month-btn,.rc-picker-header-prev-btn':'.ant-picker-header-next-btn,.ant-calendar-next-month-btn,.rc-picker-header-next-btn';
 const exact=[...document.querySelectorAll(selector)].filter(e=>visible(e)&&enabled(e));
 if(exact.length)return previous?exact[0]:exact.at(-1);
 const matches=controls().filter(e=>{if(!enabled(e))return false;const label=[e.getAttribute('title'),e.getAttribute('aria-label'),text(e)].filter(Boolean).join(' ');return previous?/이전\s*(달|월)|지난달|prev(?:ious)?\s*month/i.test(label):/다음\s*(달|월)|next\s*month/i.test(label);});
 return previous?matches[0]:matches.at(-1);
}
async function calendarInput(el,date){
 if(!el||el.disabled)return false;if(normalDate(el.value)===date)return true;
 if(!el.readOnly){el.focus();input(el,date);await wait(150);if(normalDate(el.value)===date)return true;}
 el.click();await wait(200);
 for(let n=0;n<26;n++){
  const cells=dateCells(),matches=cells.filter(x=>x.date===date&&enabled(x.e));
  const match=matches.find(x=>/in-view|in-month/.test(String(x.e.className)))||matches[0];
  if(match){match.e.click();await wait(200);return true;}
  const dates=cells.map(x=>x.date).sort();if(!dates.length)return false;
  const previous=date<dates[0],next=date>dates.at(-1);if(!previous&&!next)return false;
  const button=monthButton(previous);if(!button)return false;
  const before=dates.join();button.click();await wait(200);
  if(dateCells().map(x=>x.date).sort().join()===before)return false;
 }
 return false;
}
function dateFields(){
 const inputs=[...document.querySelectorAll('input')].filter(e=>visible(e)&&!['radio','checkbox','hidden','password'].includes(e.type));
 // Range pickers have two inputs in one control, sometimes with empty values.
 const ranges=[...document.querySelectorAll('.ant-picker-range,.ant-calendar-range-picker,.rc-picker-range')].filter(visible);
 const pairs=ranges.map(e=>[...e.querySelectorAll('input')].filter(visible)).filter(a=>a.length===2);
 if(pairs.length===1)return pairs[0];
 const label=e=>(e.placeholder||'')+' '+(e.getAttribute('aria-label')||'');
 const start=inputs.find(e=>/시작일|시작 날짜|start|开始/i.test(label(e))),finish=inputs.find(e=>/종료일|종료 날짜|end|结束/i.test(label(e)));
 if(start&&finish&&start!==finish)return [start,finish];
 const dated=inputs.filter(e=>normalDate(e.value));return dated.length===2?dated:[null,null];
}
async function step(m){
 const body=document.body.innerText;
 if(/Access Denied|Request Header Or Cookie Too Large|permission to access/i.test(body))return {blocked:true,message:'쿠팡 접근 제한으로 중단했습니다.'};
 if(document.querySelector('input[type="password"]')||/본인 인증|보안문자|사람인지 확인|로봇이 아닙니다/.test(body))return {blocked:true,message:'로그인·추가 인증을 직접 완료해 주세요. 인증을 자동으로 처리하지 않습니다.'};
 const job=m.job,dateMatches=s=>{const compact=s.replace(/[.\/]/g,'-').replace(/\s/g,'');const match=/(\d{4}-\d{2}-\d{2})[~～–—](\d{4}-\d{2}-\d{2})/.exec(compact);return !!match&&match[1]===job.since&&match[2]===job.until;};
 const rows=[...document.querySelectorAll('tr')].filter(e=>visible(e)&&dateMatches(text(e)));
 const ready=rows.find(r=>/생성\s*완료/.test(text(r)));
 if(ready&&job.confirmedAllCampaigns&&rows.length>(job.baselineCount??0)){const download=[...ready.querySelectorAll('a,button,[role="button"]')].find(e=>visible(e)&&/^(?:엑셀\s*)?다운로드$|^다운로드\s*\(/.test(text(e)));
  if(!download)return {needsInput:true,message:'생성 완료 보고서의 다운로드 버튼을 찾지 못했습니다. 보고서 조회 열의 버튼을 확인해 주세요.'};download.click();return {downloading:true,message:'생성 완료 보고서를 내려받고 저장 확인을 기다립니다.'};}
 if(job.confirmedAllCampaigns&&rows.some(r=>/생성\s*중|요청\s*완료|대기/.test(text(r))))return {message:'보고서 생성 중 · 완료 상태를 기다립니다.'};
 if(!m.allowCreate){const refresh=controls().find(e=>text(e)==='목록 새로 고침'||text(e)==='목록 새로고침');if(refresh)refresh.click();return {message:'요청한 보고서의 생성 상태를 확인합니다.'};}
 if(!radio('기간 설정'))return {notSubmitted:true,needsInput:true,message:'기간 설정 항목을 찾지 못했습니다.'};await wait(250);
 const [start,finish]=dateFields();
 if(!start||!finish||!await calendarInput(start,job.since)||!await calendarInput(finish,job.until))return {notSubmitted:true,needsInput:true,message:'쿠팡 보고서의 범위 달력을 선택하지 못했습니다. 입력칸 '+[start,finish].filter(Boolean).length+'/2 · 달력 날짜 '+dateCells().length+'개. 쿠팡 보고서 달력이 펼쳐진 화면을 확인해 주세요.'};
 if(normalDate(start.value)!==job.since||normalDate(finish.value)!==job.until)return {notSubmitted:true,needsInput:true,message:'화면에 반영된 시작일·종료일이 요청 기간과 다릅니다. 조회하지 않았습니다.'};
 if(!radio('일별'))return {notSubmitted:true,needsInput:true,message:'기간 구분 일별을 찾지 못했습니다.'};await wait(250);
 const select=[...document.querySelectorAll('select')].find(e=>visible(e)&&[...e.options].some(o=>/전체.*캠페인|전체 선택/.test(o.textContent)));
 let all=false;
 if(select){const option=[...select.options].find(o=>/전체.*캠페인|전체 선택/.test(o.textContent));select.value=option.value;select.dispatchEvent(new Event('change',{bubbles:true}));all=select.value===option.value;}
 else {const picker=controls().find(e=>/캠페인을 선택|캠페인 선택/.test(text(e)));if(picker){picker.click();await wait(250);}const label=[...document.querySelectorAll('label,[role="option"]')].find(e=>visible(e)&&/^(전체 선택|전체 캠페인|전체선택)$/.test(text(e)));if(label){const checkbox=label.querySelector('input[type="checkbox"]');if(checkbox&&!checkbox.checked)label.click();await wait(100);all=!!checkbox?.checked||label.getAttribute('aria-selected')==='true';const apply=controls().find(e=>/^(확인|적용)$/.test(text(e)));if(apply)apply.click();}}
 if(!all)return {notSubmitted:true,needsInput:true,message:'전체 캠페인 선택 상태를 확인하지 못했습니다. 일부 캠페인을 전체 금액으로 저장하지 않도록 중단합니다.'};await wait(250);
 const keywords=[...document.querySelectorAll('label')].find(e=>visible(e)&&text(e).replace(/\s/g,'')==='클릭이발생한키워드만보고서에포함'),check=keywords?.querySelector('input[type="checkbox"]');if(check?.checked)keywords.click();
 const create=controls().find(e=>text(e)==='보고서 만들기');if(!create||create.disabled||create.getAttribute('aria-disabled')==='true')return {notSubmitted:true,needsInput:true,message:'보고서 만들기가 비활성 상태입니다. 기간·캠페인 설정을 확인해 주세요.'};
 // Static guidance is not a rejected request. Only new messages can stop this run.
 const before=new Set(document.body.innerText.split(/\n+/).map(s=>s.trim()).filter(Boolean));
 const alerts=()=>[...document.querySelectorAll('[role="alert"],[role="dialog"],.ant-message-notice,.ant-notification-notice,.ant-modal,.ant-alert')].filter(visible).map(text).filter(Boolean);
 const priorAlerts=new Set(alerts());
 create.click();await wait(500);
 const fresh=[...alerts().filter(s=>!priorAlerts.has(s)),...document.body.innerText.split(/\n+/).map(s=>s.trim()).filter(s=>s&&!before.has(s))];
 const restriction=fresh.find(s=>/최대.*일|조회.*불가|기간.*초과|요청.*초과|한도.*초과/.test(s));
 if(restriction)return {blocked:true,message:'쿠팡 안내: '+restriction.slice(0,200)+' · 수집을 중단했습니다.'};
 return {requested:true,baselineCount:rows.length,message:'보고서 만들기를 누른 뒤 생성 상태를 확인하고 있습니다.'};
}
chrome.runtime.onMessage.addListener((m,sender,reply)=>{if(sender.id!==chrome.runtime.id||m.kind!=='step')return;step(m).then(reply,e=>reply({needsInput:true,message:'화면 확인 실패: '+String(e.message).slice(0,200)}));return true;});
