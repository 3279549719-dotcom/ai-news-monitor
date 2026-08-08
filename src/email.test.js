'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildDigestText, buildSubject } = require('./email');

const SECTIONS = [
  {
    keyword: { name: 'MU - 曼联信源监控' },
    results: [
      { title: 'Man Utd 官宣续约', url: 'https://www.manutd.com/a', score: 90, tier: 0 },
      { title: 'Ornstein 转会消息', url: 'https://x.com/ornstein/1', score: 80, tier: 1 },
    ],
  },
  { keyword: { name: 'Anthropic' }, results: [] },
  {
    keyword: { name: 'Dallas' },
    results: [{ title: '无评分无 tier 项', url: 'https://nba.com/mavs/2' }],
  },
];

test('buildDigestText：按关键词分组，跳过空结果组', () => {
  const text = buildDigestText(SECTIONS);
  assert.match(text, /【MU - 曼联信源监控】\(2\)/);
  assert.match(text, /\[T0\] Man Utd 官宣续约 \(90分\)/);
  assert.match(text, /https:\/\/www\.manutd\.com\/a/);
  assert.match(text, /\[T1\] Ornstein 转会消息 \(80分\)/);
  assert.doesNotMatch(text, /【Anthropic】/); // 空结果组不渲染
  assert.match(text, /【Dallas】\(1\)/);
});

test('buildDigestText：缺 score/tier 的项优雅降级', () => {
  const text = buildDigestText(SECTIONS);
  assert.match(text, /无评分无 tier 项/);
  assert.doesNotMatch(text, /\(undefined分\)/);
  assert.doesNotMatch(text, /\[Tundefined\]/);
});

test('buildDigestText：空结果输出“今日无新增”文案', () => {
  const text = buildDigestText([]);
  assert.match(text, /相关新内容 0 条/);
  assert.match(text, /今日无新增关注内容。/);
});

test('buildSubject：含日期与总条数', () => {
  const subject = buildSubject(SECTIONS);
  assert.match(subject, /每日摘要 · 相关 3 条/);
  assert.match(subject, /20\d\d-\d\d-\d\d/);
});

test('buildSubject：空结果条数为 0', () => {
  assert.match(buildSubject([]), /相关 0 条/);
});
