'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const crypto = require('node:crypto');
const {spawnSync}=require('node:child_process');
const updateDir=path.join(__dirname,'.roas-updates');
const managedFiles=['server.js','package.json','public/index.html','public/app.js','public/styles.css','public/visual-overview.html'];
const appVersion='2.8.35';
const maxUpdateSize=8*1024*1024;
function diskPath(dir,rel){return path.join(dir,...rel.split('/'));}
function copyManaged(from,to){for(const rel of managedFiles){const f=diskPath(from,rel);if(!fs.existsSync(f))throw Error('업데이트 파일 누락: '+rel);const dest=diskPath(to,rel);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(f,dest);}}
function backupNow(){const dir=path.join(updateDir,'backups',new Date().toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomBytes(2).toString('hex'));fs.mkdirSync(dir,{recursive:true});copyManaged(__dirname,dir);fs.writeFileSync(path.join(dir,'version.txt'),appVersion);return dir;}
function listBackups(){const base=path.join(updateDir,'backups');if(!fs.existsSync(base))return [];return fs.readdirSync(base,{withFileTypes:true}).filter(d=>d.isDirectory()).map(d=>{const dir=path.join(base,d.name);let version='알 수 없음';try{version=fs.readFileSync(path.join(dir,'version.txt'),'utf8').trim()}catch{}return {id:d.name,version,created:d.name}}).sort((a,b)=>b.id.localeCompare(a.id)).slice(0,40);}
function localPost(req){const host=String(req.headers.host||'');const origin=req.headers.origin;return /^(127\.0\.0\.1|localhost):3000$/.test(host)&&(!origin||/^http:\/\/(127\.0\.0\.1|localhost):3000$/.test(origin))&&req.headers['x-roas-local-action']==='yes';}
async function payload(req){const chunks=[];let count=0;for await(const c of req){count+=c.length;if(count>maxUpdateSize)throw Object.assign(Error('파일이 8MB를 초과합니다.'),{status:413});chunks.push(c);}return Buffer.concat(chunks);}
function scheduleRestart(res){json(res,200,{ok:true,message:'적용 완료. 로컬 서버가 자동 재시작합니다.'});setTimeout(()=>server.close(()=>process.exit(42)),250);}


