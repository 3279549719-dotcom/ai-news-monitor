'use strict';

/**
 * ops-stats.js — 运维统计面板 v1.0
 *
 * 统计维度：
 *   1. pipeline 成功率（30 天，可配置）
 *   2. Ops Check 失败趋势
 *   3. 自动修复次数 / 成功率
 *   4. MTTR（Mean Time To Repair，分钟）
 *
 * 用法:
 *   node scripts/ops-stats.js [--json] [--days 30]
 *
 * 导出:
 *   collectStats(days) → 返回结构化统计对象
 *
 * 模块守卫: `if (require.main === module)` — 作为模块导入时不触发执行。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LOGS_DIR = path.join(ROOT, 'logs');

/* ===== helpers ===== */

function localDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * 生成过去 N 天的日期字符串数组（从昨天往前推）。
 */
function pastDays(n) {
  const dates = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dates.push(localDate(d));
  }
  return dates;
}

/**
 * 解析 pipeline 日志文件。
 * @returns {{date: string, exitCode: number|null, errorCount: number, hasReport: boolean, hasDigest: boolean, runCount: number}}
 */
function parsePipelineLog(logPath, dateStr) {
  try {
    if (!fs.existsSync(logPath)) {
      return { date: dateStr, exitCode: null, errorCount: 0, hasReport: false, hasDigest: false, runCount: 0, missing: true };
    }

    const content = fs.readFileSync(logPath, 'utf8');
    const lines = content.split('\n');

    // 退出码
    let exitCode = null;
    let runCount = 0;
    for (const line of lines) {
      const m = line.match(/pipeline exited \(code=(\d+)\)/);
      if (m) {
        exitCode = parseInt(m[1], 10);
        runCount++;
      }
      // 也统计 pipeline 启动次数
      if (/=== AI News Monitor ===/.test(line)) runCount++;
    }

    // 错误行（排除 npm warn 和 deprecation 噪声）
    const errorLines = lines.filter(l =>
      /error|fail|ECONNREFUSED|timeout|ENOENT/i.test(l) &&
      !/npm warn/i.test(l) &&
      !/punycode/i.test(l)
    );
    const errorCount = errorLines.length;

    const hasReport = /报告已保存/i.test(content);
    const hasDigest = /摘要邮件已发送/i.test(content);

    return {
      date: dateStr,
      exitCode,
      errorCount,
      hasReport,
      hasDigest,
      runCount,
      missing: false,
    };
  } catch {
    return { date: dateStr, exitCode: null, errorCount: 0, hasReport: false, hasDigest: false, runCount: 0, missing: true };
  }
}

/**
 * 解析 ops-check JSON 结果。
 * @returns {{date: string, status: string, summary: {ok: number, failed: number, skipped: number}, results: Array}|null}
 */
function parseOpsCheckResult(dateStr) {
  const opsCheckPath = path.join(LOGS_DIR, '.ops-check.json');
  try {
    if (!fs.existsSync(opsCheckPath)) return null;
    const data = JSON.parse(fs.readFileSync(opsCheckPath, 'utf8'));

    // 检查时间戳是否属于当天
    const checkDate = data.ts ? new Date(data.ts).toISOString().split('T')[0] : null;
    if (checkDate && checkDate !== dateStr) return null;

    return {
      date: checkDate || dateStr,
      status: data.status || 'unknown',
      summary: data.summary || { ok: 0, failed: 0, skipped: 0 },
      results: data.results || [],
    };
  } catch {
    return null;
  }
}

/**
 * 解析自动修复日志。
 * @returns {{history: Array, todayFixCount: number, lastFixSuccess: boolean}|null}
 */
function parseAutoHealLog() {
  const autoHealPath = path.join(LOGS_DIR, '.auto-heal.json');
  try {
    if (!fs.existsSync(autoHealPath)) return null;
    const data = JSON.parse(fs.readFileSync(autoHealPath, 'utf8'));
    return {
      history: data.history || [],
      todayFixCount: data.todayFixCount || 0,
      lastFixSuccess: data.lastFixSuccess,
      lastFixAt: data.lastFixAt,
      lastDate: data.lastDate,
    };
  } catch {
    return null;
  }
}

