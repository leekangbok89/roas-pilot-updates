const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../public/coupang-analytics.js'), 'utf8');
function harness(handler = () => ({})) {
  const nodes = new Map(), calls = [];
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { textContent: '', dataset: {}, hidden: false, disabled: false, value: '', max: 1 });
    return nodes.get(id);
  };
  const window = { reloaded: 0 };
  const context = vm.createContext({ window, document: { body: { dataset: { coupangView: 'dashboard' } }, hidden: false, getElementById: node }, localStorage: { getItem: () => null }, URLSearchParams, Date, Map, Set, console,
    setTimeout: () => 1, clearTimeout: () => {},
    fetch: async (url, options) => {
      const call = { url, body: options?.body ? JSON.parse(options.body) : undefined }; calls.push(call);
      const value = await handler(call);
      return { ok: true, json: async () => value };
    }
  });
  const initialization = source.indexOf("  $('ca-query').addEventListener('submit'");
  assert.ok(initialization > 0);
  vm.runInContext(source.slice(0, initialization) + "\nload = async () => { window.reloaded++; }; schedulePipeline = () => {}; window.controls = { renderPipeline, historyAction, loadPipelineStatus };\n})();", context);
  return { nodes, node, calls, window, ...window.controls };
}

test('failed historical collection shows partial progress and HTTP diagnosis without claiming completion', () => {
  const ui = harness();
  ui.renderPipeline({ configured: true, automatic: {}, history: { status: 'failed', running: false, since: '2025-10-29', until: '2026-10-28', totalDays: 730, completedDays: 100,
    error: '허용 IP·연동업체 설정 거절', lastFailure: { channel: 'growth', since: '2026-01-01', until: '2026-01-07', diagnosis: { httpStatus: 403, message: '쿠팡 인증 실패', action: 'WING 허용 IP를 확인하세요.' } } } });
  assert.match(ui.node('ca-history-state').textContent, /수집 중단.*100\/730/);
  assert.doesNotMatch(ui.node('ca-history-state').textContent, /전체 수집 완료/);
  assert.match(ui.node('ca-history-error').textContent, /HTTP 403/);
  assert.match(ui.node('ca-history-error').textContent, /WING 허용 IP/);
  assert.equal(ui.node('ca-history-progress').value, 100);
  assert.equal(ui.node('ca-history-resume').disabled, false);
  assert.equal(ui.node('ca-history-pause').disabled, true);
});

test('maximum button sends one bulk request, locks competing collection and preserves query dates', async () => {
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  const job = { id: 'bulk', status: 'running', running: true, totalDays: 730, completedDays: 0 };
  const status = { configured: true, busy: true, automatic: {}, history: job };
  const ui = harness(async call => call.url.endsWith('/history') ? waiting : status);
  ui.node('ca-since').value = '2026-08-30'; ui.node('ca-until').value = '2026-10-28';
  ui.renderPipeline({ configured: true, automatic: {}, history: { status: 'idle' } });
  const first = ui.historyAction('maximum');
  await ui.historyAction('maximum');
  assert.equal(ui.calls.length, 1);
  assert.deepEqual(ui.calls[0].body, { mode: 'maximum' });
  assert.equal(ui.node('ca-refresh-orders').disabled, true);
  assert.equal(ui.node('ca-history-start').disabled, true);
  release(job); await first;
  assert.equal(ui.node('ca-since').value, '2026-08-30');
  assert.equal(ui.node('ca-until').value, '2026-10-28');
  assert.equal(ui.node('ca-history-pause').disabled, false);
  assert.match(ui.node('ca-auto-state').textContent, /과거 주문 수집/);
});

test('resume and pause use persisted job endpoints', async () => {
  let job = { id: 'bulk', status: 'paused', running: false, totalDays: 730, completedDays: 20 };
  const ui = harness(call => {
    if (call.url.endsWith('/history')) job = { ...job, status: 'running', running: true };
    if (call.url.endsWith('/history-pause')) job = { ...job, pauseRequested: true };
    return call.url.endsWith('/status') ? { configured: true, busy: job.running, automatic: {}, history: job } : job;
  });
  ui.renderPipeline({ configured: true, automatic: {}, history: job });
  await ui.historyAction('resume');
  assert.deepEqual(ui.calls.find(call => call.url.endsWith('/history')).body, { resume: true });
  await ui.historyAction('pause');
  assert.deepEqual(ui.calls.find(call => call.url.endsWith('/history-pause')).body, {});
  assert.equal(ui.node('ca-history-pause').disabled, true);
  assert.match(ui.node('ca-history-detail').textContent, /현재 구간 저장 후 중지/);
});

test('newly saved historical blocks and completion reload the current saved-data report', async () => {
  let job = { id: 'bulk', status: 'running', running: true, totalDays: 730, completedDays: 7 };
  const ui = harness(() => ({ configured: true, busy: job.running, automatic: {}, history: job }));
  await ui.loadPipelineStatus();
  assert.equal(ui.window.reloaded, 0);
  job = { ...job, completedDays: 14 };
  await ui.loadPipelineStatus();
  assert.equal(ui.window.reloaded, 1);
  job = { ...job, status: 'completed', running: false, completedDays: 730 };
  await ui.loadPipelineStatus();
  assert.equal(ui.window.reloaded, 2);
  assert.match(ui.node('ca-history-state').textContent, /전체 수집 완료.*730\/730/);
});
