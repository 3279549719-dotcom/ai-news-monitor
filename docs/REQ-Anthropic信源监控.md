# REQ: Anthropic 信源监控需求文档

> 状态: Draft ｜ 创建: 2026-08-04 ｜ 参考: docs/REQ-曼联信源监控.md（MU 模式）
> 说明：复用 MU 已验证的白名单前置准入 + crawl4ai 抓取 + AI 评分交叉验证架构，arg Anthropic（AI 公司）场景。claude-blog 关键词并入本需求后下线。

---

## 一、项目目标

为 `anthropic` 关键词建立白名单信源监控，自动抓取 Anthropic 公司相关新闻和研究进展，AI 评分过滤后入库，前端与其他关键词统一展示。

**定位：** 与 MU 共享同一套 pipeline（search 类型），只扩展信源配置 + 域名映射 + 分类模板。

**claude-blog 合并：** 原 `claude-blog` 关键词（blog 类型，cheerio 抓 claude.com/blog）停用。Anthropic 官方内容由 T0 信源 `anthropic.com/news` + `anthropic.com/research` 覆盖，走 crawl4ai 统一通道。

---

## 二、核心设计原则（复用 MU 模式）

- **白名单前置准入：** 只从 keyword_sources 表中配置的 T0/T1 信源抓取，T3/T4 不存在
- **HackerNews 不兜底：** 白名单覆盖足够，与 MU 保持一致（有白名单就不走 HN）
- **crawl4ai 主通道 + scraper-direct 降级：** 复用 MU 已验证的双通道架构
- **不引入 RSS/Google News/ArXiv API：** 保持架构简单，信源统一走 crawl4ai 页面抓取

---

## 三、信源可信度 Tier 分级（Anthropic 场景适配）

与足球场景不同，AI 公司没有"跟队记者爆料"文化。Tier 模型简化：

| Tier | 权重 | 类型 | 说明 |
|------|------|------|------|
| **Tier 0** | 10 | 官方信源 | Anthropic 自己的 Newsroom + Research Blog。任何外部报道与 T0 冲突以 T0 为准 |
| **Tier 1** | 8 | 顶级科技媒体 | 有 Anthropic 专属 tag 页的主流科技媒体，定向抓取 |

AI 公司场景不需要 T2（综合媒体冗余大，T1 已覆盖主要科技媒体）。

---

## 四、信源资产（Source Map）

### 4.1 生产白名单（6 源二 tier）

| 信源 | 抓取页面 | Tier | 实测 | 备注 |
|------|---------|------|------|------|
| Anthropic News | `anthropic.com/news` | 0 | crawl4ai ✓ | 公司公告：产品发布/合作/政策，~16 篇/月 |
| Anthropic Research | `anthropic.com/research` | 0 | crawl4ai ✓ | 研究论文，5 个团队板块，~11 篇/月 |
| Claude Blog | `claude.com/blog` | 0 | crawl4ai ✓ (Node 超时) | 产品实践：MCP、prompt engineering、Claude 使用技巧，~90 链接 |
| TechCrunch | `techcrunch.com/tag/anthropic/` | 1 | crawl4ai ✓ + Node ✓ | 最主流科技媒体 Anthropic 专页，~145 条链接 |
| VentureBeat | `venturebeat.com/tag/anthropic/` | 1 | crawl4ai ✓ (Node 429) | 企业 IT/AI 视角，~102 条链接，仅 crawl4ai 通道 |
| Wired | `wired.com/tag/anthropic/` | 1 | crawl4ai ✓ + Node ✓ | 深度分析+调查报道，~57 条链接 |

### 4.2 已验证不可用（排除）

| 源 | 原因 |
|---|---|
| Ars Technica (`arstechnica.com/tag/anthropic/`) | JS challenge wall，crawl4ai 和 Node 均不可达 |
| ZDNet (`zdnet.com/topic/anthropic/`) | URL 404，无有效 Anthropic 专题页 |
| The Verge (`theverge.com/ai-artificial-intelligence`) | 全 AI 板块非 Anthropic 专属，信噪比太低 |
| claude.com/blog (Node 直连) | 超时，但 **crawl4ai 容器可达** ✅，已纳入 T0 |

### 4.3 远期候选（本轮不接入，已调研备用）

| 源 | URL | 状态 |
|---|---|---|
| The Verge Anthropic | `theverge.com/anthropic` | 独立页面存在（HTTP 200），未测 crawl4ai |
| SiliconANGLE | `siliconangle.com/tag/anthropic/` | HTTP 200，未测 crawl4ai |
| The Register | `theregister.com/Tag/anthropic/` | HTTP 200，未测 crawl4ai |
| Simon Willison | `simonwillison.net/tags/anthropic/` | 独立博主，HTTP 200 |
| ImportAI (Jack Clark) | `importai.net/` | Anthropic 联创的 newsletter，HTTP 200 |
| ArXiv | `arxiv.org/search/?query=Anthropic` | 论文数据库，API 可用 |

> 远期候选在需要扩展覆盖面时优先测试 crawl4ai 可达性，通过后按白名单流程加入。

