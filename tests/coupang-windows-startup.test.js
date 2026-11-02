'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { install, launcher } = require('../integrations/coupang/windows-startup.cjs');
function setup(t) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'roas-logon-'));
  t.after(() => fs.rmSync(baseDir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(baseDir, '.roas-private'));
  fs.writeFileSync(path.join(baseDir, '.roas-private', 'coupang.dpapi'), 'encrypted-test-placeholder');
  return baseDir;
}
test('login launcher quotes paths as data and restarts only an updater exit', () => {
  const text = launcher({ baseDir: "C:\\Users\\Lee's $data`(test)\\ROAS Pilot", execPath: 'C:\\Program Files\\nodejs\\node.exe', port: 3000, host: '127.0.0.1' });
  assert.ok(text.startsWith('\ufeff'));
  assert.ok(text.includes("Set-Location -LiteralPath 'C:\\Users\\Lee''s $data`(test)\\ROAS Pilot'"));
  assert.ok(text.includes("$node = 'C:\\Program Files\\nodejs\\node.exe'"));
  assert.ok(text.includes("$env:PORT = '3000'"));
  assert.ok(text.includes('$result = $LASTEXITCODE'));
  assert.ok(text.includes('while ($result -eq 42)'));
});
test('registration uses current-user Startup with hidden PowerShell and no credentials in the launcher', t => {
  const baseDir = setup(t), calls = [];
  const options = { baseDir, platform: 'win32', execPath: 'C:\\Node\\node.exe', env: { SystemRoot: 'C:\\Windows' }, run: (...args) => { calls.push(args); return { status: 0 }; } };
  assert.deepEqual(install(options), { enabled: true, status: 'registered', trigger: 'windows-logon' });
  const [binary, args, execution] = calls[0];
  assert.equal(binary, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.equal(args.at(-2), '-EncodedCommand');
  const command = Buffer.from(args.at(-1), 'base64').toString('utf16le');
  assert.ok(command.includes("[Environment]::GetFolderPath('Startup')"));
  assert.ok(command.includes("'ROAS Pilot.lnk'"));
  assert.ok(command.includes('-WindowStyle Hidden'));
  assert.ok(command.includes('launch.ps1'));
  assert.equal(execution.windowsHide, true);
  const file = path.join(baseDir, '.roas-updates', 'startup', 'launch.ps1'), before = fs.statSync(file).mtimeMs;
  assert.ok(!fs.readFileSync(file, 'utf8').includes('encrypted-test-placeholder'));
  install(options); assert.equal(fs.statSync(file).mtimeMs, before, 'identical launch scripts are not rewritten');
  assert.equal(fs.readFileSync(path.join(baseDir, '.roas-private', 'coupang.dpapi'), 'utf8'), 'encrypted-test-placeholder');
});
test('unsupported or unconfigured hosts make no changes; registration failures stay visible', t => {
  const baseDir = setup(t);
  const run = () => { throw Error('must not run'); };
  assert.equal(install({ baseDir, platform: 'linux', run }).status, 'unsupported');
  assert.equal(fs.existsSync(path.join(baseDir, '.roas-updates')), false);
  const failed = install({ baseDir, platform: 'win32', run: () => ({ status: 1 }) });
  assert.equal(failed.enabled, false); assert.equal(failed.status, 'failed'); assert.match(failed.error, /직접 실행/);
  fs.unlinkSync(path.join(baseDir, '.roas-private', 'coupang.dpapi'));
  assert.equal(install({ baseDir, platform: 'win32', run }).status, 'unconfigured');
});
