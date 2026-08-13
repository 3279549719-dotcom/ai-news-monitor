'use strict';

/**
 * usage-logger.js — 工具使用日志（JSONL 追加写）
 *
 * 每次 AI 调用工具（或 harness 触发检查、管线运行）时追加一条记录到
 * logs/.tool-usage.jsonl。用于后续分析：哪些工具高频、哪些从没用过、
 * 哪些场景失败率高——Phase 4 评测体系的数据来源。
 *
 * 设计原则：
 *   - JSONL append-only：每行独立 JSON，无并发写问题
 *   - 容错：logs/ 目录不可写时静默降级（绝不抛异常影响主流程）
 *   - 隐私：不记录 env/key/secret，只记录工具名、文件路径、耗时、成功与否
 *   - 零依赖：不 require config/db，避免循环依赖
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const LOG_PATH = path.join(ROOT, 'logs', '.tool-usage.jsonl');

/**
 * 追加一条工具使用日志。
 * @param {Object} entry - 日志条目。
 * @param {string} entry.tool - 工具名（如 check_all、commit_git）。
 * @param {string} [entry.trigger] - 触发方式：ai_call / hook_pretooluse / hook_posttooluse / hook_precommit / hook_stop / pipeline / manual。
 * @param {string[]} [entry.files] - 涉及的文件路径列表（仓库相对路径）。
 * @param {boolean} [entry.success] - 是否成功。
 * @param {number} [entry.durationMs] - 耗时（毫秒）。
 * @param {Object} [entry.meta] - 附加元数据（不含敏感信息）。
 * @returns {boolean} 是否成功写入。
 */
function logToolUse(entry) {
  try {
    const dir = path.dirname(LOG_PATH);
    fs.mkdirSync(dir, { recursive: true });
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      tool: String(entry.tool || 'unknown'),
      trigger: String(entry.trigger || 'unknown'),
      files: Array.isArray(entry.files) ? entry.files : [],
      success: entry.success !== false,
      durationMs: Number(entry.durationMs) || 0,
      meta: entry.meta && typeof entry.meta === 'object' ? entry.meta : {},
    });
    fs.appendFileSync(LOG_PATH, line + '\n', 'utf8');
    return true;
  } catch {
    return false; // 静默降级：日志写失败不影响主流程
  }
}

/**
 * 读取全部工具使用日志（分析用）。
 * @param {number} [limit] - 最多返回条数（缺省全部）。
 * @returns {Array<Object>} 日志条目数组；文件缺失/损坏返回 []。
 */
function readUsageLog(limit) {
  try {
    const raw = fs.readFileSync(LOG_PATH, 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    const items = lines
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
    return limit ? items.slice(-limit) : items;
  } catch {
    return [];
  }
}

/**
 * 汇总统计（分析用）：按工具名聚合调用次数、失败次数、平均耗时。
 * @returns {Object} { toolName: { count, failures, avgMs } }
 */
function usageStats() {
  const items = readUsageLog();
  const stats = {};
  for (const it of items) {
    const s = stats[it.tool] || (stats[it.tool] = { count: 0, failures: 0, totalMs: 0 });
    s.count++;
    if (!it.success) s.failures++;
    s.totalMs += it.durationMs || 0;
  }
  for (const t of Object.values(stats)) {
    t.avgMs = t.count ? Math.round(t.totalMs / t.count) : 0;
    delete t.totalMs;
  }
  return stats;
}

// 模块守卫：直接运行输出统计摘要
if (require.main === module) {
  const stats = usageStats();
  const total = Object.values(stats).reduce((a, b) => a + b.count, 0);
  console.log(`工具使用统计（共 ${total} 条记录）:`);
  const sorted = Object.entries(stats).sort((a, b) => b[1].count - a[1].count);
  for (const [name, s] of sorted) {
    const failTag = s.failures > 0 ? ` ⚠${s.failures} 失败` : '';
    console.log(`  ${name}: ${s.count} 次${failTag}（平均 ${s.avgMs}ms）`);
  }
  if (total === 0) console.log('  （暂无记录）');
}

module.exports = { logToolUse, readUsageLog, usageStats, LOG_PATH };
