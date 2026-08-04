# DECISION: Phase 8 — 信息获取与理解层优化 技术选型

> 状态: Decided ｜ 决策日期: 2026-08-04 ｜ 依据: REQ-Phase8-信息获取与理解层优化 + 4 路 subagent 调研
> 参与: Patrick（决策：P0+P1+P2 全量；DMN 保留并标注）

---

## 决策结论

**方案：获取层数据卫生 + 理解层 AI 重写 + 信源整治三线并行。** 核心是三个结构性决策：

1. **真实日期取代假日期** —— 从 URL 提取发布日期，无日期如实标 `null`，前端按真实发布日期排序 + 30 天时效窗口（T0 豁免）。
2. **正文喂养取代标题-only** —— 复用 crawl4ai 通道对相关 Top-N 抓正文，单轮喂 `analyzeResult`，突破"摘要只有标题可复述"的天花板。
3. **证据门控分类取代"猜最像"** —— 体裁前置分流 + 证据门控 + `other` 兜底，杜绝"访谈→injury"式误判。

改动面：后端 `src/ai.js`/`crawl4ai-fetch.js`/`items.js`/`scraper-direct.js`/`index.js` + 新增 `src/dates.js`/`scripts/backfill-published-at.js` + 前端 6 文件 + 验收脚本 + Supabase SQL。

---

## 一、三大结构性根因 → 技术决策

### 1. 假日期 → 真实日期提取 + null 化 + 回填

| 方案 | 描述 | 结论 |
|------|------|------|
| ✅ **选** URL 正则提取 | Guardian `/2026/jun/08/`、TechCrunch/DMN/SI/SBNation `/2026/8/4/` 可靠；无日期段标 `null` | 性价比最高，纯正则可单测 |
| ❌ 逐篇抓正文页 meta | 每篇多一次抓取，成本高 | 本期不做 |
| ❌ 只改前端排序 | 不解决"6月旧闻当新"的入库污染，窗口建立在假日期上 | 顺序上必须先修日期再上窗口 |

**关键约定**：`publishedAt: new Date()`（抓取时刻）全部移除；`published_at` 语义改为"真实发布日期，无则 NULL"；一次性回填脚本清历史脏数据。`filterNewItems` 的 URL 去重保留（去重依据），旧闻判定交给"真实日期 + 前端窗口"。

### 2. AI 无正文 → crawl4ai 通道正文喂养

| 方案 | 描述 | 结论 |
|------|------|------|
| ✅ **选** crawl4ai 单篇抓正文 | 复用同一容器/通道，容器可过墙（BBC/Guardian/ESPN 系均可达）；对 `RESULT_LIMIT=15` 相关候选抓取 | 唯一能突破 A4 天花板的路径 |
| ❌ 复用 `reader.js` | axios 直连，BBC/Guardian/claude.com 直连超时，Yahoo/BR 403 | 通道对白名单源不可用 |

**约束**：
- **单轮 LLM/篇** —— 正文在同一个 `analyzeResult` 调用里喂入（不引入两轮 LLM 调用，尊重 Phase7 决策）。
- **有界成本** —— 只对 `preFilter` 通过后的 Top-N（`RESULT_LIMIT`）抓正文；并发池 3（不能 15 个并发压垮容器）。
- **优雅降级** —— body 抓取失败返回 `null`，自动回落标题-only，不阻断。

### 3. 分类/数据脏 → 证据门控 + schema 修复

| 根因 | 修复 |
|------|------|
| 分类"选最贴切"无证据门控 | 分类指令 v2：体裁前置分流（访谈/特写→other，复盘/前瞻→match）+ 证据门控（必须能从标题/摘要引证原话）+ `other` 兜底 |
| 禁选 other + MU 无 other 键 | 去掉"不要选 other"；MU `category_schema` 补 `"other":"其他"` |
| anthropic schema 是数组 | `buildCategoryHint` 加 `Array.isArray` 分支 + DB 转对象 + 回填 30 行污染 |
| MU 8 键 vs 前端 5 板 | BoardView 加"其他"兜底板（收集无对应板块的 category） |
| Yahoo 导航垃圾漏网 | `isNonArticleUrl` 加固 + `isSpamTitle` + Yahoo pattern 收紧 `\.html$` |

---

## 二、被拒绝方案及理由

