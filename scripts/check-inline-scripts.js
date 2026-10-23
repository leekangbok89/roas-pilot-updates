'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const publicDir = path.join(__dirname, '..', 'public');
let count = 0;
for (const file of fs.readdirSync(publicDir).filter(name => name.endsWith('.html'))) {
  const html = fs.readFileSync(path.join(publicDir, file), 'utf8');
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    const attrs = match[1];
    if (/\bsrc\s*=/i.test(attrs)) continue;
    const type = attrs.match(/\btype\s*=\s*["']([^"']+)["']/i)?.[1];
    if (type && !['text/javascript', 'application/javascript'].includes(type)) continue;
    const line = html.slice(0, match.index).split('\n').length;
    new vm.Script(match[2], {filename: `${file}:${line}`, lineOffset: line - 1});
    count++;
  }
}
console.log(`Validated ${count} inline JavaScript blocks.`);
