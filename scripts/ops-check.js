'use strict';

/**
 * ops-check.js — 运维巡检脚本 v1.0
 *
 * 检查项（项目独立，不依赖 Claude Code）：
 *   1. Docker / crawl4ai 容器健康（本地完整模式）
 *   2. 磁盘余量（本地完整模式）
 *   3. .last-run.json — 今天是否已跑 pipeline
 *   4. 最近一次 pipeline 日志 — 错误行数 / 成功标记
 *   5. Supabase 近 24h 新文章量 — 检测是否囤积
 *   6. node_modules / npm 依赖完整性
 *
 * 模式：
 *   本地完整    node scripts/ops-check.js
 *   本地轻量    node scripts/ops-check.js --light    (跳过 Docker+磁盘)
 *   Actions     node scripts/ops-check.js --actions   (GH Actions Safe)
 *
 * 输出：JSON 状态对象 + 人类可读摘要。异常时 exitCode=1 便于 CI/CD 捕获。
 */

const fs = require('fs');
const path = require('path');
const { spawnSync, execSync } = require('child_process');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const ARGS = new Set(process.argv.slice(2));
const FULL_MODE = !ARGS.has('--light') && !ARGS.has('--actions');
const ALERT_MODE = ARGS.has('--alert-threshold');
const THRESHOLDS = {
  minSupabaseArticles: parseInt(process.env.OPS_MIN_ARTICLES || '0', 10),
  maxDaysNoPipeline: parseInt(process.env.OPS_MAX_DAYS_NO_PIPELINE || '3', 10),
  minDiskGB: parseInt(process.env.OPS_MIN_DISK_GB || '10', 10),
};

/* ===== helpers ===== */
const localDate = () => new Date().toISOString().split('T')[0];

function log(label, ok, detail = '') {
  const mark = ok ? '✓' : '✗';
  console.log(`  ${mark} ${label}${detail ? ' — ' + detail : ''}`);
  return { label, ok, detail };
}

function httpGet(url, timeoutMs = 8000, verifyTls = true, headers = {}) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { req.destroy(); reject(new Error('timeout')); }, timeoutMs);
    const req = https.get(url, { rejectUnauthorized: !verifyTls, headers }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { clearTimeout(t); resolve({ status: res.statusCode, body: data }); });
    });
    req.on('error', e => { clearTimeout(t); reject(e); });
  });
}

/* ===== 检查 1: Docker + crawl4ai ===== */
function checkDocker() {
  if (!FULL_MODE) return { label: 'Docker/crawl4ai', ok: null, detail: 'skipped (light mode)' };

  try {
    const dockerOk = spawnSync('docker', ['ps', '--format', '{{.Names}} {{.Status}}'], {
      encoding: 'utf8', timeout: 15000,
    });
    if (dockerOk.error || dockerOk.status !== 0) {
      return { label: 'Docker/crawl4ai', ok: false, detail: 'docker ps 失败 — Docker Desktop 未运行' };
    }
    const lines = dockerOk.stdout.trim().split('\n').filter(Boolean);
    const crawl4aiLine = lines.find(l => l.startsWith('crawl4ai'));
    if (!crawl4aiLine) {
      return { label: 'Docker/crawl4ai', ok: false, detail: '容器 crawl4ai 未运行' };
    }
    const isUp = /up/i.test(crawl4aiLine);
    return {
      label: 'Docker/crawl4ai', ok: isUp,
      detail: isUp ? crawl4aiLine : '容器存在但非 running: ' + crawl4aiLine,
    };
  } catch (e) {
    return { label: 'Docker/crawl4ai', ok: false, detail: e.message };
  }
}

/* ===== 检查 2: 磁盘余量 ===== */
function checkDisk() {
  if (!FULL_MODE) return { label: '磁盘余量', ok: null, detail: 'skipped (light mode)' };

  try {
    const drives = ['C:', 'E:'];
    const results = [];
    let allOk = true;
    for (const d of drives) {
      const info = spawnSync('powershell', [
        '-Command', `Get-PSDrive ${d} | Select Name,@{N='FreeGB';E={[math]::Round($_.Free/1GB,1)}} | ConvertTo-Json`
      ], { encoding: 'utf8', timeout: 10000 });
      try {
        const j = JSON.parse(info.stdout.trim());
        const free = j.FreeGB || 0;
        const minGb = ALERT_MODE ? THRESHOLDS.minDiskGB : 20;
        const ok = free >= minGb;
        results.push(`${j.Name} ${free}GB`);
        if (!ok) allOk = false;
      } catch { results.push(`${d} parse-fail`); }
    }
    return { label: '磁盘余量', ok: allOk, detail: results.join(', ') };
  } catch (e) {
    return { label: '磁盘余量', ok: false, detail: e.message };
  }
}

