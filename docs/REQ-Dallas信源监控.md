# REQ: Dallas Mavericks 信源监控需求文档

> 状态: Draft ｜ 创建: 2026-08-04 ｜ 参考: docs/REQ-曼联信源监控.md（MU 模式）+ docs/REQ-Anthropic信源监控.md（Anthropic 模式）
> 说明：复用白名单前置准入 + crawl4ai 抓取 + AI 评分交叉验证架构，适配 NBA 球队场景。前端复制 MU 板块视图组件。

---

## 一、项目目标

为 `dallas-mavericks` 关键词建立白名单信源监控，自动抓取独行侠相关新闻，AI 评分过滤后入库。前端使用与 MU 同构的板块视图（BoardView），展示官方公告/交易签约/伤病/管理层/赛事战报五个板块。

---

## 二、核心设计原则

- **白名单前置准入：** 只从 keyword_sources 表中配置的 T0/T1/T2 信源抓取，无 HackerNews 兜底
- **crawl4ai 主通道 + scraper-direct 降级：** 复用已验证的双通道架构
- **X 账号精选原则：** NBA X 内容产出远低于足球——多数记者帖子链接已在网页源覆盖。仅纳入有独立内容的 Marc Stein（substack 文章链接，Ornstein 级独行侠内幕权威）
- **前端复用 MU BoardView：** 同一组件，仅板块定义从 MU_BOARDS 换为 DAL_BOARDS

---

## 三、信源可信度 Tier 分级

| Tier | 权重 | 类型 | 说明 |
|------|------|------|------|
| **Tier 0** | 10 | 官方信源 | NBA.com 独行侠官方新闻频道。任何外部报道与 T0 冲突以 T0 为准 |
| **Tier 1** | 8 | 顶级跟队记者 | Marc Stein——独行侠内幕权威，Substack 文章链接（与 Ornstein 同角色） |
| **Tier 2** | 6 | 主流体育媒体 | 本地大报 + 全国体育媒体，用于佐证 T1 和交叉验证 |

**T3/T4 不入白名单，不抓取。**

---

## 四、信源资产（Source Map）

### 4.1 生产白名单（9 源三 tier，2026-08-04 Phase8 更新）

| 信源 | 抓取页面 | Tier | 实测 | 备注 |
|------|---------|------|------|------|
| NBA Mavs News | `nba.com/mavs/news` | 0 | crawl4ai ✅ + Node ✅ | 官方新闻（mavs.com 301 跳转至此） |
| Marc Stein (X) | `x.com/TheSteinLine` | 1 | crawl4ai ✅ (t.co 提取) | 独行侠内幕权威，Substack 链接 |
| Dallas Morning News | `dallasnews.com/sports/mavericks/` | 2 | crawl4ai ✅ + Node ✅ | **最强本地跟队（Townsend/Caplan 独家）**；⚠️ **正文计量墙 10篇/30天**——列表页标题免费仍有情报价值，Phase8 决策保留并前端标注"正文需订阅" |
| Yahoo Sports | `sports.yahoo.com/nba/teams/dallas/` | 2 | crawl4ai ✅ (Node 403) | 仅 crawl4ai 通道；Phase8 已修导航垃圾（pattern `\.html$` + isSpamTitle） |
| Bleacher Report | `bleacherreport.com/dallas-mavericks` | 2 | crawl4ai ✅ (Node 403) | 链接发现 + 外部指向；Phase8 pattern 改 `/\/articles\//` |
| SI Mavs | `si.com/nba/mavericks/news` | 2 | crawl4ai ✅ | /news 子页可达，正文质量高 |
| Mavs Moneyball | `mavsmoneyball.com/mavericks-news` | 2 | crawl4ai ✅（需 wait_for） | SB Nation 免费；JS 渲染，Phase8 加 wait_for 治 0 产出 |
| The Smoking Cuban | `thesmokingcuban.com` | 2 | crawl4ai ✅（需 wait_for） | FanSided 免费；同上加 wait_for |
| HoopsHype | `hoopshype.com/tag/dallas-mavericks/` | 2 | crawl4ai ✅（2026-08-04 实测 31 链接） | Phase8 新增；补传闻/交易聚合，ARTICLE_PATTERN 实测定稿 |

### 4.2 已验证不可用（排除）

| 源 | 原因 |
|---|---|
| ESPN (`espn.com/nba/team/_/name/dal/...`) | 202 bot detection，crawl4ai 空 markdown |
| SI (`si.com/nba/mavericks`) | JS SPA，702KB HTML 但 markdown 为空 |
| CBS Sports | 406 anti-bot，双通道均不可达 |
| The Athletic | 硬 paywall + 超时 |
| mavs.com | 301 跳转，使用 nba.com/mavs/news 作为目的地 |

### 4.3 X 账号精简说明

| 账号 | 决策 | 理由 |
|------|------|------|
| **Marc Stein** | ✅ 纳入 T1 | 独行侠内幕权威，Substack 链接有独立内容 |
| @dallasmavs | ❌ | 内容来自 nba.com，T0 网页源已覆盖 |
| @ShamsCharania | ❌ | 联盟级记者，Mavs 帖子占比 ~5%，AI 过滤成本过高 |
| @espn_macmahon | ❌ | ESPN 网页源不可达，X 产出偏少（1 t.co） |
| @townbrad / @CallieCaplan | ❌ | 内容已在 dallasnews.com 覆盖（这些人就是 DMN 记者） |

