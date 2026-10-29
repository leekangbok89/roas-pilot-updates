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
  assert.equal(saved.products[1].alert.enabled, true);
  assert.equal(saved.products[1].alert.threshold, 3);
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

test('manual metric edits update today without changing history or manufacturing observations for metadata saves', t => {
  const { service } = fixture(t);
  let state = service.saveProduct({ revision: 0, product: product() });
  state = service.importData({ revision: state.revision, snapshots: [{ productId: 'naver-1', date: '2026-10-28', price: 399000, shipping: 2500, reviews: 145, rating: 4.9 }] });
  const yesterday = structuredClone(state.snapshots[0]);
  state = service.saveProduct({ revision: state.revision, product: { id: 'naver-1', price: 398000, shipping: 0, reviews: 146, rating: 5 } });
  const current = state.snapshots.find(day => day.date === '2026-10-29');
  assert.ok(current);
  assert.equal(current.source, 'manual');
  assert.equal(current.price, 398000);
  assert.equal(current.shipping, 0);
  assert.equal(current.reviews, 146);
  assert.equal(current.rating, 5);
  assert.deepEqual(state.snapshots.find(day => day.date === '2026-10-28'), yesterday);
  const beforeMetadata = structuredClone(state.snapshots);
  state = service.saveProduct({ revision: state.revision, product: { ...state.products[0], favorite: true, name: '백도씨 상품명 수정' } });
  assert.deepEqual(state.snapshots, beforeMetadata);
  state = service.saveProduct({ revision: state.revision, product: { id: 'naver-1', price: 0, rating: null } });
  assert.equal(state.snapshots.find(day => day.date === '2026-10-29').price, 0);
  assert.equal(state.snapshots.find(day => day.date === '2026-10-29').rating, null);
});

test('current search volume follows newest dated explicit observation regardless of import order', t => {
  const { service } = fixture(t);
  let state = service.saveProduct({ revision: 0, product: product() });
  state = service.importData({ revision: state.revision, snapshots: [
    { productId: 'naver-1', date: '2026-10-29', keywords: [{ keyword: '분유제조기', rank: 1, searchVolume: 8450 }, { keyword: '분유포트', rank: 2 }] },
    { productId: 'naver-1', date: '2026-10-28', keywords: [{ keyword: '분유제조기', rank: 2, searchVolume: 9000 }, { keyword: '분유포트', rank: 3, searchVolume: 700 }] }
  ] });
  const volume = key => state.products[0].keywords.find(item => item.keyword === key).searchVolume;
  assert.equal(volume('분유제조기'), 8450);
  assert.equal(volume('분유포트'), 700);
  state = service.importData({ revision: state.revision, snapshots: [{ productId: 'naver-1', date: '2026-10-20', keywords: [{ keyword: '분유제조기', rank: 4, searchVolume: 12000 }] }] });
  assert.equal(volume('분유제조기'), 8450);
  state = service.importData({ revision: state.revision, snapshots: [{ productId: 'naver-1', date: '2026-10-29', keywords: [{ keyword: '분유제조기', searchVolume: 0 }] }] });
  assert.equal(volume('분유제조기'), 0);
  state = service.importData({ revision: state.revision, snapshots: [{ productId: 'naver-1', date: '2026-10-29', keywords: [{ keyword: '분유제조기', searchVolume: null }] }] });
  assert.equal(volume('분유제조기'), null);
});

test('rolling seven day purchases remain distinct from observed daily sales', t => {
  const { service } = fixture(t);
  let state = service.saveProduct({ revision: 0, product: product() });
  state = service.importData({ revision: state.revision, snapshots: [
    { productId: 'naver-1', date: '2026-10-28', sales: 3 },
    { productId: 'naver-1', date: '2026-10-29', rollingSales7d: 77 }
  ] });
  assert.equal(state.snapshots.find(day => day.date === '2026-10-29').rollingSales7d, 77);
  assert.equal(Object.hasOwn(state.snapshots.find(day => day.date === '2026-10-29'), 'sales'), false);
  assert.equal(state.snapshots.find(day => day.date === '2026-10-28').sales, 3);
  state = service.importData({ revision: state.revision, snapshots: [{ productId: 'naver-1', date: '2026-10-29', rollingSales7d: 0 }] });
  assert.equal(state.snapshots.find(day => day.date === '2026-10-29').rollingSales7d, 0);
  state = service.importData({ revision: state.revision, snapshots: [{ productId: 'naver-1', date: '2026-10-29', rollingSales7d: null }] });
  assert.equal(state.snapshots.find(day => day.date === '2026-10-29').rollingSales7d, null);
  assert.throws(() => service.importData({ revision: state.revision, snapshots: [{ productId: 'naver-1', date: '2026-10-29', rollingSales7d: -1 }] }), status(400));
});

