# DECISION: 三代理架构 — 自审评估（对齐 Anthropic Harness 原文）

> 状态: Assessed ｜ 日期: 2026-08-11 ｜ 依据: [anthropic-harness-design-insights.html] + [HANDOFF-20260811.md] + generator worktree 代码评审 + `.claude/settings.json` 护栏审计
> 方法: 派 3 个 subagent 分别抓取 Anthropic 原文 / 评审 generator 代码 / 盘点 harness 护栏，交叉后综合评估。
> 结论摘要: **方向对、骨架真、机制有出入。** 详见下文偏差。

---

## 一、结论

对三代理架构（Planner → Generator ↔ Evaluator）的初始化工作，评估结论为**基本合理但有三处系统性偏差**：

| 维度 | 结论 | 说明 |
|------|------|------|
| 理解原文 | ✅ 准确 | 四支柱映射正确，诚实标注社区词（ReAct/Loop Engineering）与官方词的差异 |
| Sprint Contract | ⚠️ 有偏差 | 从「对等谈判」降格成「自上而下下发」，丢了 GAN 架构的校准环 |
| Agent 隔离 | ⚠️ 有偏差 | worktree 物理隔离 ≠ 独立 brain + context reset，文档称「对齐原生架构」过誉 |
| Guardrails 来源 | ⚠️ 轻偏差 | A1/A2/B1/B2 来自 Claude Code harness，不是那篇文章 |
| 代码骨架 | 🔴 未就绪 | 功能 B 抓取层是 stub；notify.sendBreakingAlert 不存在；LLM 兜底未实现 |

---

## 二、与 Anthropic 原文的对拍（四支柱）

> 原文: "the software scaffolding around a model: the loop, tools, context management, and guardrails."
> 心法: "Every component in a harness encodes an assumption about what the model can't do on its own."

| 支柱 | 原文机制 | 项目落地 | 判定 |
|------|---------|---------|------|
| Loop | Generator/Evaluator 分离（"agents are poor self-evaluators"） | 功能 A：烟雾测试 + test suite 当 Evaluator，AI 只兜底 | ✅ 对齐（正是文章建议的确定性优先） |
| Tools | 文件系统原语、bash | REQ→DECISION→PLAN→PROGRESS 文档链 | ✅ 对齐 |
| Context | Context Reset（交接文件重建）> Compaction | PROGRESS.md 有雏形，无单任务 checkpoint 模板 | ⚠️ 待补 |
| Guardrails | Hooks + 权限门 + "成功静默失败冗长" | A1/A2/B1/B2/A4（来自 Claude Code） | ⚠️ 有效但来源非本文 |

---

## 三、三处系统性偏差（原文 vs 落地）

### 偏差 1：Sprint Contract 从对等谈判降格成自上而下下发

- **原文**：Generator 提案「done」定义 → Evaluator 审查 → **迭代到一致**（"The two iterated until they agreed"，Sprint 3 一个就 27 条标准）。这是 GAN 架构的灵魂——前置协商在训练评估器的判断标准。
- **落地**：Planner 写合同 → Generator 执行 → Evaluator 按合同验收。合同不经协商，评估器标准未被校准，对抗校准环是空的。
- **修**：`SPRINT_CONTRACT_TEMPLATE.md` 改为 Generator 提案 + Evaluator 评审迭代。

### 偏差 2：「三代理」落地是 worktree+文档，不是独立 brain + context reset

- **原文**：每个 agent 是独立 context window（separate brain），换手 = 清空窗口 + 靠结构化 handoff artifact 重建。
- **落地**：3 个 git worktree（物理文件隔离）+ 主会话派 subagent。物理隔离 ≠ 上下文隔离，真实跑起来是「一个主会话指挥 subagent」。
- **证据**：HANDOFF 声称 AGENTS.md §「三代理工作模式」定义了 Planner 输出规范，但 **AGENTS.md 里没有这一节**；B2 pre-commit 钩子休眠（需手动 `git config core.hooksPath .githooks`）。
- **修**：AGENTS.md 补上真的三代理章节，或删掉 HANDOFF 过誉引用；文档与机制一致。

### 偏差 3（轻）：Guardrails 来源混淆