const remoteCfgFile=path.join(updateDir,'remote.json');
function getRemoteCfg(){try{const v=JSON.parse(fs.readFileSync(remoteCfgFile,'utf8'));return {feed:v.feed||'',enabled:!!v.enabled};}catch{return {feed:'https://raw.githubusercontent.com/leekangbok89/roas-pilot-updates/main/manifest.json',enabled:false};}}
function remoteURL(raw){const u=new URL(raw);if(u.protocol!=='https:'||u.username||u.password||u.hash||u.port)throw Error('HTTPS 배포 주소만 지원합니다.');return u;}
async function fetchBytes(raw,maxBytes){let u=remoteURL(raw);for(let i=0;i<4;i++){const r=await fetch(u,{redirect:'manual',signal:AbortSignal.timeout(20000)});if([301,302,303,307,308].includes(r.status)){const next=new URL(r.headers.get('location'),u);if(next.protocol!=='https:')throw Error('안전하지 않은 리다이렉트입니다.');u=remoteURL(next.toString());continue;}if(!r.ok)throw Error('배포 서버 응답 오류: '+r.status);const len=Number(r.headers.get('content-length')||0);if(len>maxBytes)throw Error('다운로드 파일이 너무 큽니다.');const chunks=[];let size=0;for await(const c of r.body){size+=c.length;if(size>maxBytes)throw Error('다운로드 용량 초과');chunks.push(c);}return Buffer.concat(chunks);}throw Error('배포 주소 리다이렉트 초과');}
function newer(a,b){const x=a.split('.').map(Number),y=b.split('.').map(Number);for(let i=0;i<3;i++){if((x[i]||0)!==(y[i]||0))return (x[i]||0)>(y[i]||0);}return false;}
async function remoteManifest(){const cfg=getRemoteCfg();if(!cfg.feed)throw Error('배포 주소가 설정되지 않았습니다.');const obj=JSON.parse((await fetchBytes(cfg.feed,100000)).toString('utf8'));if(!/^\d+\.\d+\.\d+$/.test(obj.version||'')||!/^([a-f0-9]{64})$/i.test(obj.sha256||'')||typeof obj.url!=='string')throw Error('매니페스트 형식 오류');const feedHost=remoteURL(cfg.feed).hostname,zipHost=remoteURL(obj.url).hostname;if(zipHost!==feedHost && !['github.com','objects.githubusercontent.com','release-assets.githubusercontent.com'].includes(zipHost))throw Error('배포 파일 도메인이 허용되지 않습니다.');return {version:obj.version,url:obj.url,sha256:obj.sha256,notes:String(obj.notes||'').slice(0,400),available:newer(obj.version,appVersion)};}
async function applyRemote(){const info=await remoteManifest();if(!info.available)return {updated:false,version:appVersion};const data=await fetchBytes(info.url,maxUpdateSize);if(crypto.createHash('sha256').update(data).digest('hex').toLowerCase()!==info.sha256.toLowerCase())throw Error('SHA-256 무결성 검증 실패');const stage=path.join(updateDir,'remote-'+Date.now());fs.mkdirSync(stage,{recursive:true});const zip=path.join(stage,'download.zip');const expanded=path.join(stage,'expanded');fs.writeFileSync(zip,data);const cmd=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"Expand-Archive -LiteralPath '"+zip.replace(/'/g,"''")+"' -DestinationPath '"+expanded.replace(/'/g,"''")+"' -Force"],{timeout:20000,windowsHide:true});if(cmd.error||cmd.status!==0)throw Error('업데이트 압축 해제 실패');let candidate=expanded;if(!fs.existsSync(path.join(candidate,'server.js'))){const folders=fs.readdirSync(expanded,{withFileTypes:true}).filter(d=>d.isDirectory());if(folders.length===1)candidate=path.join(expanded,folders[0].name);}for(const rel of managedFiles)if(!fs.existsSync(diskPath(candidate,rel)))throw Error('필수 파일 누락: '+rel);const pkg=JSON.parse(fs.readFileSync(path.join(candidate,'package.json'),'utf8'));if(pkg.name!=='meta-roas-analyzer'||pkg.version!==info.version)throw Error('업데이트 패키지 버전 또는 이름 불일치');const backup=backupNow();try{copyManaged(candidate,__dirname);}catch(e){copyManaged(backup,__dirname);throw e;}fs.rmSync(stage,{recursive:true,force:true});return {updated:true,version:info.version};}


