# DECISION: Anthropic 信源监控方案选型纪要

> 决策日期: 2026-08-04 ｜ 参与: Patrick + Alice
> 参考: docs/DECISION-方案选型纪要.md（MU 方案选型）
> 背景: Anthropic 关键词当前 0 白名单信源，仅 HackerNews 兜底；claude-blog 关键词独立 blog pipeline 维护成本高

---

## 决策背景

Patrick 确认下一个目标是"补齐其余关键词的白名单信源"（选项 A）。四个关键词中，MU 已有 7 源三 tier 生产白名单；claude-blog 走独立 blog pipeline；anthropic 和 dallas-mavericks 均为 0 信源、纯 HackerNews 兜底。

本次聚焦 anthropic，后期再覆盖 dallas-mavericks。

---

## 决策 1: claude-blog 关键词合并

### 现状
- `claude-blog` 是独立 `blog` 类型关键词，走 cheerio 抓 claude.com/blog → 读全文 → summarizeArticle
- `anthropic` 是 `search` 类型关键词，走 crawl4ai 白名单抓取 + AI 评分 + 交叉验证
- 两个关键词内容高度重叠（都覆盖 Anthropic 公司动态），前端分两个 Tab 展示，体验割裂

### 方案对比

| 方案 | 描述 | 利弊 |
|------|------|------|
| A — 转为 search 信源 | claude-blog 停用，Anthropic 官方内容由 `anthropic.com/news` + `anthropic.com/research` 两个 search 信源覆盖 | ✅ 干净，统一管线 ✅ 零代码改动 ✅ 前端一个 Tab |
| B — 保留独立 | 两个关键词都跑，不改 | ❌ 前端两个 Tab 语义重叠 ❌ blog pipeline 维护成本 |
| C — 混合 pipeline | anthropic 关键词同时有 search 信源 + blog 信源 | ❌ 工程量大，改 pipeline 架构 |

### 决策

**选 A。** claude-blog 关键词停用（`enabled=false`），Anthropic 官方内容统一走 search 白名单模式。理由：

1. `anthropic.com/news` + `anthropic.com/research` 已覆盖全部官方内容（实测 HTTP 200）
2. `claude.com/blog` 连接超时（国内不可达），原有 pipeline 实际上可能已失效
3. 统一管线降低维护成本，新信源加入只需一行 SQL

---

## 决策 2: HackerNews 兜底保留与否

### 现状
`src/search.js` 逻辑：有白名单信源 → 不走 HN；没白名单 → 走 HN。给 anthropic 加白名单后 HN 自动停用。

### 方案对比

| 方案 | 描述 | 利弊 |
|------|------|------|
| 保留 HN | 白名单基础上额外跑 HN 作为补充 | ⚠️ 可能抓到社区小道消息 ✅ 但杂讯多、去重成本高 |
| 去掉 HN | 只走白名单，与 MU 模式一致 | ✅ 干净 ✅ MU 已验证可行 |

### 决策

**去掉 HN。** 理由：

1. MU 已验证：白名单 7 源三 tier 足以覆盖曼联新闻，不需要 HN
2. AI 公司新闻比足球更多样，5 源二 tier 覆盖 TechCrunch/VentureBeat/Wired + 官方已经够全面
3. HN 的 AI 版内容海量且信号低，AI 评分过滤压力大
4. 与 MU 保持一致，行为可预测

---

## 决策 3: Tier 模型设计（Anthropic 场景适配）

### 现状
MU 采用三 tier 模型：T0 官方 / T1 跟队记者(X) / T2 主流体育媒体。

### Anthropic 场景差异

| 维度 | 足球 | AI 公司 |
|------|------|---------|
| 记者文化 | 有跟队记者爆料传统（Ornstein/Romano/Stone） | 无爆料文化，媒体报道均为正式渠道 |
| X 账号价值 | 高（记者单独发帖爆料） | 低（公司官方账号只发公告链接） |
| T2 价值 | 高（ESPN/Sky/Guardian 互补） | 低（综合媒体与 T1 高度重叠） |
| 学术源价值 | 无 | 有（ArXiv 论文） |

### 方案对比

| 方案 | T0 | T1 | T2 | 信源数 |
|------|----|----|-----|--------|
| A — 简化二 tier | 官方 2 源 | 顶级科技媒体 3 源 | 无 | 5 |
| B — 复制 MU 三 tier | 官方 2 源 | Animus 记者 X 账号 | 综合科技媒体 | 8+ |
| C — 四 tier 加学术 | 官方 2 源 | 顶级科技媒体 3 源 | 综合媒体 3 源 | ArXiv 论文源 | 9+ |

