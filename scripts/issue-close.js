'use strict';

/**
 * issue-close.js — Issue 自动回写 v1.0
 *
 * 修复成功后自动在对应 GitHub Issue 上评论并关闭。
 *
 * 前提:
 *   - GH_TOKEN 环境变量（或已 `gh auth login`）
 *   - 项目有 GitHub remote
 *
 * 用法:
 *   node scripts/issue-close.js [--dry-run] [--issue 42] [--fix-name "docker-restart"]
 *
 * 导出:
 *   closeIssue(fixRecord) → 返回结构化结果
 *
 * 模块守卫: `if (require.main === module)` — 作为模块导入时不触发执行。
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const AUTO_HEAL_PATH = path.join(ROOT, 'logs', '.auto-heal.json');

/* ===== helpers（ts 改用共享 ops-common；带前缀的 log 保留本地） ===== */

const { tsIso } = require('./lib/ops-common');

function ts() {
  return tsIso(); // 行为不变：原实现就是 toISOString()
}

function log(msg) {
  console.log(`[issue-close] ${ts()} | ${msg}`);
}

/**
 * 从 git remote 获取仓库的 owner/repo。
 * @returns {string|null} e.g. "user/repo"
 */
function getRepoSlug() {
  try {
    const result = spawnSync('gh', ['repo', 'view', '--json', 'nameWithOwner'], {
      encoding: 'utf8',
      timeout: 10000,
      cwd: ROOT,
    });
    if (result.status === 0) {
      const data = JSON.parse(result.stdout);
      return data.nameWithOwner || null;
    }
  } catch {
    // fallthrough
  }

  // fallback: 从 git config 解析
  try {
    const result = spawnSync('git', ['config', '--get', 'remote.origin.url'], {
      encoding: 'utf8',
      timeout: 5000,
      cwd: ROOT,
    });
    const url = (result.stdout || '').trim();
    // https://github.com/owner/repo.git → owner/repo
    // git@github.com:owner/repo.git → owner/repo
    const m = url.match(/github\.com[:/](.+?)(?:\.git)?$/);
    if (m) return m[1];
  } catch {
    // fallthrough
  }

  return null;
}

/**
 * 获取已存在的 open issues（同 repo 内）。
 * @param {string} repoSlug - "owner/repo"
 * @param {string} [label] - 按 label 过滤
 * @returns {Array<{number: number, title: string, state: string}>}
 */
function listOpenIssues(repoSlug, label) {
  try {
    const args = ['issue', 'list', '--repo', repoSlug, '--state', 'open', '--json', 'number,title,state,labels', '--limit', '100'];
    if (label) args.push('--label', label);

    const result = spawnSync('gh', args, {
      encoding: 'utf8',
      timeout: 15000,
      cwd: ROOT,
    });

    if (result.status !== 0) {
      log(`获取 issue 列表失败: ${result.stderr.slice(0, 200)}`);
      return [];
    }

    const issues = JSON.parse(result.stdout);
    return issues.map(issue => ({
      number: issue.number,
      title: issue.title,
      state: issue.state,
      labels: (issue.labels || []).map(l => l.name),
    }));
  } catch (e) {
    log(`解析 issue 列表失败: ${e.message}`);
    return [];
  }
}

/**
 * 通过 label 模糊匹配找到相关的 issue。
 * 匹配规则：label 包含 fixName 关键词
 */
function findRelatedIssue(issues, fixName) {
  if (!fixName || issues.length === 0) return null;

  // 关键词映射
  const keywordMap = {
    'docker-restart': ['docker', 'crawl4ai', '容器'],
    'npm-install': ['依赖', 'dependency', 'npm', 'node_modules'],
    'clear-logs': ['日志', 'logs', '磁盘', 'disk'],
    'restart-pipeline': ['pipeline', '管线', '抓取', 'fetch'],
    'git-pull': ['git', '代码', 'code', '更新'],
  };

  const keywords = keywordMap[fixName] || [fixName];

  for (const issue of issues) {
    const labelMatch = issue.labels.some(l =>
      keywords.some(kw => l.toLowerCase().includes(kw.toLowerCase()))
    );
    const titleMatch = keywords.some(kw =>
      issue.title.toLowerCase().includes(kw.toLowerCase())
    );
    if (labelMatch || titleMatch) return issue;
  }

  return null;
}

