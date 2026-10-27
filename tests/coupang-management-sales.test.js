'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = fs.readFileSync(path.resolve(__dirname, '../public/coupang.js'), 'utf8');
const start = source.indexOf('  function render() {'), end = source.indexOf('  async function loadReport()', start);
function render(rows) {
  const node = () => ({ children: [], textContent: '', append(...items) { this.children.push(...items); }, replaceChildren(...items) { this.children = items; }, addEventListener() {} });
  const nodes = Object.fromEntries(['cp-summary', 'cp-daily', 'cp-note', 'cp-missing'].map(id => [id, node()]));
  nodes['cp-channel'] = { value: 'all' };
  const context = { $: id => nodes[id], document: { createElement: node }, activeRows: () => rows, channels: { growth: '로켓그로스', seller: '판매자배송' },
    won: value => Number.isFinite(value) ? value.toLocaleString('ko-KR') + '원' : '—', rowText: node, edit() {},
    report: { summaries: { all: { netSales: null, profit: null, complete: false, completeDays: 0, totalDays: rows.length } }, note: '자료 확인 필요' } };
  vm.runInNewContext(source.slice(start, end) + '\nrender();', context);
  return nodes;
}
test('management sales card preserves collected API revenue while other dates and delivery modes are missing', () => {
  const nodes = render([{ date: '2026-10-25', channel: 'growth', gross: 20000, quantity: 2 }, { date: '2026-10-25', channel: 'seller', gross: null, quantity: null }]);
  const cards = nodes['cp-summary'].children;
  assert.equal(cards[0].children[1].textContent, '20,000원');
  assert.match(cards[0].children[0].textContent, /수집분/);
  assert.equal(cards[2].children[1].textContent, '—');
  assert.match(nodes['cp-missing'].textContent, /1\/2일·배송방식/);
});
test('management card distinguishes collected zero from entirely uncollected API data', () => {
  let nodes = render([{ channel: 'growth', gross: null }]);
  assert.equal(nodes['cp-summary'].children[0].children[1].textContent, '—');
  nodes = render([{ channel: 'growth', gross: 0 }, { channel: 'seller', gross: null }]);
  assert.equal(nodes['cp-summary'].children[0].children[1].textContent, '0원');
});
