'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { safeThumbnailUrl } = require('../integrations/coupang/service.cjs');

test('representative thumbnails accept only Coupang image CDN URLs and normalize HTTPS', () => {
  for (const [input, expected] of [
    ['https://image1.coupangcdn.com/image/vendor_inventory/example/product.jpg', 'https://image1.coupangcdn.com/image/vendor_inventory/example/product.jpg'],
    ['http://image11.coupangcdn.com/image/vendor_inventory/example/product.png', 'https://image11.coupangcdn.com/image/vendor_inventory/example/product.png'],
    ['https://image23.coupangcdn.com/image/retail/example/product.webp', 'https://image23.coupangcdn.com/image/retail/example/product.webp'],
    ['vendor_inventory/example/product.jpeg', 'https://image1.coupangcdn.com/image/vendor_inventory/example/product.jpeg']
  ]) assert.equal(safeThumbnailUrl(input), expected, input);
});

test('thumbnail URLs cannot point at arbitrary hosts, credentials, ports or URL parameters', () => {
  for (const input of [
    'https://example.invalid/image/product.jpg',
    'https://127.0.0.1/image/product.jpg',
    'https://[::1]/image/product.jpg',
    'https://image1.coupangcdn.com.evil.invalid/image/product.jpg',
    'https://evil.image1.coupangcdn.com/image/product.jpg',
    'https://image1-coupangcdn.com/image/product.jpg',
    'https://image.coupangcdn.com/image/product.jpg',
    'https://image1.coupangcdn.com@evil.invalid/image/product.jpg',
    'https://user:secret@image1.coupangcdn.com/image/product.jpg',
    'https://image1.coupangcdn.com:8443/image/product.jpg',
    'https://image1.coupangcdn.com:443/image/product.jpg',
    'http://image1.coupangcdn.com:80/image/product.jpg',
    'https://image1.coupangcdn.com/image/product.jpg?redirect=https://example.invalid',
    'https://image1.coupangcdn.com/image/product.jpg#fragment',
    '//image1.coupangcdn.com/image/product.jpg',
    'javascript:alert(1)',
    'data:image/png;base64,AAAA'
  ]) assert.equal(safeThumbnailUrl(input), null, input);
});

test('thumbnail paths reject literal, encoded and double-encoded traversal before URL normalization', () => {
  for (const input of [
    'https://image1.coupangcdn.com/image/a/../product.jpg',
    'https://image1.coupangcdn.com/image/a/./product.jpg',
    'https://image1.coupangcdn.com/image/%2e%2e/product.jpg',
    'https://image1.coupangcdn.com/image/%252e%252e/product.jpg',
    'https://image1.coupangcdn.com/image/a%2f..%2fproduct.jpg',
    'https://image1.coupangcdn.com/image/a%252f..%252fproduct.jpg',
    'https://image1.coupangcdn.com/image/a%5c..%5cproduct.jpg',
    'https://image1.coupangcdn.com/image/a\\..\\product.jpg',
    'https://image1.coupangcdn.com/elsewhere/product.jpg',
    'vendor_inventory/a/../product.jpg',
    'vendor_inventory/%2e%2e/product.jpg',
    '../vendor_inventory/product.jpg',
    '/vendor_inventory/product.jpg',
    'retail/product.jpg'
  ]) assert.equal(safeThumbnailUrl(input), null, input);
});

test('thumbnail URL validation rejects unsupported content, oversized values and control characters', () => {
  for (const input of [
    null, undefined, 123, {}, [], '',
    'https://image1.coupangcdn.com/image/product.svg',
    'https://image1.coupangcdn.com/image/product.html',
    'https://image1.coupangcdn.com/image/product.jpg.exe',
    'https://image1.coupangcdn.com/image/product.jpg\n',
    'https://image1.coupangcdn.com/image/pro\u0000duct.jpg',
    'https://image1.coupangcdn.com/image/pro\tduct.jpg',
    'vendor_inventory/' + 'x'.repeat(2048) + '.jpg'
  ]) assert.equal(safeThumbnailUrl(input), null, typeof input === 'string' ? input.slice(0, 120) : String(input));
});
