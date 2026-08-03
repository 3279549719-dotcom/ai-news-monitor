# Tasks: 信息源可信度分级与按关键词定向采集

**Feature**: 001-expand-search-sources  
**Generated**: 2026-08-02  
**Total Tasks**: 18

---

## Dependencies

```
Phase 1 (Setup)
  └─ Phase 2 (DB Migration)
       ├─ Phase 3 (US1: source-tiers config)
       └─ Phase 4 (US2: rss.js module)
            └─ Phase 5 (US3: store layer)
                 └─ Phase 6 (US4: search pipeline merge)
                      └─ Phase 7 (US5: AI tier scoring)
                           └─ Phase 8 (Pipeline wiring)
                                └─ Phase 9 (Polish)
```

---

## Phase 1: Setup

**Goal**: 安装依赖，确保 rss-parser 可用

- [X] T001 Add `rss-parser` to dependencies in `package.json` and run `npm install`
- [X] T002 Verify rss-parser installation by running `node -e "require('rss-parser'); console.log('ok')"` in project root

---

## Phase 2: Foundation — DB Migration

**Goal**: 数据库迁移，新建 keyword_sources 表，articles 加 source_tier 列  
**Independent test**: Supabase Table Editor 中可见 `keyword_sources` 表，`articles` 有 `source_tier` 列

- [X] T003 Apply Supabase migration — create `keyword_sources` table per `specs/001-expand-search-sources/data-model.md` (use Supabase MCP or Dashboard SQL Editor)
- [X] T004 Apply Supabase migration — `ALTER TABLE articles ADD COLUMN source_tier INTEGER CHECK (source_tier BETWEEN 0 AND 3)` per `specs/001-expand-search-sources/data-model.md`

---

## Phase 3: US1 — Source Tier Config

**Goal**: 来源可信度映射配置文件 + 域名查询工具函数  
**Independent test**: `node -e "const t = require('./src/tiers'); console.log(t.getTier('https://theathletic.com/foo'))"` 输出 `1`

- [X] T005 [P] [US1] Create `src/source-tiers.json` with domain→tier mappings per `specs/001-expand-search-sources/data-model.md`
- [X] T006 [P] [US1] Create `src/tiers.js` — export `getTier(url)` that parses hostname from url, matches against `source-tiers.json`, returns integer 0-3 or `null` if unknown

---

## Phase 4: US2 — RSS Fetching Module

**Goal**: 可独立运行的 RSS 采集模块，按给定 source 列表并行拉取  
**Independent test**: `node -e "const r = require('./src/rss'); r.fetchRssFeeds([{rss_url:'https://feeds.bbci.co.uk/sport/football/rss.xml', source_name:'BBC Sport', tier:1}]).then(console.log)"` 返回至少1条条目

- [X] T007 [US2] Create `src/rss.js` — export `fetchRssFeeds(sources)` where `sources` is array of `{rss_url, source_name, tier, enabled}`:
  - Use `rss-parser` to fetch each URL
  - Return array of `{title, url, snippet, publishedAt, source_name, tier}`
  - 2-second delay between requests (sequential, not parallel) to avoid rate limits
  - Catch per-feed errors silently, log `[RSS] 跳过 {source_name}: {err.message}` and continue
  - Deduplicate by URL within RSS results (keep first seen)

---

## Phase 5: US3 — Store Layer: loadKeywordSources

**Goal**: 从 Supabase 读取关键词的 RSS 绑定  
**Independent test**: Insert test row per quickstart.md Step 2, then `node -e "require('./src/store').loadKeywordSources('manchester-united').then(console.log)"` 返回数组含 BBC Sport

- [X] T008 [US3] Update `src/store.js` — add `loadKeywordSources(keywordId)`:
  - Query `keyword_sources` WHERE `keyword_id = keywordId AND enabled = true`
  - Return array of `{rss_url, source_name, tier}`
  - Return `[]` if no rows (triggers backward-compat path)

---

## Phase 6: US4 — Search Pipeline Merge

**Goal**: searchAll() 在有 RSS 绑定时并行拉取 RSS，结果合并去重  
**Independent test**: With sources array populated, `searchAll('Manchester United', sources)` returns items with `tier` field populated

- [X] T009 [US4] Update `src/search.js` — change signature to `searchAll(query, keywordSources = [])`:
  - Run `fetchRssFeeds(keywordSources)` and existing `searchAll` logic **in parallel** via `Promise.allSettled`
  - For existing Google News / HackerNews results: call `getTier(item.url)` to attach `tier` field (null if unknown)
  - Merge both result arrays, deduplicate by URL — for same URL keep the entry with lower tier number (higher trust)
  - Backward compat: `keywordSources = []` → behavior identical to current (no RSS fetch)
- [X] T010 [P] [US4] Update `src/search.js` imports — add `require('./rss')` and `require('./tiers')`

---

## Phase 7: US5 — AI Scoring with Tier

**Goal**: analyzeResult 接收 tier 参数，prompt 按可信度调整评分标准  
**Independent test**: Call `analyzeResult('Manchester United', 'Transfer rumour', '...', 3)` and verify score is lower than same call with tier=1

- [X] T011 [US5] Update `src/ai.js` — change `analyzeResult(query, title, snippet)` signature to `analyzeResult(query, title, snippet, tier = null)`:
  - Build tier hint string: tier 0/1 → `"来源为顶级可信媒体，评分可相对宽松"`, tier 3 → `"来源为低可信小报，对标题党和捕风捉影内容主动降分"`, null → no hint
  - Inject tier hint into existing DeepSeek prompt before the scoring instruction

---

## Phase 8: Pipeline Wiring

**Goal**: 将所有模块串联进 index.js 主循环，saveArticles 写入 source_tier  
**Independent test**: `node src/index.js` 完整运行，曼联关键词日志出现 `[RSS]` 行，articles 表新增记录 source_tier 不为 NULL

- [X] T012 Update `src/index.js` — in the per-keyword loop:
  - After loading keyword, call `await loadKeywordSources(keyword.id)` from `src/store.js`
  - Pass returned sources as second arg to `searchAll(query, sources)`
- [X] T013 Update `src/store.js` — in `saveArticles` (or equivalent insert logic):
  - Map `article.tier` → `source_tier` column on each inserted row
  - `source_tier` may be `null` for results from searchAll() with no tier info

---

## Phase 9: Polish

**Goal**: 端到端验证 + 可选前端展示

- [ ] T014 Insert test data per `specs/001-expand-search-sources/quickstart.md` Step 2 and run full validation (Steps 3-5)
- [X] T015 [P] Update `client/src/components/ArticleCard.tsx` — show `source_tier` badge (e.g. "T1", "T2") next to source name when `article.source_tier` is not null (optional, low-priority cosmetic)

---

---

## Phase 10: Convergence

- [X] T016 Add `source` field (slugified `source_name`) to items returned by `fetchRssFeeds` in `src/rss.js` per FR-05 / CHECKLIST Phase 9 (partial)

---

## Implementation Strategy

**MVP scope (run in order)**:  
T001 → T002 → T003 → T004 → T005 → T006 → T007 → T008 → T009 → T010 → T011 → T012 → T013 → T014

T015 is optional frontend polish, independent of backend.

**Parallelizable within phases**:  
- T005 + T006 can run simultaneously (different new files)  
- T010 is a 2-line import change, can be done while writing T009

**Estimated session breakdown**:  
- Session A (backend core): T001–T011 (~2-3 hours)  
- Session B (wiring + validation): T012–T014 (~1 hour)  
- Session C (optional): T015
