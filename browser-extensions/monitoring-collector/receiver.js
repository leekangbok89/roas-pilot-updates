'use strict';
const local=/^http:\/\/(127\.0\.0\.1|localhost):3000$/.test(location.origin)&&location.pathname==='/monitoring-collector.html';
const pending=new Map();
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(!local||sender.id!==chrome.runtime.id||!['bridge','ping'].includes(message?.kind))return;
  if(message.kind==='ping'){reply({ok:true});return;}
  if(typeof message.id!=='string'||!/^[a-f0-9]{64}$/.test(message.nonce||'')||pending.has(message.id)){reply({ok:false,error:'수집 연결 요청을 확인하세요.'});return;}
  const timer=setTimeout(()=>{pending.delete(message.id);reply({ok:false,error:'로컬 수집 저장 확인 시간 초과'});},90000);
  pending.set(message.id,{nonce:message.nonce,timer,reply});
  window.postMessage({source:'ROAS_MONITORING_EXTENSION',id:message.id,nonce:message.nonce,operation:message.operation,payload:message.payload||{}},location.origin);return true;
});
window.addEventListener('message',event=>{
  if(!local||event.source!==window||event.origin!==location.origin)return;const m=event.data;
  if(m?.source==='ROAS_MONITORING_RECEIVER'){
    const p=pending.get(m.id);if(!p||m.nonce!==p.nonce)return;clearTimeout(p.timer);pending.delete(m.id);p.reply({ok:m.ok===true,result:m.result,error:m.error});return;
  }
  if(m?.source==='ROAS_MONITORING_LOCAL_UI'&&m.kind==='wake')chrome.runtime.sendMessage({kind:'wake'}).catch(()=>{});
});
window.postMessage({source:'ROAS_MONITORING_EXTENSION_READY'},location.origin);
chrome.runtime.sendMessage({kind:'wake'}).catch(()=>{});
