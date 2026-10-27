'use strict';
const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..'), file = path.join(root, 'server.js');
const begin = '// BEGIN GENERATED COUPANG RUNTIME — run node scripts/bundle-coupang.cjs';
const end = '// END GENERATED COUPANG RUNTIME';
const source = fs.readFileSync(file, 'utf8'), start = source.indexOf(begin), finish = source.indexOf(end);
if (start < 0 || finish < start || source.indexOf(begin, start + begin.length) !== -1 || source.indexOf(end, finish + end.length) !== -1) throw Error('Expected one Coupang runtime block');
const client = fs.readFileSync(path.join(root, 'integrations/coupang/service.cjs'), 'utf8');
const assets = Object.fromEntries(['coupang.html', 'coupang.js', 'coupang.css', 'coupang-dashboard.html', 'coupang-sales.html', 'coupang-analytics.js', 'coupang-analytics.css', 'coupang-sheets.js', 'coupang-products.html', 'coupang-products.js', 'coupang-products.css', 'coupang-ads.html', 'coupang-ads.js', 'coupang-ads.css', 'coupang-thumbnails.js', 'coupang-thumbnails.css'].map(name => ['/' + name, fs.readFileSync(path.join(root, 'public', name), 'utf8')]));
const output = source.slice(0, start) + begin + '\nconst bundledCoupang=(()=>{const module={exports:{}};\n' + client + '\nreturn module.exports;})();\nconst bundledCoupangAssets=Object.freeze(' + JSON.stringify(assets, null, 2) + ');\n' + end + source.slice(finish + end.length);
if (process.argv.length > 3 || (process.argv[2] && process.argv[2] !== '--check')) throw Error('Usage: node scripts/bundle-coupang.cjs [--check]');
if (process.argv[2] === '--check') { if (output !== source) throw Error('Coupang runtime bundle is stale'); }
else if (output !== source) fs.writeFileSync(file, output);
console.log('Coupang runtime bundle verified.');
