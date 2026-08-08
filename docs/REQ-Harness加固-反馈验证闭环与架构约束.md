# REQ: Harness 加固 — 反馈验证闭环与架构约束

> 状态: **Decided（2026-08-08 用户拍板采纳「均衡推荐」A1+A2+A4+B1+B2）** ｜ 创建: 2026-08-08 ｜ 决策: [DECISION-Harness加固-反馈验证闭环与架构约束.md](DECISION-Harness加固-反馈验证闭环与架构约束.md)
> 方法: harness 自评（对照 Anthropic 官方定义《Agent Harness Design》: harness = the loop / tools / context management / guardrails）→ 定位两短板 → 本 REQ 定义候选加固措施与验收
> 范围: **agent harness 层**（`.claude/settings.json` hooks、`scripts/`、git hooks、ESLint 规则、AGENTS.md）——**不改产品代码/数据模型/RLS**
> 决策方式: 用户用交互式 playground（`docs/harness-hardening-options.html`）逐项评估推荐与利弊后勾选采纳范围 → 拍板后补 DECISION 文档 + 实施

---

## 一、背景：harness 自评结论

对照官方 4 组件定义（loop / tools / context management / guardrails），本项目 5 维自评：

| 维度 | 现状 | 评级 |
|------|------|------|
| 上下文提供（context management） | CLAUDE.md 160 行 + DOCUMENT_MAP + skill + `.remember/` | ✅ 强项 |
| 工具提供（tools） | 5 MCP + ops 脚本 + 克制 allowlist | ✅ 强项 |
| 做好计划（planning） | REQ→DECISION→PLAN→PROGRESS 全链 + superpowers plans | ✅ 中上（plan-mode 关卡靠自觉） |
| **反馈验证闭环（verification）** | 仅 PostToolUse 跑 client 检查，见 §二.1 | ❌ 短板 |
| **架构约束（guardrails）** | 纯散文约束、零机制强制，见 §二.2 | ❌ 短板 |

> 说明：用户听到的"5 类型"为中文社区对官方材料的二次拼合，官方精确分类是 4 组件；"planning"官方不单列。此处沿用用户 5 维框架便于自评，术语对齐按官方 4 组件。

---

## 二、现状证据（已实锤）

### 2.1 反馈验证闭环

- `.claude/settings.json` 的 PostToolUse hook（matcher `Write|Edit` **全局**）：无论改哪个文件，都只跑 **client** 的 `type-check + lint` → 改 `src/*.js` 后端文件也触发前端检查（白跑），且后端零验证。
- 覆盖面窄：不跑后端 `node --check`、不跑 `npm test`（53 单测，秒级无网络）、不跑 build/E2E。
- 无 Stop hook（官方"确定性门禁"）；无独立 evaluator（官方"separate generator from evaluator"）。
- **静默失败先例**：`dedup-existing --keep-ids=` 等号形式被静默忽略 → 11 行全删（PROGRESS F-013，2026-08-05）；`node --test src/` 误触发真实管线（CLAUDE.md 已知陷阱，2026-08-04）。两件都是"加一个 guard 就能拦住"的典型。

### 2.2 架构约束（护栏）

- CommonJS 禁 ESM / 前后端隔离 / MIN_SCORE 一致性：全部写在 CLAUDE.md 散文，**无 lint 规则、无 import 限制、无 pre-commit hook、无 CI** 执行。
- `settings.local.json` 仅 allow 清单，无 deny、无 sandbox；用户级 `defaultMode: auto`。
- 注：产品数据层护栏（RLS 收紧、Tier 白名单、RESULT_LIMIT 预算）已做得不错，**缺的是 agent harness 层的约束**。

---

## 三、候选加固措施

### 组 A — 反馈验证闭环

| ID | 措施 | 改动位置 | 一句话说明（非技术） |
|----|------|---------|----------------------|
| A1 | PostToolUse 检查分流 | `.claude/settings.json` | 改后端自动跑后端测试，改前端自动跑前端检查，不再无差别乱跑 |
| A2 | Stop hook 收尾门禁 | `.claude/settings.json` + scripts/ | Claude 收尾前强制跑全套检查，不过关不允许结束 |
| A3 | 独立复核员（evaluator） | 流程 + AGENTS.md | 删数据/改历史等高风险操作派独立 subagent 复查，不让干活的自证 |
| A4 | 证据化交付 | AGENTS.md | 交作业附测试输出/命令结果/截图，不许"应该没问题" |

### 组 B — 架构约束（护栏）

| ID | 措施 | 改动位置 | 一句话说明（非技术） |
|----|------|---------|----------------------|
| B1 | PreToolUse 危险操作拦截 | `.claude/settings.json` + scripts/ | 拦三个已知坑：回填不预览就执行 / keep-ids 等号写法 / 误触真实管线 |
| B2 | git pre-commit 把关 | scripts/ + git hooks | 提交前自动跑全套检查 + 拦 `.env*` 入暂存 |
| B3 | 前后端隔离 ESLint 规则 | client/.eslintrc | 用代码规则禁止前端引后端 Node 模块 |
| B4 | 权限收紧（deny/sandbox） | settings.local.json | 给 agent 加禁止项/沙箱隔离，防越界（可选，安全增强） |
| B5 | CLAUDE.md 瘦身 | CLAUDE.md | 项目说明 160 行偏长，随模型变强拆掉不再必需的条目 |

---

## 四、决策方式（已完成 2026-08-08）

1. ✅ 打开 `docs/harness-hardening-options.html`（playground 决策工具）逐项评估推荐与利弊。
2. ✅ 用户拍板：采纳「均衡推荐」A1+A2+A4+B1+B2；A3/B3/B4/B5 本期不做。
3. ✅ 补 `DECISION-Harness加固-反馈验证闭环与架构约束.md`（含实现设计），进入实施。

---

## 五、验收标准（落地后）

### 机制
- `.claude/settings.json` 含 A1 分流 + B1 guard；git pre-commit 就位（若采纳 A2/A3/A4/B2/B3 相应配置）

### 行为
| # | 检查项 | 判定 |
|---|--------|------|
| V1 | 前后端检查分流 | 改 `src/*.js` → 触发 `node --check` + `npm test`；改 `client/src/*` → 触发 type-check + lint |
| V2 | 危险操作拦截 | `dedup-existing --apply` 无 `--dry-run` 被拦；`--keep-ids=` 等号形式被拦；`node --test src/` 被拦 |
| V3 | 提交把关（若采纳 B2） | 坏提交被 pre-commit 拦下；`.env*` 无法入暂存 |
| V4 | 收尾门禁（若采纳 A2） | 全套检查不过，Claude 不允许标记完成 |

### 无回归
- `npm run check` 全绿；真实管线 `node src/index.js` E2E 不受影响

---

## 六、不做（本期范围外）

- ❌ 不改产品代码、数据模型、RLS（本次纯 harness 层）
- ❌ 不引入 CI 服务（本地 hook 优先，Vercel 部署维持现状）
- ❌ 计划维度的 plan-mode 强制关卡（观察项，本期不定）
