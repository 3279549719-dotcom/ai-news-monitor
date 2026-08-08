#!/usr/bin/env node
// Harness A1：PostToolUse 前后端检查分流（feedback，不阻断编辑）
// 读 stdin hook JSON → 按 tool_input.file_path 分流：
//   client/ 前端文件 → cd client && type-check + lint
//   src/、scripts/ 后端 .js → node --check <file> + npm test
//   其他文件（md/json 等）→ 跳过，不产生噪音
// 说明：本 hook 永远 exit 0（只反馈不阻断）；真正的"收尾门禁"由 Stop hook（harness-stop.js）承担。
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    stdio: 'inherit',
    shell: process.platform === 'win32',
    timeout: 180000,
  });
  return r.status === 0;
}

let input = {};
try {
  input = JSON.parse(fs.readFileSync(0, 'utf8'));
} catch (e) {
  input = {};
}

const fp =
  (input.tool_input && (input.tool_input.file_path || input.tool_input.path)) || '';
const norm = String(fp).replace(/\\/g, '/');
const isFrontend = /^client\//.test(norm) && /\.(ts|tsx|js|jsx|css)$/.test(norm);
const isBackend = /^(src|scripts)\//.test(norm) && /\.js$/.test(norm);

if (isFrontend) {
  console.log(`\n[harness A1] 前端文件：${norm}`);
  console.log('  → npm run type-check');
  run('npm', ['run', 'type-check'], path.join(ROOT, 'client'));
  console.log('  → npm run lint');
  run('npm', ['run', 'lint'], path.join(ROOT, 'client'));
} else if (isBackend) {
  console.log(`\n[harness A1] 后端文件：${norm}`);
  console.log('  → node --check');
  run('node', ['--check', fp], ROOT);
  console.log('  → npm test');
  run('npm', ['test'], ROOT);
}
// 其他文件：跳过
process.exit(0);
