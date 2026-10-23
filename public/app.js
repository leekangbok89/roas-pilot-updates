'use strict';
const $=id=>document.getElementById(id);
const state={rows:[],selected:null,currency:'KRW',source:'demo',hasDate:true,channel:'all',fxRate:1350,fxMode:'fixed',fxMeta:'고정 환율'};
const visibleRows=()=>state.channel==='all'?state.rows:state.rows.filter(r=>r.channel===state.channel);
const dollars=n=>n==null?'—':'$'+new Intl.NumberFormat('en-US',{maximumFractionDigits:2,minimumFractionDigits:2}).format(n);
const dual=n=>state.source==='api'&&n!=null?`${won(n)} ($${new Intl.NumberFormat('en-US',{maximumFractionDigits:2,minimumFractionDigits:2}).format(n/state.fxRate)})`:won(n);
const won=n=> n==null?'—':new Intl.NumberFormat('ko-KR',{maximumFractionDigits:0}).format(n)+'원';
const num=n=>new Intl.NumberFormat('ko-KR',{maximumFractionDigits:0}).format(n||0);
const pct=n=>n==null?'—':new Intl.NumberFormat('ko-KR',{maximumFractionDigits:1}).format(n)+'%';
const safe=(s)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const parseNum=v=>{if(typeof v==='number')return v;if(v==null||v==='')return null;const t=String(v).replace(/[,₩$%\s]/g,'').replace(/[−–]/g,'-');const n=Number(t);return Number.isFinite(n)?n:null;};
const get=(o,...keys)=>{for(const k of keys){if(o[k]!==undefined&&o[k]!==null&&o[k]!=='')return o[k];}return null;};
function valueAction(actions,types){if(!Array.isArray(actions))return null;for(const type of types){const found=actions.find(a=>a.action_type===type);if(found)return parseNum(found.value);}return null;}
const purchaseTypes=['offsite_conversion.fb_pixel_purchase','omni_purchase','purchase','onsite_web_purchase','onsite_conversion.purchase'];
const checkoutTypes=['offsite_conversion.fb_pixel_initiate_checkout','omni_initiated_checkout','initiate_checkout'];
const cartTypes=['offsite_conversion.fb_pixel_add_to_cart','omni_add_to_cart','add_to_cart'];
const landingTypes=['landing_page_view','omni_landing_page_view'];
function normalizeApi(r){const actions=r.actions||[],values=r.action_values||[];let purchases=valueAction(actions,purchaseTypes);let revenue=valueAction(values,purchaseTypes);const fallbackRoas=valueAction(r.website_purchase_roas,purchaseTypes)??valueAction(r.purchase_roas,purchaseTypes);const spend=parseNum(r.spend)||0;
if(revenue==null&&fallbackRoas!=null) revenue=spend*fallbackRoas;
return {id:r.ad_id||r.ad_name,ad:r.ad_name||'광고 이름 없음',adset:r.adset_name||'',campaign:r.campaign_name||'',date:r.date_start||'',spend,impressions:parseNum(r.impressions),reach:parseNum(r.reach),clicks:parseNum(r.inline_link_clicks),landing:valueAction(actions,landingTypes),cart:valueAction(actions,cartTypes),checkout:valueAction(actions,checkoutTypes),purchases,revenue,quality:r.quality_ranking||'',convQuality:r.conversion_rate_ranking||'',currency:r.account_currency||'KRW',source:'api'};}
function parseCSV(text){text=text.replace(/^\uFEFF/,'');const out=[];let row=[],cell='',quoted=false;
for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){row.push(cell);cell='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(x=>x.trim()))out.push(row);row=[];cell='';}else cell+=c;}
if(quoted)throw Error('CSV 따옴표가 정상적으로 닫히지 않았습니다.');row.push(cell);if(row.some(x=>x.trim()))out.push(row);
if(out.length<2)throw Error('CSV에 머리글과 데이터 행이 필요합니다.');const header=out.shift().map(x=>x.trim().replace(/^\uFEFF/,''));return out.map(r=>Object.fromEntries(header.map((h,i)=>[h,(r[i]||'').trim()])));}
function val(o,names){const keys=Object.keys(o);for(const name of names){if(o[name]!=null&&o[name]!=='')return o[name];const k=keys.find(k=>k.trim().toLowerCase()===name.toLowerCase());if(k&&o[k]!=='')return o[k];}return null;}
function normalizeCSV(o,i){const v=names=>val(o,names);const spend=parseNum(v(['지출 금액 (KRW)','지출 금액','금액 지출','지출','Amount spent (KRW)','Amount spent','spend']))||0;
const purchases=parseNum(v(['웹사이트 구매','웹사이트 구매 수','구매','구매 수','Website purchases','Purchases','purchases','website_purchases']));
const revenue=parseNum(v(['구매 전환값','웹사이트 구매 전환값','구매 전환 가치','구매 가치','구매 매출','Purchases conversion value','Website purchases conversion value','Purchase conversion value','Purchase conversion values','revenue','purchase_value']));
const roas=parseNum(v(['웹사이트 구매 ROAS (광고 지출 대비 수익률)','구매 ROAS (광고 지출 대비 수익률)','구매 ROAS','웹사이트 구매 ROAS','Website purchase ROAS (return on ad spend)','Purchase ROAS (return on ad spend)','Purchase ROAS','website_purchase_roas','purchase_roas']));
const date=v(['보고 시작','보고 시작일','보고 시작 날짜','날짜','일','Reporting starts','Day','Date','date_start','date']);
const ad=v(['광고 이름','광고명','Ad name','ad_name','ad'])||'이름 없음';
const adset=v(['광고 세트 이름','Ad set name','adset_name'])||'';
const campaign=v(['캠페인 이름','Campaign name','campaign_name'])||'';
const impressions=parseNum(v(['노출','노출수','Impressions','impressions']));
const reach=parseNum(v(['도달','Reach','reach']));
const clicks=parseNum(v(['링크 클릭','인라인 링크 클릭','링크 클릭 수','Link clicks','Inline link clicks','inline_link_clicks','link_clicks']));
const landing=parseNum(v(['랜딩 페이지 조회','랜딩 페이지 조회 수','Landing page views','landing_page_views']));
const cart=parseNum(v(['장바구니에 담기','장바구니 담기','장바구니 추가','Adds to cart','Add to carts','add_to_cart']));
const checkout=parseNum(v(['결제 시작','결제 시작 수','Checkouts initiated','Initiate checkouts','initiate_checkout']));
const id=v(['광고 ID','Ad ID','ad_id'])||[campaign,adset,ad].join('::');
return {id,ad,adset,campaign,date:date||'',spend,impressions,reach,clicks,landing,cart,checkout,purchases,revenue:revenue??(roas==null?null:spend*roas),currency:'KRW',source:'csv'};}
function demo(){const names=[['새벽수유_15초_영상','전환_육아맘','백도씨 구매 캠페인',420,42,4.2],['100도_직접끓임_이미지','전환_관심사','백도씨 구매 캠페인',340,37,3.2],['유리포트_세척편의성','전환_리타게팅','백도씨 구매 캠페인',280,31,3],['제품기능_종합안내','전환_육아맘','백도씨 구매 캠페인',135,24,2.4],['가격할인_카드뉴스','전환_관심사','백도씨 구매 캠페인',90,20,1.7],['리뷰_사용후기','전환_육아맘','백도씨 구매 캠페인',0,9,2.1]];const result=[];for(let d=0;d<14;d++){for(let i=0;i<names.length;i++){const [ad,adset,campaign,roas,base,ctr]=names[i];const spend=(base*1000)+(d%4)*1400+i*350;const purchases=roas===0?0:Math.max(0,Math.floor((spend/(base*1000)*roas/100)*(d%5===0?.6:1.15)));const impressions=Math.floor(spend/(12000+i*600)*1000);const clicks=Math.round(impressions*ctr/100);const date=new Date(Date.UTC(2026,9,8+d)).toISOString().slice(0,10);result.push({id:'demo-'+i,ad,adset,campaign,date,spend,impressions,reach:Math.round(impressions/(1.25+(d%4)*.04)),clicks,landing:Math.round(clicks*.79),cart:Math.round(clicks*.14),checkout:Math.round(clicks*.09),purchases,revenue:purchases*(base*1000)*(roas/100),currency:'KRW',source:'demo'});}}return result;}
function aggregate(rows){const map=new Map();for(const r of rows){const key=String(r.channel||'')+'::'+String(r.id||r.ad);let a=map.get(key);if(!a){a={...r,days:0,dates:new Set(),has:{},quality:r.quality||'',convQuality:r.convQuality||''};for(const f of ['spend','impressions','reach','clicks','landing','cart','checkout','purchases','revenue'])a[f]=0;map.set(key,a);}a.days++;if(r.date)a.dates.add(r.date);for(const f of ['spend','impressions','reach','clicks','landing','cart','checkout','purchases','revenue']){if(r[f]!=null&&Number.isFinite(r[f])){a[f]+=r[f];a.has[f]=true;}}}
return [...map.values()].map(a=>{for(const f of ['spend','impressions','clicks','landing','cart','checkout','purchases','revenue'])if(!a.has[f])a[f]=null;
// Reach is non-additive across dates: daily reach is NOT unique reach for the period.
a.reach= a.dates.size>1?null:(a.has.reach?a.reach:null);
a.roas=a.spend>0&&a.revenue!=null?a.revenue/a.spend*100:null;
a.cpa=a.purchases>0&&a.spend!=null?a.spend/a.purchases:null;
a.cpc=a.clicks>0&&a.spend!=null?a.spend/a.clicks:null;
a.ctr=a.impressions>0&&a.clicks!=null?a.clicks/a.impressions*100:null;
a.frequency=a.reach>0&&a.impressions!=null?a.impressions/a.reach:null;
return a;});}
function settings(){return {roas:Math.max(50,Number($('target-roas').value)||300),cpa:Math.max(1000,Number($('target-cpa').value)||40000),min:Math.max(1,Number($('min-purchases').value)||3)};}
function diagnose(a,c){const reasons=[],actions=[];let status='learn';const havePurchase=a.purchases!=null,haveRevenue=a.revenue!=null;
if(!havePurchase||!haveRevenue){reasons.push('구매 수 또는 구매 전환값 데이터가 없어 ROAS/CPA를 확정할 수 없습니다.');actions.push('Ads Manager 열 맞춤에서 웹사이트 구매와 구매 전환값을 포함해 다시 다운로드하세요.');return {status,reasons,actions};}
if(a.spend<=0){reasons.push('광고비가 없거나 0으로 기록되었습니다.');actions.push('분석 기간과 지출 열을 확인하세요.');return {status,reasons,actions};}
if(a.purchases===0){if(a.spend>=c.cpa*1.5){status='review';reasons.push(`구매가 0건인데 목표 CPA의 1.5배 이상 (${won(a.spend)}) 지출되었습니다.`);actions.push('픽셀 Purchase 이벤트와 기여 설정을 확인하고, 소재/랜딩 문제를 검토한 뒤 일시중단을 판단하세요.');}else{reasons.push('아직 구매가 없으며, 중단 판단에 필요한 지출 기준에 도달하지 않았습니다.');actions.push('목표 CPA 대비 충분한 학습 지출을 확보하고 관찰하세요.');}}
else if(a.purchases<c.min){reasons.push(`구매 ${num(a.purchases)}건으로 최소 판단 기준 ${c.min}건에 미달합니다.`);actions.push('광고비 과소·학습 초기라면 더 관찰하고, CPA 추세를 함께 확인하세요.');}
else if(a.roas>=c.roas*1.2&&a.cpa<=c.cpa){status='scale';reasons.push(`ROAS ${pct(a.roas)}가 목표 ${pct(c.roas)}보다 20% 이상 높고, CPA도 목표 이내입니다.`);actions.push('예산을 한 번에 크게 올리지 말고 10~20% 증액 후 3~7일 추적하세요.');}
else if(a.roas>=c.roas&&a.cpa<=c.cpa){status='keep';reasons.push('ROAS와 CPA 목표를 모두 충족합니다.');actions.push('소재 유지, 빈도와 최근 ROAS 변동 모니터링을 권장합니다.');}
else{status='improve';reasons.push(`ROAS ${pct(a.roas)} / CPA ${won(a.cpa)}로 설정한 수익성 조건 중 하나 이상을 충족하지 않습니다.`);actions.push('소재 후킹, 제품 USP, 랜딩페이지 구매 전환율을 분리 점검하세요.');}
if(a.clicks!=null&&a.landing!=null&&a.clicks>=30){const ratio=a.landing/a.clicks;if(ratio<.65){reasons.push(`링크 클릭 대비 랜딩 조회 비율이 ${pct(ratio*100)}로 낮습니다.`);actions.push('모바일 페이지 로딩, 광고 링크 및 브라우저 호환성을 확인하세요.');}}
if(a.landing!=null&&a.landing>=70&&a.purchases!=null&&a.purchases/a.landing<.01){reasons.push(`랜딩 조회 대비 구매율이 ${pct(a.purchases/a.landing*100)}입니다.`);actions.push('상세페이지 가격·배송·후기·결제 단계 이탈을 우선 확인하세요.');}
if(a.cpc!=null&&a.clicks>=30){reasons.push(`링크 CPC ${won(a.cpc)} · 링크 클릭 ${num(a.clicks)}회입니다.`);actions.push('CPC만으로 광고 중단을 판단하지 말고 구매 CPA·ROAS와 함께 비교하세요.');}
if(a.frequency==null&&a.dates?.size>1){reasons.push('전체 기간의 고유 도달을 일별 데이터만으로 복원할 수 없어 빈도를 표시하지 않습니다.');actions.push('정확한 기간 전체 빈도는 Meta 광고 관리자에서 같은 기간의 광고별 빈도를 확인하세요.');}
if(a.frequency!=null&&a.frequency>=3.5){reasons.push(`노출 빈도 ${a.frequency.toFixed(1)}회로 반복 노출이 높습니다.`);actions.push('신규 소재/타깃 실험을 검토하세요. 빈도만으로 중단하지는 마세요.');}
if(a.ctr!=null&&a.ctr<1&&a.impressions>=1000){reasons.push(`링크 CTR ${pct(a.ctr)}로 클릭 유도가 약할 수 있습니다.`);actions.push('첫 3초 훅, 썸네일, 제품 차별점 및 CTA를 A/B 테스트하세요.');}
return {status,reasons,actions};}
const statusNames={scale:'확대 검토',keep:'유지',improve:'개선 검토',review:'중단 검토',learn:'데이터 부족'};
function totals(ads){const out={};for(const f of ['spend','impressions','clicks','landing','cart','checkout','purchases','revenue']){let present=false;let sum=0;for(const a of ads){if(a[f]!=null){sum+=a[f];present=true;}}out[f]=present?sum:null;}out.roas=out.spend>0&&out.revenue!=null?out.revenue/out.spend*100:null;out.cpa=out.purchases>0?out.spend/out.purchases:null;return out;}
function plot(){const dated=new Map();for(const r of visibleRows()){if(!/^\d{4}-\d{2}-\d{2}$/.test(r.date||''))continue;const o=dated.get(r.date)||{spend:0,revenue:0,hasRevenue:false};o.spend+=(r.spend||0);if(r.revenue!=null){o.revenue+=r.revenue;o.hasRevenue=true;}dated.set(r.date,o);}const days=[...dated.entries()].sort((a,b)=>a[0].localeCompare(b[0]));if(days.length<2){$('chart').innerHTML='<div class="empty">일별 데이터가 없거나 기간 합계 CSV입니다. Meta API 또는 일별 CSV를 이용하세요.</div>';return;}
const valid=days.map(([d,v])=>({date:d,value:v.spend>0&&v.hasRevenue?v.revenue/v.spend*100:null}));const w=660,h=226,l=44,r=16,t=13,b=38;const max=Math.max(settings().roas*1.3,...valid.map(x=>x.value||0),100);const y=x=>t+(h-b-t)*(1-x/max);const x=i=>l+i*(w-l-r)/(valid.length-1);let grid='';for(let k=0;k<=4;k++){let yy=t+(h-b-t)*k/4;grid+=`<line x1="${l}" y1="${yy}" x2="${w-r}" y2="${yy}" stroke="#edf0f7"/><text x="${l-8}" y="${yy+4}" font-size="11" text-anchor="end" fill="#9ba7b8">${Math.round(max*(1-k/4))}%</text>`;}
const coords=valid.map((v,i)=>v.value==null?null:[x(i),y(v.value)]);let segments=[],seg=[];for(const p of coords){if(p)seg.push(p);else if(seg.length){segments.push(seg);seg=[];}}if(seg.length)segments.push(seg);
const paths=segments.map(s=>`<polyline fill="none" stroke="#6b61ef" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" points="${s.map(p=>p.join(',')).join(' ')}"/>`).join('');const dots=coords.map((p,i)=>p?`<circle cx="${p[0]}" cy="${p[1]}" r="3.8" fill="#6b61ef"><title>${valid[i].date}: ${pct(valid[i].value)}</title></circle>`:'').join('');const goalY=y(settings().roas);
const labels=valid.map((v,i)=>i===0||i===valid.length-1||i%Math.max(1,Math.ceil(valid.length/5))===0?`<text x="${x(i)}" y="${h-9}" font-size="11" text-anchor="middle" fill="#9ba7b8">${v.date.slice(5)}</text>`:'').join('');
$('chart').innerHTML=`<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="날짜별 ROAS 선 그래프">${grid}<line x1="${l}" y1="${goalY}" x2="${w-r}" y2="${goalY}" stroke="#eba964" stroke-dasharray="4 5"/><text x="${w-r-4}" y="${goalY-5}" text-anchor="end" font-size="10" fill="#b58b49">목표 ${pct(settings().roas)}</text>${paths}${dots}${labels}</svg>`;}
function render(){const c=settings(),ads=aggregate(visibleRows()).map(a=>({...a,diagnosis:diagnose(a,c)}));state.ads=ads;updateDiagnosisHierarchy();const t=totals(ads);$('k-spend').textContent=won(t.spend);$('k-revenue').textContent=won(t.revenue);$('k-roas').textContent=pct(t.roas);$('k-cpa').textContent=won(t.cpa);$('k-spend-usd').textContent=state.source==='api'?dollars(t.spend/state.fxRate)+' (USD 환산)':'';$('k-revenue-usd').textContent=state.source==='api'?dollars(t.revenue==null?null:t.revenue/state.fxRate)+' (USD 환산)':'Meta 귀속 구매 전환값';$('k-cpa-usd').textContent=state.source==='api'?dollars(t.cpa==null?null:t.cpa/state.fxRate)+' (USD 환산)':'';$('k-ads').textContent=`광고 ${num(ads.length)}개`;if($('channel-metrics'))$('channel-metrics').textContent=`현재 ${state.channel==='all'?'전체 통합':state.channel==='naver'?'네이버 스마트스토어':'카페24 자사몰'} · 광고 ${num(ads.length)}개`;$('k-goal').textContent=`목표 ROAS ${pct(c.roas)}`;$('k-purchases').textContent=t.purchases==null?'구매 데이터 없음':`구매 ${num(t.purchases)}건`;
const counts={scale:0,keep:0,improve:0,review:0,learn:0};ads.forEach(a=>counts[a.diagnosis.status]++);$('summary').innerHTML=[['↗','확대 검토',`${counts.scale}개 광고 · 목표 이상이며 충분한 구매 데이터가 있는 광고`],['◇','개선 / 중단 검토',`${counts.improve+counts.review}개 광고 · 구매 전환 및 지출 효율 확인 필요`],['◷','데이터 부족',`${counts.learn}개 광고 · 성급한 중단 대신 학습 관찰 필요`]].map(q=>`<div class="summary-item"><span class="s-icon">${q[0]}</span><div><b>${q[1]}</b><p>${q[2]}</p></div></div>`).join('');
const steps=[['링크 클릭',t.clicks,null],['랜딩 조회',t.landing,t.clicks],['장바구니',t.cart,t.landing],['결제 시작',t.checkout,t.cart],['구매',t.purchases,t.checkout]];
$('funnel-grid').innerHTML=steps.map(([name,n,prior])=>`<div class="funnel-step"><small>${name}</small><strong>${n==null?'미수집':num(n)}</strong><span class="rate">${prior==null||n==null?'비율 계산 불가':prior===0?'이전 단계 0':`이전 단계 대비 ${pct(n/prior*100)}`}</span></div>`).join('');
const q=$('search').value.trim().toLowerCase(),filter=$('filter').value;
const chosenChannel=$('diag-channel').value,chosenCampaign=$('diag-campaign').value,chosenSet=$('diag-adset').value,chosenAd=$('diag-ad').value;
const compareKey=(r,level)=>level==='campaign'?JSON.stringify([r.channel||'',r.campaign||'']):level==='adset'?JSON.stringify([r.channel||'',r.campaign||'',r.adset||'']):JSON.stringify([r.channel||'',r.campaign||'',r.adset||'',String(r.id||r.ad||'')]);
const shown=ads.filter(a=>(chosenChannel==='all'||a.channel===chosenChannel)&&(!chosenCampaign||compareKey(a,'campaign')===chosenCampaign)&&(!chosenSet||compareKey(a,'adset')===chosenSet)&&(!chosenAd||compareKey(a,'ad')===chosenAd)&&(!q||[a.ad,a.adset,a.campaign].join(' ').toLowerCase().includes(q))&&(filter==='all'||a.diagnosis.status===filter)).sort((a,b)=>b.spend-a.spend);
$('ad-body').innerHTML=shown.length?shown.map(a=>`<tr class="ad-row ${state.selected===a.id?'selected':''}" data-id="${safe(a.id)}"><td><b>${a.channel?`[${a.channel==='naver'?'네이버':'카페24'}] `:''}${safe(a.ad)}</b><small>${safe(a.campaign)} / ${safe(a.adset)}</small></td><td>${dual(a.spend)}</td><td>${a.purchases==null?'—':num(a.purchases)}</td><td>${dual(a.revenue)}</td><td><b>${pct(a.roas)}</b></td><td>${dual(a.cpa)}</td><td>${dual(a.cpc)}</td><td>${pct(a.ctr)}</td><td>${a.frequency==null?'—':a.frequency.toFixed(1)}</td><td><span class="stat ${a.diagnosis.status}">${statusNames[a.diagnosis.status]}</span></td></tr>`).join(''):'<tr><td colspan="10">조건에 해당하는 광고가 없습니다.</td></tr>';
$('table-footer').textContent=`광고 ${shown.length}개 표시 · 기간 합계 CSV는 일별 추이가 없으며, 기간 중 중복 도달은 합산하지 않습니다.`;
for(const el of document.querySelectorAll('.ad-row'))el.addEventListener('click',()=>{state.selected=el.dataset.id;render();$('detail').scrollIntoView({behavior:'smooth',block:'nearest'});});
const chosen=ads.find(a=>String(a.id)===String(state.selected));if(chosen){$('detail-title').textContent=`${chosen.ad} · ${chosen.campaign}`;$('detail-status').className=`status ${chosen.diagnosis.status}`;$('detail-status').textContent=statusNames[chosen.diagnosis.status];const chips=[['ROAS',pct(chosen.roas)],['CPA',dual(chosen.cpa)],['링크 CPC',dual(chosen.cpc)],['빈도',chosen.frequency==null?'기간 전체 미확인':chosen.frequency.toFixed(2)+'회'],['랜딩 조회',chosen.landing==null?'미수집':num(chosen.landing)],['구매 전환율',chosen.landing>0&&chosen.purchases!=null?pct(chosen.purchases/chosen.landing*100):'—'],['링크 CTR',pct(chosen.ctr)],['도달',chosen.reach==null?'일별 중복·미수집':num(chosen.reach)]];$('detail-body').classList.remove('muted');$('detail-body').innerHTML=`<div class="detail-metrics">${chips.map(([k,v])=>`<div class="metric-chip">${k}<strong>${v}</strong></div>`).join('')}</div><div class="reasons"><div class="reason-box"><h3>진단 근거</h3><ul>${chosen.diagnosis.reasons.map(x=>`<li>${safe(x)}</li>`).join('')}</ul></div><div class="reason-box"><h3>추천 액션</h3><ul>${chosen.diagnosis.actions.map(x=>`<li>${safe(x)}</li>`).join('')}</ul></div></div>`;}else{$('detail-title').textContent='목록에서 광고를 선택하세요.';$('detail-status').textContent='선택 대기';$('detail-status').className='status neutral';$('detail-body').textContent='성과표의 행을 누르면 진단 근거가 표시됩니다.';$('detail-body').classList.add('muted');}
plot();if(typeof renderComparison==='function')renderComparison();}
function load(rows,source,currency='KRW'){state.rows=rows.map(r=>source==='api'?{...r,rawSpend:r.spend,rawRevenue:r.revenue,spend:r.spend*(r.currency==='USD'?state.fxRate:1),revenue:r.revenue==null?null:r.revenue*(r.currency==='USD'?state.fxRate:1)}:r);state.channel='all';$('channel-filter').value='all';$('channel-bar').hidden=!(source==='api'&&rows.some(r=>r.channel));state.currency=currency;state.source=source;state.selected=null;$('data-badge').textContent={api:'● Meta API 데이터',csv:'● CSV 업로드 데이터',demo:'● 샘플 데이터'}[source];$('source-status').textContent={api:'Meta API · 조회 완료',csv:'CSV · 분석 준비 완료',demo:'데모 데이터 활성화'}[source];$('message').textContent=rows.length? '': '선택한 기간의 광고 데이터가 없습니다.';if(source==='api')$('message').textContent=`Meta 원본 통화: ${currency} · USD 금액은 1달러 ${num(state.fxRate)}원으로 환산 · ${state.fxMeta} · ROAS는 환율과 무관합니다.`;render();}
function csvExport(){const cols=['광고 ID','캠페인','광고 세트','광고명','지출(KRW)','지출(USD 환산)','구매','매출(KRW)','매출(USD 환산)','ROAS (%)','CPA(KRW)','CPA(USD 환산)','링크 CPC(KRW)','링크 CPC(USD 환산)','링크 CTR (%)','빈도(회)','판단','근거','권장 조치'];const quote=s=>'"'+String(s??'').replace(/"/g,'""')+'"';const lines=[cols,...(state.ads||[]).map(a=>[a.id,a.campaign,a.adset,a.ad,a.spend,state.source==='api'?(a.spend/state.fxRate).toFixed(2):'',a.purchases,a.revenue,state.source==='api'&&a.revenue!=null?(a.revenue/state.fxRate).toFixed(2):'',a.roas?.toFixed(2),a.cpa?.toFixed(0),state.source==='api'&&a.cpa!=null?(a.cpa/state.fxRate).toFixed(2):'',a.cpc?.toFixed(0),state.source==='api'&&a.cpc!=null?(a.cpc/state.fxRate).toFixed(2):'',a.ctr?.toFixed(2),a.frequency?.toFixed(2),statusNames[a.diagnosis.status],a.diagnosis.reasons.join(' / '),a.diagnosis.actions.join(' / ')])].map(r=>r.map(quote).join(','));const blob=new Blob(['\uFEFF'+lines.join('\r\n')],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`meta_roas_diagnosis_${new Date().toISOString().slice(0,10)}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function readFile(file){const b=await file.arrayBuffer();let s=new TextDecoder('utf-8',{fatal:false}).decode(b);if(s.includes('\uFFFD'))s=new TextDecoder('euc-kr').decode(b);return s;}
function updateDiagnosisHierarchy(changed){
 const ads=state.ads||[],channel=$('diag-channel'),campaign=$('diag-campaign'),adset=$('diag-adset'),ad=$('diag-ad');
 if(changed==='diag-channel'){campaign.value='';adset.value='';ad.value='';}
 if(changed==='diag-campaign'){adset.value='';ad.value='';}
 if(changed==='diag-adset')ad.value='';
 const candidates=ads.filter(r=>channel.value==='all'||r.channel===channel.value);
 function build(sel,rows,type,empty){const was=sel.value,vals=new Map();for(const r of rows){const key=type==='campaign'?JSON.stringify([r.channel||'',r.campaign||'']):type==='adset'?JSON.stringify([r.channel||'',r.campaign||'',r.adset||'']):JSON.stringify([r.channel||'',r.campaign||'',r.adset||'',String(r.id||r.ad||'')]);if(!vals.has(key))vals.set(key,type==='campaign'?r.campaign||'이름 없음':type==='adset'?r.adset||'이름 없음':r.ad||'이름 없음');}sel.innerHTML='<option value="">'+empty+'</option>'+[...vals].sort((a,b)=>a[1].localeCompare(b[1],'ko')).map(([k,v])=>'<option value="'+safe(k)+'">'+safe(v)+'</option>').join('');if([...sel.options].some(o=>o.value===was))sel.value=was;}
 build(campaign,candidates,'campaign','전체 캠페인');
 const filteredCampaign=candidates.filter(r=>!campaign.value||JSON.stringify([r.channel||'',r.campaign||''])===campaign.value);
 build(adset,filteredCampaign,'adset','전체 광고 세트');
 const filteredSet=filteredCampaign.filter(r=>!adset.value||JSON.stringify([r.channel||'',r.campaign||'',r.adset||''])===adset.value);
 build(ad,filteredSet,'ad','전체 광고 소재');
}
async function init(){for(const nav of document.querySelectorAll('.nav'))nav.addEventListener('click',()=>{document.querySelectorAll('.nav').forEach(n=>n.classList.toggle('active',n===nav));$(nav.dataset.anchor).scrollIntoView({behavior:'smooth'});});
for(const k of ['target-roas','target-cpa','min-purchases'])$(k).addEventListener('input',render);for(const k of ['search','filter'])$(k).addEventListener('input',render);
for(const id of ['diag-channel','diag-campaign','diag-adset','diag-ad'])$(id).addEventListener('change',()=>{updateDiagnosisHierarchy(id);render();});
$('export').addEventListener('click',csvExport);
const d=new Date();const toLocalDate=x=>{const z=new Date(x.getTime()-x.getTimezoneOffset()*60000);return z.toISOString().slice(0,10)};$('until').value=toLocalDate(d);d.setDate(d.getDate()-6);$('since').value=toLocalDate(d);
function applyFx(rate,meta){
  if(!Number.isFinite(rate)||rate<=0){$('message').textContent='환율은 0보다 큰 숫자여야 합니다.';return;}
  state.fxRate=rate;state.fxMeta=meta;$('fx-rate').value=String(rate);
  $('fx-info').textContent=`${meta} · 1 USD = ${new Intl.NumberFormat('ko-KR',{maximumFractionDigits:2}).format(rate)} KRW`;
  if(state.source==='api'){
    state.rows=state.rows.map(r=>({...r,spend:r.rawSpend*(r.currency==='USD'?rate:1),revenue:r.rawRevenue==null?null:r.rawRevenue*(r.currency==='USD'?rate:1)}));
    $('message').textContent=`Meta 원본 통화: ${state.currency} · ${meta} · 1 USD = ${rate} KRW (분석용 환산)`;
  }
  render();
}
async function fetchFx(){const response=await fetch('/api/fx');const data=await response.json();if(!response.ok)throw Error(data.error||'환율 조회 오류');applyFx(Number(data.rate),`최신 공시 환율 (${data.date} · ${data.source})`);}
$('fx-mode').addEventListener('change',async()=>{
  state.fxMode=$('fx-mode').value;
  if(state.fxMode==='live') {try{await fetchFx();}catch(e){$('fx-info').textContent=`환율 조회 실패 · 기존 ${state.fxRate}원 사용`; $('message').textContent=e.message;}}
  else applyFx(1350,'고정 환율');
});
$('fx-refresh').addEventListener('click',async()=>{try{await fetchFx();$('fx-mode').value='live';state.fxMode='live';}catch(e){$('message').textContent=e.message;}});
$('fx-rate').addEventListener('change',()=>{$('fx-mode').value='fixed';state.fxMode='fixed';applyFx(Number($('fx-rate').value),'사용자 지정 고정 환율');});
const cleanId=x=>String(x||'').trim().replace(/^act_/,'');
const saved=JSON.parse(localStorage.getItem('roas-account-ids')||'{}');
$('naver-account').value=saved.naver||'';$('cafe-account').value=saved.cafe||'';
$('save-accounts').addEventListener('click',()=>{const n=cleanId($('naver-account').value),c=cleanId($('cafe-account').value);if((n&&!/^\d{5,30}$/.test(n))||(c&&!/^\d{5,30}$/.test(c))){$('message').textContent='광고 계정 ID는 숫자만 입력하세요.';return;}if(n&&c&&n===c){$('message').textContent='두 채널에 동일한 광고 계정 ID가 입력되었습니다. 실제로 같은 계정이면 광고/URL별 별도 분류가 필요합니다.';return;}localStorage.setItem('roas-account-ids',JSON.stringify({naver:n,cafe:c}));$('message').textContent='계정 ID가 이 브라우저에 저장되었습니다.';});
$('channel-filter').addEventListener('change',()=>{state.channel=$('channel-filter').value;state.selected=null;render();});
try{const resp=await fetch('/api/status');const info=await resp.json();$('api-state').textContent=info.configured?`API 토큰 설정됨 · ${info.version} · 읽기 전용 조회 가능`:'서버에 META_ACCESS_TOKEN을 설정해야 API 조회가 가능합니다. 실행 파일에서 토큰을 입력하세요.';if(info.account&&!$('naver-account').value&&!$('cafe-account').value)$('api-state').textContent+=' · 기존 기본 광고 계정: '+info.account;}catch{$('api-state').textContent='API 서버에 연결할 수 없습니다. 서버를 실행하세요.';}
let refreshing=false; let lastRangeDate=toLocalDate(new Date());
async function refreshApi(reason='manual'){if(refreshing)return;refreshing=true;const btn=$('connect');btn.disabled=true;btn.textContent='조회 중…';$('auto-status').textContent='API 조회 중…';$('message').textContent='';try{const ids={naver:cleanId($('naver-account').value),cafe:cleanId($('cafe-account').value)};const choice=$('account-choice').value;const targets=choice==='all'?['naver','cafe']:[choice];if(targets.some(t=>!/^\d{5,30}$/.test(ids[t])))throw Error('조회할 채널의 광고 계정 ID를 먼저 입력하세요.');if(targets.length===2&&ids.naver===ids.cafe)throw Error('두 채널의 계정 ID가 동일합니다. 서로 다른 광고 계정인지 확인하세요.');let all=[],currencies=new Set(),failed=[],cacheWarnings=[];for(const channel of targets){try{const q=new URLSearchParams({account:ids[channel],since:$('since').value,until:$('until').value});const response=await fetch('/api/insights?'+q);const data=await response.json();if(!response.ok)throw Error(data.error||'API 조회 실패');currencies.add(data.currency||'KRW');if(data.cache){const c=data.cache;if(c.missingDays.length||c.staleDays.length||c.warnings.length)cacheWarnings.push((channel==='naver'?'네이버':'카페24')+': '+c.storedDays+'/'+c.totalDays+'일 저장 · 미저장 '+c.missingDays.length+'일 · 갱신 지연 '+c.staleDays.length+'일'+(c.warnings.length?' · '+c.warnings.join('; '):''));}all.push(...data.rows.map(r=>({...normalizeApi(r),channel})));}catch(err){failed.push((channel==='naver'?'네이버':'카페24')+': '+err.message);}}if(!all.length)throw Error(failed.join(' / ')||'조회 결과가 없습니다.');if([...currencies].some(c=>!['KRW','USD'].includes(c)))throw Error('USD/KRW 이외의 통화가 포함되어 합산할 수 없습니다.');load(all,'api',[...currencies].join('+')||'KRW');if(failed.length||cacheWarnings.length)$('message').textContent=[failed.length?'일부 계정 조회 실패: '+failed.join(' / '):'',...cacheWarnings].filter(Boolean).join(' / ')+' · 저장된 날짜만 반영될 수 있습니다.';const stamped=new Date().toLocaleString('ko-KR');$('auto-status').textContent=`마지막 갱신: ${stamped}${(failed.length||cacheWarnings.length)?' · 일부 미갱신/누락 (주의)':' · 날짜별 로컬 저장 완료'} · 최근 7일: 하루 1회 검증`; }catch(err){$('message').textContent='Meta API 조회 오류: '+err.message;$('auto-status').textContent='자동 갱신 실패 · '+new Date().toLocaleTimeString('ko-KR')+' · 수동 재시도 가능';}finally{refreshing=false;btn.disabled=false;btn.textContent='지금 새로고침 ↻';}}
for(const preset of document.querySelectorAll('.preset'))preset.addEventListener('click',()=>{const end=new Date();end.setHours(12,0,0,0);const start=new Date(end);const choice=preset.dataset.days;if(choice==='yesterday'){end.setDate(end.getDate()-1);start.setTime(end.getTime());}else if(choice==='3months'){start.setMonth(start.getMonth()-3);start.setDate(start.getDate()+1);}else if(choice==='6months'){start.setMonth(start.getMonth()-6);start.setDate(start.getDate()+1);}else if(choice==='1year'){start.setFullYear(start.getFullYear()-1);start.setDate(start.getDate()+1);}else if(choice==='2years'){start.setFullYear(start.getFullYear()-2);start.setDate(start.getDate()+1);}else if(choice!=='today'){start.setDate(start.getDate()-(Number(choice)-1));}$('since').value=toLocalDate(start);$('until').value=toLocalDate(end);document.querySelectorAll('.preset').forEach(b=>b.classList.toggle('active',b===preset));if($('auto-enabled').checked)refreshApi('preset');});
for(const id of ['since','until'])$(id).addEventListener('change',()=>document.querySelectorAll('.preset').forEach(b=>b.classList.remove('active')));
$('connect').addEventListener('click',()=>refreshApi('manual'));
for(const field of ['since','until','account-choice'])$(field).addEventListener('change',()=>{if($('auto-enabled').checked)refreshApi('range');});
$('save-accounts').addEventListener('click',()=>{if($('auto-enabled').checked)setTimeout(()=>refreshApi('save'),0);});
$('auto-enabled').addEventListener('change',()=>{localStorage.setItem('roas-auto-enabled',$('auto-enabled').checked?'true':'false');$('auto-status').textContent=$('auto-enabled').checked?'자동 조회 활성화 · 최근 7일은 하루 한 번 검증':'자동 조회 꺼짐 · 수동 버튼으로 조회';if($('auto-enabled').checked)refreshApi('enabled');});
$('auto-enabled').checked=localStorage.getItem('roas-auto-enabled')!=='false';
setInterval(()=>{if(!$('auto-enabled').checked)return;const now=toLocalDate(new Date());if(now!==lastRangeDate){const end=new Date($('until').value+'T12:00:00'), start=new Date($('since').value+'T12:00:00');if(document.querySelector('.preset.active') && toLocalDate(end)===lastRangeDate){const delta=Math.round((end-start)/86400000);$('until').value=now;const first=new Date();first.setDate(first.getDate()-delta);$('since').value=toLocalDate(first);}lastRangeDate=now;}refreshApi('scheduled');},3600000);
let canAuto=false;try{const r=await fetch('/api/status');const status=await r.json();canAuto=!!status.configured;}catch{}
if(canAuto&&$('auto-enabled').checked){const ids={naver:cleanId($('naver-account').value),cafe:cleanId($('cafe-account').value)};const mode=$('account-choice').value;const required=mode==='all'?['naver','cafe']:[mode];if(required.every(k=>/^\d{5,30}$/.test(ids[k]))){$('auto-status').textContent='접속 시 자동 조회 시작';await refreshApi('startup');}else $('auto-status').textContent='광고 계정 ID를 저장하면 자동 조회가 시작됩니다.';}else $('auto-status').textContent=canAuto?'자동 업데이트 꺼짐 · 수동 조회 가능':'API 토큰 미설정 · 서버 재시작 시 토큰 입력 필요';
if(state.source!=='api'){$('source-status').textContent='Meta API · 연결 대기';$('data-badge').textContent='● API 연결 대기';render();}}
init();
window.ROAS_TEST={parseCSV,normalizeCSV,normalizeApi,aggregate,diagnose,totals};


async function setupUpdater(){
 const status=document.getElementById('update-state');
 const headers={'X-ROAS-Local-Action':'yes','Content-Type':'application/json'};
 async function api(url,opts={}){const r=await fetch(url,{cache:'no-store',...opts});const d=await r.json();if(!r.ok)throw Error(d.error||'오류');return d;}
 async function check(){try{const d=await api('/api/update/status');document.getElementById('program-version').textContent='v'+d.version;document.getElementById('remote-feed').value=d.remote.feed||'';document.getElementById('remote-enabled').checked=!!d.remote.enabled;const history=document.getElementById('version-history');history.replaceChildren();if(!d.backups.length){history.textContent='복원할 백업이 없습니다. 첫 업데이트 시 백업이 생성됩니다.';}else for(const b of d.backups){const line=document.createElement('div');line.style.cssText='display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px;border-bottom:1px solid #7774';const name=document.createElement('span');name.textContent='v'+b.version+' · '+b.created.replace('T',' ').slice(0,19);const btn=document.createElement('button');btn.className='button ghost';btn.textContent='이 버전 복원';btn.addEventListener('click',async()=>{if(!confirm('v'+b.version+' 버전으로 되돌릴까요? 현재 버전도 백업합니다.'))return;try{status.textContent='복원 중…';await api('/api/update/rollback',{method:'POST',headers,body:JSON.stringify({backup:b.id})});status.textContent='서버 재시작 중…';setTimeout(()=>location.reload(),4000);}catch(e){status.textContent='복원 실패: '+e.message;}});line.append(name,btn);history.append(line);}const f=document.getElementById('downloads-folder');if(f&&d.watcher)f.textContent='감시 폴더: '+d.watcher.folder;status.textContent=d.watcher?.message||'다운로드 폴더 자동 감시가 켜져 있습니다.';}catch(e){status.textContent='업데이트 상태 조회 실패: '+e.message;}}
 document.getElementById('remote-save').addEventListener('click',async()=>{try{await api('/api/update/settings',{method:'POST',headers,body:JSON.stringify({feed:document.getElementById('remote-feed').value.trim(),enabled:document.getElementById('remote-enabled').checked})});status.textContent='설정을 저장했습니다.';}catch(e){status.textContent='설정 오류: '+e.message;}});
 async function find(andInstall){try{const d=await api('/api/update/check');if(!d.available){status.textContent='최신 버전(v'+d.version+')을 사용 중입니다.';return;}status.textContent='새 버전 v'+d.version+' 발견 · '+(d.notes||'');if(andInstall){if(!document.getElementById('remote-enabled').checked){status.textContent='자동 업데이트를 활성화하고 설정을 저장해 주세요.';return;}status.textContent='업데이트 다운로드·검증·백업 진행 중…';await api('/api/update/remote',{method:'POST',headers});status.textContent='업데이트 완료 · 서버 재시작 중';setTimeout(()=>location.reload(),4000);}}catch(e){status.textContent='업데이트 확인/적용 실패: '+e.message;}}
 document.getElementById('remote-check').addEventListener('click',()=>find(false));document.getElementById('remote-install').addEventListener('click',()=>find(true));await check();
 // When enabled, check at startup and then every hour; only installs releases from the configured feed.
 async function scheduled(){const d=await api('/api/update/status');if(d.remote.enabled&&d.remote.feed)await find(true);}
 scheduled().catch(()=>{});setInterval(()=>scheduled().catch(()=>{}),3600000);
}
if(typeof document!=='undefined')setupUpdater();


// Date-by-date comparison and manually entered change log (browser-local).
const CHANGE_KEY='roas-pilot-changelog-v1';
const isoDay=d=>{const z=new Date(d.getTime()-d.getTimezoneOffset()*60000);return z.toISOString().slice(0,10)};
const plusDays=(date,n)=>{const d=new Date(date+'T12:00:00');d.setDate(d.getDate()+n);return isoDay(d)};
const compMetrics=[['spend','광고비',x=>dual(x)],['purchases','구매',x=>x==null?'—':num(x)+'건'],['revenue','구매 매출',x=>dual(x)],['roas','ROAS',pct],['cpa','CPA',dual],['cpc','링크 CPC',dual],['ctr','링크 CTR',pct]];
function availableAds(){const all=aggregate(visibleRows());return all.sort((a,b)=>a.channel.localeCompare(b.channel)||a.ad.localeCompare(b.ad));}
function compKey(r){return (r.channel||'')+'::'+String(r.id||r.ad)}

let compareFetchedRows=null;
function compareData(){const all=Array.isArray(compareFetchedRows)?compareFetchedRows:[];const channel=$('compare-channel')?.value||'all';return channel==='all'?all:all.filter(r=>r.channel===channel);}
function comparePickValue(r,level){
 if(level==='campaign')return JSON.stringify([r.channel||'',r.campaign||'캠페인명 없음']);
 if(level==='adset')return JSON.stringify([r.channel||'',r.campaign||'캠페인명 없음',r.adset||'세트명 없음']);
 return JSON.stringify([r.channel||'',r.campaign||'캠페인명 없음',r.adset||'세트명 없음',String(r.id||r.ad||'')]);
}
function setCompareOptions(select,rows,level,allLabel){
 const previous=select.value,unique=new Map();
 for(const r of rows){const val=comparePickValue(r,level);if(!unique.has(val))unique.set(val,level==='campaign'?r.campaign||'캠페인명 없음':level==='adset'?r.adset||'세트명 없음':r.ad||'광고명 없음');}
 select.innerHTML='<option value="">'+safe(allLabel)+'</option>'+[...unique].sort((a,b)=>a[1].localeCompare(b[1],'ko')).map(([value,label])=>'<option value="'+safe(value)+'">'+safe(label)+'</option>').join('');
 if([...select.options].some(o=>o.value===previous))select.value=previous;
}
function filteredCompareRows(source){
 const campaign=$('compare-campaign').value,adset=$('compare-adset').value,creative=$('compare-creative').value;
 return source.filter(r=>(!campaign||comparePickValue(r,'campaign')===campaign)&&(!adset||comparePickValue(r,'adset')===adset)&&(!creative||comparePickValue(r,'creative')===creative));
}
function syncCompareOptions(changed){
 const data=compareData(),c=$('compare-campaign'),s=$('compare-adset'),a=$('compare-creative');
 if(changed==='campaign'){s.value='';a.value='';}else if(changed==='adset'){a.value='';}
 setCompareOptions(c,data,'campaign','전체 캠페인');
 const inCampaign=data.filter(r=>!c.value||comparePickValue(r,'campaign')===c.value);
 setCompareOptions(s,inCampaign,'adset','전체 광고 세트');
 const inSet=inCampaign.filter(r=>!s.value||comparePickValue(r,'adset')===s.value);
 setCompareOptions(a,inSet,'creative','전체 광고 소재');
}
function renderComparison(rowsOverride){
 if(!Array.isArray(rowsOverride))rowsOverride=null;
 const source=rowsOverride||compareData();
 syncCompareOptions();
 renderChangeHistory();
 const ranges=[[$('compare-a-start').value,$('compare-a-end').value],[$('compare-b-start').value,$('compare-b-end').value]];
 if(ranges.some(([s,e])=>!s||!e||s>e)){$('compare-result').textContent='기간 A와 B의 시작일·종료일을 올바르게 선택하세요.';return;}
 if(!Array.isArray(compareFetchedRows)&&!rowsOverride){$('compare-result').textContent='기간을 선택한 후 저장 데이터 비교 버튼을 눌러주세요. 아직 결과를 조회하지 않았습니다.';$('compare-daily').textContent='조회 전';return;}
 if(!source.length){$('compare-result').textContent='조회된 광고 행이 없습니다. 상단 저장 데이터 진단에서 저장 날짜와 계정별 조회 오류를 확인하세요.';$('compare-daily').textContent='조회된 일별 광고 행 없음';return;}
 const rows=filteredCompareRows(source);
 const byDate=new Map();
 for(const r of rows){if(!r.date)continue;let arr=byDate.get(r.date);if(!arr){arr=[];byDate.set(r.date,arr);}arr.push(r);}
 function period(from,to){
  let dates=[],zero=[],unknown=[],items=[];
  for(let d=from;d<=to;d=plusDays(d,1)){
   const values=byDate.get(d);
   if(!values){unknown.push(d);continue;}
   dates.push(d);items.push(...values);
   if(values.reduce((x,r)=>x+(r.spend||0),0)===0)zero.push(d);
  }
  const aggregateRows=aggregate(items),t=totals(aggregateRows),days=Math.round((Date.parse(to+'T00:00:00Z')-Date.parse(from+'T00:00:00Z'))/86400000)+1;
  const active=dates.length-zero.length,clicks=aggregateRows.reduce((s,r)=>s+(r.clicks||0),0),impressions=aggregateRows.reduce((s,r)=>s+(r.impressions||0),0);
  t.cpc=clicks>0?t.spend/clicks:null;t.ctr=impressions>0?clicks/impressions*100:null;
  return {from,to,days,dates,zero,unknown,active,metrics:t};
 }
 const [a,b]=ranges.map(([s,e])=>period(s,e));
 const fmt=(k,p)=>{
  const v=p.metrics[k];if(v==null)return '—';
  if(k==='purchases')return num(v)+'건';
  if(k==='roas'||k==='ctr')return pct(v);
  return dual(v);
 };
 const avg=(k,p)=>{
  if(!p.active)return '—';
  const v=p.metrics[k];if(v==null)return '—';
  return k==='purchases'?(v/p.active).toFixed(2)+'건/집행일':dual(v/p.active)+'/집행일';
 };
 const keys=[['spend','광고비'],['purchases','구매 건수'],['revenue','구매 매출'],['roas','ROAS'],['cpa','CPA'],['cpc','링크 CPC'],['ctr','링크 CTR']];
 const diff=k=>{
  const x=a.metrics[k],y=b.metrics[k];if(x==null||y==null)return '—';
  const delta=y-x;
  if(['roas','ctr'].includes(k))return (delta>=0?'+':'')+delta.toFixed(1)+'%p';
  if(k==='purchases')return (delta>=0?'+':'')+num(delta)+'건';
  return (delta>=0?'+':'')+won(delta)+(x!==0?' ('+(delta/x*100).toFixed(1)+'%)':'');
 };
 const incomplete=a.unknown.length||b.unknown.length||a.zero.length||b.zero.length;
 const warning=(p,label)=>label+': '+p.days+'일 중 기록 '+p.dates.length+'일 / 광고비 0원 '+p.zero.length+'일'+(p.zero.length?' ('+p.zero.join(', ')+')':'')+' / 기록 없는 날짜 '+p.unknown.length+'일'+(p.unknown.length?' ('+p.unknown.join(', ')+')':'');
 const bounds=!!rowsOverride||($('since').value<=a.from&&$('since').value<=b.from&&$('until').value>=a.to&&$('until').value>=b.to);
 $('compare-result').innerHTML='<p class="helper"><b>기간 A '+safe(a.from)+' ~ '+safe(a.to)+'</b> · <b>기간 B '+safe(b.from)+' ~ '+safe(b.to)+'</b></p>'+
 (bounds?'':'<p style="color:#a75321;font-weight:700">상단 조회 기간에 비교 날짜가 포함되지 않았습니다. 날짜 범위를 넓혀 데이터를 불러온 뒤 비교하세요.</p>')+
 (incomplete?'<p style="color:#ad5a21;font-weight:700">주의: 0원 또는 기록 없는 날짜가 있습니다. 품절·광고 중지·API 미수집 여부를 확인하세요. 기록 없는 날짜는 0원으로 계산하지 않습니다.</p>':'')+
 '<p class="helper">'+safe(warning(a,'기간 A'))+'<br>'+safe(warning(b,'기간 B'))+'</p>'+
 '<table><thead><tr><th>지표</th><th>기간 A 합계/비율</th><th>A 집행일 평균</th><th>기간 B 합계/비율</th><th>B 집행일 평균</th><th>B-A 차이</th></tr></thead><tbody>'+
 keys.map(([k,label])=>'<tr><td>'+label+'</td><td>'+fmt(k,a)+'</td><td>'+(['roas','cpa','cpc','ctr'].includes(k)?'기간 합산 비율':avg(k,a))+'</td><td>'+fmt(k,b)+'</td><td>'+(['roas','cpa','cpc','ctr'].includes(k)?'기간 합산 비율':avg(k,b))+'</td><td>'+diff(k)+'</td></tr>').join('')+'</tbody></table>'+
 '<p class="helper">집행일 평균 = 합계 ÷ 광고비가 0원보다 큰 날짜 수입니다. 예를 들어 7일 중 5일만 광고비가 있으면 5로 나눕니다. 광고비 0원 날짜와 미수집 날짜는 따로 표시합니다. 비율(ROAS·CPA·CPC·CTR)은 일별 단순평균이 아닌 기간 전체 금액·건수·클릭·노출의 합계로 계산합니다. 0원 날짜의 사유는 광고 관리자에서 확인해야 합니다.</p>';
 const dates=[...new Set([...a.dates,...b.dates])].sort();
 $('compare-daily').innerHTML='<table><thead><tr><th>날짜</th><th>구분</th><th>광고비</th><th>구매</th><th>매출</th><th>ROAS</th><th>CPA</th><th>상태</th></tr></thead><tbody>'+
 dates.map(date=>{const v=totals(aggregate(byDate.get(date)||[])),isA=date>=a.from&&date<=a.to;return '<tr><td>'+date+'</td><td>'+(isA?'A':'B')+'</td><td>'+dual(v.spend)+'</td><td>'+(v.purchases==null?'—':num(v.purchases))+'</td><td>'+dual(v.revenue)+'</td><td>'+pct(v.roas)+'</td><td>'+(v.purchases>0&&v.spend!=null?dual(v.spend/v.purchases):'—')+'</td><td>'+(v.spend===0?'광고비 0원':'기록 있음')+'</td></tr>';}).join('')+'</tbody></table>';
}
function readChanges(){try{const v=JSON.parse(localStorage.getItem(CHANGE_KEY)||'[]');return Array.isArray(v)?v:[]}catch{return []}}
function renderChangeHistory(){const el=$('change-history');if(!el)return;const items=readChanges();if(!items.length){el.textContent='아직 저장된 변경 기록이 없습니다.';return}el.innerHTML='<table><thead><tr><th>날짜</th><th>광고</th><th>변경</th><th>메모</th><th></th></tr></thead><tbody>'+items.map((item,i)=>`<tr><td>${safe(item.date)}</td><td>${safe(item.ad)}</td><td>${safe(item.kind)}</td><td>${safe(item.note)}</td><td><button class="button ghost" type="button" data-del-change="${i}">삭제</button></td></tr>`).join('')+'</tbody></table>';el.querySelectorAll('[data-del-change]').forEach(b=>b.addEventListener('click',()=>{const a=readChanges();a.splice(Number(b.dataset.delChange),1);localStorage.setItem(CHANGE_KEY,JSON.stringify(a));renderChangeHistory()}));}
if(typeof document!=='undefined'){
 const today=isoDay(new Date());$('compare-b-end').value=today;$('compare-b-start').value=plusDays(today,-6);$('compare-a-end').value=plusDays(today,-7);$('compare-a-start').value=plusDays(today,-13);$('compare-date').value=plusDays(today,-7);
 const invalidateComparison=()=>{compareFetchedRows=null;$('compare-diagnostics').textContent='조회 조건이 변경되었습니다. 저장 데이터 비교 버튼을 눌러 새로 조회하세요.';renderComparison();};
 for(const k of ['compare-a-start','compare-a-end','compare-b-start','compare-b-end'])$(k).addEventListener('change',invalidateComparison);
 $('compare-channel').addEventListener('change',()=>{compareFetchedRows=null;syncCompareOptions('campaign');invalidateComparison();});
 for(const id of ['compare-campaign','compare-adset','compare-creative'])$(id).addEventListener('change',()=>{syncCompareOptions(id==='compare-campaign'?'campaign':id==='compare-adset'?'adset':'creative');renderComparison();});
 $('compare-run').addEventListener('click',async()=>{
 const button=$('compare-run'),dates=[[$('compare-a-start').value,$('compare-a-end').value],[$('compare-b-start').value,$('compare-b-end').value]];
 if(dates.some(([s,e])=>!s||!e||s>e)){$('compare-diagnostics').textContent='기간 A와 B의 날짜 범위가 올바르지 않습니다.';renderComparison();return;}
 const channelIds={naver:cleanId($('naver-account').value),cafe:cleanId($('cafe-account').value)};
 const selected=$('compare-channel').value,channels=selected==='all'?['naver','cafe']:[selected],rows=[],errors=[],summary=[];
 const windows=[];
 for(const [start,end] of dates){
   for(let d=start;d<=end;){const last=plusDays(d,6),stop=last<end?last:end;windows.push([d,stop]);d=plusDays(stop,1);}
 }
 button.disabled=true;button.textContent='기간별 저장 데이터 확인 중…';
 const output=$('compare-result'),diagnostic=$('compare-diagnostics');
 diagnostic.textContent='조회 시작 · 프로그램 v2.8.31 · 선택 기간의 로컬 저장소를 읽는 중입니다.';
 output.textContent='기존 파일에서 날짜별 데이터 조회를 시작합니다. Meta API 호출 없이 저장된 파일만 확인합니다.';
 try{
  for(const channel of channels){
   const id=channelIds[channel],label=channel==='naver'?'네이버 스마트스토어':'카페24 자사몰';
   if(!/^\d{5,30}$/.test(id)){errors.push(label+' 계정 ID가 올바르지 않습니다.');continue;}
   let saved=0,missing=0,raw=0,ok=0,failed=0;
   for(let i=0;i<windows.length;i++){
    const [since,until]=windows[i];
    button.textContent='저장 데이터 조회 '+(i+1)+'/'+windows.length+' · '+label;
    const query=new URLSearchParams({account:id,since,until,cacheOnly:'1'});
    try{
     const response=await fetch('/api/insights?'+query,{cache:'no-store'});
     const data=await response.json();
     if(!response.ok)throw Error(data.error||'HTTP '+response.status);
     const items=Array.isArray(data.rows)?data.rows:[];
     raw+=items.length;saved+=Number(data.cache?.storedDays||0);missing+=(data.cache?.missingDays||[]).length;ok++;
     rows.push(...items.map(row=>({...normalizeApi(row),channel})));
    }catch(e){failed++;errors.push(label+' '+since+'~'+until+' '+e.message);}
    diagnostic.textContent='조회 진행 '+label+' '+(i+1)+'/'+windows.length+'구간 · 광고 행 '+raw+'개 · 저장 날짜 '+saved+'일';
   }
   summary.push(label+' (계정 끝 4자리 '+id.slice(-4)+'): 저장 '+saved+'일 · 파일 미확인 '+missing+'일 · 광고 행 '+raw+'개 · 조회 성공 '+ok+'구간 · 실패 '+failed+'구간');
  }
  compareFetchedRows=rows;
  syncCompareOptions();
  renderComparison(rows);
  const filtered=filteredCompareRows(compareData());
  const node=document.createElement('div');node.className='helper';node.style.whiteSpace='pre-wrap';
  node.style.margin='10px 0';node.style.padding='10px';node.style.border='1px solid #dce3ed';node.style.borderRadius='8px';
  node.textContent='저장 데이터 진단 (비교 기간 A/B만 확인)\n'+summary.join('\n')+'\n필터 통과 '+filtered.length+'개 광고 행'+(errors.length?'\n조회 오류: '+errors.slice(0,12).join(' | '):'')+'\n※ 저장 날짜는 광고가 실제 집행된 날짜와 다를 수 있습니다. 표시된 값은 현재 실행 중인 프로그램의 저장소 기준입니다.';
  diagnostic.replaceChildren(node);
 }catch(e){diagnostic.textContent='날짜별 비교 실행 오류: '+e.message;output.textContent='날짜별 비교 오류: '+e.message;}
 finally{button.disabled=false;button.textContent='저장 데이터 비교';}
});
 $('change-save').addEventListener('click',()=>{const date=$('compare-date').value,note=$('change-note').value.trim();if(!date||!note){alert('변경일과 변경 메모를 입력해 주세요.');return;}const campaign=$('compare-campaign'),set=$('compare-adset'),creative=$('compare-creative');const ad=[campaign,set,creative].map(x=>x.options[x.selectedIndex]?.textContent).filter(Boolean).join(' / ');const changes=readChanges();changes.unshift({date,kind:$('change-kind').value,ad,note});localStorage.setItem(CHANGE_KEY,JSON.stringify(changes.slice(0,500)));$('change-note').value='';renderChangeHistory();});
}


