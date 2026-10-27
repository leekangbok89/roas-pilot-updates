/* Read Sellha exports locally. No spreadsheet bytes leave this browser. */
(function () {
  'use strict';
  const MAX_FILE = 8 * 1024 * 1024, MAX_XML = 20 * 1024 * 1024, MAX_TOTAL = 40 * 1024 * 1024;
  const MAX_SHEETS = 20, MAX_ROWS = 10000, MAX_COLUMNS = 256, MAX_CELLS = 250000;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const text = value => String(value ?? '').trim();
  const cleanHeader = value => text(value).replace(/\s/g, '');
  function error(message) { return Error(message); }
  function xml(source) {
    if (/<!(?:DOCTYPE|ENTITY)\b/i.test(source)) throw error('외부 문서 선언이 있는 엑셀은 읽을 수 없습니다. .xlsx로 다시 저장하세요.');
    const doc = new DOMParser().parseFromString(source, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw error('엑셀 내부 XML이 손상되었습니다. .xlsx로 다시 저장하세요.');
    return doc;
  }
  const elements = (node, tag) => [...node.getElementsByTagNameNS('*', tag)];
  const child = (node, tag) => [...node.children].find(el => el.localName === tag);
  const stringValue = node => elements(node, 't').map(el => el.textContent).join('');
  function ensureDate(value, label) {
    const s = text(value), d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + 'T00:00:00Z') : null;
    if (!d || !Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== s) throw error(label + ' 날짜가 올바르지 않습니다.');
    return s;
  }
  const allowedFile = name => /^xl\/(?:workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|styles\.xml|worksheets\/[^/]+\.xml)$/.test(name);
  async function unzip(buffer) {
    const bytes = new Uint8Array(buffer), view = new DataView(buffer);
    if (bytes.length < 22) throw error('엑셀 압축 구조를 읽지 못했습니다. .xlsx 파일을 선택하세요.');
    let end = -1;
    for (let p = bytes.length - 22; p >= Math.max(0, bytes.length - 65557); p--) {
      if (view.getUint32(p, true) === 0x06054b50 && p + 22 + view.getUint16(p + 20, true) === bytes.length) { end = p; break; }
    }
    if (end < 0 || view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) throw error('지원하지 않는 엑셀 압축 구조입니다. .xlsx로 다시 저장하세요.');
    const count = view.getUint16(end + 10, true), directorySize = view.getUint32(end + 12, true);
    let offset = view.getUint32(end + 16, true), total = 0;
    if (!count || count > 2000 || count !== view.getUint16(end + 8, true) || offset + directorySize > end) throw error('엑셀 항목 수·압축 구조가 올바르지 않습니다.');
    const files = new Map(), names = new Set();
    for (let i = 0; i < count; i++) {
      if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) throw error('엑셀 압축 목록이 손상되었습니다.');
      const flags = view.getUint16(offset + 8, true), method = view.getUint16(offset + 10, true);
      const compressed = view.getUint32(offset + 20, true), expanded = view.getUint32(offset + 24, true);
      const nameLength = view.getUint16(offset + 28, true), extra = view.getUint16(offset + 30, true), comment = view.getUint16(offset + 32, true);
      const local = view.getUint32(offset + 42, true), next = offset + 46 + nameLength + extra + comment;
      if (next > end || compressed === 0xffffffff || expanded === 0xffffffff || local === 0xffffffff) throw error('지원하지 않는 대용량 엑셀 구조입니다.');
      const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength)); offset = next;
      if (!allowedFile(name)) continue;
      if (names.has(name)) throw error('엑셀 내부 항목이 중복되었습니다. .xlsx로 다시 저장하세요.');
      names.add(name); total += expanded;
      if (expanded > MAX_XML || total > MAX_TOTAL) throw error('엑셀 내용이 너무 큽니다. 일별 파일로 나누어 내려받으세요.');
      if (flags & 1) throw error('암호로 보호된 엑셀은 읽을 수 없습니다. 암호를 해제한 파일을 선택하세요.');
      if (local + 30 > bytes.length || view.getUint32(local, true) !== 0x04034b50 || view.getUint16(local + 8, true) !== method) throw error('엑셀 내부 파일이 손상되었습니다.');
      const localNameLength = view.getUint16(local + 26, true), start = local + 30 + localNameLength + view.getUint16(local + 28, true);
      if (start + compressed > bytes.length || decoder.decode(bytes.subarray(local + 30, local + 30 + localNameLength)) !== name) throw error('엑셀 내부 파일 길이가 올바르지 않습니다.');
      let data = bytes.subarray(start, start + compressed);
      if (method === 8) {
        if (typeof DecompressionStream === 'undefined') throw error('이 브라우저는 엑셀 압축 해제를 지원하지 않습니다. 최신 Chrome 또는 Edge를 사용하세요.');
        const reader = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader(), chunks = [];
        let length = 0;
        try {
          while (true) {
            const part = await reader.read(); if (part.done) break;
            length += part.value.length;
            if (length > expanded || length > MAX_XML) { await reader.cancel(); throw error('엑셀 압축 해제 크기가 올바르지 않습니다.'); }
            chunks.push(part.value);
          }
        } catch (e) { throw error(/엑셀/.test(e.message) ? e.message : '엑셀 압축을 해제하지 못했습니다. .xlsx로 다시 저장하세요.'); }
        if (length !== expanded) throw error('엑셀 압축 내용이 완전하지 않습니다.');
        data = new Uint8Array(length); let at = 0;
        for (const chunk of chunks) { data.set(chunk, at); at += chunk.length; }
      } else if (method !== 0 || compressed !== expanded) throw error('지원하지 않는 엑셀 압축 방식입니다.');
      try { files.set(name, decoder.decode(data)); } catch { throw error('엑셀 문자를 읽을 수 없습니다. .xlsx로 다시 저장하세요.'); }
    }
    return files;
  }
  function sheetPath(target) {
    const pieces = (target.startsWith('/') ? target.slice(1) : 'xl/' + target).split('/'), resolved = [];
    for (const part of pieces) { if (part === '..') resolved.pop(); else if (part && part !== '.') resolved.push(part); }
    const path = resolved.join('/');
    if (!/^xl\/worksheets\/[^/]+\.xml$/.test(path)) throw error('엑셀 시트 연결이 올바르지 않습니다.');
    return path;
  }
  async function readGrids(file) {
    if (!file || typeof file.arrayBuffer !== 'function') throw error('엑셀 파일을 선택하세요.');
    if (file.size > MAX_FILE) throw error('엑셀 파일은 8MB 이하로 넣으세요.');
    const buffer = await file.arrayBuffer();
    if (buffer.byteLength > MAX_FILE) throw error('엑셀 파일은 8MB 이하로 넣으세요.');
    const files = await unzip(buffer);
    if (!files.has('xl/workbook.xml') || !files.has('xl/_rels/workbook.xml.rels')) throw error('표준 .xlsx 엑셀 파일이 필요합니다.');
    const workbook = xml(files.get('xl/workbook.xml')), rels = new Map();
    for (const rel of elements(xml(files.get('xl/_rels/workbook.xml.rels')), 'Relationship')) {
      if (rel.getAttribute('TargetMode') !== 'External' && /\/worksheet$/.test(rel.getAttribute('Type') || '')) rels.set(rel.getAttribute('Id'), sheetPath(rel.getAttribute('Target') || ''));
    }
    const sheets = elements(workbook, 'sheet');
    if (!sheets.length || sheets.length > MAX_SHEETS) throw error('엑셀 시트는 1~20개여야 합니다.');
    const shared = files.has('xl/sharedStrings.xml') ? elements(xml(files.get('xl/sharedStrings.xml')), 'si').map(stringValue) : [];
    if (shared.length > MAX_CELLS) throw error('엑셀 문자열이 너무 많습니다. 파일을 나누어 내려받으세요.');
    const dateFormats = new Set([14,15,16,17,18,19,20,21,22,27,28,29,30,31,32,33,34,35,36,45,46,47,50,51,52,53,54,55,56,57,58]);
    let dateStyles = [];
    if (files.has('xl/styles.xml')) {
      const styles = xml(files.get('xl/styles.xml'));
      for (const format of elements(styles, 'numFmt')) {
        const pattern = (format.getAttribute('formatCode') || '').replace(/"[^"]*"|\[[^\]]*\]|\\./g, '');
        if (/[yd]/i.test(pattern)) dateFormats.add(Number(format.getAttribute('numFmtId')));
      }
      const xfs = elements(styles, 'cellXfs')[0];
      if (xfs) dateStyles = [...xfs.children].map(x => dateFormats.has(Number(x.getAttribute('numFmtId'))));
    }
    const date1904 = ['true', '1'].includes(elements(workbook, 'workbookPr')[0]?.getAttribute('date1904'));
    let cellCount = 0;
    const grids = [];
    for (const sheet of sheets) {
      const relation = sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || sheet.getAttribute('r:id');
      const path = rels.get(relation);
      if (!path || !files.has(path)) throw error('엑셀 시트 자료를 찾지 못했습니다. .xlsx로 다시 저장하세요.');
      const doc = xml(files.get(path)), sourceRows = elements(doc, 'row'), grid = [], rowNumbers = [];
      if (sourceRows.length > MAX_ROWS) throw error('엑셀 시트의 행이 너무 많습니다. 일별 자료로 나누어 내려받으세요.');
      for (let rowIndex = 0; rowIndex < sourceRows.length; rowIndex++) {
        const row = sourceRows[rowIndex], values = [], seen = new Set(), rowNumber = Number(row.getAttribute('r')) || rowIndex + 1;
        for (const cell of [...row.children].filter(el => el.localName === 'c')) {
          const match = /^([A-Z]+)(\d+)$/.exec(cell.getAttribute('r') || '');
          if (!match || Number(match[2]) !== rowNumber) throw error('엑셀 셀 주소가 올바르지 않습니다.');
          let index = 0; for (const letter of match[1]) index = index * 26 + letter.charCodeAt(0) - 64;
          if (index > MAX_COLUMNS || seen.has(index) || ++cellCount > MAX_CELLS) throw error('엑셀 셀 수·열 주소가 올바르지 않습니다.');
          seen.add(index);
          const type = cell.getAttribute('t'), raw = child(cell, 'v')?.textContent ?? '';
          let result = type === 'inlineStr' ? stringValue(cell) : raw;
          if (type === 's') {
            if (!/^\d+$/.test(raw) || !Object.prototype.hasOwnProperty.call(shared, Number(raw))) throw error('엑셀 문자열 연결이 손상되었습니다.');
            result = shared[Number(raw)];
          } else if ((type === null || type === 'n') && raw !== '' && dateStyles[Number(cell.getAttribute('s') || 0)]) {
            const serial = Number(raw);
            if (!Number.isFinite(serial) || serial < 0 || serial > 2958465) throw error('엑셀 날짜 값이 올바르지 않습니다.');
            result = new Date((date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30)) + Math.floor(serial) * 86400000).toISOString().slice(0, 10);
          }
          values[index - 1] = result;
        }
        grid.push(values); rowNumbers.push(rowNumber);
      }
      Object.defineProperties(grid, { name: { value: sheet.getAttribute('name') || '' }, rowNumbers: { value: rowNumbers } });
      grids.push(grid);
    }
    return grids;
  }
  function table(grids, required, kind) {
    const matches = [];
    for (const grid of grids) for (let i = 0; i < Math.min(grid.length, 30); i++) {
      const headers = grid[i].map(cleanHeader);
      if (required.every(name => headers.includes(cleanHeader(name)))) { matches.push({ grid, start: i, headers }); break; }
    }
    if (matches.length !== 1) throw error(matches.length ? kind + ' 표가 여러 시트에 있습니다. 해당 표만 남겨 다시 저장하세요.' : kind + '에 필요한 열(' + required.join('·') + ')이 없습니다.');
    const result = matches[0], seen = new Set();
    for (const header of result.headers.filter(Boolean)) { if (seen.has(header)) throw error('중복 열 이름이 있습니다: ' + header); seen.add(header); }
    return result;
  }
  function cellReader(headers, row, physicalRow) {
    const index = key => headers.indexOf(cleanHeader(key)), value = key => row[index(key)];
    function number(key, required, options = {}) {
      const raw = text(value(key));
      if (raw === '') { if (required) throw error(physicalRow + '행 ' + key + ' 값이 비어 있습니다.'); return null; }
      const cleaned = raw.replace(/,/g, '').replace(options.percent ? /%$/ : /\u0000/g, '');
      const n = /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(cleaned) ? Number(cleaned) : NaN;
      if (!Number.isFinite(n) || Math.abs(n) > 1e12 || options.nonNegative && n < 0 || options.integer && !Number.isInteger(n)) throw error(physicalRow + '행 ' + key + ' 숫자를 확인하세요.');
      return n;
    }
    function identifier(key, required = true) {
      const id = text(value(key));
      if (!id && !required) return null;
      if (!/^[1-9]\d{0,19}$/.test(id)) throw error(physicalRow + '행 ' + key + '는 숫자 ID 전체를 문자로 저장해야 합니다.');
      return id;
    }
    function channel() {
      const raw = text(value('구분')).replace(/\s/g, '');
      if (raw === '로켓그로스') return 'growth';
      if (raw === '판매자배송') return 'seller';
      throw error(physicalRow + '행 구분은 로켓그로스 또는 판매자배송이어야 합니다.');
    }
    return { value, number, identifier, channel, has: key => index(key) >= 0 };
  }
  function reportDate(fileName, sheetName) {
    const ranges = [];
    for (const source of [fileName, sheetName]) {
      const matches = [...String(source || '').matchAll(/(\d{4}-\d{2}-\d{2})\s*[~～–—]\s*(\d{4}-\d{2}-\d{2})/g)];
      for (const match of matches) {
        const since = ensureDate(match[1], '보고서 시작'), until = ensureDate(match[2], '보고서 종료');
        if (since !== until) throw error('여러 날짜를 합산한 손익 파일은 일별로 나눌 수 없습니다. 셀하에서 시작일과 종료일을 같은 날짜로 선택해 내려받으세요.');
        ranges.push(since);
      }
    }
    if (!ranges.length) throw error('파일명 또는 시트명에서 손익 조회 날짜를 찾지 못했습니다. 셀하 원본 파일명(손익 결과(YYYY-MM-DD~YYYY-MM-DD))을 유지하세요.');
    if (new Set(ranges).size !== 1) throw error('파일명과 시트명의 조회 날짜가 다릅니다. 셀하 원본 파일을 다시 내려받으세요.');
    return ranges[0];
  }
  async function parseSales(file) {
    const grids = await readGrids(file), found = table(grids, ['상품ID','옵션ID','구분','상품명','판매량','이익금','광고 집행비'], '손익 결과');
    const { grid, start, headers } = found, rows = [], seen = new Set();
    if (!headers.includes(cleanHeader('할인 후 매출')) && !headers.includes(cleanHeader('매출'))) throw error('손익 결과에 매출 또는 할인 후 매출 열이 없습니다.');
    const date = reportDate(file.name, grid.name);
    for (let i = start + 1; i < grid.length; i++) {
      const r = cellReader(headers, grid[i], grid.rowNumbers[i]);
      if (!text(r.value('옵션ID'))) continue; // Product subtotals duplicate the option-level figures.
      const itemId = r.identifier('옵션ID'), channel = r.channel(), key = channel + ':' + itemId;
      if (seen.has(key)) throw error(grid.rowNumbers[i] + '행 옵션ID·배송 방식이 중복됩니다. 상품 합계 행이 아닌 옵션별 원본 자료가 필요합니다.');
      seen.add(key);
      const name = text(r.value('상품명'));
      if (!name || name.length > 300) throw error(grid.rowNumbers[i] + '행 상품명을 확인하세요.');
      rows.push({ productId: r.identifier('상품ID'), itemId, channel, name, optionName: text(r.value('옵션명')).slice(0, 300),
        // Sellha exports refunds as negative sales and quantities. Keep those
        // signed values so returned options reduce the daily/product totals.
        quantity: r.number('판매량', true, { integer: true }),
        adQuantity: r.number('광고 판매량', false, { integer: true }),
        organicQuantity: r.number('일반 판매량', false, { integer: true }),
        sales: r.has('할인 후 매출') ? r.number('할인 후 매출', true) : r.number('매출', true),
        profitBeforeAds: r.number('이익금', true), advertising: r.number('광고 집행비', true, { nonNegative: true }),
        adSales: r.number('광고 집행 매출', false), adProfitBeforeAds: r.number('광고 집행 이익금', false) });
    }
    if (!rows.length) throw error('손익 결과에 옵션별 자료가 없습니다. 옵션ID가 포함된 엑셀을 내려받으세요.');
    if (rows.length > 2000) throw error('손익 결과는 한 번에 2,000개 옵션까지 저장할 수 있습니다.');
    return { date, rows };
  }
  async function parseCatalog(file) {
    const grids = await readGrids(file), { grid, start, headers } = table(grids, ['옵션ID','구분','상품명','원가','마켓 수수료','입출고 요금','배송비'], '상품현황');
    const products = [], seen = new Set();
    for (let i = start + 1; i < grid.length; i++) {
      const r = cellReader(headers, grid[i], grid.rowNumbers[i]);
      if (!text(r.value('옵션ID'))) continue;
      const itemId = r.identifier('옵션ID');
      if (seen.has(itemId)) throw error(grid.rowNumbers[i] + '행 옵션ID가 중복됩니다.');
      seen.add(itemId);
      const productName = text(r.value('상품명')), optionName = text(r.value('옵션명')), name = [productName, optionName].filter(Boolean).join(' · ');
      if (!productName || name.length > 300) throw error(grid.rowNumbers[i] + '행 상품명·옵션명을 확인하세요.');
      const commissionRate = r.number('마켓 수수료', true, { nonNegative: true, percent: true });
      if (commissionRate > 100) throw error(grid.rowNumbers[i] + '행 마켓 수수료는 0~100%여야 합니다.');
      const rawDate = text(r.value('기준일자(원가)'));
      products.push({ productId: r.identifier('상품ID', false), itemId, name, productName, optionName,
        channel: r.channel(), salePrice: r.number('판매가', false, { nonNegative: true }),
        unitCost: r.number('원가', true, { nonNegative: true }), commissionRate,
        inboundFee: r.number('입출고 요금', true, { nonNegative: true }), deliveryFee: r.number('배송비', true, { nonNegative: true }),
        costSince: rawDate ? ensureDate(rawDate, grid.rowNumbers[i] + '행 원가 기준일') : null });
    }
    if (!products.length) throw error('상품현황에 옵션ID가 있는 자료가 없습니다.');
    if (products.length > 500) throw error('상품현황은 한 번에 500개 옵션까지 저장할 수 있습니다.');
    return { products };
  }
  window.CoupangSheets = Object.freeze({ readGrids, parseSales, parseCatalog });
})();
