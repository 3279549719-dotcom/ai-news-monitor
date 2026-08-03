# Acceptance Checklist: Firecrawl 直抓 + Tier 分级展示

**Purpose**: 验收 spec-002 需求文档质量（非实现验证）  
**Created**: 2026-08-02  
**Focus**: 需求完整性 · 清晰度 · 一致性 · 边界覆盖  
**Depth**: Release Gate  

---

## Requirement Completeness（需求完整性）

- [ ] CHK001 - FR-001 是否明确定义了 Firecrawl API 调用的完整请求格式（endpoint、method、headers、body schema）？ [Completeness, Spec §FR-001]
- [ ] CHK002 - FR-001 的"每次抓取返回"字段列表（title、URL、snippet、publishedAt、source_name）是否在 data-model.md 中标注了各字段的类型与允许为空的条件？ [Completeness, data-model.md]
- [x] CHK003 - 是否为 `fetchFirecrawlSources` 定义了超时时间和最大重试次数？ [Gap, Spec §FR-001] → **已确认：重试 2 次（research.md Decision 6）**
- [ ] CHK004 - FR-002 是否指定了 `keyword_sources.tier` 的取值范围（0-3）及各等级的语义？ [Completeness, Spec §FR-002]
- [ ] CHK005 - FR-004 是否明确列出了前端 Tier 筛选的所有可选项（如"全部 / T0 / T1 / T2 / T3"）？ [Completeness, Spec §FR-004]
- [ ] CHK006 - `keyword_sources` DB 迁移是否涵盖存量数据的默认值处理（`fetch_type DEFAULT 'rss'`、`scrape_url NULL`）？ [Completeness, data-model.md]
- [ ] CHK007 - tasks.md 是否包含将 Manchester United 现有行从 RSS 切换到 Firecrawl 的具体 SQL（T007/T008）？ [Completeness, tasks.md]

---

## Requirement Clarity（需求清晰度）

- [ ] CHK008 - FR-001 中"正文摘要"（snippet）的最大字符数是否有明确限制（当前 rss.js 截取 300 字符，Firecrawl 模块是否保持一致）？ [Clarity, Spec §FR-001]
- [x] CHK009 - FR-005"替代旧搜索机制"的范围是否明确：是仅替换 Google News RSS，还是同时替换 HackerNews 搜索？ [Clarity, Spec §FR-005] → **已确认：仅移除 `searchGoogleNews()`，`searchHackerNews()` 保留（research.md Decision 4）**
- [ ] CHK010 - FR-004"前端 Tier 展示"是否定义了 Tier 徽章的视觉呈现方式（颜色、标签文案、位置）？ [Clarity, Spec §FR-004]
- [ ] CHK011 - `fetch_type` 字段的 CHECK 约束（`'rss' | 'firecrawl'`）是否在 data-model.md 中明确标注，防止实现时遗漏？ [Clarity, data-model.md]
- [ ] CHK012 - Firecrawl extract schema 中 `publishedDate` 字段格式（ISO、本地时间、unix 时间戳）是否有明确约定？ [Clarity, data-model.md]

---

## Requirement Consistency（需求一致性）

- [ ] CHK013 - FR-003 的评分阈值（score ≥ 60）是否与 spec.md、research.md、tasks.md、quickstart.md 保持一致，无分歧？ [Consistency, Spec §FR-003]
- [ ] CHK014 - `fetchFirecrawlSources` 的返回格式是否与 `fetchRssFeeds` 完全一致（字段名、类型、空值处理），确保 `searchAll` 合并时无隐患？ [Consistency, data-model.md]
- [ ] CHK015 - tasks.md T004（store.js 更新）的新 select 字段列表是否与 data-model.md 中 `keyword_sources` 的变更保持同步？ [Consistency, tasks.md]
- [ ] CHK016 - FR-002 中"AI 评分时接收 Tier 信息"是否与现有 `analyzeResult(query, title, snippet, tier)` 的签名一致，无需变更 `src/ai.js`？ [Consistency, Spec §FR-002]

---

## Scenario Coverage（场景覆盖）

- [ ] CHK017 - 是否定义了 `FIRECRAWL_API_KEY` 未设置时的行为（跳过 firecrawl 源 + 警告日志，不中断 pipeline）？ [Coverage, Spec §FR-001]
- [ ] CHK018 - 是否定义了 Firecrawl API 返回空 `articles` 数组时的处理（不报错、不入库、继续处理其他源）？ [Coverage, Edge Case, Spec §FR-001]
- [ ] CHK019 - 是否定义了 Firecrawl 抓取的文章 URL 与 RSS/Google News 结果重复时的去重规则（已在 `deduplicateByUrl` 中，FR 层是否明确引用）？ [Coverage, Spec §FR-001]
- [ ] CHK020 - 是否定义了 `source_tier` 为 NULL 时前端的展示行为（不显示徽章还是显示"未知"）？ [Coverage, Edge Case, Spec §FR-004]
- [ ] CHK021 - 是否定义了某关键词在 `keyword_sources` 中所有 firecrawl 源均抓取失败时的行为（fallback 到 Google News 还是空结果）？ [Coverage, Exception Flow, Spec §FR-001]

---

## Non-Functional Requirements（非功能需求）

- [ ] CHK022 - spec-002 是否继承了 spec-001 的"单次 pipeline 运行时间 < 5 分钟"成功标准，并评估 Firecrawl 串行调用对时间的影响？ [Performance, Spec §Success Criteria]
- [ ] CHK023 - 是否定义了 Firecrawl API 的请求间隔（当前 research.md 为 2s 串行），与 RSS 模块保持一致还是允许并行？ [Performance, research.md]
- [ ] CHK024 - `FIRECRAWL_API_KEY` 是否在文档中明确标注为必须加入 `.env`（而非 `.env.example` 或版本控制）？ [Security, Spec §Assumptions]

---

## Dependencies & Assumptions（依赖与前提）

- [ ] CHK025 - 是否明确标注 `axios` 已在 `package.json` 中（T003 验证逻辑），避免实现时重复安装或引入新版本冲突？ [Dependency, tasks.md §T003]
- [x] CHK026 - Firecrawl `extract` 模式是否在 Assumptions 中说明该功能依赖 Firecrawl 付费计划（部分免费层不支持 LLM extraction）？ [Assumption, research.md] → **已确认：免费额度够用**
- [ ] CHK027 - Manchester United 的 scrape_url（BBC Sport + MEN 页面 URL）是否经过实际可访问性确认，或标注为"实施时需验证"？ [Assumption, data-model.md]

---

## Traceability（可追溯性）

- [ ] CHK028 - tasks.md 的每个 Phase 是否能追溯到 spec.md 中对应的 FR 编号（T001-T002 → FR-001, T009-T011 → FR-004 等）？ [Traceability]
- [ ] CHK029 - quickstart.md 的5个验证步骤是否与 tasks.md 的 T012-T014 验证任务一一对应，无遗漏？ [Traceability, quickstart.md]