const review = (id = 'review-1', extra = {}) => ({ id, productId: 'naver-1', date: '2026-10-29', rating: 5, text: '세척이 편하고 사용하기 좋습니다.', authorMasked: '김**', ...extra });

test('review records upsert by product and review ID, persist, and do not become aggregate review counts', t => {
  const { service, baseDir } = fixture(t);
  let state = service.saveProduct({ revision: 0, product: product() });
  state = service.importData({ revision: state.revision, reviews: [review('review-1', { title: '사용 후기', option: '기본 구성', sourceUrl: 'https://smartstore.naver.com/wemamang/products/13684236835' })] });
  assert.equal(state.reviews.length, 1);
  assert.equal(state.reviews[0].authorMasked, '김**');
  assert.equal(state.products[0].reviews, null, 'one imported review cannot stand in for total review count');
  state = service.importData({ revision: state.revision, reviews: [review('review-1', { rating: 4, text: '수정된 사용 후기' })] });
  assert.equal(state.reviews.length, 1);
  assert.equal(state.reviews[0].rating, 4);
  assert.equal(state.reviews[0].text, '수정된 사용 후기');
  state = service.saveProduct({ revision: state.revision, product: product('naver-2') });
  state = service.importData({ revision: state.revision, reviews: [review('review-1', { productId: 'naver-2', authorMasked: '' })] });
  assert.equal(state.reviews.length, 2, 'review identities belong to each product');
  assert.deepEqual(createService({ baseDir }).state().reviews, state.reviews);
});

test('invalid or unmasked review data rolls back the entire import', t => {
  const { service } = fixture(t);
  service.saveProduct({ revision: 0, product: product() });
  const before = service.state();
  for (const invalid of [review('bad', { authorMasked: '김실명' }), review('bad', { rating: 0 }), review('bad', { date: '2026-10-30' }), review('bad', { sourceUrl: 'https://example.com/unrelated' }), review('bad', { imageUrls: ['javascript:alert(1)'] })]) {
    assert.throws(() => service.importData({ revision: before.revision, products: [product('naver-2')], reviews: [review('valid'), invalid] }), error => [400,404].includes(error.status));
    assert.deepEqual(service.state(), before);
  }
});

test('rank alerts need an existing adjacent day baseline and threshold crossing, and repeated imports deduplicate', t => {
  const { service } = fixture(t);
  let state = service.saveProduct({ revision: 0, product: product('naver-1', { alert: { enabled: true, threshold: 10, keywords: ['분유제조기'], reviewEnabled: false } }) });
  state = service.importData({ revision: state.revision, snapshots: [{ productId: 'naver-1', date: '2026-10-28', keywords: [{ keyword: '분유제조기', rank: 12 }, { keyword: '분유포트', rank: 15 }] }] });
  assert.deepEqual(state.alerts, []);
  state = service.importData({ revision: state.revision, snapshots: [{ productId: 'naver-1', date: '2026-10-29', keywords: [{ keyword: '분유제조기', rank: 9 }, { keyword: '분유포트', rank: 3 }] }] });
  assert.equal(state.alerts.length, 1);
  const alert = state.alerts[0];
  assert.equal(alert.kind, 'rank');
  assert.equal(alert.productId, 'naver-1');
  assert.equal(alert.keyword, '분유제조기');
  assert.equal(alert.oldRank, 12);
  assert.equal(alert.rank, 9);
  assert.equal(alert.date, '2026-10-29');
  assert.equal(alert.readAt, null);
  assert.equal(typeof alert.id, 'string');
  assert.ok(Number.isFinite(Date.parse(alert.createdAt)));
  state = service.importData({ revision: state.revision, snapshots: [{ productId: 'naver-1', date: '2026-10-29', keywords: [{ keyword: '분유제조기', rank: 9 }] }] });
  assert.equal(state.alerts.length, 1);
  assert.equal(state.alerts[0].id, alert.id);
  state = service.importData({ revision: state.revision, snapshots: [{ productId: 'naver-1', date: '2026-10-25', keywords: [{ keyword: '분유제조기', rank: 8 }] }] });
  assert.equal(state.alerts.length, 1, 'backfilled history never sends a current alert');
});

