# PLAN: 曼联信源监控 — 方案A落地执行计划

> 创建: 2026-08-03 ｜ 范围: spec-001（Tier 基础）+ spec-002（Firecrawl 抓取）收尾 + 冗余清理

---

## 当前状态总览

| 模块 | 状态 | 备注 |
|------|------|------|
| `keyword_sources` 表 | ✅ 已创建，`scrape_url` + `fetch_type` 字段已有 | Supabase 迁移完成 |
| `articles.source_tier` 列 | ✅ 已添加 | nullable integer (0-3) |
| `src/source-tiers.json` | ✅ 15 个域名映射 | Tier 0-3 |
| `src/tiers.js` | ✅ `getTier(url)` 工具函数 | |
| `src/firecrawl.js` | ✅ `fetchFirecrawlSources()` | 串行抓取 + 2s 间隔 + 重试 |
| `src/search.js` | ✅ `searchAll()` | Google News 已移除，保留 HackerNews + RSS + Firecrawl |
| `src/store.js` | ✅ `loadKeywordSources()` | 按 fetch_type 加载 |
| `src/ai.js` | ✅ `analyzeResult(tier)` | Tier 影响评分 |
| `src/index.js` | ✅ pipeline 集成 | tier → source_tier 写入 |
| 前端 Tier 筛选 | ✅ FilterSortBar + ArticleCard | T0-T3 徽章 |
| `FIRECRAWL_API_KEY` | ✅ 已配置 `.env` | HTTP 200 验证通过 |
| Supabase MU 信源 | ✅ 2 条（BBC, MEN），均为 firecrawl | scrape_url 已填 |

---

## 执行步骤

### Phase 1: 端到端验证（阻塞解除）

- [ ] **P1-1** 运行 `node src/index.js`，验证 Manchester United 管线
  - 期望：日志出现 `[Firecrawl] 抓取 BBC Sport MU: 找到 X 条`
  - 期望：无 ETIMEDOUT / 404 错误
  - 期望：Supabase `articles` 表新增记录 `source_tier` 不为 NULL

- [ ] **P1-2** 如 BBC/MEN 页面 403/超时 → 尝试其他信源 URL 或调整 Firecrawl 参数
- [ ] **P1-3** 如 Firecrawl 返回空 → 检查 extract schema prompt 是否适配目标页面结构

### Phase 2: 冗余清理（代码精简）

- [ ] **P2-1** 删除 `src/rss.js` — 当前无任何 keyword_source 使用 fetch_type='rss'，且 RSS 普遍失效
- [ ] **P2-2** 删除 `src/search.js` 中的 `fetchRssFeeds` import 及相关分支
- [ ] **P2-3** 删除 `src/scraper.js` / `src/reader.js` — blog 类型仅 claude-blog 使用，且 claude-blog 独立管线不依赖这两个文件（确认后决定）
- [ ] **P2-4** 删除 `package.json` 中 `rss-parser` 依赖
- [ ] **P2-5** 删除 `keywords.json`（已弃用）
- [ ] **P2-6** 代码安全检查：`node --check src/*.js` 全部通过

### Phase 3: 文档 + 标记闭环

- [ ] **P3-1** 更新 `docs/PROGRESS.md` — spec-001/002 标记完成，记录遗留
- [ ] **P3-2** 更新 `DOCUMENT_MAP.md` — 删除 rss.js 引用
- [ ] **P3-3** 更新 `CLAUDE.md` — 移除 RSS 相关陷阱

### Phase 4: 前端验收

- [ ] **P4-1** 启动前端: `cd client && npm run dev`
- [ ] **P4-2** 验证 Manchester United 文章卡片显示 Tier 徽章
- [ ] **P4-3** 验证 Tier 筛选功能正常
- [ ] **P4-4** 验证无回归：Anthropic / Claude Blog 正常展示

---

## 最终交付物（给你的验收材料）

运行后你会得到：

1. **终端日志截图/输出** — `node src/index.js` 完整运行结果，关键看 Manchester United 段是否有 Firecrawl 抓取成功的日志行
2. **Supabase 数据截图** — `articles` 表 `WHERE keyword_id='manchester-united' ORDER BY created_at DESC LIMIT 10`，确认 `source_tier` 不为 NULL
3. **前端截图** — 浏览器 `localhost:5173` 下 Manchester United 视图，确认文章卡片右上角有 Tier 徽章
4. **Markdown 日报** — `reports/` 目录下当日报告文件
5. **验证清单打勾表** — 下面这个 checklist 逐项 ✅ 或 ❌
