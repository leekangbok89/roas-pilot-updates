'use strict';

// Keep the legacy-updater fallback in the already-managed server.js file.
// public/app-shell.* and public/display-analysis.html remain the editable sources of truth.
const fs=require('node:fs');
const path=require('node:path');

const project=path.resolve(__dirname,'..');
const serverFile=path.join(project,'server.js');
const begin='// BEGIN GENERATED SHELL ASSETS — run node scripts/bundle-shell.cjs';
const end='// END GENERATED SHELL ASSETS';

function main(){
  const args=process.argv.slice(2);
  if(args.length>1||(args.length===1&&args[0]!=='--check'))throw Error('Usage: node scripts/bundle-shell.cjs [--check]');
  const source=fs.readFileSync(serverFile,'utf8');
  const start=source.indexOf(begin),finish=source.indexOf(end);
  if(start<0||finish<start||source.indexOf(begin,start+begin.length)>=0||source.indexOf(end,finish+end.length)>=0)throw Error('Expected one generated shell-assets marker block in server.js');
  const assets={};
  for(const name of ['app-shell.css','app-shell.js','display-analysis.html','naver-analysis.js'])assets['/'+name]=fs.readFileSync(path.join(project,'public',name),'utf8');
  const block=begin+'\nconst bundledShellAssets=Object.freeze('+JSON.stringify(assets,null,2)+');\n'+end;
  const output=source.slice(0,start)+block+source.slice(finish+end.length);
  if(args[0]==='--check'){
    if(output!==source)throw Error('Shared-shell fallback is stale. Run node scripts/bundle-shell.cjs and commit server.js.');
    console.log('Shared-shell fallback matches all public fallback assets.');
    return;
  }
  if(output!==source)fs.writeFileSync(serverFile,output);
  console.log(output===source?'Shared-shell fallback already current.':'Updated shared-shell fallback in server.js.');
}

try{main();}catch(error){console.error(error.message);process.exitCode=1;}
