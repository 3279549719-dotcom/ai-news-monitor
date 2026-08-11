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
const isFrontend = /^client\//.test(norm) && /\.(ts|tsx|js|jsx|css)$/.test(norm);
const isBackend = /^(src|scripts)\//.test(norm) && /\.js$/.test(norm);

const results = [];

if (isFrontend) {
  const typeCheck = run('npm', ['run', 'type-check'], path.join(ROOT, 'client'));
  results.push({
    stage: 'type_check',
    passed: typeCheck.ok,
    summary: typeCheck.ok ? 'TypeScript 类型检查通过' : (typeCheck.stderr || '类型检查失败'),
  });
  const lint = run('npm', ['run', 'lint'], path.join(ROOT, 'client'));
  results.push({
    stage: 'lint',
    passed: lint.ok,
    summary: lint.ok ? 'ESLint 通过' : (lint.stderr || 'Lint 检查失败'),
  });
} else if (isBackend) {
  const syntax = run('node', ['--check', fp], ROOT);
  results.push({
    stage: 'syntax',
    passed: syntax.ok,
    summary: syntax.ok ? '语法检查通过' : (syntax.stderr || '语法检查失败'),
    file: fp,
    suggestion: syntax.ok ? null : suggestSyntaxFix(fp, syntax.stderr),
  });
  if (syntax.ok) {
    const test = run('npm', ['test'], ROOT);
    results.push({
      stage: 'test',
      passed: test.ok,
      summary: test.ok ? '测试全部通过' : (test.stderr || '测试失败'),
    });
  }
}

if (JSON_MODE) {
  const allPassed = results.length > 0 && results.every(r => r.passed);
  console.log(JSON.stringify({
    checked: true,
    file: fp,
    type: isFrontend ? 'frontend' : isBackend ? 'backend' : 'skipped',
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

process.exit(0);
