# Quickstart: Feature 002 验证指南

**Feature**: 002-firecrawl-mcp-tiered-fetch

---

## 前置条件

- `FIRECRAWL_API_KEY` 已设置（`.env` 文件）
- Supabase 已完成 DB 迁移（`scrape_url` + `fetch_type` 字段存在）
- Manchester United 的两条 Firecrawl 源已插入 `keyword_sources`

---

## Step 1: 验证 DB 迁移

```sql
-- 确认新字段存在
SELECT column_name FROM information_schema.columns
WHERE table_name = 'keyword_sources'
AND column_name IN ('scrape_url', 'fetch_type');
-- 期望返回 2 行

-- 确认 Manchester United 的 firecrawl 源
SELECT source_name, fetch_type, scrape_url, tier
FROM keyword_sources
WHERE keyword_id = '<manchester-united-id>' AND fetch_type = 'firecrawl';
-- 期望返回 2 行 (BBC Sport MU + Manchester Evening News)
```

---

## Step 2: 验证 `fetchFirecrawlSources` 模块

```bash
node -e "
const { fetchFirecrawlSources } = require('./src/firecrawl');
fetchFirecrawlSources([{
  scrape_url: 'https://www.bbc.com/sport/football/teams/manchester-united',
  source_name: 'BBC Sport MU',
  tier: 1,
  enabled: true
}]).then(results => {
  console.log('articles found:', results.length);
  console.log('first article:', results[0]);
}).catch(console.error);
"
```

**期望**：`articles found: N`（N > 0），输出包含 `title`, `url`, `tier: 1`

---

## Step 3: 完整 pipeline 运行

```bash
node src/index.js
```

**期望日志（Manchester United 部分）**：
```
[Manchester United] 搜索 "Manchester United"
  [Firecrawl] 抓取 BBC Sport MU: 找到 X 条
  [Firecrawl] 抓取 Manchester Evening News: 找到 Y 条
  找到 N 条
  未处理: M
  相关: K/15
```

无 `ETIMEDOUT` 错误，无 `Status code 404` 错误。

---

## Step 4: 验证 Supabase 入库

```sql
SELECT title, source, source_tier, score
FROM articles
WHERE keyword_id = '<manchester-united-id>'
  AND source_tier IS NOT NULL
ORDER BY created_at DESC
LIMIT 5;
```

**期望**：`source_tier` 为 1 或 2（不为 NULL），来源为 `bbc-sport-mu` 或 `manchester-evening-news`。

---

## Step 5: 验证前端 Tier 显示

1. 启动前端：`cd client && npm run dev`
2. 打开 `http://localhost:5173`
3. 在 Manchester United 关键词筛选下，文章卡片应显示 `T1` / `T2` 徽章
4. 按 Tier 筛选：选 Tier 1，只显示 tier=1 的文章
