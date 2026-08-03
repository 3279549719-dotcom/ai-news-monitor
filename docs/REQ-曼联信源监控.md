# REQ: 曼联海外信源自动化监控需求文档

> 状态: **Live** ｜ 创建: 2026-08-03 ｜ 最后更新: 2026-08-04
> 说明：本文件由《REQ-曼联信源监控.md》（工程规范）与《REQ-曼联信源监控实际网址映射.md》（Source Map v2.0 信息源知识体系）合并而来。原《实际网址映射.md》已归档至 `docs/archive/`。

---

## 一、项目目标

自动化监控曼联（Manchester United）海外多源信息。采用**白名单前置准入**模式：仅从用户预先配置的 T0/T1/T2 高可信信源页面定向抓取，不接入 Google News 全网搜索。AI 评分 + 多信源交叉校验 + Tier0 官方终审兜底。T3/T4 低质信源从根源不发起网络请求。

系统不进行全网搜索，核心资产是 **Source Trust Graph（信源信任图谱）+ Event Verification Engine（事件验证引擎）**，而非抓取器本身。这套图谱可复制到其他球队/项目（见 §13 后续扩展）。

自动捕获：官方消息、转会内幕、伤病/管理层/比赛信息；自动判断新闻可信程度；自动生成日报/事件流。

---

## 二、核心设计原则：白名单前置准入

- `keyword_sources` 表中只配置 `tier ∈ {0,1,2}` 的信源记录
- 抓取只请求白名单中的页面 URL → T3/T4 数据**从源头不存在**
- 不需要"抓完再丢"的后置过滤代码，也不需要黑名单正则
- 新增信源只需在 Supabase 加一行记录，无需改代码

数据流：

```
Supabase source_registry（白名单）
  → Crawler（定向抓取）
  → Articles
```

而不是：

```
全网抓取 → 过滤垃圾
```

原因：降低成本、降低幻觉污染、提高 AI 判断质量。

---

## 三、信源可信度 Tier 分级

| Tier | 权重 | 类型 | 示例 | 采信规则 |
|------|------|------|------|----------|
| **Tier 0** | 10 | 俱乐部官方 | manutd.com、Premier League 官网 | 唯一盖章依据，任何信源与 T0 冲突以 T0 为准 |
| **Tier 1** | 8 | 顶级跟队记者/媒体 | X 记者（Ornstein/Romano/Stone/Whitwell/Mitten）、MEN | 高度可信，≥2 条交叉印证等同准官宣 |
| **Tier 2** | 6 | 主流媒体体育板块 | Sky Sports、The Guardian、BBC Sport、The Telegraph、The Times | 用于佐证 T1，不单独下定论 |
| **Tier 3** | 3 | 次级/小报 | Goal.com、The Sun、Daily Mail | **不纳入白名单，不抓取、不入库** |

---

## 四、保留的必要校验（不可省略）

即使只有 T0-T2 信源，以下环节必须保留：

### 4.1 Supabase URL 去重
同一篇新闻被多家媒体转载，`articles` 表 `UNIQUE(keyword_id, url)` 约束 + RPC `get_new_urls()` 查重，只入库一次。

### 4.2 AI 语义相关度打分（0–100）
同一信源页面也会出现无关内容（女足、青训边角料等），DeepSeek 判断是否紧扣一线队主线。score ≥ 60 入库（`MIN_SCORE=60`）。

### 4.3 同事件多信源交叉校验
T1 记者之间爆料可能冲突（Ornstein vs Simon Stone 对同一谈判描述不同）、消息可能反转（前期猜测→后续辟谣）。AI 按事件聚类，交叉印证加分、孤立传闻降权。T0 官方公告为最终兜底。

### 4.4 事实 / 主观观点区分
"教练发布会原话"是客观事实；"记者预测夏窗引援名单"是主观推论。AI 自动拆分两类内容输出。

---

## 五、信源资产（Source Map）