/**
 * 加载最近的修复记录。
 * @returns {{fixName: string, success: boolean, detail: string, ts: string}|null}
 */
function loadLastFixRecord() {
  try {
    if (!fs.existsSync(AUTO_HEAL_PATH)) return null;
    const data = JSON.parse(fs.readFileSync(AUTO_HEAL_PATH, 'utf8'));

    if (!data.history || data.history.length === 0) return null;

    // 取最近一条成功的修复
    const successful = data.history.filter(h => h.success);
    if (successful.length === 0) {
      // 尝试取最近一条
      const last = data.history[data.history.length - 1];
      return {
        fixName: last.name,
        success: last.success,
        detail: last.detail,
        ts: last.ts,
      };
    }

    const last = successful[successful.length - 1];
    return {
      fixName: last.name,
      success: last.success,
      detail: last.detail,
      ts: last.ts,
    };
  } catch (e) {
    log(`加载修复记录失败: ${e.message}`);
    return null;
  }
}

/**
 * 生成修复成功评论内容。
 */
function generateCommentBody(fixRecord) {
  const fixName = fixRecord.fixName || 'auto-heal';
  const detail = fixRecord.detail || '';
  const tsStr = new Date(fixRecord.ts || Date.now()).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
  });

  const fixDescMap = {
    'docker-restart': 'Docker 容器 `crawl4ai` 已自动重启',
    'npm-install': '依赖已通过 `npm ci` 自动重新安装',
    'clear-logs': '过期日志已自动清理',
    'restart-pipeline': 'Pipeline 已自动重试并成功',
    'git-pull': '代码已自动拉取最新版本',
  };

  const fixDesc = fixDescMap[fixName] || `自动修复 "${fixName}" 已执行`;

  return [
    `## ✅ 自动修复完成`,
    ``,
    `- **修复操作**: ${fixDesc}`,
    `- **执行时间**: ${tsStr}`,
    `- **详情**: ${detail || '修复成功，无异常'}`,
    ``,
    `---`,
    `*此评论由 ai-news-monitor 运维系统自动生成。*`,
  ].join('\n');
}

/**
 * 生成手动触发修复记录的结构化对象。
 * 用于 `--issue` + `--fix-name` 手动模式。
 */
function createFixRecord(opts) {
  return {
    fixName: opts.fixName || 'manual',
    success: true,
    detail: opts.detail || `手动触发：${opts.fixName}`,
    ts: new Date().toISOString(),
  };
}

/* ===== 核心函数 ===== */

/**
 * 对指定 issue 添加评论。
 * @param {string} repoSlug - "owner/repo"
 * @param {number} issueNumber
 * @param {string} body - 评论内容
 * @param {{dryRun: boolean}} opts
 * @returns {{ok: boolean, commentUrl?: string, detail: string}}
 */
function addComment(repoSlug, issueNumber, body, opts = {}) {
  if (opts.dryRun) {
    log(`[DRY-RUN] 将对 issue #${issueNumber} 添加评论`);
    log(`[DRY-RUN] 评论内容:\n${body.slice(0, 500)}`);
    return { ok: true, detail: `dry-run: 评论已生成但未发布` };
  }

  try {
    const result = spawnSync('gh', [
      'issue', 'comment', String(issueNumber),
      '--repo', repoSlug,
      '--body', body,
    ], {
      encoding: 'utf8',
      timeout: 15000,
      cwd: ROOT,
    });

    if (result.status !== 0) {
      const errMsg = (result.stderr || '').slice(0, 300);
      log(`添加评论失败: ${errMsg}`);
      return { ok: false, detail: `gh CLI 错误: ${errMsg}` };
    }

    // gh output: url of the comment
    const commentUrl = (result.stdout || '').trim();
    log(`评论已发布: ${commentUrl}`);
    return { ok: true, commentUrl: commentUrl || `#${issueNumber}`, detail: '评论已发布' };
  } catch (e) {
    log(`添加评论异常: ${e.message}`);
    return { ok: false, detail: e.message };
  }
}