test('outside rank transitions alert but missing and pending observations never fabricate an old rank', t => {
  const { service } = fixture(t);
  let state = service.saveProduct({ revision: 0, product: product('naver-1', { alert: { enabled: true, threshold: 10, keywords: [], reviewEnabled: false } }) });
  state = service.importData({ revision: state.revision, snapshots: [{ productId: 'naver-1', date: '2026-10-28', keywords: [
    { keyword: '진입', rank: null, status: 'outside', outsideLimit: 80 }, { keyword: '이탈', rank: 1 },
    { keyword: '누락', rank: null, status: 'missing' }, { keyword: '대기', rank: null, status: 'pending' }
  ] }] });
  state = service.importData({ revision: state.revision, snapshots: [{ productId: 'naver-1', date: '2026-10-29', keywords: [
    { keyword: '진입', rank: 9 }, { keyword: '이탈', rank: null, status: 'outside', outsideLimit: 80 }, { keyword: '누락', rank: 5 }, { keyword: '대기', rank: 6 }
  ] }] });
  assert.deepEqual(state.alerts.map(alert => alert.keyword).sort(), ['이탈', '진입']);
  assert.equal(state.alerts.find(alert => alert.keyword === '진입').rank, 9);
  assert.equal(state.alerts.find(alert => alert.keyword === '이탈').rank ?? null, null);
});

test('initial rank and review backfills establish baseline without an alert flood; later current reviews alert once', t => {
  const { service } = fixture(t);
  let state = service.saveProduct({ revision: 0, product: product('naver-1', { alert: { enabled: true, threshold: 10, keywords: [], reviewEnabled: true } }) });
  state = service.importData({ revision: state.revision, snapshots: [
    { productId: 'naver-1', date: '2026-10-28', keywords: [{ keyword: '분유제조기', rank: 12 }] },
    { productId: 'naver-1', date: '2026-10-29', keywords: [{ keyword: '분유제조기', rank: 9 }] }
  ], reviews: [review('initial-1'), review('initial-2')] });
  assert.deepEqual(state.alerts, []);
  state = service.importData({ revision: state.revision, reviews: [review('new-current'), review('new-history', { date: '2026-10-20' })] });
  assert.equal(state.alerts.length, 1);
  assert.equal(state.alerts[0].kind, 'review');
  assert.equal(state.alerts[0].reviewId, 'new-current');
  state = service.importData({ revision: state.revision, reviews: [review('new-current', { text: '수정된 후기' })] });
  assert.equal(state.alerts.length, 1);
});

test('alerts acknowledge selected or all IDs atomically and full backups restore reviews and alert read states', t => {
  const { service, baseDir } = fixture(t);
  let state = service.saveProduct({ revision: 0, product: product('naver-1', { alert: { enabled: false, threshold: 10, reviewEnabled: true } }) });
  state = service.importData({ revision: state.revision, reviews: [review('baseline', { date: '2026-10-28' })] });
  state = service.importData({ revision: state.revision, reviews: [review('new-1'), review('new-2')] });
  assert.equal(state.alerts.length, 2);
  const [one, two] = state.alerts;
  state = service.acknowledgeAlerts({ revision: state.revision, ids: [one.id] });
  assert.ok(Number.isFinite(Date.parse(state.alerts.find(alert => alert.id === one.id).readAt)));
  assert.equal(state.alerts.find(alert => alert.id === two.id).readAt, null);
  const before = structuredClone(state);
  assert.throws(() => service.acknowledgeAlerts({ revision: state.revision, ids: [two.id, 'unknown-alert'] }), error => [400,404].includes(error.status));
  assert.deepEqual(service.state(), before);
  state = service.acknowledgeAlerts({ revision: state.revision });
  assert.ok(state.alerts.every(alert => Number.isFinite(Date.parse(alert.readAt))));
  const restored = createService({ baseDir: path.join(baseDir, 'restored'), today: () => '2026-10-29' }).importData({ ...state, revision: 0, source: '전체 백업 복원' });
  assert.deepEqual(restored.reviews, state.reviews);
  assert.deepEqual(restored.alerts, state.alerts);
});

