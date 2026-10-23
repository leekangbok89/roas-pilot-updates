'use strict';
// Naver Commerce credentials never enter browser localStorage or query strings.
(()=>{
 const byId=id=>document.getElementById(id);
 const fields={id:byId('naver-commerce-id'),secret:byId('naver-commerce-secret'),status:byId('naver-commerce-status'),save:byId('naver-commerce-save'),test:byId('naver-commerce-test'),remove:byId('naver-commerce-remove')};
 if(Object.values(fields).some(v=>!v))return;
 const actionHeaders={'Content-Type':'application/json','X-ROAS-Local-Action':'yes'};
 function busy(value){for(const key of ['save','test','remove'])fields[key].disabled=value;}
 function message(str){fields.status.textContent=str;}
 async function request(url,method='GET',body){
   const options={method,cache:'no-store',headers:method==='GET'?{}:actionHeaders};
   if(body!==undefined)options.body=JSON.stringify(body);
   const response=await fetch(url,options);
   let data;try{data=await response.json();}catch{throw Error('프로그램 서버가 정상적인 JSON 응답을 보내지 않았습니다.');}
   if(!response.ok)throw Error(data.error||'HTTP '+response.status);
   return data;
 }
 async function refresh(){
   const data=await request('/api/naver/status');
   fields.status.textContent=data.configured
      ? '연결 정보 저장됨 · 애플리케이션 ID '+data.maskedId+' · Windows DPAPI 암호화 · 저장 시각 '+new Date(data.savedAt).toLocaleString('ko-KR')+'\n연결 테스트 버튼을 눌러 네이버 인증을 확인하세요.'
      : '아직 연결되지 않았습니다. 애플리케이션 ID와 시크릿을 입력하고 암호화 저장을 누르세요.';
   fields.remove.disabled=!data.configured;
 }
 fields.save.addEventListener('click',async()=>{
   const clientId=fields.id.value.trim(),clientSecret=fields.secret.value.trim();
   if(!clientId||!clientSecret){message('애플리케이션 ID와 시크릿을 모두 입력해 주세요.');return;}
   busy(true);message('Windows 사용자 계정으로 암호화 저장 중…');
   try{
     const saved=await request('/api/naver/credentials','POST',{clientId,clientSecret});
     fields.id.value='';fields.secret.value='';
     message('암호화 저장 완료 · 애플리케이션 ID '+saved.maskedId+'\n이제 연결 테스트를 눌러주세요.');
   }catch(e){message('저장 실패: '+e.message);fields.secret.value='';}
   finally{busy(false);}
 });
 fields.test.addEventListener('click',async()=>{
   busy(true);message('네이버 커머스API 인증 토큰 발급 테스트 중… (공인 IP/인증정보 검사)');
   try{
     const result=await request('/api/naver/test','POST',{});
     message('연결 성공 · '+result.message+'\n인증 토큰 유효 시간: '+(result.expiresIn||'확인 안 됨')+'초\n'+result.scope+'\n토큰과 시크릿은 화면에 표시하지 않습니다.');
   }catch(e){message('연결 실패: '+e.message);}
   finally{busy(false);}
 });
 fields.remove.addEventListener('click',async()=>{
   if(!confirm('이 ASUS 노트북에 암호화 저장된 네이버 API 인증정보를 삭제할까요? Meta 설정과 광고 데이터는 유지됩니다.'))return;
   busy(true);try{await request('/api/naver/credentials','DELETE');fields.id.value='';fields.secret.value='';await refresh();}
   catch(e){message('삭제 실패: '+e.message);}finally{busy(false);}
 });
 refresh().catch(e=>message('저장된 연결 정보 확인 실패: '+e.message));
})();
