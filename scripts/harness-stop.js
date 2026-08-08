#!/usr/bin/env node
// Harness A2：Stop hook 收尾门禁
// 双门控：① stop_hook_active===false（权限弹窗类 stop）→ 跳过
//         ② git status 无 src/client/scripts 改动 → 跳过
// 有代码改动时跑 `npm run check`：通过 exit 0（静默）；失败 → stderr 摘要 + exit 2 阻止收尾。
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

let input = {};
try {
  input = JSON.parse(fs.readFileSync(0, 'utf8'));
} catch (e) {
  input = {};
}

// 门控①：权限弹窗类 stop 不跑检查
if (input.stop_hook_active === false) {
  process.exit(0);
}

function gitChangedPaths() {
  const r = spawnSync(
    'git',
    ['status', '--short', '--', 'src/', 'client/', 'scripts/'],
    { cwd: ROOT, encoding: 'utf8', timeout: 15000 }
  );
  if (r.status !== 0) return '';
  return r.stdout.trim();
}

// 门控②：无代码改动 → 跳过
if (!gitChangedPaths()) {
  process.exit(0);
}

console.log('\n[harness A2] 检测到未提交代码改动，收尾前跑 `npm run check` …');
const r = spawnSync('npm', ['run', 'check'], {
  cwd: ROOT,
  encoding: 'utf8',
  stdio: 'inherit',
  shell: process.platform === 'win32',
  timeout: 300000,
});

if (r.status === 0) {
  console.log('[harness A2] ✓ 全套检查通过，可收尾。');
  process.exit(0);
}
console.error(
  '\n[harness A2] ✗ 全套检查未通过（见上方输出），禁止标记完成。请先修复代码再收尾。'
);
process.exit(2);
