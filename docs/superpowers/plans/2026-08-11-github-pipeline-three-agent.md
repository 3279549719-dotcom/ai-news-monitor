# 管线搬 GitHub（纯 CI）+ 三代理文件交接验证 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把每日 08:00 定时管线从 Windows 任务计划搬到 GitHub Actions（纯 CI，`daily-pipeline.yml` + 动态 crawl4ai 容器），并**在同一过程中实战验证 Planner → Generator → Evaluator 三代理的文件交接协议**——让"不同 agent 通过文档握手"从文档设计变成可观察的真实产物（PLAN → GENERATOR_DONE → REVIEW 全程落盘、提交、可回看）。

**Architecture:** ① GitHub Actions `ubuntu-latest` job 内 `docker run` 动态启动 crawl4ai 容器 → 健康检查 → `node scripts/run-pipeline.js --ci` 跑完整管线（crawl4ai 失败自动降级 scraper-direct + 告警）；② `run-pipeline.js` 加 `--ci` 模式（跳过 `docker start`/Windows 引擎重启、curl 输出 `/dev/null`、跳过日志 auto-push），本地 Windows 行为不变；③ 三代理在 `.worktrees/experiment-gha` 同一 worktree 内以「主会话=Planner + subagent=Generator/Evaluator + 文件交接」形态执行（自审评估偏差 2 的既定范围：先验证协议，不追求独立 brain）。

**Tech Stack:** GitHub Actions (`ubuntu-latest`)、Docker（crawl4ai 容器 `unclecode/crawl4ai`，端口 11235）、Node 22 + CommonJS、`gh` CLI、actionlint、Supabase service key、DeepSeek。

---

## Global Constraints

- **纯 Actions**：Windows 任务计划 + 本地自愈（`install-schedule.js` / `restart-docker-engine.ps1` / `self-heal.js`）在 CI **不用**；本地开发仍保留（DECISION §2.2 退役清单）。
- **crawl4ai 主通道不变**：不换 Firecrawl；CI 内 job 动态 `docker run`，失败 → 有限重试 → 降级 `scraper-direct.js` + 告警（DECISION §2.1）。
- **X/twikit 在 CI 跳过**：`X_TWIKIT_ENABLED=0`（runner 无法交互登录，范围边界）。
- **cron 用 UTC**：`0 0 * * *` = 北京 08:00（GitHub Actions schedule 走 UTC）。
- **密钥走 GitHub Secrets**：`DEEPSEEK_API_KEY`、`SUPABASE_URL`、`SUPABASE_SERVICE_KEY`、`CRAWL4AI_API_TOKEN`、`SMTP_*`、`EMAIL_USER`、`EMAIL_AUTH_CODE`、`RECEIVER_EMAIL` 等；**任何步骤不得把 .env 值回显到日志/注释**。非敏感用 Variables（`EMAIL_ENABLED`）。
- **后端 CommonJS**，只改任务内文件，不顺手重构。
- **`npm run check` 全绿**是每个交付阶段的回归闸门（基线 113 tests）。
- **工作区**：所有 3 代理产物与代码改动在 `.worktrees/experiment-gha`（分支 `feat/experiment-gha-pipeline`），先同步 master 最新 2 个 fix(ops) 提交。
- **交接文档命名**（DECISION §三）：`docs/PLAN-管线搬GitHub.md`、`docs/SPRINT-20260811-github-pipeline.md`、`docs/PLANNER_DONE.md`、`docs/GENERATOR_DONE.md`、`docs/REVIEW-20260811-github-pipeline.md`。
- **push 铁律**（AGENTS.md）：先 `git fetch origin` → 评估分叉 → `git pull --rebase` 再 push，禁止 force-push。推送到远端 = 用户已授权（本次任务本身即是"搬到 GitHub"）。

---

## File Structure

**新建：**
- `.github/workflows/daily-pipeline.yml` — 每日管线（cron + dispatch + 动态 crawl4ai + 失败建 Issue）
- `.github/workflows/crawl4ai-smoke.yml` — 一次性镜像冒烟（dispatch 触发，验证 `unclecode/crawl4ai` 独立启动）
- `scripts/run-pipeline.test.js` — `--ci` 模式纯函数单测
- `docs/PLAN-管线搬GitHub.md`、`docs/SPRINT-20260811-github-pipeline.md`、`docs/PLANNER_DONE.md`、`docs/GENERATOR_DONE.md`、`docs/REVIEW-20260811-github-pipeline.md` — 三代理交接产物

