/* Official advertising exports. Original amounts and attribution windows stay separate. */
(function(root) {
  'use strict';
  const clean = x => String(x ?? '').trim().replace(/\s+/g, '');
  function day(x) {
    let s=String(x??'').trim();
    // Campaign exports store YYYYMMDD as general numeric cells, including
    // 2.026103E7. Expand decimal notation exactly, without floating rounding
    // or guessing that an unstyled number is an Excel date serial.
    const m=s.length<=80?/^(\d+)(?:\.(\d+))?(?:e([+-]?\d{1,2}))?$/i.exec(s):null;
    if(m){let digits=(m[1]+(m[2]||'')).replace(/^0+/,''),scale=Number(m[3]||0)-(m[2]?.length||0);
      if(scale>=0){if(digits.length+scale!==8)return null;digits+='0'.repeat(scale);}
      else {const remove=-scale;if(digits.length-remove!==8||!digits.endsWith('0'.repeat(remove)))return null;digits=digits.slice(0,-remove);}
      s=digits.slice(0,4)+'-'+digits.slice(4,6)+'-'+digits.slice(6,8);
    }else s=s.replace(/[./]/g,'-');
    return /^\d{4}-\d\d-\d\d$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s?s:null;
  }
  function number(x, required=false) {
    if (x===undefined||x===null||x===''||x==='-') { if(required)throw Error('필수 광고 지표가 비어 있습니다.');return null; }
    const s=String(x).replace(/,/g,'').trim(), n=Number(s);
    if(!/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(s)||!Number.isFinite(n)||n<0||n>1e12)throw Error('광고 지표 숫자를 확인하세요.');return n;
  }
  function identifier(x, required=true) {
    if((x===undefined||x===''||x==='-')&&!required)return null;
    const s=String(x??'').trim(); if(/^[1-9]\d{0,19}$/.test(s))return s;
    if(/^[1-9]\d*(?:\.\d+)?e\+?\d+$/i.test(s)){const n=Number(s);if(Number.isSafeInteger(n)&&n>0)return String(n);}
    throw Error('광고 보고서의 ID 정밀도를 확인하세요.');
  }
  function parse(grids, filename) {
    const m=/^(A\d+)_(pa|nca)_(?:total|daily)_campaign_(\d{8})_(\d{8})(?:\s*\(\d+\))?\.xlsx$/i.exec(filename);
    if(!m)throw Error('쿠팡 광고센터 원본 파일명을 유지하세요. PA/NCA 보고서만 지원합니다.');
    const format=s=>s.slice(0,4)+'-'+s.slice(4,6)+'-'+s.slice(6,8), since=day(format(m[3])),until=day(format(m[4]));
    if(!since||!until||since>until)throw Error('광고 보고서 기간을 확인하세요.');
    const type=m[2].toLowerCase(),found=[];
    for(const grid of grids)for(let i=0;i<Math.min(grid.length,30);i++){
      const h=grid[i].map(clean);
      if(h.includes('캠페인ID')&&h.includes(type==='pa'?'광고비':'집행광고비')){found.push({grid,h,start:i});break;}
    }
    if(found.length!==1)throw Error('광고 보고서 표를 하나만 포함해 주세요.');
    const {grid,h,start}=found[0],at=(r,k)=>r[h.indexOf(clean(k))];
    const reportLevel=type==='pa'&&!['광고집행 옵션ID','광고전환매출발생 옵션ID','광고 노출 지면','키워드'].some(k=>h.includes(clean(k)))&&['과금 방식','광고 목표','판매방식','광고유형'].every(k=>h.includes(clean(k)))?'campaign':'product';
    const dateKey=['날짜','일자','보고서 날짜','기준일','Date'].find(k=>h.includes(clean(k)));
    if(since!==until&&!dateKey)throw Error('여러 날짜를 합산한 보고서는 일별로 나눌 수 없습니다. 기간 구분을 일별로 선택하세요.');
    const rows=[];
    for(let i=start+1;i<grid.length;i++){
      const r=grid[i],physicalRow=grid.rowNumbers?.[i]||i+1;
      if(r.every(x=>x===undefined||x===''))continue;
      const date=dateKey?day(at(r,dateKey)):since;
      if(!date)throw Error('엑셀 '+physicalRow+'행 '+dateKey+' 날짜 형식을 읽지 못했습니다: '+String(at(r,dateKey)??'(빈 값)').replace(/\s+/g,' ').slice(0,60)+' · 파일 기간 '+since+' ~ '+until);
      if(date<since||date>until)throw Error('엑셀 '+physicalRow+'행 '+dateKey+' 날짜 '+date+'가 파일 기간 '+since+' ~ '+until+'과 다릅니다.');
      const base={date,campaignId:identifier(at(r,'캠페인 ID')),campaignName:String(at(r,type==='pa'?'캠페인명':'캠페인 이름')??'').trim(),placement:String(at(r,'광고 노출 지면')??'').trim(),impressions:number(at(r,'노출수'),true),clicks:number(at(r,'클릭수'),true)};
      if(!base.campaignName||base.campaignName.length>300)throw Error('캠페인 이름을 확인하세요.');
      if(type==='pa')rows.push({...base,advertisedItemId:identifier(at(r,'광고집행 옵션ID'),false),convertedItemId:identifier(at(r,'광고전환매출발생 옵션ID'),false),keyword:String(at(r,'키워드')??'').slice(0,300),spend:number(at(r,'광고비'),true),orders1:number(at(r,'총 주문수(1일)'),true),quantity1:number(at(r,'총 판매수량(1일)'),true),sales1:number(at(r,'총 전환매출액(1일)'),true),orders14:number(at(r,'총 주문수(14일)'),true),quantity14:number(at(r,'총 판매수량(14일)'),true),sales14:number(at(r,'총 전환매출액(14일)'),true)});
      else rows.push({...base,spend:number(at(r,'집행 광고비'),true),engagements:number(at(r,'참여수'),true),newCustomers:number(at(r,'신규 구매 고객 수')),firstSales:number(at(r,'첫구매를 통한 광고 전환 매출')),repeatCustomers:number(at(r,'신규 구매 고객 중 재구매 고객 수')),repeatSales:number(at(r,'재구매를 통한 매출')),totalSales:number(at(r,'전체 매출'))});
    }
    if(!rows.length||rows.length>50000)throw Error('광고 보고서 행 수를 확인하세요.');
    return {schema:'roas-coupang-ad-report-v1',vendorId:m[1],type,...(type==='pa'?{reportLevel}:{}),since,until,filename,rows};
  }
  const api={parse,day,identifier}; if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.CoupangAdReports=Object.freeze(api);
})(typeof window==='undefined'?this:window);
