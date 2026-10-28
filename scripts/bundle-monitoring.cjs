'use strict';
const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..'), file = path.join(root, 'server.js');
const begin = '// BEGIN GENERATED MONITORING — run node scripts/bundle-monitoring.cjs';
const end = '// END GENERATED MONITORING';
const source = fs.readFileSync(file, 'utf8'), start = source.indexOf(begin), finish = source.indexOf(end);
if (start < 0 || finish < start || source.indexOf(begin, start + begin.length) !== -1 || source.indexOf(end, finish + end.length) !== -1) throw Error('Expected one monitoring runtime block');
const service = fs.readFileSync(path.join(root, 'integrations/monitoring/service.cjs'), 'utf8');
const assets = Object.fromEntries(['daily-monitoring.html', 'daily-monitoring.js', 'daily-monitoring.css', 'monitoring-import.js'].map(name => ['/' + name, fs.readFileSync(path.join(root, 'public', name), 'utf8')]));
const block = begin + '\nconst bundledMonitoring=(()=>{const module={exports:{}};\n' + service + '\nreturn module.exports;})();\nconst bundledMonitoringAssets=Object.freeze(' + JSON.stringify(assets, null, 2) + ');\n' + end;
const output = source.slice(0, start) + block + source.slice(finish + end.length);
if (process.argv.length > 3 || process.argv[2] && process.argv[2] !== '--check') throw Error('Usage: node scripts/bundle-monitoring.cjs [--check]');
if (process.argv[2] === '--check') { if (output !== source) throw Error('Monitoring runtime bundle is stale'); }
else if (output !== source) fs.writeFileSync(file, output);
console.log('Monitoring runtime bundle verified.');
