'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseAnalyzeResult } = require('./ai');

test('解析合法 JSON', () => {
  const r = parseAnalyzeResult('{"score": 82, "summary": "概述", "event": "事件", "category": "transfer"}');
  assert.deepEqual(r, { relevant: true, score: 82, summary: '概述', event: '事件', category: 'transfer' });
});

test('score 低于门槛 → 不相关', () => {
  const r = parseAnalyzeResult('{"score": 40}');
  assert.equal(r.relevant, false);
  assert.equal(r.score, 40);
});

test('score 越界钳制到 [0,100]', () => {
  assert.equal(parseAnalyzeResult('{"score": 200}').score, 100);
  assert.equal(parseAnalyzeResult('{"score": -5}').score, 0);
});

test('markdown 围栏被剥离', () => {
  const r = parseAnalyzeResult('```json\n{"score": 75, "summary": "s"}\n```');
  assert.equal(r.relevant, true);
  assert.equal(r.score, 75);
});

test('脏前缀只取 JSON 对象', () => {
  const r = parseAnalyzeResult('好的，结果如下：{"score": 66} 结尾');
  assert.equal(r.relevant, true);
  assert.equal(r.score, 66);
});

test('非 JSON 文本 → 容错返回不相关', () => {
  assert.deepEqual(parseAnalyzeResult('not json at all'), { relevant: false, score: 0, summary: '', event: '', category: '' });
});

test('score 非数字 → 0', () => {
  assert.equal(parseAnalyzeResult('{"score": "abc"}').score, 0);
});
