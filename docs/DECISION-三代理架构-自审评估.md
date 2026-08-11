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
