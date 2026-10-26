(function(){
  'use strict';
  const $=id=>document.getElementById(id),m=window.roasGfaData;
  const safe=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt=x=>x===null||x===undefined?'—':Number(x).toLocaleString('ko-KR',{maximumFractionDigits:2}),won=x=>x===null||x===undefined?'미확인':fmt(Math.round(x))+'원',pct=x=>x===null||x===undefined?'—':fmt(x)+'%';
  let parsed=[],pending=null,store=null,busy=false,fileVersion=0,legacyLedger=null,ledgerVersion=0;
  async function api(method='GET',body){const r=await fetch('/api/gfa-analysis',{method,cache:'no-store',headers:{'Content-Type':'application/json','X-ROAS-Local-Action':'yes'},...(body?{body:JSON.stringify(body)}:{})}),data=await r.json();if(!r.ok)throw Error(data.error||'GFA 자료를 불러오지 못했습니다.');return data;}
  function message(id,text,error=false){$(id).textContent=text;$(id).classList.toggle('error',error);}
  function setBusy(value){busy=value;for(const id of ['save','file-save','channel-file','ads-file','report-load'])$(id).disabled=value;}
  function campaignRows(rows){return rows.map(r=>'<tr><td>'+safe(r.name)+'<br><small>'+safe(r.id)+'</small></td><td>'+won(r.spend)+'</td><td>'+won(r.budget)+'</td><td>'+fmt(r.purchases)+'</td><td>'+won(r.revenue)+(r.revenueEstimated||r.estimated?' *':'')+'</td><td>'+pct(m.rate(r.revenue,r.spend))+'</td><td>'+fmt(r.clicks)+'</td><td>'+won(r.clicks>0?m.rate(r.spend,r.clicks,1):r.cpc)+'</td><td>'+pct(r.impressions>0?m.rate(r.clicks,r.impressions):r.ctr)+'</td></tr>').join('')||'<tr><td colspan="9">입력 데이터 없음</td></tr>';}
  function parse(){parsed=m.parseAds($('paste').value);const a=m.metrics(parsed);$('spend').textContent=won(a.spend);$('orders').textContent=fmt(a.purchases);$('sales').textContent=won(a.revenue);$('roas').textContent=pct(a.roas);$('rows').innerHTML=campaignRows(parsed);message('status',parsed.length?parsed.length+'개 캠페인 인식'+(parsed.some(r=>r.revenueEstimated)?' · * 구매매출은 구매 ROAS와 광고비로 역산한 추정값입니다.':''):'캠페인 이름·광고비 열과 데이터 행을 함께 붙여넣으세요.');compare();return parsed;}
  function compare(){const a=m.metrics(parsed),rev=m.number($('lastRevenue').value),orders=m.number($('lastOrders').value);$('lastValue').textContent=won(rev);$('lastCount').textContent=fmt(orders);$('lastRoas').textContent=pct(m.rate(rev,a.spend));$('ratio').textContent=pct(m.rate(a.revenue,rev));}
  function remember(){try{const h=JSON.parse(localStorage.getItem('roas-gfa-display-v1')||'{}');h[$('from').value+' ~ '+$('to').value]={from:$('from').value,to:$('to').value,raw:$('paste').value,lastRevenue:$('lastRevenue').value,lastOrders:$('lastOrders').value};localStorage.setItem('roas-gfa-display-v1',JSON.stringify(h));}catch{/* Server storage is authoritative. */}}
  function history(){
    const h=new Map();try{for(const [key,v] of Object.entries(JSON.parse(localStorage.getItem('roas-gfa-display-v1')||'{}')))h.set(key,{since:v.from,until:v.to,raw:v.raw,lastRevenue:v.lastRevenue,lastOrders:v.lastOrders});}catch{}
    for(const e of store?.entries||[])if(e.kind==='ads')h.set(e.since+' ~ '+e.until,e);
    $('history').replaceChildren();for(const [key,e] of [...h].sort((a,b)=>b[0].localeCompare(a[0]))){const b=document.createElement('button');b.className='secondary';b.textContent=key;b.onclick=()=>{$('from').value=e.since;$('to').value=e.until;$('paste').value=e.raw||'';$('lastRevenue').value=e.lastRevenue||'';$('lastOrders').value=e.lastOrders||'';parse();selectPeriod(e.since,e.until);};$('history').appendChild(b);}
    $('stored-files').innerHTML=(store?.entries||[]).map(e=>'<tr><td>'+safe(e.kind==='ads'?'GFA 성과':'전체채널 파일')+'</td><td>'+safe(e.since+' ~ '+e.until)+'</td><td>'+safe(e.filename||'성과 붙여넣기')+'</td><td>'+fmt(e.rows.length)+'</td><td><button class="secondary" data-load="'+safe(e.id)+'">불러오기</button> <button class="secondary" data-delete="'+safe(e.id)+'">삭제</button></td></tr>').join('')||'<tr><td colspan="5">매주 저장한 자료가 여기에 표시됩니다.</td></tr>';
    refreshLegacyCosts();
  }
  async function refreshLegacyCosts(){
    const version=++ledgerVersion;
    try{const response=await fetch('/api/naver/ad-spend',{cache:'no-store'});if(!response.ok)throw Error('기존 GFA 광고비 조회 실패');const ledger=await response.json();if(version!==ledgerVersion)return;legacyLedger=ledger;
      const rows=ledger.entries.filter(e=>e.channel==='gfa'&&!store?.entries.some(s=>s.kind==='ads'&&s.since===e.since&&s.until===e.until));
      $('legacy-cost-panel').hidden=!rows.length;$('legacy-costs').innerHTML=rows.map(e=>'<tr><td>'+safe(e.since+' ~ '+e.until)+'</td><td>'+won(e.amount)+'</td><td><button class="secondary" data-cost-delete="'+safe(e.id)+'">기존 광고비 삭제</button></td></tr>').join('');
    }catch(e){message('report-status',e.message,true);}
  }
  function selectPeriod(since,until){$('report-from').value=since;$('report-to').value=until;renderReport();}
  function renderReport(){
    if(!store)return;let report;try{report=m.analyze(store.entries,$('report-from').value,$('report-to').value);}catch(e){message('report-status',e.message,true);return;}
    const {ad,ready}=report;
    const tiles=[['GFA 광고비',won(ad.spend)],['GFA 구매 전환매출',won(ad.revenue)],['GFA 구매 ROAS',pct(ad.roas)],['스토어 GFA 마지막 클릭 매출',report.channels.complete?won(report.store.sales):'미확인'],['마지막 클릭 환산 ROAS',pct(report.lastRoas)],['GFA 클릭 / 노출',fmt(ad.clicks)+' / '+fmt(ad.impressions)],['평균 CPC / 구매 CPA',won(ad.cpc)+' / '+won(ad.cpa)],['스토어 GFA 방문 / 결제',report.channels.complete?fmt(report.store.visits)+' / '+fmt(report.store.orders):'미확인']];
    $('combined-kpis').innerHTML=tiles.map(([name,v])=>'<div class="kpi"><span>'+name+'</span><strong>'+v+'</strong></div>').join('');
    message('report-status',(ready?'같은 기간 비교 가능':'비교 자료 확인 필요')+' · GFA 성과 '+report.ads.covered+'일 / 전체채널 '+report.channels.covered+'일'+(report.partial?' · 조회 기간에 걸친 주간 자료 '+report.partial+'개는 배분하지 않고 제외했습니다.':'')+(!report.channelRows.some(r=>r.gfa)?' · 전체채널 파일에서 GFA 경로를 선택해 저장하세요.':'')+(report.estimated?' · GFA 구매매출에 역산 추정값이 포함됩니다.':''));
    $('report-campaigns').innerHTML=campaignRows(report.campaigns);
    const grouped=new Map();for(const r of report.channelRows){const key=JSON.stringify([r.path1,r.path2,r.path3,r.gfa]);if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(r);}
    $('report-channels').innerHTML=[...grouped.values()].map(rows=>{const r=rows[0],visits=m.sum(rows,'visits'),orders=m.sum(rows,'orders'),sales=m.sum(rows,'sales');return '<tr><td>'+safe([r.path1,r.path2,r.path3].filter(Boolean).join(' › '))+(r.gfa?' <span class="badge">GFA 선택</span>':'')+'</td><td>'+fmt(visits)+'</td><td>'+fmt(orders)+'</td><td>'+pct(m.rate(orders,visits))+'</td><td>'+won(sales)+'</td></tr>';}).join('')||'<tr><td colspan="5">전체채널 자료 없음</td></tr>';
    const notes=[];if(ready){notes.push('GFA 광고 보고서 매출과 스토어 마지막 클릭 매출의 차이: '+won(report.revenueGap)+'. 두 매출은 기여 기준이 다르므로 합산하지 않습니다.');if(report.store.conversionRate!==null)notes.push('선택한 GFA 유입 경로의 방문 대비 결제율은 '+pct(report.store.conversionRate)+'입니다.');if(ad.conversionRate!==null)notes.push('GFA 보고서의 클릭 대비 구매 전환율은 '+pct(ad.conversionRate)+'입니다.');}else notes.push('두 자료가 조회 기간 전체를 포함해야 마지막 클릭 환산 ROAS와 매출 차이를 계산합니다. 주간 합계 파일은 저장한 주 단위로 비교하세요.');
    notes.push('전체채널 자료에는 캠페인 ID가 없으므로 캠페인별 실제 매출로 나누지 않습니다. 원가·수수료가 없어 이 화면에서는 순이익을 계산하지 않습니다.');
    $('weekly-records').innerHTML=store.entries.filter(e=>e.kind==='ads').map(e=>{const r=m.analyze(store.entries,e.since,e.until);return '<tr><td>'+safe(e.since+' ~ '+e.until)+'</td><td>'+won(r.ad.spend)+'</td><td>'+fmt(r.ad.purchases)+'</td><td>'+pct(r.ad.roas)+'</td><td>'+(r.ready?won(r.store.sales):'자료 필요')+'</td><td>'+pct(r.lastRoas)+'</td><td><button class="secondary" data-period="'+safe(e.id)+'">비교 보기</button></td></tr>';}).join('')||'<tr><td colspan="7">저장한 GFA 성과가 쌓이면 기간별로 비교할 수 있습니다.</td></tr>';
    $('analysis-notes').replaceChildren(...notes.map(text=>{const p=document.createElement('p');p.textContent=text;return p;}));
    if(ready){$('lastRevenue').value=report.store.sales??'';$('lastOrders').value=report.store.orders??'';compare();}
  }
  function importSummary(stats){if(!stats)return '저장했습니다.';const base='새 자료 '+stats.added+'행 저장 · 이미 있던 날짜·경로 '+stats.duplicates+'행 중복 제외';const problems=stats.conflicts+stats.ambiguous;return base+(problems?' · 값이 달라진 중복 '+stats.conflicts+'행 / 기간 합계와 겹침 '+stats.ambiguous+'행은 보존을 위해 제외 (직접 수정 필요)':'');}
  function preview(){
    $('file-preview').hidden=!pending;if(!pending)return;
    $('file-name').textContent=pending.filename+' · '+pending.rows.length+'개 경로'+(pending.skipped?' · 합계·빈 행·중복 '+pending.skipped+'개 제외':'');
    $('channel-preview').innerHTML=pending.rows.map((r,i)=>'<tr><td><input type="checkbox" aria-label="GFA 비교에 포함: '+safe([r.path1,r.path2,r.path3].join(' '))+'" data-gfa-row="'+i+'" '+(r.gfa?'checked':'')+'></td><td>'+safe([r.path1,r.path2,r.path3].filter(Boolean).join(' › '))+'</td><td>'+safe(r.since?(r.since===r.until?r.since:r.since+' ~ '+r.until):'선택 기간 합계')+'</td><td>'+fmt(r.visits)+'</td><td>'+fmt(r.orders)+'</td><td>'+won(r.sales)+'</td></tr>').join('');
    message('file-status','GFA로 비교할 경로 '+pending.rows.filter(r=>r.gfa).length+'개가 선택되었습니다. 경로와 저장 기간을 확인한 후 저장하세요.');
  }
  async function unzip(buffer){
    const v=new DataView(buffer),bytes=new Uint8Array(buffer),decoder=new TextDecoder();let end=-1;
    for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(v.getUint32(i,true)===0x06054b50){end=i;break;}
    if(end<0)throw Error('엑셀 압축 구조를 읽지 못했습니다. .xlsx로 다시 저장하세요.');
    const count=v.getUint16(end+10,true);let offset=v.getUint32(end+16,true),total=0;const files=new Map();if(count>2000)throw Error('엑셀 파일에 항목이 너무 많습니다.');
    for(let i=0;i<count;i++){
      if(offset+46>bytes.length||v.getUint32(offset,true)!==0x02014b50)throw Error('엑셀 파일이 손상되었습니다.');
      const method=v.getUint16(offset+10,true),size=v.getUint32(offset+20,true),expanded=v.getUint32(offset+24,true),nameLength=v.getUint16(offset+28,true),extra=v.getUint16(offset+30,true),comment=v.getUint16(offset+32,true),local=v.getUint32(offset+42,true),name=decoder.decode(bytes.slice(offset+46,offset+46+nameLength));offset+=46+nameLength+extra+comment;
      if(!/^xl\/(worksheets\/sheet\d+\.xml|sharedStrings\.xml|styles\.xml)$/.test(name))continue;
      total+=expanded;if(total>40000000||expanded>20000000)throw Error('엑셀 내용이 너무 큽니다. 기간을 나누어 내려받으세요.');
      if(local+30>bytes.length||v.getUint32(local,true)!==0x04034b50)throw Error('엑셀 내부 파일이 손상되었습니다.');
      const start=local+30+v.getUint16(local+26,true)+v.getUint16(local+28,true);if(start+size>bytes.length)throw Error('엑셀 내부 길이가 올바르지 않습니다.');
      let data=bytes.slice(start,start+size);if(method===8){const reader=new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader(),chunks=[];let length=0;while(true){const part=await reader.read();if(part.done)break;length+=part.value.length;if(length>expanded||length>20000000){await reader.cancel();throw Error('엑셀 압축 크기가 올바르지 않습니다.');}chunks.push(part.value);}data=new Uint8Array(length);let position=0;for(const chunk of chunks){data.set(chunk,position);position+=chunk.length;}}else if(method!==0)throw Error('지원하지 않는 엑셀 압축 방식입니다.');
      files.set(name,decoder.decode(data));
    }
    return files;
  }
  function xml(text){const doc=new DOMParser().parseFromString(text,'application/xml');if(doc.querySelector('parsererror'))throw Error('엑셀 XML을 읽지 못했습니다.');return doc;}
  async function readGrids(file){
    if(file.size>8*1024*1024)throw Error('파일은 8MB 이하로 넣으세요.');const buffer=await file.arrayBuffer(),bytes=new Uint8Array(buffer);
    if(bytes[0]===0x50&&bytes[1]===0x4b){
      const files=await unzip(buffer),shared=files.has('xl/sharedStrings.xml')?[...xml(files.get('xl/sharedStrings.xml')).getElementsByTagName('si')].map(si=>[...si.getElementsByTagName('t')].map(t=>t.textContent).join('')):[];
      const styles=files.has('xl/styles.xml')?xml(files.get('xl/styles.xml')):null,dateFormats=new Set([14,15,16,17,18,19,20,21,22]);
      if(styles)for(const el of styles.getElementsByTagName('numFmt'))if(/[yd]/i.test(el.getAttribute('formatCode')||''))dateFormats.add(+el.getAttribute('numFmtId'));
      const xfs=styles?.getElementsByTagName('cellXfs')[0],dateStyles=xfs?[...xfs.children].map(x=>dateFormats.has(+x.getAttribute('numFmtId'))):[];
      return [...files].filter(([name])=>name.startsWith('xl/worksheets/')).slice(0,20).map(([,text])=>[...xml(text).getElementsByTagName('row')].map(row=>{const cells=[];for(const c of row.getElementsByTagName('c')){const letters=(c.getAttribute('r')||'A1').match(/^[A-Z]+/)[0];let index=0;for(const ch of letters)index=index*26+ch.charCodeAt(0)-64;const type=c.getAttribute('t'),value=c.getElementsByTagName('v')[0]?.textContent??'';let result=type==='s'?shared[+value]||'':type==='inlineStr'?[...c.getElementsByTagName('t')].map(t=>t.textContent).join(''):value;if(type!=='s'&&type!=='inlineStr'&&value&&dateStyles[+c.getAttribute('s')])result=new Date(Date.UTC(1899,11,30)+Math.floor(+value)*86400000).toISOString().slice(0,10);cells[index-1]=result;}return cells;}));
    }
    if(bytes[0]===0xd0&&bytes[1]===0xcf)throw Error('이 .xls 파일은 이전 엑셀 형식입니다. 엑셀에서 .xlsx로 저장한 뒤 넣어주세요.');
    let text=new TextDecoder('utf-8').decode(buffer);if(text.includes('\uFFFD'))text=new TextDecoder('euc-kr').decode(buffer);
    if(/<(?:html|table)\b/i.test(text)){const doc=new DOMParser().parseFromString(text,'text/html');return [...doc.querySelectorAll('table')].map(t=>[...t.rows].map(r=>[...r.cells].map(c=>c.textContent.trim())));}
    if(/<Workbook\b/i.test(text)){const doc=xml(text);return [[...doc.getElementsByTagName('Row')].map(r=>[...r.getElementsByTagName('Cell')].map(c=>c.textContent.trim()))];}
    return [m.delimited(text)];
  }
  async function loadAdsFile(){
    const file=$('ads-file').files[0];if(!file||busy)return;setBusy(true);
    try{
      const grids=await readGrids(file);let rows=[];
      for(const grid of grids){rows=m.adsFromGrid(grid);if(rows.length)break;}
      if(!rows.length)throw Error('캠페인 이름과 실제 총비용이 있는 표를 찾지 못했습니다. 설정 예산만으로는 ROAS를 계산할 수 없습니다.');
      const field=['캠페인 이름','캠페인 ID','상태','총비용','캠페인 예산','구매완료 수','구매완료 전환매출액','노출수','클릭수','평균 CPC','클릭률(%)'];
      const fmtCell=v=>v===null||v===undefined?'':String(v);
      $('paste').value=[field.join('\t'),...rows.map(r=>[r.name,r.id,r.status,r.spend,r.budget,r.purchases,r.revenue,r.impressions,r.clicks,r.cpc,r.ctr].map(fmtCell).join('\t'))].join('\n');
      const period=m.dates(file.name);if(period.length>=2){$('from').value=period[0];$('to').value=period[1];}
      parse();message('status',file.name+' · '+rows.length+'개 캠페인 인식 · 실제 총비용과 설정 예산을 구분했습니다. 날짜를 확인한 뒤 GFA 광고비·성과 저장을 누르세요.');
    }catch(e){message('status','GFA 비용 파일 읽기 실패: '+e.message,true);}finally{setBusy(false);}
  }
  async function persistChannel(automatic=false){
    if(busy||!pending)return;
    setBusy(true);
    try{
      // Read the latest revision rather than trusting another tab's stale state.
      store=await api();
      const response=await api('POST',{kind:'channels',since:$('file-since').value,until:$('file-until').value,filename:pending.filename,rows:pending.rows,revision:store.revision,replaceExisting:!automatic});
      store=response;history();selectPeriod($('file-since').value,$('file-until').value);
      message('file-status',(automatic?'첨부한 전체채널 파일을 자동 저장했습니다. ':'전체채널 자료를 저장했습니다. ')+importSummary(response.importStats)+
        (pending.skipped?' · 파일 안의 빈 행·합계·중복 '+pending.skipped+'행 제외':''));
    }catch(e){message('file-status',(automatic?'자동 저장 확인 필요: ':'저장 확인 필요: ')+e.message,true);}
    finally{setBusy(false);}
  }
  async function loadFile(){
    const file=$('channel-file').files[0],version=++fileVersion;
    pending=null;preview();if(!file||busy)return;
    setBusy(true);message('file-status','파일 날짜·유입 경로 분석 중…');
    let auto=false;
    try{
      const grids=await readGrids(file);let result,lastError;
      for(const grid of grids){try{result=m.parseChannels(grid,file.name);break;}catch(e){lastError=e;}}
      if(!result)throw lastError||Error('전체채널 표를 찾지 못했습니다.');
      if(version!==fileVersion)return;
      pending={...result,filename:file.name};
      $('file-since').value=result.since||$('from').value;
      $('file-until').value=result.until||$('to').value;
      preview();
      auto=!!result.since&&!!result.until&&m.validDate(result.since)&&m.validDate(result.until)&&result.since<=result.until;
      if(!auto)message('file-status','파일에서 조회 날짜를 확인할 수 없습니다. 파일 시작일·종료일을 직접 선택하고 저장 버튼을 누르세요.');
    }catch(e){message('file-status',e.message,true);}
    finally{if(version===fileVersion)setBusy(false);}
    if(version===fileVersion&&auto)await persistChannel(true);
  }
  $('weekly-records').onclick=e=>{const entry=store?.entries.find(r=>r.id===e.target.dataset.period);if(entry)selectPeriod(entry.since,entry.until);};
  $('legacy-costs').onclick=async e=>{const entry=legacyLedger?.entries.find(r=>r.id===e.target.dataset.costDelete);if(!entry||busy)return;if(!confirm(entry.since+' ~ '+entry.until+'의 기존 GFA 광고비 '+won(entry.amount)+'를 삭제할까요? 주간 성과를 저장하면 새 금액으로 반영됩니다.'))return;setBusy(true);try{const response=await fetch('/api/naver/ad-spend',{method:'DELETE',headers:{'Content-Type':'application/json','X-ROAS-Local-Action':'yes'},body:JSON.stringify({id:entry.id,revision:legacyLedger.revision})}),value=await response.json();if(!response.ok)throw Error(value.error||'기존 광고비 삭제 실패');await refreshLegacyCosts();message('report-status','기존 광고비를 삭제했습니다. 주간 GFA 성과를 저장하세요.');}catch(err){message('report-status',err.message,true);}finally{setBusy(false);}};
  $('parse').onclick=parse;$('compare').onclick=compare;
  $('clear').onclick=()=>{$('paste').value='';parse();};
  $('save').onclick=async()=>{if(busy)return;parse();if(!parsed.length)return;setBusy(true);try{if(!store)store=await api();const current=await fetch('/api/naver/ad-spend',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('광고비 저장 상태를 불러오지 못했습니다.');return r.json();});store=await api('POST',{kind:'ads',since:$('from').value,until:$('to').value,raw:$('paste').value,rows:parsed,revision:store.revision,spendRevision:current.revision});remember();history();selectPeriod($('from').value,$('to').value);message('status','GFA 광고비와 캠페인 성과를 프로그램에 저장하고 전체 통계에 반영했습니다.');document.dispatchEvent(new Event('roas:meta-cache-updated'));}catch(e){message('status','저장 확인 필요: '+e.message,true);}finally{setBusy(false);}};
  $('channel-file').onchange=loadFile;
  $('ads-file').onchange=loadAdsFile;
  const drop=$('file-drop');drop.ondragover=e=>{e.preventDefault();drop.classList.add('dragging');};drop.ondragleave=()=>drop.classList.remove('dragging');drop.ondrop=e=>{e.preventDefault();drop.classList.remove('dragging');if(busy)return;if(e.dataTransfer.files.length!==1){message('file-status','한 번에 파일 하나씩 넣으세요.',true);return;}$('channel-file').files=e.dataTransfer.files;loadFile();};
  $('channel-preview').onchange=e=>{const index=e.target.dataset.gfaRow;if(index===undefined||!pending)return;pending.rows[+index].gfa=e.target.checked;message('file-status','GFA로 비교할 경로 '+pending.rows.filter(r=>r.gfa).length+'개 선택 · 저장하면 비교에 반영됩니다.');};
  $('file-save').onclick=()=>persistChannel(false);
  $('report-load').onclick=async()=>{if(busy)return;setBusy(true);try{store=await api();history();renderReport();}catch(e){message('report-status',e.message,true);}finally{setBusy(false);}};
  $('stored-files').onclick=async e=>{const id=e.target.dataset.load||e.target.dataset.delete,entry=store?.entries.find(r=>r.id===id);if(!entry||busy)return;if(e.target.dataset.load){selectPeriod(entry.since,entry.until);if(entry.kind==='ads'){$('from').value=entry.since;$('to').value=entry.until;$('paste').value=entry.raw;parse();}else{pending=structuredClone(entry);$('file-since').value=entry.since;$('file-until').value=entry.until;preview();}return;}if(!confirm('이 '+(entry.kind==='ads'?'GFA 성과와 같은 기간의 GFA 광고비':'전체채널 자료')+'를 삭제할까요?'))return;setBusy(true);try{store=await api('DELETE',{id:entry.id,revision:store.revision});if(entry.kind==='ads'){try{const h=JSON.parse(localStorage.getItem('roas-gfa-display-v1')||'{}');delete h[entry.since+' ~ '+entry.until];localStorage.setItem('roas-gfa-display-v1',JSON.stringify(h));}catch{}}history();renderReport();message('report-status','선택한 자료를 삭제했습니다.');}catch(err){message('report-status',err.message,true);}finally{setBusy(false);}};
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),shift=n=>new Date(Date.parse(today+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
  for(const id of ['from','file-since','report-from'])$(id).value=shift(-7);for(const id of ['to','file-until','report-to'])$(id).value=shift(-1);
  api().then(value=>{store=value;history();if(store.entries.length)selectPeriod(store.entries[0].since,store.entries[0].until);else renderReport();}).catch(e=>message('report-status',e.message,true));
})();
