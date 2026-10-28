/* Uses visible report controls only. No private API routes or credential access. */
const text=e=>(e.innerText||e.textContent||'').trim().replace(/\s+/g,' ');
const visible=e=>!!(e.getClientRects().length)&&getComputedStyle(e).visibility!=='hidden';
const controls=()=>[...document.querySelectorAll('button,a,[role="button"],[role="combobox"]')].filter(visible);
function radio(label){const list=[...document.querySelectorAll('label')].filter(visible),match=list.find(e=>text(e)===label||text(e).startsWith(label+' '));if(match){const r=match.querySelector('input[type="radio"]');if(r&&!r.checked)match.click();return true;}const r=[...document.querySelectorAll('[role="radio"]')].find(e=>visible(e)&&text(e)===label);if(r){if(r.getAttribute('aria-checked')!=='true')r.click();return true;}return false;}
const wait=ms=>new Promise(r=>setTimeout(r,ms));
function input(el,value){if(el.readOnly||el.disabled)return false;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));el.dispatchEvent(new Event('blur',{bubbles:true}));return true;}
async function calendarInput(el,date){
 if(!el||el.disabled)return false;if(!el.readOnly)return input(el,date);
 el.click();await wait(150);
 for(let n=0;n<15;n++){
  const cells=[...document.querySelectorAll('td[title],[role="gridcell"][data-date],button[aria-label]')].filter(visible).map(e=>({e,date:e.getAttribute('title')||e.getAttribute('data-date')||e.getAttribute('aria-label')})).filter(x=>/^\d{4}-\d\d-\d\d$/.test(x.date));
  const match=cells.find(x=>x.date===date&&!/disabled/i.test(String(x.e.className))&&x.e.getAttribute('aria-disabled')!=='true');
  if(match){match.e.click();await wait(150);return true;}
  if(!cells.length)return false;const dates=cells.map(x=>x.date).sort(),previous=date<dates[0],next=date>dates.at(-1);if(!previous&&!next)return false;
  const buttons=controls().filter(e=>{const label=e.getAttribute('title')||e.getAttribute('aria-label')||text(e);return previous?/^(이전 달|지난달|Previous month|prev month)$/i.test(label):/^(다음 달|다음달|Next month)$/i.test(label);});
  const button=previous?buttons[0]:buttons.at(-1);if(!button||button.disabled||button.getAttribute('aria-disabled')==='true')return false;button.click();await wait(150);
 }
 return false;
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
 let fields=[...document.querySelectorAll('input')].filter(e=>visible(e)&&!['radio','checkbox','hidden','password'].includes(e.type));
 const start=fields.find(e=>/시작일|start/i.test((e.placeholder||'')+' '+(e.getAttribute('aria-label')||'')))||fields.find(e=>/^\d{4}[-./]\d\d[-./]\d\d$/.test(e.value));
 const finish=fields.find(e=>/종료일|end/i.test((e.placeholder||'')+' '+(e.getAttribute('aria-label')||'')))||fields.filter(e=>/^\d{4}[-./]\d\d[-./]\d\d$/.test(e.value))[1];
 if(!start||!finish||!await calendarInput(start,job.since)||!await calendarInput(finish,job.until))return {notSubmitted:true,needsInput:true,message:'날짜 입력이 이 화면 방식과 맞지 않습니다. 달력 입력 방식의 추가 검증이 필요합니다.'};
 const normalize=s=>s.replace(/[.\/]/g,'-').replace(/\s/g,'');if(normalize(start.value)!==job.since||normalize(finish.value)!==job.until)return {notSubmitted:true,needsInput:true,message:'화면에 반영된 시작일·종료일이 요청 기간과 다릅니다. 조회하지 않았습니다.'};
 if(!radio('일별'))return {notSubmitted:true,needsInput:true,message:'기간 구분 일별을 찾지 못했습니다.'};await wait(250);
 const select=[...document.querySelectorAll('select')].find(e=>visible(e)&&[...e.options].some(o=>/전체.*캠페인|전체 선택/.test(o.textContent)));
 let all=false;
 if(select){const option=[...select.options].find(o=>/전체.*캠페인|전체 선택/.test(o.textContent));select.value=option.value;select.dispatchEvent(new Event('change',{bubbles:true}));all=select.value===option.value;}
 else {const picker=controls().find(e=>/캠페인을 선택|캠페인 선택/.test(text(e)));if(picker){picker.click();await wait(250);}const label=[...document.querySelectorAll('label,[role="option"]')].find(e=>visible(e)&&/^(전체 선택|전체 캠페인|전체선택)$/.test(text(e)));if(label){const checkbox=label.querySelector('input[type="checkbox"]');if(checkbox&&!checkbox.checked)label.click();await wait(100);all=!!checkbox?.checked||label.getAttribute('aria-selected')==='true';const apply=controls().find(e=>/^(확인|적용)$/.test(text(e)));if(apply)apply.click();}}
 if(!all)return {notSubmitted:true,needsInput:true,message:'전체 캠페인 선택 상태를 확인하지 못했습니다. 일부 캠페인을 전체 금액으로 저장하지 않도록 중단합니다.'};await wait(250);
 const keywords=[...document.querySelectorAll('label')].find(e=>visible(e)&&text(e).replace(/\s/g,'')==='클릭이발생한키워드만보고서에포함'),check=keywords?.querySelector('input[type="checkbox"]');if(check?.checked)keywords.click();
 const create=controls().find(e=>text(e)==='보고서 만들기');if(!create||create.disabled||create.getAttribute('aria-disabled')==='true')return {notSubmitted:true,needsInput:true,message:'보고서 만들기가 비활성 상태입니다. 기간·캠페인 설정을 확인해 주세요.'};
 create.click();await wait(500);if(/최대.*일|조회.*불가|기간.*초과|요청.*초과/.test(document.body.innerText))return {blocked:true,message:'쿠팡이 기간 또는 요청 한도를 안내했습니다. 수집 범위를 조정해야 합니다.'};
 return {requested:true,baselineCount:rows.length,message:'일별·전체 캠페인 보고서를 요청했습니다. 생성 완료를 기다립니다.'};
}
chrome.runtime.onMessage.addListener((m,sender,reply)=>{if(sender.id!==chrome.runtime.id||m.kind!=='step')return;step(m).then(reply,e=>reply({needsInput:true,message:'화면 확인 실패: '+String(e.message).slice(0,200)}));return true;});
