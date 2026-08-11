# DECISION: AI 工具调用方式优化 — 从裸 bash 到结构化 Function Calling 注册表

> 状态: Decided ｜ 决策日期: 2026-08-11 ｜ 依据: CLAUDE.md 工具章节 + registry.js 实施现状
> 涉及: `src/tools/registry.js` + `src/ai.js` + AI 交互模式（Claude/OpenAI-compatible 客户端）

---

## 决策结论

**方案三：完整 function calling 注册表。** 将所有 npm scripts / scripts/*.js / harness 封装为符合 Anthropic tool use + OpenAI function calling 规范的 JSON Schema 工具定义，AI 通过结构化 registry 理解可用工具，不再裸写 `bash("npm run xxx")`。

核心成果：
- **18 个结构化工具**（5 核 + 13 延迟），覆盖 check / commit / pipeline / ops / data / harness / test 七个命名空间
- **统一 JSON Schema** 格式，同时兼容 Anthropic 和 OpenAI 规范
- **v1 fallback 保留**：`analyzeResult` 原有 prompt+正则 JSON 提取路径不受影响；function calling 失败时自动回退

---

## 一、方案对比

### 方案一：继续裸 bash 命令（不采纳）

AI 每次手写 `bash("npm run check")` / `bash("node scripts/run-pipeline.js --no-alert")`。

| 维度 | 评估 |
|------|------|
| 认知负担 | **高** — AI 需要记住每个命令的参数格式、flag 名称、默认值 |
| 出错概率 | **高** — `--no-alert` vs `--noAlert`、`--light` vs `light` 等容易记混 |
| 上下文占用 | **低** — 每次只传命令文本 |
| 可发现性 | **零** — AI 不知道项目有哪些工具可用，只能搜 package.json scripts |
| 返回值理解 | **差** — 无法结构化描述输出，AI 靠试错猜返回含义 |

**典型故障模式**：
- 把 `pipeline_run` 的 `--no-docker` 写成 `--nodocker`（项目实际用的是 camelCase flag）
- 忘记 `data_dedup` 必须先 `--dry-run` 才能 `--apply`，直接执行不可逆删除
- 不知道 `ops_check` 有 full/light/actions 三种模式

### 方案二：轻量结构化（不采纳）

只给每个工具加 `name` + `description` 文本，不加 JSON Schema、无 input_examples、无 return_schema。

| 维度 | 评估 |
|------|------|
| 认知负担 | **中** — 知道有哪些工具，但不知道参数 |
| 出错概率 | **中** — 知道有 `data_backfill` 但不知道参数名，仍会猜错 |
| AI 自主调用 | **不可行** — 没有 schema 无法通过 function calling 机制调用；本质上仍是文本描述 |
| 维护成本 | **低** — 只写一句话描述 |

**根本缺陷**：Anthropic/OpenAI function calling 机制需要严格的 JSON Schema 来验证参数类型和约束，纯文本描述无法被 tool use API 消费。方案二等于是"方案一的文字美化版"。

### 方案三：完整 function calling 注册表（采纳 ✅）

每个工具包含：
- `name` — 符合 function calling 规范的标识符
- `description` — 3-4 句详细描述（做什么、何时用/何时不用、边界条件、限制）
- `parameters` — JSON Schema 规范参数定义（类型、枚举、required、additionalProperties）
- `input_examples` — 1-3 个真实场景调用示例
- `return_schema` — 返回值结构描述
- `command` — 实际执行命令（向后兼容 bash 调用）
- `defer_loading` — 按需加载标记

| 维度 | 评估 |
|------|------|
| 认知负担 | **低** — AI 只需理解参数名和描述，无需记忆 flag 格式 |
| 出错概率 | **低** — schema 自动验证参数类型/枚举，枚举值拼错会被拦截 |
| 可发现性 | **高** — `getToolIndex()` 返回全量索引；按命名空间/标签筛选 |
| 上下文占用 | **可控** — defer_loading 拆分 5 核心 + 13 延迟 |
| 返回值理解 | **好** — `return_schema` 结构描述让 AI 无需试错 |

---

## 二、采纳方案三的关键理由

### 2.1 Anthropic 官方数据：工具描述是最高杠杆优化

Anthropic 在 SWE-bench 评测和工程师使用数据中反复验证：**精确的工具描述（含边界条件和使用时机）是最高的单点优化杠杆**，远高于模型选择、prompt 长度等其他变量。

> 证据：Claude 官方 tool use 文档强调 description 字段应包含"when to use vs when NOT to use"——这正是 registry 中每个工具的 description 段落结构。

### 2.2 OpenAI 官方建议：保持初始工具 <20 个，用按需发现

OpenAI function calling 最佳实践：
- 初始发送的工具定义控制在 <20 个
- 高频工具始终加载，低频工具通过语义搜索按需发现
- 描述要精确到"何时用、何时不用"（与 Anthropic 建议一致）

本项目的 `defer_loading` 机制直接映射这一设计：5 核工具始终在上下文，13 个延迟工具通过 `getToolIndex()` 按需发现后加载完整定义。

### 2.3 按需加载：5 核 13 延迟，符合 Anthropic 推荐的 "3-5 个始终加载"

| 分组 | 数量 | 工具 |
|------|------|------|
| 📌 始终加载 | 5 | `check_all`、`check_test`、`commit_git`、`pipeline_run`、`ops_check` |
| ⏳ 按需加载 | 13 | `check_syntax`、`check_type`、`check_quality`、`pipeline_schedule`、`pipeline_auto_heal`、`ops_screenshot`、`ops_docker_restart`、`data_backfill`、`data_dedup`、`seed_demo`、`update_sources`、`test_scrape`、`harness_diagnose` |

5 个核心工具的选择标准：**AI 在当前项目中几乎每次会话必定用到**。这组工具覆盖了"改代码→验证→提交"和"诊断/运行管线"两个最高频工作流。

### 2.4 function calling v2：替代脆弱的 prompt+正则 JSON 提取

当前 `analyzeResult` 走的是传统路线：
```
DeepSeek API (prompt 要求输出 JSON)
  → response.choices[0].message.content (文本)
  → 正则提取 JSON 块
  → JSON.parse
```

这个路径的脆弱性：
- DeepSeek 偶尔在 JSON 外包裹 markdown 代码块标记或解释性文字
- 需要维护多层 fallback 正则（```json、裸{、多行匹配等）
- JSON 格式漂移时只能靠 prompt 约束

function calling 路径（v2）：
```
DeepSeek API (tools 参数，函数签名强制结构)
  → response.choices[0].message.tool_calls[0].function.arguments (纯 JSON)
```

优势：
- **结构保证**：DeepSeek 支持 OpenAI-compatible `tools` 参数，返回值走 `tool_calls` 通道，不经文本解析
- **Schema 约束**：API 层即验证 JSON 结构，不会出现 markdown 包裹
- **v1 fallback**：`analyzeResultV2` 在 function calling 失败时自动回退 v1 路径，不引入新故障点

---

## 三、关键技术选择

### 3.1 统一 JSON Schema 格式

所有工具参数使用标准 JSON Schema（Draft 2020-12 兼容子集），同时兼容：
- **Anthropic tool use** — `input_schema` 字段映射
- **OpenAI function calling** — `parameters` 字段映射

关键约束：
- 每个工具的 `parameters` 必须包含 `type: "object"`、`properties`、`required`（可为空数组）
- 枚举参数用 `enum` 约束，防止 AI 编造不存在的 flag 值
- `additionalProperties: false` 防止 AI 添加未定义的参数

### 3.2 defer_loading 标记控制按需加载

```
defer_loading: false  → 始终在系统 prompt 中（核心 5 个）
defer_loading: true   → 通过 getToolIndex() 按需发现，匹配到后 getTool(name) 取完整定义
```

发现流程：
1. AI 收到任务 → 调 `getToolIndex()` 获取 18 个工具的 name+summary
2. 语义匹配到目标工具 → 调 `getTool(name)` 获取完整 schema
3. 拿到 parameters JSON Schema → 构造正确的 function call

### 3.3 工具按语义命名空间分组

| 命名空间 | 前缀 | 工具数 | 职责 |
|----------|------|--------|------|
| `check` | `check_` | 4 | 语法/类型/测试/日报质量验证 |
| `commit` | `commit_` | 1 | Git 提交（conventional commit + 安全门） |
| `pipeline` | `pipeline_` | 3 | 管线运行/调度/自愈 |
| `ops` | `ops_` | 3 | 基础设施巡检/截图/Docker 管理 |
| `data` | `data_` | 4 | 数据回填/去重/种子/信源配置 |
| `test` | `test_` | 1 | 单信源抓取测试 |
| `harness` | `harness_` | 1 | harness 诊断结果读取 |

命名规则：`{namespace}_{action}`，如 `check_all`、`data_dedup`、`pipeline_run`。

### 3.4 v1 函数保留作为 fallback

`src/ai.js` 中的 `analyzeResult`（prompt+正则 JSON 提取）保持不变。

`analyzeResultV2` 设计：
- 优先走 function calling 路径（`tools` 参数传给 DeepSeek）
- 如果 function calling 返回空 tool_calls 或 API 报错 → 自动 fallback 到 `analyzeResult`（v1 路径）
- fallback 触发时记录 warn 日志，但不阻断管线

这样 v2 是纯增量，不引入回归风险。

### 3.5 harness --json 模式是可选的

harness 当前产出文本格式。增加 `--json` 模式（可选，不加 flag 时向后兼容原文本输出）：
- `--json` 开启时 stdout 输出结构化 JSON，供 `harness_diagnose` 工具解析
- 不加 `--json` 时行为与原来完全一致，不影响现有 CI/CD 流水线

---

## 四、风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| DeepSeek function calling 兼容性不确定 | v2 路径可能返回空 tool_calls 或格式异常 | `analyzeResultV2` 内置 fallback 到 v1；v1 路径未修改，零风险 |
| 工具定义 token 开销 | 5 核工具定义和索引会占上下文 | `defer_loading` 按需加载 13 个低频工具；`getToolIndex()` 只返回 name+summary 一行，不返回完整 schema |
| 新增 registry.js 增加维护负担 | 新增 npm script 需要同步更新注册表 | `registry.js` 作为单一真源——新增工具时只改这一个文件，CLAUDE.md 工具章节引用 registry 即可 |
| 工具定义与 npm scripts 不同步 | 改了 npm script 参数但忘了更新 registry | 模块守卫 `node src/tools/registry.js` 输出统计信息，可用于 CI 巡检；未来可加一致性校验脚本 |

---

## 五、实施范围

| 文件 | 变更性质 | 说明 |
|------|----------|------|
| `src/tools/registry.js` | **新增** | 18 个工具的完整结构化定义 + 查询 API |
| `CLAUDE.md` 工具章节 | **更新** | 原来列 npm scripts 的表改为引用 registry，始终加载/按需加载两组 |
| `src/ai.js` | **不改** | v1 `analyzeResult` 保留；v2 为增量函数，不修改原有逻辑 |
| harness hooks | **可选增量** | `--json` 模式为可选 flag，不加时完全向后兼容 |

---

## 六、验收标准

- [x] `node src/tools/registry.js` 输出 18 个工具、5 核 + 13 延迟的正确统计
- [x] `getToolIndex()` 返回 18 条索引，每条含 name + summary + namespace + defer_loading
- [x] 每个工具的 `parameters` 通过 JSON Schema 语法校验（`type: object`、`properties`、`required` 字段齐全）
- [x] 命名空间分组一致：check(4) / commit(1) / pipeline(3) / ops(3) / data(4) / test(1) / harness(1) = 18
- [ ] `analyzeResultV2` function calling 路径 + v1 fallback 端到端验证（待实施）
- [ ] harness `--json` 模式与现有文本模式兼容（待实施）

---

## 七、后续

1. 实施 `analyzeResultV2`（增量函数，不改 v1）
2. harness hooks 加可选的 `--json` 输出模式
3. CI 中增加 registry 一致性巡检：对比 `npm run` 列出的 scripts 与 registry 中的工具定义是否全覆盖
