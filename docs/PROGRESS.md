# ai-news-monitor 项目进度

> 最后更新：2026-08-05（Phase 9 最终交付 + 重构第一批 P0①/P1③⑥⑦ 完成 — 已 push origin/master，本地与远端完全同步）

## 功能进度

| ID | 功能 | 状态 | 验证 |
|---|---|---|---|
| F-001 | MVP：claude.com/blog 监控 + AI 摘要 | 已完成 | 2026-08-01 实机验证 |
| F-002 | Phase 2：多关键词 + HackerNews 搜索 | 已完成 | 2026-08-01 实机验证 |
| F-003 | Phase 3：Supabase 持久化 + cron 定时 + 代码重构 | 已完成 | 2026-08-02 实机验证 |
| F-004 | Phase 4：前端 UI（React18 + TypeScript + Vite + Tailwind） | 已完成 | 2026-08-02 localhost 验证 |
| F-005 | Phase 5：白名单定向抓取（方案A）— 移除 Google News RSS + Firecrawl，改用 scraper-direct.js | **已完成** | 2026-08-03 端到端验证通过（MU 3篇入库） |
| F-009 | Anthropic 白名单信源扩展（方案A续）— 6 源二 tier，claude-blog 合并下线 | **已完成** | 2026-08-04 端到端验证通过（154条抓取，8篇入库） |
| F-010 | Dallas Mavericks 白名单信源 + 前端 BoardView — 8 源三 tier，导航垃圾过滤修复 | **已完成** | 2026-08-04 端到端 264条抓取→9篇入库（0垃圾） |
| F-011 | Phase 7：AI 分析管线体验优化 — 三段式摘要 + 分类判别标准 + preFilter + 自动化验收 | **已完成** | 2026-08-04 端到端 11篇入库，无占位语，三段式 100%，22/22 test |
| F-012 | Phase 8：信息获取与理解层优化 — 假日期修复 + AI 正文喂养 + 分类/体裁落地 + 付费墙标注 + 前端时效窗口 | **已完成** | 2026-08-04 端到端 4篇入库，A4a 事实锚点 100%，npm test 35/35，前端三件套全绿 |
| F-013 | Phase 9：历史数据回填去重 + 前端空态 — 全量回填重算 + 同事件三层去重 + BoardView 空态重构 + Playwright 截图 | **已完成（最终交付）** | 2026-08-05 验收全绿：Carrick 摘要修正(score 90)、Naji 4→1、npm test 42/42、前端三件套全绿、管线回归通过、**已 push origin/master**（见 F-013 交付内容） |

## F-003 交付内容（2026-08-02）

**新增：**
- Supabase `keywords` + `articles` 表，RLS 已启用
- `src/db.js`：Supabase client 单例 + `withRetry` 重试工具
- `src/store.js`：`loadKeywords`、`filterNewItems`（RPC）、`saveArticles`
- RPC 函数 `get_new_urls`：规避 Google News 长URL 导致的 PostgREST Bad Request
- `CRON_SCHEDULE` 环境变量：可选定时调度

**重构：**
- Pipeline 策略模式（`PIPELINES` 对象替代两个重复函数）
- `analyzeItems` 用 `reduce` 替代 filter+map 双循环
- 单次 `saveArticles` 调用（合并相关/不相关记录）
- 关键词顺序处理（避免并发压垮 Supabase 连接池）
- `keywords.json` 已弃用，关键词改为从 Supabase 管理

**已解决的 Bug：**

| ID | 描述 | 修复方式 |
|---|---|---|
| B-001 | Bing scraper 被 JS 反爬 | 换 Google News RSS |
| B-002 | filterNewItems 对大 URL 数组触发 PostgREST Bad Request | 改用 RPC + `ANY()` |
| B-003 | 并发关键词处理导致 Supabase 连接 fetch failed | 改为顺序处理 |
| B-004 | get_new_urls 函数 search_path 可变（安全 WARN）| 添加 `SET search_path = ''` |

## 安全备注

- `allow_all_keywords` / `allow_all_articles` RLS 策略当前为宽松模式（个人项目）
- 上线前需改为基于 `auth.uid()` 的细粒度策略

## F-004 交付内容（2026-08-02）

**技术栈：** React 18 + TypeScript + Vite + Tailwind CSS，直连 Supabase

**功能：**
- 3 个 Tab：全部文章 / 按关键词 / 搜索
- FilterSortBar：按关键词、来源筛选，支持排序
- 分页（PageSize=20）
- ArticleCard：标题、来源、评分、摘要、发布时间
- LoadingSkeleton / EmptyState 占位态
- 响应式布局，bg-blue-700 header sticky

