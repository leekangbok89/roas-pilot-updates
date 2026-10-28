'use strict';
const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..'), file = path.join(root, 'server.js');
const begin = '// BEGIN GENERATED COUPANG RUNTIME — run node scripts/bundle-coupang.cjs';
const end = '// END GENERATED COUPANG RUNTIME';
const source = fs.readFileSync(file, 'utf8'), start = source.indexOf(begin), finish = source.indexOf(end);
if (start < 0 || finish < start || source.indexOf(begin, start + begin.length) !== -1 || source.indexOf(end, finish + end.length) !== -1) throw Error('Expected one Coupang runtime block');
const client = fs.readFileSync(path.join(root, 'integrations/coupang/service.cjs'), 'utf8');
const assets = Object.fromEntries(['coupang.html', 'coupang.js', 'coupang.css', 'coupang-dashboard.html', 'coupang-sales.html', 'coupang-analytics.js', 'coupang-analytics.css', 'coupang-sheets.js', 'coupang-products.html', 'coupang-products.js', 'coupang-products.css', 'coupang-ads.html', 'coupang-ads.js', 'coupang-ads.css', 'coupang-thumbnails.js', 'coupang-thumbnails.css', 'coupang-product-names.js', 'coupang-ad-reports.js', 'coupang-collector.html', 'coupang-collector.js'].map(name => ['/' + name, fs.readFileSync(path.join(root, 'public', name), 'utf8')]));
function archive() {
  const folder=path.join(root,'browser-extensions/coupang-collector'),locals=[],central=[];let offset=0;
  const crc32=data=>{let crc=0xffffffff;for(const byte of data){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;};
  for(const name of fs.readdirSync(folder).sort()){
    if(!/^[a-z-]+\.(?:json|js|html|md)$/.test(name))continue;
    const data=fs.readFileSync(path.join(folder,name)),filename=Buffer.from(name),crc=crc32(data),local=Buffer.alloc(30),entry=Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50);local.writeUInt16LE(33,12);local.writeUInt16LE(20,4);local.writeUInt32LE(crc,14);local.writeUInt32LE(data.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(filename.length,26);
    entry.writeUInt32LE(0x02014b50);entry.writeUInt16LE(33,14);entry.writeUInt16LE(20,4);entry.writeUInt16LE(20,6);entry.writeUInt32LE(crc,16);entry.writeUInt32LE(data.length,20);entry.writeUInt32LE(data.length,24);entry.writeUInt16LE(filename.length,28);entry.writeUInt32LE(offset,42);
    locals.push(local,filename,data);central.push(entry,filename);offset+=local.length+filename.length+data.length;
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(central.length/2,8);end.writeUInt16LE(central.length/2,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...locals,directory,end]).toString('base64');
}
const output = source.slice(0, start) + begin + '\nconst bundledCoupang=(()=>{const module={exports:{}};\n' + client + '\nreturn module.exports;})();\nconst bundledCoupangAssets=Object.freeze(' + JSON.stringify(assets, null, 2) + ');\nconst bundledCoupangExtensionBase64='+JSON.stringify(archive())+';\n' + end + source.slice(finish + end.length);
if (process.argv.length > 3 || (process.argv[2] && process.argv[2] !== '--check')) throw Error('Usage: node scripts/bundle-coupang.cjs [--check]');
if (process.argv[2] === '--check') { if (output !== source) throw Error('Coupang runtime bundle is stale'); }
else if (output !== source) fs.writeFileSync(file, output);
console.log('Coupang runtime bundle verified.');