- 那篇文章不含 hooks/permissions/"success silent failures verbose"——这些是 **Claude Code 的 harness（settings.json hooks）** 概念，不是那篇文章的。A1/A2/B1/B2 真实有效，但来源是 Claude Code。insights HTML 其实标对了，HANDOFF 把它们当成了文章推荐。

---

## 四、四个会咬人的坑（代码评审）

| # | 坑 | 位置 | 后果 |
|---|----|------|------|
| 1 | 功能 B 抓取层是 stub | `src/fetch-breaking.js:59` 硬编码 `return []` | 端到端永远跑不出推送 |
| 2 | notify.sendBreakingAlert 不存在 | `scripts/breaking-check.js:92` 调用必抛 TypeError | 静默降级到文件日志，违背「失败要响」 |
| 3 | 声称 LLM 兜底但没实现 | `src/diagnose.js` 头部注释 vs 代码 | UNKNOWN 时无 DeepSeek 调用 |
| 4 | Windows shell 不一致 + 危险路径零测试 | `diagnose.js:44` `/dev/null` vs `repair.js:63` `nul`；restart 类无测试 | crawl4ai 探测可能静默失败；高风险动作无回归保护 |

---

## 五、修复路径（优先级）

| # | 动作 | 改什么 | 一句话（非技术） |
|---|------|--------|----------------|
| 1 | Sprint Contract 改对等谈判 | `SPRINT_CONTRACT_TEMPLATE.md` | 合同从 Planner 单方写，改成 Generator 提案 + Evaluator 评审迭代 |
| 2 | 文档与机制对齐 | AGENTS.md + HANDOFF | 补真三代理章节，或删过誉引用 |
| 3 | 功能 B 二选一 | `src/fetch-breaking.js` | 真实现抓取，或明确砍掉只留功能 A |
| 4 | 失败路径改 verbose | `breaking-check.js` + `notify.js` | 补 sendBreakingAlert，或让缺失显式报错 |
| 5 | 危险路径补测试 | `repair.test.js` | 给 restartDockerEngine / restartCrawl4ai 加 mock 测试 |
| 6 | 真任务（搬 GitHub）冲突解耦 | `run-pipeline.js` vs CI | 本地自愈（Windows）与 Actions Linux runner 不兼容，先定 P0 自愈在 CI 的形态 |

---

## 六、遗留待澄清

- [ ] OpenClaw 能否实现真正三代理架构（独立 brain + context reset），还是必须 Claude Code？（见实验性 worktree）
- [ ] 搬 GitHub Actions 后，本地 Windows 自愈脚本（restart-docker-engine.ps1 等）是否整体退役，还是保留本地兜底。
- [ ] 功能 B 的去留（见偏差/坑 1）。

---

## 七、历史

| 日期 | 事件 | Agent |
|------|------|-------|
| 2026-08-11 | 创建（三 subagent 抓取原文 + 评审代码 + 盘点护栏后综合） | 主 Agent |
| 2026-08-11 | 三代理实战复盘（管线搬 GitHub Actions，Planner→Generator→Evaluator 文件交接） | 主 Agent |

---

# 附：三代理实战复盘（2026-08-11 管线搬 GitHub）

> 场景：把每日 08:00 定时管线从 Windows 任务计划搬到 GitHub Actions（纯 CI）。用本 DECISION 的既定范围（**先验证协议，不追求独立 brain**）跑完 Planner(主会话) → Generator(subagent) → Evaluator(subagent) 全流程。
> 交接文件：`PLAN-管线搬GitHub.md` → `PLANNER_DONE.md` → `GENERATOR_DONE.md` → `REVIEW-20260811-github-pipeline.md`。

## 1. 事实（来自 git log，非回忆）

| 环节 | 提交 | 交接信号 | 下一个 agent 是否消费 |
|------|------|---------|----------------------|
| Planner | `d056d2d` | `PLANNER_DONE.md`（含验收命令 + 风险 + 工作区） | Generator 读它开工 |
| Generator | `529c06d`+`3e20530` | `GENERATOR_DONE.md`（含 5 个验收命令真实输出 + A4 证据） | Evaluator 读它 + 独立重跑 |
| Evaluator | `5f22140` | `REVIEW-20260811-github-pipeline.md`（独立复核 + PASS） | 结论收口 |

## 2. 四个问题

### Q1：文件交接协议是否跑通？