/**
 * 扫描所有存在的 pipeline 日志文件日期。
 */
function listPipelineLogDates() {
  try {
    if (!fs.existsSync(LOGS_DIR)) return [];
    const files = fs.readdirSync(LOGS_DIR)
      .filter(f => f.startsWith('pipeline-') && f.endsWith('.log'));
    return files.map(f => f.replace('pipeline-', '').replace('.log', ''));
  } catch {
    return [];
  }
}

/**
 * 计算 MTTR：从第一次失败到第一次成功修复之间的分钟差。
 * 基于 auto-heal history。
 */
function computeMTTR(autoHealHistory) {
  if (!autoHealHistory || autoHealHistory.length === 0) return null;

  let totalMins = 0;
  let pairCount = 0;

  // 找失败→成功的相邻配对
  for (let i = 0; i < autoHealHistory.length - 1; i++) {
    const current = autoHealHistory[i];
    const next = autoHealHistory[i + 1];
    // 当前是失败修复，下一次是同一命令的成功修复
    if (!current.success && next.success && current.name === next.name) {
      const diffMs = new Date(next.ts).getTime() - new Date(current.ts).getTime();
      totalMins += diffMs / 60000;
      pairCount++;
    }
  }

  return pairCount > 0 ? Math.round(totalMins / pairCount) : null;
}

/* ===== 核心统计 ===== */

/**
 * 收集运维统计数据。
 * @param {number} days - 统计天数，默认 30
 * @returns {{
 *   ts: string,
 *   windowDays: number,
 *   pipeline: { totalRuns: number, successes: number, successRate: number, daily: Array },
 *   opsCheck: { trend: Array, degradationRatio: number },
 *   autoHeal: { totalFixes: number, successFixes: number, successRate: number, mttrMins: number|null, history: Array },
 *   errors: { totalErrorCount: number, dailyAverage: number },
 *   digest: { daysWithDigest: number, digestRate: number },
 * }}
 */
function collectStats(days = 30) {
  const dates = pastDays(days);
  const logDates = new Set(listPipelineLogDates());
  const autoHealData = parseAutoHealLog();

  // 1. Pipeline 统计
  const pipelineDaily = [];
  let totalRuns = 0;
  let successes = 0;
  let totalErrorCount = 0;
  let daysWithDigest = 0;

  for (const dateStr of dates) {
    const logPath = path.join(LOGS_DIR, `pipeline-${dateStr}.log`);
    const parsed = parsePipelineLog(logPath, dateStr);

    // 成功定义：至少运行过一次且有 exitCode=0
    const isSuccess = parsed.exitCode === 0 && parsed.runCount > 0;

    if (!parsed.missing && parsed.runCount > 0) {
      totalRuns += parsed.runCount;
      if (isSuccess) successes++;
      if (parsed.hasDigest) daysWithDigest++;
    }

    totalErrorCount += parsed.errorCount;

    pipelineDaily.push({
      date: dateStr,
      runCount: parsed.runCount,
      success: isSuccess,
      errorCount: parsed.errorCount,
      hasReport: parsed.hasReport,
      hasDigest: parsed.hasDigest,
      missing: parsed.missing,
    });
  }

  const daysWithPipelines = pipelineDaily.filter(d => !d.missing && d.runCount > 0).length;
  const successRate = daysWithPipelines > 0 ? Math.round((successes / daysWithPipelines) * 100) : 0;
  const digestRate = daysWithPipelines > 0 ? Math.round((daysWithDigest / daysWithPipelines) * 100) : 0;

  // 2. Ops Check 趋势
  const opsTrend = [];
  let degradationCount = 0;
  for (const dateStr of dates) {
    const check = parseOpsCheckResult(dateStr);
    const entry = {
      date: dateStr,
      hasCheck: !!check,
      status: check ? check.status : 'no-check',
      ok: check ? check.summary.ok : 0,
      failed: check ? check.summary.failed : 0,
    };
    if (check && check.status === 'degraded') degradationCount++;
    opsTrend.push(entry);
  }

  const checksWithResult = opsTrend.filter(o => o.hasCheck).length;
  const degradationRatio = checksWithResult > 0
    ? Math.round((degradationCount / checksWithResult) * 100)
    : 0;

  // 3. 自动修复统计
  const healHistory = autoHealData ? autoHealData.history : [];
  let totalFixes = 0;
  let successFixes = 0;
  for (const entry of healHistory) {
    totalFixes++;
    if (entry.success) successFixes++;
  }
  const healSuccessRate = totalFixes > 0 ? Math.round((successFixes / totalFixes) * 100) : 0;
  const mttrMins = computeMTTR(autoHealData ? autoHealData.history : null);

  // 4. 错误统计
  const dailyAvgErrors = days > 0 ? Math.round((totalErrorCount / days) * 10) / 10 : 0;

  return {
    ts: new Date().toISOString(),
    windowDays: days,
    pipeline: {
      totalRuns,
      successes,
      daysWithData: daysWithPipelines,
      successRate,
      daily: pipelineDaily,
    },
    opsCheck: {
      trend: opsTrend,
      degradationCount,
      totalChecks: checksWithResult,
      degradationRatio,
    },
    autoHeal: {
      totalFixes,
      successFixes,
      successRate: healSuccessRate,
      mttrMins,
      history: healHistory,
    },
    errors: {
      totalErrorCount,
      dailyAverage: dailyAvgErrors,
    },
    digest: {
      daysWithDigest,
      digestRate,
    },
  };
}

