#!/usr/bin/env node
// git-commit.js — 提交快捷命令：校验信息格式 → 暂存 → 提交 →（可选）推送
//
// 用法（仓库根目录）:
//   node scripts/git-commit.js "refactor: 描述"
//   node scripts/git-commit.js "fix(frontend): 描述" -a      # 先 git add -A 全部暂存
//   node scripts/git-commit.js "docs: 描述" -p                # 提交后推送到 origin
//   node scripts/git-commit.js --amend                        # 改写最近一次提交（沿用原信息）
//   node scripts/git-commit.js "docs: 描述" -n                # 跳过 pre-commit 全套检查（仍拦 .env*）
//   node scripts/git-commit.js "docs: 描述" --dry-run         # 演练，不真正提交
//   node scripts/git-commit.js --generate                     # AI 分析 diff 自动生成 commit message
//   node scripts/git-commit.js --generate --json              # 同上，输出 JSON 供 AI 读取
//
// npm 快捷方式：npm run commit -- "refactor: 描述" -p
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CONVENTIONAL =
  /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([a-z0-9-]+\))?!?: .+/i;

const USAGE = `用法: node scripts/git-commit.js "type(scope): 描述" [选项]
  选项:
    -a, --all      先 git add -A 全部暂存
    -p, --push     提交后推送到 origin
    -n, --no-check 跳过 pre-commit 全套检查（仍拦截 .env* 敏感文件）
        --amend    改写最近一次提交（可带新信息）
        --dry-run  演练：校验/暂存/预览，但不真正提交
  示例:
    node scripts/git-commit.js "refactor: 封装 git 提交快捷命令"
    node scripts/git-commit.js "fix(frontend): 修复头像圆角" -a -p`;

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: 'utf8',
    // 不用 shell：提交信息可能含 /() 等特殊字符，
    // cmd.exe 拼参会被破坏，参数数组必须原样传给 git.exe
    timeout: 300000,
    ...opts,
  });
  if (r.error) {
    console.error(`[git-commit] 命令失败: ${cmd} ${args.join(' ')}\n${r.error.message}`);
    process.exit(2);
  }
  return r;
}

