'use strict';

/**
 * auto-heal.js — OpenClaw 本地自动修复（AI 自愈）v1.0
 *
 * 逻辑：
 *   1. 读取 scripts/.auto-fix.json 白名单
 *   2. 读取 logs/.last-run.json 检查今天 pipeline 状态
 *   3. 如果今天已跑且成功 → exit 0（无事可做）
 *   4. 如果未跑或失败 → 运行 ops-check.js 诊断
 *   5. 根据诊断结果匹配白名单命令并执行（带 timeout + 重试）
 *   6. 写入修复日志 logs/.auto-heal.json
 *   7. 修复成功 → exit 0；失败 → exit 1
 *
 * 导出：
 *   - diagnose()   → 运行 ops-check 并返回结构化诊断结果
 *   - heal(diagnosis) → 根据诊断结果执行自愈
 *
 * 模块守卫：`if (require.main === module)` — 作为模块导入时不触发执行。
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const WHITELIST_PATH = path.join(__dirname, '.auto-fix.json');
const LAST_RUN_PATH = path.join(ROOT, 'logs', '.last-run.json');
const AUTO_HEAL_PATH = path.join(ROOT, 'logs', '.auto-heal.json');
const OPS_CHECK_SCRIPT = path.join(__dirname, 'ops-check.js');

// ─── helpers ────────────────────────────────────────────────────────

function localDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function ts() {
  return new Date().toISOString();
}

function log(msg) {
  const prefix = `[auto-heal] ${ts()} |`;
  console.log(`${prefix} ${msg}`);
}

function loadWhitelist() {
  try {
    const raw = fs.readFileSync(WHITELIST_PATH, 'utf8');
    const data = JSON.parse(raw);
    if (!data.version || !data.commands) {
      throw new Error('whitelist 格式无效：缺少 version 或 commands');
    }
    return data;
  } catch (e) {
    log(`无法读取白名单: ${e.message}`);
    return null;
  }
}

function loadLastRun() {
  try {
    if (!fs.existsSync(LAST_RUN_PATH)) return null;
    const raw = fs.readFileSync(LAST_RUN_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    log(`无法读取 .last-run.json: ${e.message}`);
    return null;
  }
}

function loadAutoHealState() {
  try {
    if (!fs.existsSync(AUTO_HEAL_PATH)) return null;
    const raw = fs.readFileSync(AUTO_HEAL_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeAutoHealLog(entry) {
  try {
    const dir = path.dirname(AUTO_HEAL_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(AUTO_HEAL_PATH, JSON.stringify(entry, null, 2), 'utf8');
  } catch (e) {
    log(`无法写入自愈日志: ${e.message}`);
  }
}

/**
 * 检查每日修复限额。
 * @returns {{allowed: boolean, reason?: string}}
 */
function checkDailyLimit(whitelist) {
  const limits = whitelist && whitelist.globalLimits;
  if (!limits) return { allowed: true };

  const maxFixes = limits.maxFixesPerDay || 3;
  const cooldownMin = limits.cooldownMinutes || 30;

  const state = loadAutoHealState();
  const today = localDate();

  // 今天已修复次数
  if (state && state.lastDate === today) {
    const todayFixes = state.todayFixCount || 0;
    if (todayFixes >= maxFixes) {
      return {
        allowed: false,
        reason: `今日已修复 ${todayFixes}/${maxFixes} 次，达到限额`,
      };
    }

    // 冷却检查
    if (state.lastFixAt) {
      const elapsed = Date.now() - new Date(state.lastFixAt).getTime();
      if (elapsed < cooldownMin * 60 * 1000) {
        const remainMin = Math.ceil((cooldownMin * 60 * 1000 - elapsed) / 60000);
        return {
          allowed: false,
          reason: `冷却中，还需等待约 ${remainMin} 分钟`,
        };
      }
    }
  }

  return { allowed: true };
}

/**
 * 记录修复操作到状态文件。
 */
