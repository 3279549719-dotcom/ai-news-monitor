'use strict';

/**
 * Daily pipeline runner — unattended entry for Windows Task Scheduler.
 *
 * Wraps the single-run pipeline so it can be driven without a human:
 *   1. chdir to the repo root. Scheduled tasks may start in an arbitrary
 *      working directory, but `src/config.js` loads .env relative to cwd,
 *      so the wrapper normalizes it first.
 *   2. Idempotently start the crawl4ai Docker container. If the container
 *      is down, the pipeline degrades per-source (scraper-direct fallback)
 *      and still completes for most sources.
 *   3. Run `node src/index.js`, teeing stdout/stderr to a dated log file
 *      under `logs/` and to the console.
 *
 * Usage:
 *   node scripts/run-pipeline.js [--no-docker]
 */

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);

const args = process.argv.slice(2);
const noDocker = args.includes('--no-docker');

/** Local-date stamp YYYY-MM-DD (log file names should match the user's day). */
function localStamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Start the crawl4ai container; tolerate "already running" and hard failures. */
function startCrawl4ai() {
  if (noDocker) {
    console.log('[pipeline] --no-docker: skipping docker start');
    return;
  }
  console.log('[pipeline] starting crawl4ai container (idempotent)...');
  // Timeout guards against a hanging docker CLI (daemon down) — the pipeline
  // must never block forever on the docker step.
  const r = spawnSync('docker', ['start', 'crawl4ai'], { encoding: 'utf8', timeout: 30000 });
  const out = (r.stdout || '').trim();
  const err = (r.stderr || '').trim();
  if (r.status === 0) {
    console.log(`[pipeline] docker start ok: ${out || 'running'}`);
  } else {
    const reason = r.error ? r.error.message : `exit ${r.status}`;
    console.warn(`[pipeline] docker start not ok (${reason}): ${err || out || 'container unreachable'}`);
    console.warn('[pipeline] continuing anyway; pipeline degrades per source');
  }
}

/** Append-mode log stream for today's pipeline output. */
function openLog() {
  const dir = path.join(ROOT, 'logs');
  fs.mkdirSync(dir, { recursive: true });
  return fs.createWriteStream(path.join(dir, `pipeline-${localStamp()}.log`), { flags: 'a' });
}

/** Run the real pipeline as a child, teeing output to console + log. */
function runPipeline() {
  const log = openLog();
  const child = spawn(process.execPath, ['src/index.js'], {
    cwd: ROOT,
    stdio: ['inherit', 'pipe', 'pipe'],
  });

  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);
  child.stdout.pipe(log);
  child.stderr.pipe(log);

  child.on('error', (e) => {
    console.error('[pipeline] failed to spawn node:', e.message);
    process.exit(1);
  });
  child.on('exit', (code, signal) => {
    log.end();
    console.log(`[pipeline] pipeline exited (code=${code}${signal ? ` signal=${signal}` : ''})`);
    process.exit(code ?? 1);
  });
}

startCrawl4ai();
runPipeline();
