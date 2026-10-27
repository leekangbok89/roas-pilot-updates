'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = fs.readFileSync(path.resolve(__dirname, '../public/coupang.js'), 'utf8');
const html = fs.readFileSync(path.resolve(__dirname, '../public/coupang.html'), 'utf8');
const extract = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
class Element {
  constructor(tag = 'div') { this.tagName = tag; this.children = []; this.dataset = {}; this._text = ''; this.value = ''; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this._text = ''; this.children = children; }
}
function setup(configured = true, request = async () => ({})) {
  const ids = ['cp-access', 'cp-secret', 'cp-vendor', 'cp-connection', 'cp-identity', 'cp-key-storage', 'cp-diagnosis', 'cp-history-progress', 'cp-history-status', 'cp-history-detail', 'cp-resume', 'cp-pause'];
  const nodes = Object.fromEntries(ids.map(id => [id, new Element()])), messages = [];
  const context = { configured, historyRunning: false, $: id => nodes[id], channels: { growth: '로켓그로스', seller: '판매자배송', all: '전체' }, document: { createElement: tag => new Element(tag) }, request, message: text => messages.push(text) };
  vm.createContext(context);
  vm.runInContext(extract('  function renderHistory(h)', '  async function historyStatus(') + extract('  function renderConnection(v)', '  async function status()'), context);
  return { nodes, context, messages };
}
test('saved keys remain blank with explicit saved placeholders and independent diagnosis control', () => {
  const { nodes, context } = setup(); context.renderConnection({ configured: true, vendorId: 'A00012345' });
  for (const id of ['cp-access', 'cp-secret']) {
    assert.equal(nodes[id].value, ''); assert.equal(nodes[id].placeholder, '저장됨 · 변경할 때만 입력');
  }
  assert.match(nodes['cp-identity'].textContent, /키 저장됨/);
  assert.match(nodes['cp-key-storage'].textContent, /입력칸에 다시 표시하지 않습니다/);
  context.configured = false; context.renderConnection({ configured: false });
  assert.match(nodes['cp-access'].placeholder, /미등록/); assert.equal(nodes['cp-identity'].textContent, '미연결');
  const formStart = html.indexOf('<form id="cp-connect"'), formEnd = html.indexOf('</form>', formStart), button = html.indexOf('id="cp-diagnose"');
  assert.ok(button > formEnd && button < html.indexOf('</details>', formEnd));
  assert.match(html.slice(button - 30, button + 100), /type="button"/);
});
test('diagnosis renders channel status and remedies as literal text without secrets or injected markup', () => {
  const { nodes, context } = setup();
  context.renderDiagnosis({ keysReadable: true, date: '2026-10-26', checkedAt: '2026-10-27T05:00:00Z', ok: false, checks: [
    { channel: 'growth', ok: false, httpStatus: 403, label: '허용 IP 거절', message: '<img src=x onerror=alert(1)>', action: 'WING에서 현재 공인 IP를 확인하세요.' },
    { channel: 'seller', ok: true, httpStatus: 200, label: '정상 응답' }
  ] });
  const text = nodes['cp-diagnosis'].textContent;
  assert.match(text, /키 저장 확인 완료/); assert.match(text, /로켓그로스 · 진단 실패 · HTTP 403/);
  assert.match(text, /판매자배송 · 인증·접근 정상 · HTTP 200/); assert.match(text, /현재 공인 IP/);
  assert.match(text, /<img src=x/); assert.match(text, /진행률을 바꾸지 않습니다/);
  const tags = element => [element.tagName, ...element.children.flatMap(tags)];
  assert.ok(!tags(nodes['cp-diagnosis']).includes('img')); assert.equal(nodes['cp-access'].value, ''); assert.equal(nodes['cp-secret'].value, '');
});
test('failed history retains exact stopped range, HTTP diagnosis and saved progress after current is cleared', () => {
  const { nodes, context } = setup();
  context.renderHistory({ status: 'failed', running: false, completedDays: 358, totalDays: 730, skippedDays: 358, since: '2025-10-27', until: '2026-10-26', current: null,
    lastFailure: { channel: 'growth', since: '2026-10-19', until: '2026-10-25', diagnosis: { category: 'ip_not_allowed', httpStatus: 403, message: '허용 IP 거절', action: 'WING 허용 IP 확인' } }, error: '수집 중단' });
  assert.match(nodes['cp-history-status'].textContent, /358\/730/); assert.match(nodes['cp-history-detail'].textContent, /중단 구간: 로켓그로스 2026-10-19 ~ 2026-10-25/);
  assert.match(nodes['cp-history-detail'].textContent, /HTTP 403/); assert.match(nodes['cp-history-detail'].textContent, /허용 IP 거절/);
  assert.equal(nodes['cp-history-progress'].value, 358); assert.equal(nodes['cp-resume'].disabled, false); assert.equal(nodes['cp-pause'].disabled, true);
});
test('diagnosis action uses stored keys for both channels without reading key fields or starting collection', async () => {
  const calls = [], result = { keysReadable: true, date: '2026-10-26', checkedAt: '2026-10-27T05:00:00Z', ok: true, checks: [] };
  const { nodes, context, messages } = setup(true, async (route, body) => { calls.push({ route, body: { ...body } }); return result; });
  for (const id of ['cp-access', 'cp-secret']) Object.defineProperty(nodes[id], 'value', { get() { throw Error('Key field must not be read'); } });
  nodes['cp-history-status'].textContent = '수집 중단 · 358/730';
  await context.diagnoseConnection();
  assert.deepEqual(calls, [{ route: 'diagnose', body: { channel: 'all' } }]);
  assert.equal(nodes['cp-connection'].open, true); assert.equal(nodes['cp-history-status'].textContent, '수집 중단 · 358/730');
  assert.match(messages.at(-1), /두 배송 방식 모두 정상/);
});
