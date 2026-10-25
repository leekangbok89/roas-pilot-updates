'use strict';

// Older running updaters copy server.js but do not know about the AD CHANGES files.
// Keep the editable sources separate and embed the complete runtime in server.js.
const fs=require('node:fs');
const path=require('node:path');
const project=path.resolve(__dirname,'..');
const serverFile=path.join(project,'server.js');
const begin='// BEGIN GENERATED AD CHANGES RUNTIME — run node scripts/bundle-ad-changes.cjs';
const end='// END GENERATED AD CHANGES RUNTIME';

function main(){
  const args=process.argv.slice(2);
  if(args.length>1||(args.length===1&&args[0]!=='--check'))throw Error('Usage: node scripts/bundle-ad-changes.cjs [--check]');
  const source=fs.readFileSync(serverFile,'utf8');
  const start=source.indexOf(begin),finish=source.indexOf(end);
  if(start<0||finish<start||source.indexOf(begin,start+begin.length)>=0||source.indexOf(end,finish+end.length)>=0)throw Error('Expected one generated AD CHANGES runtime block in server.js');
  const client=fs.readFileSync(path.join(project,'integrations','ad-changes','service.cjs'),'utf8').trimEnd();
  const assets={};
  for(const name of ['ad-changes.html','ad-changes.js','ad-changes.css'])assets['/'+name]=fs.readFileSync(path.join(project,'public',name),'utf8');
  const block=begin+'\nconst bundledAdChanges=(()=>{const module={exports:{}};\n'+client+'\nreturn module.exports;})();\nconst bundledAdChangesAssets=Object.freeze('+JSON.stringify(assets,null,2)+');\n'+end;
  const output=source.slice(0,start)+block+source.slice(finish+end.length);
  if(args[0]==='--check'){
    if(output!==source)throw Error('AD CHANGES runtime bundle is stale. Run node scripts/bundle-ad-changes.cjs and commit server.js.');
    console.log('AD CHANGES runtime bundle matches the client and all three public assets.');
    return;
  }
  if(output!==source)fs.writeFileSync(serverFile,output);
  console.log(output===source?'AD CHANGES runtime bundle already current.':'Updated AD CHANGES runtime bundle in server.js.');
}
try{main();}catch(error){console.error(error.message);process.exitCode=1;}
