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
function aggregate(rows){const map=new Map();for(const r of rows){const key=String(r.channel||'')+'::'+String(r.id||r.ad);let a=map.get(key);if(!a){a={...r,days:0,dates:new Set(),has:{},missing:{spend:false,revenue:false,purchases:false},quality:r.quality||'',convQuality:r.convQuality||''};for(const f of ['spend','impressions','reach','clicks','landing','cart','checkout','purchases','revenue'])a[f]=0;map.set(key,a);}a.days++;if(r.date)a.dates.add(r.date);for(const f of ['spend','revenue','purchases'])if(!Number.isFinite(r[f])||f==='spend'&&r[f]<0)a.missing[f]=true;a.missing.spend||=!!r.spendPartial;a.missing.revenue||=!!r.roasPartial;a.missing.purchases||=!!r.cpaPartial;for(const f of ['spend','impressions','reach','clicks','landing','cart','checkout','purchases','revenue']){if(r[f]!=null&&Number.isFinite(r[f])&&(f!=='spend'||r[f]>=0)){a[f]+=r[f];a.has[f]=true;}}}
return [...map.values()].map(a=>{for(const f of ['spend','impressions','clicks','landing','cart','checkout','purchases','revenue'])if(!a.has[f])a[f]=null;
// Reach is non-additive across dates: daily reach is NOT unique reach for the period.
a.reach= a.dates.size>1?null:(a.has.reach?a.reach:null);
a.spendPartial=a.missing.spend;a.roasPartial=a.missing.spend||a.missing.revenue;a.cpaPartial=a.missing.spend||a.missing.purchases;
a.roas=a.spend>0&&a.revenue!=null?a.revenue/a.spend*100:null;
a.cpa=a.purchases>0&&a.spend!=null?a.spend/a.purchases:null;
a.cpc=a.clicks>0&&a.spend!=null?a.spend/a.clicks:null;a.cpm=a.impressions>0&&a.spend!=null?a.spend/a.impressions*1000:null;
a.ctr=a.impressions>0&&a.clicks!=null?a.clicks/a.impressions*100:null;
a.frequency=a.reach>0&&a.impressions!=null?a.impressions/a.reach:null;
return a;});}
function settings(){return {roas:300,cpa:40000,min:Math.max(1,Number($('min-purchases')?.value)||3)};}
function adBenchmark(ads){
 const validSpend=a=>Number.isFinite(a.spend)&&a.spend>=0,all=ads.filter(validSpend),active=all.filter(a=>a.spend>0);
 const usable=active.filter(a=>Number.isFinite(a.purchases)&&Number.isFinite(a.revenue));
 const sum=k=>ads.reduce((total,a)=>total+(Number.isFinite(a[k])?a[k]:0),0);
 // Purchase reporting never determines which advertising costs belong to the period.
 const spend=all.reduce((total,a)=>total+a.spend,0),buy=sum('purchases'),hasRevenue=ads.some(a=>Number.isFinite(a.revenue));
 const spendPartial=ads.some(a=>!validSpend(a)||a.spendPartial);
 const roasPartial=spendPartial||ads.some(a=>!Number.isFinite(a.revenue)||a.roasPartial),cpaPartial=spendPartial||ads.some(a=>!Number.isFinite(a.purchases)||a.cpaPartial);
 const weighted=(key,weight)=>{const arr=active.filter(a=>Number.isFinite(a[key])&&Number.isFinite(a[weight])&&a[weight]>0);const den=arr.reduce((n,a)=>n+a[weight],0);return den?arr.reduce((n,a)=>n+a[key]*a[weight],0)/den:null;};
 return {count:usable.length,roas:!spendPartial&&hasRevenue&&spend>0?sum('revenue')/spend*100:null,cpa:!spendPartial&&all.length&&buy>0?spend/buy:null,roasPartial,cpaPartial,spendPartial,cpc:weighted('cpc','clicks'),ctr:weighted('ctr','impressions')};
}
function benchmarkRoasText(base){return pct(base.roas)+(base.roasPartial?(base.roas==null?' · 미확정':' · 확인분'):'');}
function diagnose(a,c){
 const reasons=[],actions=[];let status='learn',base=c.baseline||{};
 if(base.roasPartial)reasons.push('광고 평균 ROAS에 '+(base.spendPartial?'광고비':'구매매출')+' 미확인 항목이 있어 확정 평균으로 비교하지 않습니다.');
 if(base.cpaPartial)reasons.push('광고 평균 구매 CPA에 '+(base.spendPartial?'광고비':'구매수')+' 미확인 항목이 있어 확정 평균으로 비교하지 않습니다.');
 if(a.roasPartial)reasons.push('이 광고의 '+(a.spendPartial?'광고비':'구매매출')+' 일부가 미확인되어 ROAS 평균 비교를 보류합니다.');
 if(a.cpaPartial)reasons.push('이 광고의 '+(a.spendPartial?'광고비':'구매수')+' 일부가 미확인되어 구매 CPA 평균 비교를 보류합니다.');
 if(a.purchases==null||a.revenue==null||a.spend<=0){reasons.push('구매·매출 데이터가 부족해 광고 평균을 비교할 수 없습니다.');actions.push('해당 광고의 구매 이벤트·광고비 수집 여부를 확인하세요.');return {status,reasons,actions};}
 const cmp=(label,value,avg,higherGood,fmt)=>{
  if(value==null||avg==null||!Number.isFinite(value)||!Number.isFinite(avg))return null;
  const above=value>=avg;const diff=avg?((value/avg)-1)*100:null;
  reasons.push(label+' '+fmt(value)+' / 전체 평균 '+fmt(avg)+' → '+(above?'평균 이상':'평균 이하')+(diff==null?'':' ('+(diff>=0?'+':'')+diff.toFixed(1)+'%)'));
  return higherGood?above:!above;
 };
 const roasGood=base.roasPartial||a.roasPartial?null:cmp('ROAS',a.roas,base.roas,true,pct);
 const cpaGood=base.cpaPartial||a.cpaPartial?null:cmp('구매 CPA',a.cpa,base.cpa,false,won);
 cmp('링크 CPC',a.cpc,base.cpc,false,won);cmp('링크 CTR',a.ctr,base.ctr,true,pct);
 if(base.count<3)reasons.push('비교 가능한 광고가 '+base.count+'개로 평균을 신중하게 해석해야 합니다.');
 if(a.purchases===0){status=!base.cpaPartial&&!a.cpaPartial&&base.cpa!=null&&a.spend>=base.cpa*1.5?'review':'learn';actions.push(base.cpaPartial||a.cpaPartial?'확인된 구매가 없습니다. 미확인 구매수·광고비를 확인한 뒤 평균과 비교하세요.':'구매가 없습니다. 평균 구매당 비용 수준의 지출이 발생했는지 확인하세요.');}
 else if(a.purchases<c.min){status='learn';reasons.push('구매 '+num(a.purchases)+'건 · 최소 판단 기준 '+c.min+'건 미달');actions.push('표본 부족이므로 판단을 유보하고 추세를 관찰하세요.');}
 else if(roasGood===true&&cpaGood===true){status='scale';actions.push('ROAS 평균 이상, CPA 평균 이하입니다. 단계적 예산 증액 실험을 검토하세요.');}
 else if(roasGood===true||cpaGood===true){status='keep';actions.push('지표의 장단점이 혼재합니다. 기간별 추세를 더 확인하세요.');}
 else if(roasGood===false&&cpaGood===false){status='improve';actions.push('ROAS 평균 이하, CPA 평균 이상입니다. 소재와 구매 전환 과정을 점검하세요.');}
 else{status='learn';actions.push('전체 평균을 계산하기 위한 데이터가 충분하지 않습니다.');}
 if(a.frequency==null&&a.dates?.size>1)reasons.push('기간 전체 빈도는 일별 고유 도달 중복 때문에 계산하지 않습니다.');
 return {status,reasons,actions};
}
const statusNames={scale:'확대 검토',keep:'유지',improve:'개선 검토',review:'중단 검토',learn:'데이터 부족'};
function totals(ads){const out={};for(const f of ['spend','impressions','clicks','landing','cart','checkout','purchases','revenue']){let present=false;let sum=0;for(const a of ads){if(a[f]!=null){sum+=a[f];present=true;}}out[f]=present?sum:null;}out.roas=out.spend>0&&out.revenue!=null?out.revenue/out.spend*100:null;out.cpa=out.purchases>0?out.spend/out.purchases:null;return out;}
function plot(){const dated=new Map();for(const r of visibleRows()){if(!/^\d{4}-\d{2}-\d{2}$/.test(r.date||''))continue;const o=dated.get(r.date)||{spend:0,revenue:0,hasRevenue:false};o.spend+=(r.spend||0);if(r.revenue!=null){o.revenue+=r.revenue;o.hasRevenue=true;}dated.set(r.date,o);}const days=[...dated.entries()].sort((a,b)=>a[0].localeCompare(b[0]));if(days.length<2){$('chart').innerHTML='<div class="empty">일별 데이터가 없거나 기간 합계 CSV입니다. Meta API 또는 일별 CSV를 이용하세요.</div>';return;}
const valid=days.map(([d,v])=>({date:d,value:v.spend>0&&v.hasRevenue?v.revenue/v.spend*100:null}));const w=660,h=226,l=44,r=16,t=13,b=38;const max=Math.max(settings().roas*1.3,...valid.map(x=>x.value||0),100);const y=x=>t+(h-b-t)*(1-x/max);const x=i=>l+i*(w-l-r)/(valid.length-1);let grid='';for(let k=0;k<=4;k++){let yy=t+(h-b-t)*k/4;grid+=`<line x1="${l}" y1="${yy}" x2="${w-r}" y2="${yy}" stroke="#edf0f7"/><text x="${l-8}" y="${yy+4}" font-size="11" text-anchor="end" fill="#9ba7b8">${Math.round(max*(1-k/4))}%</text>`;}
const coords=valid.map((v,i)=>v.value==null?null:[x(i),y(v.value)]);let segments=[],seg=[];for(const p of coords){if(p)seg.push(p);else if(seg.length){segments.push(seg);seg=[];}}if(seg.length)segments.push(seg);
const paths=segments.map(s=>`<polyline fill="none" stroke="#6b61ef" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" points="${s.map(p=>p.join(',')).join(' ')}"/>`).join('');const dots=coords.map((p,i)=>p?`<circle cx="${p[0]}" cy="${p[1]}" r="3.8" fill="#6b61ef"><title>${valid[i].date}: ${pct(valid[i].value)}</title></circle>`:'').join('');const goalY=y(settings().roas);
const labels=valid.map((v,i)=>i===0||i===valid.length-1||i%Math.max(1,Math.ceil(valid.length/5))===0?`<text x="${x(i)}" y="${h-9}" font-size="11" text-anchor="middle" fill="#9ba7b8">${v.date.slice(5)}</text>`:'').join('');
$('chart').innerHTML=`<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="날짜별 ROAS 선 그래프">${grid}<line x1="${l}" y1="${goalY}" x2="${w-r}" y2="${goalY}" stroke="#eba964" stroke-dasharray="4 5"/><text x="${w-r-4}" y="${goalY-5}" text-anchor="end" font-size="10" fill="#b58b49">평균 ${benchmarkRoasText(adBenchmark(aggregate(visibleRows())))}</text>${paths}${dots}${labels}</svg>`;}
// Selected-period metrics use the same saved inputs and completeness rules as
// visual-overview.html. Store totals are never attributed to an individual ad.
const AdsOverviewSummary = (() => {
  const definitions = {
    smartstoreSpend: {label:'스마트스토어 광고비',format:'won',adMetric:'spend',adScope:'naver',scope:'Meta · 스마트스토어 광고',description:'선택 기간의 스마트스토어 광고계정 지출 합계입니다. 구매매출 확인 여부와 광고 표의 필터에 관계없이 해당 계정의 광고비를 모두 포함합니다. 두 채널이 동일 계정이면 채널별로 구분할 수 없습니다.'},
    mallSpend: {label:'자사몰 광고비',format:'won',adMetric:'spend',adScope:'cafe',scope:'Meta · 자사몰 광고',description:'선택 기간의 자사몰 광고계정 지출 합계입니다. 구매매출 확인 여부와 광고 표의 필터에 관계없이 해당 계정의 광고비를 모두 포함합니다. 두 채널이 동일 계정이면 채널별로 구분할 수 없습니다.'},
    spend: {label:'통합 광고비',format:'won',adMetric:'spend',adScope:'all',scope:'Meta · 전체 연결 계정',description:'선택 기간의 스마트스토어·자사몰 광고비 합계입니다. 광고 표의 필터와 관계없이 전체 연결 계정을 포함하고, 동일 광고계정은 한 번만 집계합니다. 미수집 광고비가 있으면 확인분으로 표시합니다.'},
    revenue: {label:'Meta 귀속 구매매출',format:'won',description:'선택한 광고 채널에서 확인된 Meta 구매 전환매출 합계입니다. 쇼핑몰 전체 주문매출과 다릅니다.'},
    roas: {label:'총 광고 ROAS',format:'pct',adMetric:'roas',adScope:'all',scope:'Meta · 전체 연결 계정',description:'자사몰·스마트스토어 광고의 확인된 Meta 구매매출 합계 ÷ 선택 기간 전체 광고비 × 100. 구매매출 미확인 광고의 지출도 포함하고 동일 계정은 한 번만 집계합니다. 광고 표의 필터와 관계없이 전체 연결 계정 기준입니다.'},
    mallRoas: {label:'자사몰 광고 ROAS',format:'pct',adMetric:'roas',adScope:'cafe',scope:'Meta · 자사몰 광고',description:'자사몰 광고계정의 확인된 Meta 구매매출 ÷ 선택 기간 전체 광고비 × 100. 구매매출 미확인 광고의 지출도 포함합니다. 광고 표의 필터와 관계없이 자사몰 계정 기준이며, 두 채널이 동일 계정이면 구분할 수 없습니다.'},
    smartstoreRoas: {label:'스마트스토어 광고 ROAS',format:'pct',adMetric:'roas',adScope:'naver',scope:'Meta · 스마트스토어 광고',description:'스마트스토어 광고계정의 확인된 Meta 구매매출 ÷ 선택 기간 전체 광고비 × 100. 구매매출 미확인 광고의 지출도 포함합니다. 광고 표의 필터와 관계없이 스마트스토어 계정 기준이며, 두 채널이 동일 계정이면 구분할 수 없습니다.'},
    cpa: {label:'구매 CPA',format:'won',description:'선택한 광고 채널의 전체 광고비 ÷ 확인된 구매수입니다. 광고비 미확인 날짜가 있으면 계산을 보류합니다.'},
    purchases: {label:'구매 건수',format:'num',description:'선택한 광고 채널에서 확인된 Meta 구매 전환 건수입니다.'},
    ctr: {label:'링크 CTR',format:'pct',description:'선택한 광고 채널의 링크 클릭수 ÷ 노출수 × 100입니다.'},
    impressions: {label:'노출수',format:'num',description:'선택한 광고 채널의 노출수 합계입니다.'},
    clicks: {label:'링크 클릭수',format:'num',description:'선택한 광고 채널의 링크 클릭수 합계입니다.'},
    smartstoreRevenue: {label:'스마트스토어 매출',format:'won',field:'revenue',channel:'naver',description:'스마트스토어에서 위마망으로 확인된 실제 주문매출입니다. 광고 표의 필터와 관계없이 선택 기간의 주문을 집계합니다.'},
    mallRevenue: {label:'카페24 매출',format:'won',field:'revenue',channel:'cafe24',description:'카페24에서 위마망으로 확인된 실제 주문매출입니다. 광고 표의 필터와 관계없이 선택 기간의 주문을 집계합니다.'},
    totalStoreRevenue: {label:'통합 매출',format:'won',field:'revenue',description:'스마트스토어와 카페24에서 위마망으로 확인된 실제 주문매출 합계입니다. 광고 한 개의 귀속 매출이 아닙니다.'},
    profit: {label:'통합 예상 이익',format:'won',field:'profit',description:'확인된 위마망 주문매출에서 채널별 판매 수수료·상품 원가·전체 연결 광고계정의 광고비를 차감합니다. 부분 집계에서도 전체 광고비를 차감하며, 배송비·세금·고정비는 별도입니다.'},
    cost: {label:'상품 원가',format:'won',field:'cost',description:'위마망으로 확인된 주문의 판매 상품·옵션 원가 합계입니다. 원가가 미확인인 주문이 있으면 미확정으로 표시합니다.'},
    fee: {label:'판매 수수료',format:'won',field:'fee',description:'위마망으로 확인된 채널별 주문매출에 저장된 평균 수수료율을 적용한 금액입니다.'},
    cpc: {label:'링크 CPC',format:'won',description:'선택한 광고 채널의 광고비 ÷ 링크 클릭수입니다.'},
    cpm: {label:'CPM',format:'won',description:'선택한 광고 채널의 광고비 ÷ 노출수 × 1,000입니다.'}
  };
  const metrics = Object.freeze(Object.entries(definitions).map(([key,definition]) => Object.freeze({
    key,label:definition.label,description:definition.description,format:definition.format,
    scope:definition.scope || (definition.field ? '전체 연결 · 위마망' : 'Meta · 선택 광고 채널')
  })));
  const purchaseTypes = ['offsite_conversion.fb_pixel_purchase','omni_purchase','purchase','onsite_web_purchase','onsite_conversion.purchase'];
  const numberFormat = new Intl.NumberFormat('ko-KR',{maximumFractionDigits:0});
  const cache = new Map();
  let renderVersion = 0;

  function metricNumber(value) {
    if (!['number','string'].includes(typeof value) || String(value).trim() === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  function numberOrZero(value) { const parsed=Number(value); return Number.isFinite(parsed) ? parsed : 0; }
  function actionValue(actions) {
    if (!Array.isArray(actions)) return null;
    for (const type of purchaseTypes) {
      const amount = metricNumber(actions.find(item => item.action_type === type)?.value);
      if (amount !== null) return amount;
    }
    return null;
  }
  function normalize(row,channel,currency,fx) {
    const rawSpend=metricNumber(row.spend),code=String(row.account_currency || currency || '').toUpperCase();
    const factor=code==='USD' ? fx : code==='KRW' ? 1 : null;
    const spendKnown=rawSpend!==null && rawSpend>=0 && Number.isFinite(factor) && factor>0;
    const purchases=actionValue(row.actions);
    let revenue=actionValue(row.action_values);
    if (revenue===null && spendKnown) {
      const ratio=actionValue(row.website_purchase_roas) ?? actionValue(row.purchase_roas);
      if (ratio!==null) revenue=rawSpend*ratio;
    }
    return {date:row.date_start,channel,spend:spendKnown ? rawSpend*factor : 0,spendKnown,
      revenue:revenue===null || !Number.isFinite(factor) || factor<=0 ? null : revenue*factor,
      purchases,clicks:numberOrZero(row.inline_link_clicks),impressions:numberOrZero(row.impressions),
      clicksKnown:metricNumber(row.inline_link_clicks)!==null,impressionsKnown:metricNumber(row.impressions)!==null};
  }
  function sum(rows) {
    const total={spend:0,revenue:0,purchases:0,clicks:0,impressions:0,hasRevenue:false,hasPurchases:false,hasUnconfirmedSpend:false};
    for (const row of rows) {
      if (Number.isFinite(row.spend) && row.spendKnown!==false) total.spend+=row.spend;
      else total.hasUnconfirmedSpend=true;
      total.clicks+=numberOrZero(row.clicks);total.impressions+=numberOrZero(row.impressions);
      if (Number.isFinite(row.revenue)) {total.revenue+=row.revenue;total.hasRevenue=true;}
      if (Number.isFinite(row.purchases)) {total.purchases+=row.purchases;total.hasPurchases=true;}
    }
    total.roas=!total.hasUnconfirmedSpend && total.hasRevenue && total.spend>0 ? total.revenue/total.spend*100 : null;
    total.ctr=total.impressions>0 ? total.clicks/total.impressions*100 : null;
    total.cpa=!total.hasUnconfirmedSpend && total.hasPurchases && total.purchases>0 ? total.spend/total.purchases : null;
    return total;
  }
  function financial(record,key) {
    const full=record?.[key];
    if (Number.isFinite(full) && (key!=='profit' || record.complete===true)) return {value:full,partial:false};
    const confirmed=record?.confirmed?.[key];
    if (record?.confirmedAvailable===true && Number.isFinite(confirmed)) return {value:confirmed,partial:true};
    return {value:null,partial:false};
  }
  function selectedDates(since,until) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(since) || !/^\d{4}-\d{2}-\d{2}$/.test(until)) return [];
    const first=Date.parse(since+'T00:00:00Z'),last=Date.parse(until+'T00:00:00Z');
    if (!Number.isFinite(first) || !Number.isFinite(last) || first>last || last-first>731*86400000 ||
        new Date(first).toISOString().slice(0,10)!==since || new Date(last).toISOString().slice(0,10)!==until) return [];
    const result=[];
    for (let time=first;time<=last;time+=86400000) result.push(new Date(time).toISOString().slice(0,10));
    return result;
  }
  function knownSpend(row) { return Number.isFinite(row.spend) && row.spend>=0 && row.spendKnown!==false; }
  function selectedRows(snapshot,choice) {
    if (choice!=='all') return snapshot.data[choice] || [];
    return snapshot.accounts.naver && snapshot.accounts.naver===snapshot.accounts.cafe
      ? snapshot.data.naver : [...snapshot.data.naver,...snapshot.data.cafe];
  }
  function metricContext(snapshot,choice) {
    const dates=snapshot.dates,dateSet=new Set(dates),selected=selectedRows(snapshot,choice).filter(row => dateSet.has(row.date));
    const selectedByDate=new Map();
    for (const row of selected) {
      const rows=selectedByDate.get(row.date) || [];rows.push(row);selectedByDate.set(row.date,rows);
    }
    const seen=new Set(),channels=(choice==='all' ? ['naver','cafe'] : [choice]).filter(channel => {
      const account=snapshot.accounts[channel];
      if (account) {if (seen.has(account)) return false;seen.add(account);return true;}
      return (snapshot.data[channel] || []).some(row => dateSet.has(row.date));
    });
    const coverageMatches=snapshot.coverage?.since===snapshot.since && snapshot.coverage?.until===snapshot.until;
    const sources=channels.map(channel => {
      const account=snapshot.accounts[channel],coverage=coverageMatches ? snapshot.coverage.sources?.meta?.[account] : null;
      const missing=new Set(coverage?.missingDays || []),rowsByDate=new Map();
      for (const row of snapshot.data[channel] || []) {
        if (!dateSet.has(row.date)) continue;
        const rows=rowsByDate.get(row.date) || [];rows.push(row);rowsByDate.set(row.date,rows);
      }
      const loaded=date => snapshot.loadedAccounts.has(account) && !!coverage && Array.isArray(coverage.missingDays) && !missing.has(date);
      return {rowsByDate,emptyKnown:loaded,spendKnown:date => loaded(date) && (rowsByDate.get(date) || []).every(knownSpend)};
    });
    const scope=choice==='naver' ? 'Meta · 스마트스토어 선택' : choice==='cafe' ? 'Meta · 카페24 선택' : 'Meta · 전체 연결 계정';
    return {dates,selected,selectedByDate,sources,scope,choice};
  }
  function fullContext(snapshot,choice) {
    snapshot.contexts ??= new Map();
    if (!snapshot.contexts.has(choice)) snapshot.contexts.set(choice,metricContext(snapshot,choice));
    return snapshot.contexts.get(choice);
  }
  function calculate(key,snapshot,choice,contexts) {
    const definition=definitions[key],resolvedChoice=definition.adScope || choice;
    if (!contexts.has(resolvedChoice)) contexts.set(resolvedChoice,fullContext(snapshot,resolvedChoice));
    const context=contexts.get(resolvedChoice),totalDays=context.dates.length;
    const isRoas=definition.adMetric==='roas',isSpend=definition.adMetric==='spend';
    const scope=definition.scope || (definition.field ? '전체 연결 · 위마망' : context.scope);
    const unavailable=detail => ({value:null,partial:false,knownDays:0,completeDays:0,totalDays,scope,detail});
    if (definition.adScope) {
      const connected=definition.adScope==='all' ? snapshot.accounts.naver || snapshot.accounts.cafe : snapshot.accounts[definition.adScope];
      if (!connected) return unavailable('광고계정 미연결');
      if (definition.adScope!=='all' && snapshot.accounts.naver && snapshot.accounts.naver===snapshot.accounts.cafe) return unavailable('동일 광고계정 · 채널 구분 필요');
    }
    if (definition.field) {
      let total=0,knownDays=0,completeDays=0;
      for (const date of context.dates) {
        const day=snapshot.profitDays.get(date),field=financial(definition.channel ? day?.[definition.channel] : day,definition.field);
        if (!Number.isFinite(field.value)) continue;
        total+=field.value;knownDays++;if (!field.partial) completeDays++;
      }
      return {value:knownDays ? total : null,partial:knownDays>0 && completeDays<totalDays,knownDays,completeDays,totalDays,scope,
        detail:(knownDays ? '' : '미확정 · ')+'확인 '+knownDays+'/'+totalDays+'일'+(knownDays>completeDays ? ' · 일부 주문 미확인' : '')};
    }
    if (isSpend) {
      let knownDays=0,completeDays=0;
      for (const date of context.dates) {
        const states=context.sources.map(source => {
          const daily=source.rowsByDate.get(date) || [];
          return {known:daily.some(knownSpend) || !daily.length && source.emptyKnown(date),complete:source.spendKnown(date)};
        });
        if (states.some(state => state.known)) knownDays++;
        if (states.length && states.every(state => state.complete)) completeDays++;
      }
      const amount=knownDays ? sum(context.selected.filter(knownSpend)).spend : null,partial=amount!==null && completeDays<totalDays;
      return {value:amount,partial,knownDays,completeDays,totalDays,scope,
        detail:(amount===null ? '미수집 · ' : '')+'확인 '+knownDays+'/'+totalDays+'일'+(partial ? ' · 광고비 일부 미확인' : '')};
    }
    const required=key==='revenue' || isRoas ? 'revenue' : ['purchases','cpa'].includes(key) ? 'purchases' : null;
    const isKnown=row => !required || Number.isFinite(row[required]);
    const rows=context.selected.filter(isKnown);
    let knownDays=0,completeDays=0;
    for (const date of context.dates) {
      const states=context.sources.map(source => {
        const daily=source.rowsByDate.get(date) || [],emptyKnown=!daily.length && source.emptyKnown(date);
        return {known:emptyKnown || daily.some(isKnown),complete:emptyKnown || daily.length>0 && daily.every(isKnown)};
      });
      if (states.some(state => state.known)) knownDays++;
      if (states.length && states.every(state => state.complete)) completeDays++;
    }
    const totals=sum(rows),allTotals=sum(context.selected),available=knownDays>0;
    const missingSpendDates=context.dates.filter(date => !context.sources.length || !context.sources.every(source => source.spendKnown(date)));
    let amount=available ? totals[key] : null;
    if (key==='cpc') amount=available && totals.clicks>0 ? totals.spend/totals.clicks : null;
    if (key==='cpm') amount=available && totals.impressions>0 ? totals.spend/totals.impressions*1000 : null;
    // Purchase reporting does not determine which advertising costs belong to
    // the period. Missing spend blocks a ratio; missing purchases do not erase spend.
    if (isRoas || key==='cpa') {
      const hasNumerator=isRoas ? allTotals.hasRevenue : allTotals.hasPurchases;
      amount=!missingSpendDates.length && hasNumerator && (isRoas ? allTotals.spend>0 : allTotals.purchases>0)
        ? (isRoas ? allTotals.revenue/allTotals.spend*100 : allTotals.spend/allTotals.purchases) : null;
      const partial=Number.isFinite(amount) && completeDays<totalDays;
      const detail=missingSpendDates.length ? '광고비 미확인 '+missingSpendDates.length+'/'+totalDays+'일 · 계산 보류'
        : !hasNumerator ? (isRoas ? '구매매출 미확인' : '구매수 미확인')
        : !Number.isFinite(amount) ? (isRoas ? '광고비 없음' : '구매 없음')
        : (isRoas ? '구매매출' : '구매수')+' 확인 '+knownDays+'/'+totalDays+'일'+(partial ? ' · 일부 항목 미확인' : '');
      return {value:Number.isFinite(amount) ? amount : null,partial,knownDays,completeDays,totalDays,scope,detail,
        audit:isRoas ? {revenue:allTotals.hasRevenue ? allTotals.revenue : null,spend:allTotals.spend,spendComplete:missingSpendDates.length===0,missingSpendDates} : null};
    }
    const partial=available && completeDays<totalDays;
    const reason=available ? key==='cpc' ? '클릭 없음' : ['ctr','cpm'].includes(key) ? '노출 없음' : '미확정' : '미수집';
    return {value:Number.isFinite(amount) ? amount : null,partial,knownDays,completeDays,totalDays,scope,
      detail:(Number.isFinite(amount) ? '' : reason+' · ')+'확인 '+knownDays+'/'+totalDays+'일'+(knownDays>completeDays ? ' · 일부 항목 미확인' : '')};
  }
  function seriesMetric(key,snapshot,choice,contexts) {
    const definition=definitions[key],context=contexts.get(definition.adScope || choice);
    const metric=calculate(key,snapshot,choice,contexts),totalDays=context.dates.length;
    // The historical overview treats absent click/impression fields as zero in
    // its total cards. Preserve those totals, but never invent chart points or
    // denominators from an absent source field.
    if (['clicks','impressions'].includes(key)) {
      const isKnown=row => row[key+'Known']!==false && Number.isFinite(row[key]) && row[key]>=0;
      let knownDays=0,completeDays=0;
      for (const date of context.dates) {
        const states=context.sources.map(source => {
          const rows=source.rowsByDate.get(date) || [],loaded=source.emptyKnown(date);
          return {known:!rows.length && loaded || rows.some(isKnown),complete:loaded && rows.every(isKnown)};
        });
        if (states.some(state => state.known)) knownDays++;
        if (states.length && states.every(state => state.complete)) completeDays++;
      }
      const value=knownDays ? context.selected.filter(isKnown).reduce((total,row) => total+row[key],0) : null;
      const partial=knownDays>0 && completeDays<totalDays;
      return {...metric,value,knownDays,completeDays,partial,
        detail:(value===null ? '미수집 · ' : '')+'확인 '+knownDays+'/'+totalDays+'일'+(partial ? ' · 일부 항목 미확인' : '')};
    }
    if (['cpc','cpm','ctr'].includes(key)) {
      const required=key==='ctr' ? ['clicks','impressions'] : ['spend',key==='cpc' ? 'clicks' : 'impressions'];
      const isKnown=row => required.every(field => field==='spend' ? knownSpend(row) : row[field+'Known']!==false && Number.isFinite(row[field]) && row[field]>=0);
      const missingDates=context.dates.filter(date => !context.sources.length || !context.sources.every(source =>
        source.emptyKnown(date) && (source.rowsByDate.get(date) || []).every(isKnown)));
      if (missingDates.length) return {...metric,value:null,partial:false,completeDays:totalDays-missingDates.length,
        detail:'계산에 필요한 '+(key==='ctr' ? '클릭·노출' : key==='cpc' ? '광고비·클릭' : '광고비·노출')+' 미확인 '+missingDates.length+'/'+totalDays+'일 · 계산 보류'};
    }
    return metric;
  }
  function buildSeries(snapshot,seriesKeys,choice,windowSize) {
    const groups=new Map(),scopes=[...new Set(seriesKeys.map(key => definitions[key].adScope || choice))];
    // Month-anchored, non-overlapping groups; range edges contain only selected
    // calendar days. Retain empty dates so a missing point stays a gap.
    for (const date of snapshot.dates) {
      const groupKey=windowSize===1 ? date : date.slice(0,7)+':'+Math.floor((Number(date.slice(8))-1)/windowSize);
      const group=groups.get(groupKey) || [];group.push(date);groups.set(groupKey,group);
    }
    return [...groups.values()].map(dates => {
      const contexts=new Map();
      for (const scope of scopes) {
        const full=fullContext(snapshot,scope);
        contexts.set(scope,{...full,dates,selected:dates.flatMap(date => full.selectedByDate.get(date) || [])});
      }
      const from=dates[0],to=dates[dates.length-1],label=windowSize===1 ? from.slice(5)
        : from.slice(5).replace('-','/')+(from===to ? '' : '~'+to.slice(5).replace('-','/'));
      const bucket={date:from,from,to,label,days:dates.length,metrics:{}};
      for (const key of seriesKeys) {
        const metric=seriesMetric(key,snapshot,choice,contexts);
        const isRatio=definitions[key].adMetric==='roas' || ['cpa','ctr','cpc','cpm'].includes(key);
        const averaged=windowSize>1 && !isRatio && Number.isFinite(metric.value) && metric.knownDays>0;
        bucket.metrics[key]={value:averaged ? metric.value/metric.knownDays : metric.value,partial:metric.partial,
          knownDays:metric.knownDays,totalDays:metric.totalDays,completeDays:metric.completeDays,scope:metric.scope,
          detail:metric.detail+(averaged ? ' · 확인 '+metric.knownDays+'일 평균' : windowSize>1 && isRatio && Number.isFinite(metric.value) ? ' · 구간 합산 비율' : '')};
      }
      return bucket;
    });
  }
  function chartSeries(snapshot,seriesKeys,choice,windowSize) {
    if (!seriesKeys.length) return {series:[],dailySeries:[]};
    snapshot.seriesCache ??= new Map();
    const key=JSON.stringify([choice,seriesKeys,windowSize]);
    if (snapshot.seriesCache.has(key)) return snapshot.seriesCache.get(key);
    const dailyKey=JSON.stringify([choice,seriesKeys,1]);
    let daily=snapshot.seriesCache.get(dailyKey);
    if (!daily) {
      const values=buildSeries(snapshot,seriesKeys,choice,1);
      daily={series:values,dailySeries:values};snapshot.seriesCache.set(dailyKey,daily);
    }
    const result=windowSize===1 ? daily : {series:buildSeries(snapshot,seriesKeys,choice,windowSize),dailySeries:daily.series};
    snapshot.seriesCache.set(key,result);
    while (snapshot.seriesCache.size>16) snapshot.seriesCache.delete(snapshot.seriesCache.keys().next().value);
    return result;
  }
  async function getJSON(url) {
    const controller=typeof AbortController==='function' ? new AbortController() : null;
    const timeout=controller ? setTimeout(() => controller.abort(),25000) : null;
    try {
      const response=await fetch(url,{method:'GET',cache:'no-store',...(controller ? {signal:controller.signal} : {})});
      const body=await response.json();
      if (!response.ok) throw Error(body?.error || '저장 데이터 조회 실패');
      return body;
    } catch (error) {
      if (error?.name==='AbortError') throw Error('저장 데이터 응답 시간이 초과되었습니다. 새로고침해 주세요.');
      throw error;
    } finally {if (timeout!==null) clearTimeout(timeout);}
  }
  async function fetchSnapshot(options) {
    const snapshot={...options,data:{naver:[],cafe:[]},loadedAccounts:new Set(),coverage:null,profitDays:new Map(),errors:[]};
    const accounts=[...new Set(Object.values(options.accounts).filter(Boolean))];
    const query=new URLSearchParams({since:options.since,until:options.until,accounts:accounts.join(','),fx:String(options.fx)});
    const requests=accounts.map(async account => {
      const channels=['naver','cafe'].filter(channel => options.accounts[channel]===account);
      const label=channels.length===2 ? '공유 광고계정' : channels[0]==='naver' ? '스마트스토어 광고' : '자사몰 광고';
      try {
        const q=new URLSearchParams({account,since:options.since,until:options.until,cacheOnly:'1'});
        const body=await getJSON('/api/insights?'+q);
        if (!Array.isArray(body?.rows)) throw Error('광고 데이터 응답 형식을 확인하세요.');
        for (const channel of channels) snapshot.data[channel]=body.rows.map(row => normalize(row,channel,body.currency || 'USD',options.fx));
        snapshot.loadedAccounts.add(account);
        if (Array.isArray(body.cache?.warnings)) snapshot.errors.push(...body.cache.warnings.filter(Boolean).map(warning => label+': '+String(warning)));
      } catch (error) {snapshot.errors.push(label+': '+error.message);}
    });
    if (accounts.length) requests.push((async () => {
      try {
        const body=await getJSON('/api/data/coverage?'+query);
        if (!body?.sources || !Number.isFinite(body.totalDays) || body.since!==options.since || body.until!==options.until) throw Error('조회 기간의 수집 현황을 확인할 수 없습니다.');
        snapshot.coverage=body;
      } catch (error) {snapshot.errors.push('수집 현황: '+error.message);}
    })());
    requests.push((async () => {
      try {
        const body=await getJSON('/api/profit/daily?'+query);
        if (!Array.isArray(body?.days)) throw Error('주문매출·이익 응답 형식을 확인하세요.');
        snapshot.profitDays=new Map(body.days.map(day => [day.date,day]));
      } catch (error) {snapshot.errors.push('주문매출·이익: '+error.message);}
    })());
    await Promise.all(requests);
    return snapshot;
  }
  function formatValue(value,format) {
    if (!Number.isFinite(value)) return '—';
    return format==='pct' ? value.toFixed(1)+'%' : numberFormat.format(value)+(format==='won' ? '원' : '');
  }
  function renderCards(root,keys,choice,snapshot,detail) {
    root?.replaceChildren();
    const contexts=new Map(),results=[];
    for (const key of keys) {
      const definition=definitions[key];
      const metric=snapshot ? calculate(key,snapshot,choice,contexts) : {
        value:null,partial:false,scope:definition.scope || (definition.field ? '전체 연결 · 위마망' : choice==='naver' ? 'Meta · 스마트스토어 선택' : choice==='cafe' ? 'Meta · 카페24 선택' : 'Meta · 전체 연결 계정'),detail
      };
      results.push({key,...metric});
      if (!root) continue;
      const card=document.createElement('article');card.className='ads-period-card';card.setAttribute('data-summary-key',key);
      card.title=definition.description;
      const label=document.createElement('small');label.className='ads-period-card-label';label.textContent=definition.label;
      const amount=document.createElement('strong');amount.className='ads-period-card-value';amount.textContent=formatValue(metric.value,definition.format);
      card.append(label,amount);
      if (metric.partial && Number.isFinite(metric.value)) {
        const badge=document.createElement('span');badge.className='ads-metric-partial';badge.textContent='확인분';card.append(badge);
      }
      const scope=document.createElement('small');scope.className='ads-period-card-scope';scope.textContent=metric.scope;
      const status=document.createElement('small');status.className='ads-period-card-state';status.textContent=metric.detail;
      if (metric.audit) status.title='확인된 Meta 구매매출 '+formatValue(metric.audit.revenue,'won')+' ÷ 전체 광고비 '+formatValue(metric.audit.spend,'won')+' × 100'+(metric.audit.spendComplete ? '' : ' · 광고비 미확인으로 계산 보류');
      card.append(scope,status);root.append(card);
    }
    return results;
  }
  function invalidate() {cache.clear();renderVersion++;}
  async function update(input={}) {
    const version=++renderVersion;
    const node=id => typeof document==='undefined' ? null : document.getElementById(id);
    const root=node('ads-period-summary-cards'),panel=node('ads-period-summary'),note=node('ads-period-summary-note');
    const knownKeys=value => [...new Set((Array.isArray(value) ? value : []).filter(key => Object.prototype.hasOwnProperty.call(definitions,key)))];
    const keys=knownKeys(input.keys),seriesKeys=knownKeys(input.seriesKeys).slice(0,7);
    const requestedWindow=Number(input.window ?? input.seriesWindow ?? 1),windowSize=[1,3,5,7].includes(requestedWindow) ? requestedWindow : 1;
    if (panel) panel.hidden=keys.length===0;
    if (!keys.length) {root?.replaceChildren();root?.setAttribute('aria-busy','false');if (note) note.textContent='';}
    const since=String(input.since || ''),until=String(input.until || ''),dates=selectedDates(since,until),fx=Number(input.fx);
    const accounts=Object.fromEntries(['naver','cafe'].map(channel => [channel,String(input.accountIds?.[channel] || '').trim().replace(/^act_/,'')]));
    const choice=['naver','cafe'].includes(input.channel) ? input.channel : 'all';
    const requestSignature=JSON.stringify([since,until,fx,accounts.naver,accounts.cafe,choice,keys,seriesKeys,windowSize]);
    if (!keys.length && !seriesKeys.length) return {status:'hidden',metrics:[],series:[],dailySeries:[],errors:[],requestSignature};
    const error=!dates.length ? '유효한 조회 기간을 선택해 주세요(최대 732일).'
      : !Number.isFinite(fx) || fx<=0 ? '0보다 큰 환율을 입력해 주세요.'
      : Object.values(accounts).some(account => account && !/^\d{5,30}$/.test(account)) ? '광고 계정 ID를 확인해 주세요.' : '';
    if (error) {
      root?.setAttribute('aria-busy','false');const results=renderCards(root,keys,choice,null,error);
      if (note && keys.length) note.textContent=error;
      return {status:'error',metrics:results,series:[],dailySeries:[],errors:[error],requestSignature};
    }
    const cacheKey=JSON.stringify([since,until,fx,accounts.naver,accounts.cafe]);
    if (input.force===true) cache.delete(cacheKey);
    let entry=cache.get(cacheKey);
    if (!entry) {
      entry={snapshot:null,promise:null};
      entry.promise=fetchSnapshot({since,until,fx,accounts,dates}).then(snapshot => {entry.snapshot=snapshot;return snapshot;});
      cache.set(cacheKey,entry);
      while (cache.size>4) cache.delete(cache.keys().next().value);
    }
    if (!entry.snapshot) {
      if (keys.length) root?.setAttribute('aria-busy','true');renderCards(root,keys,choice,null,'기간 데이터 조회 중…');
      if (note && keys.length) note.textContent=since+' ~ '+until+' · 저장된 기간 데이터를 확인하고 있습니다.';
    }
    const snapshot=entry.snapshot || await entry.promise;
    if (version!==renderVersion) return {status:'superseded',metrics:[],series:[],dailySeries:[],errors:[],requestSignature};
    root?.setAttribute('aria-busy','false');
    const results=renderCards(root,keys,choice,snapshot);
    const plotted=chartSeries(snapshot,seriesKeys,choice,windowSize);
    if (note && keys.length) note.textContent=since+' ~ '+until+' · 기간 합계는 캠페인·소재·검색 조건과 별도로 집계합니다.'+
      (snapshot.errors.length ? ' 일부 데이터 확인 필요: '+snapshot.errors.join(' / ') : ' 확인되지 않은 값은 —, 부분 집계는 확인분으로 표시합니다.');
    return {status:snapshot.errors.length ? 'partial' : 'ready',metrics:results,...plotted,errors:snapshot.errors.slice(),requestSignature};
  }
  return {metrics,update,invalidate};
})();


