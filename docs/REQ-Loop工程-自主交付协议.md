# REQ: Loop 工程 — 自主交付协议

> 状态: **Draft（待用户拍板实施范围，2026-08-08）** ｜ 创建: 2026-08-08 ｜ 依据: `docs/loop-explainer.html`（loop 三层拆解讲解器，调研结果可视化）
> 方法: 派 subagent 调研官方 loop 概念（Claude Code 机制 + Anthropic 官方博客/仓库）→ 讲解器展示三层含义与现状 → 用户确认「先文档化再定优化」→ 本 REQ 定义协议与候选措施
> 范围: **agent harness 层 + 文档协议 + ops 脚本**——不改产品代码/数据模型/RLS。实施范围待用户拍板
> 决策方式: 用户评审本 REQ + 讲解器后勾选采纳范围（推荐 P1+O1）→ 补 DECISION 文档 + 实施

---

## 一、背景：目标与 loop 三层定位

用户目标：**从「守在屏幕前逐句驱动」→「几句话 + 目标 + 验收标准，agent 自主完成 调研→设计→实现→验证→交付，人只审最终结果」**（以小时为单位的长时间工作）。

调研结论（官方出处见 `docs/loop-explainer.html`）：
- harness 官方四组件 = **loop / tools / context management / guardrails**。
- loop 三层：
  - **L1 调度/定时**：`/loop` 是 bundled skill（非内置命令）、会话级 cron（`CronCreate`，7 天过期）、`claude -p` 无头模式接系统计划任务。
  - **L2 执行范式**：官方「gather context → take action → verify results」；**"ReAct" 是社区词**，官方原文未用。
  - **L3 自主交付**（社区词 "loop engineering"，官方叫 designing loops）：支撑件 = 外部进度文件 + 明确验收标准 + 反馈验证闭环 + 权限边界 + 触发机制。
- 官方底线：**人只审最终结果**是对「无人值守定时 loop」的设计目标（"with no human in real time"）；长任务仍保留中途可观测/可干预（AGENT_STOP / STEER.md / checkpoint / git log）；**hard-to-reverse 动作保持人工确认**（"Reversibility is often a good criterion… gated by user confirmation"）。

---

## 二、现状与缺口

### 2.1 已具备（地基：F-016 + 既有机制）

| 支撑件 | 现状 |
|--------|------|
| 反馈验证闭环 | ✅ F-016 A1（检查分流）/ A2（Stop 收尾门禁）/ A4（证据化交付） |
| 架构护栏 | ✅ F-016 B1（危险操作拦截）/ B2（pre-commit 把关 + `.env*` 拦截） |
| 外部进度/验收文档体系 | ✅ REQ→DECISION→PLAN→PROGRESS 全链；PROGRESS.md ≈ 官方 long-running-agents 仓库的进度文件模式 |
| 定时触发 | ✅ Windows 任务计划 `ai-news-monitor-daily`（每日 08:00 跑数据管线，纯 node） |

### 2.2 缺口

| 缺口 | 说明 |
|------|------|
| **自主交付协议** | 没有把「一句话目标 → 自动跑完整流程」落成项目规则（协议强制字段 / 模板）——现在靠会话自觉 |
| **单任务 checkpoint** | 长任务没有独立进度文件 + git 分阶段 commit，中途断无法干净续传 |
| **定时运维巡查** | 只有数据管线定时；没有 Docker/crawl4ai 健康、磁盘余量、pipeline 日志、Supabase 新文章的巡检 |
| **进阶自动化** | `/goal` 完成条件续跑、后台会话/agent view、多 agent 并行编排均未启用 |

---

## 三、候选措施

### 组 P — 自主交付协议（核心）

| ID | 措施 | 改动位置 | 一句话说明（非技术） |
|----|------|---------|----------------------|
| P1 | 协议文档化 + AGENTS.md 强制字段 | AGENTS.md + 文档 | 开工必写 目标+验收标准+进度文件路径；每阶段更新 PROGRESS；收尾强制 `npm run check`（Stop hook 已强制）；硬反向动作保持人工确认（B1/B2 已落地 reversibility 门禁） |
| P2 | 单任务 checkpoint 模板 | docs/ + git 习惯 | 长任务建 `docs/PROGRESS-<task>.md`（状态/证据/下一步）+ git 分阶段 commit；续传时先读该文件（官方 "A fresh session has no memory of what the previous one did"） |

### 组 O — 定时运维巡查

| ID | 措施 | 改动位置 | 一句话说明（非技术） |
|----|------|---------|----------------------|
| O1 | ops-check.js + 系统任务计划 | scripts/ + 任务计划 | 每日巡检 crawl4ai/Docker 健康、磁盘余量、pipeline 日志最近一次是否成功、Supabase 近 24h 新文章；**异常才写中文报告**，健康静默 |
| O2 | claude -p 参与巡查（进阶） | 任务计划 + claude CLI | 调 `claude -p --allowedTools ...` 让 AI 解读并汇总（无人值守；sandbox 需 WSL2/容器） |

### 组 C — 进阶（可选，暂缓）

| ID | 措施 | 说明 |
|----|------|------|
| C1 | `/goal` 完成条件自动续跑 | 会话内设「全部通过 / 达标」自动续跑到满足，独立 evaluator 判定（官方 "separate evaluator"） |
| C2 | 多 agent 子任务并行 | 大任务拆 调研/设计/实现/验证 子 agent 并行，主 agent 汇总与门禁 |

---

## 四、推荐（最小起步）

**P1 + O1**：
- **P1** 把现有散落的机制（REQ/DECISION/PROGRESS + Stop 门禁 + B1/B2 护栏）串成一条可执行的协议，零新依赖、收益最直接——这正是 F-016 打下的地基要承接的上层协议。
- **O1** 用现有 Windows 任务计划基础设施补运维巡查，成本最低（复用 `run-pipeline.js` 的 `chdir` + 超时 + Docker 自检模式）。
- P2/C1/C2 视 P1 落地体验再定。

---

## 五、决策方式

1. ✅ 用户已通过 `docs/loop-explainer.html` 理解三层 loop 与现状。
2. ⏳ 评审本 REQ → 用户拍板采纳范围（推荐 P1+O1）→ 补 DECISION 文档 + 实施。

---

## 六、验收标准（落地后）

### 机制
- AGENTS.md 含自主交付协议强制字段；`docs/PROGRESS-<task>.md` 模板就位（若采纳 P1/P2）
- 系统任务计划含 ops 巡检（若采纳 O1）

### 行为
| # | 检查项 | 判定 |
|---|--------|------|
| V1 | 协议生效 | 新长任务按协议运行：开工有 目标+验收+进度文件路径，每阶段更新，收尾 `npm run check` 强制（Stop hook 联动） |
| V2 | 运维巡查 | 每日自动跑；异常时产出中文报告（列明异常项），健康时静默；`--dry-run` 可预览、不重复告警 |
| V3 | 无回归 | `npm run check` 全绿；真实管线 E2E 不受影响 |

### 无回归
- `npm run check` 全绿；定时数据管线照常

---

## 七、不做（本期范围外）

- ❌ 不改产品代码、数据模型、RLS
- ❌ 不引入 CI 服务（本地 hook / 系统任务计划优先）
- ❌ C1 `/goal`、C2 多 agent 不进本期默认范围（待 P1 落地体验后评估）
- ❌ O2 `claude -p` 巡查不进本期默认范围（需 WSL2/容器与凭证，成本高）
