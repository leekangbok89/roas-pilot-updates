'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const ga4=require('../integrations/ga4/data');

const {privateKey,publicKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
const raw={type:'service_account',client_email:'roas-demo@demo-project.iam.gserviceaccount.com',private_key:privateKey};

test('GA4 embedded production client mirrors the tested connector and needs no extra install file',()=>{
 const source=fs.readFileSync(path.join(__dirname,'..','integrations','ga4','data.js'),'utf8').replace(/^'use strict';\n/,'').replace('module.exports={checkRange,validateSettings,assertion,parseReport,runReport};','return {checkRange,validateSettings,assertion,parseReport,runReport};');
 const server=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
 assert.ok(server.includes('const ga4Client=(()=>{\n'+source+'})();'),'production embedded client must match tested source');
});

test('GA4 settings accept only numeric property ID and service account RSA key',()=>{
 const result=ga4.validateSettings({propertyId:'560644825',serviceAccount:JSON.stringify(raw)});
 assert.deepEqual(Object.keys(result).sort(),['clientEmail','privateKey','propertyId']);
 assert.equal(result.propertyId,'560644825');
 assert.throws(()=>ga4.validateSettings({propertyId:'G-RZF6S41CF0',serviceAccount:raw}),/속성 ID/);
 assert.throws(()=>ga4.validateSettings({propertyId:'560644825',serviceAccount:{...raw,private_key:'garbage'}}),/RSA/);
});

test('service JWT is RSA-signed and restricted to analytics.readonly',()=>{
 const credentials=ga4.validateSettings({propertyId:'560644825',serviceAccount:raw});
 const token=ga4.assertion(credentials,1761390000000),pieces=token.split('.');
 assert.equal(pieces.length,3);
 assert.ok(crypto.verify('RSA-SHA256',Buffer.from(pieces[0]+'.'+pieces[1]),publicKey,Buffer.from(pieces[2],'base64url')));
 const body=JSON.parse(Buffer.from(pieces[1],'base64url').toString());
 assert.equal(body.scope,'https://www.googleapis.com/auth/analytics.readonly');
 assert.equal(body.iss,raw.client_email);
 assert.equal(body.aud,'https://oauth2.googleapis.com/token');
});

test('GA4 parser never treats untagged visits as a specific Meta ad and aggregates ad+source',()=>{
 const r=ga4.parseReport({rowCount:4,rows:[
  {dimensionValues:[{value:'fb'},{value:'paid_social'},{value:'123456789012'},{value:'42'},{value:'Launch'}],metricValues:[{value:'7'},{value:'5'},{value:'11'}]},
  {dimensionValues:[{value:'fb'},{value:'paid_social'},{value:'123456789012'},{value:'42'},{value:'Launch'}],metricValues:[{value:'3'},{value:'1'},{value:'6'}]},
  {dimensionValues:[{value:'ig'},{value:'paid_social'},{value:'(not set)'},{value:'42'},{value:'Launch'}],metricValues:[{value:'2'},{value:'1'},{value:'3'}]},
  {dimensionValues:[{value:'google'},{value:'organic'},{value:'000000001'},{value:''},{value:''}],metricValues:[{value:'8'},{value:'4'},{value:'10'}]}
 ]},{since:'2026-10-24',until:'2026-10-25'});
 assert.equal(r.totalPaidSessions,12);assert.equal(r.unmatchedSessions,2);assert.equal(r.rows.length,1);
 assert.equal(r.rows[0].adId,'123456789012');assert.equal(r.rows[0].sessions,10);assert.equal(r.rows[0].engagedSessions,6);assert.equal(r.rows[0].pageViews,17);
 assert.equal(r.partial,false);
});

test('GA4 date range rejects non-dates, reversed dates, and 91 day ranges',()=>{
 assert.throws(()=>ga4.checkRange('2026-10-26','2026-10-24'),/날짜/);
 assert.throws(()=>ga4.checkRange('2026-01-01','2026-05-01'),/90일/);
 assert.throws(()=>ga4.checkRange('2026-10-2x','2026-10-25'),/날짜/);
});

test('GA4 API sends only readonly requests and never puts the private key in report payload',async()=>{
 const creds=ga4.validateSettings({propertyId:'560644825',serviceAccount:raw});
 let count=0;
 const fake=async (url,opts)=>{
  count++;
  if(count===1){assert.equal(url,'https://oauth2.googleapis.com/token');assert.equal(opts.method,'POST');return {ok:true,status:200,text:async()=>JSON.stringify({access_token:'ACCESS_TEST'})};}
  assert.match(url,/properties\/560644825:runReport$/);
  assert.equal(opts.headers.Authorization,'Bearer ACCESS_TEST');
  assert.ok(!opts.body.includes(privateKey));
  const body=JSON.parse(opts.body);
  assert.equal(body.dimensions[2].name,'sessionManualAdContent');
  assert.equal(body.metrics[0].name,'sessions');
  return {ok:true,status:200,text:async()=>JSON.stringify({rows:[],rowCount:0})};
 };
 const result=await ga4.runReport(creds,'2026-10-24','2026-10-25',fake);
 assert.equal(count,2);assert.equal(result.propertyId,'560644825');assert.equal(result.rows.length,0);
});