// Local Downloads-folder watcher. The server never downloads from an outside release host.
const DOWNLOAD_PREFIX='ROAS-Pilot-ASUS-';
const watcherStateFile=path.join(updateDir,'downloads-watcher.json');
let watcherBusy=false;
let watcherResult='다운로드 폴더 감시 시작 전';
const seenSizes=new Map();
function watcherSettings(){try{return JSON.parse(fs.readFileSync(watcherStateFile,'utf8'));}catch{return {enabled:true,skipVersions:[],handled:[]};}}
function saveWatcherSettings(v){fs.mkdirSync(updateDir,{recursive:true});const temp=watcherStateFile+'.tmp';fs.writeFileSync(temp,JSON.stringify(v,null,2),'utf8');fs.renameSync(temp,watcherStateFile);}
function downloadsFolder(){return process.env.ROAS_DOWNLOADS_DIR||path.join(process.env.USERPROFILE||path.join(process.env.HOMEDRIVE||'C:',process.env.HOMEPATH||'\\Users\\Default'),'Downloads');}
function inspectZip(zip,stage){
 const expanded=path.join(stage,'expanded');
 const cmd=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"Expand-Archive -LiteralPath '"+zip.replace(/'/g,"''")+"' -DestinationPath '"+expanded.replace(/'/g,"''")+"' -Force"],{timeout:30000,windowsHide:true});
 if(cmd.error||cmd.status!==0)throw Error('ZIP 압축 해제 실패');
 let candidate=expanded;
 if(!fs.existsSync(path.join(candidate,'server.js'))){const dirs=fs.readdirSync(expanded,{withFileTypes:true}).filter(d=>d.isDirectory());if(dirs.length===1)candidate=path.join(expanded,dirs[0].name);}
 for(const rel of managedFiles)if(!fs.existsSync(diskPath(candidate,rel)))throw Error('필수 파일 누락: '+rel);
 const pkg=JSON.parse(fs.readFileSync(path.join(candidate,'package.json'),'utf8'));
 if(pkg.name!=='meta-roas-analyzer'||!/^\d+\.\d+\.\d+$/.test(pkg.version))throw Error('ROAS Pilot 버전 정보 오류');
 return {candidate,version:pkg.version};
}
function markHandled(cfg,key){cfg.handled=[...new Set([...(cfg.handled||[]),key])].slice(-250);saveWatcherSettings(cfg);}
function watchDownloads(){
 if(watcherBusy)return;
 const cfg=watcherSettings();if(!cfg.enabled)return;
 const dir=downloadsFolder();if(!fs.existsSync(dir)){watcherResult='다운로드 폴더가 없습니다: '+dir;return;}
 const entries=fs.readdirSync(dir,{withFileTypes:true}).filter(e=>e.isFile()&&e.name.startsWith(DOWNLOAD_PREFIX)&&e.name.toLowerCase().endsWith('.zip'));
 const ordered=entries.map(e=>{const file=path.join(dir,e.name);try{const st=fs.statSync(file);return {file,name:e.name,size:st.size,mtime:st.mtimeMs};}catch{return null;}}).filter(Boolean).sort((a,b)=>a.mtime-b.mtime);
 for(const entry of ordered){
  const key=entry.name+'|'+entry.size+'|'+Math.trunc(entry.mtime);
  if((cfg.handled||[]).includes(key))continue;
  if(entry.size<100||entry.size>maxUpdateSize){markHandled(cfg,key);continue;}
  const signature=entry.size+'|'+entry.mtime;
  if(seenSizes.get(entry.file)!==signature){seenSizes.set(entry.file,signature);continue;}
  watcherBusy=true;
  let stage;
  try{
   stage=path.join(updateDir,'download-stage-'+Date.now());fs.mkdirSync(stage,{recursive:true});
   const copied=path.join(stage,'update.zip');fs.copyFileSync(entry.file,copied);
   const {candidate,version}=inspectZip(copied,stage);
   if(!newer(version,appVersion)||((cfg.skipVersions||[]).includes(version))){watcherResult='자동 설치 건너뜀: '+entry.name+' (v'+version+')';markHandled(cfg,key);continue;}
   const backup=backupNow();try{copyManaged(candidate,__dirname);}catch(e){copyManaged(backup,__dirname);throw e;}
   markHandled(cfg,key);watcherResult='다운로드 폴더에서 v'+version+' 적용 완료 · 서버 재시작 중';
   // Only restart via current PowerShell supervisor after a successful update.
   setTimeout(()=>server.close(()=>process.exit(42)),1500);return;
  }catch(err){watcherResult='업데이트 검증 실패: '+entry.name+' · '+err.message;markHandled(cfg,key);}
  finally{if(stage)fs.rmSync(stage,{recursive:true,force:true});watcherBusy=false;}
 }
}