// Ad-period chart. The adapter supplies calendar buckets and original daily values.
// This component never fetches data or changes the adapter's numeric values.
const AdsPerformanceGraph = (() => {
  'use strict';
  const storageKey='roas-ads-chart-v1',defaults={version:1,followTable:true,keys:['spend','revenue','roas'],window:1,scale:'relative'};
  const colors=['#6c8cff','#40bf9b','#e9a34e','#cb89ef','#eb718e','#41bbd4','#b0bd42'];
  const ns='http://www.w3.org/2000/svg';
  let catalog=[],byKey=new Map(),config={...defaults,keys:defaults.keys.slice()},getTableKeys=()=>[],onChange=()=>{};
  let initialized=false,lastResult=null,loading=false,hidden=new Set(),lastWidth=0,resizeFrame=0;
  const node=id=>typeof document==='undefined'?null:document.getElementById('ads-graph-'+id);
  const validKeys=value=>[...new Set((Array.isArray(value)?value:[]).filter(key=>typeof key==='string'&&byKey.has(key)))].slice(0,7);
  function clean(value){
    if(!value||typeof value!=='object'||Array.isArray(value))return {...defaults,keys:validKeys(defaults.keys)};
    return {version:1,followTable:value.followTable!==false,keys:Array.isArray(value.keys)?validKeys(value.keys):validKeys(defaults.keys),window:[1,3,5,7].includes(Number(value.window))?Number(value.window):1,scale:value.scale==='absolute'?'absolute':'relative'};
  }
  function currentKeys(){
    if(!config.followTable)return validKeys(config.keys);
    let keys=[];try{keys=validKeys(getTableKeys());}catch{}
    return keys.length?keys:validKeys(defaults.keys);
  }
  function options(){const keys=currentKeys();syncControls(keys);return {keys:keys.slice(),window:config.window,scale:config.scale};}
  function message(text,error=false){const el=node('status');if(el){el.textContent=text;el.setAttribute('data-error',String(error));}}
  function syncControls(keys=currentKeys()){
    if(!initialized)return;
    if(node('follow'))node('follow').checked=config.followTable;
    if(node('window'))node('window').value=String(config.window);
    if(node('scale'))node('scale').value=config.scale;
    for(let i=0;i<7;i++){const select=node('choice-'+i);if(select)select.value=keys[i]||'';}
    const note=node('follow-note');if(note)note.textContent=config.followTable?'표에 선택한 지표 중 앞의 7개를 따라갑니다. 그래프 지표를 직접 바꾸면 개별 설정으로 전환됩니다.':'그래프 지표를 개별로 선택했습니다. 표의 항목을 바꿔도 이 구성이 유지됩니다.';
  }
  function change(){
    syncControls();message('변경한 그래프 설정은 ‘그래프 설정 저장’을 누르면 다음 접속에도 유지됩니다.');
    try{const task=onChange();if(task&&typeof task.catch==='function')task.catch(()=>{setDataMessage('기간 데이터를 다시 확인해 주세요.');});}
    catch{setDataMessage('기간 데이터를 다시 확인해 주세요.');}
  }
  function setup(input={}){
    if(initialized)return;
    catalog=(Array.isArray(input.metrics)?input.metrics:[]).filter(item=>item&&typeof item.key==='string');byKey=new Map(catalog.map(item=>[item.key,item]));
    getTableKeys=typeof input.getTableKeys==='function'?input.getTableKeys:()=>[];onChange=typeof input.onChange==='function'?input.onChange:()=>{};
    if(!node('choices'))return;
    let readError=false;try{const saved=localStorage.getItem(storageKey);config=clean(saved===null?null:JSON.parse(saved));}catch{config=clean(null);readError=true;}
    const choices=node('choices');choices.replaceChildren();
    for(let i=0;i<7;i++){
      const label=document.createElement('label');label.textContent='지표 '+(i+1);
      const select=document.createElement('select');select.id='ads-graph-choice-'+i;select.setAttribute('aria-label','그래프 지표 '+(i+1));
      const none=document.createElement('option');none.value='';none.textContent='선택 안 함';select.append(none);
      for(const metric of catalog){const option=document.createElement('option');option.value=metric.key;option.textContent=metric.label;select.append(option);}
      select.addEventListener('change',()=>{
        const slots=Array.from({length:7},(_,j)=>node('choice-'+j).value),chosen=slots[i];
        if(chosen)for(let j=0;j<slots.length;j++)if(j!==i&&slots[j]===chosen)slots[j]='';
        config.keys=validKeys(slots);config.followTable=false;hidden.clear();change();
      });label.append(select);choices.append(label);
    }
    node('follow')?.addEventListener('change',event=>{const previous=currentKeys();config.followTable=event.target.checked;if(!config.followTable)config.keys=previous;hidden.clear();change();});
    node('window')?.addEventListener('change',event=>{config.window=[1,3,5,7].includes(Number(event.target.value))?Number(event.target.value):1;change();});
    node('scale')?.addEventListener('change',event=>{config.scale=event.target.value==='absolute'?'absolute':'relative';change();});
    node('save')?.addEventListener('click',()=>{
      try{localStorage.setItem(storageKey,JSON.stringify(clean(config)));message('그래프 설정을 저장했습니다. 이 브라우저에서 다시 열어도 유지됩니다.');}
      catch{message('그래프 설정을 저장하지 못했습니다. 브라우저 저장 공간 또는 저장 권한을 확인해 주세요.',true);}
    });
    node('legend')?.addEventListener('click',event=>{
      const button=event.target.closest('button[data-ads-graph-key]');if(!button)return;
      const key=button.dataset.adsGraphKey;if(hidden.has(key))hidden.delete(key);else hidden.add(key);
      draw(lastResult);node('legend')?.querySelector('[data-ads-graph-key="'+key+'"]')?.focus({preventScroll:true});
    });
    initialized=true;syncControls();
    if(readError)message('저장된 그래프 설정을 읽지 못해 기본 구성을 사용합니다.',true);
    const resize=()=>{const width=Math.round(node('plot')?.clientWidth||0);if(width>0&&Math.abs(width-lastWidth)>2&&!loading&&lastResult){cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(()=>draw(lastResult));}};
    if(typeof ResizeObserver==='function'){const observer=new ResizeObserver(resize);observer.observe(node('plot'));}
    else if(typeof window!=='undefined')window.addEventListener('resize',resize);
  }
  function format(key,value){
    if(!Number.isFinite(value))return '—';const metric=byKey.get(key),text=new Intl.NumberFormat('ko-KR',{maximumFractionDigits:metric?.format==='pct'?2:2}).format(value);
    return metric?.format==='won'?text+'원':metric?.format==='pct'?text+'%':text;
  }
  function field(row,key){const metric=row?.metrics?.[key];return metric&&typeof metric==='object'?metric:{value:null,partial:false,detail:'해당 지표 미확인'};}
  function dateLabel(row){const from=row?.from||row?.date||'',to=row?.to||from;return from===to?from:from+' ~ '+to;}
  function valueDetail(row,key){const metric=field(row,key),coverage=Number.isFinite(metric.knownDays)&&Number.isFinite(metric.totalDays)?'확인 '+metric.knownDays+'/'+metric.totalDays+'일':'';return [metric.partial?'확인분 · 일부 날짜 또는 주문 미확인':'',coverage,metric.scope||byKey.get(key)?.scope||'',metric.detail||''].filter(Boolean).join(' · ');}
  function setDataMessage(text){const status=node('data-status');if(status)status.textContent=text;}
  function svgElement(tag,attributes={},text){const el=document.createElementNS(ns,tag);for(const [key,value]of Object.entries(attributes))el.setAttribute(key,String(value));if(text!==undefined)el.textContent=text;return el;}
  function normalizedSeries(series,keys){
    const original=keys.map(key=>series.map(row=>Number.isFinite(field(row,key).value)?field(row,key).value:null));
    const starts=original.map(values=>values.find(Number.isFinite));
    const fallback=config.scale==='relative'&&starts.some(value=>Number.isFinite(value)&&value<=0);
    const scale=fallback?'absolute':config.scale;
    const converted=original.map((values,index)=>{
      const divisor=scale==='relative'?starts[index]:Math.max(0,...values.filter(Number.isFinite).map(Math.abs));
      return values.map(value=>!Number.isFinite(value)?null:divisor>0?value/divisor*100:value===0?0:null);
    });
    return {original,converted,scale,fallback,starts};
  }
  function domain(values){
    const valid=values.filter(Number.isFinite);let min=Math.min(0,...valid),max=Math.max(0,...valid);
    if(min===max){min=min<0?min*1.1:0;max=max>0?max*1.1:100;}
    const rough=(max-min)/4,power=10**Math.floor(Math.log10(rough||1)),fraction=rough/power;
    const step=([1,2,2.5,5,10].find(value=>value>=fraction)||10)*power;
    min=Math.floor(min/step)*step;max=Math.ceil(max/step)*step;if(min===max)max=min+step;
    const ticks=[];for(let v=min;ticks.length<12&&v<=max+step/10;v+=step)ticks.push(Math.abs(v)<step/100000?0:v);
    return {min,max,ticks};
  }
  function legend(keys){
    const root=node('legend');if(!root)return;root.replaceChildren();
    keys.forEach((key,index)=>{const button=document.createElement('button');button.type='button';button.dataset.adsGraphKey=key;button.setAttribute('aria-pressed',String(!hidden.has(key)));button.title=(byKey.get(key)?.scope||'')+' · 클릭하면 선을 '+(hidden.has(key)?'표시':'숨김');
      const dot=document.createElement('i');dot.className='ads-graph-swatch';dot.style.backgroundColor=colors[index];dot.setAttribute('aria-hidden','true');button.append(dot,document.createTextNode(byKey.get(key)?.label||key));root.append(button);
    });
  }
  function dataTable(result,keys){
    const table=node('table');if(!table)return;table.setAttribute('aria-busy','false');const daily=Array.isArray(result?.dailySeries)?result.dailySeries:Array.isArray(result?.daySeries)?result.daySeries:null,rows=daily||result?.series||[];
    const head=table.querySelector('thead'),body=table.querySelector('tbody');if(!head||!body)return;head.replaceChildren();body.replaceChildren();
    if(node('table-title'))node('table-title').textContent=daily?'일별 실제 수치 보기':'그래프 구간별 수치 보기';
    const caption=table.querySelector('caption');if(caption)caption.textContent=(daily?'일별 원래 수치입니다. 그래프의 구간평균·지수 변환을 적용하지 않습니다.':'그래프에 표시한 구간 수치입니다. 금액·건수는 확인된 날짜의 일평균, 비율은 구간 합계 기준입니다.')+' —는 미확인, 확인분은 일부 데이터만 반영한 값입니다.';
    const heading=document.createElement('tr'),date=document.createElement('th');date.scope='col';date.textContent=daily?'날짜':'기간';heading.append(date);
    for(const key of keys){const cell=document.createElement('th');cell.scope='col';cell.textContent=byKey.get(key)?.label||key;const scope=document.createElement('small');scope.textContent=rows.map(row=>field(row,key).scope).find(Boolean)||byKey.get(key)?.scope||'';cell.append(scope);heading.append(cell);}head.append(heading);
    if(!keys.length||!rows.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=keys.length+1;td.textContent=keys.length?'표시할 날짜 데이터가 없습니다.':'그래프에 표시할 지표를 선택해 주세요.';tr.append(td);body.append(tr);return;}
    for(const row of rows){const tr=document.createElement('tr');tr.dataset.date=row.date||row.from||'';const date=document.createElement('th');date.scope='row';date.textContent=dateLabel(row);tr.append(date);
      for(const key of keys){const metric=field(row,key),td=document.createElement('td');td.dataset.metric=key;td.textContent=format(key,metric.value);td.title=valueDetail(row,key);if(metric.partial&&Number.isFinite(metric.value)){const badge=document.createElement('span');badge.className='ads-graph-partial';badge.textContent='확인분';td.append(badge);}tr.append(td);}body.append(tr);
    }
  }
  function empty(text){const root=node('plot');if(!root)return;root.replaceChildren();const p=document.createElement('p');p.className='ads-graph-empty';p.textContent=text;root.append(p);}
  function setLoading(){
    loading=true;const root=node('plot');if(root){root.setAttribute('aria-busy','true');empty('저장된 일별 데이터를 확인하고 있습니다.');}
    dataTable({series:[],dailySeries:[]},currentKeys());const table=node('table');if(table){table.setAttribute('aria-busy','true');const cell=table.querySelector('tbody td');if(cell)cell.textContent='선택한 기간의 일별 수치를 조회 중입니다.';}
    if(node('axis-note'))node('axis-note').textContent='선택 기간 그래프를 다시 확인하고 있습니다.';setDataMessage('');
  }
  function render(result){
    if(result?.status==='superseded')return;
    loading=false;lastResult=result||{status:'error',series:[],errors:['데이터 응답을 확인해 주세요.']};
    return draw(lastResult);
  }
  function draw(result){
    const root=node('plot');if(!root)return;const keys=currentKeys(),visible=keys.filter(key=>!hidden.has(key));syncControls(keys);legend(keys);dataTable(result,keys);root.setAttribute('aria-busy','false');
    const series=Array.isArray(result?.series)?result.series:[],errors=Array.isArray(result?.errors)?result.errors:[];
    const axis=node('axis-note');if(axis)axis.textContent='';
    if(!keys.length){empty('그래프 지표가 선택되지 않았습니다. 위에서 원하는 지표를 선택해 주세요.');setDataMessage('');return {points:0};}
    if(!visible.length){empty('모든 선을 숨겼습니다. 아래 범례를 누르면 다시 표시됩니다.');setDataMessage('숨긴 선의 원래 수치는 아래 표에서 확인할 수 있습니다.');return {points:0};}
    if(!series.length){empty(errors.length?errors.join(' / '):'조회한 기간에 표시할 데이터가 없습니다.');setDataMessage('미확인 날짜를 0으로 표시하지 않습니다.');return {points:0};}
    const values=normalizedSeries(series,visible),flat=values.converted.flat().filter(Number.isFinite);
    if(!flat.length){empty('선택한 지표의 수치를 확인하지 못했습니다. 조회 기간과 데이터 수집 상태를 확인해 주세요.');setDataMessage(errors.join(' / ')||'미확인 수치는 0으로 바꾸지 않습니다.');return {points:0};}
    const layoutWidth=Math.round(root.clientWidth||root.getBoundingClientRect().width||960),width=Math.max(300,layoutWidth);lastWidth=layoutWidth;
    const height=width<500?275:315,left=width<500?43:58,right=16,top=29,bottom=42,area=width-left-right;
    const bounds=domain(flat),x=index=>left+area*(series.length===1?.5:index/(series.length-1)),y=value=>top+(height-top-bottom)*(bounds.max-value)/(bounds.max-bounds.min);
    const svg=svgElement('svg',{viewBox:'0 0 '+width+' '+height,role:'img',tabindex:'0',class:'ads-graph-svg','aria-labelledby':'ads-graph-svg-title ads-graph-svg-description'});
    svg.append(svgElement('title',{id:'ads-graph-svg-title'},'선택 기간 지표 추이'),svgElement('desc',{id:'ads-graph-svg-description'},'방향키 좌우로 날짜별 값을 확인할 수 있습니다. 빈 점과 점선은 부분 집계이며, 값이 없는 날짜는 선을 연결하지 않습니다. 아래 펼침 표에 원래 수치가 있습니다.'));
    for(const tick of bounds.ticks){const yy=y(tick);svg.append(svgElement('line',{x1:left,y1:yy,x2:width-right,y2:yy,class:tick===0?'ads-graph-zero':'ads-graph-grid'}),svgElement('text',{x:left-8,y:yy+4,'text-anchor':'end'},new Intl.NumberFormat('ko-KR',{maximumFractionDigits:1}).format(tick)));}
    svg.append(svgElement('text',{x:left,y:14},values.scale==='relative'?'지수 · 시작값=100':'지수 · 지표별 |최대|=100'));
    const labelCount=width<500?3:Math.min(7,Math.max(3,Math.floor(area/125))),labelIndices=new Set([0,series.length-1]);
    for(let i=1;i<labelCount-1;i++)labelIndices.add(Math.round(i*(series.length-1)/(labelCount-1)));
    for(const index of [...labelIndices].sort((a,b)=>a-b)){const row=series[index];svg.append(svgElement('text',{x:x(index),y:height-14,'text-anchor':index===0&&series.length>1?'start':index===series.length-1&&series.length>1?'end':'middle'},row.label||String(row.from||row.date||'').slice(5)));}
    let pointCount=0,partialCount=0;
    visible.forEach((key,j)=>{
      const points=values.converted[j],color=colors[keys.indexOf(key)],paths={solid:'',partial:''};
      for(let i=1;i<points.length;i++){
        if(!Number.isFinite(points[i-1])||!Number.isFinite(points[i]))continue;
        const prior=series[i-1],row=series[i],gap=Date.parse((row.from||row.date)+'T00:00:00Z')-Date.parse((prior.to||prior.date)+'T00:00:00Z');
        if(Number.isFinite(gap)&&gap>86400000)continue;
        const kind=field(prior,key).partial||field(row,key).partial?'partial':'solid';paths[kind]+='M'+x(i-1).toFixed(2)+' '+y(points[i-1]).toFixed(2)+'L'+x(i).toFixed(2)+' '+y(points[i]).toFixed(2)+' ';
      }
      for(const kind of ['solid','partial'])if(paths[kind])svg.append(svgElement('path',{d:paths[kind],class:'ads-graph-series',stroke:color,'data-metric':key,'data-partial':String(kind==='partial'),...(kind==='partial'?{'stroke-dasharray':'6 4'}:{})}));
      points.forEach((value,i)=>{
        if(!Number.isFinite(value))return;const row=series[i],metric=field(row,key),partial=!!metric.partial;
        const circle=svgElement('circle',{cx:x(i),cy:y(value),r:partial?4:series.length>120?2:3,fill:partial?'var(--app-surface)':color,stroke:color,'stroke-width':partial?2:1,'data-metric':key,'data-index':i,'data-date':row.from||row.date,'data-to':row.to||row.date,'data-value':metric.value,'data-partial':String(partial)});
        circle.append(svgElement('title',{},dateLabel(row)+' · '+(byKey.get(key)?.label||key)+': '+format(key,metric.value)+(config.window>1?' (구간 수치)':'')+' · '+valueDetail(row,key)));svg.append(circle);pointCount++;if(partial)partialCount++;
      });
    });
    const cursor=svgElement('line',{x1:left,y1:top,x2:left,y2:height-bottom,class:'ads-graph-cursor',visibility:'hidden'});svg.append(cursor);
    const tooltip=document.createElement('div');tooltip.id='ads-graph-tooltip';tooltip.className='ads-graph-tooltip';tooltip.hidden=true;tooltip.setAttribute('role','status');tooltip.setAttribute('aria-live','off');
    root.replaceChildren(svg,tooltip);let hovered=0;
    function show(index){
      hovered=Math.max(0,Math.min(series.length-1,index));const row=series[hovered];tooltip.replaceChildren();const title=document.createElement('strong');title.textContent=dateLabel(row)+(config.window>1?' · 구간 수치':'');tooltip.append(title);
      visible.forEach(key=>{const metric=field(row,key),line=document.createElement('div');line.className='ads-graph-tooltip-row';const dot=document.createElement('i');dot.className='ads-graph-swatch';dot.style.backgroundColor=colors[keys.indexOf(key)];const label=document.createElement('span');label.textContent=byKey.get(key)?.label||key;const amount=document.createElement('b');amount.textContent=format(key,metric.value)+(metric.partial&&Number.isFinite(metric.value)?' 확인분':'');const detail=document.createElement('small');detail.textContent=valueDetail(row,key);line.append(dot,label,amount,detail);tooltip.append(line);});
      tooltip.hidden=false;cursor.setAttribute('x1',x(hovered));cursor.setAttribute('x2',x(hovered));cursor.setAttribute('visibility','visible');
      const rendered=root.clientWidth||width,px=x(hovered)*rendered/width,tw=tooltip.offsetWidth;
      tooltip.style.left=Math.max(4,Math.min(rendered-tw-4,px+12))+'px';tooltip.style.top='25px';
    }
    function hide(){tooltip.hidden=true;cursor.setAttribute('visibility','hidden');}
    svg.addEventListener('pointermove',event=>{tooltip.setAttribute('aria-live','off');const rect=svg.getBoundingClientRect(),px=(event.clientX-rect.left)*width/(rect.width||width);show(series.length===1?0:Math.round((px-left)/area*(series.length-1)));});
    svg.addEventListener('pointerleave',hide);svg.addEventListener('focus',()=>{tooltip.setAttribute('aria-live','polite');show(hovered);});svg.addEventListener('blur',()=>{tooltip.setAttribute('aria-live','off');hide();});
    svg.addEventListener('keydown',event=>{if(['ArrowLeft','ArrowRight','Home','End','Escape'].includes(event.key)){event.preventDefault();tooltip.setAttribute('aria-live','polite');if(event.key==='Escape')hide();else show(event.key==='Home'?0:event.key==='End'?series.length-1:hovered+(event.key==='ArrowRight'?1:-1));}});
    const aggregation=config.window===1?'일별 원본':config.window+'일 구간 · 매월 1일부터 나눈 겹치지 않는 구간 · 금액·건수는 확인된 날짜의 일평균, 비율은 구간 합계 기준';
    if(axis)axis.textContent=(series[0].from||series[0].date)+' ~ '+(series.at(-1).to||series.at(-1).date)+' · '+aggregation+' · '+(values.scale==='relative'?'각 지표의 첫 확인값을 100으로 비교합니다.':'각 지표의 최대 절댓값을 100으로 맞춥니다. 음수는 0선 아래에 표시합니다.')+(values.fallback?' 시작값이 0 또는 음수인 지표가 있어 이 표시 방식으로 전환했습니다.':'');
    setDataMessage((partialCount?'빈 점·점선 '+partialCount+'개는 확인분입니다. ':'')+'미확인 구간은 선을 연결하지 않습니다. 범례를 눌러 선을 숨기거나 다시 표시하세요. 그래프에 마우스를 올리거나 좌우 방향키로 실제 값을 확인할 수 있습니다.'+(errors.length?' · '+errors.join(' / '):''));
    return {points:pointCount,keys:visible,effectiveScale:values.scale};
  }
  return {setup,options,render,setLoading};
})();

