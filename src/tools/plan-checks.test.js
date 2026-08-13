'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { planChecksRaw, planChecksForFile, isBackendJs, isFrontend } = require('./plan-checks');

test('前端 .tsx 只跑 type_check + lint，绝不触发 syntax/test（P1-3 修复）', () => {
  const trig = ['check_all', 'check_type', 'ops_screenshot']; // graph 对 App.tsx 的实际输出
  assert.deepEqual(planChecksRaw('client/src/App.tsx', trig, true), ['type_check', 'lint']);
});

test('后端 src/*.js 跑 syntax + test', () => {
  const trig = ['check_all', 'check_test', 'check_syntax'];
  assert.deepEqual(planChecksRaw('src/ai.js', trig, true), ['syntax', 'test']);
});

test('后端 scripts/*.js 触发 check_all 时跑 syntax + test（保持旧行为）', () => {
  const trig = ['check_all', 'check_syntax'];
  assert.deepEqual(planChecksRaw('scripts/run-pipeline.js', trig, true), ['syntax', 'test']);
});

test('docs/*.md 不触发任何检查', () => {
  assert.deepEqual(planChecksRaw('docs/x.md', [], true), []);
});

test('legacy 回退（graph 缺失）：后端仍检查', () => {
  assert.deepEqual(planChecksRaw('src/ai.js', [], false), ['syntax', 'test']);
});

test('legacy 回退（graph 缺失）：前端仍检查', () => {
  assert.deepEqual(planChecksRaw('client/src/App.tsx', [], false), ['type_check', 'lint']);
});

test('反斜杠路径归一化', () => {
  assert.deepEqual(planChecksForFile('src\\ai.js'), ['syntax', 'test']);
});

test('isBackendJs / isFrontend 分类', () => {
  assert.equal(isBackendJs('src/ai.js'), true);
  assert.equal(isBackendJs('client/src/App.tsx'), false);
  assert.equal(isFrontend('client/src/App.tsx'), true);
  assert.equal(isFrontend('docs/x.md'), false);
});
