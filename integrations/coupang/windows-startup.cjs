'use strict';
const fs = require('node:fs'), path = require('node:path');
const { spawnSync } = require('node:child_process');
const literal = value => "'" + String(value).replace(/'/g, "''") + "'";

// Run under the same signed-in Windows account as the DPAPI-protected API key.
// No administrator rights, credentials, or external scheduler are needed.
function launcher({ baseDir, execPath, port, host }) {
  return '\ufeff' + [
    "$ErrorActionPreference = 'Stop'",
    'Start-Sleep -Seconds 15',
    'Set-Location -LiteralPath ' + literal(baseDir),
    '$env:PORT = ' + literal(port),
    '$env:HOST = ' + literal(host),
    '$node = ' + literal(execPath),
    '$server = ' + literal(path.win32.join(baseDir, 'server.js')),
    // An existing listener exits on EADDRINUSE without disturbing the live app.
    // Updater exit 42 restarts the new server; normal exits stay stopped.
    'do {',
    '  & $node $server',
    '  $result = $LASTEXITCODE',
    '  if ($result -eq 42) { Start-Sleep -Seconds 2 }',
    '} while ($result -eq 42)',
    ''
  ].join('\r\n');
}
function install({ baseDir, execPath = process.execPath, platform = process.platform, env = process.env,
  port = 3000, host = '127.0.0.1', run = spawnSync } = {}) {
  if (platform !== 'win32') return { enabled: false, status: 'unsupported' };
  if (!fs.existsSync(path.join(baseDir, '.roas-private', 'coupang.dpapi'))) return { enabled: false, status: 'unconfigured' };
  try {
    const folder = path.join(baseDir, '.roas-updates', 'startup'), script = path.join(folder, 'launch.ps1');
    fs.mkdirSync(folder, { recursive: true });
    const content = launcher({ baseDir, execPath, port, host });
    if (!fs.existsSync(script) || fs.readFileSync(script, 'utf8') !== content) fs.writeFileSync(script, content, 'utf8');
    const powershell = path.win32.join(env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const args = '-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + script + '"';
    const command = [
      "$ErrorActionPreference = 'Stop'",
      "$startup = [Environment]::GetFolderPath('Startup')",
      "if (-not $startup) { throw 'Startup folder unavailable' }",
      "$shell = New-Object -ComObject WScript.Shell",
      "$link = $shell.CreateShortcut((Join-Path $startup 'ROAS Pilot.lnk'))",
      '$link.TargetPath = ' + literal(powershell),
      '$link.Arguments = ' + literal(args),
      '$link.WorkingDirectory = ' + literal(baseDir),
      "$link.Description = 'ROAS Pilot - recent 7 day verification'",
      '$link.WindowStyle = 7',
      '$link.Save()'
    ].join('\r\n');
    const result = run(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], { timeout: 15000, windowsHide: true });
    if (result.error || result.status !== 0) throw Error('shortcut-registration-failed');
    return { enabled: true, status: 'registered', trigger: 'windows-logon' };
  } catch {
    return { enabled: false, status: 'failed', error: 'Windows 자동 실행 등록에 실패했습니다. 프로그램을 직접 실행하면 최근 7일을 자동 확인합니다.' };
  }
}
module.exports = { install, launcher };
