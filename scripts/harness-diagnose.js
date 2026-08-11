#!/usr/bin/env node
// harness-diagnose.js — 读取 harness 历史输出，生成结构化诊断
//
// 从 stdin 读取 harness hook JSON → 解析为结构化诊断信息。
// 也支持 --json 模式：从最近日志/文件中汇总 harness 状态。
//
// 用法:
//   作为 hook stdin 解析器（自动）:
//     cat hook_input.json | node scripts/harness-diagnose.js
//   从文件诊断:
//     node scripts/harness-diagnose.js --harness pretooluse --json
//   汇总所有:
//     node scripts/harness-diagnose.js --harness all --json

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const args = new Set(process.argv.slice(2));
const JSON_MODE = args.has('--json');

function argValue(prefix) {
  for (const a of process.argv) {
    if (a.startsWith(prefix + '=')) return a.slice(prefix.length + 1);
    const i = process.argv.indexOf(a);
    if (a === prefix && i + 1 < process.argv.length) return process.argv[i + 1];
  }
  return null;
}

const HARNESS_TYPE = argValue('--harness') || 'all';
const FILE_PATH = argValue('--file') || null;

/**
 * 解析 harness-pretooluse 的诊断
 */
function diagnosePretoolUse(stdinData) {
  if (!stdinData || !stdinData.tool_input || !stdinData.tool_input.command) {
    return [];
  }
  const cmd = stdinData.tool_input.command || '';
  const issues = [];

  if (/dedup-existing/.test(cmd) && /--apply/.test(cmd) && !/--dry-run/.test(cmd)) {
    issues.push({
      harness: 'pretooluse',
      severity: 'error',
      message: 'dedup-existing --apply 未带 --dry-run',
      suggestion: '硬反向操作必须先跑 --dry-run 预览"保留+待删"清单，确认后再添加 --apply 执行',
    });
  }
  if (/--keep-ids\s*=/.test(cmd)) {
    issues.push({
      harness: 'pretooluse',
      severity: 'error',
      message: '--keep-ids= 等号形式会被 flag() 静默忽略',
      suggestion: '改为空格分隔：--keep-ids ID1 ID2（不要用等号）',
    });
  }
  if (/node\s+--test/.test(cmd) && /\bsrc\b/.test(cmd) && !/\.test\.js/.test(cmd)) {
    issues.push({
      harness: 'pretooluse',
      severity: 'error',
      message: 'node --test src 会误执行 src/index.js 触发真实管线',
      suggestion: '请用 npm test（node --test "src/*.test.js"），不要直接 node --test src',
    });
  }
  return issues;
}

/**
 * 解析 harness-precommit 的诊断
 */
function diagnosePreCommit(stdinData) {
  const issues = [];
  // precommit 主要拦 .env* 和全套检查失败
  if (stdinData && stdinData.exitCode === 1) {
    issues.push({
      harness: 'precommit',
      severity: 'error',
      message: 'Pre-commit 检查未通过，提交被阻止',
      suggestion: '检查是否有 .env* 文件被暂存；运行 npm run check 确认全部通过后再提交。若只是文档改动，可用 --no-verify 跳过（但项目不推荐）',
    });
  }
  return issues;
}

// ─── 主入口 ────────────────────────────────────────────────────

function main() {
  let stdinData = null;

  // 尝试读取 stdin
  try {
    const raw = fs.readFileSync(0, 'utf8');
    if (raw.trim()) stdinData = JSON.parse(raw);
  } catch (e) {
    // 无 stdin 输入，从环境推断
  }

  const allIssues = [];

  if (HARNESS_TYPE === 'all' || HARNESS_TYPE === 'pretooluse') {
    allIssues.push(...diagnosePretoolUse(stdinData));
  }
  if (HARNESS_TYPE === 'all' || HARNESS_TYPE === 'precommit') {
    allIssues.push(...diagnosePreCommit(stdinData));
  }

  // 如果 stdin 数据包含 posttooluse 检查结果
  if (stdinData && stdinData.file_path && (HARNESS_TYPE === 'all' || HARNESS_TYPE === 'posttooluse')) {
    const fp = stdinData.file_path;
    if (stdinData.exitCode !== 0) {
      allIssues.push({
        harness: 'posttooluse',
        severity: 'error',
        message: `文件 ${path.basename(fp)} 的检查未通过`,
        suggestion: FILE_PATH
          ? `检查 ${FILE_PATH} 是否符合代码规范；运行 node --check 和 npm test 确认`
          : `运行 check_all 检查项目状态`,
        file: fp,
      });
    }
  }

  if (JSON_MODE) {
    console.log(JSON.stringify({
      harness_type: HARNESS_TYPE,
      file: FILE_PATH || (stdinData && stdinData.file_path) || null,
      issues: allIssues,
      issue_count: allIssues.length,
      summary: allIssues.length === 0
        ? '未检测到 harness 问题'
        : `发现 ${allIssues.length} 个问题: ${allIssues.map(i => i.harness + '/' + i.severity).join(', ')}`,
    }, null, 2));
  }
}

if (require.main === module) {
  main();
}
