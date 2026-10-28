'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createService, LIMITS } = require('../integrations/monitoring/service.cjs');

function fixture(t) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'roas-monitoring-'));
  t.after(() => fs.rmSync(baseDir, { recursive: true, force: true }));
  const service = createService({ baseDir, today: () => '2026-10-29' });
  return { baseDir, service, file: path.join(baseDir, '.roas-data/daily-monitoring/state.json') };
}
const product = (id = 'naver-1', extra = {}) => ({ id, platform: 'naver', productId: id === 'naver-1' ? '13684236835' : id.replace(/\D/g, '') || '2', name: '백도씨 분유제조기', ...extra });
const status = expected => error => error.status === expected;

test('monitoring persists independently and preserves unknown metrics as null', t => {
  const { service, baseDir, file } = fixture(t);
  assert.deepEqual(service.state().snapshots, []);
  assert.equal(fs.existsSync(file), false);
  const saved = service.saveProduct({ revision: 0, product: product() });
  assert.equal(saved.revision, 1);
  assert.equal(saved.products[0].price, null);
  assert.equal(saved.products[0].reviews, null);
  assert.equal(saved.products[0].rating, null);
  assert.deepEqual(saved.snapshots, []);
  const reloaded = createService({ baseDir }).state();
  assert.deepEqual(reloaded, saved);
  assert.deepEqual(fs.readdirSync(path.join(baseDir, '.roas-data')), ['daily-monitoring']);
});

test('revisions are required, checked before writes, and do not lose concurrent changes', t => {
  const { service, file } = fixture(t);
  assert.throws(() => service.saveProduct({ product: product() }), status(400));
  service.saveProduct({ revision: 0, product: product() });
  const before = fs.readFileSync(file, 'utf8');
  assert.throws(() => service.saveProduct({ revision: 0, product: { id: 'naver-1', favorite: true } }), status(409));
  assert.throws(() => service.saveSettings({ revision: '1', settings: {} }), status(400));
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  const saved = service.saveProduct({ revision: 1, product: { id: 'naver-1', favorite: true } });
  assert.equal(saved.products[0].favorite, true);
  assert.equal(saved.products[0].name, product().name);
});

test('snapshot upsert merges supplied metrics and individual keywords without double counting', t => {
  const { service } = fixture(t);
  service.saveProduct({ revision: 0, product: product() });
  service.importData({ revision: 1, source: '셀하 원본', snapshots: [{ productId: 'naver-1', date: '2026-10-28', price: 399000, reviews: 145, sales: 0, keywords: [{ keyword: '분유제조기', rank: 2, groupRank: 1, searchVolume: 8450 }, { keyword: '육아용품', rank: 9 }] }] });
  const saved = service.importData({ revision: 2, snapshots: [{ platform: 'naver', productId: '13684236835', date: '2026-10-28', reviews: 146, keywords: [{ keyword: '분유제조기', adRank: 5 }, { keyword: '분유쉐이커', rank: null, status: 'outside' }] }] });
  assert.equal(saved.snapshots.length, 1);
  const day = saved.snapshots[0];
  assert.equal(day.price, 399000);
  assert.equal(day.reviews, 146);
  assert.equal(day.sales, 0);
  assert.equal(Object.hasOwn(day, 'salesAmount'), false);
  assert.equal(day.keywords.length, 3);
  assert.deepEqual(day.keywords.find(k => k.keyword === '분유제조기'), { keyword: '분유제조기', rank: 2, status: 'ranked', groupRank: 1, searchVolume: 8450, adRank: 5 });
  assert.equal(saved.products[0].keywords.length, 3);
  assert.equal(saved.products[0].keywords.find(k => k.keyword === '분유제조기').searchVolume, 8450);
});