function authenticated(req) {
  if (!process.env.WEB_PASSWORD) return HOST === '127.0.0.1';
  const h = req.headers.authorization || '';
  if (!h.startsWith('Basic ')) return false;
  let pair; try { pair = Buffer.from(h.slice(6), 'base64').toString('utf8'); } catch { return false; }
  const expected = 'admin:' + process.env.WEB_PASSWORD;
  const a = Buffer.from(pair), b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a,b);
}
const root = path.join(__dirname,'public');
const mime = {'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.csv':'text/csv; charset=utf-8','.svg':'image/svg+xml'};
function json(res, status, data) { res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(data)); }
function isDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s+'T00:00:00Z').valueOf()); }
// Local historical snapshots live outside managedFiles, so upgrades and rollbacks preserve them.
const snapshotsDir=path.join(__dirname,'.roas-data','daily');
function dayUTC(value){return Date.parse(value+'T00:00:00Z');}
function dayString(ts){return new Date(ts).toISOString().slice(0,10);}
function todaySeoul(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
function safeAccountFolder(account){return path.join(snapshotsDir,account);}
function loadDay(account,date){
 // File and folder account IDs can diverge after a historical import.
 // Trust only the validated account stored inside the snapshot; never mix accounts.
 const read=(file)=>{try{const o=JSON.parse(fs.readFileSync(file,'utf8'));return Array.isArray(o.rows)&&o.date===date&&String(o.account)===String(account)?o:null;}catch{return null;}};
 const direct=read(path.join(safeAccountFolder(account),date+'.json'));if(direct)return direct;
 try{
  for(const folder of fs.readdirSync(snapshotsDir,{withFileTypes:true})){
   if(!folder.isDirectory()||!/^\d{5,30}$/.test(folder.name)||folder.name===account)continue;
   const match=read(path.join(snapshotsDir,folder.name,date+'.json'));if(match)return match;
  }
 }catch{}
 return null;
}
function saveDay(account,date,rows,currency){const dir=safeAccountFolder(account);fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,date+'.json'),tmp=file+'.tmp-'+process.pid;fs.writeFileSync(tmp,JSON.stringify({account,date,rows,currency,savedAt:new Date().toISOString()}));fs.renameSync(tmp,file);}
function needsRefresh(snapshot,date,today){if(!snapshot)return true;const ageDays=Math.round((dayUTC(today)-dayUTC(date))/86400000);if(ageDays<0||ageDays>6)return false;const lastSaved=Date.parse(snapshot.savedAt||'');if(!Number.isFinite(lastSaved))return true;const savedSeoul=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(lastSaved));return savedSeoul!==today;}
async function fetchMetaRange(account,since,until,token,version){
 const fields='date_start,date_stop,account_currency,campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,reach,frequency,inline_link_clicks,ctr,cpm,cpc,actions,action_values,purchase_roas,website_purchase_roas,quality_ranking,conversion_rate_ranking';
 const url=new URL(`https://graph.facebook.com/${version}/act_${account}/insights`);
 for(const [k,v] of Object.entries({fields,level:'ad',time_increment:'1',time_range:JSON.stringify({since,until}),action_report_time:'impression',limit:'500'}))url.searchParams.set(k,v);
 // Never put access tokens in URLs: the Authorization header stays on this server.
 let next=url.toString(),pages=0;const rows=[];
 while(next&&pages<30){const dest=new URL(next);if(dest.protocol!=='https:'||dest.hostname!=='graph.facebook.com')throw Error('Meta API 페이지 URL 오류');
  const resp=await fetch(next,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(30000)});const body=await resp.json();
  if(!resp.ok){const err=new Error(body.error?.message||`Meta API 오류 ${resp.status}`);err.status=resp.status===429?429:502;throw err;}
  rows.push(...(body.data||[]));if(rows.length>14000)throw Error('광고 데이터가 너무 많습니다. 더 작은 기간으로 조회하세요.');next=body.paging?.next||null;pages++;
 }if(next)throw Error('API 페이지 한도 초과');return rows;
}
async function insights(query){
 const account=String(query.get('account')||process.env.META_AD_ACCOUNT_ID||'').replace(/^act_/,'');
 if(!/^\d{5,30}$/.test(account))throw Object.assign(Error('광고 계정 ID를 숫자로 입력하세요.'),{status:400});
 const since=query.get('since'),until=query.get('until');
 if(!isDate(since)||!isDate(until)||since>until||(dayUTC(until)-dayUTC(since))/86400000>731)throw Object.assign(Error('유효한 기간을 선택하세요(최대 732일).'),{status:400});
 const version=process.env.META_API_VERSION||'v24.0';if(!/^v\d+\.\d+$/.test(version))throw Error('META_API_VERSION 설정이 잘못되었습니다.');
 const token=process.env.META_ACCESS_TOKEN, today=todaySeoul();
 const dates=[];for(let ts=dayUTC(since);ts<=dayUTC(until);ts+=86400000)dates.push(dayString(ts));
 const snapshots=new Map(dates.map(d=>[d,loadDay(account,d)]));
 const force=query.get('force')==='1';
 const cacheOnly=query.get('cacheOnly')==='1';
 // One Meta attempt per account per Seoul calendar day, regardless of success.
 // Ordinary date changes are cache-only; only a recent-seven-day overlap can trigger the daily sync.
 const recentStart=dayString(dayUTC(today)-6*86400000);
 const dailyFile=path.join(safeAccountFolder(account),'daily-sync.json');
 let lastAttempt='';try{lastAttempt=JSON.parse(fs.readFileSync(dailyFile,'utf8')).date||'';}catch{}
 const shouldSync=!force&&!cacheOnly&&lastAttempt!==today&&dates.some(d=>d>=recentStart&&d<=today);
 let requested=cacheOnly?[]:force?dates:shouldSync?Array.from({length:7},(_,i)=>dayString(dayUTC(recentStart)+i*86400000)):[];
 if(shouldSync)for(const d of requested)if(!snapshots.has(d))snapshots.set(d,loadDay(account,d));
 if(shouldSync&&token){fs.mkdirSync(safeAccountFolder(account),{recursive:true});fs.writeFileSync(dailyFile,JSON.stringify({date:today,attemptedAt:new Date().toISOString()}));}
 const issues=[];let updated=0;
 // Do not make hundreds of API calls: group uncached/stale consecutive days in windows of <=7 days.
 for(let i=0;i<requested.length;){let j=i;while(j+1<requested.length&&j-i<6&&dayUTC(requested[j+1])-dayUTC(requested[j])===86400000)j++;
  const start=requested[i],end=requested[j];
  if(!token){issues.push('Meta 토큰 미설정: 저장된 데이터만 사용');break;}
  try{const rows=await fetchMetaRange(account,start,end,token,version);const byDay=new Map();for(const row of rows){const d=row.date_start;if(d>=start&&d<=end){if(!byDay.has(d))byDay.set(d,[]);byDay.get(d).push(row);}}
   const currency=rows[0]?.account_currency||snapshots.get(start)?.currency||'';
   for(let k=i;k<=j;k++){const date=requested[k];saveDay(account,date,byDay.get(date)||[],currency);snapshots.set(date,loadDay(account,date));updated++;}
  }catch(err){issues.push(`${start}~${end} 조회 실패: ${err.message}`);}
  i=j+1;
 }
 const missing=dates.filter(d=>!snapshots.get(d));const stale=dates.filter(d=>{const snap=snapshots.get(d);return snap&&needsRefresh(snap,d,today);});
 const rows=dates.flatMap(d=>snapshots.get(d)?.rows||[]);
 const currencies=[...new Set(dates.map(d=>snapshots.get(d)?.currency).filter(Boolean))];
 return {rows,account,currency:currencies[0]||'',since,until,cache:{storedDays:dates.length-missing.length,totalDays:dates.length,updatedDays:updated,missingDays:missing,staleDays:stale,warnings:issues,latestSavedAt:dates.map(d=>snapshots.get(d)?.savedAt||'').sort().at(-1)||null}};
}

