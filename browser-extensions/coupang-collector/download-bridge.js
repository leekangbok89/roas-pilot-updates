/* MAIN-world bridge: retain only an armed report Blob; never read credentials,
 * network URLs or downloaded files from the filesystem. */
(()=>{
 'use strict';
 const REQUEST='ROAS_COUPANG_BLOB_REQUEST',RESPONSE='ROAS_COUPANG_BLOB_RESPONSE';
 const LIMIT=8*1024*1024,TTL=5*60000,origin=location.origin;
 const create=URL.createObjectURL,anchorClick=HTMLAnchorElement.prototype.click,NativeBlob=Blob,arrayBuffer=Blob.prototype.arrayBuffer,encode=window.btoa.bind(window),localFetch=window.fetch.bind(window);
 let capture=null,expiryTimer=null;
 const discard=entry=>{entry.controller?.abort();entry.blob=null;};
 const clear=()=>{if(expiryTimer!==null)clearTimeout(expiryTimer);expiryTimer=null;if(capture){for(const entry of capture.entries.values())discard(entry);capture.entries.clear();}capture=null;};
 const active=()=>{if(capture&&Date.now()>=capture.expires)clear();return capture;};
 const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
 const validId=value=>typeof value==='string'&&value.length>0&&value.length<=200;
 const sameBlob=value=>{try{const u=new URL(value);return typeof value==='string'&&u.protocol==='blob:'&&u.origin===origin;}catch{return false;}};
 function reportName(filename,state){
  if(typeof filename!=='string'||filename.length>240||/[\\/]/.test(filename))return false;
  const m=/^(A\d+)_(pa|nca)_(?:total|daily)_campaign_(\d{8})_(\d{8})(?:\s*\(\d+\))?\.xlsx$/i.exec(filename);
  return !!m&&m[2].toLowerCase()===state.type&&m[3]===state.since.replaceAll('-','')&&m[4]===state.until.replaceAll('-','');
 }
 function remember(state,url,entry){
  state.entries.set(url,entry);while(state.entries.size>2){const oldest=state.entries.keys().next().value;discard(state.entries.get(oldest));state.entries.delete(oldest);}
 }
 function retain(url,blob){
  const state=active();if(!state||!sameBlob(url)||!blob||typeof blob.size!=='number'||typeof blob.arrayBuffer!=='function')return;
  const bytes=blob.size;remember(state,url,{blob:bytes>0&&bytes<=LIMIT?blob:null,bytes});
 }
 // Forward the native receiver, arguments, return value and thrown errors.
 // Revocation is untouched; the Blob reference survives the page's revoke call.
 URL.createObjectURL=function(...args){const url=Reflect.apply(create,this,args);try{retain(url,args[0]);}catch{}return url;};
 async function retainExisting(state,url,entry){
  try{
   // This is an in-browser Blob read, never a request to an HTTPS endpoint.
   // Invoke fetch before the native click so immediate revocation cannot race
   // a later downloads.onChanged event. A pre-existing URL may already be gone.
   const response=await localFetch(url,{credentials:'omit',redirect:'error',signal:entry.controller.signal});
   if(!response.ok||!response.body)throw Error('Blob unavailable');
   const declared=Number(response.headers.get('content-length'));
   if(declared>LIMIT){entry.bytes=declared;entry.code='TOO_LARGE';await response.body.cancel();return;}
   const reader=response.body.getReader(),parts=[];let length=0;
   while(true){const part=await reader.read();if(part.done)break;length+=part.value.byteLength;if(length>LIMIT){entry.bytes=length;entry.code='TOO_LARGE';await reader.cancel();return;}parts.push(part.value);}
   if(active()!==state||state.entries.get(url)!==entry)return;
   entry.bytes=length;entry.blob=new NativeBlob(parts);
  }catch{entry.code ||= 'CAPTURE_MISSING';}
 }
 HTMLAnchorElement.prototype.click=function(...args){
  try{
   const state=active();
   if(state&&this instanceof HTMLAnchorElement&&sameBlob(this.href)&&reportName(this.download,state)&&!state.entries.has(this.href)){
    const entry={blob:null,bytes:0,controller:new AbortController()};remember(state,this.href,entry);entry.pending=retainExisting(state,this.href,entry);
   }
  }catch{}
  return Reflect.apply(anchorClick,this,args);
 };
 const reply=(request,result)=>window.postMessage({source:RESPONSE,id:request.id,kind:request.kind,captureId:request.captureId,...result},origin==='null'?'*':origin);
 const fail=(request,code,error)=>reply(request,{ok:false,code,error});
 window.addEventListener('message',async event=>{
  if(event.source!==window||event.origin!==origin)return;
  const request=event.data;if(!request||request.source!==REQUEST||!validId(request.id)||!validId(request.captureId)||!['arm','read','release'].includes(request.kind))return;
  if(request.kind==='arm'){
   if(!['pa','nca'].includes(request.type)||!validDate(request.since)||!validDate(request.until)||request.since>request.until){fail(request,'INVALID_REPORT','보고서 종류와 기간을 확인하지 못했습니다.');return;}
   clear();capture={captureId:request.captureId,type:request.type,since:request.since,until:request.until,expires:Date.now()+TTL,entries:new Map()};expiryTimer=setTimeout(clear,TTL);
   reply(request,{ok:true,protocolVersion:1});return;
  }
  const state=active();if(!state){fail(request,'CAPTURE_MISSING','다운로드 캡처가 없거나 만료되었습니다.');return;}
  if(request.captureId!==state.captureId||['type','since','until'].some(key=>request[key]!==undefined&&request[key]!==state[key])){fail(request,'INVALID_REPORT','현재 수집 요청과 다릅니다.');return;}
  if(request.kind==='release'&&request.url===undefined){clear();reply(request,{ok:true});return;}
  if(!sameBlob(request.url)){fail(request,'INVALID_REPORT','현재 보고서 화면에서 생성한 파일 주소가 아닙니다.');return;}
  if(request.kind==='release'){const entry=state.entries.get(request.url);if(entry)discard(entry);state.entries.delete(request.url);reply(request,{ok:true});return;}
  if(!reportName(request.filename,state)){fail(request,'INVALID_REPORT','파일명에 표시된 광고 종류와 기간이 요청과 다릅니다.');return;}
  const entry=state.entries.get(request.url);if(!entry){fail(request,'CAPTURE_MISSING','이 파일의 원본 바이트를 보관하지 못했습니다. 기존 보고서를 다시 내려받으세요.');return;}
  if(entry.pending)await entry.pending;
  if(active()!==state||state.entries.get(request.url)!==entry){fail(request,'CAPTURE_MISSING','파일 전달 전에 캡처가 해제되거나 만료되었습니다.');return;}
  if(entry.code==='CAPTURE_MISSING'){fail(request,'CAPTURE_MISSING','다운로드 전에 파일 주소가 폐기되었거나 원본을 읽지 못했습니다. 기존 보고서를 다시 내려받으세요.');return;}
  if(entry.bytes>LIMIT){fail(request,'TOO_LARGE','보고서가 8MB를 초과합니다. 기간을 나누세요.');return;}
  if(!entry.blob||entry.bytes<=0){fail(request,'INVALID_REPORT','비어 있는 보고서입니다.');return;}
  try{
   const buffer=await Reflect.apply(arrayBuffer,entry.blob,[]);
   if(active()!==state||state.entries.get(request.url)!==entry){fail(request,'CAPTURE_MISSING','파일 전달 전에 캡처가 해제되거나 만료되었습니다.');return;}
   if(buffer.byteLength!==entry.bytes||buffer.byteLength>LIMIT){fail(request,'TOO_LARGE','파일 크기를 확인하지 못했습니다.');return;}
   const bytes=new Uint8Array(buffer);let binary='';for(let at=0;at<bytes.length;at+=16384)binary+=String.fromCharCode(...bytes.subarray(at,at+16384));
   reply(request,{ok:true,data:encode(binary),bytes:bytes.length});
  }catch{fail(request,'CAPTURE_MISSING','보고서의 원본 바이트를 읽지 못했습니다.');}
 });
})();
