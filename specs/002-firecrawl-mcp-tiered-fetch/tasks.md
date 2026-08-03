# Tasks: Firecrawl 直抓 + Tier 分级展示

**Feature**: 002-firecrawl-mcp-tiered-fetch  
**Generated**: 2026-08-02  
**Total Tasks**: 14

---

## Dependencies

```
Phase 1 (DB Migration)
  └─ Phase 2 (Firecrawl module)
       └─ Phase 3 (Pipeline integration)
            └─ Phase 4 (Manchester United data)
                 └─ Phase 5 (Frontend Tier display)
                      └─ Phase 6 (Validation)
```

---

## Phase 1: DB Migration

**Goal**: keyword_sources 表新增 scrape_url + fetch_type 字段

- [X] T001 Apply Supabase migration:
  ```sql
  ALTER TABLE keyword_sources
    ADD COLUMN scrape_url TEXT,
    ADD COLUMN fetch_type TEXT NOT NULL DEFAULT 'rss'
      CHECK (fetch_type IN ('rss', 'firecrawl'));
  ```
  验证：`SELECT column_name FROM information_schema.columns WHERE table_name='keyword_sources' AND column_name IN ('scrape_url','fetch_type')` 返回 2 行

---

## Phase 2: Firecrawl 抓取模块

**Goal**: 创建 `src/firecrawl.js`，接口与 `fetchRssFeeds` 一致

- [X] T002 Create `src/firecrawl.js` — export `fetchFirecrawlSources(sources)`:
  - `sources`: `Array<{ scrape_url, source_name, tier, enabled }>`
  - 如 `FIRECRAWL_API_KEY` 未设置，输出 warn 并返回 `[]`
  - 逐个串行调用（2s 间隔）`POST https://api.firecrawl.dev/v1/scrape`，body：
    ```json
    {
      "url": "<source.scrape_url>",
      "formats": ["extract"],
      "extract": {
        "prompt": "Extract all news article items from this page. Return articles array.",
        "schema": {
          "type": "object",
          "properties": {
            "articles": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "title": {"type": "string"},
                  "url": {"type": "string"},
                  "publishedDate": {"type": "string"}
                },
                "required": ["title", "url"]
              }
            }
          }
        }
      }
    }
    ```
  - headers: `Authorization: Bearer ${FIRECRAWL_API_KEY}`, `Content-Type: application/json`
  - 每条 article 返回格式：`{ title, url, snippet: '', publishedAt: new Date(publishedDate) || new Date(), source_name, source: slugified(source_name), tier }`
  - 单源失败时 log `[Firecrawl] 跳过 ${source_name}: ${err.message}` 并继续
  - 按 URL 去重（Set）

- [X] T003 Add `axios` as HTTP client for Firecrawl requests (already in package.json — verify it's available, don't add duplicate)

---

## Phase 3: Pipeline 集成

**Goal**: store.js + search.js 支持 firecrawl 源分离加载与合并

- [X] T004 Update `src/store.js` — `loadKeywordSources(keywordId)`:
  - 查询时同时返回 `scrape_url` 和 `fetch_type` 字段（当前只返回 `rss_url, source_name, tier`）
  - 新 select：`rss_url, scrape_url, source_name, tier, fetch_type`

- [X] T005 Update `src/search.js` — `searchAll(query, keywordSources)`:
  - **移除** `searchGoogleNews(query)` 调用（FR-005，research.md Decision 4）
  - 保留 `searchHackerNews(query)`
  - 从 `keywordSources` 中按 `fetch_type` 分组：
    - `rssSources = keywordSources.filter(s => s.fetch_type === 'rss' || !s.fetch_type)`
    - `firecrawlSources = keywordSources.filter(s => s.fetch_type === 'firecrawl')`
  - 新 tasks 数组：`[searchHackerNews(query), fetchRssFeeds(rssSources), fetchFirecrawlSources(firecrawlSources)]`
  - import `fetchFirecrawlSources` from `./firecrawl`
  - 去重逻辑 `deduplicateByUrl` 不变
  - 可删除 `searchGoogleNews` 函数及其 import（axios + cheerio 如无其他用途也可移除）

---

## Phase 4: Manchester United 数据更新

**Goal**: 在 keyword_sources 表中插入/更新 Manchester United 的 Firecrawl 源，替换失效的 BBC Sport RSS + MEN RSS

- [X] T006 在 Supabase 中找到 Manchester United 关键词的 `keyword_id`：
  ```sql
  SELECT id, name FROM keywords WHERE name ILIKE '%manchester%';
  ```

- [X] T007 将现有 BBC Sport (rss_url + ETIMEDOUT 报错) 行更新为 Firecrawl：
  ```sql
  UPDATE keyword_sources
  SET fetch_type = 'firecrawl',
      scrape_url = 'https://www.bbc.com/sport/football/teams/manchester-united',
      rss_url = NULL
  WHERE keyword_id = '<id>' AND source_name ILIKE '%BBC%';
  ```

- [X] T008 将现有 MEN (404 报错) 行更新为 Firecrawl：
  ```sql
  UPDATE keyword_sources
  SET fetch_type = 'firecrawl',
      scrape_url = 'https://www.manchestereveningnews.co.uk/sport/football/manchester-united-fc/',
      rss_url = NULL
  WHERE keyword_id = '<id>' AND source_name ILIKE '%Manchester Evening%';
  ```

---

## Phase 5: 前端 Tier 筛选

**Goal**: 前端支持按 source_tier 筛选文章（FR-004）

- [X] T009 Update `client/src/hooks/useArticles.ts` — 在 `filters` 中加入 `tier?: number | null`:
  - Supabase 查询加条件：`if (filters.tier !== undefined && filters.tier !== null) query = query.eq('source_tier', filters.tier)`
  - effect 依赖加 `filters.tier`

- [X] T010 Update `client/src/components/FilterSortBar.tsx`（或等效 filter 组件）— 添加 Tier 筛选 select：
  - 选项：全部 / Tier 0（官方）/ Tier 1（顶级媒体）/ Tier 2（主流媒体）/ Tier 3（其他）
  - 传入 `onTierChange` 回调

- [X] T011 Update `client/src/App.tsx` — 将 tier filter 状态 wire 到 `FilterSortBar` + `useArticles`

---

## Phase 6: 端到端验证

**Goal**: 按 quickstart.md 跑完验证步骤

- [X] T012 Run `node -e "const {fetchFirecrawlSources} = require('./src/firecrawl'); ..."` 验证 Firecrawl 模块单独返回文章（参见 quickstart.md Step 2）

- [X] T013 Run `node src/index.js`，确认 Manchester United pipeline 无 ETIMEDOUT / 404，日志出现 `[Firecrawl]` 行

- [ ] T014 验证 Supabase articles 表新增记录的 `source_tier` 为 1 或 2，`source` 字段正确（参见 quickstart.md Step 4）

---

## Implementation Order

**串行主链路（Manchester United 优先）**:  
T001 → T002 → T003 → T004 → T005 → T006 → T007 → T008 → T012 → T013 → T014

**前端（可并行，不阻塞后端）**:  
T009 → T010 → T011（完成 T001 后即可开始）

**预估**:
- Session A（后端核心）: T001–T008（约 1-2 小时）
- Session B（验证 + 前端）: T009–T014（约 1 小时）
