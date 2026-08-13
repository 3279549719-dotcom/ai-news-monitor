#!/usr/bin/env node
// harness-check.js — PostToolUse 前后端检查分流（feedback + --json 结构化输出）
// 读 stdin hook JSON → 按 tool_input.file_path 分流：
//   client/ 前端文件 → cd client && type-check + lint
//   src/、scripts/ 后端 .js → node --check <file> + npm test
//   其他文件（md/json 等）→ 跳过
// 说明：本 hook 永远 exit 0（只反馈不阻断）；真正的"收尾门禁"由 Stop hook（harness-stop.js）承担。
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const args = new Set(process.argv.slice(2));
const JSON_MODE = args.has('--json');
const { checkFile } = require('./lib/check-js');
const { planChecksForFile, isBackendJs, isFrontend } = require('../src/tools/plan-checks');

function run(cmd, argsList, cwd) {
  const r = spawnSync(cmd, argsList, {
    cwd,
    encoding: 'utf8',
    stdio: JSON_MODE ? 'pipe' : 'inherit',
    shell: process.platform === 'win32',
    timeout: 180000,
  });
  return { ok: r.status === 0, stdout: (r.stdout || '').trim(), stderr: (r.stderr || '').trim(), exitCode: r.status };
}

let input = {};
try {
  input = JSON.parse(fs.readFileSync(0, 'utf8'));
} catch (e) {
  input = {};
}

const fp = (input.tool_input && (input.tool_input.file_path || input.tool_input.path)) || '';
const norm = String(fp).replace(/\\/g, '/');

// ─── 检查决策统一走纯函数 planChecksForFile（P1-3/P1-4）───
const stageExec = {
  type_check: () => run('npm', ['run', 'type-check'], path.join(ROOT, 'client')),
  lint: () => run('npm', ['run', 'lint'], path.join(ROOT, 'client')),
  syntax: () => {
    const r = checkFile(fp, { silent: true });
    return { ok: r.ok, stdout: '', stderr: r.stderr };
  },
  test: () => run('npm', ['test'], ROOT),
};

const t0 = Date.now();
const stages = planChecksForFile(norm);
const results = stages.map(stage => {
  const r = stageExec[stage]();
  return {
    stage,
    passed: r.ok,
    summary: r.ok ? '检查通过' : (r.stderr || '检查失败'),
    suggestion: r.ok ? null : suggestFix(norm, stage, r.stderr),
  };
});
// 记录工具使用日志（hook_posttooluse 触发）
try {
  const { logToolUse } = require('../src/tools/usage-logger');
  logToolUse({
    tool: 'hook:harness_check',
    trigger: 'hook_posttooluse',
    files: [norm],
    success: results.every(r => r.passed),
    durationMs: Date.now() - t0,
    meta: { stages: stages.join(',') || 'none' },
  });
} catch (e) { /* 日志失败静默 */ }

if (JSON_MODE) {
  const allPassed = results.length > 0 && results.every(r => r.passed);
  const type = isFrontend(norm) ? 'frontend' : isBackendJs(norm) ? 'backend' : 'skipped';
  console.log(JSON.stringify({
    checked: true,
    file: fp,
    type,
    passed: allPassed,
    stages: results,
    harness: 'posttooluse',
    status: results.length === 0 ? 'skipped' : allPassed ? 'pass' : 'fail',
  }, null, 2));
}

function suggestSyntaxFix(file, stderr) {
  // Best-effort 解析 node --check 的标准输出，给出修复建议
  if (!stderr) return null;
  const lineMatch = stderr.match(/SyntaxError: (.+)/);
  if (lineMatch) {
    return `修复 ${path.basename(file)} 中的语法错误: ${lineMatch[1]}`;
  }
  return `语法检查失败，请检查 ${file} 的代码完整性`;
}

/** 数据驱动模式的通用修复建议。 */
function suggestFix(file, stage, stderr) {
  const suggestions = {
    type_check: '前端类型错误：检查报错处的 TS 类型定义与 props/state 是否匹配',
    syntax: '语法错误：检查括号/引号/分号配对',
    test: '测试失败：查看失败用例的断言差异，修复逻辑后重跑',
    lint: 'ESLint 报错：按规则提示修复风格/语法问题',
  };
  return suggestions[stage] || (stderr ? String(stderr).split('\n')[0].slice(0, 200) : null);
}

process.exit(0);
