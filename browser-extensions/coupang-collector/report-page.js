/* Uses visible report controls only. No private API routes or credential access. */
const REPORT_ADAPTER_VERSION='0.2.7';
const text=e=>(e.innerText||e.textContent||'').trim().replace(/\s+/g,' ');
const visible=e=>!!(e.getClientRects().length)&&getComputedStyle(e).visibility!=='hidden';
const controls=()=>[...document.querySelectorAll('button,a,[role="button"],[role="combobox"]')].filter(visible);
function radio(label){const list=[...document.querySelectorAll('label')].filter(visible),match=list.find(e=>text(e)===label||text(e).startsWith(label+' '));if(match){const r=match.querySelector('input[type="radio"]');if(r&&!r.checked)match.click();return true;}const r=[...document.querySelectorAll('[role="radio"]')].find(e=>visible(e)&&text(e)===label);if(r){if(r.getAttribute('aria-checked')!=='true')r.click();return true;}return false;}
const wait=ms=>new Promise(r=>setTimeout(r,ms));
function input(el,value){if(el.readOnly||el.disabled)return false;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));el.dispatchEvent(new Event('blur',{bubbles:true}));return true;}
const normalDate=value=>{const m=/^(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})(?:\s*일|\.)?$/.exec(String(value||'').trim());return m?m[1]+'-'+m[2].padStart(2,'0')+'-'+m[3].padStart(2,'0'):null;};
const enabled=e=>!e.disabled&&e.getAttribute('aria-disabled')!=='true'&&!/disabled/i.test(String(e.className))&&!e.closest('[aria-disabled="true"],.ant-picker-cell-disabled,.rc-picker-cell-disabled,.ant-calendar-disabled-cell');
function cellDate(value){
 const s=String(value||'').trim(),plain=normalDate(s);if(plain)return plain;
 const korean=/^(\d{4}년\s*\d{1,2}월\s*\d{1,2}일)(?:\s*[([]?[일월화수목금토]요일[)\]]?)?$/.exec(s);if(korean)return normalDate(korean[1]);
 const english=/^(?:Choose\s+)?(?:(?:Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday),?\s+)?(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/i.exec(s);
 if(!english)return null;const month=['january','february','march','april','may','june','july','august','september','october','november','december'].indexOf(english[1].toLowerCase())+1;
 return english[3]+'-'+String(month).padStart(2,'0')+'-'+english[2].padStart(2,'0');
}
function datePanels(){
 const panels=[...document.querySelectorAll('.ant-picker-date-panel,.rc-picker-date-panel,.ant-calendar-range-left,.ant-calendar-range-right,.ant-calendar-range-part,.ant-calendar,.react-datepicker__month-container')].filter(visible);
 return panels.filter(panel=>!panels.some(other=>other!==panel&&panel.contains(other)));
}
// Numeric days are accepted only as one complete, consecutive calendar grid.
// A month heading alone must never turn an arbitrary table into date buttons.
function mapCalendarDays(year,month,days){
 if(!Number.isInteger(year)||year<2000||year>2100||!Number.isInteger(month)||month<1||month>12||![28,35,42].includes(days.length)||days.some(d=>!Number.isInteger(d)||d<1||d>31))return null;
 const candidates=[];
 for(let at=0;at<7;at++){
  if(days[at]!==1)continue;
  const first=new Date(Date.UTC(year,month-1,1-at));if(![0,1].includes(first.getUTCDay()))continue;
  const dates=days.map((_,i)=>new Date(first.getTime()+i*86400000));
  if(!dates.every((date,i)=>date.getUTCDate()===days[i]))continue;
  const lastDay=new Date(Date.UTC(year,month,0)).getUTCDate();
  if(!dates.some(d=>d.getUTCMonth()===month-1&&d.getUTCFullYear()===year&&d.getUTCDate()===lastDay))continue;
  candidates.push(dates.map(d=>d.toISOString().slice(0,10)));
 }
 return candidates.length===1?candidates[0]:null;
}
function panelMonth(panel){
 const scope=panel.closest('.ant-picker-panel,.rc-picker-panel')||panel;
 const year=scope.querySelector('.ant-calendar-year-select,.ant-picker-year-btn,.rc-picker-year-btn'),month=scope.querySelector('.ant-calendar-month-select,.ant-picker-month-btn,.rc-picker-month-btn');
 const header=scope.querySelector('.ant-calendar-header,.ant-picker-header-view,.rc-picker-header-view,.react-datepicker__current-month');
 const label=year&&month?text(year)+' '+text(month):header?text(header):'';
 const m=/^(\d{4})\s*년?\s*(\d{1,2})\s*월?$/.exec(label.trim());return m?{year:Number(m[1]),month:Number(m[2])}:null;
}
function dateCells(){
 const panels=datePanels(),selector='[title],[data-date],[aria-label]';
 const explicit=[...new Set([...document.querySelectorAll('td[title],td[aria-label],td [title],td [aria-label],[data-date],[role="gridcell"][aria-label],[role="gridcell"] [title],button[aria-label],.react-datepicker__day[aria-label]'),...panels.flatMap(p=>[...p.querySelectorAll(selector)])])].filter(visible).map(e=>({e,date:cellDate(e.getAttribute('title'))||cellDate(e.getAttribute('data-date'))||cellDate(e.getAttribute('aria-label'))})).filter(x=>x.date);
 for(const panel of panels){
  // When explicit dates exist they remain authoritative for this panel.
  if(explicit.some(x=>panel.contains(x.e)))continue;
  const month=panelMonth(panel);if(!month)continue;
  const tables=[...panel.querySelectorAll('table')].filter(visible);if(tables.length!==1)continue;
  const rows=[...tables[0].querySelectorAll('tbody tr')];if(![4,5,6].includes(rows.length)||rows.some(r=>r.children.length!==7))continue;
  const cells=rows.flatMap(r=>[...r.children]);if(cells.some(e=>e.tagName!=='TD'||!/^\d{1,2}$/.test(text(e))))continue;
  const dates=mapCalendarDays(month.year,month.month,cells.map(e=>Number(text(e))));if(dates)cells.forEach((e,i)=>explicit.push({e:e.querySelector('.ant-calendar-date,.ant-picker-cell-inner,.rc-picker-cell-inner')||e,date:dates[i]}));
 }
 return explicit;
}
async function waitForDates(timeout=1600){
 for(let n=0;n<timeout/100;n++){if(dateCells().length)return true;await wait(100);}return !!dateCells().length;
}
async function openCalendar(el){
 // Always activate the requested endpoint, even when the start popup stayed open.
 // HTMLElement.click() alone does not focus or send mousedown to range pickers.
 el.scrollIntoView({block:'nearest'});el.focus();
 const mouse=(type)=>el.dispatchEvent(new MouseEvent(type,{bubbles:true,cancelable:true,view:window,button:0}));
 mouse('mousedown');mouse('mouseup');el.click();
 if(await waitForDates())return true;
 const wrapper=el.closest('.ant-picker,.ant-calendar-picker,.ant-calendar-range-picker,.rc-picker,.react-datepicker__input-container');
 if(wrapper&&wrapper!==el){wrapper.click();if(await waitForDates())return true;}
 return false;
}
function monthButton(previous){
 const selector=previous?'.ant-picker-header-prev-btn,.ant-calendar-prev-month-btn,.rc-picker-header-prev-btn':'.ant-picker-header-next-btn,.ant-calendar-next-month-btn,.rc-picker-header-next-btn';
 const exact=[...document.querySelectorAll(selector)].filter(e=>visible(e)&&enabled(e));
 if(exact.length)return previous?exact[0]:exact.at(-1);
 const matches=controls().filter(e=>{if(!enabled(e))return false;const label=[e.getAttribute('title'),e.getAttribute('aria-label'),text(e)].filter(Boolean).join(' ');return previous?/이전\s*(달|월)|지난달|prev(?:ious)?\s*month/i.test(label):/다음\s*(달|월)|next\s*month/i.test(label);});
 return previous?matches[0]:matches.at(-1);
}
async function calendarInput(el,date,deferValue=false){
 if(!el||el.disabled)return false;if(normalDate(el.value)===date)return true;
 if(!el.readOnly){el.focus();input(el,date);await wait(150);if(normalDate(el.value)===date)return true;}
 if(!await openCalendar(el))return false;
 for(let n=0;n<26;n++){
  const cells=dateCells(),matches=cells.filter(x=>x.date===date&&enabled(x.e));
  const match=matches.find(x=>{const cell=x.e.closest('td,[role="gridcell"]')||x.e,classes=String(cell.className);return /in-view|in-month/.test(classes)||/ant-calendar-cell/.test(classes)&&!/last-month|next-month/.test(classes);})||matches[0];
  if(match){match.e.click();for(let attempt=0;attempt<16;attempt++){await wait(100);if(normalDate(el.value)===date)return true;}return deferValue;}
  const dates=cells.map(x=>x.date).sort();if(!dates.length)return false;
  const previous=date<dates[0],next=date>dates.at(-1);if(!previous&&!next)return false;
  const button=monthButton(previous);if(!button)return false;
  const before=dates.join();button.click();
  for(let attempt=0;attempt<16&&dateCells().map(x=>x.date).sort().join()===before;attempt++)await wait(100);
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
const allCampaignLabel=value=>/^(?:전체선택|전체캠페인|모든캠페인)(?:[（(]?\d+개?[)）]?)?$/.test(String(value||'').replace(/\s/g,''));
function campaignPicker(){
 const candidates=[...new Set([...controls(),...document.querySelectorAll('.ant-select-selector,.ant-select-selection,.ant-select,.rc-select,input[role="combobox"]'),...[...document.querySelectorAll('div,span')].filter(e=>/^(모든 캠페인|전체 캠페인|캠페인을 선택하세요)$/.test(text(e)))])];
 return candidates.find(e=>visible(e)&&enabled(e)&&text(e).length<100&&(/캠페인을 선택|캠페인 선택/.test(text(e)+' '+(e.getAttribute('placeholder')||''))||allCampaignLabel(text(e))&&!/전체선택/.test(text(e).replace(/\s/g,''))));
}
function campaignMaster(){
 const candidates=[...document.querySelectorAll('label,[role="checkbox"],[role="option"],span,div,button')].filter(e=>visible(e)&&allCampaignLabel(text(e)));
 for(const label of candidates){
  for(let root=label;root&&allCampaignLabel(text(root));root=root.parentElement){
   const inputs=[...root.querySelectorAll('input[type="checkbox"]')];
   if(inputs.length===1)return {root,input:inputs[0]};
   if(root.getAttribute('role')==='checkbox')return {root,input:null};
  }
 }
 return null;
}
const masterChecked=m=>!!m&&(m.input?m.input.checked&&!m.input.indeterminate:m.root.getAttribute('aria-checked')==='true');
async function selectAllCampaigns(){
 const select=[...document.querySelectorAll('select')].find(e=>visible(e)&&[...e.options].some(o=>allCampaignLabel(o.textContent)));
 if(select){const option=[...select.options].find(o=>allCampaignLabel(o.textContent)&&!o.disabled);if(!option)return false;select.value=option.value;select.dispatchEvent(new Event('change',{bubbles:true}));await wait(150);return select.value===option.value;}
 let master=campaignMaster();
 if(!master){const picker=campaignPicker();if(!picker)return false;picker.click();await wait(300);master=campaignMaster();}
 if(!master)return false;
 if(!masterChecked(master)){
  if(!enabled(master.root)||master.input?.disabled)return false;
  (master.input||master.root).click();await wait(200);master=campaignMaster();
 }
 if(!masterChecked(master))return false;
 // Apply inside the menu containing the master checkbox, never an unrelated dialog.
 let scope=master.root,apply=null;
 while(scope&&scope!==document.body){apply=[...scope.querySelectorAll('button,a,[role="button"],input[type="button"]')].find(e=>visible(e)&&enabled(e)&&/^(確認|확인|적용)$/.test(text(e)||e.value||''));if(apply)break;scope=scope.parentElement;}
 if(apply){apply.click();await wait(200);const picker=campaignPicker();if(picker&&allCampaignLabel(text(picker)))return true;return masterChecked(campaignMaster());}
 return masterChecked(master);
}
function reportKey(row){
 for(const name of ['data-report-id','data-request-id']){const value=row.getAttribute(name);if(value&&value.length<200)return name+':'+value;}
 const item=row.querySelector('[data-report-id],[data-request-id]');if(item)return 'report:'+(item.getAttribute('data-report-id')||item.getAttribute('data-request-id'));
 for(const link of row.querySelectorAll('a[href]')){try{const url=new URL(link.getAttribute('href'),location.href);for(const key of ['reportId','report_id','reportNo','requestId'])if(url.searchParams.get(key))return key+':'+url.searchParams.get(key);}catch{}}
 // Small numeric keys are commonly visible row positions, not report IDs.
 const rowKey=row.getAttribute('data-row-key');return rowKey&&rowKey.length<200&&!/^\d{1,2}$/.test(rowKey)?'row:'+rowKey:null;
}
function reportSignature(row){return text(row).replace(/생성\s*(완료|중|실패)|요청\s*완료|대기|(?:엑셀\s*)?다운로드(?:\s*\([^)]*\))?|자세히\s*보기|재시도/g,'').replace(/\s+/g,' ').trim().slice(0,1200);}
function reportBaseline(rows){return rows.slice(0,100).map(row=>({key:reportKey(row),signature:reportSignature(row)}));}
function newReports(rows,job){
 if(!Array.isArray(job.baselineReports))return rows.length>(job.baselineCount??0)?rows:[];
 const oldKeys=new Set(job.baselineReports.map(r=>r.key).filter(Boolean)),counts=new Map();
 for(const r of job.baselineReports)counts.set(r.signature,(counts.get(r.signature)||0)+1);
 const seen=new Map();return rows.filter(row=>{const key=reportKey(row),sig=reportSignature(row),count=(seen.get(sig)||0)+1;seen.set(sig,count);if(key&&oldKeys.has(key))return false;return key&&!oldKeys.has(key)&&job.baselineReports.every(r=>r.key)||count>(counts.get(sig)||0);});
}
function reportRange(value){
 const m=/(\d{4}[-./]\d{1,2}[-./]\d{1,2})\s*(?:[~～–—]|\s-\s|\bto\b)\s*(\d{4}[-./]\d{1,2}[-./]\d{1,2})/i.exec(String(value||''));return m?{since:normalDate(m[1]),until:normalDate(m[2])}:null;
}
function matchingReports(job){return [...new Set(document.querySelectorAll('tr,[role="row"],.ant-table-row'))].filter(e=>{if(!visible(e))return false;const range=reportRange(text(e));return range?.since===job.since&&range.until===job.until;});}
async function firstReportPage(){
 const pagers=[...document.querySelectorAll('.ant-pagination,.rc-pagination')].filter(visible);if(pagers.length!==1)return true;
 const pager=pagers[0],first=pager.querySelector('.ant-pagination-item-1,.rc-pagination-item-1');if(!first||!visible(first))return true;
 const active=()=>{const current=[...document.querySelectorAll('.ant-pagination-item-1,.rc-pagination-item-1')].find(visible);return current&&(current.matches('.ant-pagination-item-active,.rc-pagination-item-active,[aria-current="page"]')||!!current.querySelector('[aria-current="page"]'));};if(active())return true;
 if(!enabled(first))return false;(first.querySelector('a,button')||first).click();
 for(let n=0;n<20;n++){await wait(100);if(active()){await wait(400);for(let loading=0;loading<20;loading++){if(![...document.querySelectorAll('.ant-table-wrapper .ant-spin-spinning,.ant-table-wrapper [aria-busy="true"]')].some(visible))return true;await wait(100);}return false;}}return false;
}
function inspectReports(job){
 const rows=matchingReports(job),fresh=job.confirmedAllCampaigns?newReports(rows,job):[];
 const ready=fresh.find(row=>/생성\s*완료/.test(text(row))),failed=fresh.some(row=>/생성\s*실패|요청\s*실패/.test(text(row))),pending=fresh.some(row=>/생성\s*중|요청\s*완료|대기/.test(text(row)));
 return {rows,fresh,ready,failed,pending,diagnostics:{matching:rows.length,fresh:fresh.length,ready:ready?1:0,pending:pending?1:0}};
}
function readyReport(state,job){
 const {ready,diagnostics}=state;if(!ready)return null;
 const download=[...ready.querySelectorAll('a,button,[role="button"]')].find(e=>visible(e)&&/^(?:엑셀\s*)?다운로드$|^다운로드\s*\(/.test(text(e)));
 if(!download)return {phase:'ready',diagnostics,needsInput:true,message:'생성 완료 보고서의 다운로드 버튼을 찾지 못했습니다. 보고서 조회 열의 버튼을 확인해 주세요.'};
 if(!enabled(download))return {phase:'ready',diagnostics,message:'보고서는 생성 완료 · 다운로드 버튼 활성 대기 · '+job.since+' ~ '+job.until};
 download.click();return {phase:'download',diagnostics,downloading:true,message:'생성 완료 보고서의 다운로드를 눌렀습니다. Chrome 다운로드 시작과 저장을 확인합니다.'};
}
async function step(m){
 const body=document.body.innerText;
 if(/Access Denied|Request Header Or Cookie Too Large|permission to access/i.test(body))return {blocked:true,message:'쿠팡 접근 제한으로 중단했습니다.'};
 if(document.querySelector('input[type="password"]')||/본인 인증|보안문자|사람인지 확인|로봇이 아닙니다/.test(body))return {blocked:true,message:'로그인·추가 인증을 직접 완료해 주세요. 인증을 자동으로 처리하지 않습니다.'};
 const job=m.job;
 if(!await firstReportPage())return {notSubmitted:m.allowCreate,needsInput:true,phase:'identifying',message:'보고서 목록의 1페이지로 이동하지 못했습니다. 쿠팡 보고서 목록에서 1페이지를 선택한 뒤 이어 확인하세요.'};
 let state=inspectReports(job),ready=readyReport(state,job);if(ready&&(ready.downloading||ready.needsInput))return ready;
 if(state.failed)return {blocked:true,phase:'failed',diagnostics:state.diagnostics,message:'새로 요청한 보고서가 생성 실패로 표시됩니다. 쿠팡 보고서 화면의 실패 사유를 확인해 주세요.'};
 if(!m.allowCreate){
  const refresh=controls().find(e=>enabled(e)&&/^(목록 새로\s*고침|새로\s*고침|Refresh)$/i.test(text(e)));
  if(refresh){const before=state.rows.map(text).join('|');refresh.click();for(let n=0;n<15;n++){await wait(100);if(matchingReports(job).map(text).join('|')!==before)break;}state=inspectReports(job);ready=readyReport(state,job);if(ready)return ready;}
  if(state.failed)return {blocked:true,phase:'failed',diagnostics:state.diagnostics,message:'새로 요청한 보고서가 생성 실패로 표시됩니다. 쿠팡 보고서 화면의 실패 사유를 확인해 주세요.'};
  if(ready)return ready;
  return {phase:state.pending?'creating':'identifying',diagnostics:state.diagnostics,message:(state.pending?'새 보고서 생성 중':'새 보고서 식별 대기')+' · '+job.since+' ~ '+job.until+' · 같은 기간 '+state.rows.length+'개 / 새 보고서 '+state.fresh.length+'개 · '+(refresh?'목록 새로고침 완료':'목록 새로고침 버튼 확인 필요')+(state.rows.length&&!state.fresh.length?' · 기존 보고서와 구분될 새 보고서 정보 확인 필요':'')};
 }
 if(!radio('기간 설정'))return {notSubmitted:true,needsInput:true,message:'기간 설정 항목을 찾지 못했습니다.'};await wait(250);
 const [start,finish]=dateFields();
 if(!start||!finish||!await calendarInput(start,job.since,true)||!await calendarInput(finish,job.until))return {notSubmitted:true,needsInput:true,message:'범위 달력 선택 중단 · 보고서 연결 '+REPORT_ADAPTER_VERSION+' · 입력칸 '+[start,finish].filter(Boolean).length+'/2 · 열린 달력 '+datePanels().length+'개 · 인식 날짜 '+dateCells().length+'개. 달력이 펼쳐진 화면을 확인해 주세요.'};
 // Some range controls commit both values only after the second date is chosen.
 for(let attempt=0;attempt<16&&(normalDate(start.value)!==job.since||normalDate(finish.value)!==job.until);attempt++)await wait(100);
 if(normalDate(start.value)!==job.since||normalDate(finish.value)!==job.until)return {notSubmitted:true,needsInput:true,message:'화면에 반영된 시작일·종료일이 요청 기간과 다릅니다. 조회하지 않았습니다.'};
 if(!radio('일별'))return {notSubmitted:true,needsInput:true,message:'기간 구분 일별을 찾지 못했습니다.'};await wait(250);
 const all=await selectAllCampaigns();
 if(!all)return {notSubmitted:true,needsInput:true,message:'전체 캠페인 선택 상태를 확인하지 못했습니다. 일부 캠페인을 전체 금액으로 저장하지 않도록 중단합니다.'};await wait(250);
 const keywords=[...document.querySelectorAll('label')].find(e=>visible(e)&&text(e).replace(/\s/g,'')==='클릭이발생한키워드만보고서에포함'),check=keywords?.querySelector('input[type="checkbox"]');if(check?.checked)keywords.click();
 const create=controls().find(e=>text(e)==='보고서 만들기');if(!create||create.disabled||create.getAttribute('aria-disabled')==='true')return {notSubmitted:true,needsInput:true,message:'보고서 만들기가 비활성 상태입니다. 기간·캠페인 설정을 확인해 주세요.'};
 // Static guidance is not a rejected request. Only new messages can stop this run.
 const before=new Set(document.body.innerText.split(/\n+/).map(s=>s.trim()).filter(Boolean));
 const alerts=()=>[...document.querySelectorAll('[role="alert"],[role="dialog"],.ant-message-notice,.ant-notification-notice,.ant-modal,.ant-alert')].filter(visible).map(text).filter(Boolean);
 const priorAlerts=new Set(alerts());
 const baselineRows=matchingReports(job);
 const baselineReports=reportBaseline(baselineRows);
 create.click();await wait(500);
 const fresh=[...alerts().filter(s=>!priorAlerts.has(s)),...document.body.innerText.split(/\n+/).map(s=>s.trim()).filter(s=>s&&!before.has(s))];
 const restriction=fresh.find(s=>/최대.*일|조회.*불가|기간.*초과|요청.*초과|한도.*초과/.test(s));
 if(restriction)return {blocked:true,message:'쿠팡 안내: '+restriction.slice(0,200)+' · 수집을 중단했습니다.'};
 return {phase:'identifying',requested:true,baselineCount:baselineRows.length,baselineReports,message:'보고서 만들기 클릭 완료 · 새 보고서 접수·생성 상태 확인 대기'};
}
chrome.runtime.onMessage.addListener((m,sender,reply)=>{if(sender.id!==chrome.runtime.id)return;if(m.kind==='probe'){reply({adapterVersion:REPORT_ADAPTER_VERSION});return;}if(m.kind!=='step')return;step(m).then(result=>reply({...result,adapterVersion:REPORT_ADAPTER_VERSION}),e=>reply({adapterVersion:REPORT_ADAPTER_VERSION,needsInput:true,message:'화면 확인 실패: '+String(e.message).slice(0,200)}));return true;});