| 方案 | 被拒绝理由 |
|------|-----------|
| 纯 prompt 微调挤事实（Phase7 已到天花板） | AI 手里只有标题，prompt 再狠也变不出正文里的数字/人名 —— A4 不会及格 |
| 重构 Dallas Source Map 为 insider-first（GPT 建议） | 库里 3/8 源 0 产出、Yahoo 还在漏垃圾——问题在"源没产出+产出没消化"，不在源列表；且多数提议源已实测不可达（ESPN/ATH paywall） |
| 删除 DMN | 用户权衡后改为**保留并标注**——本地跟队独家（Townsend/Caplan）无免费替代 |
| reader.js 复用 | 通道对白名单源不可用（见上） |
| 两轮 LLM（先标题评分再正文精修） | 违反 Phase7"不引入两轮 LLM 调用"约束 |
| event_type 与板块深度解耦 | 本期只做"提取+入库+徽章"，不做 BoardView 体裁过滤（二期） |

---

## 三、关键决策点明细

### 3.1 正文喂养设计（两阶段，单轮 LLM）
```
preFilter 通过 → 取前 RESULT_LIMIT 条 → 并发池3抓正文(crawl4ai) → analyzeResult(title, body) 单轮评分+摘要+分类+event_type
body 为 null → 自动回落标题-only
```

### 3.2 日期语义
```
published_at = extractPublishDateFromUrl(url) || null
前端: published_at>30天 → 绝对日期(formatDateTime)；null → "发现于 {created_at}前"
窗口: 非 T0 且 published_at>30天 → 默认隐藏（"显示旧闻"开关可看）
排序: published_at DESC NULLS LAST → created_at DESC
```

### 3.3 DMN（用户决策）
- **保留**，前端卡片标"正文需订阅"（`PAYWALL_SOURCES` 常量，可扩展）。
- 计量墙（10篇/30天）不影响链接发现（列表页标题免费），本地跟队情报价值保留。

### 3.4 event_type（最小落地）
- `articles` 表加 `event_type text`（nullable）。
- prompt 输出 `event_type ∈ {official, news, interview, recap, preview, analysis, rumour, feature, other}`。
- 前端卡片加体裁徽章。BoardView 不做体裁过滤（二期）。

### 3.5 信源整治
- **HoopsHype**：`hoopshype.com/tag/dallas-mavericks/`，tier 2，已实测 crawl4ai 可达，ARTICLE_PATTERN 实施时对 31 条实测链接定稿。
- **Mavs Moneyball / Smoking Cuban**：`crawlPage` 加 `crawler_params.wait_for`（JS 渲染），治 0 产出。
- **Bleacher Report**：pattern `/\/dallas-mavericks\//` → `/\/articles\//`。
- **ClutchPoints / r/Mavericks**：实施时实测可达才加。

---

## 四、风险与回滚

| 风险 | 影响 | 缓解 |
|------|------|------|
| 正文喂养增加每轮耗时（≤15 次容器抓取） | 每轮 +2-3 分钟 | 并发池 3；如过慢可降 `RESULT_LIMIT` 或加开关 |
| 单篇正文被抓虫拦截（ESPN 系） | 摘要回落标题-only | body=null 优雅降级，不阻断 |
| URL 日期正则误判 | 日期错乱 | 纯函数单测 + 未来日期拒绝 + 回填脚本可重复跑 |
| HoopsHype pattern 写错 | 新源 0 产出 | 实施时先对实测链接核对 |
| 前端窗口误杀有值旧闻 | 漏新闻 | T0 豁免 + "显示旧闻"开关 |
| prompt v2 过硬误杀 | 漏新闻 | 不编造铁律只影响摘要不评分；分类/评分保留硬约束例外 |

**回滚**：改动集中 `src/*.js` + `client/src/*`，Git revert 即可；DB 变更（event_type 列、schema 更新）可逆或幂等（`IF NOT EXISTS`）。

---

## 五、实施顺序

1. 落盘本决策 + REQ + PLAN 文档
2. 分派 3 个实施 subagent（获取层后端 / 理解层后端 / 前端+验收）并行
3. 集成：Supabase SQL（schema/回填/新源）→ 回填脚本 → `node --check` + `npm test` → 跑管线 → check-quality
4. 更新 CLAUDE.md / PROGRESS.md / REQ-Dallas
