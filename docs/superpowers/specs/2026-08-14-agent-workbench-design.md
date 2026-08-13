# Agent 工作台（Local Agent Workbench）设计

> 状态: **Spec（已获用户认可，2026-08-14；补充：工具注册表动态化 + 会话使用记录）** ｜ 依据: `docs/2026-08-13-agent-workbench-draft.md` + `docs/2026-08-13-agent-workbench-research.html`（双 subagent 调研，repo 均已验证）
> 定位: 本地网页工作台，输入一句话目标 → 让 agent 自主完成「调研→设计→编码→验证→交付」软件项目 → 人只审最终结果
> 决策方式: 用户逐条确认范围/界面/引擎/持久性 → 调研后认可「薄壳复用」方案 → 本文为正式设计

---

## 1. 背景与目标

用户目标：从「守在屏幕前逐句驱动」→「几句话 + 目标 + 验收标准，agent 自主完成软件项目开发，人只审最终结果」。单任务**几小时级**，关网页/断线后能**断点续跑**。

- 参考既有调研：`docs/REQ-Loop工程-自主交付协议.md`（2026-08-08，loop 三层拆解）+ `docs/DECISION-三代理架构-自审评估.md`（2026-08-11，文件交接协议验证成立）
- 首个真实任务：参考本地《东方永夜抄》，产出可玩的东方同人弹幕 demo（HTML5）
- 项目位置：独立目录 `E:\claude\agent-workbench\`（不是 ai-news-monitor 内）

## 2. 决策记录（用户逐条确认）

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 任务范围 | 开发软件项目为主 | 操作文件系统/构建/测试是刚需 |
| 界面形态 | 本地网页界面 | Node 起服务 + 浏览器打开；轻量，后续可打包 |
| 执行引擎 | 让 Claude 干活（claude -p，复用现有 harness） | 复用现有工具注册表（**动态 getToolIndex/getTool，不硬编码数量**，随项目演进增减）+ 5 hook + superpowers 协议，不自建 agent 引擎 |
| 持久性 | 几小时 + 断点续跑 | 任务状态落盘 + 恢复 |
| 编排框架 | **不引入** LangGraph/CrewAI/MetaGPT | 它们是"换引擎"不是"加壳"；引入=丢现有资产。思路可抄，不当依赖 |
| 网页壳 | **自研最薄版**（参考 OpenHands 四视图布局） | 网页壳不难，不依赖小众现成仓库 |
| 断点方案 | **文件系统即状态**（PROGRESS.md + git commit）+ 每 feature 一个会话 | 官方 cwc-long-running-agents 模式，零新依赖 |
| 质量门 | **cwc 三原语**（Default-FAIL + 无写权限 evaluator + agent 维护 handoff） | 官方验证的 G↔E loop 最小形态，直接映射 hooks |
| 执行器 | MVP 用 `claude -p`（spawn CLI），SDK 留作后续增强 | claude -p 复用现有 DeepSeek 配置，零风险；SDK resume 兼容性待验证 |

## 3. 架构总览（五层）

```
[你] 浏览器 localhost:PORT
   │  输一句话目标 / 看进度 / 点批准
   ▼
① 网页壳（自研单页：任务输入 + 列表 + 日志流 + 续跑/批准按钮；参考 OpenHands 布局）
   ▼
② 控制面（Node http 服务：任务 CRUD · 状态落盘 · 预算护栏 · 危险动作门禁）
   ▼
③ 会话层（spawn `claude -p`，在任务目录跑；每次注入 progress，结束回写）
   ▼
④ 质量门（builder 会话后，独立 evaluator subagent（无写权限）对照验收清单判 PASS/NEEDS_WORK）
   ▼
⑤ 产物层（任务目录：brief/plan/progress.md + accept.json + git commit = 唯一跨会话状态）
```

职责边界：②③④是工作台要写的核心（薄壳），① 是界面，⑤ 复用文档链模式（superpowers）。

## 4. 目录结构

```
E:\claude\agent-workbench\
  package.json          # 仅 dev 依赖（若引入前端构建）；后端零依赖
  server/
    index.js            # http 服务 + SSE 进度推送（零依赖原生 http）
    tasks.js            # 任务 CRUD + 状态落盘（state/tasks.json）
    runner.js           # 执行器：spawn claude -p，注入/回写 progress
    gate.js             # 质量门：调度 evaluator subagent，更新 accept.json
    protocol.js         # 任务协议模板展开（brief/plan/accept 初始化）
    budget.js           # 预算护栏（最大轮次/估算成本）
  web/
    index.html          # 单文件前端（原生 JS + EventSource，无框架无构建）
  tasks/
    <task-id>/
      brief.md          # 一句话目标 → 细化目标 + 范围 + 验收标准
      plan.md           # feature 清单（每 feature 一个会话）
      progress.md       # agent 自维护：已完成/进行中/下一步/阻塞
      accept.json       # 验收清单（Default-FAIL：默认全 false）
      notes/            # evaluator 报告、日志等
  state/
    tasks.json          # 任务注册表：id/status/step/createdAt
  claude.config.md      # 任务目录共用的 CLAUDE.md 模板（约束+护栏）
