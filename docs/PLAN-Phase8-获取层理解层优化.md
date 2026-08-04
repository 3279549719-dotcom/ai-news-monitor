# PLAN: Phase 8 — 获取层理解层优化 实施计划

> 状态: Draft ｜ 创建: 2026-08-04 ｜ 依据: REQ-Phase8 + DECISION-Phase8
> 范围: P0 数据卫生 + P1 AI 重写 + P2 信源整治（全量）
> 执行方式: 3 个实施 subagent 并行（获取层后端 / 理解层后端 / 前端+验收）+ 主流程集成（DB/回填/回归/文档）

---

## S1. 获取层·抓取过滤（`src/crawl4ai-fetch.js`）

### 1a. `isNonArticleUrl()` 加固（L67-69）
- 入参先 `url.replace(/[?#].*$/, '').replace(/\/+$/, '')` 再测正则（修尾部斜杠破防）。
- 修复 `schedule$|stats$|playoffs$` → 去 `$` 用 `\bschedule\b` 类。
- 补词：`roster|injuries|odds|depth-chart|transactions|tickets|shop\b|scores\b|video\b`。
- 补静态资源：`\.(png|jpe?g|webp|gif|svg|avif)([?#]|$)`。
- 补 CDN 主机：`s\.yimg\.com|cdn\.|images\.|i\.`。

### 1b. 新增 `isSpamTitle(title)`
导航词（schedule/standings/roster/stats/injuries/odds/scores/shop…）或图片文件名（`\.(png|webp|jpe?g)$`）→ true。在 `add()`（L159）与快路径 `matched`（L176-180）调用；过滤后 ≥3 才走快路径，否则回落 DeepSeek 精选。

### 1c. ARTICLE_PATTERNS 修正
- Yahoo（L108）：`/\/nba\//` → `re: /\.html$/`。
- Bleacher Report（L109）：`/\/dallas-mavericks\//` → `re: /\/articles\//`。
- HoopsHype 新增：`{ host: 'hoopshype.com', re: <实测定稿> }`（候选 `/\/20\d\d\/\d{1,2}\//`）。

### 1d. JS 源加 `wait_for`
`crawlPage(url, { waitMs })` 支持可选 `crawler_params: { headless: true, wait_for: waitMs }`。`JS_SOURCES = new Set(['mavsmoneyball.com', 'thesmokingcuban.com'])` 命中时 `waitMs=5000`。

### 1e. 新增 `fetchArticleBody(url)`（正文喂养用）
复用 `crawlPage` 抓单篇 → `md.fit_markdown || md.raw_markdown` → 剥导航/重复行 → 截 1500 字符；失败返回 `null`。**导出契约：`async fetchArticleBody(url) → string|null`**（供 S5 使用）。

---

## S2. 日期链路（新增 `src/dates.js` + 3 处改造 + 回填）

### 2a. 新增 `src/dates.js`
- `extractPublishDateFromUrl(url)`：先剥 `[?#]`；Guardian 英文月 `/20\d{2}/[a-z]{3}/\d{1,2}/`（用 MONTHS 表校验）；数字日期 `/20\d{2}/\d{1,2}/\d{1,2}/`（拒绝未来日期）。返回 `Date|null`。纯函数，新增 `src/dates.test.js`。

### 2b. 三通道日期来源改造
- `crawl4ai-fetch.js:150`、`:193`、`scraper-direct.js:57`：`publishedAt: new Date()` → `extractPublishDateFromUrl(a.url)`。
- `items.js:14`：`publishedAt: publishedAt || new Date()` → `publishedAt: publishedAt || null`。
- `index.js` 入库逻辑不变（null 自然写 NULL）。HackerNews 通道（`search.js:22`）已是真实日期。

### 2c. `scripts/backfill-published-at.js`（一次性）
- 全表 articles：URL 匹配日期模式 → 覆盖 `published_at`；否则置 `NULL`（created_at 已保留发现时间）。
- 顺带清理导航垃圾行：`DELETE FROM articles WHERE score=0 AND title ~ '^(Schedule|Stats|Roster|Injuries|Odds|News|San Antonio Spurs|Chicago Bulls)$'`。

---