**修改：**
- `scripts/run-pipeline.js:26-29,92-120,144-175,232-250` — 加 `--ci`：`parseArgs` 提取、`healthCheckOutputPath` 跨平台、CI 分支只健康检查、autoPush 守卫
- `package.json:23` — test glob 增加 `"scripts/*.test.js"`
- `.gitignore` — 加 `.worktrees/`、`.loop-js.tmp`（未跟踪杂项不入库）
- `CLAUDE.md` / `DOCUMENT_MAP.md` / `docs/PROGRESS.md` / `docs/KNOWN_TRAPS.md` — 文档同步（Phase 5）

---

## 阶段 0：基线（主会话，进入实验 worktree 前）

### Task 0: 提交未跟踪项目文档 + .gitignore 清理 + 同步实验分支

**Files:**
- Modify: `.gitignore`
- Modify: `package.json`（本任务只动 .gitignore；package.json 归 Task 2.2）
- Commit: master 上未跟踪的项目文档（`docs/DECISION-*.md`、`docs/HANDOFF-20260811.md`、`docs/REQ-三代理工作流-P0双任务.md`、`docs/SPRINT-*.md`、`docs/SPRINT_CONTRACT_TEMPLATE.md`、`docs/REVIEW.md.template`、`flowchart/`）

**Interfaces:**
- Consumes: 无
- Produces: master 干净（无 `??` 项目文档）；`.gitignore` 忽略 `.worktrees/`、`.loop-js.tmp`；`feat/experiment-gha-pipeline` fast-forward 到 master `a3fc6ec`

- [ ] **Step 1: 补 .gitignore**

在 `.gitignore` 末尾追加：

```
.worktrees/
.loop-js.tmp
scripts/_check-*.js
scripts/_verify-e2e.js
```

- [ ] **Step 2: 用 `npm run commit` 提交项目文档（只暂存本次工作）**

Run（在 master 主目录）:
```bash
git add docs/DECISION-三代理架构-自审评估.md docs/DECISION-管线搬GitHub-纯CI方案.md docs/HANDOFF-20260811.md docs/REQ-三代理工作流-P0双任务.md docs/SPRINT-20260811-breaking-news-push.md docs/SPRINT-20260811-pipeline-self-heal.md docs/SPRINT_CONTRACT_TEMPLATE.md docs/REVIEW.md.template flowchart/ .gitignore
git diff --cached --name-only
npm run commit -- "docs: 落盘三代理 DECISION + GitHub 迁移方案 + 交接模板"
```
Expected: 提交成功；`git status` 只剩 `client/.gitignore`、`client/public/`、`scripts/_*.js` 等杂项（Step 1 已忽略 `_check-*`）。

- [ ] **Step 3: 同步实验分支**

Run:
```bash
git -C "E:/claude/ai-news-monitor/.worktrees/experiment-gha" merge master
git -C "E:/claude/ai-news-monitor/.worktrees/experiment-gha" log --oneline -3
```
Expected: fast-forward 到 `a3fc6ec`（master 的 `a96c5e8`/`a3fc6ec` 两个 fix(ops) 提交进入实验分支）。**不 push**（等 Evaluator PASS 后统一推）。

- [ ] **Step 4: 记录 KNOWN_TRAPS 新坑（若有）**

如 Step 2/3 遇到新报错，先查 `docs/KNOWN_TRAPS.md` 再处理；新坑记录进去。

- [ ] **Step 5: Commit（若 Step 4 改动了 KNOWN_TRAPS）**

```bash
git add docs/KNOWN_TRAPS.md && npm run commit -- "docs: 记录 KNOWN_TRAPS"
```

---

## 阶段 1：Planner（主会话）

> 范围：产出 Generator 消费的 Plan + Sprint Contract + 交接信号。**本计划本身即为 Planner 的主要产物**，Task 1.1 把它收敛成 Generator 面向的规范文档。

### Task 1.1: 写 `docs/PLAN-管线搬GitHub.md`

**Files:**
- Create: `docs/PLAN-管线搬GitHub.md`（实验 worktree 内）

**Interfaces:**
- Consumes: 本计划 Phase 2 的规范（daily-pipeline.yml 全文 + run-pipeline.js diff 说明 + 风险清单）、DECISION-管线搬GitHub、REQ-三代理工作流、CLAUDE.md/DOCUMENT_MAP
- Produces: `docs/PLAN-管线搬GitHub.md`（Generator 唯一依据；含具体 YAML 与代码修改规范，无占位符）

- [ ] **Step 1: 读入上下文**

```bash
cd "E:/claude/ai-news-monitor/.worktrees/experiment-gha"
```
读：`CLAUDE.md`、`docs/DECISION-管线搬GitHub-纯CI方案.md`、`docs/REQ-三代理工作流-P0双任务.md`、`scripts/run-pipeline.js`、`.github/workflows/ops-check.yml`。

- [ ] **Step 2: 写 PLAN 文档**

