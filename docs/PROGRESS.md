# ai-news-monitor 项目进度

> 最后更新：2026-08-03（方案A落地：白名单定向抓取 + Firecrawl 停用）

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

## 项目开发路线图

参考 yupi-hot-monitor 教程体系，本项目按以下顺序推进：

| 阶段 | 内容 | 状态 |
|------|------|------|
| 0 | 本地运行指南（docs/LOCAL_SETUP.md） | 待补充 |
| 1 | 需求分析（docs/PRD.md） | 已完成 |
| 2 | 方案设计 + 开发 + 测试（F-001~F-004） | 已完成 |
| 3 | 优化前端页面 | 已完成（F-004） |
| 4 | 优化信息获取来源（per-keyword 定向 RSS + 来源可信度） | **代码完成** → specs/001（信源 URL 待修复） |
| 4b | Firecrawl 直抓替代 Google News，前端 Tier 展示 | **代码完成** → specs/002 |
| 5 | 信息流筛选和排序 | 待开发 |
| 6 | 优化热点信息展示 | 待开发 |
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
- [ ] 交叉校验打分引擎（方案B）
- [ ] 四板块分类报告（方案C）
