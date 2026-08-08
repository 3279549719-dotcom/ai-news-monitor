# DECISION: Harness 加固 — 反馈验证闭环与架构约束 技术选型

> 状态: Decided ｜ 决策日期: 2026-08-08 ｜ 依据: [REQ-Harness加固-反馈验证闭环与架构约束.md](REQ-Harness加固-反馈验证闭环与架构约束.md) + harness 自评（对照官方定义）+ 决策工具 `docs/harness-hardening-options.html`
> 参与: Patrick（决策：采纳「均衡推荐」A1+A2+A4+B1+B2；A3/B3/B4/B5 本期不做）

---

## 决策结论

**对 agent harness 层两短板（反馈验证闭环 + 架构约束）采纳「均衡推荐」5 项措施**：

| 措施 | 内容 | 机制 |
|------|------|------|
| A1 智能检查分流 | 改后端自动跑后端测试，改前端自动跑前端检查 | PostToolUse hook + `scripts/harness-check.js` |
| A2 收尾门禁 | 收尾前强制跑通整套检查，不过关不允许结束 | Stop hook + `scripts/harness-stop.js` |
| A4 出示证据 | 交付附测试输出/命令结果/截图，不以"应该没问题"代替 | AGENTS.md 条款强化 |
| B1 危险操作拦截 | 拦三个已知坑：回填不预览执行 / `--keep-ids=` 等号写法 / 误触真实管线 | PreToolUse hook + `scripts/harness-pretooluse.js` |
| B2 提交把关 | 提交前自动跑检查 + 拦 `.env*` 入暂存 | `.githooks/pre-commit` + `core.hooksPath` |

改动面（全在 harness 层，**不改产品代码/数据/RLS**）：`.claude/settings.json`、新增 `scripts/harness-*.js`、`.githooks/`、`AGENTS.md`。

---

## 一、决策过程与依据

1. **harness 自评（对照官方定义）**：官方《Agent Harness Design》定义 harness = the loop / tools / context management / guardrails。对照后定位本项目两短板：
   - **反馈验证闭环**：唯一 hook 是 PostToolUse 跑 client type-check+lint，matcher 全局、不跑后端/单测/E2E，无 Stop 门禁、无独立 evaluator。
   - **架构约束**：CommonJS/前后端隔离等约束全是 CLAUDE.md 散文，零 lint 规则/import 限制/pre-commit/CI 机制。
2. **官方最佳实践对齐**：
   - 验证闭环：官方 "Give Claude a way to verify its work"，Stop hook 作确定性门禁，separate generator from evaluator；"show evidence rather than asserting success"。
   - 护栏：官方 "Reversibility 是门禁判据"——hard-to-reverse 动作（删数据/外部调用）应 gate；hooks 提供**确定性控制**而非靠 LLM 自觉。
3. **决策工具**：playground（`docs/harness-hardening-options.html`）逐项呈现 9 项措施推荐度/好处/代价，5 预设对比；默认即「均衡推荐」。
4. **用户拍板（2026-08-08）**：采纳「均衡推荐」A1+A2+A4+B1+B2；A3/B3/B4/B5 本期不做。

**为何取「均衡推荐」**：把已实证踩过的坑机械拦住（B1 三个 footgun + B2 提交把关），把交付质量从"靠自觉"变"硬门槛"（A1 分流 + A2 Stop 门禁），成本最低、收益最直接；跳过 A3（独立复核员）的每次高耗时与 B4/B5（权限收紧/瘦身）的暂缓项。

---

## 二、被采纳方案与实现设计

### A1 智能检查分流（PostToolUse）

- **现状**：`.claude/settings.json` PostToolUse matcher `Write|Edit` 全局跑 `client` type-check+lint——改后端也白跑前端，后端零验证。
- **方案**：新增 `scripts/harness-check.js`，读 hook stdin JSON（`tool_input.file_path`）按路径分流：
  - `client/` 下前端文件（.ts/.tsx/.js/.jsx/.css）→ `cd client && npm run type-check` + `npm run lint`
  - `src/`、`scripts/` 下后端 `.js` → `node --check <file>` + `npm test`（53 单测，秒级无网络）
  - 文档/md/json 等 → 跳过（不产生噪音）