function main() {
  const argv = process.argv.slice(2);
  let message = null;
  let push = false, amend = false, noCheck = false, stageAll = false, dryRun = false;
  let generate = false, jsonMode = false;

  for (const a of argv) {
    switch (a) {
      case '-p': case '--push': push = true; break;
      case '--amend': amend = true; break;
      case '-n': case '--no-check': noCheck = true; break;
      case '-a': case '--all': stageAll = true; break;
      case '--dry-run': dryRun = true; break;
      case '--generate': generate = true; break;
      case '--json': jsonMode = true; break;
      case '-h': case '--help': console.log(USAGE); process.exit(0); break;
      default:
        if (a.startsWith('-')) {
          console.error(`✗ 未知选项: ${a}\n` + USAGE);
          process.exit(1);
        }
        if (message !== null) {
          console.error('✗ 只接受一条提交信息，请用引号包住完整信息。');
          process.exit(1);
        }
        message = a;
    }
  }

  if (!amend && !generate && !message) {
    console.error('✗ 缺少提交信息。\n' + USAGE);
    process.exit(1);
  }
  if (message && !CONVENTIONAL.test(message)) {
    console.warn(
      `⚠ 信息不符合 conventional commit 格式（期望 type(scope): 描述）:\n   ${message}`
    );
  }

  if (stageAll) {
    const s = run('git', ['add', '-A']);
    if (s.status !== 0) process.exit(s.status || 1);
  }

  // 确认有改动
  const st = run('git', ['status', '--porcelain']);
  if (st.status !== 0 || st.stdout.trim() === '') {
    console.error('✗ 没有可提交的改动。');
    process.exit(1);
  }

  // --generate 模式：分析 diff 自动生成 commit message
  if (generate) {
    generateCommitMessage({ push, noCheck, dryRun, jsonMode }).then(() => process.exit(0)).catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
    return;
  }

  // 预览将提交的内容
  console.log('以下改动将提交：');
  console.log(run('git', ['status', '--short']).stdout);

  // 安全门：.env* 永远不许入库（即使 -n 跳过了 hook，这里仍拦截）
  const cached = run('git', ['diff', '--cached', '--name-only']);
  const envFiles = cached.stdout
    .split('\n')
    .filter((f) => f && /(^|[\\/])\.env(\.|$)/.test(f));
  if (envFiles.length) {
    console.error('✗ .env* 敏感文件被暂存，禁止提交：');
    envFiles.forEach((f) => console.error('   ' + f));
    process.exit(1);
  }

  if (dryRun) {
    console.log('（演练模式 --dry-run：以上为预览，未真正提交）');
    process.exit(0);
  }

  const cargs = ['commit'];
  if (noCheck) cargs.push('--no-verify');
  if (amend) cargs.push('--amend', '--no-edit');
  if (message) cargs.push('-m', message);

  const t0 = Date.now();
  const c = run('git', cargs);
  if (c.status !== 0) {
    logUsage('commit_git', false, Date.now() - t0, { mode: 'manual', message: message ? 'provided' : 'amend' });
    process.exit(c.status || 1);
  }

  if (push) {
    const br = run('git', ['branch', '--show-current']).stdout.trim();
    const p = run('git', ['push', 'origin', br]);
    if (p.status !== 0) {
      logUsage('commit_git', false, Date.now() - t0, { mode: 'manual', pushed: false });
      process.exit(p.status || 1);
    }
    console.log(`✓ 已推送 origin/${br}`);
    logUsage('commit_git', true, Date.now() - t0, { mode: 'manual', pushed: true, branch: br });
  } else {
    logUsage('commit_git', true, Date.now() - t0, { mode: 'manual', pushed: false });
  }
  console.log('✓ 提交完成');
}

/** 记录工具使用日志（静默降级）。 */
function logUsage(tool, success, durationMs, meta) {
  try {
    const { logToolUse } = require('../src/tools/usage-logger');
    logToolUse({ tool, trigger: 'ai_call', success, durationMs, meta });
  } catch (e) { /* 日志失败不影响提交 */ }
}

// ── AI 生成 commit message ──────────────────────────────────────────

/**
 * 分析 git diff --cached 的内容范围，用 DeepSeek 生成 conventional commit message。
 * --json 时输出结构化 JSON，否则输出人类可读的推荐信息供确认。
 */
