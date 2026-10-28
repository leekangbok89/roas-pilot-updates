(function(){'use strict';
 const $=id=>document.getElementById(id), origin=location.origin;
 const expectedOrigin=/^http:\/\/(127\.0\.0\.1|localhost):3000$/.test(origin);
 const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10),shift=(d,n)=>new Date(Date.parse(d)+n*86400000).toISOString().slice(0,10);
 $('cc-since').value=shift(today,-7);$('cc-until').value=shift(today,-1);
 const pending=new Set();let saving=false;
 async function api(route,body){const r=await fetch('/api/coupang/'+route,{cache:'no-store',...(body?{method:'POST',headers:{'Content-Type':'application/json','X-ROAS-Local-Action':'yes'},body:JSON.stringify(body)}:{})});const v=await r.json();if(!r.ok)throw Error(v.error||'쿠팡 보고서 요청 실패');return v;}
 const el=(tag,text)=>{const e=document.createElement(tag);e.textContent=text;return e;};
 const value=n=>typeof n==='number'&&Number.isFinite(n)?n.toLocaleString('ko-KR',{maximumFractionDigits:2}):'—';
 async function load(){try{const r=await api('advertisingReports?'+new URLSearchParams({since:$('cc-since').value,until:$('cc-until').value}));const host=$('cc-statistics');host.replaceChildren();for(const type of ['pa','nca']){const t=r.types[type];host.append(el('h3',type==='pa'?'매출성장 광고':'신규구매 캠페인'),el('p',t.knownDays+'/'+t.totalDays+'일 저장 · 원본 금액 기준 · '+(t.complete?'조회 기간 확인':'일부 날짜 미수집')));const table=el('table','');table.className='ca-table';const head=el('tr','');for(const label of ['캠페인','광고비(원)',type==='pa'?'1일 전환매출(원)':'첫구매 매출(원)',type==='pa'?'14일 전환매출(원)':'신규고객 수(명)','ROAS(%)'])head.append(el('th',label));table.append(head);for(const c of [{name:'저장분 합계',...t.available},...t.campaigns]){const tr=el('tr','');for(const v of [c.name,value(c.spend),value(c[type==='pa'?'sales1':'firstSales']),value(c[type==='pa'?'sales14':'newCustomers']),value(c.roas)])tr.append(el('td',v));table.append(tr);}const wrap=el('div','');wrap.className='ca-scroll';wrap.append(table);host.append(wrap);}}catch(e){$('cc-result').textContent=e.message;}}
 async function save(file){if(saving)throw Error('다른 광고 보고서를 저장 중입니다.');saving=true;try{const grids=await CoupangSheets.readGrids(file),body=CoupangAdReports.parse(grids,file.name);const result=await api('ads-import',body);const verify=await api('advertisingReports?'+new URLSearchParams({since:body.since,until:body.until}));const days=verify.types[body.type].daily.filter(d=>result.dates.includes(d.date)&&d.collected);if(days.length!==result.days)throw Error('저장 후 조회한 날짜 수가 다릅니다. 다시 확인하세요.');$('cc-since').value=body.since;$('cc-until').value=body.until;$('cc-result').textContent=(body.type==='pa'?'매출성장':'신규구매')+' 보고서 '+result.days+'일 · '+result.rows+'행 저장 및 재조회 확인';await load();return result;}finally{saving=false;}}
 $('cc-import').addEventListener('click',async()=>{try{for(const file of $('cc-files').files)await save(file);}catch(e){$('cc-result').textContent=e.message;}});
 $('cc-query').addEventListener('submit',e=>{e.preventDefault();load();});
 window.addEventListener('message',async event=>{
  if(!expectedOrigin||event.source!==window||event.origin!==origin||event.data?.source!=='ROAS_COUPANG_EXTENSION')return;
  const m=event.data;if(m.kind==='status'){$('cc-connection').textContent=String(m.message||'연결됨').slice(0,500);return;}
  if(m.kind!=='workbook'||typeof m.id!=='string'||pending.has(m.id))return;
  pending.add(m.id);try{if(typeof m.data!=='string'||m.data.length>12*1024*1024||typeof m.filename!=='string')throw Error('보고서 크기·파일명을 확인하세요.');const binary=atob(m.data),bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));const result=await save(new File([bytes],m.filename,{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));window.postMessage({source:'ROAS_COUPANG_RECEIVER',id:m.id,ok:true,result},origin);}catch(e){$('cc-result').textContent=e.message;window.postMessage({source:'ROAS_COUPANG_RECEIVER',id:m.id,ok:false,error:e.message},origin);}finally{pending.delete(m.id);}
 });
 api('status').then(s=>{$('cc-connection').textContent=s.configured?'쿠팡 계정 '+s.vendorId+' · 확장프로그램 연결 대기':'자료·연결 관리에서 쿠팡 API 계정을 먼저 연결하세요.';}).catch(e=>{$('cc-connection').textContent=e.message;});load();
})();