function recordFix(fixName, success, detail = '') {
  const existing = loadAutoHealState() || {};
  const today = localDate();

  // 新的一天则重置计数
  if (existing.lastDate !== today) {
    existing.lastDate = today;
    existing.todayFixCount = 0;
    existing.history = existing.history || [];
  }

  existing.todayFixCount = (existing.todayFixCount || 0) + 1;
  existing.lastFixAt = ts();
  existing.lastFixName = fixName;
  existing.lastFixSuccess = success;
  existing.lastFixDetail = detail;

  existing.history.push({
    ts: ts(),
    name: fixName,
    success,
    detail,
    date: today,
  });

  // 只保留最近 30 条历史
  if (existing.history.length > 30) {
    existing.history = existing.history.slice(-30);
  }

  writeAutoHealLog(existing);
}

// ─── 命令执行 ────────────────────────────────────────────────────────

/**
 * 执行单个白名单命令（带 timeout 和重试）。
 * @param {{command: string, timeoutMs: number, maxRetries: number}} cmdDef
 * @returns {{ok: boolean, detail: string, attempt: number}}
 */
function executeCommand(cmdDef) {
  const { command, timeoutMs = 30000, maxRetries = 0 } = cmdDef;
  const parts = command.split(/\s+/);
  const program = parts[0];
  const args = parts.slice(1);

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    const label = attempt > 1 ? ` (retry ${attempt}/${maxRetries + 1})` : '';
    log(`执行: ${command}${label} (timeout=${timeoutMs}ms)`);

    const result = spawnSync(program, args, {
      encoding: 'utf8',
      timeout: timeoutMs,
      cwd: ROOT,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const stdout = (result.stdout || '').trim();
    const stderr = (result.stderr || '').trim();
    const exitCode = result.error ? -1 : (result.status ?? -1);
    const errorMsg = result.error ? result.error.message : '';

    if (exitCode === 0) {
      const detail = `exit 0${stdout ? ' | stdout: ' + stdout.slice(0, 200) : ''}`;
      log(`  成功: ${detail}`);
      return { ok: true, detail, attempt };
    }

    const failDetail = result.error
      ? `错误: ${errorMsg}`
      : `exit ${exitCode}${stderr ? ' | stderr: ' + stderr.slice(0, 200) : ''}${stdout ? ' | stdout: ' + stdout.slice(0, 200) : ''}`;

    log(`  失败 (attempt ${attempt}): ${failDetail}`);

    if (attempt <= maxRetries) {
      log(`  等待 5s 后重试…`);
      spawnSync('node', ['-e', ''], { timeout: 5000 });
    } else {
      return { ok: false, detail: failDetail, attempt };
    }
  }
}

// ─── 诊断 → 白名单命令映射 ──────────────────────────────────────────

/**
 * ops-check 结果标签 → 白名单命令名的映射表。
 * 按优先级排序：排在前面的先执行。
 */
const DIAGNOSIS_TO_COMMAND = [
  { label: 'Docker/crawl4ai', command: 'docker-restart' },
  { label: 'node_modules', command: 'npm-install' },
  { label: '今日 pipeline', command: 'restart-pipeline' },
  { label: 'Pipeline 日志', command: 'restart-pipeline' },
];

/**
 * 根据诊断失败列表，决定要执行的白名单命令（去重、有序）。
 * @param {Array<{label: string, ok: boolean|null, detail: string}>} failedChecks
 * @param {Object<string, Object>} commands 白名单中的命令定义
 * @returns {Array<string>} 命令名列表
 */
function mapDiagnosisToCommands(failedChecks, commands) {
  if (!failedChecks || failedChecks.length === 0) return [];

  const cmdSet = new Set();

  for (const check of failedChecks) {
    const mapping = DIAGNOSIS_TO_COMMAND.find(m =>
      check.label.includes(m.label) || m.label.includes(check.label)
    );
    if (mapping && commands[mapping.command]) {
      cmdSet.add(mapping.command);
    }
  }

  // 如果没有映射到任何命令，尝试通用恢复流程
  if (cmdSet.size === 0) {
    if (commands['git-pull']) cmdSet.add('git-pull');
    if (commands['restart-pipeline']) cmdSet.add('restart-pipeline');
  }

  return [...cmdSet];
}

// ─── 导出：diagnose() ───────────────────────────────────────────────

/**
 * 运行 ops-check.js 诊断并返回结构化结果。
 * 模块导入时可用。
 *
 * @param {{light?: boolean}} opts
 * @returns {{ok: boolean, summary: object, results: Array, exitCode: number}}
 */
function diagnose(opts = {}) {
  const args = opts.light ? ['--light'] : [];
  log('诊断: node scripts/ops-check.js' + (args.length ? ' ' + args.join(' ') : ''));

  const result = spawnSync('node', [OPS_CHECK_SCRIPT, ...args], {
    encoding: 'utf8',
    timeout: 60000,
    cwd: ROOT,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const stdout = (result.stdout || '').trim();
  const stderr = (result.stderr || '').trim();
  const exitCode = result.error ? -1 : (result.status ?? -1);

  // 尝试从 ops-check 的输出 JSON 文件读取结构化结果
  const opsCheckJson = path.join(ROOT, 'logs', '.ops-check.json');
  let parsed = null;
  try {
    if (fs.existsSync(opsCheckJson)) {
      parsed = JSON.parse(fs.readFileSync(opsCheckJson, 'utf8'));
    }
  } catch {
    // JSON 解析失败，使用 stdout 作为原始结果
  }

  if (!parsed) {
    return {
      ok: exitCode === 0,
      exitCode,
      summary: { ok: exitCode === 0 ? 1 : 0, failed: exitCode === 0 ? 0 : 1, skipped: 0 },
      results: [{ label: 'ops-check', ok: exitCode === 0, detail: stdout.slice(0, 500) }],
      rawStdout: stdout,
      rawStderr: stderr,
    };
  }

  return {
    ok: parsed.status === 'healthy' && exitCode === 0,
    exitCode,
    status: parsed.status,
    summary: parsed.summary,
    results: parsed.results || [],
    rawStdout: stdout,
    rawStderr: stderr,
  };
}

// ─── 导出：heal(diagnosis) ──────────────────────────────────────────

/**
 * 根据诊断结果执行自愈。
 * 模块导入时可用。
 *
 * @param {object} diagnosis - diagnose() 的返回值
 * @returns {{healed: boolean, fixes: Array, reason?: string}}
 */
function heal(diagnosis) {
  const whitelist = loadWhitelist();
  if (!whitelist) {
    return { healed: false, reason: '无法加载白名单' };
  }

  // 检查每日限额
  const limit = checkDailyLimit(whitelist);
  if (!limit.allowed) {
    log(`自愈限额已用尽: ${limit.reason}`);
    return { healed: false, reason: limit.reason };
  }

  const failedChecks = (diagnosis.results || []).filter(r => r.ok === false);
  if (failedChecks.length === 0) {
    log('诊断未发现失败项，无需修复');
    return { healed: true, fixes: [], reason: 'all checks passed' };
  }

  log(`发现 ${failedChecks.length} 项失败: ${failedChecks.map(f => f.label).join(', ')}`);

  const commandNames = mapDiagnosisToCommands(failedChecks, whitelist.commands);
  if (commandNames.length === 0) {
    log('没有匹配的自愈命令');
    return { healed: false, fixes: [], reason: 'no matching heal commands' };
  }

  log(`将执行 ${commandNames.length} 个修复命令: ${commandNames.join(', ')}`);

  const fixResults = [];
  let allHealed = true;

  for (const cmdName of commandNames) {
    const cmdDef = whitelist.commands[cmdName];
    if (!cmdDef) {
      fixResults.push({ name: cmdName, ok: false, detail: '命令不在白名单中' });
      allHealed = false;
      continue;
    }

    const result = executeCommand(cmdDef);
    fixResults.push({
      name: cmdName,
      ok: result.ok,
      detail: result.detail,
      attempt: result.attempt,
    });
    recordFix(cmdName, result.ok, result.detail);

    if (!result.ok) {
      allHealed = false;
      // 连续失败不阻断后续命令（best-effort）
    }
  }

  return {
    healed: allHealed,
    fixes: fixResults,
    reason: allHealed ? 'all fixes applied' : `${fixResults.filter(f => !f.ok).length} fixes failed`,
  };
}

// ─── 检查今日 pipeline 状态 ─────────────────────────────────────────

function checkTodayPipelineStatus() {
  const lastRun = loadLastRun();
  const today = localDate();

  if (!lastRun) {
    log(`.last-run.json 不存在，pipeline 可能从未运行`);
    return { ranToday: false, ok: false, reason: 'no .last-run.json' };
  }

  if (lastRun.date !== today) {
    log(`pipeline 今天 (${today}) 尚未运行，上次: ${lastRun.date} (${lastRun.ranAt})`);
    return { ranToday: false, ok: false, reason: `last run was ${lastRun.date}` };
  }

  // 今天已跑过
  if (lastRun.crawl4aiOk !== false) {
    log(`pipeline 今天已成功运行 (${lastRun.ranAt})`);
    return { ranToday: true, ok: true, reason: `ran at ${lastRun.ranAt}` };
  }

  log(`pipeline 今天已运行但状态为 degraded (${lastRun.ranAt}, reason: ${lastRun.reason})`);
  return { ranToday: true, ok: false, reason: lastRun.reason || 'degraded' };
}

// ─── main（入口）─────────────────────────────────────────────────────

async function main() {
  log('=== AI News Monitor · Auto Heal ===');
  log(`时间: ${new Date().toLocaleString('zh-CN')}`);

  // Step 1: 检查 pipeline 今天是否已成功运行
  const status = checkTodayPipelineStatus();

  if (status.ok) {
    log('今天 pipeline 已成功运行，无需修复');
    process.exit(0);
  }

  // Step 2: 检查白名单是否存在
  const whitelist = loadWhitelist();
  if (!whitelist) {
    log('白名单无效或缺失，无法继续自愈');
    process.exit(1);
  }

  // Step 3: 检查每日限额
  const limit = checkDailyLimit(whitelist);
  if (!limit.allowed) {
    log(`自愈限额已用尽: ${limit.reason}`);
    process.exit(1);
  }

  // Step 4: 运行诊断
  log('运行 ops-check 诊断…');
  const diagnosis = diagnose({ light: false });

  if (!diagnosis.ok || status.ok === false) {
    // Step 5: 执行自愈
    const result = heal(diagnosis);

    // 写入最终状态
    writeAutoHealLog({
      ...loadAutoHealState(),
      lastHealAttempt: ts(),
      lastHealResult: result,
    });

    if (result.healed) {
      log('✅ 所有修复命令执行成功');
      process.exit(0);
    } else {
      log(`❌ 修复未完全成功: ${result.reason}`);
      process.exit(1);
    }
  }

  // 理论上不会走到这里（因为前面已经检查了 status.ok）
  process.exit(0);
}

// ─── 模块守卫 ───────────────────────────────────────────────────────

if (require.main === module) {
  main().catch(err => {
    log(`未捕获异常: ${err.message}`);
    if (err.stack) console.error(err.stack);
    process.exit(2);
  });
}

// ─── 模块导出 ───────────────────────────────────────────────────────

module.exports = {
  diagnose,
  heal,
  mapDiagnosisToCommands,
  checkTodayPipelineStatus,
  loadWhitelist,
  loadLastRun,
  checkDailyLimit,
  executeCommand,
  recordFix,
  loadAutoHealState,
  writeAutoHealLog,
  DIAGNOSIS_TO_COMMAND,
};