test('pending, outside, missing, observed rank and zero are distinct states', t => {
  const { service } = fixture(t);
  service.saveProduct({ revision: 0, product: product() });
  const saved = service.importData({ revision: 1, snapshots: [{ productId: 'naver-1', date: '2026-10-29', shipping: 0, reviews: null, keywords: [{ keyword: '대기', rank: null, status: 'pending' }, { keyword: '범위밖', rank: null, status: 'outside' }, { keyword: '누락', rank: null, status: 'missing' }, { keyword: '관측', rank: 1, adCount: 0 }] }] });
  assert.deepEqual(saved.snapshots[0].keywords.map(k => k.status), ['pending', 'outside', 'missing', 'ranked']);
  assert.equal(saved.snapshots[0].shipping, 0);
  assert.equal(saved.snapshots[0].reviews, null);
  const next = service.importData({ revision: 2, snapshots: [{ productId: 'naver-1', date: '2026-10-29', keywords: [{ keyword: '관측', status: 'outside' }] }] });
  assert.equal(next.snapshots[0].keywords.find(k => k.keyword === '관측').rank, null);
  assert.throws(() => service.importData({ revision: 3, snapshots: [{ productId: 'naver-1', date: '2026-10-29', keywords: [{ keyword: '오류', rank: 0 }] }] }), status(400));
});

test('invalid import is transactional, including product and keyword registration', t => {
  const { service } = fixture(t);
  service.saveProduct({ revision: 0, product: product() });
  const before = service.state();
  assert.throws(() => service.importData({ revision: 1, products: [product('naver-2')], snapshots: [{ productId: 'naver-2', date: '2026-10-28', keywords: [{ keyword: '정상', rank: 1 }] }, { productId: 'naver-2', date: '2026-10-30', keywords: [{ keyword: '미래', rank: 2 }] }] }), status(400));
  assert.deepEqual(service.state(), before);
  assert.throws(() => service.importData({ revision: 1, snapshots: [{ productId: 'naver-1', date: '2026-02-30', keywords: [] }] }), status(400));
  assert.throws(() => service.importData({ revision: 1, snapshots: [{ productId: 'missing-product', date: '2026-10-28', keywords: [] }] }), status(404));
});

test('product identities cannot collide or be rewritten after observations', t => {
  const { service } = fixture(t);
  service.saveProduct({ revision: 0, product: product() });
  const byIdentity = service.saveProduct({ revision: 1, product: { platform: 'naver', productId: '13684236835', name: '수정된 상품명' } });
  assert.equal(byIdentity.products.length, 1);
  assert.equal(byIdentity.products[0].id, 'naver-1');
  assert.throws(() => service.saveProduct({ revision: 2, product: { id: 'naver-1', productId: '99' } }), status(400));
  assert.throws(() => service.saveProduct({ revision: 2, product: product('different-id', { productId: '13684236835' }) }), status(409));
  assert.throws(() => service.importData({ revision: 2, products: [product(), product()] }), status(400));
  assert.throws(() => service.importData({ revision: 2, snapshots: [{ productId: 'naver-1', date: '2026-10-28' }, { productId: 'naver-1', date: '2026-10-28' }] }), status(400));
});

test('folders, favorites, alert settings and active-only ordering survive archives', t => {
  const { service } = fixture(t);
  service.saveFolder({ revision: 0, folder: { id: 'we', name: '위마망' } });
  service.saveProduct({ revision: 1, product: product('naver-1', { folderId: 'we', favorite: true, alert: { enabled: true, threshold: 3 } }) });
  service.saveProduct({ revision: 2, product: product('naver-2') });
  service.saveProduct({ revision: 3, product: product('naver-3') });
  service.archiveProduct({ revision: 4, id: 'naver-2' });
  const saved = service.saveOrder({ revision: 5, ids: ['naver-3', 'naver-1'] });
  assert.deepEqual(saved.products.map(p => p.id), ['naver-3', 'naver-1', 'naver-2']);
  assert.equal(saved.products[2].archived, true);
  assert.equal(saved.products[1].folderId, 'we');
  assert.deepEqual(saved.products[1].alert, { enabled: true, threshold: 3 });
  assert.throws(() => service.saveOrder({ revision: 6, ids: ['naver-3', 'naver-3'] }), status(400));
  const restored = service.saveProduct({ revision: 6, product: { id: 'naver-2', archived: false } });
  assert.equal(restored.products[2].archived, false);
  assert.throws(() => service.saveFolder({ revision: 7, folder: { name: '위마망' } }), status(409));
});

