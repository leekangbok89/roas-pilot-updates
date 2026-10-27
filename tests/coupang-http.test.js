'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { spawnSync } = require('node:child_process');

test('real HTTP POST starts a background Coupang job, GET observes saved progress, and POST resumes it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coupang-http-start-'));
  try {
    fs.copyFileSync(path.resolve(__dirname, '../server.js'), path.join(dir, 'server.js'));
    // Exercise the production router and embedded service with disposable keys.
    // Only OS encryption and external networking are replaced in this isolated child.
    const script = String.raw`
      const assert = require('node:assert/strict');
      const fs = require('node:fs'), path = require('node:path');
      const cp = require('node:child_process'), http = require('node:http');
      cp.spawnSync = (command, args, options) => {
        assert.equal(command, 'powershell.exe');
        const ps = Buffer.from(args.at(-1), 'base64').toString('utf16le');
        const stdout = ps.includes('::Unprotect') ? Buffer.from(options.input, 'base64').toString('utf8') : Buffer.from(options.input).toString('base64');
        return { status: 0, stdout };
      };
      Object.defineProperty(process, 'platform', { value: 'win32' });
      let fail = true, calls = 0;
      global.fetch = async url => {
        assert.ok(String(url).startsWith('https://api-gateway.coupang.com/'));
        calls++;
        return fail ? { ok: false, status: 403 } : { ok: true, json: async () => ({ code: 200, data: [] }) };
      };
      const app = require('./server');
      (async () => {
        await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
        try {
          const headers = { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000', 'content-type': 'application/json', 'x-roas-local-action': 'yes' };
          const req = (route, body, requestHeaders = headers) => new Promise((resolve, reject) => {
            const request = http.request({ hostname: '127.0.0.1', port: app.server.address().port, path: '/api/coupang/' + route, method: body === undefined ? 'GET' : 'POST', headers: requestHeaders }, response => {
              const chunks = []; response.on('data', chunk => chunks.push(chunk));
              response.on('end', () => { try { resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); } catch (error) { reject(error); } });
            });
            request.on('error', reject); request.end(body === undefined ? undefined : JSON.stringify(body));
          });
          const unconnected = await req('history', { since: '2026-10-01', until: '2026-10-07', channels: ['growth'] });
          assert.equal(unconnected.status, 409, 'POST history must reach credential validation, not the GET-only 405 guard');
          assert.equal((await req('credentials', { vendorId: 'A00012345', accessKey: 'SYNTHETIC-ACCESS', secretKey: 'SYNTHETIC-SECRET' })).status, 200);
          assert.equal((await req('history')).body.status, 'idle');
          const start = await req('history', { since: '2026-10-01', until: '2026-10-07', channels: ['growth'] });
          assert.equal(start.status, 200, 'the UI start request must register a real background task');
          assert.equal(start.body.status, 'running'); assert.equal(start.body.totalDays, 7);
          let state;
          for (let i = 0; i < 50; i++) { state = (await req('history')).body; if (state.status === 'failed') break; await new Promise(r => setTimeout(r, 20)); }
          assert.equal(state.status, 'failed'); assert.equal(state.completedDays, 0);
          assert.match(state.error, /인증/); assert.ok(calls > 0);
          const job = JSON.parse(fs.readFileSync(path.join('.roas-data', 'coupang', 'A00012345', 'history.json')));
          assert.equal(job.status, 'failed'); assert.equal(job.channels[0], 'growth');
          fail = false;
          const resumed = await req('history', { resume: true }); assert.equal(resumed.status, 200); assert.equal(resumed.body.status, 'running');
          for (let i = 0; i < 100; i++) { state = (await req('history')).body; if (state.status === 'completed') break; await new Promise(r => setTimeout(r, 25)); }
          assert.equal(state.status, 'completed'); assert.equal(state.completedDays, 7);
          assert.equal(fs.readdirSync(path.join('.roas-data', 'coupang', 'A00012345', 'orders')).length, 7);
          assert.equal((await req('status', {})).status, 405, 'read-only routes must still reject POST');
          assert.equal((await req('report', {})).status, 405);
          const blocked = await req('history', {}, { ...headers, origin: 'https://evil.invalid' });
          assert.equal(blocked.status, 403);
          const noAction = await req('history', {}, { host: '127.0.0.1:3000', 'content-type': 'application/json' });
          assert.equal(noAction.status, 403);
          console.log('PASS real start/resume HTTP route and persisted job transitions idle -> running -> failed -> running -> completed');
        } finally { app.server.closeAllConnections(); await new Promise(resolve => app.server.close(resolve)); }
      })().catch(error => { console.error(error); process.exitCode = 1; });
    `;
    const result = spawnSync(process.execPath, ['-e', script], { cwd: dir, env: { ...process.env, WEB_PASSWORD: '' }, encoding: 'utf8', timeout: 20000 });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
