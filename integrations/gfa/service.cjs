'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
function createStore({baseDir,model}){
  const file=path.join(baseDir,'.roas-data','gfa-analysis.json');
  function read(){try{const v=JSON.parse(fs.readFileSync(file,'utf8'));if(v.schema!==1||!Number.isInteger(v.revision)||!Array.isArray(v.entries))throw Error();return v;}catch(e){if(e.code==='ENOENT')return {schema:1,revision:0,entries:[]};fail('저장된 GFA 분석 자료를 읽지 못했습니다. 기존 파일을 확인하세요.',500);}}
  function validate(input){
    if(!input||!['ads','channels'].includes(input.kind))fail('GFA 자료 종류를 확인하세요.');
    model.range(input.since,input.until);if(!Array.isArray(input.rows)||!input.rows.length||input.rows.length>15000)fail('파일의 데이터 행은 1~15,000개여야 합니다.');
    const text=(v,max=500)=>{if(typeof v!=='string'||v.length>max)fail('파일의 텍스트 길이와 형식을 확인하세요.');return v;};
    const amount=(v,integer=false)=>{if(v===null||v===undefined)return null;if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>1e14||(integer&&!Number.isSafeInteger(v)))fail('파일의 숫자 값을 확인하세요.');return v;};
    const rows=input.rows.map(r=>{
      if(!r||typeof r!=='object')fail('파일 행의 형식을 확인하세요.');
      if(input.kind==='ads'){const row={name:text(r.name),id:text(r.id||''),status:text(r.status||''),revenueEstimated:r.revenueEstimated===true};if(!row.name)fail('캠페인 이름이 없습니다.');for(const k of ['spend','purchases','revenue','reported','impressions','clicks','cpc','ctr'])row[k]=amount(r[k],['spend','purchases','impressions','clicks'].includes(k));if(row.spend===null)fail('광고비가 없는 캠페인은 저장할 수 없습니다.');return row;}
      const row={path1:text(r.path1),path2:text(r.path2||''),path3:text(r.path3||''),gfa:r.gfa===true,since:r.since||input.since,until:r.until||input.until};
      if(!row.path1)fail('유입 경로가 없습니다.');model.range(row.since,row.until);if(row.since<input.since||row.until>input.until)fail('파일의 날짜가 선택한 저장 기간 밖에 있습니다.');
      for(const k of ['visits','orders','sales'])row[k]=amount(r[k],true);return row;
    });
    const keys=new Set();for(const r of rows){const key=input.kind==='ads'?(r.id||r.name):JSON.stringify([r.since,r.until,r.path1,r.path2,r.path3]);if(keys.has(key))fail('중복된 캠페인 또는 유입 경로가 있습니다. 합계 행과 중복 행을 확인하세요.');keys.add(key);}
    if(input.kind==='channels'){
      const byPath=new Map();for(const r of rows){const key=JSON.stringify([r.path1,r.path2,r.path3]),prior=byPath.get(key)||[];if(prior.some(p=>p.since<=r.until&&p.until>=r.since))fail('기간 합계와 일별 데이터가 겹칩니다. 한 가지 보기로 내려받은 파일을 사용하세요.');prior.push(r);byPath.set(key,prior);}
    }
    const raw=text(input.raw||'',1500000),filename=text(input.filename||'',300);return {id:input.kind+':'+input.since+':'+input.until,kind:input.kind,since:input.since,until:input.until,rows,raw,filename,updatedAt:new Date().toISOString()};
  }
  function write(store,beforeCommit){
    fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=file+'.tmp-'+crypto.randomUUID();let rollback;
    try{fs.writeFileSync(tmp,JSON.stringify(store),'utf8');if(beforeCommit)rollback=beforeCommit();fs.renameSync(tmp,file);}
    catch(error){if(typeof rollback==='function')rollback();throw error;}
    finally{fs.rmSync(tmp,{force:true});}return store;
  }
  function save(input,beforeWrite){const entry=validate(input),store=read();if(input.revision!==store.revision)fail('다른 화면에서 자료가 변경됐습니다. 새로고침 후 다시 저장하세요.',409);if(store.entries.some(e=>e.kind===entry.kind&&e.id!==entry.id&&e.since<=entry.until&&e.until>=entry.since))fail('겹치는 저장 기간이 있습니다. 같은 기간으로 다시 저장하거나 기존 자료를 삭제한 뒤 넣으세요.',409);return write({...store,revision:store.revision+1,entries:[...store.entries.filter(e=>e.id!==entry.id),entry].sort((a,b)=>b.since.localeCompare(a.since))},beforeWrite?()=>beforeWrite(entry):undefined);}
  function remove(input,beforeWrite){const store=read();if(input.revision!==store.revision)fail('다른 화면에서 자료가 변경됐습니다. 새로고침하세요.',409);const entry=store.entries.find(e=>e.id===input.id);if(!entry)fail('삭제할 자료가 없습니다.',404);return write({...store,revision:store.revision+1,entries:store.entries.filter(e=>e.id!==input.id)},beforeWrite?()=>beforeWrite(entry):undefined);}
  return {read,save,remove,validate};
}
module.exports={createStore};
