# Research: 信息源可信度分级与按关键词定向采集

**Created**: 2026-08-02

---

## Decision 1: RSS 解析库

**Decision**: 使用 `rss-parser` npm 包  
**Rationale**: 原生支持 RSS 2.0 + Atom 1.0，单次 `await parser.parseURL(url)` 直接得到结构化对象，无需手写 cheerio XML 解析。体积小，维护活跃。  
**Alternatives considered**: `axios + cheerio` 手解 XML（现有模式，但 RSS 有标准库直接搞定无需手写）、`feedparser`（功能更重，本项目不需要流式解析）

---

## Decision 2: keyword_sources 查询时机

**Decision**: 在 `store.js` 中新增 `loadKeywordSources(keywordId)`，在 index.js 主循环里每个关键词处理前调用，结果传入 `searchAll()`  
**Rationale**: 与现有 `loadKeywords()` 模式一致，单次 DB 查询，不改变 pipeline 调度结构  
**Alternatives considered**: 在 `loadKeywords()` 里 JOIN 带出来（多了 N×M 数据量，关键词多时不必要）

---

## Decision 3: source_tier 计算位置

**Decision**: 在 `search.js` / `rss.js` 结果拼装时，通过 `source-tiers.json` 查域名得 tier，结果对象直接带 `tier` 字段；`ai.js` 接收该字段并传入 prompt  
**Rationale**: tier 是来源属性，在采集层就确定，不需要 AI 层重新判断。AI prompt 只接收已计算好的等级作为 context hint  
**Alternatives considered**: 在 ai.js 里让 AI 自判来源可信度（成本高、不稳定）

---

## Decision 4: Firecrawl 使用场景

**Decision**: 仅在 RSS feed URL 返回非标准 XML（如返回 HTML 页面、需要 JS 渲染）时作为备用通道调用 Firecrawl MCP  
**Rationale**: 大多数标准 RSS feed 用 axios 直拉即可；Firecrawl 保留给 The Athletic 等可能需要认证/渲染的特殊来源  
**Alternatives considered**: 所有来源都走 Firecrawl（成本高、速度慢、没必要）
