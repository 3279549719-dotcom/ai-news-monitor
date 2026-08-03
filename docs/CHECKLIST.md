# Checklist: Feature 001 — 信息源可信度分级与按关键词定向采集

验收清单，按开发顺序排列，每个模块完成后立即勾选对应项。最后执行集成与端到端验证。

---

## Phase 1: 环境 & 依赖

- [x] `rss-parser` 出现在 `package.json` dependencies（非 devDependencies）
- [x] `node -e "require('rss-parser'); console.log('ok')"` 在项目根目录输出 `ok`，无报错

---

## Phase 2: 数据库 Migration

**验证方式**: Supabase Dashboard → Table Editor 或 SQL Editor

- [x] `keyword_sources` 表存在于 public schema
- [x] `keyword_sources` 含字段：id (uuid), keyword_id (text), rss_url (text), source_name (text), tier (integer), enabled (boolean), created_at (timestamptz)
- [x] `UNIQUE (keyword_id, rss_url)` 约束存在
- [x] `keyword_sources_keyword_id_idx` 索引存在
- [x] `keyword_id` 外键指向 `keywords(id) ON DELETE CASCADE`
- [x] `articles` 表含 `source_tier` 列（integer, nullable）
- [x] `source_tier` 有 `CHECK (source_tier BETWEEN 0 AND 3)` 约束
- [x] 现有 `articles` 记录 `source_tier` 全为 NULL（migration 无破坏性）

**边界测试**:
- [ ] 插入 `tier = 4` → 报 CHECK constraint violation
- [ ] 插入重复 `(keyword_id, rss_url)` → 报 UNIQUE constraint violation
- [ ] 删除 `keywords` 某条记录 → 对应 `keyword_sources` 行自动级联删除（CASCADE 生效）

---

## Phase 3: src/source-tiers.json + src/tiers.js

**验证方式**: `node -e "..."` 在项目根目录执行

- [x] `src/source-tiers.json` 存在，是合法 JSON
- [x] 含域名：`manutd.com`→0, `theathletic.com`→1, `bbc.co.uk`→1, `manchestereveningnews.co.uk`→1, `skysports.com`→2, `thesun.co.uk`→3, `dailymail.co.uk`→3
- [x] `src/tiers.js` 导出 `getTier(url)` 函数
- [x] `getTier('https://theathletic.com/article/123')` → `1`
- [x] `getTier('https://www.bbc.co.uk/sport/football')` → `1`（含 www 前缀正常匹配）
- [x] `getTier('https://thesun.co.uk/sport/foo')` → `3`
- [x] `getTier('https://unknown-blog.com/post')` → `null`
- [x] `getTier('')` → `null`（不崩溃）
- [x] `getTier(null)` → `null`（不崩溃）

---

## Phase 4: src/rss.js

**验证方式**: `node -e "require('./src/rss').fetchRssFeeds([...]).then(console.log)"`

- [x] `src/rss.js` 导出 `fetchRssFeeds(sources)` 函数
- [x] 传入 BBC Sport RSS → 返回数组，每项含 `title`, `url`, `snippet`, `publishedAt`, `source_name`, `tier`
- [x] `publishedAt` 为 Date 对象或 ISO 字符串（非 undefined）
- [x] `source_name` 和 `tier` 来自输入参数（透传，不重新计算）
- [x] 传入 `[]` → 返回 `[]`，不报错
- [x] `enabled: false` 的 source → 跳过，不发请求
- [x] 同一 RSS 响应中重复 URL → 只保留一条

**边界条件**:
- [ ] 无效/不可达 URL → 静默跳过，日志含 `[RSS] 跳过`，其余源继续
- [ ] URL 返回 HTML 而非 XML → 静默跳过，不崩溃
- [ ] RSS 条目无 pubDate → `publishedAt` 兜底为当前时间（非 undefined/null）
- [ ] 多个 source 时，请求间有 ≥2s 延迟（观察日志时间戳）

---

## Phase 5: src/store.js — loadKeywordSources

**前置**: Phase 2 migration 完成 + quickstart.md Step 2 测试数据已插入