/**
 * 格式化数值为百分比字符串。
 */
function pct(value) {
  return `${value}%`;
}

/**
 * 格式化分钟为可读字符串。
 */
function fmtMins(mins) {
  if (mins === null || mins === undefined) return 'N/A';
  if (mins < 60) return `${mins} 分钟`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h${m}m` : `${h} 小时`;
}

/**
 * 生成彩色 ASCII 进度条。
 */
function progressBar(pct, width = 20) {
  const filled = Math.round((pct / 100) * width);
  const empty = width - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

/* ===== 输出 ===== */

function printHuman(stats) {
  const { pipeline, opsCheck, autoHeal, errors, digest } = stats;

  console.log('╔═══════════════════════════════════════════════╗');
  console.log('║      AI News Monitor · 运维统计面板          ║');
  console.log('╚═══════════════════════════════════════════════╝');
  console.log(`统计窗口: 过去 ${stats.windowDays} 天`);
  console.log(`生成时间: ${new Date(stats.ts).toLocaleString('zh-CN')}`);
  console.log('');

  // ── Pipeline 成功率 ──
  console.log('┌─ Pipeline 成功率 ─────────────────────────────┐');
  console.log(`│ 运行天数: ${String(pipeline.daysWithData).padEnd(34)}│`);
  console.log(`│ 总运行次数: ${String(pipeline.totalRuns).padEnd(32)}│`);
  console.log(`│ 成功次数: ${String(pipeline.successes).padEnd(34)}│`);
  console.log(`│ 成功率: ${pct(pipeline.successRate).padEnd(36)}│`);
  console.log(`│ ${progressBar(pipeline.successRate)} ${pct(pipeline.successRate)}`.padEnd(44) + '│');
  console.log('└────────────────────────────────────────────────┘');
  console.log('');

  // ── 每日 Pipeline 摘要（最近 7 天明细） ──
  const recent = pipeline.daily.slice(-7);
  console.log('┌─ 最近 7 天 Pipeline 明细 ─────────────────────┐');
  console.log('│ 日期       │ 运行 │ 成功 │ 错误 │ 报告 │ 摘要 │');
  for (const d of recent) {
    const date = d.date.slice(5);
    const run = d.missing ? ' -' : String(d.runCount).padStart(3);
    const ok = d.missing ? ' - ' : d.success ? ' ✅' : ' ❌';
    const err = d.missing ? ' -' : String(d.errorCount).padStart(3);
    const report = d.missing ? ' - ' : d.hasReport ? ' ✓' : ' ✗';
    const dig = d.missing ? ' - ' : d.hasDigest ? ' ✓' : ' ✗';
    console.log(`│ ${date}   ${run} ${ok}  ${err} ${report}  ${dig} │`);
  }
  console.log('└────────────────────────────────────────────────┘');
  console.log('');

  // ── Ops Check 失败趋势 ──
  console.log('┌─ Ops Check 趋势 ──────────────────────────────┐');
  console.log(`│ 总检查次数: ${String(opsCheck.totalChecks).padEnd(32)}│`);
  console.log(`│ 降级次数: ${String(opsCheck.degradationCount).padEnd(34)}│`);
  console.log(`│ 降级率: ${pct(opsCheck.degradationRatio).padEnd(36)}│`);
  console.log(`│ ${progressBar(opsCheck.degradationRatio, 20)} ${pct(opsCheck.degradationRatio)}`.padEnd(44) + '│');

  // 最近检查摘要
  const recentChecks = opsCheck.trend.filter(o => o.hasCheck).slice(-5);
  if (recentChecks.length > 0) {
    console.log('│ 最近检查:');
    for (const c of recentChecks) {
      const icon = c.status === 'healthy' ? '✅' : c.status === 'degraded' ? '⚠️' : '❓';
      console.log(`│   ${icon} ${c.date} | 通过 ${c.ok} 失败 ${c.failed}`);
    }
  }
  console.log('└────────────────────────────────────────────────┘');
  console.log('');

  // ── 自动修复统计 ──
  console.log('┌─ 自动修复统计 ────────────────────────────────┐');
  console.log(`│ 总修复次数: ${String(autoHeal.totalFixes).padEnd(32)}│`);
  console.log(`│ 成功次数: ${String(autoHeal.successFixes).padEnd(34)}│`);
  console.log(`│ 成功率: ${pct(autoHeal.successRate).padEnd(36)}│`);
  if (autoHeal.totalFixes > 0) {
    console.log(`│ ${progressBar(autoHeal.successRate)} ${pct(autoHeal.successRate)}`.padEnd(44) + '│');
  }
  console.log(`│ MTTR: ${fmtMins(autoHeal.mttrMins).padEnd(38)}│`);

  // 最近修复历史
  const recentHeals = autoHeal.history.slice(-5);
  if (recentHeals.length > 0) {
    console.log('│ 最近修复:');
    for (const h of recentHeals) {
      const icon = h.success ? '✅' : '❌';
      console.log(`│   ${icon} ${h.date} ${h.name} | ${(h.detail || '').slice(0, 30)}`);
    }
  }
  console.log('└────────────────────────────────────────────────┘');
  console.log('');

  // ── 错误统计 ──
  console.log('┌─ 错误统计 ────────────────────────────────────┐');
  console.log(`│ 总错误行数: ${String(errors.totalErrorCount).padEnd(30)}│`);
  console.log(`│ 日均错误: ${String(errors.dailyAverage).padEnd(34)}│`);
  console.log('└────────────────────────────────────────────────┘');
  console.log('');

  // ── 摘要邮件 ──
  console.log('┌─ 摘要邮件 ────────────────────────────────────┐');
  console.log(`│ 发出天数: ${String(digest.daysWithDigest).padEnd(34)}│`);
  console.log(`│ 发出率: ${pct(digest.digestRate).padEnd(36)}│`);
  console.log(`│ ${progressBar(digest.digestRate)} ${pct(digest.digestRate)}`.padEnd(44) + '│');
  console.log('└────────────────────────────────────────────────┘');
}

/* ===== 模块守卫 ===== */

if (require.main === module) {
  const args = process.argv.slice(2);
  const useJson = args.includes('--json');

  // 解析 --days N
  let days = 30;
  const daysIdx = args.indexOf('--days');
  if (daysIdx >= 0 && args[daysIdx + 1]) {
    const parsed = parseInt(args[daysIdx + 1], 10);
    if (!isNaN(parsed) && parsed > 0) days = parsed;
  }

  const stats = collectStats(days);

  if (useJson) {
    console.log(JSON.stringify(stats, null, 2));
  } else {
    printHuman(stats);
  }
}

/* ===== 模块导出 ===== */

module.exports = {
  collectStats,
  parsePipelineLog,
  parseOpsCheckResult,
  parseAutoHealLog,
  computeMTTR,
  pastDays,
  localDate,
  listPipelineLogDates,
};