**跑通了，且是"真消费"不是形式。** 证据：
- Generator 只读 `PLANNER_DONE` + `PLAN` + `SPRINT`（未读整个 master 计划），产出与 PLAN §二文件清单**完全一致**（`git diff d056d2d..3e20530 --stat` 6 files, +338/-6），无顺手重构。
- Evaluator **不信任 Generator 粘贴，全部命令独立重跑**（node --check / npm test 118/118 / npm run check / actionlint），并逐项核对 Secret 名 ↔ `src/config.js` 15 个 env。
- 交接文档成了跨 agent 的"持久记忆"：Generator 写进 `GENERATOR_DONE.md` 的"待实机验证项"（crawl4ai 冒烟、dispatch、落库）被 Evaluator 原样收进 REVIEW §四。**这就是本 DECISION 偏差 2 想要的"靠结构化 handoff artifact 重建上下文"的最小可用形态。**

### Q2：独立 subagent 上下文是否形成有效隔离与校准？（Evaluator 是否抓到 Generator 遗漏）

**隔离 ✅，校准部分生效。** 
- 隔离有效：三个 agent 上下文互不污染，Evaluator 看到的是 diff 文件 + 交接文档，不是主会话的意图。所以它的复核是**独立的**。
- 校准抓到 3 个 Minor（无 Critical/Important，无阻塞）：
  1. `vars.EMAIL_ENABLED` 未设时展开空串 → config 默认开邮件（叠加 SMTP secret 配齐会发空摘要）——**实际有用的校准**，Phase 4 已据此先 `set false`。
  2. `ops-check.yml:52` `@copilot` 行 actionlint 报 YAML parse 错（预存，不在本次 diff）——诚实标注"非本次引入"，未冤枉 Generator。
  3. KNOWN_TRAPS 缺 crawl4ai `[::]` 端口映射陷阱原文（代码已防御，文档缺口）——本次文档同步已补录。
- 局限：本次是**机械迁移**（搬代码 + 写 workflow），Generator 严格按 PLAN 照抄，本身没有可抓的重大错误。校准环的真实价值要在**开放设计**任务（Generator 有自主判断空间）才能充分显现。**协议验证了，但对抗强度被任务性质稀释。**

### Q3：偏差 2（"单会话指挥 subagent" vs "独立 brain"）的实际影响？

**本次影响可控，但暴露了两处真实代价：**
1. **Planner 不是独立 agent**：Plan 是主会话写的，它带着整个项目的背景（KNOWN_TRAPS、config.js、历史坑），这其实是"过度偏心"——Generator 拿到的是被高度收敛的规范，反而遮蔽了"Planner 自己也可能错"这层。真正的独立 brain 应该让 Planner 从零读文档产出 Plan，再由 Generator 挑战它。
2. **Evaluator 的独立性来自 prompt 纪律而非架构**：是主会话下令"独立重跑、不信任粘贴"，Evaluator 才独立。若指挥者（主会话）本身有认知偏差，这个"独立性"会被传染。独立 brain + context reset 的意义正是把这条防线做成**结构性**的，而不是每次靠主会话自觉。

### Q4：下一步是否值得投入独立 brain（每 agent 一个 worktree/清空窗口）？

**值得，但只在"开放设计"任务上投入，且先解决成本问题。** 理由：
- 本次验证证明：文件交接协议本身**已经够用**（Q1），机械任务不需要独立 brain。
- 独立 brain 的价值集中在偏差 2 的修正——**消除指挥者偏心的传导**。适合的任务：有设计空间、Generator 可产出多解、Evaluator 需要真正对抗的任务（如 breaking-news push、pipeline 自愈）。
- 成本：每 agent 一个 worktree + 独立上下文重建（读 PLAN → 产出 → 交接）会显著增加 token 与墙钟时间。建议**按任务规模分级**：机械迁移用"单会话指挥 + 文件交接"（本次形态，够用）；大型开放设计才升级独立 brain。

## 3. 结论

- 三代理的**文件交接协议**经实战验证成立：DONE→下一 agent 消费→独立复核→收口，全程落盘、可回看。
- 偏差 2 的实战影响 = **可接受但不为零**：协议对，指挥者偏心是残留风险，留待独立 brain 解决。
- 给后续任务的建议：**「单会话指挥 + 文件交接 + 独立 Evaluator」作为默认形态；遇到开放设计任务时，才为 Planner/Generator 各自开独立 worktree + 清空上下文**。
