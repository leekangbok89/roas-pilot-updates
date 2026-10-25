'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const { createGa4Service, buildDetailRequest, assembleDetailReport, validateDetailSettings, DETAIL_DEFAULTS, DETAIL_DIMENSIONS } = require('../integrations/ga4/client.cjs');
const period = { since: '2026-10-01', until: '2026-10-25', scope: 'all' };
function report(entries, withTime = true, metadata = {}) {
  return { dimensionHeaders: ['eventName','customEvent:rp_content_id','customEvent:rp_content_type'].map(name=>({name})),
    metricHeaders: ['eventCount',...(withTime?['customEvent:rp_visible_ms']:[])].map(name=>({name})), metadata,
    rows: entries.map(([event,id,type,count,ms=0])=>({dimensionValues:[event,id,type].map(value=>({value})),metricValues:[count,...(withTime?[ms]:[])].map(value=>({value:String(value)}))})) };
}
test('detail queries isolate product, version and Meta sessions without inventing conversion attribution',()=>{
  const body=buildDetailRequest({...DETAIL_DEFAULTS,...period,scope:'meta'});
  const json=JSON.stringify(body);
  assert.match(json,/rp_product_id/);assert.match(json,/458/);assert.match(json,/rp_content_version/);assert.match(json,/sessionSource/);assert.match(json,/sessionMedium/);
  assert.equal(body.limit,'5000');assert.equal(body.dimensions.length,3);assert.ok(!json.includes('purchaseRevenue'));
  assert.throws(()=>buildDetailRequest({...DETAIL_DEFAULTS,...period,scope:'unsafe'}));
  assert.throws(()=>buildDetailRequest({...DETAIL_DEFAULTS,...period,until:'2027-10-25'}));
  assert.throws(()=>validateDetailSettings({...DETAIL_DEFAULTS,clarityProjectId:'../../token'}));
  assert.throws(()=>validateDetailSettings({...DETAIL_DEFAULTS,measurementId:'</script>'}));
});
test('report uses page views for reach, qualified views for dwell, and visible starts for video completion',()=>{
  const data=report([['rp_detail_view','page','page',100],['rp_buy_click','page','page',4],['rp_scroll','scroll_50','scroll',40],
    ['rp_content_view','image_001_p01','image',50],['rp_content_time','image_001_p01','image',3,250000],
    ['rp_content_view','video_001','video',20],['rp_video_start','video_001','video',10],['rp_video_100','video_001','video',3]]);
  const result=assembleDetailReport(data,period,true);
  assert.equal(result.views,100);assert.equal(result.buyClicks,4);assert.equal(result.scroll.scroll_50,40);
  assert.equal(result.rows[0].reachRate,.5);assert.equal(result.rows[0].averageVisibleSeconds,5);
  assert.equal(result.rows[1].completionRate,.3);assert.equal(result.rows[1].reachRate,.2);
  assert.match(result.warnings.join(' '),/결제 완료/);
});
test('missing time definition and restricted metrics remain unknown instead of false zeros',()=>{
  const result=assembleDetailReport(report([['rp_content_view','image_001_p01','image',2]],false),period,false);
  assert.equal(result.rows[0].visibleMs,null);assert.equal(result.rows[0].averageVisibleSeconds,null);
  const restricted=assembleDetailReport(report([['rp_detail_view','page','page',10],['rp_content_view','video_001','video',2]],true,
    {schemaRestrictionResponse:{activeMetricRestrictions:[{metricName:'eventCount'},{metricName:'customEvent:rp_visible_ms'}]}}),period,true);
  assert.equal(restricted.views,null);assert.equal(restricted.buyClicks,null);assert.equal(restricted.rows[0].views,null);assert.equal(restricted.rows[0].completionRate,null);
  const thresholded=assembleDetailReport(report([],true,{subjectToThresholding:true}),period,true);assert.equal(thresholded.views,null);
});
function service(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'roas-detail-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const privateKey=crypto.generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({format:'pem',type:'pkcs8'}).toString();
  let definitions=true,withTime=true,metadataCalls=0,detailCalls=0,clock=Date.now();const calls=[];
  const protect=(mode,value)=>mode==='encrypt'?Buffer.from(value).toString('base64'):Buffer.from(value,'base64').toString();
  const fetchImpl=async(url,options)=>{
    calls.push(url);let data;
    if(url.endsWith('/token'))data={access_token:'synthetic-test-token',expires_in:3600};
    else if(url.endsWith('/metadata')){metadataCalls++;data={dimensions:(definitions?DETAIL_DIMENSIONS:[]).map(name=>({apiName:'customEvent:'+name})),metrics:withTime?[{apiName:'customEvent:rp_visible_ms'}]:[]};}
    else{const body=JSON.parse(options.body);if(body.dimensions?.[0]?.name==='eventName'){detailCalls++;data=report([['rp_detail_view','page','page',10],['rp_content_view','image_001_p01','image',5]],withTime);}
      else data={metricHeaders:body.metrics.map(x=>({name:x.name})),rows:[]};}
    return{ok:true,status:200,json:async()=>data};
  };
  return {dir,calls,api:createGa4Service({baseDir:dir,protect,fetchImpl,now:()=>clock}),connect:async function(){await this.api.save({propertyId:'123456789',credentials:{type:'service_account',client_email:'test@project.iam.gserviceaccount.com',private_key:privateKey}});},
    setDefinitions:v=>{definitions=v;},setTime:v=>{withTime=v;},advance:()=>{clock+=301000;},counts:()=>({metadataCalls,detailCalls})};
}
test('saved settings survive restart; missing definitions and unconfigured properties never return fabricated success',async t=>{
  const f=service(t);assert.deepEqual(f.api.detailSettings(),DETAIL_DEFAULTS);
  f.api.detailSettings({...DETAIL_DEFAULTS,clarityProjectId:'abc123456'});
  assert.equal(createGa4Service({baseDir:f.dir}).detailSettings().clarityProjectId,'abc123456');
  await assert.rejects(f.api.detailReport(period),{code:'GA4_NOT_CONFIGURED'});assert.equal(f.calls.length,0);
  await f.connect();f.setDefinitions(false);
  const r=await f.api.detailReport(period);assert.equal(r.state,'setup_required');assert.equal(r.missing.length,4);assert.equal(f.counts().detailCalls,0);
  f.setDefinitions(true);const ready=await f.api.detailReport(period);assert.equal(ready.state,'ready');assert.equal(ready.views,10);
});
test('detail cache coalesces requests, refresh bypasses, expiry and version isolate entries',async t=>{
  const f=service(t);await f.connect();
  await Promise.all([f.api.detailReport(period),f.api.detailReport(period)]);assert.deepEqual(f.counts(),{metadataCalls:1,detailCalls:1});
  assert.equal((await f.api.detailReport(period)).cached,true);
  await f.api.detailReport({...period,refresh:true});assert.equal(f.counts().detailCalls,2);
  f.advance();await f.api.detailReport(period);assert.equal(f.counts().detailCalls,3);
  f.api.detailSettings({...DETAIL_DEFAULTS,contentVersion:'v2'});await f.api.detailReport(period);assert.equal(f.counts().detailCalls,4);
});
test('reach reports remain usable before the dwell metric is registered',async t=>{
  const f=service(t);await f.connect();f.setTime(false);
  const result=await f.api.detailReport(period);assert.equal(result.rows[0].views,5);assert.equal(result.rows[0].visibleMs,null);
});