test('older schema one stores default new collections in memory without changing source or other ledgers', t => {
  const { service, baseDir, file } = fixture(t);
  service.saveProduct({ revision: 0, product: product() });
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  delete saved.reviews; delete saved.alerts;
  const raw = JSON.stringify(saved);
  fs.writeFileSync(file, raw);
  const unrelated = path.join(baseDir, '.roas-data', 'unrelated-ledger.json');
  fs.writeFileSync(unrelated, '{"spend":1234}');
  const loaded = createService({ baseDir }).state();
  assert.deepEqual(loaded.reviews, []);
  assert.deepEqual(loaded.alerts, []);
  assert.equal(loaded.products[0].id, 'naver-1');
  assert.equal(fs.readFileSync(file, 'utf8'), raw);
  assert.equal(fs.readFileSync(unrelated, 'utf8'), '{"spend":1234}');
});

test('daily keyword notifications repeat on a new day even without movement but require a fresh rank observation', t => {
  let clock = '2026-10-28';
  const { baseDir } = fixture(t), service = createService({ baseDir, today: () => clock });
  let state = service.saveProduct({ revision: 0, product: product('naver-1', { alert: { enabled: true, mode: 'daily', keywords: ['분유제조기'] } }) });
  state = service.importData({ revision: state.revision, snapshots: [{ productId: 'naver-1', date: clock, keywords: [{ keyword: '분유제조기', rank: 3 }] }] });
  assert.deepEqual(state.alerts, []);
  clock = '2026-10-29';
  state = service.importData({ revision: state.revision, snapshots: [{ productId: 'naver-1', date: clock, keywords: [{ keyword: '분유제조기', rank: 3 }, { keyword: '선택 안함', rank: 1 }] }] });
  assert.equal(state.alerts.length, 1);
  assert.equal(state.alerts[0].mode, 'daily');
  assert.equal(state.alerts[0].oldRank, 3);
  assert.equal(state.alerts[0].rank, 3);
  const firstId = state.alerts[0].id;
  state = service.importData({ revision: state.revision, snapshots: [{ productId: 'naver-1', date: clock, keywords: [{ keyword: '분유제조기', rank: 2 }] }] });
  assert.equal(state.alerts.length, 1, 'daily mode creates one event per keyword/date');
  assert.equal(state.alerts[0].id, firstId);
  clock = '2026-10-30';
  state = service.importData({ revision: state.revision, snapshots: [{ productId: 'naver-1', date: clock, price: 399000, keywords: [{ keyword: '분유제조기', searchVolume: 9000 }] }] });
  assert.equal(state.alerts.length, 1, 'a volume/price update cannot invent a fresh rank');
  state = service.importData({ revision: state.revision, snapshots: [{ productId: 'naver-1', date: clock, keywords: [{ keyword: '분유제조기', rank: 2 }] }] });
  assert.equal(state.alerts.length, 2);
  assert.equal(new Set(state.alerts.map(alert => alert.date)).size, 2);
});