- **验收（REQ V1）**：改 `src/*.js` 触发后端检查；改 `client/src/*` 触发前端检查。

### A2 收尾门禁（Stop hook）

- **方案**：新增 `scripts/harness-stop.js` 作为 Stop hook：
  1. **停止原因门控**：`stop_hook_active === false`（权限弹窗类 stop）→ 静默跳过。
  2. **git 门控**：`git status --short` 无 `src/`/`client/src/`/`scripts/` 改动 → 静默跳过（无谓全量检查不做）。
  3. 有改动 → 跑 `npm run check`；通过 exit 0（静默）；失败输出摘要到 stderr + **exit 2（阻止收尾）**。
- **权衡**：`npm run check` 每次收尾约 20-40s（Windows），是 A2 被接受的代价；两个门控把"无代码改动 / 权限弹窗"场景滤掉。若体验仍不可接受，后续可降级为轻量检查（`npm test` + 改动文件 `node --check`）。
- **验收（REQ V4）**：检查不过时 Claude 不允许标记完成。

### A4 出示证据（AGENTS.md）

- **现状**：AGENTS.md 已有"如实报告结果""不得把未运行的检查描述为通过"，未显式要求出示证据。
- **方案**：在"实现、验证与 Git"节强化：**交付时出示证据（测试输出/命令结果/截图），不以"应该没问题/已通过"替代**；未运行的检查明确说明。
- 与 A2 联动：Stop 门禁保证"检查确实跑过"，A4 保证"结果有据可查"。

### B1 危险操作拦截（PreToolUse）

- **方案**：新增 `scripts/harness-pretooluse.js`，matcher `Bash`，拦三条已知 footgun：

  | 规则 | 触发命令 | 阻止原因 |
  |------|---------|---------|
  | ① | `dedup-existing` 含 `--apply` 且不含 `--dry-run` | 硬反向操作必须先预览清单（REQ 原则） |
  | ② | 命令含 `--keep-ids=`（等号形式） | `flag()` 只认空格分隔，等号被静默忽略 → keep 集为空 → **全删**（2026-08-05 事故，PROGRESS F-013） |
  | ③ | `node --test src`（含 `src/`） | 误把 src 当测试入口 → **触发真实管线**（2026-08-04 事故，CLAUDE.md 已知陷阱） |

- 拦截实现：stderr 说明 + exit 2（阻止该 Bash 调用）。
- **验收（REQ V2）**：三条命令被拦下并给出提示。

### B2 提交把关（pre-commit）

- **方案**：
  1. 仓库内新增 `.githooks/pre-commit`（sh wrapper 调 `scripts/harness-precommit.js`），一次性 `git config core.hooksPath .githooks` 启用（文档化到 LOCAL_SETUP）。
  2. 逻辑：① 检查暂存文件含 `.env*`（`(^|/)\.env(\.|$)`）→ 阻止 + 提示；② 跑 `npm run check`，失败阻止。
- **验收（REQ V3）**：坏提交被拦下；`.env*` 无法入暂存（含 `git add -f`）。

---

## 三、被拒绝/暂缓方案及理由

| 方案 | 结论 | 理由 |
|------|------|------|
| A3 独立复核员 | ❌ 本期不做 | 每次高风险操作多一轮耗时；价值集中在删数据/改历史场景，需固定流程，后续可补 |
| B3 前后端隔离 ESLint 规则 | ❌ 本期不做 | 需定制规则并维护；当前无前端引后端模块实例（A1 分流已顺带约束前端改动检查） |
| B4 权限收紧（deny/sandbox） | ❌ 暂缓 | 安全增强但日常操作更繁琐；现有 allowlist 已克制，收益-成本不划算 |
| B5 CLAUDE.md 瘦身 | ❌ 暂缓 | 160 行偏长是 over-specified 风险，但需人工取舍；建议模型升级后按官方 "re-examine harness" 节奏再处理 |

---

## 四、风险与回滚

