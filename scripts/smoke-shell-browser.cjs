'use strict';

// Explicit integration gate for the shared three-page application shell.
// It uses a disposable app copy and synthetic local data, never user credentials.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawn}=require('node:child_process');

const source=path.resolve(__dirname,'..');
const tempRoot=fs.mkdtempSync(path.join(os.tmpdir(),'roas-shell-browser-'));
const legacyUpdater=require('./fixtures/copy-managed-v2.8.72.cjs');
const currentUpdater=require('./fixtures/copy-managed-v2.8.73.cjs');
const shellAssets=['public/app-shell.css','public/app-shell.js'];
const scenarios=['fresh-install','legacy-v72-upgrade','incomplete-v73-recovery'];
const base='http://127.0.0.1:3000';
const accountIds={naver:'111111',cafe:'222222'};
const expectedLabels=['한눈에 보기','광고별 진단','날짜별 비교','광고 변경 기록','검색광고 분석','디스플레이 분석','원가관리','상세페이지 분석','설정 관리'];
const selectors={rail:'#app-nav-rail',sidebar:'#app-drawer',toggle:'#app-nav-toggle',links:'#app-nav .app-nav-link[data-app-route]',title:'.app-page-title',main:'#app-main.app-main',theme:'#app-theme-toggle'};
const routes=[{url:'/visual-overview.html',active:'한눈에 보기'},{url:'/#ads-section',active:'광고별 진단'},{url:'/cost-management.html',active:'원가관리'}];
let child,browser,page,temp,scenario,serverLog='',checks=0;
const pageErrors=[],externalRequests=[];

