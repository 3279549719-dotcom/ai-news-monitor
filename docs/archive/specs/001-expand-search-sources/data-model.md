# Data Model: 信息源可信度分级与按关键词定向采集

**Created**: 2026-08-02

---

## 新增表：`keyword_sources`

```sql
CREATE TABLE keyword_sources (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword_id  TEXT NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
  rss_url     TEXT NOT NULL,
  source_name TEXT NOT NULL,          -- 显示名，如 "BBC Sport"
  tier        INTEGER NOT NULL        -- 0=官方权威 1=顶级可信 2=次可靠 3=低可信
              CHECK (tier BETWEEN 0 AND 3),
  enabled     BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (keyword_id, rss_url)
);

CREATE INDEX keyword_sources_keyword_id_idx ON keyword_sources(keyword_id);
```

---

## 修改表：`articles` 新增字段

```sql
ALTER TABLE articles
  ADD COLUMN source_tier INTEGER CHECK (source_tier BETWEEN 0 AND 3);
-- NULL = 来自 searchAll()（未绑定 RSS），不影响现有记录
```

---

## 新增配置文件：`src/source-tiers.json`

```json
{
  "manutd.com": 0,
  "pressassociation.com": 0,
  "theathletic.com": 1,
  "bbc.co.uk": 1,
  "manchestereveningnews.co.uk": 1,
  "theguardian.com": 1,
  "telegraph.co.uk": 1,
  "thetimes.co.uk": 1,
  "skysports.com": 2,
  "talksport.co.uk": 2,
  "goal.com": 2,
  "thesun.co.uk": 3,
  "dailymail.co.uk": 3,
  "dailystar.co.uk": 3,
  "mirror.co.uk": 3
}
```

---

## 数据流

```
keyword_sources(rss_url, tier)
       ↓ loadKeywordSources(keyword_id)
src/rss.js → fetchRssFeeds(sources[])
       ↓ items with { title, url, snippet, publishedAt, source_name, tier }
       ↓ merge with searchAll() results (tier=null for those)
src/ai.js → analyzeResult(query, title, snippet, tier)
       ↓
articles(source, source_tier, score, summary, ...)
```

---

## 现有表无破坏性改动

- `keywords` 表不变（源绑定完全在 `keyword_sources` 独立管理）
- `articles` 新增列为 nullable，旧记录 `source_tier = NULL`，前端需处理 null 值
