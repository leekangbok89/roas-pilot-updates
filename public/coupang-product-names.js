(function () {
  'use strict';
  const text = value => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  function fullName(item) { return text(item?.fullName) || text(item?.productName) || text(item?.name) || String(item?.productId || item?.itemId || '상품명 미등록'); }
  function shortTitle(item) {
    const supplied = text(item?.displayName);
    if (supplied) { const points = Array.from(supplied); return points.length > 22 ? points.slice(0, 21).join('') + '…' : supplied; }
    let source = text(item?.productName) || fullName(item);
    const option = text(item?.optionName);
    if (!text(item?.displayName) && option && source.endsWith(option)) source = source.slice(0, -option.length).replace(/[\s·|,/\-]+$/, '');
    source = source.split(/\s*[·|]\s*/)[0].trim() || fullName(item);
    const words = source.split(' '), modifiers = /^(?:캠핑|휴대용|가정용|야외용|접이식|차박|야외)$/;
    let chosen = words.slice(0, modifiers.test(words[1] || '') ? 3 : 2);
    if (chosen.length > 2) chosen = chosen.filter((word, index) => !index || !modifiers.test(word));
    const next = words[chosen.length];
    if (chosen.length === 2 && /^(?:[A-Za-z]+[-_]?)?\d[\w.-]*$/i.test(next || '') && !/^\d+(?:cm|mm|ml|l|인치|인용|개)$/i.test(next) && !chosen.includes(next)) chosen.push(next);
    const title = chosen.join(' ') || source, points = Array.from(title);
    return points.length > 22 ? points.slice(0, 21).join('') + '…' : title;
  }
  function groupLabel(rows) {
    const values = Array.isArray(rows) ? rows : [];
    if (!values.length) return '상품명 미등록';
    const names = [...new Set(values.map(row => text(row.displayName)).filter(Boolean))];
    return shortTitle({ ...values[0], displayName: names.length === 1 ? names[0] : undefined });
  }
  const api = Object.freeze({ fullName, shortTitle, groupLabel });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.CoupangProductNames = api;
})();
