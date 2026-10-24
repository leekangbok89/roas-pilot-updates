'use strict';
// Legacy versions may copy server.js without the new public/meta-experiments.html file.
// Keep a generated HTML fallback embedded in server.js.
const fs=require('node:fs');
const path=require('node:path');
const project=path.resolve(__dirname,'..');
const serverFile=path.join(project,'server.js');
const begin='// BEGIN GENERATED EXPERIMENT PAGE — run node scripts/bundle-experiments.cjs';
const end='// END GENERATED EXPERIMENT PAGE';
function main(){
 const args=process.argv.slice(2);
 if(args.length>1||(args.length===1&&args[0]!=='--check'))throw Error('Usage: node scripts/bundle-experiments.cjs [--check]');
 const source=fs.readFileSync(serverFile,'utf8');
 const start=source.indexOf(begin),finish=source.indexOf(end);
 if(start<0||finish<start||source.indexOf(begin,start+begin.length)>=0||source.indexOf(end,finish+end.length)>=0)throw Error('Expected exactly one experiment page marker block in server.js');
 const assets={'/meta-experiments.html':fs.readFileSync(path.join(project,'public','meta-experiments.html'),'utf8')};
 const block=begin+'\nconst bundledExperimentAssets=Object.freeze('+JSON.stringify(assets,null,2)+');\n'+end;
 const output=source.slice(0,start)+block+source.slice(finish+end.length);
 if(args[0]==='--check'){
  if(output!==source)throw Error('Experiment HTML fallback is stale. Run node scripts/bundle-experiments.cjs.');
  console.log('Experiment HTML fallback matches public/meta-experiments.html.');
  return;
 }
 if(output!==source)fs.writeFileSync(serverFile,output);
 console.log(output===source?'Experiment HTML fallback already current.':'Updated experiment HTML fallback in server.js.');
}
try{main();}catch(e){console.error(e.message);process.exitCode=1;}
