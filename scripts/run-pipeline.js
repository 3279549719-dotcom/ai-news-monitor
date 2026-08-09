'use strict';

/**
 * Daily pipeline runner — unattended entry for Windows Task Scheduler.
 *
 * Wraps the single-run pipeline so it can be driven without a human:
 *   1. chdir to the repo root. Scheduled tasks may start in an arbitrary
 *      working directory, but `src/config.js` loads .env relative to cwd,
 *      so the wrapper normalizes it first.
 *   2. Start the crawl4ai Docker container with self-healing:
 *      a) docker start crawl4ai (30s timeout)
 *      b) If failed → restart-docker-engine.ps1 → retry docker start
 *      c) Health check: curl localhost:11235/health (15s timeout)
 *      d) If all fails → send alert email, continue degraded
 *   3. Run `node src/index.js`, teeing stdout/stderr to a dated log file
 *      under `logs/` and to the console.
 *   4. Write a status file `logs/.last-run.json` so external monitoring
 *      can detect missed runs.
 *
 * Usage:
 *   node scripts/run-pipeline.js [--no-docker] [--no-alert]
 */

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);

const args = process.argv.slice(2);
const noDocker = args.includes('--no-docker');
const noAlert = args.includes('--no-alert');

/** Local-date stamp YYYY-MM-DD. */
function localStamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** ISO timestamp for logging. */
function ts() {
  return new Date().toISOString().replace('T', ' ').split('.')[0];
}

// ─── Alert (best-effort; 统一走 src/notify.js 分发器) ─────────────
async function sendAlertEmail(subject, htmlBody) {
  if (noAlert) return false;
  try {
    const notify = require('../src/notify');
    const r = await notify({ subject, html: htmlBody, text: '' });
    if (r.sent) console.log(`[pipeline] alert sent: ${subject}`);
    else console.warn(`[pipeline] alert failed (best-effort): ${r.reason}`);
    return r.sent;
  } catch (e) {
    console.warn('[pipeline] alert error:', e.message);
    return false;
  }
}

// ─── Docker self-healing ───────────────────────────────────────────
function dockerStart(retries = 1) {
  console.log('[pipeline] docker start crawl4ai (attempt 1)…');
  for (let i = 1; i <= retries; i++) {
    if (i > 1) console.log(`[pipeline] docker start crawl4ai (retry ${i})…`);
    const r = spawnSync('docker', ['start', 'crawl4ai'], { encoding: 'utf8', timeout: 30000 });
    const out = (r.stdout || '').trim();
    const err = (r.stderr || '').trim();
    if (r.status === 0) {
      console.log(`[pipeline] docker start ok: ${out || 'running'}`);
      return true;
    }
    const reason = r.error ? r.error.message : `exit ${r.status}`;
    console.warn(`[pipeline] docker start failed (${reason}): ${err || out}`);
    if (i < retries) {
      console.log('[pipeline] running restart-docker-engine.ps1…');
      const psScript = path.join(ROOT, 'scripts', 'restart-docker-engine.ps1');
      if (fs.existsSync(psScript)) {
        const ps = spawnSync('powershell', [
          '-ExecutionPolicy', 'Bypass', '-File', psScript,
        ], { encoding: 'utf8', timeout: 240000 }); // engine restart can take up to 3 min
        console.log((ps.stdout || '').trim().split('\n').slice(-3).join('\n'));
        if (ps.status !== 0) console.warn('[pipeline] restart script exit', ps.status);
      } else {
        console.warn('[pipeline] restart script not found:', psScript);
      }
    }
  }
  return false;
}

/** Health-check the crawl4ai API (15s timeout, retries 3 times). */
function checkCrawl4aiHealth() {
  console.log('[pipeline] health check http://127.0.0.1:11235/health…');
  for (let i = 1; i <= 3; i++) {
    if (i > 1) console.log(`[pipeline] health check retry ${i}…`);
    const r = spawnSync('curl', [
      '-s', '-o', 'nul', '-w', '%{http_code}',
      '--connect-timeout', '5', '--max-time', '10',
      'http://127.0.0.1:11235/health',
    ], { encoding: 'utf8', timeout: 15000 });
    const code = (r.stdout || '').trim();
    if (code === '200') {
      console.log('[pipeline] health check: HTTP 200 OK');
      return true;
    }
    console.warn(`[pipeline] health check: HTTP ${code || 'timeout'}`);
    if (i < 3) {
      // Container cold start can take 10-30s (crawl4ai loads models + index)
      const wait = 15000;
      console.log(`[pipeline] waiting ${wait / 1000}s for container to warm up…`);
      const t0 = Date.now();
      while (Date.now() - t0 < wait) {
        // Busy-wait in 1s chunks to stay responsive to OS signals
        spawnSync('node', ['-e', ''], { encoding: 'utf8', timeout: 1000 });
      }
    }
  }
  return false;
}