**组件结构：**
- `src/hooks/useArticles.ts` / `useKeywords.ts` — 数据层
- `src/components/` — ArticleFeed、ArticleCard、FilterSortBar、Pagination、LoadingSkeleton、EmptyState

## Spec 功能进度

| Spec ID | 功能 | 状态 | 备注 |
|---------|------|------|------|
| spec-001 | 信息源可信度分级 + Tier 基础设施 | **基础已落地** | `keyword_sources` 表、`articles.source_tier` 列、`tiers.js`、前端 Tier 筛选均可用。`rss.js` 模块已删除（RSS 信源不可达） |
| spec-002 | Firecrawl 直抓 + Tier 展示 | **已改用 scraper-direct** | Firecrawl API 余额耗尽（HTTP 402），改用 `scraper-direct.js`（axios + DeepSeek 识别链接）。前端 Tier 展示正常 |

## F-005 方案A交付内容（2026-08-03）

**架构变更：**
- **移除** Google News RSS 全网搜索（`search.js` 精简）
- **移除** `src/rss.js` 模块（RSS 信源不可达）
- **停用** `src/firecrawl.js`（Firecrawl API 402 余额不足）
- **新增** `src/scraper-direct.js`：axios 拉 HTML → 正则提取链接 → DeepSeek 识别文章。4 个国内可达 MU 信源已配置
- **移除** `rss-parser` 依赖

**Supabase 变更：**
- MU 信源更新为 4 个国内可达源：Man Utd Official (T0)、Sky Sports (T2)、ESPN (T2)、90min (T2)
- MU 关键词 query 改为 `"Manchester United"`（宽泛）

**已验证：**
- 端到端运行 `node src/index.js` 通过，MU 产出 3 篇入库
- 语法检查 `node --check src/*.js` 全部通过
- `reports/2026-08-03.md` 已生成

**已知兼容性问题：**
- Sky Sports / 90min：AI 链接识别偶尔返回空 JSON（页面结构非标准），不影响整体管线
- claude.com/blog：偶发超时（Anthropic 服务端）

## F-006/F-007 方案BC交付内容（2026-08-03）

**交叉验证（方案B）：**
- `src/crosscheck.js`：事件聚类（中文 bigram 相似度，阈值 0.4）+ 置信度（≥2 源=high / 单源=medium / 与 T0 冲突=low+flag）
- `src/ai.js` analyzeResult 输出扩展为 `{score, summary, event, category}`
- `src/index.js` 管线接入：analyzeItems → crosscheck → saveArticles（新字段入库），processKeyword 返回 crosschecked
- `index.js` 增加 `require.main === module` 守卫并导出 buildReport（可单测）

**板块视图（方案C）：**
- `client/src/components/BoardView.tsx`：2 行 3 列网格（官方红框/转会/伤病/管理层/赛事/今日概览），卡片带置信度徽章 + 印证数 + 分类标签
- KeywordsTab 选中 MU → BoardView，其他关键词 → ArticleFeed（回归通过）
- 日报 `buildReport` 按 category_schema 板块分组 + 置信度/印证数/冲突标记

**crawl4ai 一次性验证（替代 Firecrawl）：**
- `scripts/run-crawl4ai-demo.js`：读 `scripts/_crawl4ai-items.json` → filterNewItems → analyzeResult → crosscheck → saveArticles
- 抓取三 tier 真实数据：T0 manutd.com / T1 Simon Stone·Ornstein(X) / T2 Sky·Guardian·90min
- 结果：25 条 → 21 新 → 13 相关 → Tielemans 3 源聚类 high、单源 medium；Ornstein 非 MU 帖被相关性过滤拒绝
- 前端板块视图实机验证：DOM dump 确认六板块 + 置信度/印证数渲染真实数据，截图 `docs/board-view-real.png`

## F-008 crawl4ai 接入生产管线（2026-08-03）

**新增 `src/crawl4ai-fetch.js`（主抓取通道）：**
- REST 调本地容器 `localhost:11235/crawl`，token 从 `.crawl4ai-token`/env 读，健康检查缓存 30s
- 站点文章 URL 模式筛选（manutd `/en/news/`、Guardian `/football/20xx/`、Sky `/football/news/<id>/` 等），匹配 ≥3 直接用标题，避免 DeepSeek 被导航淹没
- X 账号页：`links.external` 的 t.co 链即文章（帖子标题作标题），无需 AI
- 候选不足时回退 DeepSeek 精选