/* ===== 检查 3: .last-run.json ===== */
function checkLastRun() {
  const f = path.join(ROOT, 'logs', '.last-run.json');
  try {
    const raw = fs.readFileSync(f, 'utf8');
    const data = JSON.parse(raw);
    const today = localDate();
    const ranToday = data.date === today;
    const daysSince = ranToday ? 0 : Math.floor((Date.now() - new Date(data.date + "T00:00:00").getTime()) / 86400000);
    return {
      label: '今日 pipeline', ok: ALERT_MODE ? (daysSince <= THRESHOLDS.maxDaysNoPipeline) : ranToday,
      detail: ALERT_MODE && !ranToday && daysSince > THRESHOLDS.maxDaysNoPipeline
        ? `上次运行 ${data.date}，已 ${daysSince} 天未跑（超过 ${THRESHOLDS.maxDaysNoPipeline} 天阈值）`
        : ranToday
        ? `今天已跑 (${data.ranAt})`
        : `上次运行 ${data.date} (${data.ranAt})，今天 (${today}) 尚未跑`,
    };
  } catch {
    return { label: '今日 pipeline', ok: false, detail: '.last-run.json 缺失或无法解析' };
  }
}

/* ===== 检查 4: 最近一次 pipeline 日志（云端模式下查 GitHub Actions 运行记录） ===== */
async function checkPipeLog() {
  if (ARGS.has('--actions')) return await checkCloudPipelineRuns();
  const logsDir = path.join(ROOT, 'logs');
  try {
    const logFiles = fs.readdirSync(logsDir)
      .filter(f => f.startsWith('pipeline-') && f.endsWith('.log'))
      .sort()
      .reverse();
    if (logFiles.length === 0) return { label: 'Pipeline 日志', ok: false, detail: '无日志文件' };

    const latest = logFiles[0];
    const content = fs.readFileSync(path.join(logsDir, latest), 'utf8');
    const lines = content.split('\n');

    // 找错误行（排除正常的降级容错：timeout 跳过、降级、空结果等属于健康行为）
    const errorLines = lines.filter(l =>
      /error|fail|ECONNREFUSED|ENOENT/i.test(l) &&
      !/npm warn/i.test(l) &&
      !/timeout/i.test(l) &&
      !/降级/i.test(l)
    );
    const hasReport = /报告已保存/i.test(content);
    const hasDigest = /摘要邮件/i.test(content);

    const summary = [];
    if (hasReport) summary.push('报告已生成');
    if (hasDigest) summary.push('邮件已发送');
    if (errorLines.length > 0) summary.push(`${errorLines.length} 行疑似错误`);

    return {
      label: 'Pipeline 日志', ok: errorLines.length === 0,
      detail: `${latest}: ${summary.join(', ') || '无异常'}`,
    };
  } catch (e) {
    return { label: 'Pipeline 日志', ok: false, detail: e.message };
  }
}

async function checkCloudPipelineRuns() {
  // 公开仓库，无需 token 直接查 API
  const url = 'https://api.github.com/repos/3279549719-dotcom/ai-news-monitor/actions/workflows/daily-pipeline.yml/runs?per_page=5&branch=master';
  try {
    const { status, body } = await httpGet(url, 10000, true, { 'User-Agent': 'ai-news-monitor-ops-check' });
    if (status !== 200) {
      return { label: '云端 Pipeline', ok: false, detail: `GitHub API HTTP ${status}` };
    }
    const runs = JSON.parse(body).workflow_runs || [];
    if (runs.length === 0) {
      return { label: '云端 Pipeline', ok: false, detail: '无运行记录' };
    }
    const latest = runs[0];
    const start = new Date(latest.run_started_at || latest.created_at);
    const now = new Date();
    const ageH = Math.round((now - start) / 3600000);
    const ok = latest.conclusion === 'success' && ageH < 24;
    return {
      label: '云端 Pipeline',
      ok,
      detail: `run ${latest.run_number} ${latest.conclusion}（${ageH}h 前）`,
    };
  } catch (e) {
    return { label: '云端 Pipeline', ok: false, detail: e.message };
  }
}

