'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { keyForUrl, SeenRing, SeenStore } = require('./seen');

test('keyForUrl：归一化 URL（去协议/www/query/尾斜杠）', () => {
  assert.equal(keyForUrl('https://www.manutd.com/en/news/a?utm=1#top'), 'manutd.com/en/news/a');
});

test('SeenRing：add/has 基本行为', () => {
  const r = new SeenRing(3);
  r.add('a');
  r.add('b');
  assert.equal(r.has('a'), true);
  assert.equal(r.has('c'), false);
});

test('SeenRing：超容量逐出最旧', () => {
  const r = new SeenRing(3);
  r.add('a'); r.add('b'); r.add('c'); r.add('d');
  assert.equal(r.has('a'), false);
  assert.equal(r.has('b'), true);
  assert.equal(r.has('d'), true);
  assert.equal(r.keys().length, 3);
});

test('SeenRing：重复 add 不增容量（移到尾部）', () => {
  const r = new SeenRing(3);
  r.add('a'); r.add('b'); r.add('c'); r.add('a');
  assert.equal(r.keys().length, 3);
  assert.deepEqual(r.keys(), ['b', 'c', 'a']);
});

test('SeenStore：save → load 往返一致', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seen-'));
  const file = path.join(dir, 'seen.json');
  const s = new SeenStore(200);
  s.add('simon-stone-(x)', keyForUrl('https://x.com/sistoney67/status/1'));
  s.add('simon-stone-(x)', keyForUrl('https://x.com/sistoney67/status/2'));
  await s.save({ filePath: file });
  const loaded = await SeenStore.load({ filePath: file, capacity: 200 });
  assert.equal(loaded.has('simon-stone-(x)', keyForUrl('https://x.com/sistoney67/status/1')), true);
  assert.equal(loaded.has('simon-stone-(x)', keyForUrl('https://x.com/sistoney67/status/9')), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('SeenStore：文件缺失 → 空 store，不抛错', async () => {
  const loaded = await SeenStore.load({ filePath: path.join(os.tmpdir(), '__missing-seen__.json'), capacity: 200 });
  assert.equal(loaded.has('x', 'y'), false);
});

test('SeenStore：加载超容量 JSON 只留最近 capacity 条', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seen-'));
  const file = path.join(dir, 'seen.json');
  fs.writeFileSync(file, JSON.stringify({ version: 1, sources: { s: ['k1', 'k2', 'k3', 'k4'] } }));
  const loaded = await SeenStore.load({ filePath: file, capacity: 3 });
  assert.equal(loaded.has('s', 'k1'), false);   // 最旧被逐出
  assert.equal(loaded.has('s', 'k2'), true);
  assert.equal(loaded.has('s', 'k3'), true);
  assert.equal(loaded.has('s', 'k4'), true);
  fs.rmSync(dir, { recursive: true, force: true });
});