### 决策

**选 A — 简化二 tier（5 源）。** 理由：

1. AI 公司没有"跟队记者爆料"，T1 不需要 X 账号模型
2. T1 三家媒体（TechCrunch/VentureBeat/Wired）已经代表主流科技媒体的三个角度，T2 冗余大
3. 学术源（ArXiv）有价值但有独立 API，后续可以单独接入而非混入白名单页面抓取
4. 先跑通、再扩展。5 源是经过 crawl4ai 实测可达的最小可用集

---

## 决策 4: 信源选型（实测数据驱动）

### 候选信源 crawl4ai 可达性实测（2026-08-04）

| 信源 | URL | crawl4ai | Node直连 | 结论 |
|------|-----|----------|----------|------|
| Anthropic Research | `anthropic.com/research` | ✅ 200 | ✅ 200 | **T0 入** |
| Anthropic News | `anthropic.com/news` | 待测 | ✅ 200 | **T0 入** |
| TechCrunch | `techcrunch.com/tag/anthropic/` | ✅ 200 | ✅ 200 | **T1 入** |
| VentureBeat | `venturebeat.com/tag/anthropic/` | ✅ (308跳转) | ❌ 429 | **T1 入（仅 crawl4ai）** |
| Wired | `wired.com/tag/anthropic/` | ✅ 200 | ✅ 200 | **T1 入** |
| Ars Technica | `arstechnica.com/tag/anthropic/` | ❌ 202 JS墙 | ❌ 202 | **排除** |
| ZDNet | `zdnet.com/topic/anthropic/` | ⚠️ 404 | ❌ 404 | **排除** |
| The Verge AI | `theverge.com/ai-artificial-intelligence` | ✅ 200 | ✅ 200 | **排除（太泛）** |

### 决策

**5 源二 tier：Anthropic News + Anthropic Research (T0) + TechCrunch + VentureBeat + Wired (T1)。**

排除理由：
- Ars Technica: JS challenge wall 双通道均不可达
- ZDNet: URL 404，无有效 Anthropic 专题页
- The Verge: `/ai-artificial-intelligence` 是全 AI 板块，非 Anthropic 专属，信噪比太低（research agent 发现 `/anthropic` 页面存在但本轮不测不接）

---

## 决策 5: 不引入新抓取通道（RSS/ArXiv API/Google News）

### 方案对比

| 通道 | 描述 | 利弊 |
|------|------|------|
| 全部走 crawl4ai | T0+T1 页面抓取，与 MU 完全一致 | ✅ 零架构变更 ✅ 代码改动极小 |
| 混用 RSS | T0/T1 部分源用 RSS feed | ⚠️ RSS 历史上频繁失效（MU 经验），增加维护面 |
| 混用 ArXiv API | 独立接入论文数据库 | ⚠️ 新增通道+新抓取模式，工程量大 |

### 决策

**不引入新通道。** 白名单 crawl4ai 页面抓取对 Anthropic 场景已经足够：

1. `anthropic.com/news` 和 `anthropic.com/research` 页面本身就是文章列表，crawl4ai 可直接提取链接
2. TechCrunch/VentureBeat/Wired 的 tag 页面同理
3. RSS 在 MU 项目中已被证明不可靠（频繁 403/超时），不应重新引入
4. ArXiv 论文可通过 anthropic.com/research 间接覆盖（Anthropic 研究论文都会同步发布到官网）

---

## 决策 6: Google News / HackerNews 兜底

### 决策

**两者均不保留。** Anthropic 白名单 6 源覆盖官方 + 三家主流科技媒体。与 MU 一致：有白名单就不走全网搜索。

---

## 代码改动范围总结

| 文件 | 改动 | 行数 |
|------|------|------|
| `src/crawl4ai-fetch.js` | 新增 5 组 ARTICLE_PATTERNS | ~12 |
| `src/source-tiers.json` | 新增 5 条域名映射 | ~5 |
| Supabase | SQL: 停用 claude-blog + 插入 6 条 keyword_sources + 更新 category_schema | 一次性 |

**不改的文件：** `src/search.js`、`src/index.js`、`src/ai.js`、`src/crosscheck.js`、`src/report.js`、`client/` 全部前端代码。

---

## 验证路径

1. 执行 SQL 变更 → 确认 Supabase 数据正确
2. 修改 `source-tiers.json` + `crawl4ai-fetch.js` ARTICLE_PATTERNS
3. `node --check src/*.js` 语法检查
4. `npm test` 单元测试全过
5. `node src/index.js` 端到端运行，确认 anthropic 关键词产出文章入库
6. 前端 `npm run build` 无回归
