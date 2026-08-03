# Research: Firecrawl 直抓 + Tier 分级

**Feature**: 002-firecrawl-mcp-tiered-fetch  
**Date**: 2026-08-02

---

## 技术决策

### Decision 1: Firecrawl 调用方式

**Decision**: Node.js 后端直接调用 Firecrawl REST API（`POST https://api.firecrawl.dev/v1/scrape`）

**Rationale**: Claude MCP 工具（`firecrawl:firecrawl-scrape` 等）在开发期间可供 Agent 使用，但 Node.js 运行时无法调用 MCP 工具。后端 pipeline 需要独立运行，因此必须使用 Firecrawl HTTP API。

**Alternatives considered**:
- 使用 `@mendable/firecrawl-js` SDK：增加依赖，但封装更友好
- 使用 `axios` 直接调用：无额外依赖，够用，选此方案

---

### Decision 2: `keyword_sources` 表扩展方式

**Decision**: 新增 `scrape_url TEXT` + `fetch_type TEXT DEFAULT 'rss'`，保留 `rss_url`

**Rationale**: 现有 RSS 源（Claude Blog等）不需要改动。通过 `fetch_type` 区分采集方式，向后兼容，Manchester United 两个失效源可单独切换为 `firecrawl`。

**Schema change**:
```sql
ALTER TABLE keyword_sources ADD COLUMN scrape_url TEXT;
ALTER TABLE keyword_sources ADD COLUMN fetch_type TEXT NOT NULL DEFAULT 'rss'
  CHECK (fetch_type IN ('rss', 'firecrawl'));
```

**Alternatives considered**:
- 合并为单一 `url` 字段 + 改名：会破坏现有 RSS 查询逻辑

---

### Decision 3: Firecrawl 抓取模式

**Decision**: `POST /v1/scrape` with `formats: ['extract']` + extraction schema

**Rationale**: 针对新闻列表页（如 BBC Sport MU 专区、MEN MU 页面），Firecrawl 的 `extract` 模式可直接通过 LLM schema 提取结构化文章数据（title + url + publishedDate），无需手动解析 markdown 或 HTML。

**Request format**:
```json
{
  "url": "<source.scrape_url>",
  "formats": ["extract"],
  "extract": {
    "prompt": "Extract all news article items from this page",
    "schema": {
      "type": "object",
      "properties": {
        "articles": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "title": { "type": "string" },
              "url": { "type": "string" },
              "publishedDate": { "type": "string" }
            }
          }
        }
      }
    }
  }
}
```

**Alternatives considered**:
- `formats: ['links']`：返回纯链接列表，无标题，需再次请求每条链接才能获取标题
- `formats: ['markdown']`：需正则解析，不稳定

---

### Decision 4: 替换 Google News 还是并行

**Decision**: 完全移除 `searchGoogleNews()`，HackerNews 保留不变

**Rationale**: spec Success Criteria 明确要求"抓取结果 100% 来自用户指定信源，无 Google News 聚合内容混入"。FR-005 仅针对 `src/search.js` 中的 `searchGoogleNews()` 函数（Google News RSS 聚合搜索）；`searchHackerNews()` 不在替换范围内，继续服务 AI/科技类关键词。

**Scope confirmed**: FR-005 = 删除 `searchGoogleNews()` 调用。HackerNews 不动。

---

### Decision 5: FIRECRAWL_API_KEY 环境变量

**Decision**: 新增 `FIRECRAWL_API_KEY` 环境变量，在 `src/firecrawl.js` 初始化时验证

**Rationale**: Firecrawl 是付费 API，密钥不能硬编码。若未设置，对 `fetch_type=firecrawl` 的源输出警告并跳过，不中断整个 pipeline。

---

### Decision 6: Firecrawl API 重试策略

**Decision**: 单次请求失败后重试 **2 次**，超出后跳过该源并记录日志

**Rationale**: 用户确认。与 RSS 的单次失败即跳过策略一致，避免重试过多导致 pipeline 超时（5 分钟上限）。

---

## 未解决项（无）

所有技术选型已确定。无 NEEDS CLARIFICATION 遗留。