**`src/search.js` 接入：** 逐源 crawl4ai 优先 → 失败/空结果降级 scraper-direct；X 源不降级（axios 抓 X 无意义）

**信源增补（白名单现 7 源三 tier）：** T0 manutd｜T1 Simon Stone(X)、David Ornstein(X)｜T2 Sky、ESPN、90min、Guardian（新增）

**回归：** `node src/index.js` 全通过——MU 抓 123 条（T0:10/T1:10/T2:103），ESPN crawl4ai 空自动降级 Direct 8 篇，6 篇相关入库，日报按板块分组输出

**已知限制：** Guardian 文章标题由 URL slug 生成（非原标题）；90min 每轮产出偏多（58 条），靠相关度过滤收敛；X 账号每日抓取受反爬影响可能偶发 0 结果（跳过不阻断）

## F-012 Phase8 交付内容（2026-08-04）

**获取层·数据卫生（P0）：**
- 新增 `src/dates.js`（URL 提取真实发布日期，拒绝未来/非法日期）+ `src/dates.test.js`（7 例）
- 三抓取通道 `publishedAt: new Date()` → `extractPublishDateFromUrl(url)`（crawl4ai-fetch 两处 / scraper-direct / items 兜底置 null）
- `scripts/backfill-published-at.js`：历史 583 行回填（58 行取到真实日期，525 置 NULL 保留 created_at），导航垃圾 18 行按 PLAN 清理
- `isNonArticleUrl` 加固（剥尾部斜杠 + `\b` 边界 + roster/injuries/odds/静态资源/CDN）+ 新增 `isSpamTitle`（add 与快路径双调用）
- ARTICLE_PATTERNS：Yahoo `\.html$`、BR `/articles/`、新增 HoopsHype
- JS 源 wait_for（Mavs Moneyball / Smoking Cuban 5s，crawl4ai-fetch 接线）

**理解层·AI 重写（P1）：**
- SYSTEM_PROMPT 摘要 6 铁律 + buildAnalyzePrompt v2（正反例 2+2 + `event_type` 字段 + 正文片段）
- `fetchArticleBody(url)` 正文喂养（index.js 并发池 3，search 类型，失败回落标题-only）— A4a 事实锚点 9% → 100%
- buildCategoryHint v2：`Array.isArray` 分支（修 anthropic 数字键）+ 证据门控 + 体裁前置规则（访谈→other 等）
- category 越界清洗（schema 键外置 null）+ `event_type` 入库（提取→analyzeItems→toSave 全链路）
- `check-quality.js` v2：A4 拆 A4a/A4b/A4c，A2 禁词扩展 + 诚实回退白名单，C3 GBK 修复

**信源整治（P2）：** Dallas 8→9 源（新增 HoopsHype T2）；DMN 保留 + 前端"正文需订阅"角标；ClutchPoints/r-Mavericks 记待测

**前端（S7）：** recency 30 天窗口（`published_at.gte.{cutoff},is.null,source_tier.eq.0`）、按 `published_at` 排序（null 靠后）、"显示旧闻"开关、日期三态展示（≤30d relativeTime / >30d 绝对日期 / null 发现于 created_at）、付费墙 + 体裁徽章、"其他"板兜底（修 MU rumour/conflict 静默丢弃）

**验收：** `node --check` ✅ ｜ `npm test` 35/35 ✅ ｜ 前端 type-check/lint/build ✅ ｜ 端到端 4 篇入库（Dallas 3 + Anthropic 1）✅ ｜ check-quality v2 **9 PASS**（A4a 100% / A2 / A3 / A4c / C1 / D1）· E4 假失败（MU 在上一轮管线已入库，DB 确认 score 90 rumour 存在）

## F-013 Phase9 交付内容（2026-08-05）

> 触发：Phase8 交付后用户复核发现 3 类遗留问题（旧摘要错误 / 同事件重复 / 前端大片空白）。文档：`docs/REQ-Phase9-历史数据回填去重与前端空态.md` + `docs/DECISION-Phase9-历史数据回填去重与前端空态.md`。