// Per-ad columns and period summary cards have independent, explicitly saved settings.
const ADS_DISPLAY_STORAGE_KEY='roas-ads-display-v1';
const adsColumnMetrics=[
 {key:'spend',label:'광고비',format:'won',description:'이 광고의 선택 기간 광고비 · 원화 / USD 환산'},
 {key:'purchases',label:'구매',format:'num',description:'Meta가 이 광고에 귀속한 구매 건수'},
 {key:'revenue',label:'Meta 귀속 구매매출',format:'won',description:'Meta가 이 광고에 귀속한 구매 전환값'},
 {key:'roas',label:'ROAS',format:'pct',description:'이 광고의 Meta 귀속 구매매출 ÷ 전체 광고비 × 100'},
 {key:'cpa',label:'CPA',format:'won',description:'광고비 ÷ Meta 귀속 구매 건수'},
 {key:'cpc',label:'링크 CPC',format:'won',description:'광고비 ÷ 링크 클릭수'},
 {key:'cpm',label:'CPM',format:'won',description:'광고비 ÷ 노출수 × 1,000'},
 {key:'ctr',label:'링크 CTR',format:'pct',description:'링크 클릭수 ÷ 노출수 × 100'},
 {key:'frequency',label:'빈도',format:'frequency',description:'노출수 ÷ 고유 도달 · 여러 날짜의 고유 도달은 합산하지 않습니다.'},
 {key:'status',label:'판단',format:'status',description:'확대·유지·개선·중단 검토 또는 데이터 부족'},
 {key:'impressions',label:'노출수',format:'num',description:'광고가 표시된 횟수'},
 {key:'clicks',label:'링크 클릭수',format:'num',description:'Meta 인라인 링크 클릭수'},
 {key:'reach',label:'도달',format:'num',description:'고유 도달 수 · 여러 날짜는 중복을 제거할 수 없어 미확인으로 표시합니다.'},
 {key:'landing',label:'랜딩 페이지 조회',format:'num',description:'Meta가 이 광고에 귀속한 랜딩 페이지 조회'},
 {key:'cart',label:'장바구니 추가',format:'num',description:'Meta가 이 광고에 귀속한 장바구니 추가'},
 {key:'checkout',label:'결제 시작',format:'num',description:'Meta가 이 광고에 귀속한 결제 시작'},
 {key:'conversionRate',label:'구매 전환율',format:'pct',description:'Meta 귀속 구매 건수 ÷ 랜딩 페이지 조회 × 100'}
];
const adsDefaultColumns=['spend','purchases','revenue','roas','cpa','cpc','cpm','ctr','frequency','status'];
let adsDisplaySaved={version:1,columns:adsDefaultColumns.slice(),summary:[]},adsDisplayDraft=null;
function normalizeAdsDisplaySettings(value){
 const defaults={version:1,columns:adsDefaultColumns.slice(),summary:[]};
 if(!value||typeof value!=='object'||Array.isArray(value)||value.version!==1)return defaults;
 const clean=(keys,catalog,fallback)=>Array.isArray(keys)?[...new Set(keys.filter(key=>typeof key==='string'&&catalog.some(metric=>metric.key===key)))]:fallback.slice();
 return {version:1,columns:clean(value.columns,adsColumnMetrics,defaults.columns),summary:clean(value.summary,AdsOverviewSummary.metrics,[])};
}
function cloneAdsDisplaySettings(value){return {version:1,columns:value.columns.slice(),summary:value.summary.slice()};}
function adsDisplayMessage(text,error=false){
 const node=$('ads-display-status');if(!node)return;
 node.textContent=text;node.classList.toggle('ads-display-error',error);
}
function adsMetricValue(metric,ad){
 if(metric.key==='conversionRate')return ad.landing>0&&Number.isFinite(ad.purchases)?ad.purchases/ad.landing*100:null;
 return ad[metric.key];
}
function adsMetricCell(metric,ad){
 if(metric.key==='status')return '<td data-metric="status"><span class="stat '+safe(ad.diagnosis.status)+'">'+safe(statusNames[ad.diagnosis.status])+'</span></td>';
 let value=adsMetricValue(metric,ad),detail=metric.description,partial=false;
 const missingSpend=ad.spendPartial&&['roas','cpa','cpc','cpm'].includes(metric.key);
 if(missingSpend){value=null;detail='광고비 일부 미확인 · 계산 보류';}
 else if(['reach','frequency'].includes(metric.key)&&value==null&&ad.dates?.size>1)detail='기간 전체 미확인 · 여러 날짜의 고유 도달은 중복을 제거할 수 없어 합산하지 않습니다.';
 else if(value==null)detail='해당 지표가 수집되지 않았거나 계산할 데이터가 부족합니다. '+detail;
 else if(metric.key==='spend')partial=!!ad.spendPartial;
 else if(metric.key==='revenue')partial=!!ad.missing?.revenue;
 else if(metric.key==='purchases'||metric.key==='conversionRate')partial=!!ad.missing?.purchases;
 else if(metric.key==='roas')partial=!!ad.roasPartial;
 else if(metric.key==='cpa')partial=!!ad.cpaPartial;
 if(partial)detail='확인된 값만 반영 · 일부 항목 미확인. '+detail;
 const formatted=!Number.isFinite(value)?'—':metric.format==='won'?dual(value):metric.format==='pct'?pct(value):metric.format==='frequency'?value.toFixed(1):num(value);
 return '<td data-metric="'+metric.key+'" title="'+safe(detail)+'">'+(metric.key==='roas'?'<b>'+safe(formatted)+'</b>':safe(formatted))+(partial?'<span class="ads-metric-partial">확인분</span>':'')+'</td>';
}
// Overview choices are real table columns. Period totals have their own row,
// because store orders cannot be assigned to individual Meta advertisements.
const adsSharedOverviewKeys=new Set(['revenue','purchases','cpa','cpc','cpm','ctr','impressions','clicks']);
let adsPeriodViewSignature='',adsPeriodViewResult=null,adsPeriodViewPending=null,adsPeriodViewVersion=0;
function effectiveAdsDisplaySettings(){return adsDisplayDraft||adsDisplaySaved;}
function adsTableColumns(configuration=effectiveAdsDisplaySettings()){
 const columns=configuration.columns.map(key=>adsColumnMetrics.find(metric=>metric.key===key)).filter(Boolean).map(metric=>({key:metric.key,kind:'ad',metric,overviewKey:null}));
 for(const key of configuration.summary){
  const overview=AdsOverviewSummary.metrics.find(metric=>metric.key===key);if(!overview)continue;
  if(adsSharedOverviewKeys.has(key)){
   const existing=columns.find(column=>column.kind==='ad'&&column.key===key);
   if(existing){existing.overviewKey=key;existing.metric={...existing.metric,label:overview.label};}
   else{
    const metric=adsColumnMetrics.find(item=>item.key===key);
    if(metric)columns.push({key,kind:'ad',metric:{...metric,label:overview.label},overviewKey:key});
   }
  }else columns.push({key:'overview-'+key,kind:'period',metric:overview,overviewKey:key});
 }
 return columns;
}
function adsTableCell(column,ad){
 if(column.kind==='period')return '<td class="ads-period-reference" data-metric="'+column.key+'" data-summary-key="'+column.overviewKey+'" title="'+safe(column.metric.description)+' 선택 기간 합계 행에서 확인하세요."><span>합계 행 참조</span></td>';
 const cell=adsMetricCell(column.metric,ad);
 return column.overviewKey?cell.replace('<td ','<td data-summary-key="'+column.overviewKey+'" '):cell;
}
function renderAdsPeriodTotal(){
 const body=$('ads-period-total'),note=$('ads-table-summary-note');if(!body)return;
 const active=effectiveAdsDisplaySettings(),keys=active.summary,columns=adsTableColumns(active);
 body.hidden=keys.length===0;if(note)note.hidden=keys.length===0;
 if(!keys.length){body.replaceChildren();if(note)note.textContent='';return;}
 const result=adsPeriodViewResult,metrics=new Map((result?.metrics||[]).map(metric=>[metric.key,metric]));
 const dates=[$('since')?.value,$('until')?.value].filter(Boolean).join(' ~ ');
 const cells=columns.map(column=>{
  if(!column.overviewKey)return '<td data-metric="'+column.key+'" title="이 항목은 아래 광고별 행에서 확인하세요.">—</td>';
  const metric=metrics.get(column.overviewKey),value=metric?.value;
  const text=!Number.isFinite(value)?'—':column.metric.format==='won'?dual(value):column.metric.format==='pct'?pct(value):num(value);
  const detail=metric?(metric.scope+' · '+metric.detail):result?.status==='error'?'조회 실패 · 데이터를 확인해 주세요.':'선택 기간 데이터 조회 중…';
  return '<td data-metric="'+column.key+'" data-summary-key="'+column.overviewKey+'" title="'+safe(detail)+'"><strong>'+safe(text)+'</strong>'+(metric?.partial&&Number.isFinite(value)?'<span class="ads-metric-partial">확인분</span>':'')+'<small class="ads-total-state">'+safe(metric?.scope||column.metric.scope||'선택 기간 합계')+'</small></td>';
 }).join('');
 body.innerHTML='<tr id="ads-period-total-row"><th scope="row"><b>선택 기간 합계</b><small>'+safe(dates)+'</small></th>'+cells+'</tr>';
 if(note)note.textContent='한눈에 보기에서 선택한 지표 '+keys.length+'개를 표에 표시합니다. 합계 행은 선택 기간과 각 지표에 표시된 집계 범위를 따르며, 아래 광고의 캠페인·소재·검색 필터와 별도로 집계합니다.'+
  (!result?' 데이터 조회 중…':result.errors?.length?' 일부 데이터 확인 필요: '+result.errors.join(' / '):' 전체·채널 매출과 이익은 합계 행에서 확인하세요.');
 body.setAttribute('aria-busy',String(!result));
}
function renderAdsTable(shown){
 const columns=adsTableColumns(),head=$('ad-head');
 if(head)head.innerHTML='<th scope="col">광고 · 캠페인</th>'+columns.map(column=>'<th scope="col" data-metric="'+column.key+'"'+(column.overviewKey?' data-summary-key="'+column.overviewKey+'"':'')+' title="'+safe(column.metric.description)+'">'+safe(column.metric.label)+(column.kind==='period'?'<small class="ads-table-scope">기간 합계</small>':'')+'</th>').join('');
 $('ad-body').innerHTML=shown.length?shown.map(ad=>'<tr class="ad-row '+(String(state.selected)===String(ad.id)?'selected':'')+'" data-id="'+safe(ad.id)+'"><td><button type="button" class="ads-ad-link" aria-label="'+safe(ad.ad)+' 광고 상세 진단 보기">'+(ad.channel?'['+(ad.channel==='naver'?'네이버':'카페24')+'] ':'')+safe(ad.ad)+'</button><small>'+safe(ad.campaign)+' / '+safe(ad.adset)+'</small></td>'+columns.map(column=>adsTableCell(column,ad)).join('')+'</tr>').join(''):'<tr><td colspan="'+(columns.length+1)+'">조건에 해당하는 광고가 없습니다.</td></tr>';
 const active=effectiveAdsDisplaySettings();
 $('table-footer').textContent='광고 '+shown.length+'개 · 표 지표 '+columns.length+'개'+(active.summary.length?' · 한눈에 보기 선택 지표는 합계 행에 표시 · 공통 항목은 같은 열에 표시':'')+' · 기간 중 중복 도달은 합산하지 않습니다.';
 updateAdsPeriodSummary();
}
function invalidateAdsPeriodData(){
 AdsOverviewSummary.invalidate();adsPeriodViewVersion++;adsPeriodViewSignature='';adsPeriodViewResult=null;adsPeriodViewPending=null;
}
function updateAdsPeriodSummary(force=false){
 const accountIds={naver:String($('naver-account')?.value||'').trim().replace(/^act_/,''),cafe:String($('cafe-account')?.value||'').trim().replace(/^act_/,'')};
 const channel=state.channel!=='all'?state.channel:($('account-choice')?.value||'all');
 const graph=AdsPerformanceGraph.options();
 const active=effectiveAdsDisplaySettings();
 const input={keys:active.summary.slice(),seriesKeys:graph.keys,window:graph.window,since:$('since')?.value||'',until:$('until')?.value||'',fx:state.fxRate,accountIds,channel,force};
 const signature=JSON.stringify({...input,force:false,scale:graph.scale});
 if(!force&&signature===adsPeriodViewSignature&&(adsPeriodViewResult||adsPeriodViewPending)){
  renderAdsPeriodTotal();return adsPeriodViewPending||Promise.resolve(adsPeriodViewResult);
 }
 const version=++adsPeriodViewVersion;
 adsPeriodViewSignature=signature;adsPeriodViewResult=null;
 renderAdsPeriodTotal();AdsPerformanceGraph.setLoading();
 adsPeriodViewPending=AdsOverviewSummary.update(input).then(result=>{
  if(version!==adsPeriodViewVersion||result.status==='superseded')return {status:'superseded',metrics:[],series:[]};
  adsPeriodViewResult=result;adsPeriodViewPending=null;
  renderAdsPeriodTotal();AdsPerformanceGraph.render(result);return result;
 }).catch(error=>{
  if(version!==adsPeriodViewVersion)return {status:'superseded',metrics:[],series:[]};
  const result={status:'error',metrics:[],series:[],dailySeries:[],errors:[String(error?.message||error)]};
  adsPeriodViewResult=result;adsPeriodViewPending=null;renderAdsPeriodTotal();AdsPerformanceGraph.render(result);return result;
 });
 return adsPeriodViewPending;
}