test('change mode uses adjacent real ranks and review notifications honor selected star ratings', t => {
  const { service } = fixture(t);
  let state = service.saveProduct({ revision: 0, product: product('naver-1', { alert: { enabled: true, mode: 'change', keywords: [], reviewEnabled: true, reviewStars: [1, 2] } }) });
  state = service.importData({ revision: state.revision, snapshots: [{ productId: 'naver-1', date: '2026-10-28', keywords: [{ keyword: '분유제조기', rank: 3 }, { keyword: '유지', rank: 5 }] }] });
  state = service.importData({ revision: state.revision, snapshots: [{ productId: 'naver-1', date: '2026-10-29', keywords: [{ keyword: '분유제조기', rank: 2 }, { keyword: '유지', rank: 5 }] }], reviews: [review('low', { rating: 1 }), review('medium', { rating: 3 }), review('high', { rating: 5 })] });
  assert.equal(state.alerts.filter(alert => alert.kind === 'rank').length, 1);
  assert.equal(state.alerts.find(alert => alert.kind === 'rank').keyword, '분유제조기');
  assert.equal(state.alerts.find(alert => alert.kind === 'rank').mode, 'change');
  assert.deepEqual(state.alerts.filter(alert => alert.kind === 'review').map(alert => alert.reviewId), ['low']);
  const unchanged = service.state();
  assert.throws(() => service.saveProduct({ revision: state.revision, product: { id: 'naver-1', alert: { reviewStars: [0, 6] } } }), status(400));
  assert.deepEqual(service.state(), unchanged);
  state = service.saveProduct({ revision: state.revision, product: { id: 'naver-1', alert: { reviewStars: [] } } });
  state = service.importData({ revision: state.revision, reviews: [review('low-muted', { rating: 1 })] });
  assert.equal(state.alerts.filter(alert => alert.kind === 'review').length, 1, 'no selected stars means no review notifications');
});

test('review source order and actual one-month-use/media flags remain explicit observed metadata', t => {
  const { service } = fixture(t);
  let state = service.saveProduct({ revision: 0, product: product() });
  state = service.importData({ revision: state.revision, reviews: [
    review('ordinary', { date: '2026-09-01' }),
    review('month-use', { sourceOrder: 0, monthUse: true, videoUrls: ['https://video.example.net/public-review.mp4'] }),
    review('not-month-use', { sourceOrder: 2, monthUse: false })
  ] });
  const ordinary = state.reviews.find(item => item.id === 'ordinary');
  assert.equal(Object.hasOwn(ordinary, 'monthUse'), false, 'review age never implies a one-month-use flag');
  assert.equal(Object.hasOwn(ordinary, 'sourceOrder'), false);
  const month = state.reviews.find(item => item.id === 'month-use');
  assert.equal(month.monthUse, true);
  assert.equal(month.sourceOrder, 0);
  assert.deepEqual(month.videoUrls, ['https://video.example.net/public-review.mp4']);
  assert.equal(state.reviews.find(item => item.id === 'not-month-use').monthUse, false);
  assert.throws(() => service.importData({ revision: state.revision, reviews: [review('bad-order', { sourceOrder: -1 })] }), status(400));
  assert.throws(() => service.importData({ revision: state.revision, reviews: [review('bad-month', { monthUse: 'true' })] }), status(400));
  assert.throws(() => service.importData({ revision: state.revision, reviews: [review('bad-video', { videoUrls: ['http://localhost/private.mp4'] })] }), status(400));
});

test('Coupang regular and wow prices stay distinct in metadata, sparse observations and manual corrections', t => {
  const { service } = fixture(t);
  let state = service.saveProduct({ revision: 0, product: { id: 'coupang-1', platform: 'coupang', productId: '12345', name: '쿠팡 검증 상품', price: null, wowPrice: 399000, vendorItemId: '9876543210123456789', itemId: '3456789012345678901' } });
  let saved = state.products[0], today = state.snapshots.find(day => day.date === '2026-10-29');
  assert.equal(saved.price, null);
  assert.equal(saved.wowPrice, 399000);
  assert.equal(saved.vendorItemId, '9876543210123456789');
  assert.equal(saved.itemId, '3456789012345678901');
  assert.equal(today.wowPrice, 399000);
  assert.equal(Object.hasOwn(today, 'price'), false, 'a wow price does not fabricate a regular sale price');
  state = service.importData({ revision: state.revision, snapshots: [{ productId: 'coupang-1', date: '2026-10-28', price: 429000, wowPrice: 399000 }] });
  const historical = structuredClone(state.snapshots.find(day => day.date === '2026-10-28'));
  state = service.saveProduct({ revision: state.revision, product: { id: 'coupang-1', wowPrice: 0 } });
  today = state.snapshots.find(day => day.date === '2026-10-29');
  assert.equal(today.wowPrice, 0);
  assert.equal(Object.hasOwn(today, 'price'), false);
  assert.deepEqual(state.snapshots.find(day => day.date === '2026-10-28'), historical);
  state = service.saveProduct({ revision: state.revision, product: { id: 'coupang-1', wowPrice: null, vendorItemId: null, itemId: '' } });
  saved = state.products[0];
  assert.equal(saved.wowPrice, null);
  assert.equal(saved.vendorItemId, null);
  assert.equal(saved.itemId, null);
  assert.equal(state.snapshots.find(day => day.date === '2026-10-29').wowPrice, null);
  state = service.importData({ revision: state.revision, snapshots: [{ productId: 'coupang-1', date: '2026-10-29', price: 0, wowPrice: null }] });
  assert.equal(state.snapshots.find(day => day.date === '2026-10-29').price, 0);
  assert.equal(state.snapshots.find(day => day.date === '2026-10-29').wowPrice, null);
  const unchanged = service.state();
  for (const invalid of [{ wowPrice: -1 }, { wowPrice: '399000' }, { vendorItemId: '1e20' }, { itemId: 123 }]) assert.throws(() => service.saveProduct({ revision: state.revision, product: { id: 'coupang-1', ...invalid } }), status(400));
  assert.deepEqual(service.state(), unchanged);
});

