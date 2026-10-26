/* Shared parsing and comparisons. No traffic or orders are inferred from missing cells. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.roasGfaData=factory();})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  const day=86400000, at=d=>Date.parse(d+'T00:00:00Z');
  const validDate=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(at(d))&&new Date(at(d)).toISOString().slice(0,10)===d;
  const clean=s=>String(s??'').replace(/[\s\uFEFF]/g,'').toLowerCase();
  function number(v){if(v===null||v===undefined||String(v).trim()==='')return null;const s=String(v).replace(/[₩￦,\s%]/g,'').replace(/원|회|건/g,'');return /^\d+(\.\d+)?$/.test(s)&&Number.isFinite(+s)?+s:null;}
  function sum(rows,key){return rows.length&&rows.every(r=>r[key]!==null&&r[key]!==undefined)?rows.reduce((s,r)=>s+r[key],0):null;}
  const rate=(n,d,factor=100)=>n!==null&&d>0?n/d*factor:null;
  function dates(value){const found=String(value??'').match(/20\d{2}[.\-\/]\s*\d{1,2}[.\-\/]\s*\d{1,2}/g)||[];return found.map(s=>s.split(/[.\-\/]/).map(x=>x.trim()).map((x,i)=>i?x.padStart(2,'0'):x).join('-')).filter(validDate);}
  function range(since,until){if(!validDate(since)||!validDate(until)||since>until||(at(until)-at(since))/day>365)throw Object.assign(Error('시작일과 종료일을 확인하세요. 한 번에 최대 366일을 저장할 수 있습니다.'),{status:400});}
  function delimited(text){
    const separator=text.split(/\r?\n/).slice(0,15).some(s=>s.includes('\t'))?'\t':',';
    const rows=[];let row=[],cell='',quoted=false;
    for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(!quoted&&(c===separator||c==='\n'||c==='\r')){row.push(cell);cell='';if(c!==separator){if(c==='\r'&&text[i+1]==='\n')i++;if(row.some(x=>x.trim()))rows.push(row);row=[];}}else cell+=c;}
    row.push(cell);if(row.some(x=>x.trim()))rows.push(row);return rows;
  }
  const aliases={
    name:['캠페인이름','캠페인명','캠페인'],id:['캠페인id','캠페인번호'],status:['상태'],
    spend:['총비용','광고비','총광고비','광고비용','비용','집행금액'],purchases:['구매완료수','구매완료','구매수','구매전환수'],
    revenue:['구매완료전환매출액','구매완료전환매출','구매전환매출액','구매전환매출','구매매출액','구매매출'],
    reported:['구매완료광고수익률','구매광고수익률','구매완료roas','구매roas'],impressions:['노출수','노출'],clicks:['클릭수','클릭'],cpc:['평균cpc','cpc'],ctr:['클릭률','ctr'],
    path1:['경로(1단계)','경로1단계','경로1'],path2:['경로(2단계)','경로2단계','경로2'],path3:['경로(3단계)','경로3단계','경로3'],
    date:['날짜','기간','일자','기준일'],visits:['방문수','유입수'],orders:['상품결제건수','결제건수'],sales:['판매금액(총)','판매금액총','판매금액','결제금액'],
  };
  function column(header,key){const list=aliases[key];return header.findIndex(v=>list.includes(clean(v).replace(/\(vat포함\)|\(원\)|\(%\)|\(회\)|\(건\)/g,'')));}
  function adsFromGrid(grid){
    const h=grid.findIndex(r=>column(r,'name')>=0&&column(r,'spend')>=0);if(h<0)return [];
    const header=grid[h],keys=['name','id','status','spend','purchases','revenue','reported','impressions','clicks','cpc','ctr'],cols=Object.fromEntries(keys.map(k=>[k,column(header,k)]));
    return grid.slice(h+1).filter(r=>r[cols.name]&&!/^(전체|합계|총합계|총계)$/.test(String(r[cols.name]).trim())&&number(r[cols.spend])!==null).map(r=>{
      const out=Object.fromEntries(keys.map(k=>[k,['name','id','status'].includes(k)?String(r[cols[k]]??'').trim():number(r[cols[k]])]));
      if(out.revenue===null&&out.reported!==null&&out.spend!==null){out.revenue=out.spend*out.reported/100;out.revenueEstimated=true;}else out.revenueEstimated=false;
      return out;
    });
  }
  function parseAds(text){
    let rows=adsFromGrid(delimited(text));if(rows.length)return rows;
    const flat=text.split(/\r?\n|\t/).map(s=>s.trim()).filter(Boolean),starts=[];
    for(let i=1;i<flat.length;i++)if(/^\d{6,12}$/.test(flat[i])&&/^(운영가능|운영중|중지|일시중지|종료|삭제)/.test(flat[i+1]||''))starts.push(i);
    rows=starts.map((i,j)=>{const end=j+1<starts.length?starts[j+1]-1:flat.length,tail=flat.slice(i+2,end),spend=number(tail[0]),reported=number(tail[2]),explicit=number(tail[11]);return {name:flat[i-1],id:flat[i],status:flat[i+1],spend,purchases:number(tail[1]),reported,cpc:number(tail[3]),impressions:number(tail[5]),clicks:number(tail[7]),ctr:number(tail[8]),revenue:explicit??(spend!==null&&reported!==null?spend*reported/100:null),revenueEstimated:explicit===null&&reported!==null};}).filter(r=>r.name&&r.spend!==null);
    return rows;
  }
  function parseChannels(grid,filename=''){
    const h=grid.findIndex(r=>column(r,'path1')>=0&&column(r,'visits')>=0&&column(r,'sales')>=0);if(h<0)throw Error('전체채널 표의 경로(1단계)·방문수·판매금액 열을 찾지 못했습니다. 네이버 마케팅 분석의 전체채널 엑셀을 선택하세요.');
    const keys=['path1','path2','path3','date','visits','orders','sales'],cols=Object.fromEntries(keys.map(k=>[k,column(grid[h],k)]));
    let detected=dates(filename);if(detected.length<2)detected=dates(grid.slice(0,h).flat().join(' '));
    const rows=[],seen=new Map();let skipped=0;
    for(const cells of grid.slice(h+1)){
      const paths=['path1','path2','path3'].map(k=>String(cells[cols[k]]??'').trim());
      if(!paths[0]||paths.some(p=>/^(합계|총합계|전체|총계|소계)$/.test(p))){skipped++;continue;}
      const visits=number(cells[cols.visits]),orders=number(cells[cols.orders]),sales=number(cells[cols.sales]);if(visits===null&&orders===null&&sales===null)continue;
      const ds=dates(cells[cols.date]);if(cols.date>=0&&String(cells[cols.date]??'').trim()&&!ds.length)throw Error('날짜 열을 읽지 못했습니다. 날짜가 표시된 전체채널 파일을 사용하세요.');
      const since=ds[0]||null,until=ds[1]||since;
      const row={path1:paths[0],path2:paths[1],path3:paths[2],since,until,visits,orders,sales,gfa:/gfa|성과형\s*디스플레이|디스플레이\s*광고/i.test(paths.join(' '))};
      const key=JSON.stringify([since,until,...paths]);if(seen.has(key)){if(JSON.stringify(seen.get(key))!==JSON.stringify(row))throw Error('같은 날짜와 경로에 서로 다른 값이 있습니다. 일별 보기와 기간 합계가 섞이지 않은 파일을 사용하세요.');skipped++;continue;}seen.set(key,row);rows.push(row);
    }
    if(!rows.length)throw Error('저장할 유입 경로 행을 찾지 못했습니다.');
    const rowDates=rows.flatMap(r=>[r.since,r.until]).filter(Boolean).sort();
    return {rows,since:rowDates[0]||detected[0]||'',until:rowDates.at(-1)||detected[1]||detected[0]||'',skipped};
  }
  function metrics(rows){const spend=sum(rows,'spend'),revenue=sum(rows,'revenue'),purchases=sum(rows,'purchases'),clicks=sum(rows,'clicks'),impressions=sum(rows,'impressions');return {spend,revenue,purchases,clicks,impressions,roas:rate(revenue,spend),cpc:rate(spend,clicks,1),ctr:rate(clicks,impressions),cpa:rate(spend,purchases,1),conversionRate:rate(purchases,clicks)};}
  function analyze(entries,since,until){
    range(since,until);
    const included=entries.filter(e=>e.since>=since&&e.until<=until),partial=entries.filter(e=>e.since<=until&&e.until>=since&&!included.includes(e));
    function source(kind){const records=included.filter(e=>e.kind===kind),covered=new Set();for(const e of records)for(let t=at(e.since);t<=at(e.until);t+=day)covered.add(t);return {records,covered:covered.size,complete:covered.size===(at(until)-at(since))/day+1};}
    const ads=source('ads'),channels=source('channels'),adRows=ads.records.flatMap(e=>e.rows),channelRows=channels.records.flatMap(e=>e.rows),gfaRows=channelRows.filter(r=>r.gfa);
    const ad=metrics(adRows),store={visits:sum(gfaRows,'visits'),orders:sum(gfaRows,'orders'),sales:sum(gfaRows,'sales')};
    store.conversionRate=rate(store.orders,store.visits);const ready=ads.complete&&channels.complete&&gfaRows.length>0&&ad.spend!==null&&store.sales!==null;
    const campaigns=Object.values(adRows.reduce((map,row)=>{const key=row.id||row.name;(map[key]??=[]).push(row);return map;},{})).map(rows=>({name:rows[0].name,id:rows[0].id,...metrics(rows),estimated:rows.some(r=>r.revenueEstimated)}));
    return {since,until,ads,channels,ad,store,ready,partial:partial.length,campaigns,channelRows,estimated:adRows.some(r=>r.revenueEstimated),lastRoas:ready?rate(store.sales,ad.spend):null,revenueGap:ready&&ad.revenue!==null&&store.sales!==null?ad.revenue-store.sales:null};
  }
  return {number,sum,rate,dates,range,validDate,delimited,parseAds,parseChannels,metrics,analyze};
});