test('only explicit valid public platform links and bounded real numbers are stored', t => {
  const { service } = fixture(t);
  for (const badUrl of ['javascript:alert(1)', 'https://user:pass@smartstore.naver.com/item', 'http://smartstore.naver.com/item', 'https://127.0.0.1/item', 'https://example.com/item']) {
    assert.throws(() => service.saveProduct({ revision: 0, product: product('naver-1', { url: badUrl }) }), status(400));
  }
  for (const badImage of ['file:///etc/passwd', 'https://localhost/item', 'https://169.254.169.254/item', 'https://private.internal/a', 'https://127.1/a']) {
    assert.throws(() => service.saveProduct({ revision: 0, product: product('naver-1', { imageUrl: badImage }) }), status(400));
  }
  for (const invalid of ['0', '', -1, Infinity]) assert.throws(() => service.saveProduct({ revision: 0, product: product('naver-1', { price: invalid }) }), status(400));
  assert.throws(() => service.saveProduct({ revision: 0, product: product('naver-1', { rating: 5.1 }) }), status(400));
  const saved = service.saveProduct({ revision: 0, product: product('naver-1', { url: 'https://smartstore.naver.com/wemamang/products/13684236835', imageUrl: 'https://shop-phinf.pstatic.net/example.png', price: 0 }) });
  assert.equal(saved.products[0].price, 0);
});

test('prototype pollution and oversized settings are rejected without any mutation', t => {
  const { service } = fixture(t);
  const dangerous = JSON.parse('{"revision":0,"settings":{"__proto__":{"polluted":true}}}');
  assert.throws(() => service.saveSettings(dangerous), status(400));
  assert.equal({}.polluted, undefined);
  assert.throws(() => service.saveSettings({ revision: 0, settings: Object.create({ inherited: true }) }), status(400));
  assert.throws(() => service.saveSettings({ revision: 0, settings: { value: 'x'.repeat(17000) } }), status(400));
  const saved = service.saveSettings({ revision: 0, settings: { expanded: true, orientation: 'vertical', rankOptions: { normal: true, group: true, ads: false, adCount: false } } });
  assert.equal(saved.settings.expanded, true);
  const merged = service.saveSettings({ revision: 1, settings: { keywordSort: 'volume' } });
  assert.equal(merged.settings.expanded, true);
  assert.equal(merged.settings.keywordSort, 'volume');
});

test('keyword and product quotas apply to registration and imported observations', t => {
  const { service } = fixture(t);
  service.saveProduct({ revision: 0, product: product() });
  const keys = Array.from({ length: LIMITS.keywords }, (_, i) => ({ keyword: '검색' + i, searchVolume: null }));
  service.saveKeywords({ revision: 1, id: 'naver-1', keywords: keys });
  assert.throws(() => service.importData({ revision: 2, snapshots: [{ productId: 'naver-1', date: '2026-10-28', keywords: [{ keyword: '한도초과', rank: 1 }] }] }), status(400));
  assert.equal(service.state().products[0].keywords.length, LIMITS.keywords);
  assert.throws(() => service.saveKeywords({ revision: 2, id: 'naver-1', keywords: [{ keyword: '중복' }, { keyword: '중복' }] }), status(400));
  const all = Array.from({ length: LIMITS.products }, (_, i) => product('p' + (i + 2)));
  assert.throws(() => service.importData({ revision: 2, products: all }), status(400));
  assert.equal(service.state().products.length, 1);
});