**历史数据回填重算（Part A）：**
- `scripts/backfill-resummarize.js`（新增，v2 重写）：pool 1-2 串行 + 正文重试 + **score 下限保护**（正文缺失时 `body ? model : max(current, model)`，不恶化已入库可见性）；`--lt60` 模式排除 google-news 死链源
- v1 教训：crawl4ai pool3 **持续并发过载** → 正文缺失 66%（202/305）→ v2 严格判分把 score 压垮（305→95 可见，Carrick 被误判 0）。已落 CLAUDE.md 已知陷阱
- **结果**：v2 修复模式 324 篇 0 失败，正文缺失 41（12.7%），**恢复可见 48 条**；240 篇 google-news 死链行清零（score=0 前端隐藏）
- Carrick 文章（用户投诉①）修复：根因 `fetchArticleBody` 把 Guardian 顶部导航喂给 AI，patch 导航段剔除启发式后 **score 90**，摘要把 Carrick 正确识别为主教练（列五名中卫名单），不再说"踢中卫/防守型中场"

**同事件去重（Part B，三层）：**
- `src/crosscheck.js` 新增 `dedupeBySimilarity`（**双信号 v3**）+ `collapseSameEvent`（**seed-only 聚类**，禁链式传递）+ `distinctiveNouns`/`actionSignals` 辅助；`src/store.js` 新增 `loadRecentRelevant`；`src/index.js` 接线同批合并 + 跨运行防重
- v3 双规则：**规则A**（evSim≥0.60 且 tSim≥0.45 且动作兼容）｜**规则B**（共享特有专名 + 同动作组 + evSim≥0.15）。实测校准：v1 单信号把 Anthropic 37→33 误删（共享 "Anthropic/Claude" 实体膨胀），v3 误删砍到 4，Naji 4→1
- `scripts/dedup-existing.js`（新增）：`--dry-run` 默认预览"保留+待删"清单 → `--apply` 执行
- **执行事故披露**：用户确认删 9 条明确重复、保留 Cisse + Project Fetch，但 `--keep-ids` 传参误用 `=` 号（`flag()` 只认空格分隔），11 行全被删。**Cisse 已恢复**（score 85）；**Project Fetch 经用户确认弃留**（不恢复）。最终删除：9 条明确重复 + Project Fetch 1 条

**前端空态重构（Part C）+ 截图能力（Part D）：**
- `BoardView.tsx`：空板块不渲染（结构性消灭空白）+ 行动导向空态 + Tier 左色条签名（T0 红/T1 琥珀/T2 灰）+ 板块数量徽章 + 今日概览移全宽底带
- `KeywordsTab.tsx` "显示旧闻"开关、`EmptyState.tsx` 行动引导、`index.css` 衬线字面层次
- `package.json` 加 `playwright-core` devDep + `scripts/screenshot-ui.js`（headless chromium 截图，`PLAYWRIGHT_BROWSERS_PATH` 兜底）
- **截图脚本已跑通**：最终产出 `screenshots/ui-board-dallas-final.png` / `screenshots/ui-board-mu-final.png`（首版 `ui-board-dallas.png` / `ui-board-mu.png` 亦留存）

**验收：**
- 后端 `node --check src/*.js scripts/*.js` ✅ ｜ `npm test` **42/42** ✅（新增 7 个去重用例：Naji 判重 / 受伤不判重 / 交易门 / 空 event / seed-only 聚类）
- 前端 `cd client && npm run type-check && npm run lint && npm run build` ✅
- 数据：Carrick 摘要修正（score 90，主帅认知正确）✅ ｜ Naji 续约 score≥60 4→1 ✅ ｜ 可见相关文章 **82 篇**（MU 29 / Anthropic 33 / Dallas 10 / blog 10）✅ ｜ Cisse 恢复 ✅
- 管线回归 `node src/index.js` 端到端通过，无重复事件新增 ✅
- **最终交付**：已 commit 并 push `origin/master`（caa4808 + 本次文档收尾提交）✅

## 重构第一批（2026-08-05，对应 `docs/PLAN-重构计划.md` P0① + P1③⑥⑦）

> 数据外置/接口形状统一的首批落地，**重构不改行为**。四个代码 commit + 1 个文档 commit：`4190daf`（crawl4ai 模式表外置）→ `d696282`（ai options + 提示词外置）→ `fae4395`（search URL 规范化 + HN 走 toItem）→ `da8d349`（index.js 阶段函数拆分 + buildRecord 模块级化）→ `4e6306c`（文档同步）。剩余计划项见 `docs/PLAN-重构计划.md`。