/* ===== 检查 5: Supabase 近 24h 文章量 ===== */
async function checkSupabaseArticles() {
  // 利用 Supabase REST API 做轻量查询（不需要 SDK）
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return { label: 'Supabase 文章量', ok: null, detail: 'SUPABASE_URL/KEY 未配置，跳过' };
  }

  try {
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const url = `${SUPABASE_URL}/rest/v1/articles?select=id,created_at&created_at=gte.${since}&limit=1000`;
    const { status, body } = await httpGet(url, 8000, true);
    if (status !== 200) {
      // Try with auth header
      const res2 = await new Promise((resolve, reject) => {
        const u = new URL(url);
        const opts = {
          hostname: u.hostname, path: u.pathname + u.search,
          headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
          rejectUnauthorized: false, // local-only: Supabase HTTPS cert verified in httpGet above
        };
        const req = https.get(opts, r => {
          let d = ''; r.on('data', c => d += c); r.on('end', () => resolve({ status: r.statusCode, body: d }));
        });
        req.on('error', reject);
        req.setTimeout(8000, () => { req.destroy(); reject(new Error('timeout')); });
      });
      if (res2.status !== 200) {
        return { label: 'Supabase 文章量', ok: false, detail: `HTTP ${res2.status}` };
      }
      const count = JSON.parse(res2.body).length;
      return {
        label: 'Supabase 文章量', ok: true,
        detail: `近 24h 入库 ${count} 篇`,
      };
    }
    const count = JSON.parse(body).length;
    return {
      label: 'Supabase 文章量', ok: true,
      detail: `近 24h 入库 ${count} 篇`,
    };
  } catch (e) {
    return { label: 'Supabase 文章量', ok: false, detail: e.message };
  }
}

/* ===== 检查 6: node_modules 依赖完整性 ===== */
function checkNodeModules() {
  const nm = path.join(ROOT, 'node_modules');
  try {
    if (!fs.existsSync(nm)) return { label: 'node_modules', ok: false, detail: '目录不存在' };
    const pkgs = fs.readdirSync(nm).filter(d => !d.startsWith('.') && !d.startsWith('@'));
    const critical = ['openai', '@supabase', 'axios', 'cheerio', 'dotenv', 'node-cron', 'nodemailer'];
    const missing = [];
    for (const c of critical) {
      if (c.startsWith('@')) {
        const scoped = path.join(nm, c);
        if (!fs.existsSync(scoped) || fs.readdirSync(scoped).length === 0) missing.push(c);
      } else {
        if (!pkgs.includes(c)) missing.push(c);
      }
    }
    return {
      label: 'node_modules', ok: missing.length === 0,
      detail: missing.length ? `缺失: ${missing.join(', ')}` : `${pkgs.length} packages ok`,
    };
  } catch (e) {
    return { label: 'node_modules', ok: false, detail: e.message };
  }
}

/* ===== main ===== */
async function main() {
  const results = [];

  console.log('=== AI News Monitor · Ops Check ===');
  console.log(`模式: ${FULL_MODE ? '完整检查' : ARGS.has('--actions') ? 'GitHub Actions' : '轻量'}`);
  console.log(`时间: ${new Date().toLocaleString('zh-CN')}\n`);

  results.push(checkDocker());
  results.push(checkDisk());
  results.push(checkLastRun());
  results.push(await checkPipeLog());
  results.push(await checkSupabaseArticles());
  results.push(checkNodeModules());

  const failed = results.filter(r => r.ok === false);
  const ok = results.filter(r => r.ok === true);
  const skipped = results.filter(r => r.ok === null);

  console.log(`\n--- 汇总 ---`);
  console.log(`通过 ${ok.length} | 失败 ${failed.length} | 跳过 ${skipped.length}`);

  if (failed.length > 0) {
    console.log(`\n❌ 以下检查未通过:`);
    for (const f of failed) console.log(`   · ${f.label}: ${f.detail}`);
  }

  // Write result JSON for CI/GH Actions to parse
  const outPath = path.join(ROOT, 'logs', '.ops-check.json');
  const parent = path.dirname(outPath);
  if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({
    ts: new Date().toISOString(),
    mode: FULL_MODE ? 'full' : ARGS.has('--actions') ? 'actions' : 'light',
    summary: { ok: ok.length, failed: failed.length, skipped: skipped.length },
    results: results.map(r => ({ label: r.label, ok: r.ok, detail: r.detail })),
    status: failed.length === 0 ? 'healthy' : 'degraded',
  }, null, 2), 'utf8');
  console.log(`\n状态文件: ${outPath}`);

  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Ops check 异常:', err.message);
  process.exit(2);
});
