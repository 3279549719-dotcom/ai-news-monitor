'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { deduplicateByUrl } = require('./search');

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