把本计划的 **Phase 2 规范**（Task 2.2 的 run-pipeline.js diff、Task 2.3 的 daily-pipeline.yml 全文、Task 2.4 的 smoke 工作流、Global Constraints、风险与回滚）整理成 Generator 可直接照做的 `docs/PLAN-管线搬GitHub.md`。要求：
- 每个改动文件给出「改前关键行 → 改后代码」
- 无 "TBD/TODO/后续处理" 占位；风险表含回滚方式
- 明确列出「验收命令」：`npm run check`、`node --check scripts/run-pipeline.js`、actionlint

- [ ] **Step 3: 自查**：确认 PLAN 覆盖 DECISION 三个决策（纯 Actions / CI 无自愈 / X 跳过）且不含本地 Windows 自愈内容。

### Task 1.2: 写 `docs/SPRINT-20260811-github-pipeline.md`

**Files:**
- Create: `docs/SPRINT-20260811-github-pipeline.md`（基于 `docs/SPRINT_CONTRACT_TEMPLATE.md`）

**Interfaces:**
- Consumes: `docs/SPRINT_CONTRACT_TEMPLATE.md`、Task 1.1 的 PLAN
- Produces: 任务"完成"定义（§1 声明 + §2 Evaluator 审核清单预填 + §1.4 风险回滚）

- [ ] **Step 1: 依模板写 Sprint Contract**

按 `SPRINT_CONTRACT_TEMPLATE.md` 结构填写：
- §1.1 我要构建什么：CI 每日管线 + run-pipeline `--ci`，本地行为不变
- §1.2 验证：正常路径 = `npm run check` + `node --check` + actionlint + 手动 `workflow_dispatch` 全绿；边界 = crawl4ai 容器不可用降级 + 邮件告警、X 源跳过
- §1.3 本次不做：不移植自愈、不处理 X 登录、不改数据表、不做 breaking-check 轮询
- §1.4 风险：crawl4ai 镜像在 runner 上独立启动失败 → 冒烟工作流先行验证，失败回滚 = 恢复 `run-pipeline.js` 原样 + 暂缓 CI
- §2 审核清单 C1-C3 / V1-V4 / S1-S3 逐项预填判定标准

- [ ] **Step 2: 复核**：V3 回归闸门必须含 `npm run check`；S3 必须含"Secret 值不回显"。

### Task 1.3: 写 `docs/PLANNER_DONE.md` 交接信号

**Files:**
- Create: `docs/PLANNER_DONE.md`

**Interfaces:**
- Consumes: Task 1.1/1.2 产物
- Produces: 交给 Generator 的握手文件（状态、产物路径、待办、已知风险、验收命令）

- [ ] **Step 1: 写交接**

内容模板（无占位）：
```markdown
# PLANNER_DONE — 管线搬 GitHub

> 状态: PLANNER 完成 ｜ 日期: 2026-08-11 ｜ 产出: [PLAN](PLAN-管线搬GitHub.md) + [SPRINT](SPRINT-20260811-github-pipeline.md)

Generator 请按 PLAN 执行；完成定义见 SPRINT §1.2。验收命令：
- npm run check（基线 113 tests，不得减少）
- node --check scripts/run-pipeline.js
- npx --yes actionlint .github/workflows/daily-pipeline.yml .github/workflows/crawl4ai-smoke.yml
- 交付后写 GENERATOR_DONE.md（含上述命令的真实输出，A4 证据）

已知风险：crawl4ai 镜像 runner 独立启动未验证 → Generator 先做 smoke。不回显 .env 值。
```

- [ ] **Step 2: 提交三份 Planner 产物**

```bash
git add docs/PLAN-管线搬GitHub.md docs/SPRINT-20260811-github-pipeline.md docs/PLANNER_DONE.md
git diff --cached --name-only
npm run commit -- "docs(planner): 管线搬GitHub PLAN + Sprint Contract + 交接信号"
```

---

## 阶段 2：Generator（独立 subagent，本阶段单独派发）

> 派发时给 subagent 的 prompt 要点：只读 `docs/PLANNER_DONE.md` 开始的 3 份文档 + 目标文件，不读本计划；CommonJS；`npm run check` 基线 113 tests；交接物 = 代码 + `GENERATOR_DONE.md`。

### Task 2.1: 定位代码 + 确认现状

**Files:**
- Read: `scripts/run-pipeline.js`、`src/config.js`、`src/crawl4ai-fetch.js`（健康检查端点）、`.github/workflows/ops-check.yml`、`docs/KNOWN_TRAPS.md`

**Interfaces:**
- Consumes: PLANNER_DONE + PLAN + SPRINT
- Produces: 对 run-pipeline.js 改动点的精确行号清单（写进 GENERATOR_DONE 备查）

