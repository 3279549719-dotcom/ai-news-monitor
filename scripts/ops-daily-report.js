'use strict';

/**
 * ops-daily-report.js — 运维日报生成脚本 v1.0
 *
 * 供 OpenClaw cron 调用：内部跑 ops-check --light + ops-stats，
 * 无论检查结果如何都 exit 0，并输出一份可直接转发的日报文本。
 *
 * 用法：node scripts/ops-daily-report.js
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function run(cmd, args, timeout = 60000) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', timeout });
  return { code: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

function fmtDate() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function main() {
  const today = fmtDate();
  const lines = [`📊 ai-news-monitor 运维日报 | ${today}`, '---'];

  // 1. 巡检（--light，不因 exit 1 中断）
  const check = run('node', ['scripts/ops-check.js', '--light']);
  let okCount = null, failCount = null, failures = [];
  try {
    const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'logs', '.ops-check.json'), 'utf8'));
    okCount = j.summary.ok;
    failCount = j.summary.failed;
    failures = (j.results || []).filter((r) => r.ok === false);
  } catch {
    // fallback: 从 stdout 粗取
    const m = check.out.match(/通过 (\d+) \| 失败 (\d+) \| 跳过 (\d+)/);
    if (m) { okCount = +m[1]; failCount = +m[2]; }
  }

  lines.push(`巡检：${okCount ?? '?'} 项通过 / ${failCount ?? '?'} 项异常`);
  for (const f of failures) {
    lines.push(`  · ${f.label}: ${(f.detail || '').slice(0, 60)}`);
  }

  // 2. 统计（近 7 天）
  const stats = run('node', ['scripts/ops-stats.js', '--days', '7', '--json']);
  let successRate = null;
  try {
    const j = JSON.parse(stats.out);
    successRate = j.pipeline && typeof j.pipeline.successRate === 'number' ? j.pipeline.successRate : null;
  } catch { /* ignore */ }
  lines.push(`统计（近7天）：pipeline 成功率 ${successRate === null ? 'N/A' : successRate + '%'}`);

  // 3. 今日 pipeline 状态
  let pipelineLine;
  try {
    const lr = JSON.parse(fs.readFileSync(path.join(ROOT, 'logs', '.last-run.json'), 'utf8'));
    if (lr.date === today) {
      pipelineLine = lr.crawl4aiOk === false ? `已运行但降级（${lr.reason || 'unknown'}）` : '已运行成功';
    } else {
      pipelineLine = `未运行（上次 ${lr.date}）`;
    }
  } catch {
    pipelineLine = '未运行（无记录）';
  }
  lines.push(`今日 pipeline：${pipelineLine}`);

  // 4. 结语
  lines.push('---');
  if (failCount === 0) {
    lines.push('✅ 一切正常，无需处理。');
  } else {
    lines.push(`⚠️ 需关注：${failures.length} 项异常（详见 GitHub Issue / 本地日志）`);
  }

  console.log(lines.join('\n'));
}

if (require.main === module) main();
module.exports = { main };
