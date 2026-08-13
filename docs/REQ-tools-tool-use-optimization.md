# REQ: Tools Tool Use 优化 — 结构化工具注册表 + 智能化

> 状态: ✅ 已完成 ｜ 创建: 2026-08-11 ｜ 关联: tools-optimization-guide.html（路线图）

---

## 一、背景

项目 AI 调用工具长期依赖裸 bash 命令（`bash("npm test")`、`bash("node scripts/run-pipeline.js")`），没有任何结构化 tool definition。AI 必须记忆完整命令行语法、flag 命名和参数格式，一个拼写错误就全崩。同时，`src/ai.js` 中用 prompt 引导 DeepSeek 输出 JSON 再用正则 `text.match(/\{[\s\S]*\}/)` 提取——本质是手动实现了一个非标准的 function calling，脆弱且不可靠。

对照 Anthropic 和 OpenAI 的 function calling / tool use 官方最佳实践，项目在"结构化工具定义"维度的差距为 **严重缺失（🔴）**：

- 无 Structured Function Calling 工具定义（name + description + JSON Schema）
- 无 Strict mode / 约束采样
- 无 Tool Use Examples（input_examples）
- 无命名空间分组
- 工具返回值混杂进度消息和结果
- `src/ai.js` 用 prompt + 正则模拟 function calling，而非原生 API

## 二、目标

构建符合 Anthropic/OpenAI function calling 规范的工具注册表，实现：

1. **结构化定义**：每个项目工具拥有完整的 name + 3-4句 description + JSON Schema parameters + input_examples + return_schema，AI 通过结构化接口理解项目工具，不再靠记命令行咒语
2. **按需加载**：高频工具（≤5 个）始终在上下文中，低频工具按需发现，节省 token 消耗
3. **原生 function calling**：`src/ai.js` 的评分和链接选择升级为 OpenAI-compatible tools 参数，模型在 API 层保证输出符合 schema，不再依赖正则解析
4. **结构化输出**：关键脚本（harness-check、git-commit、run-pipeline）支持 `--json` 结构化输出，AI 读取标准 JSON 而非混杂的 stdout

## 三、范围：Phase 1-2

对应 `tools-optimization-guide.html` 四阶段路线图中的前两个阶段。

### Phase 1：结构化（已完成 ✅）

| 交付物 | 位置 | 说明 |
|--------|------|------|
| 工具注册表 | `src/tools/registry.js` | 18 个工具定义，含 name + description + JSON Schema + input_examples + return_schema + command |
| CLAUDE.md 注册 | `CLAUDE.md` | "可用工具（结构化注册表）"章节，核心工具表格 + 按需工具表格 |
| 工具索引 | `getToolIndex()` | name + summary 轻量索引，供 AI 语义匹配发现工具 |
| 工具统计 | `getStats()` | 总数/核心数/按需数/命名空间分布 |

### Phase 2：智能化（已完成 ✅）

| 交付物 | 位置 | 说明 |
|--------|------|------|
| analyzeResultV2 | `src/ai.js` | 原生 function calling（ANALYZE_TOOL），强制 tool_choice，fallback 到 v1 |
| selectArticleLinksV2 | `src/ai.js` | 原生 function calling（SELECT_LINKS_TOOL），强制 tool_choice，fallback 到 v1 |
| harness-check --json | `scripts/harness-check.js` | 结构化输出：passed/stages/status/suggestion |
| harness-diagnose --json | `scripts/harness-diagnose.js` | 结构化诊断：issues 数组含 severity/message/suggestion |
| git-commit --generate | `scripts/git-commit.js` | AI 分析 diff 自动生成 conventional commit，支持 --json 模式 |
| run-pipeline --json | `scripts/run-pipeline.js` | 结构化状态：success/exit_code/crawl4ai_ready/report/log_file |

## 四、不做项（Phase 3-4，明确排除）

以下内容属于路线图后期阶段，本次 REQ 明确不做：

- ❌ **工具链图自动编排**：工具间依赖关系自动触发（改前端→触发 type-check；改后端→触发 test）
- ❌ **自愈闭环**：harness 检测失败 → AI 自动修复 → 重跑验证
- ❌ **PTC 代码编排**：Programmatic Tool Calling，批量数据处理用代码执行替代逐轮 bash
- ❌ **异常模式学习**：harness-pretooluse 从硬编码规则升级为自适应
- ❌ **工具使用评测体系**：量化测量工具调用准确率/冗余调用数

## 五、验收标准

