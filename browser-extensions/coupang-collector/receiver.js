chrome.runtime.onMessage.addListener((m,sender,respond)=>{
 if(sender.id!==chrome.runtime.id||!/^http:\/\/(127\.0\.0\.1|localhost):3000$/.test(location.origin))return;
 if(m.kind==='ping'){respond({ok:true});return;}
 if(m.kind==='status'){window.postMessage({...m,source:'ROAS_COUPANG_EXTENSION'},location.origin);respond({ok:true});return;}
 if(m.kind!=='workbook')return;
 const listener=e=>{if(e.source===window&&e.origin===location.origin&&e.data?.source==='ROAS_COUPANG_RECEIVER'&&e.data.id===m.id){clearTimeout(timer);window.removeEventListener('message',listener);respond(e.data);}};
 const timer=setTimeout(()=>{window.removeEventListener('message',listener);respond({ok:false,error:'로컬 저장 확인 시간 초과'});},120000);
 window.addEventListener('message',listener);window.postMessage({...m,source:'ROAS_COUPANG_EXTENSION'},location.origin);return true;
});

// Only this local collection page may issue the three UI commands.
window.addEventListener('message',async event=>{
 if(event.source!==window||event.origin!==location.origin||!/^http:\/\/(127\.0\.0\.1|localhost):3000$/.test(location.origin)||location.pathname!=='/coupang-collector.html')return;
 const m=event.data;if(m?.source!=='ROAS_COUPANG_PAGE'||typeof m.id!=='string'||!['start','stop','status'].includes(m.kind))return;
 try{const result=await chrome.runtime.sendMessage({kind:m.kind,since:m.since,until:m.until,automatic:m.automatic});window.postMessage({source:'ROAS_COUPANG_CONTROL',id:m.id,...result},location.origin);}
 catch{window.postMessage({source:'ROAS_COUPANG_CONTROL',id:m.id,ok:false,error:'확장프로그램을 새로고침하고 이 화면을 다시 열어 주세요.'},location.origin);}
});