- [ ] **Step 1: 通读目标文件**，在笔记中记录 run-pipeline.js 的 `dockerStart`（62-90）、`checkCrawl4aiHealth`（92-120，`-o nul`）、`ensureCrawl4ai`（144-175）、`autoPushLogs`（232-250）现状。
- [ ] **Step 2: 确认 ops-check.yml secret 语法已修复**：`grep -n 'secrets.SUPABASE_SERVICE_KEY' .github/workflows/ops-check.yml` → 应形如 `${{ secrets.SUPABASE_SERVICE_KEY }}`（DECISION §2.4 遗留项，master 上已由 fix(ops) 修复，仅需确认）。

### Task 2.2: run-pipeline.js `--ci` 模式（TDD：先写失败测试）

**Files:**
- Modify: `scripts/run-pipeline.js:26-29,92-120,144-175,232-250`
- Create: `scripts/run-pipeline.test.js`
- Modify: `package.json:23`

**Interfaces:**
- Consumes: Task 2.1 行号定位
- Produces: 导出 `parseArgs(argv)` 与 `healthCheckOutputPath(platform?)`（供单测）；`--ci` 行为（见下）

- [ ] **Step 1: 写失败测试** `scripts/run-pipeline.test.js`

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseArgs, healthCheckOutputPath } = require('./run-pipeline');

test('parseArgs: --ci → ci=true', () => {
  assert.strictEqual(parseArgs(['node', 'run-pipeline.js', '--ci']).ci, true);
});

test('parseArgs: 无参全 false', () => {
  const a = parseArgs(['node', 'run-pipeline.js']);
  assert.strictEqual(a.ci, false);
  assert.strictEqual(a.noDocker, false);
  assert.strictEqual(a.noAlert, false);
});

test('parseArgs: --no-docker + --no-alert', () => {
  const a = parseArgs(['node', 'run-pipeline.js', '--no-docker', '--no-alert']);
  assert.strictEqual(a.noDocker, true);
  assert.strictEqual(a.noAlert, true);
});

test('healthCheckOutputPath: win32 → nul', () => {
  assert.strictEqual(healthCheckOutputPath('win32'), 'nul');
});