/**
 * 关闭指定 issue。
 * @param {string} repoSlug
 * @param {number} issueNumber
 * @param {string} [reason] - "completed" | "not planned"
 * @param {{dryRun: boolean}} opts
 * @returns {{ok: boolean, detail: string}}
 */
function closeIssueApi(repoSlug, issueNumber, reason = 'completed', opts = {}) {
  if (opts.dryRun) {
    log(`[DRY-RUN] 将关闭 issue #${issueNumber}（原因: ${reason}）`);
    return { ok: true, detail: `dry-run: issue #${issueNumber} 未关闭（${reason}）` };
  }

  try {
    const result = spawnSync('gh', [
      'issue', 'close', String(issueNumber),
      '--repo', repoSlug,
      '--reason', reason,
    ], {
      encoding: 'utf8',
      timeout: 15000,
      cwd: ROOT,
    });

    if (result.status !== 0) {
      const errMsg = (result.stderr || '').slice(0, 300);
      log(`关闭 issue 失败: ${errMsg}`);
      return { ok: false, detail: `gh CLI 错误: ${errMsg}` };
    }

    log(`Issue #${issueNumber} 已关闭`);
    return { ok: true, detail: `issue #${issueNumber} 已关闭` };
  } catch (e) {
    log(`关闭 issue 异常: ${e.message}`);
    return { ok: false, detail: e.message };
  }
}

/* ===== 导出: closeIssue() ===== */

/**
 * 核心自动回写流程：根据修复记录，查找关联 issue，评论 + 关闭。
 *
 * @param {{
 *   fixName: string,
 *   success: boolean,
 *   detail: string,
 *   ts: string
 * }} fixRecord - 修复记录
 * @param {{
 *   dryRun?: boolean,
 *   repoSlug?: string,
 *   issueNumber?: number,
 *   onlyComment?: boolean,
 * }} [opts] - 选项
 * @returns {{
 *   ok: boolean,
 *   steps: Array<{action: string, ok: boolean, detail: string}>,
 *   issueNumber?: number,
 *   summary: string,
 * }}
 */
function closeIssue(fixRecord, opts = {}) {
  const steps = [];
  const dryRun = opts.dryRun || false;

  if (!fixRecord) {
    return {
      ok: false,
      steps: [{ action: 'validate-record', ok: false, detail: 'fixRecord 为空' }],
      summary: '无效的修复记录',
    };
  }

  // 只处理成功的修复
  if (!fixRecord.success) {
    log(`修复 "${fixRecord.fixName}" 未成功，跳过 issue 回写`);
    return {
      ok: false,
      steps: [{ action: 'validate-record', ok: false, detail: `修复 "${fixRecord.fixName}" 未成功` }],
      summary: `修复未成功，跳过 issue 回写`,
    };
  }

  steps.push({ action: 'validate-record', ok: true, detail: `修复 "${fixRecord.fixName}" 成功` });

  // Step 1: 获取仓库信息
  let repoSlug = opts.repoSlug || null;
  if (!repoSlug) {
    repoSlug = getRepoSlug();
  }

  if (!repoSlug) {
    steps.push({ action: 'get-repo', ok: false, detail: '无法获取 GitHub 仓库信息' });
    return {
      ok: false,
      steps,
      summary: '无法获取 GitHub 仓库信息（需要 git remote 或 GH_TOKEN）',
    };
  }
  steps.push({ action: 'get-repo', ok: true, detail: `仓库: ${repoSlug}` });

  // Step 2: 查找相关 issue
  let targetIssue = null;

  if (opts.issueNumber) {
    // 直接指定 issue
    targetIssue = { number: opts.issueNumber };
    steps.push({ action: 'find-issue', ok: true, detail: `指定 issue #${opts.issueNumber}` });
  } else {
    // 自动查找
    const label = `auto-heal${fixRecord.fixName ? `,${fixRecord.fixName}` : ''}`;
    const openIssues = listOpenIssues(repoSlug, null); // 获取所有 open issues
    targetIssue = findRelatedIssue(openIssues, fixRecord.fixName);

    if (targetIssue) {
      steps.push({
        action: 'find-issue',
        ok: true,
        detail: `找到关联 issue #${targetIssue.number}: "${targetIssue.title}"`,
      });
    } else {
      steps.push({
        action: 'find-issue',
        ok: true,
        detail: '未找到关联 issue（将只评论，不关闭）',
      });
    }
  }

  // Step 3: 生成评论并发布
  const commentBody = generateCommentBody(fixRecord);

  // 如果有 target issue，评论到该 issue
  if (targetIssue) {
    const commentResult = addComment(repoSlug, targetIssue.number, commentBody, { dryRun });
    steps.push({
      action: 'add-comment',
      ok: commentResult.ok,
      detail: commentResult.detail,
    });

    // Step 4: 关闭 issue
    if (!opts.onlyComment) {
      const closeResult = closeIssueApi(repoSlug, targetIssue.number, 'completed', { dryRun });
      steps.push({
        action: 'close-issue',
        ok: closeResult.ok,
        detail: closeResult.detail,
      });
    }

    const allOk = steps.every(s => s.ok !== false);
    return {
      ok: allOk,
      steps,
      issueNumber: targetIssue.number,
      summary: allOk
        ? `Issue #${targetIssue.number} 已评论${opts.onlyComment ? '' : '并关闭'}`
        : `Issue #${targetIssue.number} 回写部分失败`,
    };
  }

  // 没有找到关联 issue，创建已修复通知 comment 到通用 issue 或 log
  steps.push({
    action: 'no-issue',
    ok: true,
    detail: `无关联 issue，修复记录已保存到 ${AUTO_HEAL_PATH}`,
  });

  return {
    ok: true,
    steps,
    summary: `无关联 issue 需要关闭，修复 "${fixRecord.fixName}" 已记录`,
  };
}

