'use strict';

/**
 * graph.test.js — tool-graph 数据驱动查询的单元测试。
 * 运行：node --test src/tools/graph.test.js
 */

const test = require('node:test');
const assert = require('node:assert');

const {
  graphForFiles,
  graphSuggestNext,
  matchesCondition,
  validateGraph,
  loadGraph,
} = require('./graph');

test('validateGraph: tool-graph.json 与 registry 工具名一一对应', () => {
  const v = validateGraph();
  assert.strictEqual(v.ok, true, `missingInGraph=${v.missingInGraph} missingInRegistry=${v.missingInRegistry}`);
});

test('loadGraph: 图文件存在且含 tools 对象', () => {
  const g = loadGraph();
  assert.ok(g, '图文件加载失败');
  assert.ok(g.tools, '缺少 tools 对象');
  assert.ok(Object.keys(g.tools).length >= 18, '工具数量不足');
});

test('graphForFiles: src/*.js 触发 check_all/check_test/check_syntax', () => {
  const r = graphForFiles(['src/ai.js']);
  assert.ok(r.includes('check_all'), `缺少 check_all: ${r}`);
  assert.ok(r.includes('check_test'), `缺少 check_test: ${r}`);
  assert.ok(r.includes('check_syntax'), `缺少 check_syntax: ${r}`);
});

test('graphForFiles: client/*.tsx 触发 check_all/check_type/ops_screenshot', () => {
  const r = graphForFiles(['client/src/App.tsx']);
  assert.ok(r.includes('check_all'), `缺少 check_all: ${r}`);
  assert.ok(r.includes('check_type'), `缺少 check_type: ${r}`);
  assert.ok(r.includes('ops_screenshot'), `缺少 ops_screenshot: ${r}`);
});

test('graphForFiles: docs/*.md 不触发任何检查', () => {
  const r = graphForFiles(['docs/readme.md']);
  assert.deepStrictEqual(r, []);
});

test('graphForFiles: 反斜杠路径也能匹配', () => {
  const r = graphForFiles(['src\\ai.js']);
  assert.ok(r.includes('check_syntax'), `反斜杠路径未匹配: ${r}`);
});

test('graphForFiles: 空列表返回空', () => {
  assert.deepStrictEqual(graphForFiles([]), []);
  assert.deepStrictEqual(graphForFiles(null), []);
});

test('graphSuggestNext: pipeline_run 成功 → check_quality', () => {
  const r = graphSuggestNext('pipeline_run', { success: true, crawl4ai_ready: true });
  assert.deepStrictEqual(r, [{ tool: 'check_quality', reason: '管线完成，建议验收日报质量' }]);
});

test('graphSuggestNext: pipeline_run 失败 → ops_check', () => {
  const r = graphSuggestNext('pipeline_run', { success: false });
  assert.deepStrictEqual(r, [{ tool: 'ops_check', reason: '管线异常退出，建议巡检基础设施' }]);
});

test('graphSuggestNext: pipeline_run crawl4ai 不可用 → ops_check（管线成功仍建议质量验收）', () => {
  const r = graphSuggestNext('pipeline_run', { success: true, crawl4ai_ready: false });
  // 两个条件同时命中：crawl4ai 未就绪 + 管线成功，两条建议都返回
  assert.deepStrictEqual(r, [
    { tool: 'ops_check', reason: 'crawl4ai 不可用，建议巡检 Docker/容器健康' },
    { tool: 'check_quality', reason: '管线完成，建议验收日报质量' },
  ]);
});

test('graphSuggestNext: check_test 失败 → harness_diagnose', () => {
  const r = graphSuggestNext('check_test', { passed: false });
  assert.deepStrictEqual(r, [{ tool: 'harness_diagnose', reason: '测试失败，建议读取 harness 诊断定位失败用例' }]);
});

test('graphSuggestNext: 无建议的工具返回空', () => {
  assert.deepStrictEqual(graphSuggestNext('check_all', { passed: true }), []);
  assert.deepStrictEqual(graphSuggestNext('不存在的工具', {}), []);
});

test('matchesCondition: 空条件恒真', () => {
  assert.strictEqual(matchesCondition({}, { anything: 1 }), true);
  assert.strictEqual(matchesCondition(null, {}), true);
});

test('matchesCondition: 单字段匹配', () => {
  assert.strictEqual(matchesCondition({ passed: false }, { passed: false }), true);
  assert.strictEqual(matchesCondition({ passed: false }, { passed: true }), false);
});

test('matchesCondition: 数组包含匹配', () => {
  assert.strictEqual(matchesCondition({ tags: ['a'] }, { tags: ['a', 'b'] }), true);
  assert.strictEqual(matchesCondition({ tags: ['c'] }, { tags: ['a', 'b'] }), false);
});

test('matchesCondition: 多键含数组条件不提前退出', () => {
  assert.equal(matchesCondition({ tags: ['a'], count: 1 }, { tags: ['a', 'b'], count: 2 }), false);
  assert.equal(matchesCondition({ tags: ['a'], count: 2 }, { tags: ['a', 'b'], count: 2 }), true);
});

test('matchesCondition: $gte 数值比较', () => {
  assert.equal(matchesCondition({ issue_count: { $gte: 1 } }, { issue_count: 3 }), true);
  assert.equal(matchesCondition({ issue_count: { $gte: 1 } }, { issue_count: 0 }), false);
});

test('matchesCondition: $gt / $lt / $lte', () => {
  assert.equal(matchesCondition({ processed: { $gt: 0 } }, { processed: 2 }), true);
  assert.equal(matchesCondition({ processed: { $lt: 5 } }, { processed: 2 }), true);
  assert.equal(matchesCondition({ score: { $lte: 60 } }, { score: 60 }), true);
});

test('matchesCondition: 未知操作符保守不匹配', () => {
  assert.equal(matchesCondition({ n: { $bogus: 1 } }, { n: 1 }), false);
});

test('matchesCondition: $and / $or 组合', () => {
  assert.equal(matchesCondition({ $and: [{ a: 1 }, { b: { $gte: 2 } }] }, { a: 1, b: 3 }), true);
  assert.equal(matchesCondition({ $or: [{ a: 1 }, { b: 1 }] }, { a: 0, b: 0 }), false);
});

test('graphSuggestNext: data_backfill processed>0 → check_quality（语义修复）', () => {
  const r = graphSuggestNext('data_backfill', { processed: 3 });
  assert.deepEqual(r, [{ tool: 'check_quality', reason: '回填处理了文章，建议重新验收日报质量' }]);
});

test('graphSuggestNext: data_backfill processed=0 → 无建议', () => {
  assert.deepEqual(graphSuggestNext('data_backfill', { processed: 0 }), []);
});

test('graphSuggestNext: harness_diagnose issue_count>=1 → check_all', () => {
  const r = graphSuggestNext('harness_diagnose', { issue_count: 3 });
  assert.deepEqual(r, [{ tool: 'check_all', reason: '诊断发现问题，修复后建议跑全套验证' }]);
});
