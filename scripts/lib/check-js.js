'use strict';

/**
 * scripts/lib/check-js.js — 语法检查共享核心（重构建议 7）
 *
 * check-syntax.js（全量枚举 src/+scripts/）与 harness-check.js（单文件 hook）
 * 各自实现了一遍 `node --check` 子进程调用与错误收集。抽成共享核心：
 *   - checkFile(fp)        → 单文件语法检查（hook 场景）
 *   - checkAllDirs(dirs)   → 目录全量枚举检查（lint:backend 场景）
 *
 * 边界：
 *   - 文件不存在 → 返回失败结果（不抛）
 *   - node --check 超时（默认 60s）→ 返回失败结果
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * 单文件语法检查。
 * @param {string} fp - 文件路径（相对或绝对）。
 * @param {Object} [opts] - { timeoutMs, silent }。
 * @returns {{ok:boolean, file:string, stderr:string, exitCode:number|null}}
 */
function checkFile(fp, opts = {}) {
  const timeoutMs = opts.timeoutMs || 60000;
  const silent = opts.silent !== false; // 默认静默（由调用方决定是否打印）
  try {
    if (!fs.existsSync(fp)) {
      return { ok: false, file: fp, stderr: `file not found: ${fp}`, exitCode: null };
    }
    if (!silent) console.log(`  checking ${fp}`);
    execSync(`node --check "${fp}"`, { stdio: silent ? 'pipe' : 'inherit', timeout: timeoutMs });
    return { ok: true, file: fp, stderr: '', exitCode: 0 };
  } catch (e) {
    const stderr = (e.stderr ? String(e.stderr) : String(e.message || '')).trim();
    return { ok: false, file: fp, stderr, exitCode: e.status ?? null };
  }
}

/**
 * 目录全量语法检查（枚举 dirs 下所有 .js，含子目录一层？否——保持与原实现一致：仅顶层）。
 * 与原 check-syntax.js 行为一致：仅顶层 .js，不递归子目录。
 * @param {string[]} dirs - 目录列表（如 ['src', 'scripts']）。
 * @param {Object} [opts] - { timeoutMs, printOk }。
 * @returns {{ok:boolean, total:number, failed:number, failures:Array}}
 */
function checkAllDirs(dirs, opts = {}) {
  const timeoutMs = opts.timeoutMs || 60000;
  const printOk = opts.printOk !== false;
  const files = [];
  for (const dir of dirs) {
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue; // 目录不存在跳过
    }
    for (const name of names) {
      if (name.endsWith('.js')) files.push(path.join(dir, name));
    }
  }

  const failures = [];
  for (const file of files) {
    const r = checkFile(file, { timeoutMs, silent: true });
    if (r.ok) {
      if (printOk) console.log(`  ok ${file}`);
    } else {
      failures.push(r);
      console.error(`  ✗ ${file}`);
      if (r.stderr) console.error(String(r.stderr).split('\n').slice(0, 5).join('\n'));
    }
  }

  return {
    ok: failures.length === 0,
    total: files.length,
    failed: failures.length,
    failures,
  };
}

module.exports = { checkFile, checkAllDirs };