> 本节为 **理想白名单 + 实测可达性备注**。理想名单是远期目标；**生产白名单**（§5.4）是当前实际在抓的配置。实测数据基于 2026-08-03 crawl4ai 容器验证（一次性脚本 `scripts/run-crawl4ai-demo.js` + `scripts/_crawl4ai-items.json`）。

### 5.1 Tier0 — 官方（Official Truth Layer）

| 源 | URL | 实测 |
|---|---|---|
| Manchester United Official 新闻 | `manutd.com/en/news` | ✅ 可达，官方战报/声明/前瞻/转会栏目 |
| MU 官网其余栏目 | `manutd.com/en/news/transfer-news`、`/en/news/match-reports`、`/en/fixtures`、`/en/players-and-staff` | 可选扩展，生产白名单只用 `/en/news` |
| Premier League 官网 | `premierleague.com` | 未接入（注册信息/比赛数据/禁赛/球员统计，远期） |

### 5.2 Tier1 — 顶级跟队记者（Breaking Intelligence Layer）

X 账号独立建模（见 §6），不混入普通 URL。

| 记者 | X 账号 | 能力圈 | 实测 |
|---|---|---|---|
| David Ornstein | `x.com/David_Ornstein` | 转会、董事会、管理层 | ✅ 可达；当日内容偏其他俱乐部，靠相关性过滤 |
| Fabrizio Romano | `x.com/FabrizioRomano` | 转会最快消息、Agent 网络；需区分 confirmed / here we go / interest / monitoring 等级 | ⚠️ 原文档误配 `fabrizioromano.com`（意大利艺术家站点），正确是 X 账号 |
| Simon Stone | `x.com/sistoney67` | 官方关系、管理层、教练、伤病 | ✅ 可达；帖子正文 + BBC 链接可提取 |
| Laurie Whitwell | `x.com/lauriewhitwell` | Carrington、训练、球员状态 | 未接入生产白名单（远期） |
| Andy Mitten | `x.com/AndyMitten` | 更衣室文化、球迷生态、长周期判断（非最快消息源） | 未接入生产白名单（远期） |
| Manchester Evening News | `manchestereveningnews.co.uk/.../manchester-united-fc/` | Carrington、本地采访、球迷反馈 | ❌ 文档 URL 404，需确认新栏目路径后重试 |

### 5.3 Tier2 — 主流媒体（Verification Layer）

| 媒体 | URL | 实测 |
|---|---|---|
| Sky Sports | `skysports.com/manchester-united` | ✅ 可达；战报/转会汇总/分析齐全 |
| The Guardian | `theguardian.com/football/manchester-united` | ✅ 可达（Node 直连不可达，crawl4ai 容器可达）；文章标题由 URL slug 生成，非原标题 |
| 90min | `90min.com/teams/manchester-united` | ✅ 可达（跳转 si.com，内容可用）；每轮产出偏多（58 条），靠相关度过滤收敛 |
| ESPN | `espn.com/soccer/team/_/id/360/manchester-united` | ⚠️ crawl4ai 抓取 JS 重拿不到内容（空页），管线自动降级 scraper-direct |
| BBC Sport | `bbc.com/sport/football/teams/manchester-united` | ⚠️ 未测/Node 不可达；Simon Stone 的 X 帖子可作 T1/BBC 内容替代 |
| The Telegraph | `telegraph.co.uk/football/teams/manchester-united/` | 未接入（远期） |
| The Times | `thetimes.co.uk/topic/manchester-united` | 未接入（远期） |
| The Athletic MUFC | `theathletic.com/football/manchester-united/` | ❌ paywall 跳转 NYT 登录墙；Ornstein/Whitwell 的 X 账号可作 T1 替代 |

### 5.4 生产白名单（当前实际配置，7 源三 tier）