function renderAdsDisplayEditor(){
 const editor=$('ads-display-editor'),toggle=$('ads-display-toggle');if(!editor||!toggle)return;
 const editing=!!adsDisplayDraft;
 editor.hidden=!editing;toggle.setAttribute('aria-expanded',String(editing));
 if(!editing)return;
 const focused=document.activeElement?.id;
 for(const [scope,catalog,prefix] of [['columns',adsColumnMetrics,'column'],['summary',AdsOverviewSummary.metrics,'summary']]){
  const keys=adsDisplayDraft[scope];
  $('ads-'+prefix+'-count').textContent=keys.length+'개 선택 / 전체 '+catalog.length+'개';
  $('ads-'+prefix+'-options').innerHTML=catalog.map(metric=>'<label class="ads-metric-option" for="ads-'+prefix+'-'+metric.key+'"><input type="checkbox" id="ads-'+prefix+'-'+metric.key+'" data-ads-kind="'+scope+'" data-ads-key="'+metric.key+'"'+(keys.includes(metric.key)?' checked':'')+'><span><b>'+safe(metric.label)+'</b><small>'+safe(metric.description||metric.scope||'선택 기간 기준')+'</small></span></label>').join('');
  $('ads-'+prefix+'-order').innerHTML=keys.length?keys.map((key,index)=>{
   const metric=catalog.find(item=>item.key===key),label=metric.label;
   return '<li><span>'+(index+1)+'. '+safe(label)+'</span><button type="button" id="ads-'+prefix+'-move-'+key+'-back" data-ads-move="'+scope+'" data-ads-key="'+key+'" data-ads-step="-1" aria-label="'+safe(label)+' 앞으로 이동"'+(index===0?' disabled':'')+'>←</button><button type="button" id="ads-'+prefix+'-move-'+key+'-next" data-ads-move="'+scope+'" data-ads-key="'+key+'" data-ads-step="1" aria-label="'+safe(label)+' 뒤로 이동"'+(index===keys.length-1?' disabled':'')+'>→</button></li>';
  }).join(''):'<li class="ads-order-empty">'+(scope==='columns'?'광고 이름만 표시합니다.':'한눈에 보기 추가 열과 합계 행을 숨깁니다.')+'</li>';
 }
 if(focused)$(focused)?.focus({preventScroll:true});
}
function closeAdsDisplayEditor(message){
 adsDisplayDraft=null;renderAdsDisplayEditor();render();adsDisplayMessage(message);$('ads-display-toggle')?.focus({preventScroll:true});
}
function setupAdsDisplaySettings(){
 if(!$('ads-display-toggle'))return;
 try{
  const raw=localStorage.getItem(ADS_DISPLAY_STORAGE_KEY);
  adsDisplaySaved=normalizeAdsDisplaySettings(raw?JSON.parse(raw):null);
  adsDisplayMessage(raw?'저장한 표시 구성을 사용 중입니다.':'표시 항목 설정에서 원하는 지표를 선택하고 저장하세요.');
 }catch{adsDisplaySaved=normalizeAdsDisplaySettings(null);adsDisplayMessage('저장한 표시 설정을 읽지 못해 기본 구성을 사용합니다.',true);}
 $('ads-display-toggle').addEventListener('click',()=>{
  if(adsDisplayDraft){closeAdsDisplayEditor('변경 사항을 취소했습니다.');return;}
  adsDisplayDraft=cloneAdsDisplaySettings(adsDisplaySaved);renderAdsDisplayEditor();
  adsDisplayMessage('항목과 순서를 선택한 다음 설정 저장을 누르세요.');
  $('ads-display-editor').querySelector('input')?.focus({preventScroll:true});
 });
 $('ads-display-editor').addEventListener('change',event=>{
  const input=event.target,scope=input.dataset.adsKind,key=input.dataset.adsKey;
  if(!adsDisplayDraft||!['columns','summary'].includes(scope)||!key)return;
  if(input.checked){if(!adsDisplayDraft[scope].includes(key))adsDisplayDraft[scope].push(key);}
  else adsDisplayDraft[scope]=adsDisplayDraft[scope].filter(item=>item!==key);
  renderAdsDisplayEditor();render();adsDisplayMessage('체크한 항목을 표·합계·그래프에 미리 표시했습니다. 설정 저장을 누르면 다음 접속에도 유지됩니다.');
 });
 $('ads-display-editor').addEventListener('click',event=>{
  const button=event.target.closest('button');if(!button||!adsDisplayDraft)return;
  if(button.dataset.adsSelect){
   const [scope,mode]=button.dataset.adsSelect.split(':');
   const catalog=scope==='columns'?adsColumnMetrics:AdsOverviewSummary.metrics;
   adsDisplayDraft[scope]=mode==='all'?catalog.map(metric=>metric.key):[];
   renderAdsDisplayEditor();render();adsDisplayMessage('선택 변경을 표·합계·그래프에 미리 표시했습니다. 설정 저장을 누르면 다음 접속에도 유지됩니다.');
  }
  if(button.dataset.adsMove){
   const keys=adsDisplayDraft[button.dataset.adsMove],from=keys.indexOf(button.dataset.adsKey),to=from+Number(button.dataset.adsStep);
   if(from<0||to<0||to>=keys.length)return;
   [keys[from],keys[to]]=[keys[to],keys[from]];renderAdsDisplayEditor();render();
   adsDisplayMessage('표시 순서를 미리 반영했습니다. 설정 저장을 누르면 다음 접속에도 유지됩니다.');
  }
 });
 $('ads-display-editor').addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();closeAdsDisplayEditor('변경 사항을 취소했습니다.');}});
 $('ads-display-cancel').addEventListener('click',()=>closeAdsDisplayEditor('변경 사항을 취소했습니다.'));
 $('ads-display-reset').addEventListener('click',()=>{
  adsDisplayDraft=normalizeAdsDisplaySettings(null);renderAdsDisplayEditor();render();
  adsDisplayMessage('기본 구성을 미리 표시했습니다. 설정 저장을 누르면 다음 접속에도 유지됩니다.');
 });
 $('ads-display-save').addEventListener('click',()=>{
  if(!adsDisplayDraft)return;
  const next=normalizeAdsDisplaySettings(adsDisplayDraft);
  try{localStorage.setItem(ADS_DISPLAY_STORAGE_KEY,JSON.stringify(next));}
  catch{adsDisplayMessage('설정을 저장하지 못했습니다. 브라우저 저장 공간 또는 사이트 저장 권한을 확인해 주세요. 변경 사항은 아직 적용되지 않았습니다.',true);return;}
  adsDisplaySaved=cloneAdsDisplaySettings(next);
  closeAdsDisplayEditor('표 항목 '+adsTableColumns(next).length+'개를 저장했습니다. 한눈에 보기 선택 지표 '+next.summary.length+'개는 표의 합계 행에 표시됩니다.');
  render();
 });
 for(const id of ['since','until','account-choice'])$(id)?.addEventListener('change',()=>updateAdsPeriodSummary());
 window.addEventListener('hashchange',()=>{if(location.hash==='#ads-section')updateAdsPeriodSummary(true);});
 for(const link of document.querySelectorAll('[data-app-route="ads-section"]'))link.addEventListener('click',event=>{if(event.button===0&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey)updateAdsPeriodSummary(true);});
 renderAdsDisplayEditor();
}