| # | 验收项 | 通过标准 | 状态 |
|---|--------|----------|------|
| 1 | 工具注册表规模 | `src/tools/registry.js` 包含 ≥15 个工具定义，每个有 name + 3-4句 description + JSON Schema + input_examples + return_schema | ✅ 18 个 |
| 2 | 核心工具始终加载 | 5 个工具 `defer_loading: false`，其余 `defer_loading: true` | ✅ check_all / check_test / commit_git / pipeline_run / ops_check |
| 3 | CLAUDE.md 注册 | 有工具体系入口章节，含核心/按需工具表 | ✅ |
| 4 | harness-check --json | 传递 --json 输出结构化 JSON（passed/stages/status）| ✅ |
| 5 | harness-diagnose | 可读取 harness 输入生成结构化诊断（issues 含 severity/message/suggestion）| ✅ |
| 6 | git-commit --generate | 支持 `--generate` AI 生成 commit message，`--generate --json` 输出结构化 JSON | ✅ |
| 7 | run-pipeline --json | 支持 `--json` 输出结构化状态（success/exit_code/crawl4ai_ready 等）| ✅ |
| 8 | ai.js function calling | `analyzeResultV2` + `selectArticleLinksV2` 用原生 tools 参数，有 fallback 到 v1 | ✅ 已接线 v2（env AI_FC=v1 可回退） |
| 9 | 命名空间分组 | 工具按 check/commit/pipeline/ops/data/harness/test 命名空间分组 | ✅ |

## 六、数据/权限影响

- **数据库**：无变更
- **Supabase 表**：无新增/无变更
- **权限**：无新增权限需求
- **新依赖**：无（function calling 复用现有 `openai` SDK，DeepSeek API 本身支持 tools 参数）

## 七、兼容性

全部向下兼容：

| 旧接口 | 状态 | 说明 |
|--------|------|------|
| `analyzeResult()` v1 | ✅ 保留 | V2 fallback 时自动降级 |
| `selectArticleLinks()` v1 | ✅ 保留 | V2 fallback 时自动降级 |
| `parseAnalyzeResult()` | ✅ 保留 | V2 内部 fallback 使用 |
| `npm run check` | ✅ 不变 | registry 封装的是现有命令 |
| `npm test` | ✅ 不变 | 同上 |
| `node scripts/run-pipeline.js` | ✅ 不变 | 新增 --json 是可选 flag |
| `node scripts/git-commit.js` | ✅ 不变 | 新增 --generate 是可选 flag |
| `node scripts/harness-check.js` | ✅ 不变 | 新增 --json 是可选 flag |

**向后兼容原则**：registry.js 和 function calling 是新增层，不修改现有脚本的核心逻辑。AI 可以选择通过 registry 结构化调用或直接 bash 老命令。

## 八、工具明细

### 始终加载（5 个核心）

| 工具 | 命名空间 | 用途 |
|------|----------|------|
| `check_all` | check | 全套验证（lint+type-check+test），改代码后必跑 |
| `check_test` | check | 仅后端测试，快速反馈 |
| `commit_git` | commit | Conventional commit 格式校验+安全门+推送 |
| `pipeline_run` | pipeline | 完整信息管线（Docker自愈→抓取→评分→入库→日报） |
| `ops_check` | ops | 基础设施健康巡检 |

### 按需加载（13 个）

| 命名空间 | 工具 |
|----------|------|
| check | `check_syntax`、`check_type`、`check_quality` |
| pipeline | `pipeline_schedule`、`pipeline_auto_heal` |
| ops | `ops_screenshot`、`ops_docker_restart` |
| data | `data_backfill`、`data_dedup`、`seed_demo`、`update_sources` |
| test | `test_scrape` |
| harness | `harness_diagnose` |

## 九、调用规则（写入 CLAUDE.md 供 AI 遵循）

1. 始终加载的 5 个工具无需搜索，直接可用
2. 按需工具通过 `getToolIndex()` 获取轻量索引（name+summary），语义匹配后再 `getTool(name)` 获取完整定义
3. 查看工具统计：`node -e "const {getStats}=require('./src/tools/registry'); console.log(JSON.stringify(getStats(),null,2))"`
4. 获取工具索引：`node -e "const {getToolIndex}=require('./src/tools/registry'); console.log(JSON.stringify(getToolIndex(),null,2))"`

---

> **关联文档**：路线图 `docs/tools-optimization-guide.html` ｜ 优化后 AI 行为规范见 `CLAUDE.md` 可用工具章节 ｜ 注册表源码 `src/tools/registry.js`
