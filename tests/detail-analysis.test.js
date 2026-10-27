'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const { createGa4Service, buildDetailRequest, assembleDetailReport, buildDetailPageRequests, assembleDetailPageReport, DETAIL_PAGE_METRICS, validateDetailSettings, DETAIL_DEFAULTS, DETAIL_DIMENSIONS } = require('../integrations/ga4/client.cjs');
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
function pageResponses(metadata = {}) {
  const result = (dimensions, metrics, rows) => ({dimensionHeaders:dimensions.map(name=>({name})),metricHeaders:metrics.map(name=>({name})),metadata,
    rows:rows.map(([dims,values])=>({dimensionValues:dims.map(value=>({value})),metricValues:values.map(value=>({value:String(value)}))}))});
  return {
    summary:result([],DETAIL_PAGE_METRICS,[[[],[100,60,2500,400,20]]]),
    daily:result(['date'],DETAIL_PAGE_METRICS,[[['20261024'],[40,35,800,100,5]],[['20261025'],[60,45,1700,300,15]]]),
    events:result(['eventName'],['eventCount'],[[['page_view'],[100]],[['scroll'],[22]],[['add_to_cart'],[5]]])
  };
}
test('native page queries match only the selected Wemamang product across query and pretty URLs',()=>{
  const requests=buildDetailPageRequests({...DETAIL_DEFAULTS,...period,scope:'meta'}), json=JSON.stringify(requests);
  const expression=requests.summary.dimensionFilter.andGroup.expressions[0].filter.stringFilter;
  const matches=new RegExp(expression.value,'i');
  for(const url of ['https://wemamang.com/product/detail.html?product_no=458','https://m.wemamang.com/product/detail.html?cate_no=1&product_no=458&utm_source=fb',
    'https://www.wemamang.com/product/백도씨/458/category/115/','https://wemamang.com/product/baekdoc/458'])assert.ok(matches.test(url),url);
  for(const url of ['https://wemamang.com/','https://wemamang.com/product/detail.html?product_no=4580','https://wemamang.com/product/abc/1458/',
    'https://wemamang.com/product/abc/4580/','https://truver.com/product/detail.html?product_no=458','https://wemamang.com.evil.com/product/detail.html?product_no=458'])assert.equal(matches.test(url),false,url);
  assert.match(json,/sessionSource/);assert.match(json,/sessionMedium/);assert.ok(!json.includes('customEvent:'));
  assert.equal(requests.summary.dimensions,undefined);assert.deepEqual(requests.summary.metrics.map(x=>x.name),DETAIL_PAGE_METRICS);
  assert.throws(()=>buildDetailPageRequests({...DETAIL_DEFAULTS,...period,scope:'unsafe'}));
});
test('native page summaries preserve period-distinct visitors, engaged seconds, daily gaps and event counts',()=>{
  const page=assembleDetailPageReport(pageResponses(),period);
  assert.equal(page.state,'ready');assert.equal(page.summary.totalUsers,60);assert.equal(page.summary.averageEngagementSeconds,25);
  assert.equal(page.daily.length,25);assert.equal(page.daily[0].screenPageViews,0);assert.equal(page.daily[0].averageEngagementSeconds,null);
  assert.equal(page.daily.at(-1).screenPageViews,60);assert.equal(page.events.find(x=>x.name==='scroll').count,22);
  const hidden=assembleDetailPageReport(pageResponses({schemaRestrictionResponse:{activeMetricRestrictions:[{metricName:'userEngagementDuration'}]}}),period);
  assert.equal(hidden.summary.userEngagementDuration,null);assert.equal(hidden.summary.averageEngagementSeconds,null);
  const threshold=assembleDetailPageReport(pageResponses({subjectToThresholding:true}),period);assert.equal(threshold.daily[0].totalUsers,null);
});
function service(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'roas-detail-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const privateKey=crypto.generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({format:'pem',type:'pkcs8'}).toString();
  let definitions=true,withTime=true,metadataCalls=0,detailCalls=0,pageCalls=0,clock=Date.now(),pageData=null,trackingData=null,metadataFailure=false,pageFailure=false;const calls=[];
  const protect=(mode,value)=>mode==='encrypt'?Buffer.from(value).toString('base64'):Buffer.from(value,'base64').toString();
  const fetchImpl=async(url,options)=>{
    calls.push(url);let data;
    if(url.endsWith('/token'))data={access_token:'synthetic-test-token',expires_in:3600};
    else if(url.endsWith('/metadata')){metadataCalls++;if(metadataFailure)return{ok:false,status:403,json:async()=>({})};data={dimensions:(definitions?DETAIL_DIMENSIONS:[]).map(name=>({apiName:'customEvent:'+name})),metrics:withTime?[{apiName:'customEvent:rp_visible_ms'}]:[]};}
    else{const body=JSON.parse(options.body);if(body.dimensions?.some(x=>x.name.startsWith('customEvent:'))){detailCalls++;data=trackingData||report([['rp_detail_view','page','page',10],['rp_content_view','image_001_p01','image',5]],withTime);}
      else if(JSON.stringify(body.dimensionFilter||{}).includes('pageLocation')){pageCalls++;if(pageFailure)return{ok:false,status:403,json:async()=>({})};data=pageData?.[body.dimensions?.[0]?.name==='date'?'daily':body.dimensions?.[0]?.name==='eventName'?'events':'summary']||{metricHeaders:body.metrics.map(x=>({name:x.name})),rows:[]};}
      else data={metricHeaders:body.metrics.map(x=>({name:x.name})),rows:[]};}
    return{ok:true,status:200,json:async()=>data};
  };
  return {dir,calls,api:createGa4Service({baseDir:dir,protect,fetchImpl,now:()=>clock}),connect:async function(){await this.api.save({propertyId:'123456789',credentials:{type:'service_account',client_email:'test@project.iam.gserviceaccount.com',private_key:privateKey}});},
    setDefinitions:v=>{definitions=v;},setTime:v=>{withTime=v;},setPageData:v=>{pageData=v;},setTrackingData:v=>{trackingData=v;},setMetadataFailure:v=>{metadataFailure=v;},setPageFailure:v=>{pageFailure=v;},advance:()=>{clock+=301000;},pageCalls:()=>pageCalls,counts:()=>({metadataCalls,detailCalls})};
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
test('existing GA4 page records remain visible without custom definitions or tracker events',async t=>{
  const f=service(t);await f.connect();f.setPageData(pageResponses());f.setDefinitions(false);
  let result=await f.api.detailReport(period);assert.equal(result.state,'ready');assert.equal(result.trackingState,'setup_required');assert.equal(result.pageAnalytics.summary.screenPageViews,100);assert.equal(f.counts().detailCalls,0);assert.equal(f.pageCalls(),3);
  f.setDefinitions(true);f.setTrackingData(report([]));result=await f.api.detailReport({...period,refresh:true});
  assert.equal(result.state,'ready');assert.equal(result.trackingState,'no_data');assert.equal(result.pageAnalytics.summary.totalUsers,60);assert.equal(result.rows.length,0);
});
test('a failing optional metadata/report does not discard successful page or tracker data',async t=>{
  const f=service(t);await f.connect();f.setPageData(pageResponses());f.setMetadataFailure(true);
  let result=await f.api.detailReport(period);assert.equal(result.state,'ready');assert.equal(result.trackingState,'error');assert.equal(result.pageAnalytics.summary.screenPageViews,100);
  f.setMetadataFailure(false);f.setPageFailure(true);result=await f.api.detailReport({...period,refresh:true});
  assert.equal(result.state,'ready');assert.equal(result.views,10);assert.equal(result.pageAnalytics.state,'error');
});