---

## 五、抓取通道

复用 MU/Anthropic 已验证架构，零改动：

```
crawl4ai 容器 (localhost:11235)
  → 成功：提取文章链接 → toItem 规整
  → 失败/空结果：自动降级 scraper-direct.js
  → X 源仅走 crawl4ai links.external t.co 提取
  → Yahoo/Bleacher Report 仅 crawl4ai（Node 403/406）
```

### ARTICLE_PATTERNS 新增

```js
// Dallas Mavericks 信源
{ host: 'nba.com', re: /\/mavs\/news\// },
{ host: 'dallasnews.com', re: /\/sports\/mavericks\// },
{ host: 'sports.yahoo.com', re: /\/nba\// },
{ host: 'bleacherreport.com', re: /\/dallas-mavericks\// },
```

---

## 六、数据变更清单

### 6.1 Supabase keyword_sources 新增

```sql
-- 清理旧数据（如有）
DELETE FROM keyword_sources WHERE keyword_id = 'dallas-mavericks';

-- 插入 5 条新信源
INSERT INTO keyword_sources (keyword_id, source_name, scrape_url, tier, fetch_type, enabled, rss_url)
VALUES
  ('dallas-mavericks', 'NBA Mavs News', 'https://www.nba.com/mavs/news', 0, 'firecrawl', true, 'https://www.nba.com/mavs/news'),
  ('dallas-mavericks', 'Marc Stein (X)', 'https://x.com/TheSteinLine', 1, 'firecrawl', true, 'https://x.com/TheSteinLine'),
  ('dallas-mavericks', 'Dallas Morning News', 'https://www.dallasnews.com/sports/mavericks/', 2, 'firecrawl', true, 'https://www.dallasnews.com/sports/mavericks/'),
  ('dallas-mavericks', 'Yahoo Sports', 'https://sports.yahoo.com/nba/teams/dallas/', 2, 'firecrawl', true, 'https://sports.yahoo.com/nba/teams/dallas/'),
  ('dallas-mavericks', 'Bleacher Report', 'https://bleacherreport.com/dallas-mavericks', 2, 'firecrawl', true, 'https://bleacherreport.com/dallas-mavericks');
```

### 6.2 keywords 表更新 category_schema

```sql
UPDATE keywords
SET category_schema = '{
  "official": "官方公告",
  "trade": "交易签约",
  "injury": "伤病报告",
  "management": "管理层·教练组",
  "match": "赛事战报",
  "rumour": "未证实传闻",
  "analysis": "深度分析",
  "other": "其他"
}'::jsonb
WHERE id = 'dallas-mavericks';
```

### 6.3 source-tiers.json 新增域名

```json
{
  "nba.com": 0,
  "dallasnews.com": 2,
  "sports.yahoo.com": 2,
  "bleacherreport.com": 2
}
```

### 6.4 前端 BoardView 新增 DAL_BOARDS

```ts
// client/src/components/BoardView.tsx
export const DAL_BOARDS = [
  { key: 'official', label: '官方公告', emoji: '🔵', official: true },
  { key: 'trade', label: '交易签约', emoji: '🔄' },
  { key: 'injury', label: '伤病报告', emoji: '🏥' },
  { key: 'management', label: '管理层·教练组', emoji: '🏛️' },
  { key: 'match', label: '赛事战报', emoji: '🏀' },
];
```

### 6.5 KeywordsTab 扩展 showBoard 条件

```ts
// 当前仅 MU，新增 Dallas
const BOARD_KEYWORD_IDS = [MU_KEYWORD_ID, DAL_KEYWORD_ID];
const showBoard = selected?.id != null && BOARD_KEYWORD_IDS.includes(selected.id);
```

---

## 七、Pipeline 影响

| 模块 | 改动 | 工作量 |
|------|------|--------|
| `src/crawl4ai-fetch.js` | ARTICLE_PATTERNS 新增 4 组 | ~8 行 |
| `src/source-tiers.json` | 新增 4 条域名映射 | ~4 行 |
| Supabase | 插入 5 条 keyword_sources + 更新 category_schema | SQL |
| `client/src/components/BoardView.tsx` | 新增 DAL_BOARDS | ~10 行 |
| `client/src/lib/constants.ts` | 新增 DAL_KEYWORD_ID | 1 行 |
| `client/src/components/KeywordsTab.tsx` | showBoard 条件扩展 | ~3 行 |
| `src/search.js`、`src/index.js`、`src/ai.js` | **不改** | 0 |

---

## 八、验收标准

1. `node src/index.js` 运行，dallas-mavericks 关键词产出 ≥1 篇相关文章入库
2. 日志出现 crawl4ai 抓取成功（T0 nba.com + T1 Marc Stein + T2 三家媒体）
3. Supabase `articles` 表中 `keyword_id='dallas-mavericks'` 有新记录
4. 前端 Dallas Mavericks Tab → **BoardView 板块视图**（5 板块 + 今日概览），非 ArticleFeed 列表
5. 前端 MU Tab 板块视图不受影响，Anthropic Tab ArticleFeed 不受影响
6. `npm test` 全部通过
7. 前端 `npm run build` 无回归