test('removing a folder unassigns its products and preserves all products, history, reviews and alerts', t => {
  const { service } = fixture(t);
  let state = service.saveFolder({ revision: 0, folder: { id: 'remove-group', name: '삭제할 폴더' } });
  state = service.saveFolder({ revision: state.revision, folder: { id: 'keep-group', name: '유지할 폴더' } });
  state = service.saveProduct({ revision: state.revision, product: product('naver-1', { folderId: 'remove-group', alert: { enabled: true, threshold: 3, reviewEnabled: true } }) });
  state = service.saveProduct({ revision: state.revision, product: product('naver-2', { folderId: 'keep-group' }) });
  state = service.importData({ revision: state.revision, snapshots: [{ productId: 'naver-1', date: '2026-10-28', keywords: [{ keyword: '분유제조기', rank: 1 }] }], reviews: [review('folder-baseline', { date: '2026-10-28' })] });
  state = service.importData({ revision: state.revision, snapshots: [{ productId: 'naver-1', date: '2026-10-29', keywords: [{ keyword: '분유제조기', rank: 5 }] }], reviews: [review('folder-fresh')] });
  assert.equal(state.alerts.length, 2);
  const before = structuredClone(state);
  for (const folder of [{ remove: true }, { id: 'missing', remove: true }]) {
    assert.throws(() => service.saveFolder({ revision: state.revision, folder }), status(404));
    assert.deepEqual(service.state(), before);
  }
  for (const remove of ['true', 1, null, {}]) {
    assert.throws(() => service.saveFolder({ revision: state.revision, folder: { id: 'remove-group', remove } }), status(400));
    assert.deepEqual(service.state(), before);
  }
  assert.throws(() => service.saveFolder({ revision: state.revision - 1, folder: { id: 'remove-group', remove: true } }), status(409));
  assert.deepEqual(service.state(), before);
  state = service.saveFolder({ revision: state.revision, folder: { id: 'remove-group', remove: true } });
  assert.equal(state.revision, before.revision + 1);
  assert.deepEqual(state.folders, [{ id: 'keep-group', name: '유지할 폴더' }]);
  assert.equal(state.products.length, 2);
  assert.equal(state.products.find(item => item.id === 'naver-1').folderId, null);
  assert.equal(state.products.find(item => item.id === 'naver-2').folderId, 'keep-group');
  assert.deepEqual(state.products.map(item => ({ ...item, folderId: null })), before.products.map(item => ({ ...item, folderId: null })));
  assert.deepEqual(state.snapshots, before.snapshots);
  assert.deepEqual(state.reviews, before.reviews);
  assert.deepEqual(state.alerts, before.alerts);
});

