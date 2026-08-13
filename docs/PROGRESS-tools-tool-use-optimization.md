# PROGRESS — 工具体系 & Tool-Use 优化

> **写给 AI（Claude）看的进度文档。** 如果你被派来这个项目干活，先读这个了解工具体系改造的全貌。

## 一句话总结

将项目的运维脚本、管线入口、验证命令等 18 个能力封装为结构化 function calling 注册表（`src/tools/registry.js`），让 AI 可以通过 name + JSON Schema parameters 精准调用，而不是靠裸 `bash("npm run xxx")`。

**Phase 3 已落地（2026-08-13）**：hook 数据驱动（tool-graph.json）、工具使用日志（usage-logger.js）、工具链图（graph.js + suggest_next）。详见 [REQ-tools-hook-usage-graph.md](REQ-tools-hook-usage-graph.md) / [DECISION-tools-hook-usage-graph.md](DECISION-tools-hook-usage-graph.md) / [REFACTOR-tools-phase3-analysis.md](REFACTOR-tools-phase3-analysis.md)。

---

## 产出文件清单

### 新建

| 文件 | 用途 |
|------|------|
| `src/tools/registry.js` | 18 个工具的结构化 function calling 注册表（名称、描述、parameters JSON Schema、return_schema、示例、命名空间） |
| `scripts/harness-diagnose.js` | harness 历史输出结构化诊断（读取 harness 日志，分析问题 + 给建议） |
| `docs/tools-optimization-guide.html` | 完整优化路线图 HTML（Phase 1-4 全览，含流程图和状态标记） |
| `src/tools/tool-graph.json` | 工具关系数据文件：triggers_on（文件→检查）+ suggest_next（返回值→下一步建议）（Phase 3） |
| `src/tools/graph.js` | 工具链图查询：graphForFiles / graphSuggestNext / validateGraph + 单元测试 graph.test.js（15/15）（Phase 3） |
| `src/tools/usage-logger.js` | 工具使用日志 JSONL 追加写（logs/.tool-usage.jsonl，静默降级）+ usageStats 汇总（Phase 3） |
| `docs/REFACTOR-tools-phase3-analysis.md` | 项目重构化简分析：10 条分级建议（归档一次性脚本/公共 lib/legacy 删除等） |

### 修改

| 文件 | 变更 |
|------|------|
| `CLAUDE.md` | 新增"可用工具（结构化注册表）"章节，列出 5 核心 + 13 按需工具、调用规则 |
| `scripts/git-commit.js` | 新增 `--generate`（AI 分析 diff 生成 commit message）+ `--json`（结构化输出）+ 使用日志（Phase 3） |
| `scripts/harness-check.js` | 新增 `--json` 结构化诊断输出（含 `suggestion` 字段）+ 数据驱动 hook 读 tool-graph.json（Phase 3）+ 修复 --json 分支 ReferenceError |
| `scripts/run-pipeline.js` | 新增 `--json` 结构化状态输出 + 管线使用日志（Phase 3） |
| `src/ai.js` | 新增 `analyzeResultV2` + `selectArticleLinksV2`（原生 function calling 调用 AI），v1 保留为 fallback |

---

## 工具体系统计

| 维度 | 数值 |
|------|------|
| 总工具数 | **18** |
| 始终加载（启动即注册） | **5** |
| 按需加载（defer_loading） | **13** |
| 命名空间数 | **7** |

### 命名空间分组

| 命名空间 | 数量 | 工具 |
|----------|------|------|
| `check` | 5 | `check_all`, `check_test`, `check_syntax`, `check_type`, `check_quality` |
| `commit` | 1 | `commit_git` |
| `pipeline` | 3 | `pipeline_run`, `pipeline_schedule`, `pipeline_auto_heal` |
| `ops` | 3 | `ops_check`, `ops_screenshot`, `ops_docker_restart` |
| `data` | 4 | `data_backfill`, `data_dedup`, `seed_demo`, `update_sources` |
| `test` | 1 | `test_scrape` |
| `harness` | 1 | `harness_diagnose` |

---

## 改造维度 & 状态

