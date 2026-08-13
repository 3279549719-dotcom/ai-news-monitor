'use strict';

/**
 * plan-checks.js — 决定"某文件变更该跑哪些检查"的纯函数（评审修复 P1-3/P1-4）
 *
 * 从 harness-check.js 抽出的决策逻辑。修复：
 *   P1-3 前端 .tsx 不再被 graph 的 check_all 触发 node --check（Node 对 .tsx
 *        抛 ERR_UNKNOWN_FILE_EXTENSION）或后端 npm test —— 前端只跑 type_check+lint
 *   P1-4 回退分支不再有未定义变量 —— 决策统一走本模块
 *
 * graph 缺失时回退 legacy 硬编码规则（与原 harness-check.js 回退路径等价）。
 */

const { graphForFiles, loadGraph } = require('./graph');

function isBackendJs(fp) {
  return /^(src|scripts)\//.test(fp) && /\.js$/.test(fp);
}

function isFrontend(fp) {
  return /^client\//.test(fp) && /\.(ts|tsx|js|jsx|css)$/.test(fp);
}

/**
 * 纯决策函数：根据文件 + 触发工具 + graph 可用性，返回应执行的检查阶段。
 * @param {string} fp - 变更文件（仓库相对路径，可含反斜杠）。
 * @param {string[]} trig - 触发的工具名列表。
 * @param {boolean} graphAvailable - tool-graph.json 是否可用（false 走 legacy 回退）。
 * @returns {string[]} 阶段名数组，如 ['type_check','lint'] 或 ['syntax','test']。
 */
function planChecksRaw(fp, trig, graphAvailable) {
  const norm = String(fp).replace(/\\/g, '/');
  const useLegacy = !graphAvailable || (trig || []).length === 0;
  const backend = isBackendJs(norm);
  const frontend = isFrontend(norm);
  const out = [];

  if (frontend && (useLegacy || trig.includes('check_type'))) out.push('type_check');
  if (frontend && (useLegacy || trig.includes('ops_screenshot'))) out.push('lint');
  if (backend && (useLegacy || trig.some(t => ['check_all', 'check_test', 'check_syntax'].includes(t)))) out.push('syntax');
  if (backend && (useLegacy || trig.some(t => ['check_all', 'check_test'].includes(t)))) out.push('test');
  return out;
}

/**
 * 公共入口：自动加载 graph 并计算触发工具。
 * @param {string} filePath - 变更文件。
 * @param {string[]} [triggered] - 可选注入（测试/复用用）。
 * @returns {string[]}
 */
function planChecksForFile(filePath, triggered) {
  const fp = String(filePath || '').replace(/\\/g, '/');
  const graphAvailable = !!loadGraph();
  const trig = triggered || (graphAvailable ? graphForFiles([fp]) : []);
  return planChecksRaw(fp, trig, graphAvailable);
}

module.exports = { planChecksForFile, planChecksRaw, isBackendJs, isFrontend };