// ─── Status file ───────────────────────────────────────────────────
function writeStatusFile(ok, reason) {
  try {
    const dir = path.join(ROOT, 'logs');
    fs.mkdirSync(dir, { recursive: true });
    const status = {
      date: localStamp(),
      ranAt: new Date().toISOString(),
      crawl4aiOk: ok,
      reason: reason || (ok ? 'healthy' : 'degraded'),
    };
    fs.writeFileSync(
      path.join(dir, '.last-run.json'),
      JSON.stringify(status, null, 2),
      'utf8',
    );
  } catch (e) {
    console.warn('[pipeline] could not write status file:', e.message);
  }
}

// ─── Main Docker orchestration ─────────────────────────────────────
function ensureCrawl4ai() {
  if (noDocker) {
    console.log('[pipeline] --no-docker: skipping docker start');
    writeStatusFile(false, 'skipped (--no-docker)');
    return false;
  }

  const started = dockerStart(2);                   // attempt 1 + 1 retry after engine restart
  if (!started) {
    const msg = `crawl4ai container unreachable after engine restart at ${ts()}`;
    console.error(`[pipeline] FATAL: ${msg}`);
    sendAlertEmail(
      '⚠️ ai-news-monitor: Docker/crawl4ai 不可用',
      `<p>${ts()} 定时管线启动时 Docker crawl4ai 容器无法访问。</p>
       <p>引擎重启脚本已执行但容器仍未就绪。管线已降级运行（所有网站源走 Direct 备胎通道）。</p>
       <p>请手动检查 Docker Desktop 状态。</p>
       <p><small>— ai-news-monitor run-pipeline.js</small></p>`,
    );
    writeStatusFile(false, 'container unreachable after engine restart');
    return false;
  }

  const healthy = checkCrawl4aiHealth();
  if (healthy) {
    console.log('[pipeline] crawl4ai ready ✓');
    writeStatusFile(true, 'healthy');
  } else {
    console.warn('[pipeline] crawl4ai container running but health check failed — continuing degraded');
    writeStatusFile(false, 'container running, health check failed');
  }
  return healthy;
}

// ─── Pipeline execution ────────────────────────────────────────────
/** Append-mode log stream for today's pipeline output. */
function openLog() {
  const dir = path.join(ROOT, 'logs');
  fs.mkdirSync(dir, { recursive: true });
  return fs.createWriteStream(path.join(dir, `pipeline-${localStamp()}.log`), { flags: 'a' });
}

/** Run the real pipeline as a child, teeing output to console + log. */
function runPipeline() {
  const log = openLog();
  log.write(`\n=== ${ts()} ===\n`);
  const child = spawn(process.execPath, ['src/index.js'], {
    cwd: ROOT,
    stdio: ['inherit', 'pipe', 'pipe'],
  });

  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);
  // { end: false } —— 防 pipe 在 stdout 结束(auto-end)时提前关闭 log 流：
  // 否则 finishLog 的收尾 write/end 落到已关闭流上被静默丢弃，exit code 行不落盘（B1）。
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });

  // 日志收尾统一出口：write/end 回调链保证「收尾行落盘」后再打点、告警、退出，
  // 避免 process.exit 抢跑导致日志缺 `exit code=0` 结尾行（B1）。
  function finishLog(code, signal, spawnError) {
    const summary = spawnError
      ? `failed to spawn node: ${spawnError}`
      : `pipeline exited (code=${code}${signal ? ` signal=${signal}` : ''})`;
    log.write(`\n=== ${ts()} ${summary} ===\n\n`, () => {
      log.end(async () => {
        console.log(`[pipeline] ${summary}`);
        if (spawnError) {
          await sendAlertEmail('❌ ai-news-monitor: 管线启动失败', `<p>${ts()} ${summary}</p><p><small>— ai-news-monitor run-pipeline.js</small></p>`);
        } else if (code !== 0) {
          await sendAlertEmail(`❌ ai-news-monitor: 管线异常退出 (code=${code})`, `<p>${summary}</p><p>请检查日志: <code>logs/pipeline-${localStamp()}.log</code></p><p><small>— ai-news-monitor run-pipeline.js</small></p>`);
        }
        process.exit(code ?? 1);
      });
    });
    // 安全兜底：流异常时 5s 后强制退出，避免进程悬挂
    setTimeout(() => process.exit(code ?? 1), 5000).unref();
  }

  child.on('error', (e) => {
    console.error('[pipeline] failed to spawn node:', e.message);
    finishLog(1, null, e.message);
  });
  child.on('exit', (code, signal) => {
    finishLog(code ?? 1, signal, null);
  });
}

// ─── Entry ──────────────────────────────────────────────────────────
if (require.main === module) {
  console.log(`\n=== ai-news-monitor pipeline ${ts()} ===\n`);
  ensureCrawl4ai();
  runPipeline();
} else {
  // Required as a module — export for programmatic use / testing
  module.exports = { ensureCrawl4ai, dockerStart, checkCrawl4aiHealth, sendAlertEmail, writeStatusFile };
}
