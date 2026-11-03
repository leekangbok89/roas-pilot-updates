const $=id=>document.getElementById(id),day=n=>new Date(Date.now()+9*3600000+n*86400000).toISOString().slice(0,10);
function range(n){$('since').value=day(-n);$('until').value=day(-1);}range(7);
$('year').onclick=()=>range(365);$('week').onclick=()=>range(7);
async function show(){const {collector:s}=await chrome.storage.local.get('collector');$('status').textContent='Chrome 연결 '+(chrome.runtime?.getManifest?.().version||'버전 확인 불가')+' · 보고서 연결 '+(s?.reportVersion||'대기')+'\n'+(s?(s.message||'대기')+'\n저장 확인 '+(s.completed||0)+'/'+(s.queue?.length||0)+'개 기간': '수집 대기');$('permission').hidden=!s?.permissionHost;$('continue').hidden=!(s&&!s.running&&s.queue?.[s.completed||0]?.submitted&&s.queue?.[s.completed||0]?.confirmedAllCampaigns&&!s.permissionHost);}
$('start').onclick=async()=>{const r=await chrome.runtime.sendMessage({kind:'start',since:$('since').value,until:$('until').value,automatic:$('automatic').checked});if(!r.ok){$('status').textContent=r.error;return;}await show();};
$('continue').onclick=async()=>{const r=await chrome.runtime.sendMessage({kind:'continue'});if(!r.ok){$('status').textContent=r.error;return;}await show();};
$('stop').onclick=async()=>{await chrome.runtime.sendMessage({kind:'stop'});await show();};
$('permission').onclick=async()=>{const {collector:s}=await chrome.storage.local.get('collector');if(!s?.permissionHost)return;const ok=await chrome.permissions.request({origins:['https://'+s.permissionHost+'/*']});if(ok){await chrome.runtime.sendMessage({kind:'resume'});await show();}};
show();

chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes.collector)show();});
