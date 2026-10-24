'use strict';

// Older running updaters copy server.js but do not know about the GA4 files.
// Keep the editable sources separate and embed the complete runtime in server.js.
const fs=require('node:fs');
const path=require('node:path');
const project=path.resolve(__dirname,'..');
const serverFile=path.join(project,'server.js');
const begin='// BEGIN GENERATED GA4 RUNTIME — run node scripts/bundle-ga4.cjs';
const end='// END GENERATED GA4 RUNTIME';

function main(){
  const args=process.argv.slice(2);
  if(args.length>1||(args.length===1&&args[0]!=='--check'))throw Error('Usage: node scripts/bundle-ga4.cjs [--check]');
  const source=fs.readFileSync(serverFile,'utf8');
  const start=source.indexOf(begin),finish=source.indexOf(end);
  if(start<0||finish<start||source.indexOf(begin,start+begin.length)>=0||source.indexOf(end,finish+end.length)>=0)throw Error('Expected one generated GA4 runtime block in server.js');
  const client=fs.readFileSync(path.join(project,'integrations','ga4','client.cjs'),'utf8').trimEnd();
  const assets={};
  for(const name of ['ga4.html','ga4.js','ga4.css'])assets['/'+name]=fs.readFileSync(path.join(project,'public',name),'utf8');
  const block=begin+'\nconst bundledGa4=(()=>{const module={exports:{}};\n'+client+'\nreturn module.exports;})();\nconst bundledGa4Assets=Object.freeze('+JSON.stringify(assets,null,2)+');\n'+end;
  const output=source.slice(0,start)+block+source.slice(finish+end.length);
  if(args[0]==='--check'){
    if(output!==source)throw Error('GA4 runtime bundle is stale. Run node scripts/bundle-ga4.cjs and commit server.js.');
    console.log('GA4 runtime bundle matches the client and all three public assets.');
    return;
  }
  if(output!==source)fs.writeFileSync(serverFile,output);
  console.log(output===source?'GA4 runtime bundle already current.':'Updated GA4 runtime bundle in server.js.');
}
try{main();}catch(error){console.error(error.message);process.exitCode=1;}
