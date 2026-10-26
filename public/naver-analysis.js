/* GFA-only spend bridge. Other Naver ad-spend records remain stored on the server. */
(function () {
  'use strict';
  async function api(method='GET', body) {
    const response=await fetch('/api/naver/ad-spend',{
      method,cache:'no-store',
      headers:{'Content-Type':'application/json','X-ROAS-Local-Action':'yes'},
      ...(body?{body:JSON.stringify(body)}:{})
    });
    const result=await response.json();
    if(!response.ok)throw Error(result.error||'GFA 광고비 저장에 실패했습니다.');
    return result;
  }
  const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(String(value))&&Number.isFinite(Date.parse(value+'T00:00:00Z'));
  window.roasNaverSpend=Object.freeze({
    saveGfa:async (since,until,amount)=>{
      if(!validDate(since)||!validDate(until)||since>until)throw Error('GFA 분석 기간을 확인하세요.');
      if(!Number.isSafeInteger(amount)||amount<0)throw Error('GFA 광고비는 0원 이상의 정수로 입력해야 합니다.');
      // Fetch the current revision immediately before writing so saved Powerlink,
      // shopping, or prior GFA entries are not overwritten by stale browser state.
      const current=await api();
      const updated=await api('POST',{since,until,amounts:{gfa:amount},revision:current.revision});
      document.dispatchEvent(new Event('roas:meta-cache-updated'));
      return updated;
    }
  });
})();
