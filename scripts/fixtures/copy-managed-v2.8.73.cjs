'use strict';
// Historical updater copy boundary, preserved verbatim from server.js.
// Source: leekangbok89/roas-pilot-updates commit d2a156d8b7f7f6e94c02cbfd74397c46a8cc2e24.
// This reproduces the old running process, not the new package's managed list.
const fs=require('node:fs');
const path=require('node:path');
const managedFiles=['server.js','package.json','public/index.html','public/app.js','public/styles.css','public/app-shell.css','public/app-shell.js','public/visual-overview.html','public/cost-management.html'];
function diskPath(dir,rel){return path.join(dir,...rel.split('/'));}
function copyManaged(from,to,{allowMissing=false}={}){for(const rel of managedFiles){const f=diskPath(from,rel);if(!fs.existsSync(f)){if(allowMissing)continue;throw Error('업데이트 파일 누락: '+rel);}const dest=diskPath(to,rel);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(f,dest);}}
module.exports={managedFiles,copyManaged};
