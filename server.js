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
const appVersion='2.8.9';
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
function loadDay(account,date){try{const o=JSON.parse(fs.readFileSync(path.join(safeAccountFolder(account),date+'.json'),'utf8'));return Array.isArray(o.rows)&&o.date===date&&o.account===account?o:null;}catch{return null;}}
function saveDay(account,date,rows,currency){const dir=safeAccountFolder(account);fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,date+'.json'),tmp=file+'.tmp-'+process.pid;fs.writeFileSync(tmp,JSON.stringify({account,date,rows,currency,savedAt:new Date().toISOString()}));fs.renameSync(tmp,file);}
function needsRefresh(snapshot,date,today){if(!snapshot)return true;const ageDays=Math.round((dayUTC(today)-dayUTC(date))/86400000);if(ageDays<=1)return Date.now()-Date.parse(snapshot.savedAt)>60*60*1000; if(ageDays<=7)return Date.now()-Date.parse(snapshot.savedAt)>24*60*60*1000;return false;}
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
 if(!isDate(since)||!isDate(until)||since>until||(dayUTC(until)-dayUTC(since))/86400000>365)throw Object.assign(Error('유효한 기간을 선택하세요(최대 366일).'),{status:400});
 const version=process.env.META_API_VERSION||'v24.0';if(!/^v\d+\.\d+$/.test(version))throw Error('META_API_VERSION 설정이 잘못되었습니다.');
 const token=process.env.META_ACCESS_TOKEN, today=todaySeoul();
 const dates=[];for(let ts=dayUTC(since);ts<=dayUTC(until);ts+=86400000)dates.push(dayString(ts));
 const snapshots=new Map(dates.map(d=>[d,loadDay(account,d)]));
 const force=query.get('force')==='1';
 const requested=dates.filter(d=>force||needsRefresh(snapshots.get(d),d,today));
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
    if(u.pathname==='/visual-overview.html') {res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end("<!doctype html><html lang=\"ko\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>ROAS Pilot | 한눈에 보기</title>\n<style>\n:root{--navy:#131e35;--purple:#6559ee;--ink:#1e2940;--line:#e2e7f0;--mute:#7f8da4}*{box-sizing:border-box}\nbody{margin:0;font:14px 'Segoe UI','Noto Sans KR',sans-serif;background:#f5f7fc;color:var(--ink)}\naside{width:220px;background:var(--navy);color:#c6d1e5;height:100vh;position:fixed;padding:27px 16px}\n.logo{font-size:23px;color:white;font-weight:800;margin:0 10px 44px}.logo span{color:#a7a1ff}.logo small{display:block;font-size:10px;letter-spacing:1px;color:#899ab9;font-weight:400}\nnav a{display:block;padding:13px 15px;color:#b2c0dc;text-decoration:none;border-radius:9px;margin:4px 0;font-weight:600}nav a.active,nav a:hover{color:white;background:#2c3761}\nmain{margin-left:220px;padding:24px 28px;max-width:1800px}h1{font-size:24px;margin:0 0 5px}h2{font-size:17px;margin:0}p{color:var(--mute)}\n.toolbar,.panel,.metric{background:#fff;border:1px solid var(--line);border-radius:14px;box-shadow:0 2px 12px #17243b05}\n.toolbar{display:flex;gap:9px;align-items:end;flex-wrap:wrap;padding:14px;margin:16px 0}\nlabel{font-size:11px;font-weight:700;color:#6f7e98;display:flex;flex-direction:column;gap:5px}\ninput,select,button{font:inherit;border-radius:8px;padding:10px;border:1px solid #dce3ee;background:#fff;color:var(--ink)}\nbutton{cursor:pointer;font-weight:700}button.primary{background:var(--purple);color:white;border-color:var(--purple)}\nbutton.active{background:#e9e7ff;color:#4e42d5;border-color:#c8c3ff}\n.small{font-size:11px;color:var(--mute)}.status{margin-left:auto;max-width:300px}\n.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:15px}\n.metric{padding:18px;min-height:113px}.metric strong{display:block;font-size:25px;margin:9px 0 0}.metric small{color:#8794a9}.metric.highlight{background:linear-gradient(120deg,#6c60f2,#4c58cd);color:white}.metric.highlight small{color:#e2e3ff}\n.panel{padding:20px;margin-bottom:16px}.panelhead{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:15px}\n#graph{width:100%;height:310px}.legend{display:flex;gap:12px;font-size:12px;color:#66758d}\n.legend i{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:5px}\n.charttools{display:flex;gap:9px}.charttools select{min-width:150px}\n.summary{display:grid;grid-template-columns:repeat(2,1fr);gap:15px}.summary .panel{margin-bottom:0}\ntable{width:100%;border-collapse:collapse;font-size:12px}th,td{text-align:right;padding:11px;border-bottom:1px solid #e8edf5}th:first-child,td:first-child{text-align:left}th{color:#71819b;background:#f8faff}\n.alert{border:1px solid #eadab4;background:#fff8e9;color:#956c24;border-radius:9px;padding:10px;margin-bottom:15px;display:none}\n@media(max-width:950px){aside{width:160px}main{margin-left:160px}.metrics{grid-template-columns:repeat(2,1fr)}.summary{grid-template-columns:1fr}}\n@media(max-width:620px){aside{position:static;width:100%;height:auto}.logo{margin-bottom:10px}nav{display:flex;overflow:auto}nav a{white-space:nowrap}main{margin:0;padding:12px}.metrics{gap:8px}.metric strong{font-size:20px}}\n</style></head><body><aside><div class=\"logo\">ROAS<span>Pilot</span><small>Meta Performance Intelligence</small></div><nav><a class=\"active\" href=\"/visual-overview.html\">◉ 한눈에 보기</a><a href=\"/#overview\">◫ 성과 개요</a><a href=\"/#ads-section\">▤ 광고별 진단</a><a href=\"/#daily-compare\">◷ 날짜별 비교</a><a href=\"/#funnel\">⌁ 구매 퍼널</a><a href=\"/#data-source\">⛓ 데이터 연결 · 설정</a></nav></aside>\n<main><h1>한눈에 보기</h1><p class=\"small\">네이버 스마트스토어와 카페24의 광고 성과를 같은 기간으로 비교합니다.</p>\n<section class=\"toolbar\"><label>채널<select id=\"channel\"><option value=\"all\">네이버 + 카페24 전체</option><option value=\"naver\">네이버 스마트스토어</option><option value=\"cafe\">카페24 자사몰</option></select></label>\n<button data-days=\"7\" class=\"active\">최근 7일</button><button data-days=\"14\">최근 14일</button><button data-days=\"30\">최근 30일</button><button data-days=\"1\">오늘</button>\n<label>시작일<input type=\"date\" id=\"since\"></label><label>종료일<input type=\"date\" id=\"until\"></label>\n<button id=\"reload\" class=\"primary\">데이터 조회 ↻</button><span class=\"status small\" id=\"updated\">조회 대기</span></section>\n<div id=\"alert\" class=\"alert\"></div>\n<section class=\"metrics\"><div class=\"metric\"><small>총 광고비</small><strong id=\"spend\">—</strong><small id=\"spendSub\">—</small></div><div class=\"metric\"><small>구매 전환매출</small><strong id=\"revenue\">—</strong><small id=\"revenueSub\">—</small></div><div class=\"metric highlight\"><small>구매 ROAS</small><strong id=\"roas\">—</strong><small>Meta 귀속 구매 전환값 기준</small></div><div class=\"metric\"><small>구매 CPA</small><strong id=\"cpa\">—</strong><small id=\"purchaseSub\">—</small></div>\n<div class=\"metric\"><small>구매 건수</small><strong id=\"purchases\">—</strong></div><div class=\"metric\"><small>링크 CTR</small><strong id=\"ctr\">—</strong></div><div class=\"metric\"><small>노출수</small><strong id=\"impressions\">—</strong></div><div class=\"metric\"><small>링크 클릭수</small><strong id=\"clicks\">—</strong></div></section>\n<section class=\"panel\"><div class=\"panelhead\"><div><h2>일별 성과 그래프</h2><span class=\"small\">서로 다른 단위는 각각의 축으로 표시합니다.</span></div><div class=\"charttools\"><select id=\"leftmetric\"><option value=\"spend\">광고비</option><option value=\"revenue\">구매 매출</option><option value=\"purchases\">구매수</option><option value=\"roas\">ROAS</option><option value=\"clicks\">클릭수</option><option value=\"ctr\">CTR</option></select><select id=\"rightmetric\"><option value=\"revenue\">구매 매출</option><option value=\"spend\">광고비</option><option value=\"roas\">ROAS</option><option value=\"purchases\">구매수</option><option value=\"clicks\">클릭수</option><option value=\"ctr\">CTR</option></select></div></div><div id=\"graph\"></div><div id=\"legend\" class=\"legend\"></div></section>\n<div class=\"summary\"><section class=\"panel\"><div class=\"panelhead\"><h2>채널별 성과 비교</h2></div><div id=\"channels\" class=\"small\">데이터 조회 후 표시됩니다.</div></section><section class=\"panel\"><div class=\"panelhead\"><h2>일별 요약</h2></div><div id=\"daily\" class=\"small\">데이터 조회 후 표시됩니다.</div></section></div>\n<p class=\"small\">광고 데이터는 Meta API와 ASUS 노트북의 로컬 캐시에서 읽습니다. 조회 오류 또는 구매 이벤트 미수집은 0으로 처리하지 않고 누락으로 표시합니다.</p></main>\n<script>\n'use strict';\nconst $=id=>document.getElementById(id),n=v=>{let x=Number(v);return Number.isFinite(x)?x:0};\nconst types=['offsite_conversion.fb_pixel_purchase','omni_purchase','purchase'],format=new Intl.NumberFormat('ko-KR',{maximumFractionDigits:0});\nconst iso=d=>{const v=new Date(d.getTime()-d.getTimezoneOffset()*60000);return v.toISOString().slice(0,10)};\nfunction value(a){if(!Array.isArray(a))return null;for(const type of types){const x=a.find(y=>y.action_type===type);if(x)return n(x.value);}return null;}\nconst data={naver:[],cafe:[]},currency={naver:'USD',cafe:'USD'};let rates=1350;\nconst metrics={spend:'광고비',revenue:'구매 매출',purchases:'구매수',roas:'ROAS',clicks:'클릭수',ctr:'CTR'};\nfunction normalize(row,channel){let spend=n(row.spend),purchases=value(row.actions),revenue=value(row.action_values);if(revenue==null){let ratios=row.website_purchase_roas||row.purchase_roas;const r=Array.isArray(ratios)?ratios.find(x=>types.includes(x.action_type)):null;if(r)revenue=spend*n(r.value);}\nconst usd=(row.account_currency||currency[channel])==='USD',factor=usd?rates:1;return {date:row.date_start,spend:spend*factor,revenue:revenue==null?null:revenue*factor,purchases,clicks:n(row.inline_link_clicks),impressions:n(row.impressions),channel};}\nfunction sum(rows){let s={spend:0,revenue:0,purchases:0,clicks:0,impressions:0,hasRevenue:false,hasPurchases:false};for(const r of rows){s.spend+=r.spend;s.clicks+=r.clicks;s.impressions+=r.impressions;if(r.revenue!=null){s.revenue+=r.revenue;s.hasRevenue=true}if(r.purchases!=null){s.purchases+=r.purchases;s.hasPurchases=true}}s.roas=s.hasRevenue&&s.spend>0?s.revenue/s.spend*100:null;s.ctr=s.impressions>0?s.clicks/s.impressions*100:null;s.cpa=s.hasPurchases&&s.purchases>0?s.spend/s.purchases:null;return s;}\nconst won=v=>v==null?'—':format.format(v)+'원',num=v=>v==null?'—':format.format(v),pct=v=>v==null?'—':v.toFixed(1)+'%';\nfunction fmt(metric,v){return ['spend','revenue','cpa'].includes(metric)?won(v):['roas','ctr'].includes(metric)?pct(v):num(v)}\nfunction render(){let choice=$('channel').value,selected=choice==='all'?[...data.naver,...data.cafe]:data[choice],all=sum(selected);\nfor(const key of ['spend','revenue','roas','cpa','purchases','ctr','impressions','clicks'])$(key).textContent=fmt(key,key==='revenue'&&!all.hasRevenue?null:key==='purchases'&&!all.hasPurchases?null:all[key]);\n$('purchaseSub').textContent=all.hasPurchases?'구매 '+num(all.purchases)+'건':'구매 데이터 없음';\n$('spendSub').textContent='환율 1 USD = '+format.format(rates)+' KRW (USD 계정에만 적용)';$('revenueSub').textContent=all.hasRevenue?'Meta 귀속 매출':'구매 매출 미수집';\nlet days=[...new Set(selected.map(r=>r.date))].sort(),series=days.map(date=>({date,...sum(selected.filter(r=>r.date===date))}));draw(series);\nconst channelRows=[['네이버',sum(data.naver)],['카페24',sum(data.cafe)]];\n$('channels').innerHTML='<table><thead><tr><th>채널</th><th>광고비</th><th>매출</th><th>ROAS</th><th>구매</th></tr></thead><tbody>'+channelRows.map(([name,s])=>'<tr><td>'+name+'</td><td>'+won(s.spend)+'</td><td>'+won(s.hasRevenue?s.revenue:null)+'</td><td>'+pct(s.roas)+'</td><td>'+ (s.hasPurchases?num(s.purchases):'—')+'</td></tr>').join('')+'</tbody></table>';\n$('daily').innerHTML='<table><thead><tr><th>날짜</th><th>광고비</th><th>매출</th><th>ROAS</th></tr></thead><tbody>'+series.map(s=>'<tr><td>'+s.date.slice(5)+'</td><td>'+won(s.spend)+'</td><td>'+won(s.hasRevenue?s.revenue:null)+'</td><td>'+pct(s.roas)+'</td></tr>').join('')+'</tbody></table>';\n}\nfunction draw(rows){const a=$('leftmetric').value,b=$('rightmetric').value,colors=['#526bed','#1ac16a'],w=1020,h=300,pad=46;if(!rows.length){$('graph').textContent='조회한 날짜의 데이터가 없습니다.';return}\nlet vals=[a,b].map(k=>rows.map(r=>k==='revenue'&&!r.hasRevenue?null:r[k])),max=vals.map(v=>Math.max(1,...v.filter(x=>x!=null)));\nconst x=i=>pad+(w-2*pad)*(rows.length===1?.5:i/(rows.length-1)),y=(v,j)=>h-pad-(h-pad-20)*v/max[j];\nlet svg='<svg width=\"100%\" height=\"310\" viewBox=\"0 0 '+w+' '+h+'\" role=\"img\" aria-label=\"일별 광고 성과 비교 그래프\">';\nfor(let z=0;z<=4;z++){let yp=20+z*(h-pad-20)/4;svg+='<line x1=\"'+pad+'\" x2=\"'+(w-pad)+'\" y1=\"'+yp+'\" y2=\"'+yp+'\" stroke=\"#e8edf6\"/>'}\nfor(let j=0;j<2;j++){let parts=[];rows.forEach((r,i)=>{const v=vals[j][i];if(v!=null)parts.push((parts.length?'L':'M')+x(i)+','+y(v,j))});if(parts.length)svg+='<path d=\"'+parts.join(' ')+'\" fill=\"none\" stroke=\"'+colors[j]+'\" stroke-width=\"3\" stroke-linecap=\"round\"/>';rows.forEach((r,i)=>{const v=vals[j][i];if(v!=null)svg+='<circle cx=\"'+x(i)+'\" cy=\"'+y(v,j)+'\" r=\"3\" fill=\"'+colors[j]+'\"/>'})}\nrows.forEach((r,i)=>{if(rows.length<=14||i%Math.ceil(rows.length/14)===0)svg+='<text x=\"'+x(i)+'\" y=\"'+(h-8)+'\" text-anchor=\"middle\" fill=\"#8693a8\" font-size=\"12\">'+r.date.slice(5)+'</text>'});svg+='</svg>';$('graph').innerHTML=svg;\n$('legend').innerHTML='<span><i style=\"background:'+colors[0]+'\"></i>'+metrics[a]+' (좌측)</span><span><i style=\"background:'+colors[1]+'\"></i>'+metrics[b]+' (우측)</span>';\n}\nasync function run(){const ids=JSON.parse(localStorage.getItem('roas-account-ids')||'{}');let targets=$('channel').value==='all'?['naver','cafe']:[$('channel').value],warnings=[],available=0;$('reload').disabled=true;$('updated').textContent='데이터 조회 중…';try{\nfor(const key of targets){let id=String(ids[key]||'').replace(/\\D/g,'');if(!id){warnings.push(key+' 광고 계정 ID 없음');data[key]=[];continue}\ntry{const p=new URLSearchParams({account:id,since:$('since').value,until:$('until').value});const resp=await fetch('/api/insights?'+p,{signal:AbortSignal.timeout(120000)});const body=await resp.json();if(!resp.ok)throw Error(body.error||'조회 실패');currency[key]=body.currency||'USD';data[key]=(body.rows||[]).map(row=>normalize(row,key));available++;if(body.cache?.missingDays?.length||body.cache?.warnings?.length)warnings.push(key+' 누락 '+(body.cache.missingDays||[]).length+'일 · '+(body.cache.warnings||[]).join('; '));}catch(e){warnings.push(key+': '+e.message);data[key]=[];}\n}\nif(!available)throw Error(warnings.join(' / ')||'수집된 데이터가 없습니다.');$('alert').style.display=warnings.length?'block':'none';$('alert').textContent=warnings.join(' / ');render();$('updated').textContent='마지막 조회: '+new Date().toLocaleString('ko-KR');\n}catch(e){$('alert').style.display='block';$('alert').textContent=e.message;$('updated').textContent='조회 실패';}finally{$('reload').disabled=false}}\nlet now=new Date();$('until').value=iso(now);now.setDate(now.getDate()-6);$('since').value=iso(now);\ndocument.querySelectorAll('[data-days]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-days]').forEach(t=>t.classList.toggle('active',t===b));let d=new Date();$('until').value=iso(d);d.setDate(d.getDate()-(Number(b.dataset.days)-1));$('since').value=iso(d);run()});\n$('reload').onclick=run;$('channel').onchange=run;for(const k of ['leftmetric','rightmetric'])$(k).onchange=render;run();setInterval(()=>{if(!document.hidden)run()},3600000);\n</script></body></html>");}
    const file=path.resolve(root,'.'+(u.pathname==='/'?'/index.html':u.pathname));
    if(!file.startsWith(root+path.sep)) return json(res,403,{error:'Forbidden'});
    const ext=path.extname(file);
    if(!mime[ext]) return json(res,404,{error:'Not found'});
    fs.readFile(file,(err,data)=>{if(err)return json(res,404,{error:'Not found'});res.writeHead(200,{'Content-Type':mime[ext],'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});res.end(data);});
  } catch(err) {json(res,err.status||500,{error:err.message||'서버 오류'});}
});
if(require.main===module) server.listen(PORT,HOST,()=>{console.log(`ROAS Analyzer: http://localhost:${PORT}`);setTimeout(watchDownloads,4000);setInterval(watchDownloads,20000);});
module.exports={server,isDate};