test('healthCheckOutputPath: linux → /dev/null', () => {
  assert.strictEqual(healthCheckOutputPath('linux'), '/dev/null');
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd "E:/claude/ai-news-monitor/.worktrees/experiment-gha"
node --test scripts/run-pipeline.test.js -v
```
Expected: FAIL — `parseArgs`/`healthCheckOutputPath` 未导出。

- [ ] **Step 3: 实现 `--ci`（改 run-pipeline.js）**

把参数解析提取为纯函数（文件顶部，`const args = process.argv.slice(2);` 处）：
```js
/** 解析 CLI 参数（纯函数，便于单测）。 */
function parseArgs(argv) {
  const args = argv.slice(2);
  return {
    ci: args.includes('--ci'),
    noDocker: args.includes('--no-docker'),
    noAlert: args.includes('--no-alert'),
  };
}
const { ci: CI_MODE, noDocker, noAlert } = parseArgs(process.argv);
```
把 curl 输出设备提取为跨平台纯函数：
```js
/** curl -o 输出设备：win32 用 nul，其余平台用 /dev/null。 */
function healthCheckOutputPath(platform = process.platform) {
  return platform === 'win32' ? 'nul' : '/dev/null';
}
```
`checkCrawl4aiHealth` 内 `'-o', 'nul'` → `'-o', healthCheckOutputPath()`。
`ensureCrawl4ai` 顶部加 CI 分支（在 `if (noDocker)` 之后）：
```js
if (CI_MODE) {
  // CI 容器由 workflow job 启动，这里只做健康检查；失败即告警 + 降级，不做 docker start/引擎重启。
  console.log('[pipeline] --ci: 容器由 job 管理，仅健康检查');
  const healthy = checkCrawl4aiHealth();
  if (healthy) {
    console.log('[pipeline] crawl4ai ready ✓ (CI)');
    writeStatusFile(true, 'healthy');
  } else {
    console.error('[pipeline] crawl4ai 健康检查失败(CI)，降级 scraper-direct');
    sendAlertEmail(
      '⚠️ ai-news-monitor: CI crawl4ai 不可用',
      `<p>${ts()} GitHub Actions 中 crawl4ai 健康检查失败，管线已降级运行（scraper-direct）。</p><p><small>— run-pipeline.js --ci</small></p>`,
    );
    writeStatusFile(false, 'unhealthy in CI');
  }
  return healthy;
}
```
`autoPushLogs` 顶部加守卫（CI 日志走 artifact，不回推 git）：
```js
if (CI_MODE) {
  console.log('[pipeline] --ci: 跳过日志 auto-push（由 upload-artifact 承担）');
  return;
}
```
末尾 `module.exports` 追加 `parseArgs, healthCheckOutputPath`。

- [ ] **Step 4: 更新 package.json test glob**

`"test": "node --test \"src/*.test.js\" \"scripts/*.test.js\""`

- [ ] **Step 5: 跑测试确认通过**

```bash
node --test scripts/run-pipeline.test.js -v
npm test   # 113 + 5 = 118 全绿
```
Expected: 新增 5 tests PASS；`npm test` 118/118。

### Task 2.3: 创建 `.github/workflows/daily-pipeline.yml`

**Files:**
- Create: `.github/workflows/daily-pipeline.yml`

**Interfaces:**
- Consumes: PLAN（含 cron/Secret 清单）、`ops-check.yml` 的错误处理模式
- Produces: CI 每日管线（cron `0 0 * * *` + `workflow_dispatch` + 动态 crawl4ai + 失败建 Issue）

- [ ] **Step 1: 写工作流**

```yaml
name: Daily Pipeline

on:
  schedule:
    - cron: '0 0 * * *'   # 北京 08:00 = UTC 00:00
  workflow_dispatch:

permissions:
  contents: read
  issues: write

jobs:
  daily-pipeline:
    runs-on: ubuntu-latest
    timeout-minutes: 45
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'

      - run: npm ci

      - name: Start crawl4ai container (dynamic)
        run: |
          docker run -d --name crawl4ai -p 11235:11235 \
            -e CRAWL4AI_API_TOKEN="${{ secrets.CRAWL4AI_API_TOKEN }}" \
            unclecode/crawl4ai:latest
          for i in $(seq 1 30); do
            if curl -sf http://localhost:11235/health; then
              echo "crawl4ai healthy (${i} checks)"
              exit 0
            fi
            sleep 5
          done
          echo "::error::crawl4ai 150s 内未就绪"
          exit 1

      - name: Run daily pipeline (--ci)
        env:
          DEEPSEEK_API_KEY: ${{ secrets.DEEPSEEK_API_KEY }}
          DEEPSEEK_BASE_URL: ${{ secrets.DEEPSEEK_BASE_URL }}
          DEEPSEEK_MODEL: ${{ secrets.DEEPSEEK_MODEL }}
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
          CRAWL4AI_URL: http://localhost:11235
          CRAWL4AI_API_TOKEN: ${{ secrets.CRAWL4AI_API_TOKEN }}
          X_TWIKIT_ENABLED: '0'
          EMAIL_ENABLED: ${{ vars.EMAIL_ENABLED }}
          SMTP_HOST: ${{ secrets.SMTP_HOST }}
          SMTP_PORT: ${{ secrets.SMTP_PORT }}
          SMTP_SECURE: ${{ secrets.SMTP_SECURE }}
          EMAIL_USER: ${{ secrets.EMAIL_USER }}
          EMAIL_AUTH_CODE: ${{ secrets.EMAIL_AUTH_CODE }}
          RECEIVER_EMAIL: ${{ secrets.RECEIVER_EMAIL }}
        run: node scripts/run-pipeline.js --ci

      - name: Upload pipeline logs
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: pipeline-logs
          path: |
            logs/pipeline-*.log
            logs/.last-run.json
            logs/.seen-ids.json
          retention-days: 7

      - name: Alert on failure (create issue)
        if: failure()
        run: |
          cat > /tmp/issue_body.md << 'BODYEOF'
          ## Daily Pipeline Failed
          Run: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}

          请查看 pipeline-logs artifact 定位失败原因。
          BODYEOF
          gh issue create \
            --title "Daily Pipeline Failed — Run ${{ github.run_id }}" \
            --body-file /tmp/issue_body.md \
            --label "ops" \
            --repo ${{ github.repository }}
        env:
          GH_TOKEN: ${{ github.token }}
```

- [ ] **Step 2: 校验 YAML**：`npx --yes actionlint .github/workflows/daily-pipeline.yml`（Expected: 无输出/exit 0）。

### Task 2.4: 创建 crawl4ai 镜像冒烟工作流

**Files:**
- Create: `.github/workflows/crawl4ai-smoke.yml`

**Interfaces:**
- Consumes: PLAN 风险 1.4
- Produces: 可在真实 runner 上验证 `unclecode/crawl4ai` 独立启动的可复用工具（Phase 4 用它先冒烟再上主管线）

- [ ] **Step 1: 写 smoke 工作流**

```yaml
name: crawl4ai Smoke
on:
  workflow_dispatch:

jobs:
  smoke:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - name: Pull + run + health-check crawl4ai
        run: |
          docker run -d --name crawl4ai -p 11235:11235 \
            -e CRAWL4AI_API_TOKEN="${{ secrets.CRAWL4AI_API_TOKEN }}" \
            unclecode/crawl4ai:latest
          for i in $(seq 1 36); do
            if curl -sf http://localhost:11235/health; then
              echo "CRAWL4AI HEALTHY (${i} checks)"
              docker logs crawl4ai 2>&1 | tail -20
              exit 0
            fi
            sleep 5
          done
          echo "::error::crawl4ai 冒烟失败"
          docker logs crawl4ai 2>&1 | tail -60
          exit 1
```

- [ ] **Step 2: 校验**：`npx --yes actionlint .github/workflows/crawl4ai-smoke.yml`。

### Task 2.5: 本地回归闸门

- [ ] **Step 1: 全量检查**

```bash
node --check scripts/run-pipeline.js
npx --yes actionlint .github/workflows/daily-pipeline.yml .github/workflows/crawl4ai-smoke.yml
npm run check
```
Expected: 全绿；`npm test` 118/118。

- [ ] **Step 2: 如失败**：先查 `docs/KNOWN_TRAPS.md` 再修，如实记录。

### Task 2.6: 写 `docs/GENERATOR_DONE.md` 交接信号（含 A4 证据）

**Files:**
- Create: `docs/GENERATOR_DONE.md`

**Interfaces:**
- Consumes: 上述全部代码产物
- Produces: 交给 Evaluator 的证据文档（改动文件清单 + 每个验证命令的真实输出粘贴 + 偏离 PLAN 的说明）

- [ ] **Step 1: 写 GENERATOR_DONE**：包含 —— 改动/新增文件清单；`node --test scripts/run-pipeline.test.js` 输出；`npm test` 总数；`npm run check` 结果；actionlint 结果；明确列出「待实机验证项」（crawl4ai 镜像 runner 启动、daily-pipeline 首次 dispatch）。

- [ ] **Step 2: 提交 Generator 产物**

```bash
git add .github/workflows/daily-pipeline.yml .github/workflows/crawl4ai-smoke.yml scripts/run-pipeline.js scripts/run-pipeline.test.js package.json docs/GENERATOR_DONE.md
git diff --cached --name-only
npm run commit -- "feat(generator): GitHub Actions 每日管线 + run-pipeline --ci + smoke 工作流"
```

---

## 阶段 3：Evaluator（独立 subagent，本阶段单独派发）

> 派发 prompt 要点：只读 `GENERATOR_DONE.md` + `SPRINT` + `REVIEW.md.template` + 目标文件；**独立复核**，不信任 Generator 的自我声称；按 Sprint Contract §2 清单逐项判定。

### Task 3.1: 通读交接物 + 模板

- [ ] **Step 1**: 读 `docs/GENERATOR_DONE.md`、`docs/SPRINT-20260811-github-pipeline.md`、`docs/REVIEW.md.template`。
- [ ] **Step 2**: 读改动文件：`.github/workflows/daily-pipeline.yml`、`scripts/run-pipeline.js`、`scripts/run-pipeline.test.js`。

### Task 3.2: 独立复核（不跑 Generator 的粘贴，全部重跑）

**Files:**
- Verify: 全部改动文件

**Interfaces:**
- Consumes: GENERATOR_DONE 声明的验证命令
- Produces: 独立的复核结果（命令 + 真实输出）

- [ ] **Step 1: 语法与回归**

```bash
node --check scripts/run-pipeline.js
npm test
npm run check
```
Expected: 全绿，tests ≥ 118。

- [ ] **Step 2: 工作流语义复核**（手工逐条）：
  - cron 为 `0 0 * * *`（北京 08:00）；`workflow_dispatch` 存在（便于手动触发）
  - `docker run` 传了 `-e CRAWL4AI_API_TOKEN`（KNOWN_TRAPS: 不传 token 入口只绑 `[::]` 则端口映射不可达）
  - env 传入 `SUPABASE_SERVICE_KEY`（不是 publishable 的 `SUPABASE_KEY`）；`X_TWIKIT_ENABLED: '0'`
  - `EMAIL_ENABLED` 来自 `vars`（可在 Phase 4 用 `gh variable set` 切换，验证期关、上线开）
  - Secret 名与 `src/config.js` 的 `_secrets`/常量逐一对应（`grep -n` 核对）
  - 失败分支 `if: failure()` + `gh issue create` 建 Issue（对齐 ops-check.yml 模式）

- [ ] **Step 3: Sprint Contract §2 逐项判定**：C1-C3 / V1-V4 / S1-S3 填入 PASS/FAIL + 证据行。

### Task 3.3: 写 `docs/REVIEW-20260811-github-pipeline.md`

**Files:**
- Create: `docs/REVIEW-20260811-github-pipeline.md`

**Interfaces:**
- Consumes: Task 3.2 复核结果
- Produces: 终审结论（PASS / FAIL / BLOCKED）+ 逐项证据 + 遗留风险（含"待实机回归"）

- [ ] **Step 1: 写 REVIEW**：结论 + §C/V/S 判定表 + 每项证据粘贴（真实命令输出）+ 待实机项清单（crawl4ai 冒烟、daily-pipeline dispatch、Supabase 落库抽查）。

- [ ] **Step 2: 结论处理**：
  - PASS → 提交 REVIEW，进入 Phase 4
  - FAIL/BLOCKED → 在 REVIEW 中列不通过项，**回派 Generator**（SendMessage 续上下文）修复后重审，REVIEW 迭代记录不可删

- [ ] **Step 3: 提交**

```bash
git add docs/REVIEW-20260811-github-pipeline.md
npm run commit -- "docs(evaluator): REVIEW 管线搬GitHub CI 方案"
```

---

## 阶段 4：接线 GitHub（主会话执行；Secret 写入前向用户确认一次）

> 前置：Evaluator PASS。此阶段会真实 push 分支、写 Secrets、触发工作流——均属本次任务范围，但 **Secret 写入与首次 dispatch 前向用户口头确认**。

### Task 4.1: 推送实验分支

- [ ] **Step 1: 同步 + 推送**

```bash
git -C "E:/claude/ai-news-monitor/.worktrees/experiment-gha" fetch origin
git -C "E:/claude/ai-news-monitor/.worktrees/experiment-gha" pull --rebase origin master
git -C "E:/claude/ai-news-monitor/.worktrees/experiment-gha" push -u origin feat/experiment-gha-pipeline
```
Expected: push 成功，无 force。

### Task 4.2: 配置 GitHub Secrets（从本地 .env 读，不回显）

- [ ] **Step 1: 确认 .env 键齐全**

Run: `cd "E:/claude/ai-news-monitor" && grep -oE '^(DEEPSEEK_API_KEY|SUPABASE_URL|SUPABASE_SERVICE_KEY|CRAWL4AI_API_TOKEN|SMTP_HOST|SMTP_PORT|SMTP_SECURE|EMAIL_USER|EMAIL_AUTH_CODE|RECEIVER_EMAIL)=' .env`
Expected: 全部键存在（缺则先向用户要）。

- [ ] **Step 2: 写 Secrets（循环，stdin 注入，命令里不回显值）**

```bash
for name in DEEPSEEK_API_KEY DEEPSEEK_BASE_URL DEEPSEEK_MODEL SUPABASE_URL SUPABASE_SERVICE_KEY CRAWL4AI_API_TOKEN SMTP_HOST SMTP_PORT SMTP_SECURE EMAIL_USER EMAIL_AUTH_CODE RECEIVER_EMAIL; do
  val=$(grep "^${name}=" .env | cut -d= -f2- | tr -d '\r')
  if [ -n "$val" ]; then
    printf '%s' "$val" | gh secret set "$name" --repo 3279549719-dotcom/ai-news-monitor
  fi
done
gh variable set EMAIL_ENABLED --repo 3279549719-dotcom/ai-news-monitor --body "false"
```
Expected: 每个 key `✓ Set secret`；`EMAIL_ENABLED` 变量 false（验证期关邮件，防空摘要刷屏，见 feedback 记忆）。

- [ ] **Step 3: 确认不回显**：全程无 `echo $val`；`gh secret list` 只列名。

### Task 4.3: crawl4ai 冒烟（真实 runner）

- [ ] **Step 1: 触发 smoke**

```bash
gh workflow run crawl4ai-smoke.yml --repo 3279549719-dotcom/ai-news-monitor --ref feat/experiment-gha-pipeline
gh run watch --repo 3279549719-dotcom/ai-news-monitor --exit-status
```
Expected: `CRAWL4AI HEALTHY`；失败则查 `docker logs`（KNOWN_TRAPS: 镜像 tag / 端口绑定 / token 必传），修 PLAN 后回 Generator。

### Task 4.4: daily-pipeline 首次 dispatch

- [ ] **Step 1: 触发并观察**

```bash
gh workflow run daily-pipeline.yml --repo 3279549719-dotcom/ai-news-monitor --ref feat/experiment-gha-pipeline
gh run list --repo 3279549719-dotcom/ai-news-monitor --limit 3
gh run watch --repo 3279549719-dotcom/ai-news-monitor --exit-status
```
Expected: job 全绿；`pipeline-logs` artifact 有 `pipeline-*.log` + `.last-run.json`。

### Task 4.5: 落库验证

- [ ] **Step 1: 抽查 Supabase 新增文章**（用 Supabase MCP 或 psql）：
```sql
select keyword_id, count(*) from articles
where created_at > now() - interval '2 hours'
group by keyword_id order by 2 desc;
```
Expected: 有新增行（crawl4ai 主通道抓到白名单信源）。
- [ ] **Step 2: 若无新增**：查 `.last-run.json` 的 `crawl4aiOk`/`reason` 与 pipeline log 的降级行（KNOWN_TRAPS），确认是真实空抓还是通道降级。

---

## 阶段 5：收尾、退役与文档

### Task 5.1: 合入 master + 推送

- [ ] **Step 1**: 在 master 主目录 merge 实验分支（rebase 保线）：

```bash
cd "E:/claude/ai-news-monitor"
git fetch origin
git checkout master
git pull --rebase origin master
git merge --ff-only feat/experiment-gha-pipeline
git push origin master
```
Expected: master = `feat/experiment-gha-pipeline`，push 无分叉。

### Task 5.2: 退役 Windows 定时任务（CI 稳定运行 ≥1 次后）

- [ ] **Step 1**: `npm run ops:unschedule`（卸载 08:00 任务计划；本地脚本保留供开发手动用）。
- [ ] **Step 2**: 确认 `schtasks /query /tn ai-news-monitor-daily` 不存在（Expected: 报错/未找到）。

### Task 5.3: 文档同步

- [ ] **Step 1**: 更新 `CLAUDE.md` 运行节：定时改为「GitHub Actions `daily-pipeline.yml`（北京 08:00）+ `gh workflow run` 手动」；Windows 任务计划标注已退役（仅本地开发手动跑 `npm run ops:run-auto`）。
- [ ] **Step 2**: 更新 `DOCUMENT_MAP.md`（新 workflow + 三代理交接文档登记）；`docs/PROGRESS.md` 完成项 + 遗留项。
- [ ] **Step 3**: `docs/KNOWN_TRAPS.md` 记录：CI 内 crawl4ai 冒烟结论、`--ci` 模式行为、若遇到 Secret/artifact 新坑。
- [ ] **Step 4**: 提交：`npm run commit -- "docs: CI 每日管线上线 + 退役 Windows 定时"`。

### Task 5.4: 三代理复盘（本任务的核心验证产出）

**Files:**
- Modify: `docs/DECISION-三代理架构-自审评估.md`（追加复盘章节）

- [ ] **Step 1: 收集事实**：从 git log 提取 PLANNER/GENERATOR/REVIEW 三个交接提交的 sha；记录 Evaluator 是否抓到 Generator 遗漏（如 secret 名不匹配、cron 时区、token 缺失），以及被抓到的条数。
- [ ] **Step 2: 回答四个问题**（写进 DECISION 复盘章节）：
  1. 文件交接协议是否跑通？（三个 DONE/REVIEW 文档是否真被下一个 agent 消费）
  2. 独立 subagent 上下文是否形成有效隔离与校准？（Evaluator 是否独立验证出问题）
  3. 偏差 2（"单会话指挥 subagent" vs "独立 brain"）在这次实战中的实际影响？
  4. 下一步是否值得投入独立 brain（每 agent 一个 worktree/清空窗口）？
- [ ] **Step 3: 提交**

```bash
git add docs/DECISION-三代理架构-自审评估.md
npm run commit -- "docs: 三代理实战复盘（管线搬GitHub 文件交接验证结论）"
```

---

## Self-Review 结论

**Spec 覆盖：**
- 决策 1（纯 Actions）→ Task 0.3 / 2.3 / 4.4-4.5 / 5.2
- 决策 2（CI 无自愈，降级+告警）→ Task 2.2 `--ci` 分支、2.3 失败建 Issue
- 决策 3（先用 Claude Code 验证三代理）→ 阶段 1/2/3 + Task 5.4 复盘
- DECISION §2.3 CI 新东西（Secret/crawl4ai 镜像/入口适配/X 降级）→ Task 2.3 / 2.4 / 4.2 / 4.3
- DECISION §2.4 遗留 ops-check secret 语法 → Task 2.1 Step 2（master 上已修复，仅确认）
- 偏差 1（Sprint Contract 对等协商）→ Task 1.2 §2 预填 + Evaluator §2 清单 + Task 3.3 FAIL 回派循环
- 偏差 2（交接文件真实性）→ 每个 agent 阶段都以文件交接信号收口，且 Evaluator 独立复核

**占位符扫描：** 无 TBD/TODO；所有代码/命令/文档模板均含实际内容。

**类型一致性：** `parseArgs`/`healthCheckOutputPath` 在 Task 2.2、2.5、2.6、3.2、5.4 中名称一致；`daily-pipeline.yml` / `crawl4ai-smoke.yml` / Secret 名在 Task 2.3、2.4、4.2 中逐字一致。
