# Quickstart 验证指南

**Feature**: 信息源可信度分级与按关键词定向采集  
**Updated**: 2026-08-02

---

## 前置条件

- `.env` 已配置（SUPABASE_URL、SUPABASE_KEY、DEEPSEEK_API_KEY）
- `npm install` 已跑过（含新增 `rss-parser`）
- Supabase migration 已执行（`keyword_sources` 表 + `articles.source_tier` 列）

---

## Step 1：执行 Migration

在 Supabase Dashboard → SQL Editor，或通过 MCP 执行：

```sql
-- 1. 新增 keyword_sources 表
CREATE TABLE keyword_sources ( ... );  -- 见 data-model.md

-- 2. articles 表加列
ALTER TABLE articles ADD COLUMN source_tier INTEGER CHECK (source_tier BETWEEN 0 AND 3);
```

验证：`keyword_sources` 表出现在 Table Editor，`articles` 表有 `source_tier` 列。

---

## Step 2：插入测试 RSS 绑定

找到曼联关键词的 `id`（如 `manchester-united`），在 `keyword_sources` 插入：

```sql
INSERT INTO keyword_sources (keyword_id, rss_url, source_name, tier) VALUES
  ('manchester-united', 'https://www.manchestereveningnews.co.uk/sport/football/manchester-united-fc/?service=rss', 'Manchester Evening News', 1),
  ('manchester-united', 'https://feeds.bbci.co.uk/sport/football/rss.xml', 'BBC Sport', 1);
```

---

## Step 3：运行采集

```bash
node src/index.js
```

**预期输出：**
- 日志出现 `[RSS] 拉取 Manchester Evening News ...` 之类的行
- 曼联关键词的结果包含 BBC Sport 或 MEN 来源的条目
- Supabase `articles` 表新增记录中 `source_tier` 不为 NULL，且值为 1

---

## Step 4：验证可信度加权

查询 Supabase：

```sql
SELECT title, source, source_tier, score
FROM articles
WHERE keyword_id = 'manchester-united'
ORDER BY created_at DESC
LIMIT 20;
```

**成功标志：**
- `source` 为 `bbc-sport` 或 `manchester-evening-news` 的记录存在
- 这些记录的 `score` ≥ 60（Tier 1 宽松评分生效）
- 没有 `thesun.co.uk` / `dailymail.co.uk` 来源（因为我们没有绑定它们的 RSS）

---

## Step 5：验证向后兼容

确认没有绑定 RSS 的关键词（如 Claude AI 博客监控）：

```bash
node src/index.js
```

结果中 `claude.com/blog` 关键词行为与之前完全一致，无报错。