- [x] `loadKeywordSources(keywordId)` 在 `src/store.js` 中 export
- [x] 对已绑定 RSS 的 keyword_id → 返回含 `rss_url`, `source_name`, `tier` 的数组
- [x] 对未绑定 RSS 的 keyword_id → 返回 `[]`
- [x] `enabled = false` 的行不出现在结果中
- [x] 函数不报错、不崩溃

---

## Phase 6: src/search.js — 合并 RSS + searchAll

- [x] 函数签名为 `searchAll(query, keywordSources = [])`
- [x] `keywordSources = []` 时行为与改动前完全一致（向后兼容）
- [x] 传入非空 `keywordSources` → RSS 与 Google News/HN 查询**并行**（Promise.allSettled）
- [x] 合并结果每条含 `tier` 字段（RSS 透传，searchAll 结果用 `getTier(url)` 计算）
- [x] 重复 URL → 只保留一条，保留 tier 数字更小的（更可信来源优先）
- [x] 某路 Promise reject → 另一路结果仍正常返回

---

## Phase 7: src/ai.js — Tier 感知评分

- [x] 函数签名为 `analyzeResult(query, title, snippet, tier = null)`
- [x] `tier = null` 时 prompt 与改动前完全一致（向后兼容）
- [x] `tier = 0/1` 时 prompt 含宽松评分提示
- [x] `tier = 3` 时 prompt 含严格/降分提示
- [ ] 相同标题+摘要，tier=1 的 score ≥ tier=3 的 score

---

## Phase 8: 主流程串联（src/index.js + store.js saveArticles）

- [x] `index.js` 关键词循环内调用 `await loadKeywordSources(keyword.id)`
- [x] `loadKeywordSources` 结果作为第二参数传入 `searchAll`
- [x] `saveArticles`（或等效插入逻辑）将 `result.tier` 写入 `articles.source_tier`
- [x] `node src/index.js` 完整运行，无未捕获异常
- [x] 日志中可见 `[RSS]` 相关输出（对已绑定 RSS 的关键词）— `[RSS] 跳过 BBC Sport: connect ETIMEDOUT`
- [x] 无 RSS 绑定的关键词正常运行，无报错

---

## Phase 9: 集成验证（quickstart.md Steps 3-5）

**前置**: quickstart.md Step 2 测试数据已插入（曼联 BBC Sport + MEN 绑定）

### 正向路径

- [ ] `articles` 表出现 `source` 为 `bbc-sport` 或 `manchester-evening-news` 的记录
- [ ] 上述记录 `source_tier = 1`（非 NULL）
- [ ] 上述记录 `score ≥ 60`
- [ ] quickstart Step 4 SQL 查询中无 `thesun.co.uk` / `dailymail.co.uk` 来源

### 向后兼容

- [x] 无 RSS 绑定的关键词运行后 `articles` 有新记录，`source_tier = NULL`（SQL 已确认）
- [x] migration 前入库的旧记录 `source_tier` 仍为 NULL（无数据破坏）

### 边界场景

- [ ] 将某条 `keyword_sources.enabled` 改为 `false` → 下次运行该 RSS 不被拉取
- [ ] 填入一个失效的 RSS URL → 运行不崩溃，其余源正常，日志有跳过提示
- [ ] 同一条新闻同时出现在 BBC Sport RSS 和 Google News → `articles` 中只有一条记录

---

## 前端（可选，T015）

- [x] `ArticleCard` 在 `source_tier` 非 null 时显示 tier badge（如 T0 / T1 / T2 / T3）
- [x] `source_tier = null` 时无 badge，无报错，显示与之前一致
- [x] `npm run type-check` 无错误
- [ ] `npm run lint` 无新增警告

---

## 最终验收标准（来自 spec.md Success Criteria）

- [ ] 曼联关键词绑定 BBC Sport + MEN RSS 后，采集结果中太阳报/每日邮报类条目占比 = 0
- [ ] 同一标题，来自 `theathletic.com` 的 AI 评分 ≥ 来自 `thesun.co.uk` 的评分（Tier 加权有效）
- [ ] 已绑定定向 RSS 与未绑定的关键词，`articles` 来源质量可见差异
- [ ] RSS 采集某源失败不影响其他关键词正常运行
- [ ] 旧有 `search` 类型关键词（无 RSS 绑定）行为 100% 不变