| 计划项 | 内容 | 状态 |
|---|---|---|
| P0① | crawl4ai ARTICLE_PATTERNS 外置 `src/article-patterns.json`，按 host 分组**多模式数组**、逐一 `test()`；**修 si.com 双条目**（soccer/nba 各自匹配，Dallas nba 模式不再被 `.find` 取第一条遮蔽） | ✅ 已完成（`4190daf`） |
| P1⑥ | ai.js `analyzeResult`/`buildAnalyzePrompt` 6 位置参数 → **options 对象**；提示词外置 `src/prompts/analyze-prompt.js`（SYSTEM_PROMPT 摘要6铁律）+ `src/prompts/select-links-prompt.js`（buildSelectLinksPrompt） | ✅ 已完成（`d696282`） |
| P1⑦ | search.js HN 分支改走 `toItem` 统一 item 形状（去重/去重键与白名单通道一致）；URL 规范化抽 `normalizeUrlKey`（`src/items.js`），`deduplicateByUrl` 复用 | ✅ 已完成（`fae4395`） |
| P1③ | index.js `processKeyword` 拆为 5 个模块级阶段函数（`fetchCandidates`→`analyzeAndCrosscheck`→`dedupeAgainstRecent`→`assembleRecords`→`persist`）；`buildRecord` 提为模块级纯函数 `toArticleRecord`；`getKeywordRoots` 下沉 `src/keyword-roots.js` 词根数据文件；blog 分支标 LEGACY；`crosscheck.js` 新增导出 `dedupeAgainstExisting`（P2⑩ 子项顺带落地） | ✅ 已完成（`da8d349`） |

**后续维护要点：**
- 新信源加 URL 模式 / 改匹配规则：**编辑 `src/article-patterns.json`**，无需改代码（照 source-tiers.json 数据外置模式）
- 改 AI 摘要规则或链接筛选提示词：只动 `src/prompts/`，勿在 ai.js 内联维护
- URL 去重键统一走 `normalizeUrlKey`（剥协议/www/查询串/尾斜杠），新去重逻辑复用，勿另写
- 关键词词根（preFilter + C1 验收用）改 `src/keyword-roots.js` 的 `KEYWORD_ROOTS`，勿在 index.js 内联

## 项目开发路线图

参考 yupi-hot-monitor 教程体系，本项目按以下顺序推进：

| 阶段 | 内容 | 状态 |
|------|------|------|
| 0 | 本地运行指南（docs/LOCAL_SETUP.md） | 待补充 |
| 1 | 需求分析（docs/PRD.md） | 已完成 |
| 2 | 方案设计 + 开发 + 测试（F-001~F-004） | 已完成 |
| 3 | 优化前端页面 | 已完成（F-004） |
| 4 | 优化信息获取来源（per-keyword 定向 RSS + 来源可信度） | **代码完成** → docs/archive/specs/001（已归档） |
| 4b | Firecrawl 直抓替代 Google News，前端 Tier 展示 | **代码完成** → docs/archive/specs/002（已归档） |
| 5 | 信息流筛选和排序 | 已完成（Tier 筛选 + 排序，F-004） |
| 6 | 优化热点信息展示 | 已完成（方案C 板块视图 + 交叉验证置信度，见 F-006/F-007） |
| 7 | 优化 AI 分析准确度 + 扩展思路 | **已完成（F-011）— 三段式摘要 + 分类优化 + preFilter** |
| 8 | Skills 开发（Agent Skill 技能包） | 待开发 |

## 遗留与待跟进

