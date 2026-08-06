'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { deduplicateByUrl, sortSourcesByTier, capSourceItems } = require('./search');

test('归一化 URL 去重，保留低 tier（更可信）', () => {
  const results = [
    { url: 'https://www.manutd.com/en/news/a', tier: 2 },
    { url: 'http://manutd.com/en/news/a?utm_source=x#top', tier: 1 },
  ];
  const deduped = deduplicateByUrl(results);
  assert.equal(deduped.length, 1);
  assert.equal(deduped[0].tier, 1);
});

test('无 tier 的条目视为最不可信（tier Infinity），被有 tier 的顶掉', () => {
  const results = [
    { url: 'https://a.com/x', tier: null },
    { url: 'https://a.com/x', tier: 2 },
  ];
  const deduped = deduplicateByUrl(results);
  assert.equal(deduped.length, 1);
  assert.equal(deduped[0].tier, 2);
});

test('不同 URL 不去重', () => {
  const results = [
    { url: 'https://a.com/x', tier: 1 },
    { url: 'https://a.com/y', tier: 1 },
  ];
  assert.equal(deduplicateByUrl(results).length, 2);
});

test('sortSourcesByTier：按 tier 升序（T0→T1→T2，无 tier 垫底），不改原数组', () => {
  const sources = [
    { source_name: 'C', tier: 2 },
    { source_name: 'A', tier: 0 },
    { source_name: 'D', tier: null },
    { source_name: 'B', tier: 1 },
  ];
  const sorted = sortSourcesByTier(sources);
  assert.deepEqual(sorted.map(s => s.tier), [0, 1, 2, null]);
  // 原数组不被改动
  assert.deepEqual(sources.map(s => s.source_name), ['C', 'A', 'D', 'B']);
});

test('capSourceItems：超上限截断，未超/空则原样返回', () => {
  assert.equal(capSourceItems([1, 2, 3, 4, 5, 6, 7, 8], 5).length, 5);
  assert.equal(capSourceItems([1, 2, 3], 5).length, 3);
  assert.equal(capSourceItems([], 5).length, 0);
  assert.equal(capSourceItems(undefined, 5), undefined);
});
