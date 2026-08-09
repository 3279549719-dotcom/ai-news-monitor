'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SeenStore, keyForUrl } = require('./seen');
const { applyTierFloor, T0_FLOOR, T1_FLOOR, preFilter, applySeenRing } = require('./index');

// ── applyTierFloor：T0 官方源相关性放行 ──────────────────────────
test('applyTierFloor：T0 源被 AI 误判低分 → 抬到放行线', () => {
  assert.equal(applyTierFloor(0, 0), T0_FLOOR);
  assert.equal(applyTierFloor(40, 0), T0_FLOOR);
  assert.equal(applyTierFloor(59, 0), T0_FLOOR);
});

test('applyTierFloor：T0 源 AI 高分不动，T2/null 原样', () => {
  assert.equal(applyTierFloor(90, 0), 90);   // T0 高分不降
  assert.equal(applyTierFloor(85, 0), 85);   // 恰为放行线不动
  assert.equal(applyTierFloor(40, 2), 40);   // T2 不抬
  assert.equal(applyTierFloor(40, null), 40); // 无 tier 不抬
});

test('applyTierFloor：T1 源被 AI 打低分 → 抬到 T1_FLOOR', () => {
  assert.equal(applyTierFloor(0, 1), T1_FLOOR);
  assert.equal(applyTierFloor(20, 1), T1_FLOOR);
  assert.equal(applyTierFloor(39, 1), T1_FLOOR);
  assert.equal(applyTierFloor(50, 1), 50);   // T1 高分不降
  assert.equal(applyTierFloor(40, 1), 40);   // 恰为保底线不动
});

// ── preFilter：T0 官方源免词根预筛 ───────────────────────────────
test('preFilter：T0 源标题不含词根也保留（官方内容天然相关）', () => {
  const items = [
    { title: 'A CISO’s guide to agentic AI', tier: 0 },  // 标题无 anthropic/claude/amodei，T0 保留
    { title: 'Claude models explained', tier: 0 },            // T0 含词根，保留
    { title: 'Anthropic releases new model', tier: 1 },       // T1 含词根，保留
    { title: 'AI startups raise funding', tier: 1 },          // T1 不含词根，跳过
  ];
  const kept = preFilter(items, 'Anthropic');
  assert.deepEqual(kept.map(i => i.title), [
    'A CISO’s guide to agentic AI',
    'Claude models explained',
    'Anthropic releases new model',
  ]);
});

test('preFilter：非 T0 源仍按词根过滤', () => {
  const items = [
    { title: 'Claude code migration', tier: 2 },
    { title: 'Generic tech news', tier: 2 },
  ];
  const kept = preFilter(items, 'Anthropic');
  assert.equal(kept.length, 1);
  assert.equal(kept[0].title, 'Claude code migration');
});

// ── applySeenRing：增量幂等闸第一道 ─────────────────────────────
test('applySeenRing：剔除 seen ring 内已分析 URL，保留新 URL', () => {
  const seen = new SeenStore(200);
  const items = [
    { source: 'man-utd-official', url: 'https://www.manutd.com/en/news/a' },
    { source: 'man-utd-official', url: 'https://www.manutd.com/en/news/b' },
  ];
  seen.add('man-utd-official', keyForUrl(items[0].url));
  const kept = applySeenRing(items, seen);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].url, 'https://www.manutd.com/en/news/b');
});

test('applySeenRing：空输入返回空数组，不抛错', () => {
  assert.deepEqual(applySeenRing([], new SeenStore(200)), []);
});