/* ===== 模块守卫 ===== */

if (require.main === module) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const onlyComment = args.includes('--only-comment');

  // 解析 --issue N
  let issueNumber = null;
  const issueIdx = args.indexOf('--issue');
  if (issueIdx >= 0 && args[issueIdx + 1]) {
    issueNumber = parseInt(args[issueIdx + 1], 10);
  }

  // 解析 --fix-name "xxx"
  let fixName = null;
  const fixIdx = args.indexOf('--fix-name');
  if (fixIdx >= 0 && args[fixIdx + 1]) {
    fixName = args[fixIdx + 1];
  }

  // 解析 --detail "xxx"
  let detail = null;
  const detailIdx = args.indexOf('--detail');
  if (detailIdx >= 0 && args[detailIdx + 1]) {
    detail = args[detailIdx + 1];
  }

  async function main() {
    log(`=== AI News Monitor · Issue 自动回写 ===`);
    log(`模式: ${dryRun ? 'DRY-RUN（预览）' : '正式执行'}`);
    log(`时间: ${new Date().toLocaleString('zh-CN')}`);

    let fixRecord;

    if (fixName) {
      // 手动模式：构造修复记录
      fixRecord = createFixRecord({ fixName, detail });
      log(`手动模式: 修复操作 = "${fixName}", detail = "${detail || '(无)'}"`);
    } else {
      // 自动模式：从 auto-heal 日志读取
      fixRecord = loadLastFixRecord();
      if (!fixRecord) {
        log('未找到修复记录（logs/.auto-heal.json 不存在或无历史）');
        process.exit(1);
      }
      log(`自动模式: 加载最近修复 — "${fixRecord.fixName}" (${fixRecord.ts})`);
    }

    const result = closeIssue(fixRecord, {
      dryRun,
      issueNumber,
      onlyComment,
    });

    console.log('\n--- 结果 ---');
    console.log(`状态: ${result.ok ? '✅ 成功' : '❌ 失败'}`);
    console.log(`摘要: ${result.summary}`);
    console.log('\n步骤明细:');
    for (const step of result.steps) {
      const icon = step.ok ? '✅' : '❌';
      console.log(`  ${icon} ${step.action}: ${step.detail}`);
    }

    process.exit(result.ok ? 0 : 1);
  }

  main().catch(err => {
    log(`未捕获异常: ${err.message}`);
    if (err.stack) console.error(err.stack);
    process.exit(2);
  });
}

/* ===== 模块导出 ===== */

module.exports = {
  closeIssue,
  getRepoSlug,
  listOpenIssues,
  findRelatedIssue,
  addComment,
  closeIssueApi,
  loadLastFixRecord,
  createFixRecord,
  generateCommentBody,
};
