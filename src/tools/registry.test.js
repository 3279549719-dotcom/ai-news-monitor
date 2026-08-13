'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { REGISTRY, getStats } = require('./registry');
const { validateCli } = require('./registry'); // 同模块导出

test('getStats: 18 工具 / 5 核 / 13 按需', () => {
  const s = getStats();
  assert.equal(s.total, 18);
  assert.equal(s.core, 5);
  assert.equal(s.deferred, 13);
});

test('每个工具都有非空 cli_template（真实命令模板）', () => {
  for (const [name, t] of Object.entries(REGISTRY)) {
    assert.ok(t.cli_template && /(node |npm )/.test(t.cli_template),
      `${name} 缺 cli_template（应含 node 或 npm 调用）`);
  }
});

// 说明：不做"每个参数名必须出现在 cli_template"的强断言——语义参数（mode/action/skipCheck
// 等）的真实 flag 与 kebab 名不同（--light/--info/--no-check），模板本就用真实 flag。
// 参数↔flag 一致性由 registry --check-cli 的 validateCli() 做 best-effort 警告（非阻断）。
test('validateCli 不抛异常且返回数组', () => {
  const warns = validateCli();
  assert.ok(Array.isArray(warns));
});