| 风险 | 影响 | 缓解 |
|------|------|------|
| A2 Stop 门禁每次收尾 20-40s | 会话节奏变慢 | 双门控（停止原因 + git 改动）滤掉多数场景；不可接受则降级轻量检查 |
| B1 规则误拦正常命令（false positive） | 操作被误阻止 | 规则精确匹配三条命令；误拦可临时删 hook 恢复 |
| pre-commit 首次未安装（core.hooksPath） | 把关不生效 | 文档化安装步骤 + `git config` 验证；提交时检查 `.git/hooks` |
| hook 脚本自身报错阻塞会话 | 会话中断 | 脚本 try/catch 兜底，异常时放行（fail-open）并打印警告 |
| PostToolUse 分流误判路径 | 后端改动没触发检查 | Windows 兼容路径正则（`/` 归一化）；抽查验证 V1 |

**回滚**：全部改动在 harness 层且可版本化——改 `.claude/settings.json` 或 `git revert` 即可回滚；pre-commit 可 `git config --unset core.hooksPath`。

---

## 五、实施顺序

1. 落盘本决策 + REQ 状态更新 + DOCUMENT_MAP / AGENTS.md 同步
2. 新增 `scripts/harness-check.js`（A1）+ 改 `.claude/settings.json` PostToolUse → 验证 V1
3. 新增 `scripts/harness-pretooluse.js`（B1）+ 配置 PreToolUse → 验证 V2
4. 新增 `scripts/harness-stop.js`（A2）+ 配置 Stop hook → 验证 V4（双门控）
5. 新增 `scripts/harness-precommit.js` + `.githooks/pre-commit` + `core.hooksPath`（B2）→ 验证 V3
6. AGENTS.md 加 A4 证据化交付条款
7. `npm run check` 全绿 + 管线 E2E 回归；更新 PROGRESS.md 并提交

## 六、执行结果与偏差（实施后回填，2026-08-08）

**实施范围**：全部落地，未超范围（A3/B3/B4/B5 按决策不做）。改动面 = `.claude/settings.json` + `scripts/harness-{check,pretooluse,stop,precommit}.js` + `.githooks/pre-commit` + `AGENTS.md`，产品代码/数据/RLS 零改动。

**验收项结果**：

| 验收项 | 结果 | 证据 |
|--------|------|------|
| V1 前后端检查分流（A1） | ✅ | `npm run check` exit 0：lint:backend 全 `ok` + lint:client + type-check + 单测 53/53 全绿（仅 3 条 deprecation warning） |
| V2 危险操作拦截（B1） | ✅ | 实施时全量分支测试 8/8（PROGRESS F-016）+ 复核 6/6：规则①/②/③ 命令均被拦（exit 2），`npm test`、`--apply --dry-run`+空格 keep-ids、`node --test "src/*.test.js"` 正确放行（exit 0） |
| V3 提交把关（B2） | ✅ | 端到端实测：`.env.probe` 用 `git add -f` 强推暂存 → `git commit` 被 pre-commit 拦截（exit 1，提示 `git reset`），无新提交产生（HEAD 保持 b46dd87） |
| V4 收尾门禁（A2） | ✅ | 有未提交代码改动时 Stop hook 触发 `npm run check`，exit 0 才放行收尾；不过 exit 2 阻止标记完成（本次会话收尾即实跑） |

**配置就位**：`git config core.hooksPath` → `.githooks`（pre-commit 已启用）；`.claude/settings.json` 三 hook（PostToolUse A1 / PreToolUse B1 / Stop A2）就位。

**偏差与备注**：
- B1 临时验证脚本 `scripts/_test-harness-b1.js` 用毕即删，未入库（自测产物不入版本控制）。
- 实测发现 B1 规则②的正则会在"测试命令串本身含 `--keep-ids=`"时把整条 Bash 当目标拦下——这是 hook 按全命令串匹配的**预期行为**（防的是实际命令行），验证时改用独立脚本喂 stdin 规避自拦，不影响生产使用。
- A2 代价实测：每次有改动收尾多跑约 20-40s `npm run check`，符合决策预估；体验不可接受时可降级轻量检查（见第四节风险表）。
