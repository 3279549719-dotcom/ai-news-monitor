'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { extractPublishDateFromUrl } = require('./dates');

test('Guardian 英文月 URL 提取日期', () => {
  const d = extractPublishDateFromUrl('https://www.theguardian.com/football/2026/jun/08/manchester-united-transfer-news');
  assert.ok(d instanceof Date);
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 5); // 6 月（0 基）
  assert.equal(d.getDate(), 8);
});

test('Guardian 非法英文月返回 null', () => {
  assert.equal(
    extractPublishDateFromUrl('https://www.theguardian.com/football/2026/xyz/08/foo'),
    null
  );
});

test('数字日期 URL 提取（TechCrunch / DMN）', () => {
  const d = extractPublishDateFromUrl('https://techcrunch.com/2026/08/03/openai-launches-new-model/');
  assert.ok(d instanceof Date);
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 7); // 8 月
  assert.equal(d.getDate(), 3);
});

test('带查询串的 URL 仍能提取日期', () => {
  const d = extractPublishDateFromUrl('https://www.dallasnews.com/sports/mavericks/2026/07/15/slug/?source=rss');
  assert.ok(d instanceof Date);
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 6); // 7 月
  assert.equal(d.getDate(), 15);
});

test('无日期 URL 返回 null', () => {
  assert.equal(
    extractPublishDateFromUrl('https://www.manutd.com/en/news/detail/manchester-united-announcement'),
    null
  );
  assert.equal(extractPublishDateFromUrl(''), null);
  assert.equal(extractPublishDateFromUrl(null), null);
});

test('未来日期被拒', () => {
  assert.equal(
    extractPublishDateFromUrl('https://techcrunch.com/2999/12/31/future-article/'),
    null
  );
});

test('非法日期（2 月 30 日）返回 null', () => {
  assert.equal(
    extractPublishDateFromUrl('https://techcrunch.com/2026/02/30/invalid-date/'),
    null
  );
});
