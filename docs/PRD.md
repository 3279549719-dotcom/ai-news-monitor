# ai-news-monitor 产品需求与技术规范（PRD）

> 最后更新：2026-08-03（方案A落地：白名单定向抓取 + Firecrawl 降级路径）

## 技术约束

- 运行环境：Node.js 本地手动或定时运行，无服务端
- 框架与语言：Node.js CommonJS，无 TypeScript（前端除外）
- 包管理器：npm
- 数据存储：Supabase (PostgreSQL) — keywords 表 + keyword_sources 表 + articles 表
- 检查命令：`node --check src/*.js`
- 运行命令：`(cd ai-news-monitor && node src/index.js)`

## 模块职责

| 模块 | 职责 | 关键依赖 |
|---|---|---|
| index.js | 主调度：pipeline 循环、报告生成、cron 启动 | 所有其他模块 |
| db.js | Supabase client 单例 + withRetry 重试工具 | @supabase/supabase-js |
| store.js | 数据访问：loadKeywords、loadKeywordSources、filterNewItems（RPC）、saveArticles | db.js |
| scraper.js | blog 类型：抓取指定博客文章列表，支持传入 URL | axios, cheerio |
| reader.js | blog 类型：读取单篇文章正文，截4000字 | axios, cheerio |
| search.js | search 类型：白名单信源抓取调度 + HackerNews 兜底（Google News 已移除） | axios, cheerio |
| scraper-direct.js | 信源直抓（降级路径）：axios 拉 HTML → 正则提取链接 → DeepSeek 识别文章列表 | axios, openai SDK |
| firecrawl.js | Firecrawl API 抓取（主路径，当前余额不足 HTTP 402，降级路径启用中） | axios |
| ai.js | summarizeArticle（blog全文→摘要）, analyzeResult（标题+snippet+tier→相关度+摘要）| openai SDK |
| tiers.js | getTier(url)：域名 → Tier 映射 | source-tiers.json |

## Pipeline 架构

```
for each keyword (顺序处理):
  if type=blog:  scraper.fetchArticleList(url) → reader.fetchArticleContent → ai.summarizeArticle
  if type=search:
    sources = loadKeywordSources(keyword.id)   # 白名单信源（fetch_type='firecrawl'）
    if sources 非空: searchAll(query, sources) → 直抓信源页面（Firecrawl 优先，余额不足降级 scraper-direct）
    else:          searchHackerNews(query)     # 兜底
  store.filterNewItems(items, keyword_id) → [新条目]
  ai.analyze items (并发, limit=15)  # score≥60 为相关
  store.saveArticles(records)  ← 相关的有摘要+score+source_tier, 不相关的score=0
```

### 抓取通道选择

```
Firecrawl API（主路径）
  └─ HTTP 402（余额不足）→ scraper-direct.js（axios + DeepSeek 识别链接）
```

- `src/search.js` 根据环境自动选择：Firecrawl 可用则用主路径，否则降级
- 额度恢复后无需改代码，自动切回

## Supabase 数据模型

### keywords 表
```
id          TEXT PRIMARY KEY
name        TEXT NOT NULL
type        TEXT CHECK(type IN ('blog','search'))
query       TEXT  -- search 类型用（白名单模式下用宽泛词）
url         TEXT  -- blog 类型用
enabled     BOOLEAN DEFAULT true
created_at  TIMESTAMPTZ DEFAULT NOW()
```

### keyword_sources 表（白名单信源）
```
id          UUID PRIMARY KEY DEFAULT gen_random_uuid()
keyword_id  TEXT NOT NULL REFERENCES keywords(id) ON DELETE CASCADE
rss_url     TEXT NOT NULL            -- NOT NULL 约束！仅用 firecrawl 时填与 scrape_url 相同的值
scrape_url  TEXT                     -- Firecrawl / scraper-direct 抓取目标
source_name TEXT NOT NULL            -- 显示名，如 "Man Utd Official"
tier        INTEGER NOT NULL CHECK (tier BETWEEN 0 AND 3)
fetch_type  TEXT NOT NULL DEFAULT 'rss' CHECK (fetch_type IN ('rss','firecrawl'))
enabled     BOOLEAN NOT NULL DEFAULT true
created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
UNIQUE (keyword_id, rss_url)
```

### articles 表
```
id           UUID PRIMARY KEY DEFAULT gen_random_uuid()
keyword_id   TEXT REFERENCES keywords(id) ON DELETE CASCADE
title        TEXT NOT NULL
url          TEXT NOT NULL
source       TEXT NOT NULL  -- 'blog'|'hackernews'|信源slug（如 espn、man-utd-official）
snippet      TEXT
summary      TEXT
score        INTEGER CHECK(score BETWEEN 0 AND 100)
source_tier  INTEGER CHECK(source_tier BETWEEN 0 AND 3)  -- 从 keyword_sources.tier 继承
published_at TIMESTAMPTZ
created_at   TIMESTAMPTZ DEFAULT NOW()
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
| FIRECRAWL_API_KEY | | Firecrawl API 密钥（余额不足时自动降级 scraper-direct）|
| CRON_SCHEDULE | | 留空则单次运行，如 `0 8 * * *` 每天8点 |

## 验证要求

- 语法检查：`node --check src/*.js` — 全部通过
- 运行验证：`(cd ai-news-monitor && node src/index.js)` — 4个关键词全部返回结果
- 边界条件：
  - 无新文章时：打印"本次无相关新内容"并正常退出
  - 关键词类型未知：warn + 跳过，不中断其他关键词
  - Supabase 网络瞬断：withRetry 最多重试3次（间隔1s递增）
  - 单个关键词失败：catch + 继续处理其余关键词
  - 单个信源抓取失败：`[Direct] 跳过` + 继续处理其余信源
  - Firecrawl 余额不足（402）：自动降级 scraper-direct，不中断
  - CRON_SCHEDULE 格式错误：校验后 process.exit(1)
