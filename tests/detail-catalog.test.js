'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {parseDetailMedia,detailMediaUrl,createGa4Service,DETAIL_DEFAULTS}=require('../integrations/ga4/client.cjs');
const html='<img src="outside.jpg"><div id="prdDetail"><div><img ec-data-src="https://wemamang.mycafe24.com/detail/dp01.jpg" alt="첫 이미지"><video src="https://wemamang.mycafe24.com/detail/dp02.mp4"></video><img src="https://wemamang.mycafe24.com/detail/dp05.jpg?a=1&amp;b=2"><iframe src="https://www.youtube.com/embed/abc"></iframe></div></div><img src="outside2.jpg">';
test('catalog preserves independent tracker indices, lazy images and source URLs; excludes unrelated markup',()=>{
 const rows=parseDetailMedia('<script>var x="<div id=\"prdDetail\">"</script>'+html);
 assert.deepEqual(rows.map(x=>x.id),['image_001','video_001','image_002','embed_001']);assert.equal(rows[0].filename,'dp01.jpg');assert.equal(rows[2].url.endsWith('?a=1&b=2'),true);assert.equal(rows[0].alt,'첫 이미지');
 assert.equal(parseDetailMedia('<div id="prdDetail"><video><source src="https://wemamang.mycafe24.com/x.mp4"></video></div>')[0].filename,'x.mp4');
 assert.throws(()=>parseDetailMedia('<div>nothing</div>'));
});
test('catalog rejects executable, credential, port and untrusted URLs',()=>{
 for(const url of ['javascript:alert(1)','data:image/svg+xml,hi','https://attacker.test/x','https://wemamang.com.attacker.test/x','https://a@wemamang.com/x','https://wemamang.com:9000/x'])assert.equal(detailMediaUrl(url),'');
 assert.equal(detailMediaUrl('/x.jpg'),'https://wemamang.com/x.jpg');
});
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'detail-catalog-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));let source=html,calls=0;
 const fetchImpl=async(url,options)=>{calls++;assert.equal(url,'https://wemamang.com/product/detail.html?product_no=458');assert.equal(options.redirect,'error');return{ok:true,status:200,text:async()=>source};};
 return {dir,api:createGa4Service({baseDir:dir,fetchImpl}),set:v=>source=v,calls:()=>calls};
}
const context={productId:'458',contentVersion:'v1'};
test('catalog imports without GA4 credentials and persists aliases across restarts and refresh imports',async t=>{
 const f=fixture(t);assert.equal((await f.api.detailCatalog()).items.length,0);
 const first=await f.api.detailCatalog({...context,action:'import'});assert.equal(first.items.length,4);
 await f.api.detailCatalog({...context,action:'rename',names:[{id:'image_001',name:'100℃ 가열 설명'}]});
 assert.equal((await createGa4Service({baseDir:f.dir}).detailCatalog()).items[0].name,'100℃ 가열 설명');
 assert.equal((await f.api.detailCatalog({...context,action:'import'})).items[0].name,'100℃ 가열 설명');
 assert.equal(fs.existsSync(path.join(f.dir,'.roas-private','ga4.dpapi')),false);
});
test('same-version content changes cannot overwrite historical mappings; version-specific aliases stay isolated',async t=>{
 const f=fixture(t);await f.api.detailCatalog({...context,action:'import'});
 f.set(html.replace('dp01.jpg','new.jpg'));
 await assert.rejects(f.api.detailCatalog({...context,action:'import'}),{code:'DETAIL_CATALOG_VERSION'});
 assert.equal((await f.api.detailCatalog()).items[0].filename,'dp01.jpg');
 f.api.detailSettings({...DETAIL_DEFAULTS,contentVersion:'v2'});assert.equal((await f.api.detailCatalog()).items.length,0);
 await assert.rejects(f.api.detailCatalog({...context,action:'import'}),{code:'DETAIL_CATALOG_CHANGED'});
 const next=await f.api.detailCatalog({...context,contentVersion:'v2',action:'import'});assert.equal(next.items[0].filename,'new.jpg');
 f.api.detailSettings(DETAIL_DEFAULTS);assert.equal((await f.api.detailCatalog()).items[0].filename,'dp01.jpg');
});
test('invalid alias mutations and failed imports preserve the saved catalog',async t=>{
 const f=fixture(t);await f.api.detailCatalog({...context,action:'import'});
 for(const name of ['x'.repeat(81),'line\nbreak'])await assert.rejects(f.api.detailCatalog({...context,action:'rename',names:[{id:'image_001',name}]}),{code:'DETAIL_CATALOG_NAMES'});
 f.set('<div>missing content</div>');await assert.rejects(f.api.detailCatalog({...context,action:'import'}));assert.equal((await f.api.detailCatalog()).items.length,4);
});
test('video thumbnails persist across restart and imports without losing names; invalid or image-target uploads are rejected',async t=>{
 const f=fixture(t);await f.api.detailCatalog({...context,action:'import'});
 await f.api.detailCatalog({...context,action:'rename',names:[{id:'video_001',name:'조유 시연'}]});
 const thumbnail='data:image/jpeg;base64,'+Buffer.from([255,216,255,217]).toString('base64');
 const saved=await f.api.detailCatalog({...context,action:'thumbnail',id:'video_001',thumbnail});
 assert.equal(saved.items[1].thumbnail,thumbnail);assert.equal(saved.items[1].name,'조유 시연');
 assert.equal((await createGa4Service({baseDir:f.dir}).detailCatalog()).items[1].thumbnail,thumbnail);
 assert.equal((await f.api.detailCatalog({...context,action:'import'})).items[1].thumbnail,thumbnail);
 for(const [id,data] of [['image_001',thumbnail],['video_001','data:image/svg+xml,<svg/>'],['video_001','data:image/jpeg;base64,YmFk']])await assert.rejects(f.api.detailCatalog({...context,action:'thumbnail',id,thumbnail:data}),{code:'DETAIL_THUMBNAIL'});
});