| 信源 | 抓取页面 | Tier | fetch_type | 备注 |
|---|---|---|---|---|
| Man Utd Official | `manutd.com/en/news` | 0 | firecrawl | 官方唯一 |
| Simon Stone (X) | `x.com/sistoney67` | 1 | firecrawl | 走 crawl4ai external t.co 链 |
| David Ornstein (X) | `x.com/David_Ornstein` | 1 | firecrawl | 同上 |
| Sky Sports | `skysports.com/manchester-united` | 2 | firecrawl | |
| ESPN | `espn.com/soccer/team/_/id/360/manchester-united` | 2 | firecrawl | crawl4ai 空页 → 自动降级 scraper-direct |
| 90min | `90min.com/teams/manchester-united` | 2 | firecrawl | 跳转 si.com |
| The Guardian | `theguardian.com/football/manchester-united` | 2 | firecrawl | 新增（crawl4ai 可达） |

> 白名单更新走 Supabase `keyword_sources` 表 + `src/source-tiers.json` 域名映射。新增信源时同步更新两处。

### 5.5 已排除源及原因

| 源 | 原因 |
|---|---|
| fabrizioromano.com | 非足球记者站点（意大利艺术家站），正确入口是 X 账号 |
| theathletic.com 曼联页 | paywall，跳转 NYT 登录墙 |
| manchestereveningnews.co.uk 曼联页 | 文档 URL 404 失效，需确认新路径 |
| bbc.com/sport/.../manchester-united | Node 直连不可达，crawl4ai 未测；以 Simon Stone X 帖子替代 |
| espn.com 团队页（crawl4ai 通道） | JS 重，md 提取为空；依赖 scraper-direct 降级 |

---

## 六、X 账号信源模型

X 不作为普通 URL 处理，单独建模。生产实现上：crawl4ai 抓账号页 → 取 `links.external` 的 t.co 链（即文章）→ 帖子标题作标题，无需 AI。axios 抓 X 无意义，X 源失败直接跳过不降级。

```sql
-- 远期模型（journalists / social_sources 表），当前用 keyword_sources + source-tiers.json 近似实现
id
platform   -- 'X'
account    -- 'David_Ornstein'
tier       -- 1
topics     -- ['transfer', 'board', 'manager']
trust_score
```

---

## 七、可信度算法

```
Confidence = Source Weight × Cross Confirmation × Freshness
```

| 场景 | 计算 |
|---|---|
| 单独 Ornstein | 8 × 1 = 8 |
| Ornstein + Romano | 8 × 1.5 = 12 |
| 官方确认 | 10 × 2 = 20 |

生产实现（`src/crosscheck.js`，方案B 轻量版）：本次运行内按 event 聚类 → ≥2 源 = high / 单源 = medium / 与 T0 冲突 = low + conflict_flag。

---

## 八、AI 输出字段

每篇文章 `analyzeResult` 输出：

```json
{
  "score": 82,
  "summary": "中文摘要",
  "event": "Manchester United interested in player X",
  "category": "transfer"
}
```

交叉验证阶段补充：`confidence`（high/medium/low）、`corroboration_count`（印证源数）、`conflict_flag`（与 T0 冲突）。

---

## 九、分类模板（关键词级 category_schema）

| 模板 | 分类 | 适用 |
|---|---|---|
| MU 专属（8 类） | official / transfer / injury / management / match / rumour / conflict / academy_women | manchester-united |
| 通用（4 类） | official / product / research / other | 其他关键词 |

AI 在交叉验证时顺带输出 category；日报与前端共用同一套分类逻辑。

---

## 十、前端展示规则（方案C 板块视图）

- 2 行 3 列网格，蓝白配色：**官方公告（Tier0 红框置顶）/ 转会合同 / 伤病停赛 / 管理层教练组 / 赛事竞技 / 今日概览**
- 卡片结构：来源 | Tier 徽章 | 日期 → 标题 → AI 摘要 → 蓝色分类标签 + 置信度徽章 + 印证数 → 原始链接
- 传闻/冲突内容由交叉验证自动归入，不做 AI 手工分类
- 非曼联关键词使用通用模板的平铺/简化视图
- 原型：`prototype-board.html`

---

