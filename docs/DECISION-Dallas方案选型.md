# DECISION: Dallas Mavericks 信源监控方案选型纪要

> 决策日期: 2026-08-04 ｜ 参与: Patrick + Alice
> 参考: docs/DECISION-方案选型纪要.md（MU 方案选型）、docs/DECISION-Anthropic方案选型.md（Anthropic 方案选型）
> 背景: Dallas Mavericks 关键词当前 0 白名单信源，仅 HackerNews 兜底；前端仅 ArticleFeed 列表

---

## 决策背景

Patrick 确认 Anthropic 白名单落地后，立即推进 Dallas Mavericks 信源监控。Patrick 提供了一份详细的 REQ 文档（含 5 级 Tier 体系 + 记者 X 账号 + 主流体育媒体 URL），要求结合 crawl4ai 实测数据筛选可用信源，并复制 MU 板块视图组件到前端。

---

## 决策 1: 信源 Tier 模型（NBA 场景适配）

### Patrick 的 REQ 框架

| Tier | 定义 | 示例 |
|------|------|------|
| T0 | 官方 | mavs.com、NBA Official、@dallasmavs |
| T1 | 顶级跟队记者 | Shams、Stein、MacMahon、Townsend、Caplan |
| T2 | 主流体育媒体 | ESPN、The Athletic、Dallas Morning News、NBA Stats |
| T3/T4 | 次级/噪声源 | 不入白名单 |

### crawl4ai 实测修正

| Patrick REQ | 实测结果 | 决策 |
|------------|---------|------|
| T0 mavs.com | 301 → nba.com/mavs/news | **改用跳转目的地** |
| T0 @dallasmavs | crawl4ai 可访问但仅 1 链接，内容来自 nba.com | **砍掉，T0 网页源已覆盖** |
| T1 Shams Charania | crawl4ai 可访问但 1 链接 | **砍掉，联盟级记者 Mavs 占比<5%，过滤成本高** |
| T1 MacMahon/Townsend/Caplan | 内容已在 dallasnews.com 覆盖（他们就是 DMN 记者） | **砍掉，与 T2 网页源冗余** |
| T1 Marc Stein | Substack 链接有独立内容 | **保留，Ornstein 级权威** |
| T2 ESPN | 202 bot detection，空 markdown | **砍掉** |
| T2 The Athletic | 硬 paywall + 超时 | **砍掉** |
| T2 Dallas Morning News | ✅ 57KB，84 链接 | **保留** |
| T2 Yahoo Sports | ✅ crawl4ai（Node 403） | **保留** |
| T2 Bleacher Report | ✅ crawl4ai（Node 403） | **保留（链接发现）** |
| T3 SI | JS SPA，markdown 为空 | **砍掉** |
| T3 CBS Sports | 406 anti-bot | **砍掉** |

### 决策

**5 源三 tier：1×T0 NBA Mavs News + 1×T1 Marc Stein(X) + 3×T2 Dallas Morning News + Yahoo Sports + Bleacher Report。**

精简原则：

1. **X 账号精选**：NBA 与足球不同——记者 X 内容与网页源高度重叠（Townsend/Caplan 就是 dallasnews.com 的记者），唯一有独立内容的是 Stein（Substack 文章）。Shams 是联盟级爆料，Mavs 相关内容占比 <5%，对 AI 评分过滤不友好。
2. **ESPN/The Athletic/SI 砍掉**：非战术性排除——crawl4ai 实测全部失败（bot detection / paywall / JS SPA）。
3. **与 MU 模式一致**：MU 有 2 个 T1 X 记者；Dallas 1 个（Stein），比例合理。

---

## 决策 2: 前端展示方案

### 背景

Dallas 当前前端走通用 ArticleFeed（列表），MU 走 BoardView（板块视图 2×3 网格）。

### 方案对比

| 方案 | 描述 | 利弊 |
|------|------|------|
| A — 保持 ArticleFeed | 不改前端 | ❌ Dallas 无板块展示，与 MU 体验不统一 |
| B — 复制 MU BoardView | 新增 DAL_BOARDS + 扩展 showBoard 条件 | ✅ 组件复用度极高 ✅ 板块展示一致 |

### 决策

**选 B。** 理由：

