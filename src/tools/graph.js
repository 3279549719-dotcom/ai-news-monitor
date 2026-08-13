'use strict';

/**
 * graph.js — 工具关系图查询（数据驱动 hook + 工具链建议）
 *
 * 读取 src/tools/tool-graph.json：
 *   - graphForFiles(changedFiles): 根据文件变更列表，返回需要触发的检查工具名
 *   - graphSuggestNext(toolName, result): 根据工具返回值，返回建议的下一步工具
 *   - validateGraph(): 校验 tool-graph.json 与 registry.js 工具名一致
 *
 * 纯函数模块，不依赖 config/db（harness 独立进程可用）。
 */

const fs = require('fs');
const path = require('path');

const GRAPH_PATH = path.join(__dirname, 'tool-graph.json');

let _cache = null;

/**
 * 读取工具关系图（带缓存 + 容错）。
 * @returns {Object|null} 图数据；文件缺失或 JSON 损坏时返回 null（调用方回退旧逻辑）。
 */
function loadGraph() {
  if (_cache) return _cache;
  try {
    _cache = JSON.parse(fs.readFileSync(GRAPH_PATH, 'utf8'));
    return _cache;
  } catch {
    return null;
  }
}

/**
 * 强制重载（测试用）。
 */
function reloadGraph() {
  _cache = null;
  return loadGraph();
}

/**
 * 根据变更文件列表，返回需要触发的检查工具名列表。
 * @param {string[]} changedFiles - 文件路径列表（仓库相对路径，正斜杠）。
 * @returns {string[]} 应触发的工具名；图缺失时返回 []。
 */
function graphForFiles(changedFiles) {
  const graph = loadGraph();
  if (!graph || !graph.tools) return [];
  if (!Array.isArray(changedFiles) || changedFiles.length === 0) return [];

  const hits = new Set();
  const files = changedFiles.map(f => String(f).replace(/\\/g, '/'));

  for (const [toolName, def] of Object.entries(graph.tools)) {
    const rules = def.triggers_on || [];
    for (const rule of rules) {
      try {
        const re = new RegExp(rule);
        if (files.some(f => re.test(f))) {
          hits.add(toolName);
          break;
        }
      } catch {
        // 无效正则跳过（数据错误不影响其他规则）
      }
    }
  }
  return [...hits];
}

/**
 * 根据工具返回值，返回建议的下一步工具列表。
 * @param {string} toolName - 已执行的工具名。
 * @param {Object} result - 该工具的返回值（JSON 对象）。
 * @returns {Array<{tool:string, reason:string}>} 建议列表；图缺失/无建议返回 []。
 */
function graphSuggestNext(toolName, result) {
  const graph = loadGraph();
  if (!graph || !graph.tools) return [];
  const def = graph.tools[toolName];
  if (!def || !Array.isArray(def.suggest_next)) return [];

  const out = [];
  for (const s of def.suggest_next) {
    if (matchesCondition(s.if, result)) {
      out.push({ tool: s.then.tool, reason: s.then.reason });
    }
  }
  return out;
}

function matchesCondition(cond, result) {
  if (!cond || Object.keys(cond).length === 0) return true;
  if (!result || typeof result !== 'object') return false;

  // $and / $or 顶层组合
  if (cond.$and && Array.isArray(cond.$and)) {
    if (!cond.$and.every(c => matchesCondition(c, result))) return false;
  }
  if (cond.$or && Array.isArray(cond.$or)) {
    if (!cond.$or.some(c => matchesCondition(c, result))) return false;
  }

  for (const [k, v] of Object.entries(cond)) {
    if (k === '$and' || k === '$or') continue;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      // 操作符对象，如 { $gte: 1 }
      const rv = result[k];
      for (const [op, target] of Object.entries(v)) {
        switch (op) {
          case '$gte': if (!(rv >= target)) return false; break;
          case '$gt':  if (!(rv > target))  return false; break;
          case '$lte': if (!(rv <= target)) return false; break;
          case '$lt':  if (!(rv < target))  return false; break;
          case '$ne':  if (rv === target)   return false; break;
          case '$eq':  if (rv !== target)   return false; break;
          default: return false; // 未知操作符保守不匹配
        }
      }
      continue;
    }
    if (Array.isArray(v)) return Array.isArray(result[k]) && v.every(x => result[k].includes(x));
    if (result[k] !== v) return false;
  }
  return true;
}

/**
 * 校验 tool-graph.json 与 registry.js 的工具名一致性。
 * @param {Object} [registry] - 可选，传入 registry 模块的 REGISTRY 对象；缺省时尝试加载。
 * @returns {{ok:boolean, missingInGraph:string[], missingInRegistry:string[]}}
 */
function validateGraph(registry) {
  const graph = loadGraph();
  const result = { ok: false, missingInGraph: [], missingInRegistry: [] };

  if (!graph || !graph.tools) {
    result.missingInGraph = ['<graph file missing or invalid>'];
    return result;
  }

  let reg = registry;
  if (!reg) {
    try {
      reg = require('./registry').REGISTRY;
    } catch {
      result.missingInRegistry = ['<registry unavailable>'];
      return result;
    }
  }

  const graphNames = new Set(Object.keys(graph.tools));
  const regNames = new Set(Object.keys(reg));

  for (const n of regNames) if (!graphNames.has(n)) result.missingInGraph.push(n);
  for (const n of graphNames) if (!regNames.has(n)) result.missingInRegistry.push(n);

  result.ok = result.missingInGraph.length === 0 && result.missingInRegistry.length === 0;
  return result;
}

module.exports = {
  loadGraph,
  reloadGraph,
  graphForFiles,
  graphSuggestNext,
  matchesCondition,
  validateGraph,
  GRAPH_PATH,
};