function pass(name){checks++;console.log('PASS ['+scenario+'] '+name);}
function write(relative,value){const file=path.join(temp,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value));}
function seed(){
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const now=Date.parse(today+'T00:00:00Z'),synced={},naver={},cafe24={};
 for(let offset=95;offset>=0;offset--){
  const date=new Date(now-offset*86400000).toISOString().slice(0,10);synced[date]={checkedAt:today+'T00:00:00Z'};
  for(const [channel,id] of Object.entries(accountIds))write('.roas-data/daily/'+id+'/'+date+'.json',{account:id,date,currency:'KRW',savedAt:today+'T00:00:00Z',rows:[{date_start:date,date_stop:date,account_currency:'KRW',campaign_id:'campaign',campaign_name:'검증 캠페인',adset_id:'adset',adset_name:'검증 광고세트',ad_id:'ad-'+channel,ad_name:'검증 광고',spend:'10000',impressions:'1000',reach:'900',inline_link_clicks:'10',actions:[{action_type:'purchase',value:'1'}],action_values:[{action_type:'purchase',value:'300000'}]}]});
 }
 const name='위마망 화면 검증 상품',option='화이트';
 naver.sample={id:'sample',paymentDate:today,net:300000,gross:300000,refund:0,items:[{name,option,quantity:1}]};
 write('.roas-data/naver-orders/orders.json',{orders:naver});write('.roas-data/cafe24-orders/orders.json',{orders:cafe24});
 for(const channel of ['naver','cafe24'])write('.roas-data/'+channel+'-orders/sync.json',{days:synced});
 const key=crypto.createHash('sha256').update(JSON.stringify(['naver',name,option])).digest('hex').slice(0,24);
 write('.roas-data/product-costs.json',{[key]:{channel:'naver',name,option,cost:150000,delivery:0}});
 write('.roas-data/profit-fees.json',{naver:7,cafe24:3.5});
}
function snapshotSavedFiles(){
 const saved={};
 function visit(relative){
  const filename=path.join(temp,relative);
  if(!fs.existsSync(filename))return;
  if(fs.statSync(filename).isDirectory()){for(const name of fs.readdirSync(filename).sort())visit(path.join(relative,name));}
  else saved[relative]=crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
 }
 for(const relative of ['.roas-data','.roas-private','.env'])visit(relative);
 return saved;
}
function prepareInstallation(){
 temp=path.join(tempRoot,scenario);fs.mkdirSync(temp,{recursive:true});
 for(const name of ['server.js','package.json','public','vendor'])if(fs.existsSync(path.join(source,name)))fs.cpSync(path.join(source,name),path.join(temp,name),{recursive:true});
 seed();
 write('.roas-private/preservation-test.dpapi',{ciphertext:'synthetic-encrypted-byte-preservation-sentinel'});
 fs.writeFileSync(path.join(temp,'.env'),'SYNTHETIC_PRESERVED_SETTING=example\n');
 const before=snapshotSavedFiles();
 if(scenario!=='fresh-install'){
  // The old install has no shell assets. These two files were introduced in v73.
  // All older runtime assets survive; the historical copier decides what the
  // new package can replace, exactly as the still-running updater did.
  for(const relative of shellAssets)fs.rmSync(path.join(temp,relative),{force:true});
   // Legacy copiers do not include this new page; it must be served by server.js fallback.
   fs.rmSync(path.join(temp,'public/meta-experiments.html'),{force:true});
   // Older updater builds do not include this view in managedFiles.
   fs.rmSync(path.join(temp,'public/display-analysis.html'),{force:true});
  const previousVersion=scenario==='legacy-v72-upgrade'?'2.8.72':'2.8.73';
  const pkg=JSON.parse(fs.readFileSync(path.join(temp,'package.json'),'utf8'));
  fs.writeFileSync(path.join(temp,'package.json'),JSON.stringify({...pkg,version:previousVersion}));
  const copier=previousVersion==='2.8.72'?legacyUpdater:currentUpdater;
  copier.copyManaged(source,temp);
  for(const relative of copier.managedFiles)assert.deepEqual(fs.readFileSync(path.join(temp,relative)),fs.readFileSync(path.join(source,relative)),'Historical updater copies '+relative);
  assert.equal(JSON.parse(fs.readFileSync(path.join(temp,'package.json'),'utf8')).version,JSON.parse(fs.readFileSync(path.join(source,'package.json'),'utf8')).version,'Updater installs the candidate package version');
 }
 for(const relative of shellAssets)assert.equal(fs.existsSync(path.join(temp,relative)),scenario!=='legacy-v72-upgrade','Expected installed shell asset boundary for '+scenario+': '+relative);
 assert.equal(fs.existsSync(path.join(temp,'public/display-analysis.html')),scenario==='fresh-install','Historical updater should miss the new display page and exercise bundled fallback');
 assert.deepEqual(snapshotSavedFiles(),before,'Updating must preserve saved orders, costs, credentials, and settings byte for byte');
 pass('installation reproduces historical managed-file copying and preserves local data/credential bytes');
}
async function startServer(){
 serverLog='';
 const bootstrap="global.fetch=async()=>{throw Error('External network disabled in shell verification');};const app=require('./server');app.server.listen(3000,'127.0.0.1',()=>console.log('READY 3000'));";
 child=spawn(process.execPath,['-e',bootstrap],{cwd:temp,env:{...process.env,META_ACCESS_TOKEN:'',META_AD_ACCOUNT_ID:'',OPENAI_API_KEY:'',WEB_PASSWORD:'',HOST:'127.0.0.1'},stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',data=>{serverLog+=data;});child.stderr.on('data',data=>{serverLog+=data;});
 await new Promise((resolve,reject)=>{
  const timeout=setTimeout(()=>reject(Error('Synthetic localhost server did not start: '+serverLog)),10000);
  child.stdout.on('data',data=>{if(String(data).includes('READY 3000')){clearTimeout(timeout);resolve();}});
  child.once('error',error=>{clearTimeout(timeout);reject(error);});
  child.once('exit',code=>{if(code){clearTimeout(timeout);reject(Error('Synthetic server exited; existing localhost services were not stopped: '+serverLog));}});
 });
}
async function stopServer(){
 if(child&&child.exitCode===null){
  const running=child;
  await new Promise(resolve=>{const timer=setTimeout(resolve,3000);running.once('exit',()=>{clearTimeout(timer);resolve();});running.kill('SIGTERM');});
 }
 child=null;
}
async function verifyAssetDelivery(){
 for(const [asset,type] of [['app-shell.css','text/css'],['app-shell.js','application/javascript'],['display-analysis.html','text/html']]){
  const response=await fetch(base+'/'+asset);
  assert.equal(response.status,200,'Shell asset responds even if the legacy updater never installed it: '+asset);
  assert.ok(response.headers.get('content-type').startsWith(type),'Correct MIME type for '+asset);
  assert.equal(response.headers.get('cache-control'),'no-cache');
  assert.equal(response.headers.get('x-content-type-options'),'nosniff');
  assert.equal(await response.text(),fs.readFileSync(path.join(source,'public',asset),'utf8'),'Served shell matches the shipped source');
 }
 assert.equal((await fetch(base+'/not-a-shell-file.js')).status,404,'Unrelated missing assets must remain 404');
 pass('Shell CSS, JS and display page return current source with correct MIME/cache headers; unrelated assets stay404');
}
async function shellState(expanded){
 await page.waitForFunction(({selector,expanded})=>document.querySelector(selector)?.getAttribute('aria-expanded')===String(expanded),{selector:selectors.toggle,expanded});
}
async function go(route){
 await page.mouse.move(600,700);
 await page.goto(base+route,{waitUntil:'domcontentloaded'});
 await page.locator(selectors.sidebar).waitFor({state:'attached'});
 await page.locator(selectors.title).first().waitFor({state:'visible'});
 await page.waitForFunction(()=>document.readyState==='complete');
 await page.mouse.move(600,700);
 await page.keyboard.press('Escape');
 if(route.startsWith('/visual-overview'))await page.waitForFunction(()=>document.getElementById('reload')?.disabled===false);
 if(route.startsWith('/cost-management'))await page.waitForFunction(()=>!document.getElementById('status')?.textContent.includes('목록 확인 중'));
 await shellState(false);
}
async function activeLabel(){
 return page.locator(selectors.links).evaluateAll(nodes=>nodes.filter(node=>node.getAttribute('aria-current')==='page'||node.classList.contains('active')).map(node=>node.getAttribute('aria-label')||node.querySelector('.app-nav-label')?.textContent?.trim()||node.textContent.trim()));
}
async function labelList(){return page.locator(selectors.links).evaluateAll(nodes=>nodes.map(node=>node.getAttribute('aria-label')||node.querySelector('.app-nav-label')?.textContent?.trim()||node.textContent.trim()));}
async function mainBox(){const box=await page.locator(selectors.main).boundingBox();assert.ok(box);return {x:box.x,width:box.width};}
function sameBox(a,b,label){assert.ok(Math.abs(a.x-b.x)<0.6,label+' must not move main content horizontally: '+JSON.stringify({a,b}));assert.ok(Math.abs(a.width-b.width)<0.6,label+' must not resize main content: '+JSON.stringify({a,b}));}
async function verifyOverviewFolds(){
 const panels=[['details.fold-panel:has(#channels)','#channels'],['details.fold-panel:has(#daily)','#daily'],['#profit-panel','#profit-save-fees'],['#budget-efficiency','#budget-step']];
 assert.equal(await page.locator('details.fold-panel').count(),4,'Four overview panels retain the new folded presentation after installation/update');
 assert.equal(await page.locator('#ai-strategy,#ai-form,#ai-key,#ai-question,#ai-submit').count(),0,'Removed AI controls must not reappear in any installation path');
 assert.equal(await page.getByText('AI 전략 회의실',{exact:true}).count(),0);
 for(const [selector,content] of panels){
  assert.equal(await page.locator(selector).evaluate(node=>node.open),false,selector+' starts closed');
  assert.equal(await page.locator(selector+' > summary').isVisible(),true);
  assert.equal(await page.locator(content).isVisible(),false,'Folded content is hidden until the user opens it');
 }
 for(const [index,[selector,content]] of [panels[0],panels[2]].entries()){
  const panel=page.locator(selector),summary=panel.locator(':scope > summary');
  if(index){await summary.focus();await page.keyboard.press('Enter');}else await summary.click();
  assert.equal(await panel.evaluate(node=>node.open),true,'Real mouse/keyboard interaction opens the overview panel');
  await page.locator(content).waitFor({state:'visible'});
  if(index){await summary.focus();await page.keyboard.press('Enter');}else await summary.click();
  assert.equal(await panel.evaluate(node=>node.open),false);
  assert.equal(await page.locator(content).isVisible(),false);
 }
}
async function revealOverviewTable(){
 if(new URL(page.url()).pathname!=='/visual-overview.html')return;
 const panel=page.locator('details.fold-panel:has(#channels)');
 if(!(await panel.evaluate(node=>node.open)))await panel.locator(':scope > summary').click();
 assert.equal(await panel.evaluate(node=>node.open),true,'Typography and contrast are measured only after opening the channel panel');
 await page.locator('#channels table th').first().waitFor({state:'visible'});
}
async function typography(){
 await revealOverviewTable();
 await page.waitForFunction(()=>Array.from(document.querySelectorAll('main table th')).some(node=>node.getBoundingClientRect().height>0));
 return page.evaluate(sel=>{
  const visible=node=>node&&getComputedStyle(node).display!=='none'&&getComputedStyle(node).visibility!=='hidden'&&node.getBoundingClientRect().width>0&&node.getBoundingClientRect().height>0;
  const main=document.querySelector(sel.main),find=selector=>Array.from(main.querySelectorAll(selector)).find(visible);
  const font=node=>{if(!node)return null;const css=getComputedStyle(node);return {family:css.fontFamily,size:css.fontSize,weight:css.fontWeight,lineHeight:css.lineHeight};};
  const css=getComputedStyle(main);
  return {body:font(document.body),title:font(find(sel.title)),button:font(find('button')),input:font(find('input:not([type="hidden"])')),select:font(find('select')),table:font(find('th')),main:{paddingTop:css.paddingTop,paddingRight:css.paddingRight,paddingBottom:css.paddingBottom,paddingLeft:css.paddingLeft,maxWidth:css.maxWidth}};
 },selectors);
}
async function hoverOverlay(){
 const initial=await mainBox(),rail=await page.locator(selectors.rail).boundingBox();
 assert.ok(rail&&rail.width>=20&&rail.width<=64,'Default navigation is a narrow accessible rail');
 await page.mouse.move(rail.x+Math.min(rail.width/2,25),Math.min(rail.y+160,400));
 await shellState(true);
 await page.waitForFunction(selector=>{
  const drawer=document.querySelector(selector),box=drawer.getBoundingClientRect();
  return getComputedStyle(drawer).visibility==='visible'&&Math.abs(box.x)<0.5&&box.width>=180;
 },selectors.sidebar);
 const icons=await page.locator(selectors.links+' svg').evaluateAll(nodes=>nodes.map(node=>({width:node.getBoundingClientRect().width,height:node.getBoundingClientRect().height})));
 assert.equal(icons.length,expectedLabels.length,'Each navigation item retains its compact icon');
 for(const icon of icons)assert.ok(Math.abs(icon.width-17)<0.1&&Math.abs(icon.height-17)<0.1,'Navigation icons must be17px, never the hundreds of pixels seen with missing shell CSS: '+JSON.stringify(icon));
 const labelSizes=await page.locator(selectors.links).evaluateAll(nodes=>nodes.map(node=>getComputedStyle(node).fontSize));
 assert.deepEqual(labelSizes,expectedLabels.map(()=> '12px'),'All sidebar labels are 12px');
 const spacing=await page.locator(selectors.links).evaluateAll(links=>{
  const nav=links[0]?.parentElement,navStyle=getComputedStyle(nav);
  return {gap:parseFloat(navStyle.rowGap),links:links.map(link=>{
   const box=link.getBoundingClientRect(),style=getComputedStyle(link);
   return {top:box.top,bottom:box.bottom,height:box.height,paddingTop:parseFloat(style.paddingTop),paddingBottom:parseFloat(style.paddingBottom)};
  })};
 });
 assert.equal(spacing.gap,2,'Desktop sidebar items use only a 2px gap');
 for(const [index,item] of spacing.links.entries()){
  assert.ok(item.height>=35&&item.height<=38,'Desktop sidebar link stays compact (36px): '+JSON.stringify(item));
  assert.ok(item.paddingTop<=7&&item.paddingBottom<=7,'Avoid oversized vertical link padding');
  if(index)assert.ok(spacing.links[index-1].bottom<=item.top&&item.top-spacing.links[index-1].bottom<=3,
   'Menu links are tightly stacked without overlap or excessive blank space');
 }
 sameBox(initial,await mainBox(),'Hovered navigation overlay');
 await page.mouse.move(900,650);await shellState(false);
 sameBox(initial,await mainBox(),'Closed navigation overlay');
}
async function nav(label){
 await page.locator(selectors.rail).hover();await shellState(true);
 const link=page.locator(selectors.links).filter({hasText:label});
 assert.equal(await link.count(),1,'Navigation label must identify one item: '+label);
 await link.click();await page.waitForLoadState('domcontentloaded');
 await page.locator(selectors.title).first().waitFor({state:'visible'});
 await page.mouse.move(900,650);
 await page.waitForFunction(({selector,label})=>Array.from(document.querySelectorAll(selector)).some(node=>(node.getAttribute('aria-current')==='page'||node.classList.contains('active'))&&node.textContent.includes(label)),{selector:selectors.links,label});
 assert.deepEqual(await activeLabel(),[label]);
}
async function theme(value){
 const current=await page.locator('html').getAttribute('data-theme'),saved=await page.evaluate(()=>localStorage.getItem('roas-pilot-theme'));
 if(current===value&&saved!==value)await page.locator(selectors.theme).click();
 if(await page.locator('html').getAttribute('data-theme')!==value)await page.locator(selectors.theme).click();
 await page.waitForFunction(value=>document.documentElement.dataset.theme===value,value);
 assert.equal(await page.evaluate(()=>localStorage.getItem('roas-pilot-theme')),value,'Theme selection is persisted');
}
async function contrastAudit(themeName){
 await revealOverviewTable();
 const samples=await page.evaluate(sel=>{
  const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d',{willReadFrequently:true});
  const rgba=value=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=value;ctx.fillRect(0,0,1,1);const p=ctx.getImageData(0,0,1,1).data;return [p[0],p[1],p[2],p[3]/255];};
  const over=(a,b)=>{const alpha=a[3]+b[3]*(1-a[3]);return [0,1,2].map(i=>alpha?(a[i]*a[3]+b[i]*b[3]*(1-a[3]))/alpha:0).concat(alpha);};
  const bg=node=>{const layers=[];for(let n=node;n;n=n.parentElement)layers.push(rgba(getComputedStyle(n).backgroundColor));return layers.reverse().reduce((base,layer)=>over(layer,base),[255,255,255,1]);};
  const lum=color=>color.slice(0,3).map(v=>{const x=v/255;return x<=0.04045?x/12.92:Math.pow((x+0.055)/1.055,2.4);}).reduce((sum,v,i)=>sum+v*[0.2126,0.7152,0.0722][i],0);
  const visible=node=>node&&getComputedStyle(node).display!=='none'&&getComputedStyle(node).visibility!=='hidden'&&node.getBoundingClientRect().width>0&&node.getBoundingClientRect().height>0;
  const main=document.querySelector(sel.main),find=selector=>Array.from(main.querySelectorAll(selector)).find(visible);
  const picked=[['body',document.body],['title',find(sel.title)],['muted',find('.sub,.small,.helper,p')],['table header',find('th')],['table cell',find('td')],['input',find('input:not([type="hidden"])')],['select',find('select')],['button',find('button')],['primary button',find('button.primary,.button.primary')],['highlighted KPI',find('.metric.highlight strong')],['chart legend',find('#legend button')||find('#legend')]];
  const colors=picked.filter(([,node])=>node).map(([name,node])=>{const css=getComputedStyle(node),background=bg(node),foreground=over(rgba(css.color),background),a=lum(background),b=lum(foreground);return {name,fontSize:parseFloat(css.fontSize),foreground:css.color,background,backgroundLuminance:a,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};});
  const surfaces=Array.from(main.querySelectorAll('section,.panel,button,input,select')).filter(visible).slice(0,70).map(node=>({tag:node.tagName,id:node.id,background:getComputedStyle(node).backgroundColor,luminance:lum(bg(node))}));
  const chartText=Array.from(main.querySelectorAll('#graph svg text')).filter(visible).map(node=>{const css=getComputedStyle(node),background=bg(node),foreground=over(rgba(css.fill||css.color),background),a=lum(background),b=lum(foreground);return {text:node.textContent,fill:css.fill,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};});
  return {colors,surfaces,chartText};
 },selectors);
 for(const sample of samples.colors){assert.ok(sample.fontSize>=14,themeName+' '+sample.name+' text must be at least14px: '+JSON.stringify(sample));assert.ok(sample.ratio>=4.45,themeName+' '+sample.name+' contrast must meet4.5:1: '+JSON.stringify(sample));}
 if(themeName==='dark')for(const sample of samples.surfaces)assert.ok(sample.luminance<0.55,'Dark surfaces must not retain white glare: '+JSON.stringify(sample));
 for(const sample of samples.chartText)assert.ok(sample.ratio>=4.45,themeName+' chart axis labels must remain readable: '+JSON.stringify(sample));
 return samples;
}
async function screenshot(name){
 if(!process.env.ROAS_SHELL_SCREENSHOT_DIR)return;
 if(await page.locator(selectors.toggle).getAttribute('aria-expanded')==='true')await page.waitForFunction(selector=>Math.abs(document.querySelector(selector).getBoundingClientRect().x)<0.5,selectors.sidebar);
 fs.mkdirSync(process.env.ROAS_SHELL_SCREENSHOT_DIR,{recursive:true});
 await page.screenshot({path:path.join(process.env.ROAS_SHELL_SCREENSHOT_DIR,'qa-shell-'+scenario+'-'+name+'.png'),fullPage:false});
}

async function verifyBrowserScenario(){
 prepareInstallation();
 await startServer();
 await verifyAssetDelivery();
 const localModule='/tmp/roas-pilot-ui-runtime/node_modules/playwright';
 const {chromium}=require(process.env.ROAS_PLAYWRIGHT_MODULE||(fs.existsSync(localModule)?localModule:'playwright'));
 const localBrowser='/tmp/roas-pilot-browser/chromium_headless_shell-1194/chrome-linux/headless_shell';
 const executable=process.env.BROWSER_EXECUTABLE||(fs.existsSync(localBrowser)?localBrowser:null);
 browser=await chromium.launch({headless:true,...(executable?{executablePath:executable}:{})});
 const context=await browser.newContext({viewport:{width:1280,height:1000},locale:'ko-KR',timezoneId:'Asia/Seoul'});
 await context.addInitScript(ids=>localStorage.setItem('roas-account-ids',JSON.stringify(ids)),accountIds);
 await context.route('**/*',route=>{const url=route.request().url();if(url.startsWith(base+'/'))return route.continue();externalRequests.push(url);return route.abort();});
 page=await context.newPage();page.on('pageerror',error=>pageErrors.push(error.message));
 await go('/visual-overview.html');await verifyOverviewFolds();
 async function readSharedSpend(context){
  await page.waitForFunction(()=>document.querySelectorAll('#ad-spend-breakdown [data-spend-key]').length===3&&
   [...document.querySelectorAll('#ad-spend-breakdown [data-spend-key] strong')].every(el=>el.textContent!=='—'&&el.textContent.endsWith('원')));
  const got=await page.locator('#ad-spend-breakdown [data-spend-key]').evaluateAll(nodes=>nodes.map(node=>({
   key:node.dataset.spendKey,label:node.querySelector('.roas-shared-spend-title')?.textContent,
   amount:node.querySelector('strong')?.textContent
  })));
  assert.deepEqual(got.map(item=>item.key),['spend','smartstoreSpend','mallSpend'],context);
  assert.deepEqual(got.map(item=>item.label),['총 광고비','스마트스토어 협력 메타 광고비','자사몰 메타 광고비']);
  return got.map(item=>item.amount);
 }
 const originalSpend=await readSharedSpend('한눈에 보기');
 // Regression: the overview owns the spend block after the date toolbar;
 // shared navigation code must not lift or duplicate it into the page header.
 const overviewPlacement=await page.evaluate(()=>{
  const root=document.getElementById('ad-spend-breakdown'),heading=root?.previousElementSibling,alert=document.getElementById('alert');
  const toolbar=document.getElementById('reload')?.closest('section');
  return {rootCount:document.querySelectorAll('#ad-spend-breakdown').length,
   headingClass:heading?.className,afterAlert:heading?.previousElementSibling===alert,
   afterToolbar:!!toolbar&&Boolean(toolbar.compareDocumentPosition(heading)&Node.DOCUMENT_POSITION_FOLLOWING)};
 });
 assert.equal(overviewPlacement.rootCount,1,'Only one spend strip can exist');
 assert.equal(overviewPlacement.headingClass,'ad-spend-heading');
 assert.equal(overviewPlacement.afterAlert,true,'The strip stays after the overview toolbar and alert');
 assert.equal(overviewPlacement.afterToolbar,true);
 // Screenshot-sized breakpoints including intermediate 720–1100px widths
 // must not overlap, overflow or cut off any of the three spend cards.
 for(const width of [390,700,768,920,1024,1280,1440,1920]){
  await page.setViewportSize({width,height:1000});
  const geometry=await page.evaluate(()=>{
   const root=document.getElementById('ad-spend-breakdown'),cards=[...root.querySelectorAll('[data-spend-key]')];
   return {viewport:document.documentElement.clientWidth,strip:root.getBoundingClientRect().toJSON(),cards:cards.map(x=>x.getBoundingClientRect().toJSON())};
  });
  assert.equal(geometry.cards.length,3,'All three spend cards stay visible at '+width+'px');
  for(const [index,card] of geometry.cards.entries()){
   assert.ok(card.width>60&&card.height>35,'Card '+index+' has a readable size at '+width+'px');
   assert.ok(card.left>=-1&&card.right<=geometry.viewport+1,'No horizontal spend-card clipping at '+width+'px '+JSON.stringify(card));
   for(const previous of geometry.cards.slice(0,index)){
    const overlapWidth=Math.min(card.right,previous.right)-Math.max(card.left,previous.left);
    const overlapHeight=Math.min(card.bottom,previous.bottom)-Math.max(card.top,previous.top);
    assert.ok(overlapWidth<=1||overlapHeight<=1,'Spend cards must not overlap at '+width+'px');
   }
  }
 }

 for(const width of [1280,1920]){
  await page.setViewportSize({width,height:1100});const samples=[];
  for(const route of routes){
   await go(route.url);assert.deepEqual(await labelList(),expectedLabels,'Shared navigation labels/order on '+route.url);
   assert.deepEqual(await readSharedSpend(route.url),originalSpend,'Three spend values must be identical on overview, diagnosis and cost pages over the same period');
   assert.deepEqual(await activeLabel(),[route.active]);
   const current=await typography();
   for(const key of ['body','title','button','input','select','table'])assert.ok(current[key],key+' must have a visible sample on '+route.url);
   samples.push({route:route.url,styles:current});
   await hoverOverlay();
  }
  for(const sample of samples.slice(1))assert.deepEqual(sample.styles,samples[0].styles,'Typography, control/table styles and main padding must match at '+width+'px: '+sample.route+' vs '+samples[0].route);
  pass(width+'px: pages retain folded overview/removed AI and share visible fonts, controls, tables, spacing, navigation, and non-shifting hover rail');
 }

 await go('/#data-source');
 assert.deepEqual(await readSharedSpend('설정 관리'),originalSpend);
 await go('/display-analysis.html');
 await readSharedSpend('디스플레이 분석');
 await page.setViewportSize({width:1440,height:1100});
 for(const mode of ['light','dark']){
  for(const route of routes){
   await go(route.url);await theme(mode);await shellState(false);
   await contrastAudit(mode);
   if(route.active==='한눈에 보기')await screenshot('overview-'+mode);
   if(mode==='dark'&&route.active==='한눈에 보기'&&process.env.ROAS_SHELL_SCREENSHOT_DIR)await page.locator('#graph').locator('..').screenshot({path:path.join(process.env.ROAS_SHELL_SCREENSHOT_DIR,'qa-shell-'+scenario+'-chart-dark.png')});
   if(mode==='dark'&&route.active==='원가관리')await screenshot('cost-dark');
   await page.reload({waitUntil:'domcontentloaded'});await page.locator(selectors.title).first().waitFor({state:'visible'});
   assert.equal(await page.locator('html').getAttribute('data-theme'),mode,'Theme survives reload on '+route.url);
  }
  pass(mode+' theme: three pages have readable primary/muted/table/control text and persist across navigation/reload');
 }
 // Verify that the experiment page uses the shared light/dark palette and saved theme.
 for(const mode of ['light','dark']){
   await go('/meta-experiments.html');await theme(mode);
   const color=await page.evaluate(()=>{
     const root=getComputedStyle(document.documentElement);
     const rgb=selector=>getComputedStyle(document.querySelector(selector)).backgroundColor;
     const sample=document.createElement('div');document.body.appendChild(sample);
     const token=name=>{sample.style.backgroundColor='var('+name+')';return getComputedStyle(sample).backgroundColor;};
     const colors={
       pagePalette:token('--app-bg'),
       panelPalette:token('--app-surface'),
       softPalette:token('--app-surface-soft'),
       page:rgb('body'),panel:rgb('.experiment-panel'),
       date:rgb('.filters input[type="date"]'),select:rgb('.filters select'),
       table:rgb('.experiment-panel th'),notice:rgb('.experiment-panel .notice'),
       scheme:root.colorScheme
     };
     sample.style.color='var(--app-muted)';
     colors.muted=getComputedStyle(sample).color;
     colors.description=getComputedStyle(document.querySelector('.experiment-panel p')).color;
     sample.remove();return colors;
   });
   assert.equal(color.scheme,mode,'Native date inputs must use the selected theme');
   assert.equal(color.page,color.pagePalette,'Page must match shared background');
   assert.equal(color.panel,color.panelPalette,'Cards must match shared panel colors');
   assert.equal(color.date,color.panelPalette,'Date fields must match shared controls');
   assert.equal(color.select,color.panelPalette,'Dropdowns must match shared controls');
   assert.equal(color.table,color.softPalette,'Table headers must use shared soft background');
   assert.equal(color.notice,color.softPalette,'Information panels must use shared soft background');
   assert.equal(color.description,color.muted,'Description must use shared secondary text color');
   await contrastAudit(mode);
   await page.reload({waitUntil:'domcontentloaded'});
   assert.equal(await page.locator('html').getAttribute('data-theme'),mode,'Experiment theme must persist across reload');
 }
 pass('experiment cards, date fields, dropdowns, tables, text and notices match both shared themes');
 for(const hash of ['#cafe24-oauth','#naver-commerce','#history-audit','#update-manager']){
  await go('/'+hash);await theme('dark');assert.deepEqual(await activeLabel(),['설정 관리']);
  assert.equal(await page.locator(hash).isVisible(),true,'Direct settings hash opens correct settings section');
  await contrastAudit('dark');
 }
 await screenshot('settings-dark');
 pass('dark settings pages retain readable forms and correct active navigation for connection/history/update deep links');

 await go('/visual-overview.html');
 await page.locator(selectors.rail).hover();await shellState(true);await screenshot('menu-open');
 await page.mouse.move(900,650);await shellState(false);
 const before=await mainBox();
 await page.locator(selectors.toggle).focus();await shellState(true);
 await page.keyboard.press('Escape');await shellState(false);sameBox(before,await mainBox(),'Keyboard Escape');
 assert.equal(await page.locator(selectors.toggle).evaluate(node=>document.activeElement===node),true,'Escape keeps focus on an accessible menu toggle');
 await page.keyboard.press('Enter');await shellState(true);
 await page.keyboard.press('Escape');await shellState(false);
 pass('keyboard focus, Enter and Escape open/close navigation without shifting content');

 for(const [label,url,section] of [['광고별 진단','/#ads-section','#ads-section'],['날짜별 비교','/#daily-compare','#daily-compare'],['설정 관리','/#data-source','#data-source'],['원가관리','/cost-management.html',null],['한눈에 보기','/visual-overview.html',null]]){
  await nav(label);
  const target=new URL(page.url());assert.equal(target.pathname+target.hash,url,'Actual navigation destination for '+label);
  if(section){assert.equal(await page.locator(section).isVisible(),true,'Selected workspace section must be visible');for(const other of ['#ads-section','#daily-compare','#sales-impact'])if(other!==section)assert.equal(await page.locator(other).isVisible(),false,'Inactive workspace section must be hidden');}
 }
 pass('actual navigation clicks switch all routes/index sections and keep one correct active item');
 await page.goto(base+'/meta-experiments.html');
 assert.equal(await page.locator('#dimension').count(),1,'Experiment comparison page remains available at its direct URL');
 assert.equal(await page.locator('#app-nav [data-app-route="experiments"]').count(),0,'Direct experiment page must not reinsert its own sidebar entry');
 assert.deepEqual(await activeLabel(),[],'Hidden experiment route must not activate an unavailable sidebar entry');
 // Exercise the read-only cross-account comparison with synthetic local data.
 assert.equal(await page.locator('#account-choice').inputValue(),'all');
 await page.locator('#load').click();
 await page.waitForFunction(()=>document.getElementById('status').textContent.includes('조회 완료'));
 assert.equal(await page.locator('#classify tr').count(),2,'Both account campaign classifications are loaded');
 const experimentFrom=await page.locator('#since').inputValue();
 await page.locator('#classify tr').nth(0).locator('select[data-label="asc"]').selectOption('ON');
 await page.locator('#classify tr').nth(1).locator('select[data-label="asc"]').selectOption('OFF');
 await page.locator('#classify input[data-label="from"]').nth(0).fill(experimentFrom);
 await page.locator('#classify input[data-label="from"]').nth(1).fill(experimentFrom);
 assert.equal(await page.locator('#result tr').count(),2,'ASC ON and OFF groups both show stored metrics');
 await page.reload({waitUntil:'domcontentloaded'});
 await page.locator('#load').click();
 await page.waitForFunction(()=>document.getElementById('status').textContent.includes('조회 완료'));
 assert.equal(await page.locator('#classify tr').first().locator('select[data-label="asc"]').inputValue(),'ON','Campaign classification is saved in the browser');

 await nav('광고별 진단');await nav('날짜별 비교');
 // The hidden legacy analysis view remains reachable by its direct URL.
 await page.goto(base+'/#sales-impact');await page.waitForFunction(()=>document.body.dataset.appView==='sales-impact');
 assert.deepEqual(await activeLabel(),[]);
 await page.goBack();await page.waitForFunction(()=>document.body.dataset.appView==='daily-compare');assert.deepEqual(await activeLabel(),['날짜별 비교']);assert.equal(await page.locator('#daily-compare').isVisible(),true);
 await page.goForward();await page.waitForFunction(()=>document.body.dataset.appView==='sales-impact');assert.deepEqual(await activeLabel(),[]);assert.equal(await page.locator('#sales-impact').isVisible(),true);assert.equal(await page.locator('#funnel').isVisible(),false);
 pass('browser back/forward retains direct sales route with no redundant menu link');

 const touch=await browser.newContext({viewport:{width:768,height:1024},hasTouch:true,isMobile:true,locale:'ko-KR',timezoneId:'Asia/Seoul'});
 await touch.addInitScript(ids=>localStorage.setItem('roas-account-ids',JSON.stringify(ids)),accountIds);
 await touch.route('**/*',route=>{const url=route.request().url();if(url.startsWith(base+'/'))return route.continue();externalRequests.push(url);return route.abort();});
 const desktop=page;page=await touch.newPage();page.on('pageerror',error=>pageErrors.push(error.message));
 // A new headless page's synthetic mouse starts at (0,0), inside the hover rail.
 // Move it off the rail before testing an actual touch-only interaction.
 await page.mouse.move(600,700);
 await page.goto(base+'/cost-management.html');await page.locator(selectors.toggle).waitFor();await shellState(false);
 const touchBefore=await mainBox();await page.locator(selectors.toggle).tap();await shellState(true);sameBox(touchBefore,await mainBox(),'Touch menu overlay');
 const touchLinkHeight=await page.locator(selectors.links).first().evaluate(link=>link.getBoundingClientRect().height);
 assert.ok(touchLinkHeight>=43,'Touch menu maintains 44px interaction targets');
 await page.locator(selectors.toggle).tap();await shellState(false);sameBox(touchBefore,await mainBox(),'Touch menu closure');
 pass('touch toggle remains accessible and opens/closes the overlay without layout changes');
 await touch.close();page=desktop;

 assert.deepEqual(pageErrors,[],'No browser JavaScript errors across pages and navigation');
 assert.deepEqual(externalRequests,[],'Shell verification must not require external resources');
 await browser.close();browser=null;page=null;
 await stopServer();
}
(async()=>{
 for(scenario of scenarios)await verifyBrowserScenario();
 console.log('Shared shell and upgrade verification passed: '+checks+' checks across '+scenarios.length+' installation paths, no browser JavaScript errors.');
})().catch(async error=>{
 console.error('FAIL '+error.stack);
 if(page)console.error(JSON.stringify(await page.evaluate(()=>({url:location.href,bodyClass:document.body.className,bodyData:document.body.dataset,toggles:Array.from(document.querySelectorAll('[aria-expanded]')).map(node=>({id:node.id,expanded:node.getAttribute('aria-expanded')}))})).catch(()=>({}))));
 process.exitCode=1;
}).finally(async()=>{
 if(browser)await browser.close();
 await stopServer();
 fs.rmSync(tempRoot,{recursive:true,force:true});
});