## S3. 分类数据修复（Supabase SQL，主流程执行）

- `UPDATE keywords SET category_schema = category_schema || '{"other":"其他"}'::jsonb WHERE id='manchester-united';`
- anthropic 数组转对象：`{"official":"官方公告","product":"产品发布","research":"研究进展","partnership":"合作","policy":"政策","funding":"融资","other":"其他"}`。
- 回填 anthropic 数字分类：`UPDATE articles SET category = CASE category WHEN '0' THEN 'official' ... END WHERE keyword_id='anthropic' AND category ~ '^[0-6]$';`
- `ALTER TABLE articles ADD COLUMN IF NOT EXISTS event_type text;`
- `CREATE INDEX IF NOT EXISTS articles_published_at_idx ON articles (published_at DESC);`

---

## S4. 理解层·`src/ai.js` 重写

### 4a. 新增 `SYSTEM_PROMPT`（替换 L76 system）
摘要 6 铁律：①不编造 ②首句即结论（【事件】谁+做了什么+结果/数字，禁指代词）③要点是增量（删掉不影响标题信息量=复述；至少一条锚定专名/数字；榨不出可验证细节写"标题未给出可验证细节（需点开正文）"）④为什么重要落地（"谁因什么具体变化受影响"）⑤空话禁词表 ⑥字数上限（事件≤40字/要点≤25字×3/为什么≤40字，全文≤180字）。

### 4b. `buildAnalyzePrompt`（L90-137）
- 摘要区块替换为 v2 + 正反例各 2 组（正：Anthropic 攻破 3 公司 / Naji Marshall 续约；反：新增安全措施修复关系 / 编造比分）。
- 正文支持：新入参 `body`，渲染 `正文片段：${body}`。
- JSON 输出加 `event_type` 字段。

### 4c. `buildCategoryHint` v2（L41-60）
- 开头：`if (Array.isArray(categorySchema)) categorySchema = Object.fromEntries(categorySchema.map(k => [k, k]));`。
- 首行改"证据归类不是猜最像"；尾行改"证据不足或体裁不符时选 other；找不到证据不得硬塞"。
- 追加体裁前置通用段：访谈/特写→other；复盘/前瞻→match；纯传闻→rumour；标题含 injury/recovery/return ≠ 伤病，必须描述具体伤情/缺阵/恢复时间表才归 injury。

### 4d. `parseAnalyzeResult` + `analyzeResult`
- 解析 `event_type`；`analyzeResult(query, title, snippet, tier, categorySchema, body)`。

---

## S5. `src/index.js`：正文喂养 + category 校验

### 5a. 正文喂养
- 对 `candidates.slice(0, RESULT_LIMIT)` 并发池 3 抓正文（调 `crawl4ai.fetchArticleBody`），与 item 合并后传给 `analyzeItems` → `analyzeResult(..., body)`。单轮 LLM/篇。body=null 回落标题-only。

### 5b. category 越界清洗
- `processKeyword` 对相关结果：`category` 不在 `keyword.category_schema` 键内 → 置 `null`（前端"其他"兜底）。

---

## S6. `scripts/check-quality.js` 验收 v2

- **A2** 禁词扩展：`这一举措|此举|该球员|该消息|该操作|相关人士|相关机构|某球员|某公司|上述操作|展现了|体现了|反映了|旨在|至关重要|意义重大`；白名单放行诚实回退语。
- **A4 → A4a**：FACT_ANCHOR 扩宽（数字/日期/百分数/序数/中文英文专名）+ 标题回显检测（summary 含标题里的人名/队名且非停用词）。阈值 ≥70%。
- **新增 A4b** 信息增量：summary 与标题公共字符占比（去停用词）<60% 且长度 ≥ 标题×1.15。
- **新增 A4c** 无空话：EMPTY_HARD 命中或要点以"这/该/其/此"开头 → 不过。
- **C3 GBK 修复**：正则只匹配 `/\[PreFilter\] (\d+)/`。
- `src/ai.test.js` 加黄金样本（Yoro 不归 injury / "ruled out six weeks" 归 injury / "agree £50m fee" 归 transfer / 访谈归 other）——只断言 prompt 文本含规则，不调 API。

