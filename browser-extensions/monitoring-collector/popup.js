'use strict';
const status=document.getElementById('status');
async function show(){const r=await chrome.runtime.sendMessage({kind:'status'});status.textContent=r?.ok?(r.status.message||'수집 연결 대기')+'\n저장 확인 '+(r.status.completed||0)+'/'+(r.status.total||0):r?.error||'연결 대기';}
for(const id of ['open','resume','pause'])document.getElementById(id).onclick=async()=>{const r=await chrome.runtime.sendMessage({kind:id});if(!r?.ok)status.textContent=r?.error||'연결을 확인하세요.';else show();};
show();
