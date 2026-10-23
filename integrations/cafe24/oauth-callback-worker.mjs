// Optional HTTPS callback handler. Deploy only to a domain you control.
// This endpoint does not store codes or exchange tokens.
export default {
 async fetch(request) {
  const url=new URL(request.url);
  if(url.pathname==='/cafe24/callback'){
   const code=url.searchParams.get('code')||'',state=url.searchParams.get('state')||'';
   const valid=/^[A-Za-z0-9._-]{5,500}$/.test(code)&&/^[0-9a-f]{48}$/.test(state);
   const page='<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>ROAS Pilot 카페24 인증</title><body style="font:16px system-ui;max-width:680px;margin:3rem auto"><h2>ROAS Pilot 인증 '+(valid?'코드 발급':'오류')+'</h2>'+(valid?'<p>아래 두 값을 ROAS Pilot 카페24 API 설정 화면에 즉시 붙여넣으세요. 인증 코드는 약 1분 후 만료됩니다.</p><label>code<input id="code" readonly style="display:block;width:100%;padding:10px"></label><label>state<input id="state" readonly style="display:block;width:100%;padding:10px"></label><script>document.getElementById("code").value='+JSON.stringify(code)+';document.getElementById("state").value='+JSON.stringify(state)+';history.replaceState(null,"","/cafe24/callback");</script>':'<p>인증 승인 결과를 확인할 수 없습니다. 다시 시도하세요.</p>')+'</body></html>';
   return new Response(page,{status:valid?200:400,headers:{'Content-Type':'text/html;charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"}});
  }
  return new Response('ROAS Pilot Cafe24 OAuth callback',{status:200,headers:{'Cache-Control':'no-store'}});
 }
};