```

## 5. 组件详设

### 5.1 server/index.js — 控制面（零依赖原生 http）
- `POST /api/tasks` 创建任务（body: `{goal}`）→ 初始化任务目录 + 展开协议 → 入队
- `GET /api/tasks` 任务列表（id/status/step/progress 摘要）
- `GET /api/tasks/:id` 任务详情（含 progress.md 全文）
- `GET /api/tasks/:id/events` SSE 推送（builder/evaluator 日志行、状态变更）
- `POST /api/tasks/:id/resume` 断点续跑（重读 progress，重新调度下一 feature）
- `POST /api/tasks/:id/approve` 批准危险动作门禁（P2）
- 静态托管 `web/`

### 5.2 server/tasks.js — 任务状态
- 状态机：`PENDING → ACTIVE → (GATE) → DONE | NEEDS_WORK → 循环 → DONE | FAILED | PAUSED`
- 落盘 `state/tasks.json`；每次变更 `git commit`（任务目录内 repo）

### 5.3 server/runner.js — 执行器（claude -p）
- `spawn('claude', ['-p', prompt, '--output-format', 'json', '--max-turns', N], {cwd: taskDir})`
- prompt 注入：`claude.config.md`（约束）+ `progress.md`（上次状态）+ 当前 feature 指令
- 结束回写 `progress.md`（由 agent 在会话内维护；runner 兜底追加执行摘要）
- **使用记录**：会话产物（含工具调用 JSON）落盘 `tasks/<id>/notes/session-<step>.json`；每 feature 汇总「工具使用明细」供网页与交付说明引用（复用 harness 使用记录的思路）
- 每 feature 完成后 `git commit -m "feature: <name>"`（checkpoint）
- 续跑 = 重读 progress → 找下一个未完成 feature → 重新 spawn

### 5.4 server/gate.js — 质量门（cwc 三原语）
- **Default-FAIL**：`accept.json` 每个验收项从 `false` 开始；只在 evaluator 出示证据（截图/日志路径）后置 `true`
- **Fresh-context evaluator**：`spawn claude -p` 以独立审查者身份（prompt 明确"禁止写文件、只读"），输入：`accept.json` + 本次 diff + progress；输出 PASS 或 NEEDS_WORK + 具体发现
- **NEEDS_WORK 闭环**：evaluator 发现直接 append 到下一轮 builder prompt
- 限制：evaluator 无 Write/Edit 权限（通过 prompt 约束 + 任务目录权限最小化）

### 5.5 server/protocol.js — 任务协议展开
- 输入一句话 goal → 生成 `brief.md`（细化目标/范围/验收标准）→ `plan.md`（feature 清单，每 feature 一个会话）→ `accept.json`（Default-FAIL 验收清单）
- 复用 superpowers 思路：brief/plan/progress 文档链，但**不强制**调用 skill 子流程，保持薄壳

### 5.6 web/index.html — 前端（原生 JS）
- 输入框（一句话目标）→ 创建任务
- 任务列表卡片：状态徽章、当前 step、最近日志、续跑/批准按钮
- 日志流：EventSource 实时追加 builder/evaluator 输出
- 参考 OpenHands 布局：左列表 + 右详情（progress 全文 + 日志 + 文件树）

### 5.7 claude.config.md — 任务目录约束模板
- 明确护栏：禁止 force-push、禁止删除未备份数据、危险动作（删/覆盖/外部发送）先写入 progress 请求人工批准
- 提示 agent 每步更新 progress.md、feature 完成即自报
- 工具复用：任务会话按需经 `getToolIndex`/`getTool` 挂载既有结构化工具注册表（如 ai-news-monitor 的 check/commit），**引用而非硬编码**；注册表变化不阻塞任务

## 6. 任务生命周期（核心流程）

```
创建(goal) → [protocol] 展开 brief/plan/accept
  → 循环 per feature:
      ① runner 注入 progress 启动 builder(claude -p) 做当前 feature
      ② builder 结束 → gate 启动 evaluator(无写权限) 对照 accept
      ③ PASS → 下一 feature；NEEDS_WORK → 发现 append 下轮 prompt 重做
      ④ 每 feature 结束 git commit（checkpoint）
  → 全部 accept=true → DONE → 生成交付说明