| # | 维度 | 状态 | 说明 |
|---|------|------|------|
| 1 | 结构化工具定义 | ✅ done (18/18) | 每个工具有 name、description、parameters（JSON Schema）、return_schema、input_examples |
| 2 | 按需加载机制 | ✅ done | `defer_loading: true` 标记 13 个工具；`getToolIndex()` 提供轻量索引 |
| 3 | 命名空间分组 | ✅ done | 7 个命名空间，每个工具带 `namespace` 字段 |
| 4 | input_examples | ✅ done | 每个工具 1-3 个真实调用示例 |
| 5 | return_schema | ✅ done | 所有工具返回值结构化描述 |
| 6 | harness --json 诊断 | ✅ done | `harness-check.js --json` + `harness-diagnose.js` 双通道 |
| 7 | 智能 commit message | ✅ done | `git-commit.js --generate` 调 AI 分析 diff 生成 message |
| 8 | pipeline --json 状态 | ✅ done | `run-pipeline.js --json` 返回 JSON 结构化流水线状态 |
| 9 | ai.js function calling v2 | ✅ done | `analyzeResultV2` + `selectArticleLinksV2`，v1 保留为 fallback |
| 10 | 工具链图 + response_format | 🔲 planned (Phase 3) | 工具间调用链可视化 + AI response 格式约束 |
| 11 | 自愈闭环 | 🔲 planned (Phase 4) | Docker 宕机自动拉起 + 管线失败自动重试 + 告警收敛 |

---

## 架构要点

### 调用规则（对 AI 的约束）

1. **5 个核心工具始终可用**：`check_all`, `check_test`, `commit_git`, `pipeline_run`, `ops_check` — 它们在 CLAUDE.md 里直接列出，AI 不需要搜索
2. **13 个按需工具需要两步**：先调 `getToolIndex()` 获取索引（name + summary），匹配到后调 `getTool(name)` 获取完整定义（parameters + return_schema）
3. **查看注册表统计**：`node -e "const {getStats}=require('./src/tools/registry'); console.log(JSON.stringify(getStats(),null,2))"`

### ai.js v1/v2 共存策略

- `analyzeResultV2` / `selectArticleLinksV2`：原生 function calling 调用（推荐）
- v1 函数保留，不删除：作为 fallback，确保降级路径
- 调用方先尝试 v2，失败自动回退 v1

### harness 诊断双通道

- **快速通道**：`node scripts/harness-check.js --json` — 轻量级，给状态 + suggestion
- **深度通道**：`node scripts/harness-diagnose.js` — 读取 harness 历史日志，给完整诊断报告

---

## 当前阶段

**Phase 3 已落地，Phase 4 待启动。**

- Phase 1 ✅ — 梳理工具清单、定义命名空间
- Phase 2 ✅ — 注册表实现、按需加载、harness 诊断、commit --generate、pipeline --json、ai.js v2
- Phase 3 ✅ — hook 数据驱动（tool-graph.json + graph.js）、工具使用日志（usage-logger.js）、工具链图（suggest_next）
- Phase 4 🔲 — 自愈闭环（Docker 自动拉起、失败重试、告警收敛）+ 评测集 + 使用日志数据分析

**使用日志分析入口**：`node src/tools/usage-logger.js`（直接运行输出各工具调用统计）

**重构化简执行清单**：见 [REFACTOR-tools-phase3-analysis.md](REFACTOR-tools-phase3-analysis.md) §七，分三批执行（第一批零风险归档+公共lib，第二批含验证，第三批观察期后）。

**重构已落地并合并（2026-08-13）**：三批重构已执行、验证、合并到 master 并推送到远端（`89cadcc`）。详见 [REFACTOR-tools-cleanup-report.md](REFACTOR-tools-cleanup-report.md)。9/10 建议落地，legacy 删除（建议3）待 DB 清理 `claude-blog` 关键词后执行，ai.js v1 收口（建议5）待 v2 观察期后执行。新增公共层：`scripts/lib/common.js`、`scripts/lib/check-js.js`、`scripts/lib/ops-common.js`；共享核心：`src/run-single-keyword.js`。

---

*最后更新: 2026-08-13*