const server=http.createServer(async (req,res)=> {
  try {
    if (!authenticated(req)) {res.writeHead(401, {'WWW-Authenticate':'Basic realm=ROAS-Pilot', 'Content-Type':'text/plain; charset=utf-8'});res.end('로그인이 필요합니다.');return;}
    const u = new URL(req.url,'http://localhost');
    if (u.pathname === '/api/update/status') return json(res,200,{version:appVersion,backups:listBackups(),mode:'Windows 다운로드 폴더 자동 감시',remote:getRemoteCfg(),watcher:{...watcherSettings(),folder:downloadsFolder(),message:watcherResult}});
    if(u.pathname==='/api/update/settings'&&req.method==='POST'){if(!localPost(req))return json(res,403,{error:'로컬에서만 설정 가능합니다.'});const inp=JSON.parse((await payload(req)).toString('utf8'));if(inp.feed)remoteURL(inp.feed);const cfg={feed:String(inp.feed||'').trim(),enabled:!!inp.enabled};fs.mkdirSync(updateDir,{recursive:true});fs.writeFileSync(remoteCfgFile,JSON.stringify(cfg,null,2),'utf8');return json(res,200,{ok:true,cfg});}
    if(u.pathname==='/api/update/check'){try{const info=await remoteManifest();return json(res,200,info);}catch(e){return json(res,400,{error:e.message});}}
    if(u.pathname==='/api/update/remote'&&req.method==='POST'){if(!localPost(req))return json(res,403,{error:'로컬에서만 업데이트 가능합니다.'});const cfg=getRemoteCfg();if(!cfg.enabled)return json(res,403,{error:'자동 업데이트를 먼저 활성화하세요.'});const result=await applyRemote();if(result.updated)return scheduleRestart(res);return json(res,200,{ok:true,message:'이미 최신 버전입니다.'});}

    if (u.pathname === '/api/update/apply' && req.method === 'POST') {
      if(!localPost(req))return json(res,403,{error:'로컬 웹사이트에서만 업데이트할 수 있습니다.'});
      const data=await payload(req);
      if(data.length<100||data[0]!==0x50||data[1]!==0x4b)return json(res,400,{error:'ZIP 파일을 업로드하세요.'});
      const stage=path.join(updateDir,'stage-'+Date.now());fs.mkdirSync(stage,{recursive:true});
      const zip=path.join(stage,'update.zip');const expanded=path.join(stage,'expanded');fs.writeFileSync(zip,data);
      const cmd=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"Expand-Archive -LiteralPath '"+zip.replace(/'/g,"''")+"' -DestinationPath '"+expanded.replace(/'/g,"''")+"' -Force"],{timeout:20000,windowsHide:true});
      if(cmd.error||cmd.status!==0)return json(res,400,{error:'ZIP 압축 해제 실패. Windows PowerShell과 ZIP 내용을 확인하세요.'});
      let candidate=expanded;
      if(!fs.existsSync(path.join(candidate,'server.js'))){const folders=fs.readdirSync(expanded,{withFileTypes:true}).filter(d=>d.isDirectory());if(folders.length===1)candidate=path.join(expanded,folders[0].name);}
      try{for(const rel of managedFiles)if(!fs.existsSync(diskPath(candidate,rel)))throw Error('설치 파일이 없습니다: '+rel);
        const pkg=JSON.parse(fs.readFileSync(path.join(candidate,'package.json'),'utf8'));if(pkg.name!=='meta-roas-analyzer')throw Error('ROAS Pilot 전용 업데이트가 아닙니다.');
        const backup=backupNow();try{copyManaged(candidate,__dirname);}catch(e){copyManaged(backup,__dirname);throw e;}
        fs.rmSync(stage,{recursive:true,force:true});return scheduleRestart(res);
      }catch(e){return json(res,400,{error:e.message});}
    }
    if(u.pathname === '/api/update/rollback' && req.method === 'POST'){
      if(!localPost(req))return json(res,403,{error:'로컬 웹사이트에서만 복원할 수 있습니다.'});
      const input=JSON.parse((await payload(req)).toString('utf8'));const selected=String(input.backup||'');
      if(!listBackups().some(b=>b.id===selected))return json(res,400,{error:'선택한 백업이 없습니다.'});
      const latest=backupNow();const cfg=getRemoteCfg();cfg.enabled=false;fs.writeFileSync(remoteCfgFile,JSON.stringify(cfg,null,2));const ws=watcherSettings();ws.skipVersions=[...new Set([...(ws.skipVersions||[]),appVersion])];saveWatcherSettings(ws);try{copyManaged(path.join(updateDir,'backups',selected),__dirname);}catch(e){copyManaged(latest,__dirname);throw e;}
      return scheduleRestart(res);
    }
    if (u.pathname === '/api/fx') {
      if (req.method !== 'GET') return json(res,405,{error:'Method not allowed'});
      try {
        const fxResp=await fetch('https://api.frankfurter.dev/v2/rate/USD/KRW',{signal:AbortSignal.timeout(8000)});
        if(!fxResp.ok) throw new Error('환율 제공처 응답 오류');
        const fx=await fxResp.json();
        if(!Number.isFinite(Number(fx.rate))||Number(fx.rate)<=0) throw new Error('환율 데이터 형식 오류');
        return json(res,200,{rate:Number(fx.rate),date:fx.date,source:'Frankfurter'});
      } catch(err) {return json(res,502,{error:'최신 환율을 가져오지 못했습니다: '+err.message});}
    }
    if (u.pathname === '/api/status') return json(res,200,{configured:!!process.env.META_ACCESS_TOKEN, account:process.env.META_AD_ACCOUNT_ID||'',version:process.env.META_API_VERSION||'v24.0'});
    if (u.pathname === '/api/insights') {
      if(req.method !== 'GET') return json(res,405,{error:'Method not allowed'});
      const result=await insights(u.searchParams); return json(res,200,result);
    }
    if(req.method!=='GET') return json(res,405,{error:'Method not allowed'});
        const file=path.resolve(root,'.'+(u.pathname==='/'?'/index.html':u.pathname));
    if(!file.startsWith(root+path.sep)) return json(res,403,{error:'Forbidden'});
    const ext=path.extname(file);
    if(!mime[ext]) return json(res,404,{error:'Not found'});
    fs.readFile(file,(err,data)=>{if(err)return json(res,404,{error:'Not found'});res.writeHead(200,{'Content-Type':mime[ext],'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});res.end(data);});
  } catch(err) {json(res,err.status||500,{error:err.message||'서버 오류'});}
});
if(require.main===module) server.listen(PORT,HOST,()=>{console.log(`ROAS Analyzer: http://localhost:${PORT}`);setTimeout(watchDownloads,4000);setInterval(watchDownloads,20000);});
module.exports={server,isDate};
