'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),file=path.join(root,'server.js'),begin='// BEGIN GENERATED GFA RUNTIME — run node scripts/bundle-gfa.cjs',end='// END GENERATED GFA RUNTIME';
const source=fs.readFileSync(file,'utf8'),start=source.indexOf(begin),finish=source.indexOf(end);
if(start<0||finish<start)throw Error('Missing GFA runtime markers');
const wrap=text=>'(()=>{const module={exports:{}};\n'+text+'\nreturn module.exports;})();';
const assets=Object.fromEntries(['gfa-data.js','gfa-analysis.js'].map(name=>['/'+name,fs.readFileSync(path.join(root,'public',name),'utf8')]));
const block=begin+'\nconst bundledGfaData='+wrap(assets['/gfa-data.js'])+'\nconst bundledGfaService='+wrap(fs.readFileSync(path.join(root,'integrations/gfa/service.cjs'),'utf8'))+'\nconst bundledGfaAssets=Object.freeze('+JSON.stringify(assets,null,2)+');\n'+end;
const output=source.slice(0,start)+block+source.slice(finish+end.length);
if(process.argv.includes('--check')){if(output!==source)throw Error('GFA bundle is stale. Run node scripts/bundle-gfa.cjs');console.log('GFA runtime and assets match.');}else{if(output!==source)fs.writeFileSync(file,output);console.log('GFA runtime bundled.');}
