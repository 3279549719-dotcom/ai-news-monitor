# ai-news-monitor 产品需求与技术规范（PRD）

> 最后更新：2026-08-04（Phase E：crawl4ai 主抓取通道 + 方案BC 数据模型）

## 技术约束

- 运行环境：Node.js 本地手动或定时运行，无服务端
- 框架与语言：Node.js CommonJS，无 TypeScript（前端除外）
- 包管理器：npm
- 数据存储：Supabase (PostgreSQL) — keywords 表 + keyword_sources 表 + articles 表
- 抓取通道：crawl4ai 容器（`localhost:11235`，REST），失败/空结果自动降级 scraper-direct
- 检查命令：`node --check src/*.js`
- 运行命令：`(cd ai-news-monitor && node src/index.js)`

## 模块职责

| 模块 | 职责 | 关键依赖 |
|---|---|---|
| index.js | 主调度：pipeline 循环、交叉验证、报告生成、cron 启动 | 所有其他模块 |
| config.js | 环境变量与常量集中读取（MIN_SCORE/RESULT_LIMIT/HTTP/DeepSeek/crawl4ai/Supabase） | dotenv |
| db.js | Supabase client 单例 + withRetry 重试工具 | @supabase/supabase-js、config.js |
| store.js | 数据访问：loadKeywords、loadKeywordSources、filterNewItems（RPC）、saveArticles | db.js |
| search.js | search 类型：逐源白名单抓取调度（crawl4ai 优先 → 降级 scraper-direct）+ HackerNews 兜底；deduplicateByUrl | crawl4ai-fetch.js、scraper-direct.js |
| crawl4ai-fetch.js | crawl4ai 抓取通道（Phase E 主通道）：REST 调本地容器 → 站点文章 URL 模式筛选；X 账号走 external t.co 链 | axios、ai.js、items.js、config.js |
| scraper-direct.js | 信源直抓（降级路径）：axios 拉 HTML → 正则提取链接 → AI 精选文章 | axios、ai.js、items.js、config.js |
| scraper.js / reader.js | blog 类型：抓取博客文章列表 + 读正文（claude-blog 用） | axios, cheerio, config.js |
| ai.js | getOpenAI 单例；summarizeArticle（blog）；analyzeResult（search）；parseAnalyzeResult（解析）；selectArticleLinks（共享链接精选） | openai SDK、config.js |
| items.js | 抓取结果 → 入库 items 形状规整（toItem/sourceSlug，两通道共用） | — |
| crosscheck.js | 交叉验证（方案B）：event 聚类 + 置信度/印证数/冲突标记；CONFIDENCE_LABEL | — |
| report.js | 日报 buildReport（按 category_schema 分组） | crosscheck.js |
| tiers.js | getTier(url)：域名 → Tier 映射 | source-tiers.json |

> `src/firecrawl.js` 已删除（Firecrawl API 余额耗尽 402，2026-08-04 清理）。

## Pipeline 架构

```
for each keyword (顺序处理):
  if type=blog:  scraper.fetchArticleList(url) → reader.fetchArticleContent → ai.summarizeArticle
  if type=search:
    sources = loadKeywordSources(keyword.id)   # 白名单信源（fetch_type='firecrawl' 且 enabled）
    if sources 非空: searchAll(query, sources) → 逐源 crawl4ai 优先，失败降级 scraper-direct
    else:          searchHackerNews(query)     # 兜底
  store.filterNewItems(items, keyword_id) → [新条目]
  ai.analyze items (并发, limit=15)  # score≥60 为相关；输出 event/category
  crosscheck.clusterByEvent + computeConfidence（本次运行内聚类，≥2源 high / 单源 medium / 与T0冲突 low+flag）
  store.saveArticles(records)  ← 相关的有摘要+score+source_tier+event+category+confidence+corroboration_count+conflict_flag
  buildReport 按 category_schema 分组生成日报
```

### 抓取通道选择

```
crawl4ai 容器（主通道，REST localhost:11235）
  ├─ 成功 → 站点文章 URL 模式筛选（≥3 直接用标题，避开 DeepSeek 被导航淹没）
  ├─ 候选不足 → 回退 DeepSeek 精选
  └─ 失败/空结果 → scraper-direct.js（axios + DeepSeek 识别链接）
X 账号信源仅走 crawl4ai（axios 抓 X 无意义），失败直接跳过，不降级
```

- `src/search.js` 逐源自动选择：crawl4ai 可用则用主路径，否则降级，单源失败不影响其余源
- 定时管线依赖 Docker 容器 `crawl4ai` 在线（`docker start crawl4ai`）；容器不可用时自动逐源降级

