#!/usr/bin/env node
// Harness B2：pre-commit 把关（由 .githooks/pre-commit 调用）
// ① 拦 .env* 入暂存 ② 跑 npm run check，失败阻止提交
const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: 'inherit',
    shell: process.platform === 'win32',
    timeout: 300000,
    ...opts,
  });
}

// ① .env* 敏感文件检查
const diff = spawnSync('git', ['diff', '--cached', '--name-only'], {
  cwd: ROOT,
  encoding: 'utf8',
  timeout: 15000,
});
const staged = diff.status === 0 ? diff.stdout : '';
const envFiles = staged
  .split('\n')
  .filter((f) => f && /(^|[\\/])\.env(\.|$)/.test(f));

if (envFiles.length > 0) {
  console.error('\n[harness B2] ✗ pre-commit 拦截：以下敏感文件被暂存：');
  envFiles.forEach((f) => console.error('   ' + f));
  console.error('请 `git reset <file>` 移除后再提交（.env* 不入库）。\n');
  process.exit(1);
}

// ② 全套检查
console.log('[harness B2] pre-commit: 跑 `npm run check` …');
const r = run('npm', ['run', 'check']);
if (r.status === 0) {
  console.log('[harness B2] ✓ 全套检查通过，允许提交。');
  process.exit(0);
}
console.error('\n[harness B2] ✗ pre-commit: 检查未通过，禁止提交。\n');
process.exit(1);
