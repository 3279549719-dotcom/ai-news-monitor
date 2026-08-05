# 重构计划 — ai-news-monitor

> 生成时间：2026-08-05 12:00 | 来源：Claude Code CLI 分析
> 进度：**第一批已完成** P0① + P1③⑥⑦（2026-08-05）；其余见下方状态标记

## 总体判断

项目分层已不错，问题集中在四类：
1. **编排层过重** — index.js processKeyword 116行串9个阶段
2. **数据硬编码** — 信源模式表/关键词词根/板块定义散落在代码里
3. **前端组件逻辑重复** — 两套ArticleCard、recency窗口逻辑复制
4. **接口形状不一致** — 同一条item三种来源三种形状

## P0 — 正确性风险（先做）

### ① crawl4ai ARTICLE_PATTERNS 模式缺陷
- 问题：si.com 出现两次（soccer/nba），`.find` 命中第一条导致 Dallas 的 nba 模式永远走不到
- 方案：模式表外置 JSON + 按 host 分组多模式 + 修复匹配
- 文件：`src/crawl4ai-fetch.js` → 新建 `src/article-patterns.json`
- ✅ **已完成（2026-08-05，commit `4190daf`）**：`src/article-patterns.json` 按 host 分组多模式数组，匹配改逐一 `test()`（si.com soccer/nba 各自匹配，Dallas nba 模式不再被遮蔽）；新信源/改模式只编辑 JSON

### ② BoardView 空 category 静默丢弃
- 问题：未匹配任何板块的文章被静默丢弃
- 方案：确认需求后处理（归「其他」或隐藏）

## P1 — 高价值结构重构

### ③ index.js processKeyword 拆分
- 拆为：fetchCandidates → analyzeAndCrosscheck → dedupeAgainstRecent → assembleRecords → persist
- buildRecord 提到模块级纯函数
- 跨运行去重抽到 crosscheck.js
- getKeywordRoots 下沉到数据文件
- blog 分支标注 LEGACY 归档
- ✅ **已完成（2026-08-05，commit `da8d349`）**：`processKeyword` 拆为 5 个模块级阶段函数（`fetchCandidates` → `analyzeAndCrosscheck` → `dedupeAgainstRecent` → `assembleRecords` → `persist`）；`buildRecord` 提为模块级纯函数 `toArticleRecord(item, keyword, overrides)`；`getKeywordRoots` 下沉 `src/keyword-roots.js` 词根数据文件（`KEYWORD_ROOTS` 表，词根外置直接编辑该文件）；blog 分支标注 LEGACY；`crosscheck.js` 新增导出 `dedupeAgainstExisting(items, existing)`。重构不改行为，42 tests pass

### ④ BoardView.tsx 拆分
- 抽共享 ArticleCard / CardMetaRow / BoardSection / OverviewBar
- byCategory 改一次 Map 分组

### ⑤ 板块数据驱动
- 前端从 keyword.category_schema 动态渲染
- 删除 MU_BOARDS/DAL_BOARDS/GENERIC_BOARDS 硬编码
- types.ts 补 category_schema 字段
- KeywordsTab showBoard 改为 schema 存在性判断

### ⑥ ai.js options 对象 + 提示词外置
- analyzeResult/buildAnalyzePrompt 6位置参数 → options 对象
- 提示词提取到 src/prompts/
- ✅ **已完成（2026-08-05，commit `d696282`）**：`analyzeResult(options)`/`buildAnalyzePrompt(options)` 解构入参；`src/prompts/analyze-prompt.js`（SYSTEM_PROMPT）+ `src/prompts/select-links-prompt.js`（buildSelectLinksPrompt），ai.js 不再内联提示词

### ⑦ search.js item 形状统一 + URL 规范化
- HN 分支改走 toItem
- URL 规范化抽到 src/url.js 或 items.js
- ✅ **已完成（2026-08-05，commit `fae4395`）**：HN 分支经 `toItem()` 规整为统一 item 形状；`normalizeUrlKey(url)` 落在 `src/items.js`（剥协议/www/查询串/尾斜杠），`deduplicateByUrl` 复用

### ⑧ useArticles.ts recency/基础查询抽公共助手
- 抽 baseArticleQuery() + applyRecencyWindow(query, includeOld)

### ⑨ sources.ts 信源过滤数据驱动
- 从 keyword_sources 表动态生成过滤项

## P2 — 低风险清理

### ⑩ crosscheck.js 聚类原语合并
- 抽 groupBySimilarity 公共原语
- 停用词表/阈值外置
- 导出 dedupeAgainstExisting
- 🔶 子项「导出 dedupeAgainstExisting」已完成（2026-08-05，随 `da8d349` P1③ 一并落地）；`groupBySimilarity` 公共原语 + 停用词表/阈值外置待后续批次

### ⑪ store.js MIN_SCORE 引 config
- 从 config 导入而非硬编码

### ⑫ FilterSortBar 抽 SegmentedControl
- 三组同构按钮复用

### ⑬ 死代码归档
- blog pipeline (scraper/reader/summarizeArticle/PIPELINES.blog) 标注或归档

## 执行约束

- 每步一个 commit，重构不改行为
- 改完跑 `npm test`(42用例) + `cd client && npm run type-check && npm run lint && npm run build`
- 依赖顺序：纯函数/数据层 → 编排层 → 前端
- 数据外置是最高杠杆（照 source-tiers.json 模式）