test('manual corrections compare against the visible latest observation even when reverting to older product metadata', t => {
  const { service } = fixture(t);
  let state = service.saveProduct({ revision: 0, product: product('naver-1', { price: 100 }) });
  state = service.importData({ revision: state.revision, snapshots: [
    { productId: 'naver-1', date: '2026-10-28', price: 150 },
    { productId: 'naver-1', date: '2026-10-29', price: 200, reviews: null }
  ] });
  assert.equal(state.products[0].price, 100);
  const historical = structuredClone(state.snapshots.find(day => day.date === '2026-10-28'));
  const beforeMetadata = structuredClone(state.snapshots);
  state = service.saveProduct({ revision: state.revision, product: { id: 'naver-1', name: '메트릭 변경 없는 상품명 수정', favorite: true } });
  assert.deepEqual(state.snapshots, beforeMetadata, 'metadata-only updates still do not create measurements');
  state = service.saveProduct({ revision: state.revision, product: { id: 'naver-1', price: 100 } });
  const today = state.snapshots.find(day => day.date === '2026-10-29');
  assert.equal(today.price, 100, 'reverting to product metadata is still a real correction of the visible price');
  assert.equal(today.source, 'manual');
  assert.equal(today.reviews, null, 'an unrelated explicit unknown remains unknown');
  assert.deepEqual(state.snapshots.find(day => day.date === '2026-10-28'), historical);
  const unchanged = structuredClone(state.snapshots);
  state = service.saveProduct({ revision: state.revision, product: { id: 'naver-1', price: 100 } });
  assert.deepEqual(state.snapshots, unchanged, 'saving the already visible value does not change observation timestamps');
});

test('manual keyword selection and order persist independently from source registration ownership', t => {
  const { service, baseDir, file } = fixture(t);
  let state = service.importData({ revision: 0, products: [product('naver-1', { keywords: ['첫째', '둘째', '셋째'] })] });
  assert.equal(state.products[0].keywordSelection, 'source');
  state = service.saveProduct({ revision: state.revision, product: { id: 'naver-1', name: '메타데이터만 수정', keywords: state.products[0].keywords } });
  assert.equal(state.products[0].keywordSelection, 'source', 'an identical list accompanying metadata is not a manual selection');
  state = service.saveKeywords({ revision: state.revision, id: 'naver-1', keywords: ['셋째', '첫째'] });
  assert.equal(state.products[0].keywordSelection, 'local');
  assert.deepEqual(state.products[0].keywords.map(keyword => keyword.keyword), ['셋째', '첫째']);
  state = service.importData({ revision: state.revision, products: [{ id: 'naver-1', price: 399000, brand: '위마망' }] });
  assert.equal(state.products[0].keywordSelection, 'local', 'metadata collection preserves manual ownership');
  assert.deepEqual(state.products[0].keywords.map(keyword => keyword.keyword), ['셋째', '첫째']);
  const restored = createService({ baseDir: path.join(baseDir, 'selection-restored'), today: () => '2026-10-29' }).importData({ ...state, revision: 0 });
  assert.equal(restored.products[0].keywordSelection, 'local');
  assert.deepEqual(restored.products[0].keywords, state.products[0].keywords);
  state = service.saveProduct({ revision: state.revision, product: product('naver-2', { keywords: ['직접 등록'] }) });
  assert.equal(state.products.find(item => item.id === 'naver-2').keywordSelection, 'local');
  state = service.saveProduct({ revision: state.revision, product: { id: 'naver-1', keywordSelection: 'source' } });
  assert.equal(state.products[0].keywordSelection, 'source');
  state = service.saveProduct({ revision: state.revision, product: { id: 'naver-1', keywords: ['첫째', '셋째'] } });
  assert.equal(state.products[0].keywordSelection, 'local', 'a manual reorder establishes local ownership');
  const unchanged = service.state();
  assert.throws(() => service.importData({ revision: state.revision, products: [{ id: 'naver-1', keywordSelection: 'unknown' }] }), status(400));
  assert.deepEqual(service.state(), unchanged);
  const legacy = JSON.parse(fs.readFileSync(file, 'utf8'));
  delete legacy.products[0].keywordSelection;
  const raw = JSON.stringify(legacy); fs.writeFileSync(file, raw);
  assert.equal(createService({ baseDir }).state().products[0].keywordSelection, 'source');
  assert.equal(fs.readFileSync(file, 'utf8'), raw, 'legacy ownership default is a read-time migration');
});