async function generateCommitMessage(opts) {
  const { push, noCheck, dryRun, jsonMode } = opts;

  // 取 diff 摘要（files changed + first 2KB）
  const diffName = run('git', ['diff', '--cached', '--name-only']).stdout.trim();
  const diffStat = run('git', ['diff', '--cached', '--stat']).stdout.trim();
  const diffBody = run('git', ['diff', '--cached', '-U2']).stdout.trim();

  if (!diffName) {
    console.error('✗ 暂存区为空，没有可提交的改动。');
    process.exit(1);
  }

  const changedFiles = diffName.split('\n').filter(Boolean);
  const diffSnippet = diffBody.length > 3000 ? diffBody.slice(0, 3000) + '\n... (truncated)' : diffBody;

  // 调用 DeepSeek 生成
  let generated;
  try {
    const OpenAI = require('openai');
    const { getSecret, DEEPSEEK_BASE_URL, DEEPSEEK_MODEL } = require('../src/config');
    const client = new OpenAI({ apiKey: getSecret('DEEPSEEK_API_KEY'), baseURL: DEEPSEEK_BASE_URL });

    const prompt = [
      '你是一个 Git commit message 生成器。请分析以下 git diff，生成一条 conventional commit 格式的提交信息。',
      '',
      '规则：',
      '- 格式：type(scope): 描述',
      '- type 从以下选：feat / fix / docs / refactor / test / chore / style / ops',
      '- scope 用改动的模块名（如 ai, pipeline, harness, tools, ui, data, config），不超过2层',
      '- 描述用中文，20-50字，说明做了什么、为什么',
      '- 如果改动跨多个无关模块，用最核心的一个',
      '- 如果改动很小（如改注释/修typo），用 chore 或 docs',
      '',
      '文件变更统计：',
      diffStat,
      '',
      'Diff 内容（截取前 3000 字符）：',
      diffSnippet,
      '',
      '请只输出提交信息，不要有任何解释。',
    ].join('\n');

    const resp = await client.chat.completions.create({
      model: DEEPSEEK_MODEL,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 120,
      temperature: 0.3,
    });
    generated = (resp.choices[0].message.content || '').trim()
      .replace(/^["']|["']$/g, '')  // 去掉可能的外层引号
      .replace(/^```[^\n]*\n?/, '').replace(/\n?```$/, '');  // 去掉 markdown 代码块
  } catch (e) {
    console.error(`✗ AI 生成失败: ${e.message}`);
    process.exit(1);
  }

  if (!generated || !CONVENTIONAL.test(generated)) {
    if (jsonMode) {
      console.log(JSON.stringify({
        success: false,
        error: 'AI 生成的信息不符合 conventional commit 格式',
        raw: generated,
        suggestion: '请手动指定 message 参数，或检查 diff 内容是否包含有意义的改动',
      }, null, 2));
    } else {
      console.log(`⚠ AI 生成的信息格式不符合规范，请手动输入。生成的原始内容: "${generated}"`);
      console.log('改动文件:', changedFiles.join(', '));
    }
    process.exit(1);
  }

  if (jsonMode) {
    // 输出结构化 JSON，让 AI 调用方能解析
    console.log(JSON.stringify({
      success: true,
      message: generated,
      type: generated.split(':')[0].split('(')[0],
      scope: (generated.match(/\(([^)]+)\)/) || [])[1] || null,
      changed_files: changedFiles,
      change_count: changedFiles.length,
      diff_stat: diffStat.split('\n').pop() || '',
    }, null, 2));
    // 非 dry-run 时也执行提交
    if (!dryRun) {
      doCommit(generated, { push, noCheck });
    }
    return;
  }

  // 人类可读模式：显示推荐信息
  console.log('\n📋 AI 生成的提交信息:');
  console.log(`   ${generated}`);
  console.log(`\n改动: ${changedFiles.length} 个文件`);
  console.log(diffStat.split('\n').pop() || '');

  if (dryRun) {
    console.log('\n（--dry-run: 以上为预览，未真正提交）');
    console.log('确认后执行: node scripts/git-commit.js "' + generated + '"');
    return;
  }

  doCommit(generated, { push, noCheck });
}

function doCommit(msg, opts) {
  const cargs = ['commit'];
  if (opts.noCheck) cargs.push('--no-verify');
  cargs.push('-m', msg);

  const t0 = Date.now();
  const c = run('git', cargs);
  if (c.status !== 0) {
    logUsage('commit_git', false, Date.now() - t0, { mode: 'generate', message: msg });
    process.exit(c.status || 1);
  }

  if (opts.push) {
    const br = run('git', ['branch', '--show-current']).stdout.trim();
    const p = run('git', ['push', 'origin', br]);
    if (p.status !== 0) {
      logUsage('commit_git', false, Date.now() - t0, { mode: 'generate', pushed: false });
      process.exit(p.status || 1);
    }
    console.log(`✓ 已推送 origin/${br}`);
    logUsage('commit_git', true, Date.now() - t0, { mode: 'generate', pushed: true, branch: br, message: msg });
  } else {
    logUsage('commit_git', true, Date.now() - t0, { mode: 'generate', pushed: false, message: msg });
  }
  console.log(`✓ 提交完成: ${msg}`);
}

main();
