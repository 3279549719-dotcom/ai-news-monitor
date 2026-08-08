'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { applyTierFloor, T0_FLOOR, preFilter } = require('./index');

// ── applyTierFloor：T0 官方源相关性放行 ──────────────────────────
test('applyTierFloor：T0 源被 AI 误判低分 → 抬到放行线', () => {
  assert.equal(applyTierFloor(0, 0), T0_FLOOR);
  assert.equal(applyTierFloor(40, 0), T0_FLOOR);
  assert.equal(applyTierFloor(59, 0), T0_FLOOR);
});

test('applyTierFloor：T0 源 AI 高分不动，非 T0 源原样', () => {
  assert.equal(applyTierFloor(90, 0), 90);   // T0 高分不降
  assert.equal(applyTierFloor(85, 0), 85);   // 恰为放行线不动
  assert.equal(applyTierFloor(40, 1), 40);   // T1 不抬
  assert.equal(applyTierFloor(40, 2), 40);   // T2 不抬
  assert.equal(applyTierFloor(40, null), 40); // 无 tier 不抬
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