- [x] 前端 UI 已完成（F-004）
- [x] 信息源 Tier 基础设施已完成（spec-001 核心）
- [x] Manchester United 信源修复：切换到国内可达信源（Man Utd Official / ESPN / Sky Sports / 90min）
- [x] Google News RSS 已移除
- [x] `rss.js` + `keywords.json` 已删除
- [ ] Sky Sports / 90min AI 链接识别稳定性优化
- [x] GitHub 远程仓库推送（2026-08-04 已推送 `origin/master` 至 32801e5，含全部历史提交 + 临时文件清理）
- [ ] RLS 策略收紧（从宽松模式改为认证模式）
- [x] **Phase9 历史数据回填去重与前端空态（2026-08-05 完成）** — 全量回填重算（v2 修复模式 324 篇 0 失败）+ 同事件三层去重（Naji 4→1，去重 v3 双信号）+ BoardView 空态重构 + playwright-core 截图。见 `docs/REQ-Phase9-历史数据回填去重与前端空态.md` / `docs/DECISION-Phase9-历史数据回填去重与前端空态.md` / PROGRESS F-013
- [x] **第一批重构（2026-08-05 完成，已 push）** — P0① crawl4ai 模式表外置 `src/article-patterns.json`（修 si.com 双条目）+ P1⑥ ai.js options 对象 + 提示词外置 `src/prompts/` + P1⑦ search HN 走 toItem + `normalizeUrlKey` 统一 + P1③ index.js 阶段函数拆分 / `toArticleRecord` / `keyword-roots.js` 词根外置 / `dedupeAgainstExisting` 导出。详见本节"重构第一批"段落与 `docs/PLAN-重构计划.md`
- [x] 交叉校验打分引擎（方案B）— 2026-08-03 crawl4ai demo 验证通过（Tielemans 3源聚类 high）
- [x] 四板块分类报告（方案C）— 2026-08-03 板块视图 + 日报按板块分组完成
- [x] crawl4ai 接入生产管线（Phase E）— 2026-08-03 落地并回归，见 F-008
- [x] 文档体系整合（2026-08-04）— 两份 REQ 合并为一份（信源资产 + 实测备注）；历史 PLAN/CHECKLIST/spec 归档至 `docs/archive/`；PRD 更新至 crawl4ai 架构 + 方案BC 数据模型；`src/firecrawl.js` 删除；CLAUDE.md / DOCUMENT_MAP.md 索引同步
- [x] 代码化简重构（2026-08-04）— 新增 `src/config.js`（配置集中）、`src/items.js`（item 规整）、`src/report.js`（日报）；ai.js 收敛 OpenAI 单例 + 共享 `selectArticleLinks`/`parseAnalyzeResult`；删 scraper-direct 死代码 `fetchDirectSources`；crosscheck 冲突检测去死循环；前端抽 `useSupabaseQuery` 通用 hook（统一错误处理+取消）、共享 `TierBadge/ConfidenceBadge` 与 `constants/sources`；`KeywordsTab` 惰性拉取关键词；新增 node:test 单元测试（tiers/crosscheck/ai/search，22 例全过）。⚠️ 期间 `node --test src/` 误触发一次真实管线运行，test script 已改 `node --test "src/*.test.js"`（见 CLAUDE.md 已知陷阱）
- [x] Phase 7 AI 分析管线体验优化（2026-08-04）— ① analyzeResult prompt 重写：三段式摘要 `【事件】【要点】【为什么重要】` + 分类判别标准 + 正反例 ② selectArticleLinks prompt 硬化：显式排除 Standings/Scores/Schedule 等非文章链接 ③ preFilter 前置过滤：标题无词根直接跳过 ④ `scripts/check-quality.js` 自动化验收脚本（14/18 项可机器判定）。详情见 `docs/REQ-Phase7-AI分析优化.md` + `docs/DECISION-Phase7-AI分析优化.md`。回归：`node --check` 通过，`npm test` 22/22 全绿。验收：A2 无占位语 ✅、A3 三段式 100% ✅、C1 标题词根 0 异常 ✅、D1 score 跨 3 个十位段 ✅：① 删 blog 管线（scraper/reader/summarizeArticle）— **claude-blog 已停用（2026-08-04），blog 管线代码保留但不再触发**；② X 通道策略表 CHANNEL_POLICY 集中 isXUrl 判定；③ 抓取有界并发（现串行，B-003 曾因并发压垮 Supabase 连接池）；④ BoardView 改读 category_schema 数据驱动（现前端硬编码 MU_BOARDS/DAL_BOARDS）；⑤ relativeTime 换 date-fns（会改变用户可见中文文案）
- [x] **Anthropic 白名单信源扩展（F-009，2026-08-04）** — 6 源二 tier。端到端：154 条抓取，8 篇入库。文档：REQ/DECISION + 实测数据 data/
- [x] **Dallas Mavericks 白名单 + 前端 BoardView（F-010，2026-08-04）** — **8 源三 tier**：T0 nba.com/mavs/news + T1 Marc Stein(X) + T2 DMN/Yahoo/BR/SI/Mavs Moneyball/Smoking Cuban。新增 3 个信源基于 crawl4ai 实测。前端 BoardView 五宫格（官方/交易/伤病/管理层/赛事）。**踩坑修复**：首版 Yahoo/BR/NBA.com 产出导航垃圾（standings/stats/schedule 等），根因 `isNonArticleUrl()` 未覆盖 NBA 特有导航词。修复后新增 20+ 过滤词 + 3 个新信源，Dallas 从 4 条假新闻 → 9 条真新闻（0 垃圾）。截图 `screenshots/dallas-boardview.png`