---

## 五、抓取通道

复用 MU 已验证架构，不做改动：

```
crawl4ai 容器 (localhost:11235)
  → 成功：提取文章链接 → toItem 规整
  → 失败/空结果：自动降级 scraper-direct.js (axios + DeepSeek)
  → VentureBeat 不降级（Node 429 限流，crawl4ai 失败直接跳过）
```

### 5.1 Anthropic 专属 ARTICLE_PATTERNS

需要在 `src/crawl4ai-fetch.js` 的 `ARTICLE_PATTERNS` 中新增：

```js
// Anthropic 信源文章 URL 模式
{ host: 'anthropic.com', re: /\/(news|research)\// },
{ host: 'claude.com', re: /\/blog\// },
{ host: 'techcrunch.com', re: /\/20\d\d\/\d+\// },
{ host: 'venturebeat.com', re: /\/(technology|ai|business)\// },
{ host: 'wired.com', re: /\/story\// },
```

---

## 六、数据变更清单

### 6.1 Supabase keyword_sources 新增

```sql
-- 停用 claude-blog 关键词
UPDATE keywords SET enabled = false WHERE id = 'claude-blog';

-- 新增 Anthropic T0 信源
INSERT INTO keyword_sources (keyword_id, source_name, scrape_url, tier, fetch_type, enabled, rss_url)
VALUES
  ('anthropic', 'Anthropic News', 'https://www.anthropic.com/news', 0, 'firecrawl', true, 'https://www.anthropic.com/news'),
  ('anthropic', 'Anthropic Research', 'https://www.anthropic.com/research', 0, 'firecrawl', true, 'https://www.anthropic.com/research'),
  ('anthropic', 'Claude Blog', 'https://claude.com/blog', 0, 'firecrawl', true, 'https://claude.com/blog'),
  ('anthropic', 'TechCrunch', 'https://techcrunch.com/tag/anthropic/', 1, 'firecrawl', true, 'https://techcrunch.com/tag/anthropic/'),
  ('anthropic', 'VentureBeat', 'https://venturebeat.com/tag/anthropic/', 1, 'firecrawl', true, 'https://venturebeat.com/tag/anthropic/'),
  ('anthropic', 'Wired', 'https://www.wired.com/tag/anthropic/', 1, 'firecrawl', true, 'https://www.wired.com/tag/anthropic/');
```

### 6.2 source-tiers.json 新增域名

```json
{
  "anthropic.com": 0,
  "claude.com": 0,
  "techcrunch.com": 1,
  "venturebeat.com": 1,
  "wired.com": 1
}
```

### 6.3 keywords 表 Anthropic 分类模板

```sql
UPDATE keywords
SET category_schema = '["official","product","research","partnership","policy","funding","other"]'::jsonb
WHERE id = 'anthropic';
```

Anthropic 专属 7 类（vs MU 的 8 类足球模板）：

| 分类 | 说明 |
|------|------|
| official | Anthropic 官方公告/声明（T0 内容） |
| product | Claude 产品发布/功能更新/性能对比 |
| research | 研究论文/技术发现/安全研究 |
| partnership | 云合作/企业集成/战略联盟 |
| policy | AI 监管/政策/治理/安全框架 |
| funding | 融资/估值/投资者关系 |
| other | 其他 |

---

## 七、Pipeline 影响（代码改动范围）

| 模块 | 改动 | 工作量 |
|------|------|--------|
| `src/crawl4ai-fetch.js` | 新增 4 组 ARTICLE_PATTERNS | ~10 行 |
| `src/source-tiers.json` | 新增 4 条域名映射 | ~4 行 |
| Supabase | 停用 claude-blog + 新增 5 条 keyword_sources + 更新 category_schema | SQL 一次性执行 |
| `src/search.js` | **不改**（已有白名单逻辑自动生效） | 0 |
| `src/index.js` | **不改**（pipeline 读 keywords 表自动发现） | 0 |
| `src/ai.js` | **不改**（分类模板由 category_schema 驱动） | 0 |
| 前端 | **不改**（关键词 Tab 自动发现，通用分类渲染） | 0 |

---

## 八、验收标准

1. `node src/index.js` 运行，anthropic 关键词产出 ≥1 篇相关文章入库（score ≥ 60）
2. clog 中出现 crawl4ai 抓取成功日志（T0 anthropic.com + T1 三家媒体）
3. Supabase `articles` 表中 `keyword_id='anthropic'` 有新记录，`source_tier` 不为 NULL
4. 前端 Anthropic Tab 正常展示文章卡片 + Tier 徽章
5. 前端 Claude Blog Tab 消失（关键词已停用）
6. `npm test` 全部通过，无回归

---

## 九、后续扩展

- 远期候选信源（§4.3）在需要时做 crawl4ai 可达性测试后加入
- 如果 Anthropic 新闻量持续偏低，可考虑加入 Google News RSS 作为二级兜底（需改 search.js 逻辑）
- dallas-mavericks 关键词信源扩展复用同一套流程（另开需求）
