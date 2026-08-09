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
    shell: process.platform === 'win32',
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

  for (const a of argv) {
    switch (a) {
      case '-p': case '--push': push = true; break;
      case '--amend': amend = true; break;
      case '-n': case '--no-check': noCheck = true; break;
      case '-a': case '--all': stageAll = true; break;
      case '--dry-run': dryRun = true; break;
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

  if (!amend && !message) {
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

  const c = run('git', cargs);
  if (c.status !== 0) process.exit(c.status || 1);

  if (push) {
    const br = run('git', ['branch', '--show-current']).stdout.trim();
    const p = run('git', ['push', 'origin', br]);
    if (p.status !== 0) process.exit(p.status || 1);
    console.log(`✓ 已推送 origin/${br}`);
  }
  console.log('✓ 提交完成');
}

main();
