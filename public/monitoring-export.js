(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MonitoringExport = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const MAX_ROWS = 1048576, MAX_COLUMNS = 16384, MAX_CELLS = 2000000, MAX_BYTES = 64 * 1024 * 1024;
  const encoder = new TextEncoder();
  const crcTable = Uint32Array.from({length:256}, (_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
    return value >>> 0;
  });
  const fail = message => { throw Error(message); };
  function xml(value) {
    let result = '';
    for (const character of String(value)) {
      const code = character.codePointAt(0);
      if (!(code === 9 || code === 10 || code === 13 || code >= 0x20 && code <= 0xd7ff || code >= 0xe000 && code <= 0xfffd || code >= 0x10000 && code <= 0x10ffff)) continue;
      result += character === '&' ? '&amp;' : character === '<' ? '&lt;' : character === '>' ? '&gt;' : character === '"' ? '&quot;' : character === "'" ? '&apos;' : character;
    }
    return result;
  }
  function column(index) {
    let label = '';
    for (let value = index + 1; value; value = Math.floor((value - 1) / 26)) label = String.fromCharCode(65 + (value - 1) % 26) + label;
    return label;
  }
  function cell(value, address, header) {
    const style = header ? 1 : 2;
    if (value == null || value === '') return '<c r="' + address + '" s="' + style + '"/>';
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) fail('엑셀에 내보낼 숫자가 올바르지 않습니다: ' + address);
      // Integers outside JavaScript's exact range must be supplied as strings.
      if (Number.isInteger(value) && !Number.isSafeInteger(value)) fail('긴 상품 번호는 문자로 내보내야 합니다: ' + address);
      return '<c r="' + address + '" s="' + style + '"><v>' + value + '</v></c>';
    }
    if (typeof value === 'boolean') return '<c r="' + address + '" s="' + style + '" t="b"><v>' + (value ? 1 : 0) + '</v></c>';
    if (typeof value !== 'string') fail('엑셀 셀에는 문자 또는 숫자를 넣으세요: ' + address);
    if (value.length > 32767) fail('엑셀 한 셀의 문자는 32,767자 이하여야 합니다: ' + address);
    // inlineStr always writes literal text, including leading =, +, -, and @.
    return '<c r="' + address + '" s="' + style + '" t="inlineStr"><is><t xml:space="preserve">' + xml(value) + '</t></is></c>';
  }
  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }
  function zip(files) {
    const locals = [], directory = []; let offset = 0;
    const set16 = (bytes, index, value) => new DataView(bytes.buffer).setUint16(index, value, true);
    const set32 = (bytes, index, value) => new DataView(bytes.buffer).setUint32(index, value, true);
    for (const [name, content] of files) {
      const filename = encoder.encode(name), bytes = encoder.encode(content), checksum = crc32(bytes);
      if (bytes.length > MAX_BYTES || offset + bytes.length > MAX_BYTES) fail('엑셀 자료가 64MiB를 넘습니다. 기간을 나누어 내보내세요.');
      const local = new Uint8Array(30), central = new Uint8Array(46);
      set32(local, 0, 0x04034b50); set16(local, 4, 20); set16(local, 6, 0x0800); set16(local, 8, 0);
      set16(local, 12, 33); set32(local, 14, checksum); set32(local, 18, bytes.length); set32(local, 22, bytes.length); set16(local, 26, filename.length);
      set32(central, 0, 0x02014b50); set16(central, 4, 20); set16(central, 6, 20); set16(central, 8, 0x0800); set16(central, 10, 0);
      set16(central, 14, 33); set32(central, 16, checksum); set32(central, 20, bytes.length); set32(central, 24, bytes.length); set16(central, 28, filename.length); set32(central, 42, offset);
      locals.push(local, filename, bytes); directory.push(central, filename); offset += local.length + filename.length + bytes.length;
    }
    const directorySize = directory.reduce((sum, bytes) => sum + bytes.length, 0), end = new Uint8Array(22), count = files.length;
    set32(end, 0, 0x06054b50); set16(end, 8, count); set16(end, 10, count); set32(end, 12, directorySize); set32(end, 16, offset);
    const total = offset + directorySize + end.length;
    if (total > MAX_BYTES) fail('엑셀 자료가 64MiB를 넘습니다. 기간을 나누어 내보내세요.');
    const result = new Uint8Array(total); let at = 0;
    for (const bytes of [...locals, ...directory, end]) { result.set(bytes, at); at += bytes.length; }
    return result;
  }
  function buildWorkbook(headers, rows, sheetName) {
    if (!Array.isArray(headers) || !headers.length || headers.length > MAX_COLUMNS || !Array.isArray(rows) || rows.length + 1 > MAX_ROWS) fail('엑셀 행·열 수를 확인하세요.');
    if ((rows.length + 1) * headers.length > MAX_CELLS) fail('엑셀 자료는 2,000,000개 셀 이하로 나누어 내보내세요.');
    const name = String(sheetName || '일간 모니터링').replace(/[\\/*?:\[\]\u0000-\u001f]/g, ' ').replace(/^'+|'+$/g, '').trim().slice(0,31) || '일간 모니터링';
    const lastCell = column(headers.length - 1) + (rows.length + 1);
    const widths = headers.map((value, index) => {
      const samples = [value, ...rows.slice(0, 100).map(row => Array.isArray(row) ? row[index] : '')];
      const width = Math.max(...samples.map(v => Math.max(...String(v ?? '').split(/\r?\n/).map(line => Array.from(line).reduce((size, c) => size + (c.codePointAt(0) > 255 ? 2 : 1),0))))) + 3;
      return '<col min="' + (index+1) + '" max="' + (index+1) + '" width="' + Math.min(58, Math.max(12, width)) + '" customWidth="1"/>';
    }).join('');
    const sheetRows = ['<row r="1" ht="25" customHeight="1">' + headers.map((v,i) => cell(String(v ?? ''),column(i)+'1',true)).join('') + '</row>'];
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index]; if (!Array.isArray(row) || row.length > headers.length) fail('엑셀 행의 열 수를 확인하세요: ' + (index+2));
      sheetRows.push('<row r="' + (index+2) + '">' + headers.map((_,i) => cell(row[i],column(i)+(index+2),false)).join('') + '</row>');
    }
    const declaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
    const worksheet = declaration + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:' + lastCell + '"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols>' + widths + '</cols><sheetData>' + sheetRows.join('') + '</sheetData><autoFilter ref="A1:' + lastCell + '"/></worksheet>';
    const styles = declaration + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="맑은 고딕"/></font><font><b/><sz val="11"/><name val="맑은 고딕"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF1BA"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
    return zip([
      ['[Content_Types].xml',declaration+'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'],
      ['_rels/.rels',declaration+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
      ['xl/workbook.xml',declaration+'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets><sheet name="'+xml(name)+'" sheetId="1" r:id="rId1"/></sheets></workbook>'],
      ['xl/_rels/workbook.xml.rels',declaration+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
      ['xl/styles.xml',styles], ['xl/worksheets/sheet1.xml',worksheet]
    ]);
  }
  function download(headers, rows, name, sheetName) {
    const bytes = buildWorkbook(headers,rows,sheetName);
    if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') fail('엑셀 다운로드는 브라우저 화면에서 사용하세요.');
    const blob = new Blob([bytes],{type:MIME}), url = URL.createObjectURL(blob), anchor = document.createElement('a');
    anchor.href = url; anchor.download = String(name || '일간모니터링.xlsx').replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_').replace(/(?:\.xlsx)?$/i,'.xlsx');
    anchor.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
    return { bytes:bytes.length, rows:rows.length };
  }
  return Object.freeze({buildWorkbook,download,MIME,limits:Object.freeze({rows:MAX_ROWS,columns:MAX_COLUMNS,cells:MAX_CELLS,bytes:MAX_BYTES})});
});