test('corrupt state is reported and never replaced with an empty store', t => {
  const { service, file } = fixture(t);
  service.saveProduct({ revision: 0, product: product() });
  fs.writeFileSync(file, '{"broken":true}');
  assert.throws(() => service.state(), status(500));
  assert.throws(() => service.saveProduct({ revision: 0, product: product() }), status(500));
  assert.equal(fs.readFileSync(file, 'utf8'), '{"broken":true}');
  assert.equal(fs.existsSync(file + '.lock'), false);
});

test('lock collision preserves stored history instead of competing writes', t => {
  const { service, file } = fixture(t);
  service.saveProduct({ revision: 0, product: product() });
  fs.writeFileSync(file + '.lock', 'another-writer');
  assert.throws(() => service.saveSettings({ revision: 1, settings: { expanded: true } }), status(409));
  assert.equal(service.state().revision, 1);
  assert.equal(fs.readFileSync(file + '.lock', 'utf8'), 'another-writer');
});

test('full-state imports restore folder-linked products and settings in one transaction', t => {
  const { service, baseDir } = fixture(t);
  service.saveFolder({ revision: 0, folder: { id: 'brand-folder', name: '위마망' } });
  service.saveProduct({ revision: 1, product: product('naver-1', { folderId: 'brand-folder' }) });
  service.saveSettings({ revision: 2, settings: { expanded: true, rankOptions: { normal: true, group: false } } });
  service.importData({ revision: 3, snapshots: [{ productId: 'naver-1', date: '2026-10-28', reviews: 145, keywords: [{ keyword: '분유제조기', rank: 2 }] }] });
  const backup = service.state(), restoredDir = path.join(baseDir, 'restore'), restoredService = createService({ baseDir: restoredDir, today: () => '2026-10-29' });
  const restored = restoredService.importData({ ...backup, revision: 0, source: '개인 백업 복원' });
  assert.equal(restored.revision, 1);
  assert.deepEqual(restored.folders, backup.folders);
  assert.deepEqual(restored.settings, backup.settings);
  assert.equal(restored.products[0].folderId, 'brand-folder');
  assert.equal(restored.snapshots[0].reviews, 145);
  const merged = restoredService.importData({ revision: 1, folders: [{ id: 'brand-folder', name: '위마망 모니터링' }, { id: 'camp', name: '트루버' }], settings: { keywordSort: 'volume' } });
  assert.equal(merged.folders.length, 2);
  assert.equal(merged.folders[0].name, '위마망 모니터링');
  assert.equal(merged.settings.expanded, true);
  assert.equal(merged.settings.keywordSort, 'volume');
});

test('invalid folder or settings roll back every part of a restored import', t => {
  const { service } = fixture(t);
  service.saveFolder({ revision: 0, folder: { id: 'existing', name: '기존 폴더' } });
  const before = service.state();
  assert.throws(() => service.importData({ revision: 1, folders: [{ id: 'imported', name: '가져온 폴더' }], settings: { expanded: true }, products: [product('naver-1', { folderId: 'not-restored' })] }), status(404));
  assert.deepEqual(service.state(), before);
  assert.throws(() => service.importData({ revision: 1, folders: [{ id: 'imported', name: '가져온 폴더' }, { id: 'bad', name: '' }], products: [product()] }), status(400));
  assert.deepEqual(service.state(), before);
  assert.throws(() => service.importData({ revision: 1, folders: [{ id: 'other', name: '기존 폴더' }], products: [product()] }), status(409));
  assert.deepEqual(service.state(), before);
  assert.throws(() => service.importData({ revision: 1, folders: [{ id: 'imported', name: '가져온 폴더' }], settings: { tooLarge: 'x'.repeat(17000) }, products: [product()] }), status(400));
  assert.deepEqual(service.state(), before);
});

