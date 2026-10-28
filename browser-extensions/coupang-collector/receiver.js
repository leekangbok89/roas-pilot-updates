chrome.runtime.onMessage.addListener((m,sender,respond)=>{
 if(sender.id!==chrome.runtime.id||!/^http:\/\/(127\.0\.0\.1|localhost):3000$/.test(location.origin))return;
 if(m.kind==='ping'){respond({ok:true});return;}
 if(m.kind==='status'){window.postMessage({...m,source:'ROAS_COUPANG_EXTENSION'},location.origin);respond({ok:true});return;}
 if(m.kind!=='workbook')return;
 const listener=e=>{if(e.source===window&&e.origin===location.origin&&e.data?.source==='ROAS_COUPANG_RECEIVER'&&e.data.id===m.id){clearTimeout(timer);window.removeEventListener('message',listener);respond(e.data);}};
 const timer=setTimeout(()=>{window.removeEventListener('message',listener);respond({ok:false,error:'로컬 저장 확인 시간 초과'});},120000);
 window.addEventListener('message',listener);window.postMessage({...m,source:'ROAS_COUPANG_EXTENSION'},location.origin);return true;
});