中断恢复：进程重启 → 读 tasks.json + progress.md → 对未完成 feature resume
```

## 7. 数据模型

`state/tasks.json`：
```json
{
  "id": "task-20260814-001",
  "goal": "参考本地《东方永夜抄》，产出可玩东方同人弹幕 demo",
  "status": "ACTIVE",
  "currentStep": "feature-3",
  "createdAt": "2026-08-14T00:30:00.000Z",
  "budget": { "maxTurns": 200, "estTokens": 0 },
  "features": ["engine", "bullet-system", "player", "boss", "ui"],
  "acceptCount": { "pass": 2, "total": 6 }
}
```

`tasks/<id>/accept.json`（Default-FAIL）：
```json
{ "items": [
  { "id": "f3", "label": "游戏可启动并进入首关", "pass": false, "evidence": null },
  { "id": "f6", "label": "玩家可移动并发射弹幕", "pass": false, "evidence": null }
]}
```

## 8. 护栏

| 风险 | 机制 |
|------|------|
| 烧 token 失控 | `budget.js` 限制每任务最大 feature 轮数 + evaluator 轮数；网页展示估算成本 |
| 危险动作（删/覆盖/外部发送） | `claude.config.md` 明确禁止清单 + 要求写入 progress 请求批准；P2 加网页批准门禁 |
| .env/密钥泄露 | 复用现有 harness 思路：git 层面 .gitignore + 提交前拦 .env* |
| builder 跑偏/谎报完成 | Default-FAIL + 无写权限 evaluator + 看证据才许 pass |
| claude -p 无头长跑超时 | `--max-turns` 上限 + spawn 超时 + 失败落 FAILED 可 resume |

## 9. 错误与恢复

- **进程/服务崩溃**：任务状态在磁盘（tasks.json + progress.md + git commit），重启服务扫描未完成任务，列出可 resume
- **builder 会话失败**：回写失败摘要到 progress，状态置 FAILED，网页可一键重试（重读 progress 继续，不重做已完成 feature）
- **evaluator 失败**：视为待重跑，不标记 accept 项

## 10. 测试

- `server/*.test.js`（node:test）：tasks 状态机、protocol 展开、gate 判定逻辑（mock spawn）
- runner/gate 用 dry-run 模式验证 prompt 构造（不真调 claude）
- E2E：一条 `goal` 走完整生命周期（小 feature，如"生成一个 README"）→ 网页看到状态流转

## 11. 首批任务：东方永夜抄 demo

- goal：参考本地《东方永夜抄》（用户自持素材），产出可玩东方同人弹幕 demo
- plan features：引擎骨架(Canvas) → 玩家移动+射击 → 弹幕系统 → 敌机/Boss AI → 关卡 → UI/结算
- 验收（accept.json）：能启动 / 能移动 / 能射击 / 有敌机 / 有 Boss / 关卡可通关
- 约束：素材自绘几何图形（不复制官方美术）；demo 为同人创作，本地运行

## 12. 里程碑

| M | 内容 | 交付 |
|---|------|------|
| M0 | 骨架：目录 + http 服务 + 前端列表 + 创建任务 + 状态落盘 | `npm start` 起，网页建任务见状态 |
| M1 | 单任务跑通：创建 → claude -p 做一个小 feature → 回写 progress → 网页看到日志 | 端到端跑通一次 |
| M2 | 质量门 + 断点续跑：evaluator + Default-FAIL + resume 按钮 | 崩溃/关网页后可续 |
| M3 | 首个真实任务：东方 demo 走完整协议 | 拿到可玩 demo |

## 13. 范围外（本期不做）

- ❌ 跨天/定时调度（本期几小时级手动触发）
- ❌ 桌面 App 打包（网页够用，后续 Tauri 壳）
- ❌ 多用户/远程访问（仅本地 loopback）
- ❌ 引入 LangGraph/CrewAI/MetaGPT 作为引擎依赖
- ❌ claude-agent-sdk 深度集成（MVP 用 claude -p，SDK 兼容性验证后另议）
- ❌ 重型监控面板（Langfuse/Opik 等）

## 14. 风险

| 风险 | 应对 |
|------|------|
| claude -p 无头下 hooks 是否生效 | M1 验证（.claude/settings.json 继承 + 任务目录 hooks）；不生效则 prompt 约束兜底 |
| DeepSeek 端点对长会话稳定性 | 复用现有已验证配置；max-turns 兜底 |
| 无头模式缺人工确认的固有风险 | 危险动作先禁后批（claude.config.md），P2 网页批准门禁 |
| 东方素材版权 | 用户自持本地素材；demo 自绘，仅同人实验 |

---

## 历史

| 日期 | 事件 |
|------|------|
| 2026-08-13 | draft 落盘；双 subagent 调研（loop 编排 + 持久化/监控）；调研 HTML |
| 2026-08-14 | 用户认可「薄壳复用」修正版（不引大框架、网页壳自研）；转正式 spec |
