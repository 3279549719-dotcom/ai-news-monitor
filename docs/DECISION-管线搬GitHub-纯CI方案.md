# DECISION: 管线搬 GitHub Actions — 纯 CI 方案（含 clarify 结论）

> 状态: Decided ｜ 日期: 2026-08-11 ｜ 依据: [HANDOFF-20260811.md] + [DECISION-三代理架构-自审评估.md] + 用户 clarify 拍板
> 前置: 三代理架构自审评估（方向合理、机制有出入）→ 用户确认迁移策略与 P0 自愈去留
> 实验 worktree: `.worktrees/experiment-gha`（分支 `feat/experiment-gha-pipeline`，基于 master `89b530f`）

---

## 一、三个 clarify 决策（用户拍板）

| # | 决策点 | 结论 | 一句话说明 |
|---|--------|------|-----------|
| 1 | 管线搬云迁移策略 | **纯 GitHub Actions** | 新建 `daily-pipeline.yml`，ubuntu-latest 自带 Docker 动态启动 crawl4ai 容器。Windows 任务计划 + 本地自愈脚本退役（仅保留本地开发用） |
| 2 | P0 自愈模块（diagnose/repair）去留 | **CI 不需要自愈** | Actions runner 是一次性的，无需长驻自愈。crawl4ai 启动失败 → 直接降级 scraper-direct + 告警，去掉重启/重跑逻辑 |
| 3 | 三代理架构验证在哪跑 | **先用 Claude Code 验证** | 在实验 worktree 里先跑通 Planner→Generator→Evaluator 文件交接，验证协议后再谈云/OpenClaw |

---

## 二、决策连锁影响

### 2.1 对既有 `DECISION-三代理P0-技术选型.md` 的修正

原 DECISION 设计的「诊断引擎 + 修复动作 + 自愈编排」（功能 A）建立在 **Windows 长驻 + 可重启 Docker Engine + 可重跑管线** 的前提上。纯 CI 方案下：

| 原设计 | 纯 CI 下 | 处理 |
|--------|---------|------|
| DOCKER_NOT_RUNNING → `restart-docker-engine.ps1` | runner 自带 Docker，不存在"引擎挂" | 删除该修复动作 |
| CRAWL4AI_UNHEALTHY → `docker restart crawl4ai` | job 内启动失败即放弃 | 保留**启动重试**（有限次数），失败降级 scraper-direct |
| AUTO_RERUN（最多重跑 1 次管线） | runner 一次性，无重跑必要 | 删除 |
| AUTH_EXPIRED → 重跑 x-fetch-tweets.py | X/twikit 在 CI 无法登录 | **跳过 X 抓取**（标记范围边界） |
| 每小时轮询 breaking-check | 未在本次迁移范围 | 后续单独决策 |

**结论**：功能 A（自愈）在 CI 中**降级为「健康检查 + 有限重试 + 降级 + 告警」**，不再是「诊断→修复→验证」全环。diagnose/repair 模块保留供本地手动诊断用，但 CI 入口不依赖它。

### 2.2 退役清单（Windows 本地方案）

| 项 | 状态 | 说明 |
|----|------|------|
| `scripts/install-schedule.js`（Windows 任务计划 08:00） | ⏸ 退役 | 由 Actions cron 取代 |
| `scripts/restart-docker-engine.ps1` | ⏸ 退役 | CI 不需要；保留作为本地开发工具 |
| `scripts/self-heal.js` / `src/diagnose.js` / `src/repair.js` | ⏸ CI 不依赖 | 保留本地手动诊断能力 |
| `scripts/x-fetch-tweets.py`（twikit X 抓取） | ⚠️ CI 跳过 | 无法自动化登录；标记范围边界 |
| crawl4ai 本地容器（localhost:11235） | ⚠️ 本地仍需要 | 开发时本地跑管线仍用；CI 用 runner 动态容器 |

### 2.3 CI 需要的新东西

| 项 | 说明 |
|----|------|
| `.github/workflows/daily-pipeline.yml` | cron `0 0 * * *`（北京 08:00）；job 内 `docker run` 启动 crawl4ai + `node scripts/run-pipeline.js` |
| GitHub Secrets | `DEEPSEEK_API_KEY`、`SUPABASE_URL`、`SUPABASE_SERVICE_KEY`、`EMAIL_*` |
| crawl4ai 镜像来源 | 需公开可用镜像（Docker Hub）或自建推镜像 |
| 管线入口适配 | `run-pipeline.js` 的 crawl4ai 健康检查需区分「本地长驻容器」vs「CI 一次性容器」启动方式 |
| X 降级 | CI 环境显式标记 X 源跳过 |

### 2.4 遗留缺陷（审计发现，需一并修）

- [ ] `ops-check.yml` 残留 Secret 语法错误：`*** secrets.SUPABASE_SERVICE_KEY }}` 缺 `${{` 前导（近 4 条 fix(ops) 提交仍未根治）

---

## 三、三代理验证计划（Claude Code，实验 worktree）

在 `.worktrees/experiment-gha` 内用 Claude Code 主会话 + subagent 验证：

1. **Planner（主会话）**：读 REQ/DECISION → 输出 `docs/PLAN-管线搬GitHub.md` + `SPRINT-20260811-github-pipeline.md` → 写 `docs/PLANNER_DONE.md`
2. **Generator（subagent）**：按 PLAN 创建 `daily-pipeline.yml` + 适配 `run-pipeline.js` → 写 `GENERATOR_DONE.md`（含 A4 证据）
3. **Evaluator（subagent）**：读 COMPLETION → 验证 workflow 语法 + `npm run check` → 出 `REVIEW-*.md`（PASS/FAIL/BLOCKED）

> 注意：这仍是「单会话指挥 subagent」形态（自审评估偏差 2），不是真正独立 brain。先验证协议与文件交接可行性，再评估是否需要独立 brain。

---

## 四、范围边界（本次不做）

- ❌ 不在 OpenClaw 里搭三代理（先 Claude Code 验证，见决策 3）
- ❌ 不做每小时 breaking-check 轮询（后续单独决策）
- ❌ 不做 X/twikit 的 CI 自动化（无法登录，标记跳过）
- ❌ 不保留本地自愈作为 CI 兜底（决策 1 = 纯 Actions）
- ❌ 不实现 LLM 诊断兜底（自审评估坑 3，CI 不需要）

---

## 五、历史

| 日期 | 事件 | Agent |
|------|------|-------|
| 2026-08-11 | 创建（用户 clarify 拍板三个决策点后） | 主 Agent |