## Supabase 数据模型

### keywords 表
```
id              TEXT PRIMARY KEY
name            TEXT NOT NULL
type            TEXT CHECK(type IN ('blog','search'))
query           TEXT  -- search 类型用（白名单模式下用宽泛词）
url             TEXT  -- blog 类型用
category_schema JSONB -- 板块模板（方案C，如 MU 8 类 / 通用 4 类）
enabled         BOOLEAN DEFAULT true
created_at      TIMESTAMPTZ DEFAULT NOW()
```

### keyword_sources 表（白名单信源）
```
id          UUID PRIMARY KEY DEFAULT gen_random_uuid()
keyword_id  TEXT NOT NULL REFERENCES keywords(id) ON DELETE CASCADE
rss_url     TEXT NOT NULL            -- NOT NULL 约束！仅用 firecrawl 时填与 scrape_url 相同的值
scrape_url  TEXT                     -- crawl4ai / scraper-direct 抓取目标
source_name TEXT NOT NULL            -- 显示名，如 "Man Utd Official"
tier        INTEGER NOT NULL CHECK (tier BETWEEN 0 AND 3)
fetch_type  TEXT NOT NULL DEFAULT 'rss' CHECK (fetch_type IN ('rss','firecrawl'))
enabled     BOOLEAN NOT NULL DEFAULT true
created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
UNIQUE (keyword_id, rss_url)
```

### articles 表
```
id                  UUID PRIMARY KEY DEFAULT gen_random_uuid()
keyword_id          TEXT REFERENCES keywords(id) ON DELETE CASCADE
title               TEXT NOT NULL
url                 TEXT NOT NULL
source              TEXT NOT NULL  -- 'blog'|'hackernews'|信源slug（如 espn、man-utd-official）
snippet             TEXT
summary             TEXT
score               INTEGER CHECK(score BETWEEN 0 AND 100)
source_tier         INTEGER CHECK(source_tier BETWEEN 0 AND 3)  -- 从 keyword_sources.tier 继承
category            TEXT            -- 板块分类（方案C）
event               TEXT            -- 事件描述（方案B，聚类用）
confidence          TEXT CHECK(confidence IN ('high','medium','low'))  -- 交叉验证置信度
corroboration_count INT DEFAULT 0   -- 印证源数（方案B）
conflict_flag       BOOLEAN DEFAULT false  -- 与 T0 冲突标记（方案B）
published_at        TIMESTAMPTZ
created_at          TIMESTAMPTZ DEFAULT NOW()
UNIQUE(keyword_id, url)
```

### 数据库函数
- `get_new_urls(p_keyword_id TEXT, p_urls TEXT[])` → TABLE(url TEXT)
  用于 filterNewItems 查重（规避 PostgREST GET 请求 URL 长度限制）

### 索引
- `articles_keyword_id_idx` on articles(keyword_id)
- `articles_created_at_idx` on articles(created_at DESC)

## 环境变量（.env）

| 变量 | 必填 | 说明 |
|---|---|---|
| DEEPSEEK_API_KEY | ✓ | DeepSeek API 密钥 |
| DEEPSEEK_MODEL | ✓ | 模型 ID（如 deepseek-chat）|
| DEEPSEEK_BASE_URL | | 默认 https://api.deepseek.com |
| SUPABASE_URL | ✓ | https://xxx.supabase.co |
| SUPABASE_KEY | ✓ | sb_publishable_... |
| CRAWL4AI_API_TOKEN | ✓ | crawl4ai 容器鉴权 token（亦存 `.crawl4ai-token`，已 gitignore）|
| CRON_SCHEDULE | | 留空则单次运行，如 `0 8 * * *` 每天8点 |

> `FIRECRAWL_API_KEY` 已废弃（Firecrawl API 停用）。

## 验证要求

- 语法检查：`node --check src/*.js` — 全部通过
- 单元测试：`npm test`（node:test，`src/*.test.js`：tiers/crosscheck/ai/search）— 全部通过
- 运行验证：`(cd ai-news-monitor && node src/index.js)` — 4个关键词全部返回结果
- 边界条件：
  - 无新文章时：打印"本次无相关新内容"并正常退出
  - 关键词类型未知：warn + 跳过，不中断其他关键词
  - Supabase 网络瞬断：withRetry 最多重试3次（间隔1s递增）
  - 单个关键词失败：catch + 继续处理其余关键词
  - 单个信源抓取失败：`[Direct] 跳过` + 继续处理其余信源
  - crawl4ai 容器不可用：逐源降级 scraper-direct，不中断
  - CRON_SCHEDULE 格式错误：校验后 process.exit(1)