test('each owned lock immediately records its PID and timestamp and is removed after commit', t => {
  const { service, file } = fixture(t), originalRename = fs.renameSync;
  let observed = false;
  fs.renameSync = function (from, to) {
    if (to === file) {
      const metadata = JSON.parse(fs.readFileSync(file + '.lock', 'utf8'));
      assert.equal(metadata.pid, process.pid);
      assert.ok(Number.isFinite(Date.parse(metadata.createdAt)));
      assert.ok(Math.abs(Date.now() - Date.parse(metadata.createdAt)) < 10000);
      assert.equal(typeof metadata.token, 'string');
      observed = true;
    }
    return originalRename.apply(this, arguments);
  };
  try { service.saveProduct({ revision: 0, product: product() }); }
  finally { fs.renameSync = originalRename; }
  assert.equal(observed, true);
  assert.equal(fs.existsSync(file + '.lock'), false);
});

test('a lock from a known exited process is reclaimed without losing saved products', t => {
  const { service, file } = fixture(t);
  service.saveProduct({ revision: 0, product: product() });
  const child = spawnSync(process.execPath, ['-e', 'process.exit(0)'], { encoding: 'utf8' });
  assert.equal(child.status, 0);
  assert.ok(child.pid > 0);
  assert.throws(() => process.kill(child.pid, 0), error => error.code === 'ESRCH');
  fs.writeFileSync(file + '.lock', JSON.stringify({ pid: child.pid, createdAt: new Date().toISOString() }));
  const saved = service.saveSettings({ revision: 1, settings: { expanded: true } });
  assert.equal(saved.revision, 2);
  assert.equal(saved.products[0].id, 'naver-1');
  assert.equal(saved.settings.expanded, true);
  assert.equal(fs.existsSync(file + '.lock'), false);
});

test('live and permission-protected lock owners are never reclaimed even when the lock is old', t => {
  const { service, file } = fixture(t);
  service.saveProduct({ revision: 0, product: product() });
  const lockFile = file + '.lock', old = new Date(Date.now() - 3600000);
  const live = JSON.stringify({ pid: process.pid, createdAt: old.toISOString() });
  fs.writeFileSync(lockFile, live); fs.utimesSync(lockFile, old, old);
  assert.throws(() => service.saveSettings({ revision: 1, settings: { expanded: true } }), status(409));
  assert.equal(fs.readFileSync(lockFile, 'utf8'), live);
  const protectedOwner = JSON.stringify({ pid: 2147483647, createdAt: old.toISOString() }), originalKill = process.kill;
  fs.writeFileSync(lockFile, protectedOwner); fs.utimesSync(lockFile, old, old);
  process.kill = function (pid, signal) {
    if (pid === 2147483647 && signal === 0) throw Object.assign(Error('Permission denied'), { code: 'EPERM' });
    return originalKill.apply(this, arguments);
  };
  try { assert.throws(() => service.saveSettings({ revision: 1, settings: { expanded: true } }), status(409)); }
  finally { process.kill = originalKill; }
  assert.equal(fs.readFileSync(lockFile, 'utf8'), protectedOwner);
  assert.equal(service.state().revision, 1);
});

test('empty or invalid legacy locks are reclaimed only after five minutes', t => {
  const { service, file } = fixture(t);
  service.saveProduct({ revision: 0, product: product() });
  let revision = 1;
  for (const legacy of ['', 'interrupted legacy lock']) {
    fs.writeFileSync(file + '.lock', legacy);
    assert.throws(() => service.saveSettings({ revision, settings: { expanded: true } }), status(409));
    assert.equal(fs.readFileSync(file + '.lock', 'utf8'), legacy);
    const old = new Date(Date.now() - 6 * 60 * 1000);
    fs.utimesSync(file + '.lock', old, old);
    const saved = service.saveSettings({ revision, settings: { expanded: true } });
    revision++;
    assert.equal(saved.revision, revision);
    assert.equal(saved.products[0].id, 'naver-1');
    assert.equal(fs.existsSync(file + '.lock'), false);
  }
});