---

## S7. 前端（`client/src/`）

### 7a. `types.ts`
`Article.event_type?: string|null`；`FilterState.sortBy` 扩为 `'created_at'|'score'|'published_at'`；`FilterState.includeOld: boolean`。

### 7b. `lib/constants.ts`
`DEFAULT_FILTERS` → `{ ..., sortBy: 'published_at', includeOld: false }`；新增 `PAYWALL_SOURCES: Record<string,string> = { 'dallas-morning-news': '正文需订阅' }`。

### 7c. `hooks/useArticles.ts`（含 `useBoardArticles`）
- 默认（`!includeOld`）加窗口：`query.or('published_at.gte.{cutoff},published_at.is.null,source_tier.eq.0')`（cutoff=30 天前）。
- `sortBy==='published_at'` → `.order('published_at', { ascending:false, nullsFirst:false }).order('created_at', { ascending:false })`。

### 7d. `components/FilterSortBar.tsx`
SORTS 加 `{ value:'published_at', label:'最新发布' }`（默认）；加"显示旧闻"开关；重置恢复默认。

### 7e. `components/ArticleCard.tsx` + `components/BoardView.tsx`（内联卡）
- 日期：≤30 天 → `relativeTime`；>30 天 → `formatDateTime`；null → `发现于 {relativeTime(created_at)}`。
- 付费墙徽章：`PAYWALL_SOURCES[article.source]` → 橙色角标。
- 体裁徽章：`event_type` 有值 → 小灰字徽章。

### 7f. `components/BoardView.tsx` 兜底
- "其他"板：`unmatched = articles.filter(a => a.category && !boards.some(b => b.key===a.category) && a.category !== 'other')` → 非空渲染"📄 其他"区（修 MU rumour/conflict/academy_women 静默丢弃）。

---

## S8. 信源整治（Supabase，主流程执行）

- **DMN 保留**（前端标注）。
- **HoopsHype**：`INSERT INTO keyword_sources (keyword_id, source_name, scrape_url, tier, fetch_type, enabled, rss_url) VALUES ('dallas-mavericks','HoopsHype','https://hoopshype.com/tag/dallas-mavericks/',2,'firecrawl',true,'https://hoopshype.com/tag/dallas-mavericks/')`（注意 `rss_url` NOT NULL + `(keyword_id,rss_url)` 唯一约束）。
- Smoking Cuban 保留 URL 加 `wait_for`；实施时若首页仍 0 产出，实测 FanSided tag 子页替换。
- ClutchPoints / r/Mavericks：实测可达才加，否则记待测。
- `src/source-tiers.json` 加 `"hoopshype.com": 2`。

---

## S9. 测试与文档（主流程收尾）

- `node --check src/*.js` + `npm test`；前端 `type-check`/`lint`/`build`。
- 文档：CLAUDE.md（假日期/付费墙标注/wait_for/event_type 陷阱）；PROGRESS.md（Phase8 条目）；PRD.md（published_at 语义、event_type 列、索引）；REQ-Dallas（HoopsHype、DMN 付费墙、8→9 源）。

---

## 验证（端到端）

1. **静态**：`node --check src/*.js`；`npm test`；前端 type-check/lint/build 全绿。
2. **回填**：`node scripts/backfill-published-at.js` → SQL 抽查 `SELECT title, published_at FROM articles WHERE keyword_id IN (...) ORDER BY published_at DESC NULLS LAST LIMIT 20`：6 月旧文日期真实、Yahoo 垃圾行已删、anthropic 数字分类已映射。
3. **跑管线**（`docker start crawl4ai`）：`node src/index.js` → 无 Yahoo 垃圾、BR/Moneyball/Cuban 有产出、摘要含具体人名/数字、分类无 off-schema、event_type 有值。
4. **验收**：`node scripts/check-quality.js` → A4a ≥70%、A2/A3/C1 通过。
5. **前端**：`cd client && npm run dev` → Dallas Tab：BoardView 正常、DMN 有"正文需订阅"角标、旧闻绝对日期、rumour/conflict 不丢板、"全部文章"默认无 30 天前旧闻（切"显示旧闻"可见）。
