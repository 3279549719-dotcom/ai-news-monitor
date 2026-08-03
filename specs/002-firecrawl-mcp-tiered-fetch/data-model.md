# Data Model: Firecrawl 直抓 + Tier 分级

**Feature**: 002-firecrawl-mcp-tiered-fetch

---

## DB 变更

### keyword_sources 表（新增字段）

```sql
ALTER TABLE keyword_sources
  ADD COLUMN scrape_url TEXT,
  ADD COLUMN fetch_type TEXT NOT NULL DEFAULT 'rss'
    CHECK (fetch_type IN ('rss', 'firecrawl'));
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `scrape_url` | TEXT, nullable | Firecrawl 直抓的目标 URL（fetch_type='firecrawl' 时必填） |
| `fetch_type` | TEXT DEFAULT 'rss' | 采集方式：`'rss'` 或 `'firecrawl'` |

**存量数据**：所有现有行 `fetch_type` 默认为 `'rss'`，`scrape_url` 默认为 NULL，无需迁移。

### articles 表

无变更。`source_tier` 字段已在 spec-001 中添加。

---

## 新增数据源配置（需手动插入 Supabase）

Manchester United — 替换失效的 BBC Sport RSS 和 MEN RSS：

| keyword_id | source_name | scrape_url | fetch_type | tier |
|-----------|-------------|-----------|-----------|------|
| manchester-united | BBC Sport MU | `https://www.bbc.com/sport/football/teams/manchester-united` | firecrawl | 1 |
| manchester-united | Manchester Evening News | `https://www.manchestereveningnews.co.uk/sport/football/manchester-united-fc/` | firecrawl | 2 |

---

## 新增模块

### `src/firecrawl.js`

```
输入: sources: Array<{ scrape_url, source_name, tier, enabled }>
输出: Promise<Array<{ title, url, snippet, publishedAt, source_name, source, tier }>>
```

与 `fetchRssFeeds` 输出格式保持一致，可直接合并进 `searchAll` 的 `combined` 数组。

---

## 环境变量

| 变量名 | 用途 | 默认值 |
|--------|------|--------|
| `FIRECRAWL_API_KEY` | Firecrawl API 认证 | 无（未设置时跳过 firecrawl 源） |
