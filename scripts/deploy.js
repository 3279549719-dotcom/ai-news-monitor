#!/usr/bin/env node
/**
 * deploy.js — Vercel 前端标准部署命令（KNOWN_TRAPS 标准姿势固化，2026-08-07 实测）
 *
 * 为什么有它：`vercel deploy client --prod` 在 .vercel 链接错乱时会误建 `client`
 * 项目（2026-08-07 实测，浪费一整个会话）。标准姿势是：
 *   ① 确认 client/.vercel/project.json 的 projectName === ai-news-monitor
 *   ② 从 client/ 目录内 `vercel deploy --prod`
 * 本脚本把「校验链接 → 确认 → 部署」打包成一条命令，杜绝手动折腾构建队列/项目根目录。
 *
 * 用法（仓库根）:
 *   npm run deploy                        # 标准部署（校验 → 确认 → 部署）
 *   node scripts/deploy.js --no-confirm   # 跳过交互确认（自动化/CI）
 *   node scripts/deploy.js --build        # 部署前先本地 npm run build 预检
 *   node scripts/deploy.js --json         # 输出纯 JSON 供 AI 读取
 *
 * 退出码：0 = 部署成功；1 = 校验失败或部署报错；2 = 环境/工具错误
 * 注意：Windows 下 npm 全局 vercel 是 .cmd 包装器，Node spawnSync 无 .exe 可解析，
 *       必须 shell:true。部署参数固定（deploy --prod）无特殊字符，注入风险可忽略。
 */
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ROOT = path.resolve(__dirname, '..');
const CLIENT = path.join(ROOT, 'client');
const LINK_FILE = path.join(CLIENT, '.vercel', 'project.json');
const EXPECTED_PROJECT = 'ai-news-monitor';
const PROD_URL = 'https://ai-news-monitor-silk.vercel.app';

function fail(msg, code = 1) {
  console.error(`✗ ${msg}`);
  process.exit(code);
}

/** 在 client/ 目录跑 vercel（Windows 需 shell:true 才能解析 npm 全局 .cmd）。 */
function runVercel(args, opts = {}) {
  return spawnSync('vercel', args, {
    cwd: CLIENT,
    encoding: 'utf8',
    shell: true,
    timeout: 600000, // 生产构建可能几分钟
    ...opts,
  });
}

function main() {
  const argv = process.argv.slice(2);
  const noConfirm = argv.includes('--no-confirm');
  const jsonMode = argv.includes('--json');
  const doBuild = argv.includes('--build');

  // ① 校验链接到正确项目（防误建 client 项目）
  if (!fs.existsSync(LINK_FILE)) {
    fail(
      `${LINK_FILE} 不存在：项目未链接。\n` +
      `  修复：cd client && vercel link --project ${EXPECTED_PROJECT} --yes`
    );
  }
  let link;
  try {
    link = JSON.parse(fs.readFileSync(LINK_FILE, 'utf8'));
  } catch (e) {
    fail(`无法解析 ${LINK_FILE}: ${e.message}`);
  }
  if (link.projectName !== EXPECTED_PROJECT) {
    fail(
      `链接错误：project.json 的 projectName 是 "${link.projectName}"，期望 "${EXPECTED_PROJECT}"。\n` +
      `  修复：cd client && vercel link --project ${EXPECTED_PROJECT} --yes`
    );
  }

  // ② 部署前本地构建预检（可选）
  if (doBuild) {
    console.log('[deploy] 预检：npm run build …');
    const b = spawnSync('npm', ['run', 'build'], {
      cwd: ROOT,
      encoding: 'utf8',
      shell: process.platform === 'win32',
      stdio: 'inherit',
      timeout: 600000,
    });
    if (b.status !== 0) fail('本地构建失败，终止部署（构建环境变量见 KNOWN_TRAPS）');
  }

  console.log(`[deploy] 目标项目：${EXPECTED_PROJECT}`);
  console.log(`[deploy] 即将从 ${CLIENT} 部署到 production：vercel deploy --prod`);

  const needConfirm = !noConfirm && Boolean(process.stdin.isTTY);
  if (needConfirm) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('确认部署？(y/N) ', (ans) => {
      rl.close();
      if (!/^y/i.test(ans.trim())) {
        console.log('已取消。');
        process.exit(1);
      }
      doDeploy();
    });
    return;
  }

  doDeploy();

  function doDeploy() {
    console.log('[deploy] 部署中（约 1-3 分钟，实时日志见下）…');
    // --json 捕获输出解析部署 URL；默认透传让进度实时可见
    const r = runVercel(['deploy', '--prod'], { stdio: jsonMode ? 'pipe' : 'inherit' });
    if (r.error) fail(`vercel 命令失败: ${r.error.message}`, 2);
    if (r.status !== 0) {
      if (r.stdout) console.error(r.stdout);
      if (r.stderr) console.error(r.stderr);
      fail(`vercel deploy 退出码 ${r.status}，详见上方输出`);
    }
    const url = jsonMode ? /https:\/\/\S+/.exec(r.stdout || '')?.[0] : null;
    if (jsonMode) {
      console.log(JSON.stringify({
        success: true,
        projectName: EXPECTED_PROJECT,
        url: url || PROD_URL,
        note: '构建失败时检查 KNOWN_TRAPS：NPM_CONFIG_REGISTRY / project.json 链接',
      }));
    } else {
      console.log(`✅ 部署成功 → ${url || PROD_URL}`);
    }
  }
}

main();
