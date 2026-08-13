# REQ: Tools Hook 数据驱动 + 使用日志 + 工具链图

> **写给 AI（Claude）看的需求文档。** 定义 Phase 3 的"工具链图 + 使用日志 + Hook 数据驱动"三块改造，范围明确、可验收。

## 一、背景

Phase 1-2 已完成：18 个工具结构化注册表（`src/tools/registry.js`）、harness `--json` 诊断、`commit --generate`、`pipeline --json`、`ai.js` v2。

但还有三个缺口：

1. `scripts/harness-check.js` 里"前端文件跑 type-check + lint、后端文件跑 node --check + npm test"的规则是**硬编码**的（`isFrontend` / `isBackend` 两个正则写死在代码里），新增工具或调整检查策略都要改 harness 代码。
2. **没有工具使用日志**——不知道哪些工具被 AI 用了、用对了没有、哪些从没用过（无法评估注册表 18 个工具的真实使用率）。
3. **没有工具链图（suggest_next）**——AI 不会根据上一个工具的返回值建议下一步（如 `check_all` 失败后建议 `ops_check`、`pipeline_run` 失败后建议 `ops_docker_restart`）。

## 二、目标

1. **Hook 数据驱动**：文件变更 → 触发哪些检查工具，改为读 `tool-graph.json` 声明，不写死在 harness 代码里。
2. **工具使用日志**：每次 AI 调用工具（或 harness 触发）追加一条 JSONL 到 `logs/.tool-usage.jsonl`，字段含 `tool`、`trigger`、`files`、`success`、`durationMs`、`timestamp`。
3. **工具链图**：`tool-graph.json` 给每个工具声明 `suggest_next`（根据返回值建议下一个工具），提供 `graph.js` 查询函数。

## 三、范围

| 文件 | 类型 | 内容 |
|------|------|------|
| `src/tools/tool-graph.json` | 新建 | 工具关系数据文件：每个工具的文件匹配规则（`file_patterns`）+ 检查动作（`actions`）+ `suggest_next` 映射 |
| `src/tools/graph.js` | 新建 | `graphForFiles(files)`（文件 → 应触发的检查）+ `graphSuggestNext(tool, result)`（返回值 → 建议的下一个工具）查询函数 |
| `src/tools/usage-logger.js` | 新建 | `logToolUse()` 追加写 JSONL（字段：`tool`、`trigger`、`files`、`success`、`durationMs`、`timestamp`） |
| `scripts/harness-check.js` | 修改 | 读图替代硬编码的文件分流逻辑 |
| `scripts/git-commit.js` | 修改 | 提交成功记日志 |
| `scripts/run-pipeline.js` | 修改 | 管线结束记日志 |

## 四、不做项

- ❌ 不删 `registry.js` 里的任何工具
- ❌ 不改 `ai.js`（Phase 2 已交付）
- ❌ 不做自愈闭环（六步路线的第 5 步，Phase 4）
- ❌ 不做 AI 提议改工具链（第 6 步）
- ❌ 不做评测集（第 4 步，后续单独做）

## 五、验收标准

1. `tool-graph.json` 覆盖 `registry.js` 全部 18 个工具，名字一一对应。
2. `harness-check.js` 在 `tool-graph.json` 存在时用它做文件匹配，缺失时回退到旧硬编码。
3. `usage-logger.js` 在 `logs/` 目录不存在或不可写时不抛异常（静默降级）。
4. `graph.js` 两个函数有单元测试可跑通（`node --test`）。
5. `git-commit.js` 和 `run-pipeline.js` 成功路径追加日志，失败路径也记录（`success=false`）。
6. `node --check` 全部通过。

**评审修复已落地（2026-08-13）**：P1-3 前端 .tsx 不再误触发 node --check/后端测试；P0-2 usage hook（PostToolUse Bash）已接入，经 `command-map.js` 将每次 Bash 调用全量捕获并归一到 18 工具名，写入 `logs/.tool-usage.jsonl`。

## 六、数据/权限影响

- 新增 `logs/.tool-usage.jsonl`（追加日志，进 `.gitignore`——本地使用数据，倾向不入库）。
- 无数据库变更、无权限变更。

## 七、兼容性

全部向后兼容：

- `tool-graph.json` 缺失 → harness 回退旧逻辑
- 日志写入失败 → 静默跳过
- 不改变现有 CLI 参数和 `--json` 输出格式

---

*最后更新: 2026-08-13*
