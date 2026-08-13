# Draft: 本地 Agent 工作台 — 设计草案

> 状态: **Draft（调研中，2026-08-13）** ｜ 依据: 用户目标 + `docs/REQ-Loop工程-自主交付协议.md`（2026-08-08 调研）+ `docs/DECISION-三代理架构-自审评估.md`（2026-08-11 实验复盘）
> 下一步: subagent 调研 GitHub 开源长时 agent 框架 → 补「借鉴」一节 → 转正式 spec → writing-plans

---

## 一、目标（一句话）

**本地网页工作台：输入一句话目标 → 多个 agent 自主完成「调研→设计→编码→验证→交付」软件项目 → 人只审最终结果。** 单任务几小时级，关网页/断线后能断点续跑。

首个测试任务：参考本地《东方永夜抄》，产出一个可玩的东方同人弹幕 demo。

## 二、已确定的决策（与用户逐条确认）

| 决策点 | 选择 | 含义 |
|--------|------|------|
| 任务范围 | 开发软件项目为主 | 操作文件系统/构建/测试是刚需 |
| 界面形态 | 本地网页界面 | Node 起本地服务，浏览器打开，左侧输目标、右侧看进度 |
| 执行引擎 | 让 Claude 干活 | 复用 `claude` CLI（无头 `-p`）+ 现有工具链，不自建 agent 引擎 |
| 持久性 | 几小时 + 断点续跑 | 任务状态落盘，恢复时先读进度再继续 |

## 三、关键洞察：不用自己设计的 vs 要写的

Superpowers（obra/superpowers，用户已在用）**已内置**：
- **G↔E loop** → `subagent-driven-development`（Implementer 写代码 → Reviewer 评审）
- **上下文管理** → `brainstorming` → `writing-plans` → spec/plan/progress 文档链
- **文档交接** → 每步落盘 + 阶段 commit + 断点靠 progress 重建

工作台**真正要写的**只有三块（薄壳，不碰 loop 设计本身）：
1. **网页前端**：任务输入框 + 任务列表 + 实时日志/进度 + 续跑按钮
2. **无人值守调度**：Node 服务把一句话变成任务目录，spawn `claude -p` 无头跑 superpowers 流程
3. **状态落盘 + 恢复**：任务列表 + 每任务 progress，断线后一键续跑

## 四、方案 A 形态（初步）

```
浏览器 localhost:PORT
   └─ 输入一句话目标
       └─ Node 服务（workbench 项目，独立目录）
           ├─ 创建任务目录（独立项目文件夹：brief/plan/progress）
           ├─ 展开：目标 → 验收标准 → 进度文件（复用文档链模式）
           ├─ 每阶段 spawn `claude -p` 执行 + 阶段 commit
           ├─ 进度实时回流网页（日志/步骤/状态）
           └─ 断线 → 状态文件在 → 一键「续跑」
```

## 五、已识别的风险（设计重点）

1. **无头长跑的成本护栏**：`claude -p` 长会话烧 token，需预算/上限机制
2. **无头模式的危险动作门禁**：花钱/删数据/发外部请求等 hard-to-reverse 动作，官方建议保留人工确认——无头下需设计「门禁点 + 网页批准按钮」
3. **无头长跑可靠性**：超时、会话上限、失败重试策略
4. **多任务并存**：任务队列 + 并发控制

## 六、待调研补全（TODO）

### 调研发现（方向 2：持久化/断点/监控 — subagent 已回 2026-08-13 23:47）

**断点续跑首选（零新依赖，最贴合 `claude -p`）**：Anthropic 官方长时 agent harness 模式
- 参考：https://github.com/anthropics/cwc-long-running-agents（官方代码级参考，MIT）
- 机制：`claude-progress.txt`（会话开头读/结尾写）+ git commits（每任务一提交）+ `feature-state.json`（机器可读 passes/fails）+ `init.sh`（环境重建）；PreToolUse hook 防"没验证就宣称完成"
- 网页端直接读进度文件即可展示

**任务状态机（机器可读 + 实时状态，次选/可并行）**：SQLite/JSON + 幂等键
- 参照实现：https://github.com/davccavalcante/alkaline（node:sqlite 零依赖 durable）、https://www.npmjs.com/package/@loomfsm/kernel（状态机+SQLite 事务+幂等账本）
- 存 Supabase 复用现有基建也可（省）
- 每个任务=一次 `claude -p` 调用；RUNNING→DONE 落库，崩溃后扫描未完成任务续跑

**监控/进度 UI**：80% 需求 = 自研 ~50 行 Express 端点（`GET /api/status` + SSE）+ 一个列表页
- 要现成面板再上 Langfuse / Opik（Docker Compose 一条命令，但带 ClickHouse+Postgres 两个存储）
- 重型方案 **不推荐**（过度工程）：Temporal、trigger.dev、AgentOps、Letta(MemGPT)

### 调研发现（方向 1：loop/多 agent 编排/网页壳 — subagent 已回 2026-08-13 23:49）

**断点续跑现成件（不自己造）**：
- `anthropics/claude-agent-sdk-typescript`（官方基础件）：`session_id` 落盘 + `resume`/`continue` 一条语句接回上次会话，进程重启上下文不丢；SessionStore adapter 可跨进程恢复。**这改变了方案 A——不必自研状态机，用它 + 产物层**
- `langchain-ai/langgraph`（Python，参考）：checkpoint + `thread_id`，"副作用包 task、重放不重复执行"的重放语义值得抄

**质量闭环（G↔E loop 的官方验证版）**：
- `anthropics/cwc-long-running-agents`（`/goal` 背后最小实现，Apache-2.0）：三原语 = ① Default-FAIL（验收从 `false` 开始，Read 过证据才许标 pass）② Fresh-context evaluator（无写权限独立 subagent，NEEDS_WORK 直接成为下轮 prompt）③ Agent-maintained handoff（PROGRESS.md + git commit）

**网页壳现成件（不用从零造）**：
- UI 抄 OpenHands（React SPA：聊天+终端+文件树+浏览器四视图，事件流驱动）
- 控制面参考 OpenClaw Gateway（⚠️ 曾出安全事件，须绑 127.0.0.1）
- 轻量现成壳：HolyClaude（docker 一键）、`EdanStarfire/claudecode_webui`（包 SDK+FastAPI+Vue3）、`gooooloo/claude-code-webui`（transcript 驱动）

**多 agent 形态参照**：MetaGPT（一句话→软件仓库，产品形态最接近）、CrewAI（每 task 强制 expected_output=验收标准）、AutoGen（循环必须带安全退出条件防死循环）、Swarm（handoff 交接模式，已退役）

**重型不推荐（过度工程）**：Temporal、trigger.dev、AgentOps、Letta/MemGPT

### TODO
- [x] GitHub 开源长时 agent 框架调研（方向 1）
- [x] 任务持久化/断点/监控调研（方向 2）
- [x] 产出调研 HTML `2026-08-13-agent-workbench-research.html`
- [ ] 决定 clone 清单（候选：claude-agent-sdk、cwc-long-running-agents、claudecode_webui、OpenHands shallow、MetaGPT 可选）与存放位置
- [ ] 转正式 spec → writing-plans

## 七、范围外（本期不做）

- ❌ 不自建 agent 运行时（工具调用/上下文/错误恢复的引擎层）
- ❌ 不做跨天调度（本期几小时级）
- ❌ 不打包桌面 App（网页够用，将来可 Tauri 壳）