test('stale-owner cleanup does not remove lock contents or inode replaced during inspection', t => {
  const { service, file } = fixture(t);
  service.saveProduct({ revision: 0, product: product() });
  const originalKill = process.kill, lockFile = file + '.lock';
  for (const replaceInode of [false, true]) {
    const deadPid = 2147483646, old = JSON.stringify({ pid: deadPid, createdAt: new Date().toISOString() });
    const replacement = JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString(), token: 'replacement-' + replaceInode });
    fs.writeFileSync(lockFile, old);
    process.kill = function (pid, signal) {
      if (pid === deadPid && signal === 0) {
        if (replaceInode) fs.unlinkSync(lockFile);
        fs.writeFileSync(lockFile, replacement);
        throw Object.assign(Error('Exited'), { code: 'ESRCH' });
      }
      return originalKill.apply(this, arguments);
    };
    try { assert.throws(() => service.saveSettings({ revision: 1, settings: { expanded: true } }), status(409)); }
    finally { process.kill = originalKill; }
    assert.equal(fs.readFileSync(lockFile, 'utf8'), replacement);
    assert.equal(service.state().revision, 1);
  }
});

test('only observed rank page, position and outside cutoff survive merges and stale rank states clear them', t => {
  const { service } = fixture(t);
  service.saveProduct({ revision: 0, product: product() });
  const imported = service.importData({ revision: 1, snapshots: [{ productId: 'naver-1', date: '2026-10-28', keywords: [{ keyword: '분유제조기', rank: 82, page: 3, position: 2 }] }] });
  assert.equal(imported.snapshots[0].keywords[0].page, 3);
  assert.equal(imported.snapshots[0].keywords[0].position, 2);
  assert.equal(Object.hasOwn(imported.snapshots[0].keywords[0], 'outsideLimit'), false);
  const merged = service.importData({ revision: 2, snapshots: [{ productId: 'naver-1', date: '2026-10-28', keywords: [{ keyword: '분유제조기', adRank: 4 }] }] });
  assert.equal(merged.snapshots[0].keywords[0].page, 3);
  assert.equal(merged.snapshots[0].keywords[0].position, 2);
  const outside = service.importData({ revision: 3, snapshots: [{ productId: 'naver-1', date: '2026-10-28', keywords: [{ keyword: '분유제조기', status: 'outside', outsideLimit: 80 }] }] });
  assert.equal(outside.snapshots[0].keywords[0].rank, null);
  assert.equal(outside.snapshots[0].keywords[0].page, null);
  assert.equal(outside.snapshots[0].keywords[0].position, null);
  assert.equal(outside.snapshots[0].keywords[0].outsideLimit, 80);
  const ranked = service.importData({ revision: 4, snapshots: [{ productId: 'naver-1', date: '2026-10-28', keywords: [{ keyword: '분유제조기', rank: 42 }] }] });
  assert.equal(ranked.snapshots[0].keywords[0].outsideLimit, null);
  assert.equal(ranked.snapshots[0].keywords[0].page, null, 'rank alone must never infer a page size');
  assert.equal(ranked.snapshots[0].keywords[0].position, null);
  assert.throws(() => service.importData({ revision: 5, snapshots: [{ productId: 'naver-1', date: '2026-10-28', keywords: [{ keyword: '분유제조기', page: 0 }] }] }), status(400));
  assert.throws(() => service.importData({ revision: 5, snapshots: [{ productId: 'naver-1', date: '2026-10-28', keywords: [{ keyword: '분유제조기', outsideLimit: 80 }] }] }), status(400));
  assert.throws(() => service.importData({ revision: 5, snapshots: [{ productId: 'naver-1', date: '2026-10-28', keywords: [{ keyword: '분유제조기', status: 'pending', page: 1 }] }] }), status(400));
});
