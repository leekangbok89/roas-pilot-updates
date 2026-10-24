'use strict';
const crypto = require('node:crypto');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DATA_API = 'https://analyticsdata.googleapis.com/v1beta/properties/';
const SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';
const MAX_ROWS = 10000;
function bad(message,status=400){return Object.assign(Error(message),{status});}
function validDate(x){return typeof x==='string' && /^\d{4}-\d{2}-\d{2}$/.test(x) && !Number.isNaN(Date.parse(x+'T00:00:00Z'));}
function checkRange(since,until){
  if(!validDate(since)||!validDate(until)||since>until)throw bad('GA4 조회 날짜를 확인하세요.');
  if((Date.parse(until+'T00:00:00Z')-Date.parse(since+'T00:00:00Z'))/86400000>89)throw bad('GA4는 한 번에 최대 90일만 조회합니다.');
  return {since,until};
}
function validateSettings(input){
  const propertyId=String(input?.propertyId||'').trim();
  if(!/^\d{6,15}$/.test(propertyId))throw bad('GA4 속성 ID는 숫자만 입력하세요. G- 측정 ID와 다릅니다.');
  let key=input?.serviceAccount;
  try{if(typeof key==='string')key=JSON.parse(key);}catch{throw bad('서비스 계정 JSON 키 형식을 확인하세요.');}
  if(!key||key.type!=='service_account'||typeof key.client_email!=='string'||!/^[-\w.]+@[-\w.]+\.iam\.gserviceaccount\.com$/.test(key.client_email)
    ||typeof key.private_key!=='string'||key.private_key.length>10000)throw bad('Google Cloud 서비스 계정 JSON 키를 확인하세요.');
  try{if(crypto.createPrivateKey(key.private_key).asymmetricKeyType!=='rsa')throw Error('not rsa');}
  catch{throw bad('서비스 계정 RSA 개인키 형식이 올바르지 않습니다.');}
  return {propertyId,clientEmail:key.client_email,privateKey:key.private_key};
}
function b64(v){return Buffer.from(typeof v==='string'?v:JSON.stringify(v)).toString('base64url');}
function assertion(credentials,now=Date.now()){
  const iat=Math.floor(now/1000);
  const head=b64({alg:'RS256',typ:'JWT'});
  const body=b64({iss:credentials.clientEmail,scope:SCOPE,aud:TOKEN_URL,iat,exp:iat+3600});
  const message=head+'.'+body;
  return message+'.'+crypto.sign('RSA-SHA256',Buffer.from(message),credentials.privateKey).toString('base64url');
}
async function readJSON(response){
  const text=await response.text();
  try{return JSON.parse(text);}catch{throw bad('Google API 응답을 해석할 수 없습니다.',502);}
}
async function accessToken(credentials,fetcher=fetch){
  let response;
  try{response=await fetcher(TOKEN_URL,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:assertion(credentials)}),signal:AbortSignal.timeout(18000)});}
  catch{throw bad('Google 인증 서버에 연결하지 못했습니다.',502);}
  const data=await readJSON(response);
  if(!response.ok||typeof data.access_token!=='string')throw bad('Google 서비스 계정 인증에 실패했습니다. JSON 키와 계정 상태를 확인하세요.',502);
  return data.access_token;
}
function cleanNumber(s){const v=Number(s);return Number.isFinite(v)&&v>=0?v:0;}
function parseReport(result,{since,until}){
  const out={since,until,source:'GA4 Data API',note:'GA4 세션은 Meta 클릭·구매와 별도 지표입니다. UTM이 없는 광고는 연결되지 않을 수 있습니다.',rows:[],totalPaidSessions:0,unmatchedSessions:0,partial:false};
  const rows=Array.isArray(result?.rows)?result.rows:[];
  const byAd=new Map();
  for(const row of rows){
    const d=(row.dimensionValues||[]).map(x=>String(x?.value||''));
    const source=d[0]||'',medium=d[1]||'',rawAd=d[2]||'',campaignId=d[3]||'',campaignName=d[4]||'';
    if(medium.toLowerCase()!=='paid_social')continue;
    const m=(row.metricValues||[]).map(x=>cleanNumber(x?.value));
    const sessions=m[0]||0,engagedSessions=m[1]||0,pageViews=m[2]||0;
    out.totalPaidSessions+=sessions;
    const adId=/^\d{6,30}$/.test(rawAd)?rawAd:'';
    if(!adId){out.unmatchedSessions+=sessions;continue;}
    const key=adId+'|'+source.toLowerCase();
    const current=byAd.get(key)||{adId,source:source||'(not set)',medium:'paid_social',campaignId,campaignName,sessions:0,engagedSessions:0,pageViews:0};
    current.sessions+=sessions;current.engagedSessions+=engagedSessions;current.pageViews+=pageViews;
    byAd.set(key,current);
  }
  out.rows=[...byAd.values()].sort((a,b)=>b.sessions-a.sessions||a.adId.localeCompare(b.adId));
  out.reportedRows=Number(result?.rowCount||rows.length);
  out.partial=out.reportedRows>rows.length;
  return out;
}
async function runReport(credentials,since,until,fetcher=fetch){
  checkRange(since,until);
  const token=await accessToken(credentials,fetcher);
  const payload={
    dateRanges:[{startDate:since,endDate:until}],
    dimensions:['sessionSource','sessionMedium','sessionManualAdContent','sessionManualCampaignId','sessionManualCampaignName'].map(name=>({name})),
    metrics:['sessions','engagedSessions','screenPageViews'].map(name=>({name})),
    limit:String(MAX_ROWS)
  };
  let response;
  try{response=await fetcher(DATA_API+credentials.propertyId+':runReport',{method:'POST',headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(25000)});}
  catch{throw bad('GA4 Data API에 연결하지 못했습니다.',502);}
  const result=await readJSON(response);
  if(!response.ok){
    const message=response.status===403?'GA4 조회 권한이 없습니다. 서비스 계정을 속성에 뷰어로 초대하고 Data API를 사용 설정하세요.':
      response.status===404?'GA4 속성 ID를 확인하세요.':'GA4 보고서 요청이 실패했습니다 (HTTP '+response.status+').';
    throw bad(message,502);
  }
  return {...parseReport(result,{since,until}),fetchedAt:new Date().toISOString(),propertyId:credentials.propertyId};
}
module.exports={checkRange,validateSettings,assertion,parseReport,runReport};