## 十一、架构流程

```
管理员配置 Supabase 白名单 (T0/T1/T2 固定 URL)
  → 定时 Cron 触发
  → 定向串行抓取（crawl4ai 主通道；失败/空结果自动降级 scraper-direct.js：axios + DeepSeek 识别链接）
  → URL 去重（已存在跳过）
  → LLM 相关度打分 (score ≥ 60 通过)
  → 按事件自动聚类 + 多源交叉可信度校验
  → Tier0 冲突检测（与官方公告冲突 → 标记降权）
  → 结构化写入 articles 表
  → 生成 Markdown 日报
  → React 前端按 Tier/时间/板块检索
```

### 已移除的冗余模块

| 移除项 | 原因 |
|--------|------|
| Google News RSS 全网搜索 | 白名单定向抓取替代，不需要聚合搜索 |
| Firecrawl API 抓取 | 余额耗尽（HTTP 402），crawl4ai 替代为主通道；`src/firecrawl.js` 已删除 |
| Tier3/Tier4 后置过滤分支 | 垃圾源从根源不发起请求 |
| URL 黑名单正则脚本 | 白名单天然实现拦截 |
| 低质源丢弃代码 | 无此类数据流入 |

---

## 十二、技术栈（当前）

| 层 | 技术 |
|----|------|
| 抓取 | **crawl4ai 容器**（`localhost:11235`，REST，`src/crawl4ai-fetch.js` 主通道）；失败降级 `src/scraper-direct.js`（axios + DeepSeek 识别链接）|
| 存储 | Supabase PostgreSQL（`keywords` + `keyword_sources` + `articles`）|
| AI | DeepSeek API（评分 + 摘要 + 交叉校验 + 分类）|
| 后端 | Node.js CommonJS（`src/index.js` 主调度）|
| 前端 | React 18 + TypeScript + Vite + Tailwind |
| 调度 | node-cron（`CRON_SCHEDULE` 环境变量）|

---

## 十三、方案B/C 追加需求（2026-08-03 确认）

> 以下需求在方案A落地后追加确认，基于 Patrick 的板块设计文档与前端原型图（docs/prototype-board.html）。

### 13.1 交叉校验（方案B）✅ 已落地
- AI 评分时同时输出 event（一句话事件描述，用于聚类）
- 本次运行内文章按 event 聚类；组内多源交叉印证 → 加分；单源 → 降权
- 与 Tier0 官方公告冲突 → 标记 conflict_flag
- articles 表新增字段：event / confidence / corroboration_count / conflict_flag
- 前端卡片显示置信度徽章（高/中/低）+ 印证源数量
- 传闻区 / 辟谣区由交叉验证结果自动驱动，不做 AI 手工分类

### 13.2 板块分类（关键词级模板）✅ 已落地
- keywords 表新增 category_schema（JSON 字段），每个关键词配置自己的板块模板
- 曼联专属模板（8 类）与通用模板（4 类）见 §9
- AI 在交叉验证时顺带输出 category，articles 表新增 category 列
- 日报与前端共用同一套分类逻辑

### 13.3 前端板块视图（方案C）✅ 已落地（T2-4 前端实机回归未做）
- 照原型图实现：2 行 3 列网格布局，蓝白配色
- 5 大主板块 + 今日概览卡（见 §10）
- 不保留折叠面板（决策2），传闻/冲突内容由交叉验证自动归入

---

## 十四、后续扩展

同一套 Source Graph 可复制到其他俱乐部（Arsenal/Liverpool/Real Madrid/Bayern/Barcelona）或 NBA 球队。核心资产是 **Source Trust Graph + Event Verification Engine**，非 crawler。

---

## 十五、技术决策纪要

架构选型原因与决策过程见 [DECISION-方案选型纪要.md](DECISION-方案选型纪要.md)。关键决策：白名单优于黑名单（§2）、交叉验证轻量版（本次运行内聚类，跑顺后升级 7 天窗口）、板块模板关键词级。
