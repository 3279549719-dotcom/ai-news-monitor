# ai-news-monitor 项目进度

> 最后更新：2026-08-04（代码化简重构 + 文档体系整合）

## 功能进度

| ID | 功能 | 状态 | 验证 |
|---|---|---|---|
| F-001 | MVP：claude.com/blog 监控 + AI 摘要 | 已完成 | 2026-08-01 实机验证 |
| F-002 | Phase 2：多关键词 + HackerNews 搜索 | 已完成 | 2026-08-01 实机验证 |
| F-003 | Phase 3：Supabase 持久化 + cron 定时 + 代码重构 | 已完成 | 2026-08-02 实机验证 |
| F-004 | Phase 4：前端 UI（React18 + TypeScript + Vite + Tailwind） | 已完成 | 2026-08-02 localhost 验证 |
| F-005 | Phase 5：白名单定向抓取（方案A）— 移除 Google News RSS + Firecrawl，改用 scraper-direct.js | **已完成** | 2026-08-03 端到端验证通过（MU 3篇入库） |

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
| 6 | 优化热点信息展示 | 部分完成（方案C 板块视图 + 交叉验证置信度，见 F-006/F-007） |
| 7 | 优化 AI 分析准确度 + 扩展思路 | 待开发 |
| 8 | Skills 开发（Agent Skill 技能包） | 待开发 |

## 遗留与待跟进

- [x] 前端 UI 已完成（F-004）
- [x] 信息源 Tier 基础设施已完成（spec-001 核心）
- [x] Manchester United 信源修复：切换到国内可达信源（Man Utd Official / ESPN / Sky Sports / 90min）
- [x] Google News RSS 已移除
- [x] `rss.js` + `keywords.json` 已删除
- [ ] Sky Sports / 90min AI 链接识别稳定性优化
- [ ] GitHub 远程仓库推送（需 `gh auth login` 后执行）
- [ ] RLS 策略收紧（从宽松模式改为认证模式）
- [x] 交叉校验打分引擎（方案B）— 2026-08-03 crawl4ai demo 验证通过（Tielemans 3源聚类 high）
- [x] 四板块分类报告（方案C）— 2026-08-03 板块视图 + 日报按板块分组完成
- [x] crawl4ai 接入生产管线（Phase E）— 2026-08-03 落地并回归，见 F-008
- [x] 文档体系整合（2026-08-04）— 两份 REQ 合并为一份（信源资产 + 实测备注）；历史 PLAN/CHECKLIST/spec 归档至 `docs/archive/`；PRD 更新至 crawl4ai 架构 + 方案BC 数据模型；`src/firecrawl.js` 删除；CLAUDE.md / DOCUMENT_MAP.md 索引同步
- [x] 代码化简重构（2026-08-04）— 新增 `src/config.js`（配置集中）、`src/items.js`（item 规整）、`src/report.js`（日报）；ai.js 收敛 OpenAI 单例 + 共享 `selectArticleLinks`/`parseAnalyzeResult`；删 scraper-direct 死代码 `fetchDirectSources`；crosscheck 冲突检测去死循环；前端抽 `useSupabaseQuery` 通用 hook（统一错误处理+取消）、共享 `TierBadge/ConfidenceBadge` 与 `constants/sources`；`KeywordsTab` 惰性拉取关键词；新增 node:test 单元测试（tiers/crosscheck/ai/search，22 例全过）。⚠️ 期间 `node --test src/` 误触发一次真实管线运行，test script 已改 `node --test "src/*.test.js"`（见 CLAUDE.md 已知陷阱）
- [ ] 重构遗留决策（2026-08-04，**已确认：记录为后续优化项，本期不做**）：① 删 blog 管线（scraper/reader/summarizeArticle）— 注意 `claude-blog` 关键词仍启用，删除前需先下线该关键词；② X 通道策略表 CHANNEL_POLICY 集中 isXUrl 判定；③ 抓取有界并发（现串行，B-003 曾因并发压垮 Supabase 连接池）；④ BoardView 改读 category_schema 数据驱动（现前端硬编码 MU_BOARDS）；⑤ relativeTime 换 date-fns（会改变用户可见中文文案）