1. Patrick 明确要求"前端可以复制曼联的组件"
2. BoardView 架构已经支持多关键词板块（已有 MU_BOARDS + GENERIC_BOARDS），加一组 DAL_BOARDS 仅需 ~15 行代码
3. Dallas 的 8 类 category_schema 与 MU 结构同构，BoardView 读取 `article.category` 字段按 key 分组

### DAL_BOARDS 板块定义

```
┌──────────┬──────────┬──────────┐
│ 🔵 官方公告 │ 🔄 交易签约 │ 🏥 伤病报告 │
├──────────┼──────────┼──────────┤
│ 🏛️ 管理层  │ 🏀 赛事战报 │ 📊 今日概览 │
└──────────┴──────────┴──────────┘
```

对比 MU：
```
┌──────────┬──────────┬──────────┐
│ 🔴 官方公告 │ 🟡 转会合同 │ 🏥 伤病停赛 │
├──────────┼──────────┼──────────┤
│ 🏛️ 管理层  │ ⚽ 赛事竞技 │ 📊 今日概览 │
└──────────┴──────────┴──────────┘
```

**差异点：** Dallas 减少了 MU 的 8 类到 5 类（去掉了"青训女足""冲突辟谣""未证实传闻"——NBA 场景下语义不适用）。5 类加今日概览正好填满 2×3 网格。

---

## 决策 3: category_schema 设计

### 设计

8 类（与 MU 同构但名词适配 NBA 场景）：

| key | 中文标签 | 说明 |
|-----|---------|------|
| official | 官方公告 | T0 NBA.com 官方新闻（红框置顶） |
| trade | 交易签约 | 转会/签约/选秀/自由市场 |
| injury | 伤病报告 | 球员伤病/复出/轮休 |
| management | 管理层·教练组 | GM/教练/老板决策 |
| match | 赛事战报 | 比赛结果/数据/赛后采访 |
| rumour | 未证实传闻 | 单源低置信传闻 |
| analysis | 深度分析 | 战术分析/数据研究 |
| other | 其他 | 场外/社区/商业 |

前端 BoardView 展示 5 个主板块 + 今日概览卡（剩余 3 类内容归入 other 或在 ArticleCard 中展示）。

---

## 决策 4: X 账号策略

### 现状

crawl4ai 对 X 的处理：`links.external` → 过滤 t.co 短链 → 帖子标题作标题。MU 已验证可行（Stone 4 条/轮，Ornstein 6 条/轮）。

### NBA X 账号实测

| 账号 | external 链接 | t.co 内容 | 决策 |
|------|-------------|---------|------|
| Marc Stein | 4 | Substack 文章链接 | ✅ T1 |
| Tim MacMahon | 1 | 1 条 | ❌ 与 DMN 冗余 |
| @dallasmavs | 1 | 0 | ❌ 与 nba.com 冗余 |
| Shams | 1 | 0 | ❌ 联盟级 |
| Townsend/Caplan | 1-3 | 0-1 | ❌ 与 DMN 冗余 |

### 决策

**仅纳入 Marc Stein。** NBA X 产出远低于足球——多数记者帖子链接已在网页源（dallasnews.com）覆盖。Stein 的 Substack 有独立长文内容，是唯一值得独立抓取的 X 信源。

---

## 代码改动范围总结

| 文件 | 改动 | 行数 |
|------|------|------|
| `src/crawl4ai-fetch.js` | ARTICLE_PATTERNS 新增 4 组 | ~8 |
| `src/source-tiers.json` | 新增 4 条域名映射 | ~4 |
| Supabase | 插入 5 条 keyword_sources + 更新 category_schema | SQL |
| `client/src/components/BoardView.tsx` | 新增 DAL_BOARDS | ~10 |
| `client/src/lib/constants.ts` | 新增 DAL_KEYWORD_ID | 1 |
| `client/src/components/KeywordsTab.tsx` | showBoard 条件扩展 | ~3 |

**不改的文件：** `src/search.js`、`src/index.js`、`src/ai.js`、`src/crosscheck.js`、`src/report.js`、其他前端组件。

---

## 验证路径

1. SQL 变更 → Supabase 数据正确
2. `source-tiers.json` + `crawl4ai-fetch.js` ARTICLE_PATTERNS 修改
3. `node --check src/*.js` 语法通过
4. `npm test` 22 例全过
5. `node src/index.js` 端到端：dallas-mavericks 产出文章入库
6. 前端 `npm run build` 无回归
7. 前端截图：Dallas Tab → BoardView 板块视图
