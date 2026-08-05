'use strict';

/**
 * Register / remove / inspect the daily Windows Task Scheduler entry that
 * drives scripts/run-pipeline.js unattended.
 *
 * The task runs as the current user and only while logged on, so no admin
 * elevation is needed. run-pipeline.js chdirs to the repo root itself, so the
 * task does not depend on its working directory (schtasks /create has no
 * "Start in" option).
 *
 * Usage:
 *   node scripts/install-schedule.js [--time 08:00]   # register (default 08:00)
 *   node scripts/install-schedule.js --remove          # delete the task
 *   node scripts/install-schedule.js --info            # query the task
 *
 * Env override: SCHEDULE_TIME=07:30 node scripts/install-schedule.js
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const TASK_NAME = 'ai-news-monitor-daily';
const ROOT = path.join(__dirname, '..');

const args = process.argv.slice(2);

// schtasks lives in System32; resolve its real path so spawning never depends
// on PATH resolution (a 32-bit node might not find it otherwise).
const SCHTASKS = fs.existsSync(
  path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'schtasks.exe'),
)
  ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'schtasks.exe')
  : 'schtasks';

/** Parse a HH:MM time from `--time 08:00`, `--time=08:00` or SCHEDULE_TIME. */
function parseTime() {
  const i = args.indexOf('--time');
  if (i !== -1) {
    const next = args[i + 1];
    if (next && /^\d{2}:\d{2}$/.test(next)) return next;
    const eq = args[i].split('=')[1];
    if (eq && /^\d{2}:\d{2}$/.test(eq)) return eq;
  }
  return process.env.SCHEDULE_TIME || '08:00';
}

function runSchtasks(schtasksArgs) {
  const r = spawnSync(SCHTASKS, schtasksArgs, { encoding: 'utf8' });
  const out = (r.stdout || '').trim();
  const err = (r.stderr || '').trim();
  if (r.status !== 0) {
    console.error(err || out || `schtasks failed (exit ${r.status})`);
    process.exit(1);
  }
  return out || err;
}

const nodeExe = process.execPath;
const wrapper = path.join(__dirname, 'run-pipeline.js');

if (args.includes('--remove')) {
  runSchtasks(['/delete', '/tn', TASK_NAME, '/f']);
  console.log(`已删除定时任务: ${TASK_NAME}`);
} else if (args.includes('--info')) {
  const out = runSchtasks(['/query', '/tn', TASK_NAME, '/v', '/fo', 'LIST']);
  console.log(out);
} else {
  const time = parseTime();
  const tr = `"${nodeExe}" "${wrapper}"`;
  runSchtasks(['/create', '/tn', TASK_NAME, '/tr', tr, '/sc', 'daily', '/st', time, '/f']);
  console.log(`已注册每日 ${time} 定时任务: ${TASK_NAME}`);
  console.log(`  命令: ${tr}`);
  console.log(`  下次运行由任务计划程序调度（仅登录时运行，重启后自动恢复）`);
  console.log(`  查看: npm run ops:schedule:info`);
  console.log(`  卸载: npm run ops:unschedule`);
}