function render(){const c=settings(),rawAds=aggregate(visibleRows());c.baseline=adBenchmark(rawAds);const ads=rawAds.map(a=>({...a,diagnosis:diagnose(a,c)}));state.ads=ads;updateDiagnosisHierarchy();const t=totals(ads);$('k-spend').textContent=won(t.spend);$('k-revenue').textContent=won(t.revenue);$('k-roas').textContent=pct(t.roas);$('k-cpa').textContent=won(t.cpa);$('k-spend-usd').textContent=state.source==='api'?dollars(t.spend/state.fxRate)+' (USD 환산)':'';$('k-revenue-usd').textContent=state.source==='api'?dollars(t.revenue==null?null:t.revenue/state.fxRate)+' (USD 환산)':'Meta 귀속 구매 전환값';$('k-cpa-usd').textContent=state.source==='api'?dollars(t.cpa==null?null:t.cpa/state.fxRate)+' (USD 환산)':'';$('k-ads').textContent=`광고 ${num(ads.length)}개`;if($('channel-metrics'))$('channel-metrics').textContent=`현재 ${state.channel==='all'?'전체 통합':state.channel==='naver'?'네이버 스마트스토어':'카페24 자사몰'} · 광고 ${num(ads.length)}개`;$('k-goal').textContent=`광고 평균 ROAS ${benchmarkRoasText(c.baseline)}`;$('k-purchases').textContent=t.purchases==null?'구매 데이터 없음':`구매 ${num(t.purchases)}건`;
const counts={scale:0,keep:0,improve:0,review:0,learn:0};ads.forEach(a=>counts[a.diagnosis.status]++);$('summary').innerHTML=[['↗','확대 검토',`${counts.scale}개 광고 · 평균 대비 우수한 효율의 광고`],['◇','개선 / 중단 검토',`${counts.improve+counts.review}개 광고 · 구매 전환 및 지출 효율 확인 필요`],['◷','데이터 부족',`${counts.learn}개 광고 · 성급한 중단 대신 학습 관찰 필요`]].map(q=>`<div class="summary-item"><span class="s-icon">${q[0]}</span><div><b>${q[1]}</b><p>${q[2]}</p></div></div>`).join('');
const steps=[['링크 클릭',t.clicks,null],['랜딩 조회',t.landing,t.clicks],['장바구니',t.cart,t.landing],['결제 시작',t.checkout,t.cart],['구매',t.purchases,t.checkout]];
$('funnel-grid').innerHTML=steps.map(([name,n,prior])=>`<div class="funnel-step"><small>${name}</small><strong>${n==null?'미수집':num(n)}</strong><span class="rate">${prior==null||n==null?'비율 계산 불가':prior===0?'이전 단계 0':`이전 단계 대비 ${pct(n/prior*100)}`}</span></div>`).join('');
const q=$('search').value.trim().toLowerCase(),filter=$('filter').value;
const chosenChannel=$('diag-channel').value,chosenCampaign=$('diag-campaign').value,chosenSet=$('diag-adset').value,chosenAd=$('diag-ad').value;
const compareKey=(r,level)=>level==='campaign'?JSON.stringify([r.channel||'',r.campaign||'']):level==='adset'?JSON.stringify([r.channel||'',r.campaign||'',r.adset||'']):JSON.stringify([r.channel||'',r.campaign||'',r.adset||'',String(r.id||r.ad||'')]);
const shown=ads.filter(a=>(chosenChannel==='all'||a.channel===chosenChannel)&&(!chosenCampaign||compareKey(a,'campaign')===chosenCampaign)&&(!chosenSet||compareKey(a,'adset')===chosenSet)&&(!chosenAd||compareKey(a,'ad')===chosenAd)&&(!q||[a.ad,a.adset,a.campaign].join(' ').toLowerCase().includes(q))&&(filter==='all'||a.diagnosis.status===filter)).sort((a,b)=>b.spend-a.spend);
renderAdsTable(shown);
for(const el of document.querySelectorAll('.ad-row'))el.addEventListener('click',()=>{state.selected=el.dataset.id;render();$('detail').scrollIntoView({behavior:'smooth',block:'nearest'});});
const chosen=ads.find(a=>String(a.id)===String(state.selected));if(chosen){$('detail-title').textContent=`${chosen.ad} · ${chosen.campaign}`;$('detail-status').className=`status ${chosen.diagnosis.status}`;$('detail-status').textContent=statusNames[chosen.diagnosis.status];const chips=[['ROAS',pct(chosen.roas)],['CPA',dual(chosen.cpa)],['링크 CPC',dual(chosen.cpc)],['빈도',chosen.frequency==null?'기간 전체 미확인':chosen.frequency.toFixed(2)+'회'],['랜딩 조회',chosen.landing==null?'미수집':num(chosen.landing)],['구매 전환율',chosen.landing>0&&chosen.purchases!=null?pct(chosen.purchases/chosen.landing*100):'—'],['링크 CTR',pct(chosen.ctr)],['도달',chosen.reach==null?'일별 중복·미수집':num(chosen.reach)]];$('detail-body').classList.remove('muted');$('detail-body').innerHTML=`<div class="detail-metrics">${chips.map(([k,v])=>`<div class="metric-chip">${k}<strong>${v}</strong></div>`).join('')}</div><div class="reasons"><div class="reason-box"><h3>진단 근거</h3><ul>${chosen.diagnosis.reasons.map(x=>`<li>${safe(x)}</li>`).join('')}</ul></div><div class="reason-box"><h3>추천 액션</h3><ul>${chosen.diagnosis.actions.map(x=>`<li>${safe(x)}</li>`).join('')}</ul></div></div>`;}else{$('detail-title').textContent='목록에서 광고를 선택하세요.';$('detail-status').textContent='선택 대기';$('detail-status').className='status neutral';$('detail-body').textContent='성과표의 행을 누르면 진단 근거가 표시됩니다.';$('detail-body').classList.add('muted');}
plot();if(typeof renderComparison==='function')renderComparison();}
function load(rows,source,currency='KRW'){invalidateAdsPeriodData();state.rows=rows.map(r=>source==='api'?{...r,rawSpend:r.spend,rawRevenue:r.revenue,spend:r.spend*(r.currency==='USD'?state.fxRate:1),revenue:r.revenue==null?null:r.revenue*(r.currency==='USD'?state.fxRate:1)}:r);state.channel='all';$('channel-filter').value='all';$('channel-bar').hidden=!(source==='api'&&rows.some(r=>r.channel));state.currency=currency;state.source=source;state.selected=null;$('data-badge').textContent={api:'● Meta API 데이터',csv:'● CSV 업로드 데이터',demo:'● 샘플 데이터'}[source];$('source-status').textContent={api:'Meta API · 조회 완료',csv:'CSV · 분석 준비 완료',demo:'데모 데이터 활성화'}[source];$('message').textContent=rows.length? '': '선택한 기간의 광고 데이터가 없습니다.';if(source==='api')$('message').textContent=`Meta 원본 통화: ${currency} · USD 금액은 1달러 ${num(state.fxRate)}원으로 환산 · ${state.fxMeta} · ROAS는 환율과 무관합니다.`;render();}
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
async function init(){setupAdsDisplaySettings();AdsPerformanceGraph.setup({metrics:AdsOverviewSummary.metrics,getTableKeys:()=>adsDisplaySaved.summary.slice(),onChange:()=>updateAdsPeriodSummary()});for(const nav of document.querySelectorAll('.nav'))nav.addEventListener('click',()=>{document.querySelectorAll('.nav').forEach(n=>n.classList.toggle('active',n===nav));$(nav.dataset.anchor).scrollIntoView({behavior:'smooth'});});
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
async function refreshApi(reason='manual'){if(refreshing)return;refreshing=true;let summaryReloaded=false;const btn=$('connect');btn.disabled=true;btn.textContent='조회 중…';$('auto-status').textContent='API 조회 중…';$('message').textContent='';try{const ids={naver:cleanId($('naver-account').value),cafe:cleanId($('cafe-account').value)};const choice=$('account-choice').value;const targets=choice==='all'?['naver','cafe']:[choice];if(targets.some(t=>!/^\d{5,30}$/.test(ids[t])))throw Error('조회할 채널의 광고 계정 ID를 먼저 입력하세요.');if(targets.length===2&&ids.naver===ids.cafe)throw Error('두 채널의 계정 ID가 동일합니다. 서로 다른 광고 계정인지 확인하세요.');let all=[],currencies=new Set(),failed=[],cacheWarnings=[];for(const channel of targets){try{const q=new URLSearchParams({account:ids[channel],since:$('since').value,until:$('until').value});const response=await fetch('/api/insights?'+q);const data=await response.json();if(!response.ok)throw Error(data.error||'API 조회 실패');currencies.add(data.currency||'KRW');if(data.cache){const c=data.cache;if(c.missingDays.length||c.staleDays.length||c.warnings.length)cacheWarnings.push((channel==='naver'?'네이버':'카페24')+': '+c.storedDays+'/'+c.totalDays+'일 저장 · 미저장 '+c.missingDays.length+'일 · 갱신 지연 '+c.staleDays.length+'일'+(c.warnings.length?' · '+c.warnings.join('; '):''));}all.push(...data.rows.map(r=>({...normalizeApi(r),channel})));}catch(err){failed.push((channel==='naver'?'네이버':'카페24')+': '+err.message);}}if(!all.length)throw Error(failed.join(' / ')||'조회 결과가 없습니다.');if([...currencies].some(c=>!['KRW','USD'].includes(c)))throw Error('USD/KRW 이외의 통화가 포함되어 합산할 수 없습니다.');load(all,'api',[...currencies].join('+')||'KRW');summaryReloaded=true;if(failed.length||cacheWarnings.length)$('message').textContent=[failed.length?'일부 계정 조회 실패: '+failed.join(' / '):'',...cacheWarnings].filter(Boolean).join(' / ')+' · 저장된 날짜만 반영될 수 있습니다.';const stamped=new Date().toLocaleString('ko-KR');$('auto-status').textContent=`마지막 갱신: ${stamped}${(failed.length||cacheWarnings.length)?' · 일부 미갱신/누락 (주의)':' · 날짜별 로컬 저장 완료'} · 최근 7일: 하루 1회 검증`; }catch(err){$('message').textContent='Meta API 조회 오류: '+err.message;$('auto-status').textContent='자동 갱신 실패 · '+new Date().toLocaleTimeString('ko-KR')+' · 수동 재시도 가능';}finally{refreshing=false;btn.disabled=false;btn.textContent='지금 새로고침 ↻';if(!summaryReloaded){invalidateAdsPeriodData();updateAdsPeriodSummary();}}}
for(const preset of document.querySelectorAll('.preset'))preset.addEventListener('click',()=>{const end=new Date();end.setHours(12,0,0,0);const start=new Date(end);const choice=preset.dataset.days;if(choice==='yesterday'){end.setDate(end.getDate()-1);start.setTime(end.getTime());}else if(choice==='3months'){start.setMonth(start.getMonth()-3);start.setDate(start.getDate()+1);}else if(choice==='6months'){start.setMonth(start.getMonth()-6);start.setDate(start.getDate()+1);}else if(choice==='1year'){start.setFullYear(start.getFullYear()-1);start.setDate(start.getDate()+1);}else if(choice==='2years'){start.setFullYear(start.getFullYear()-2);start.setDate(start.getDate()+1);}else if(choice!=='today'){start.setDate(start.getDate()-(Number(choice)-1));}$('since').value=toLocalDate(start);$('until').value=toLocalDate(end);document.querySelectorAll('.preset').forEach(b=>b.classList.toggle('active',b===preset));if($('auto-enabled').checked)refreshApi('preset');else updateAdsPeriodSummary();});
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
  t.cpc=clicks>0?t.spend/clicks:null;t.cpm=impressions>0?t.spend/impressions*1000:null;t.ctr=impressions>0?clicks/impressions*100:null;
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
 const keys=[['spend','광고비'],['purchases','구매 건수'],['revenue','구매 매출'],['roas','ROAS'],['cpa','CPA'],['cpc','링크 CPC'],['cpm','CPM'],['ctr','링크 CTR']];
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
 keys.map(([k,label])=>'<tr><td>'+label+'</td><td>'+fmt(k,a)+'</td><td>'+(['roas','cpa','cpc','cpm','ctr'].includes(k)?'기간 합산 비율':avg(k,a))+'</td><td>'+fmt(k,b)+'</td><td>'+(['roas','cpa','cpc','ctr'].includes(k)?'기간 합산 비율':avg(k,b))+'</td><td>'+diff(k)+'</td></tr>').join('')+'</tbody></table>'+
 '<p class="helper">집행일 평균 = 합계 ÷ 광고비가 0원보다 큰 날짜 수입니다. 예를 들어 7일 중 5일만 광고비가 있으면 5로 나눕니다. 광고비 0원 날짜와 미수집 날짜는 따로 표시합니다. 비율(ROAS·CPA·CPC·CTR)은 일별 단순평균이 아닌 기간 전체 금액·건수·클릭·노출의 합계로 계산합니다. 0원 날짜의 사유는 광고 관리자에서 확인해야 합니다.</p>';
 const dates=[...new Set([...a.dates,...b.dates])].sort();
 $('compare-daily').innerHTML='<table><thead><tr><th>날짜</th><th>구분</th><th>광고비</th><th>구매</th><th>매출</th><th>ROAS</th><th>CPA</th><th>CPM</th><th>상태</th></tr></thead><tbody>'+
 dates.map(date=>{const v=totals(aggregate(byDate.get(date)||[])),isA=date>=a.from&&date<=a.to;return '<tr><td>'+date+'</td><td>'+(isA?'A':'B')+'</td><td>'+dual(v.spend)+'</td><td>'+(v.purchases==null?'—':num(v.purchases))+'</td><td>'+dual(v.revenue)+'</td><td>'+pct(v.roas)+'</td><td>'+(v.purchases>0&&v.spend!=null?dual(v.spend/v.purchases):'—')+'</td><td>'+(v.impressions>0&&v.spend!=null?dual(v.spend/v.impressions*1000):'—')+'</td><td>'+(v.spend===0?'광고비 0원':'기록 있음')+'</td></tr>';}).join('')+'</tbody></table>';
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
 const diagnostic=$('compare-diagnostics');diagnostic.textContent='버튼 클릭 확인 · 날짜별 저장 데이터 조회 준비 중';
 try {
 const button=$('compare-run'),dates=[[$('compare-a-start').value,$('compare-a-end').value],[$('compare-b-start').value,$('compare-b-end').value]];
 if(dates.some(([s,e])=>!s||!e||s>e)){$('compare-diagnostics').textContent='기간 A와 B의 날짜 범위가 올바르지 않습니다.';renderComparison();return;}
 const getAccountId=value=>String(value||'').trim().replace(/^act_/,'');
 const channelIds={naver:getAccountId($('naver-account').value),cafe:getAccountId($('cafe-account').value)};
 const selected=$('compare-channel').value,channels=selected==='all'?['naver','cafe']:[selected],rows=[],errors=[],summary=[];
 const windows=[];
 for(const [start,end] of dates){
   for(let d=start;d<=end;){const last=plusDays(d,6),stop=last<end?last:end;windows.push([d,stop]);d=plusDays(stop,1);}
 }
 button.disabled=true;button.textContent='기간별 저장 데이터 확인 중…';
 const output=$('compare-result');
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
     rows.push(...items.map(row=>{const normalized=normalizeApi(row),fx=normalized.currency==='USD'?state.fxRate:1;return {...normalized,channel,rawSpend:normalized.spend,rawRevenue:normalized.revenue,spend:normalized.spend*fx,revenue:normalized.revenue==null?null:normalized.revenue*fx};}));
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
  node.textContent='저장 데이터 진단 (비교 기간 A/B만 확인 · Meta 원본 통화 기준 합산 후 USD→KRW 환산)\n'+summary.join('\n')+'\n필터 통과 '+filtered.length+'개 광고 행'+(errors.length?'\n조회 오류: '+errors.slice(0,12).join(' | '):'')+'\n※ 저장 날짜는 광고가 실제 집행된 날짜와 다를 수 있습니다. 표시된 값은 현재 실행 중인 프로그램의 저장소 기준입니다.';
  diagnostic.replaceChildren(node);
 }catch(e){diagnostic.textContent='날짜별 비교 실행 오류: '+e.message;output.textContent='날짜별 비교 오류: '+e.message;}
 finally{button.disabled=false;button.textContent='저장 데이터 비교';}
 } catch(error){diagnostic.textContent='조회 시작 실패: '+String(error?.message||error);$('compare-run').disabled=false;$('compare-run').textContent='저장 데이터 비교';}
});
 $('change-save').addEventListener('click',()=>{const date=$('compare-date').value,note=$('change-note').value.trim();if(!date||!note){alert('변경일과 변경 메모를 입력해 주세요.');return;}const campaign=$('compare-campaign'),set=$('compare-adset'),creative=$('compare-creative');const ad=[campaign,set,creative].map(x=>x.options[x.selectedIndex]?.textContent).filter(Boolean).join(' / ');const changes=readChanges();changes.unshift({date,kind:$('change-kind').value,ad,note});localStorage.setItem(CHANGE_KEY,JSON.stringify(changes.slice(0,500)));$('change-note').value='';renderChangeHistory();});
}


