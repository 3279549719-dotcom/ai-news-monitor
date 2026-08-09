# REQ: 架构借鉴 — 吸收开源成熟监控组件

> 状态: **已采纳（2026-08-09，范围 A1+A2+A3+B1）** ｜ 创建: 2026-08-09 ｜ 决策: [DECISION-架构借鉴](DECISION-架构借鉴-吸收开源成熟监控组件.md)
> 方法: 派 2 个 subagent 调研 GitHub 同类项目（①按贴合度排序 ②深挖成熟项目架构模式）→ 综合结论 → 本 REQ 定义候选措施
> 范围: **管线抓取层 / 去重幂等 / 通知分发**——不改数据模型主键语义、不动前端 remilia 需求（已独立完成）
> 决策方式: ✅ 已完成——用户评审本 REQ，勾选采纳 **A1 + A2 + A3 + B1**（A4/A5/A6 延后，B2 需管理员权限单独评估），详见 DECISION 文档

---

## 一、背景：目标与调研结论

### 1.1 触发背景（真实痛点，2026-08-09 诊断）

- **Dallas / Anthropic 连续多日低产出**：诊断确认非单一 bug，而是多层问题——①T0 官方源 nba.com crawl4ai 抓取失效；②AI 对明显相关文章误判 0 分（Marc Stein 23 条全 0、nba-mavs-news 8 条全 0）；③**score 0「已见标记」把误杀永久固化**（`filterNewItems` URL 去重永不重评）；④`MAX_PER_SOURCE=5` 截断 X 新推文。
- **自动化可观测性缺口**：定时任务跑完但用户「以为没跑」（日志收尾 flush bug）、邮件/前端显示存疑、任务仅登录态触发。
- 用户要求：**不要再造轮子**——先调研 GitHub 同类项目，看成熟架构怎么构造，找出最贴合本项目的形态，吸收其模板/组件后改造。

### 1.2 调研结论（两份 subagent 报告综合）

**核心判断**：本项目的形态（白名单源 → 定时抓取 → AI 评分过滤 → 持久化 → 前端+邮件）是开源里被反复验证的主流形态；但 **「tier 分级信源 + 阈值评分 + 事件聚类去重」这个精确组合没有现成开源可整体复用**（tier 概念多见于商业聚合器）。所以路线是**吸收最成熟的组件模式，而非替换整体架构**。

**最贴合本项目的 Top 3 项目**（按贴合度）：

| 项目 | star | 一句话形态 | 对本项目最大的借鉴点 |
|------|------|-----------|---------------------|
| **MuckScraper** | 127 | 定时多源抓取 → 多级降级+源级冷却 → **pgvector 向量聚类 story 去重** → LLM 摘要/评分 → Postgres 存储 → 可选 webhook 通知；**提示词/调度/评分全 DB 化** | 评分规则全配置化 + 向量聚类去重 + 抓取源级遥测 |
| **changedetection.io** | 33k | 一切围绕 **Watch 数据对象**，多抓取后端可插拔（`content_fetchers/`），通知统一走 **Apprise 万能 URL** | **fetcher 接口 + 每信源回退链** + 通知 URL 即配置 |
| **Huginn** | 49.8k | 事件流驱动的 agent 图，增量去重靠 **`memory['seen_ids']` 环形缓冲** | **每信源已见 id 持久化环形缓冲**（增量幂等第一道闸） |

补充高同构项目：**Horizon**（Python，多源→AI 评分→跨源去重→邮件日报，同构度最高）、**AI-Gov-Content-Curator**（Node+Cheerio+LLM+邮件，技术栈最接近）、**RSSbrew**（聚合→过滤→digest→AI 摘要产品化切分）。

**共同成熟模式**（被反复验证的 8 条）：①抓取多级降级+源级遥测 ②评分规则/提示词外置 ③同事件/跨源去重 ④AI 与规则双通道 fallback ⑤信源白名单/注册表外置 ⑥通知多通道+HTML 卡片邮件 ⑦免费/无服务器定时 ⑧快慢模型分级。

---

## 二、现状与缺口

### 2.1 已具备（与成熟模式对齐的部分）

| 成熟模式 | 本项目现状 |
|----------|-----------|
| 抓取多级降级 | ✅ crawl4ai → scraper-direct → twikit → 跳过的降级链（`search.js`） |
| 提示词外置 | ✅ `src/prompts/`（摘要 6 铁律 / 链接精选）+ `applyTierFloor`（规则兜底 AI） |
| 同事件去重 | ✅ `crosscheck.js`（evSim/tSim 双信号 + seed-only 聚类） |
| 信源配置外置 | ✅ `keyword_sources` 表 + `source-tiers.json` + `article-patterns.json` |
| HTML 卡片邮件 | ✅ `email.js`（T0/T1 HTML 卡片 + 纯文本双格式） |

### 2.2 缺口（对应成熟项目已验证的更好做法）

| # | 缺口 | 现状 | 成熟做法（借鉴对象） | 直接关联痛点 |
|---|------|------|---------------------|-------------|
| **A1** | **抓取通道硬编码** | `search.js` 逐源 if-else 写死通道顺序；信源「能不能/想不想被某通道抓」写在代码分支 | changedetection `content_fetchers/`：每信源声明主通道+回退链（数据化） | Anthropic 源 crawl4ai 挂→颗粒无收；新增信源要改代码 |
| **A2** | **score 0 已见标记永久固化** | `assembleRecords` 把 <60 行以 score=0 入库，`filterNewItems` 按 URL 永不重评 | Huginn `seen_ids` 环形缓冲（每源记最近 N 条已见，可过期的轻量幂等闸） | Marc Stein 23 条全 0 永久消失；Dallas 连续 0 产出 |
| **A3** | **通知单通道** | `email.js` 只发 SMTP；管线失败告警（F-019）是 run-pipeline.js 独立逻辑 | Miniflux `integration/` 每通道一包 + Apprise URL 即配置 | 「日报摘要」和「自愈告警」未收口；加 Telegram/webhook 要改代码 |
| A4 | 去重是纯 LLM 聚类，无 embedding 预筛 | `crosscheck.js` 双信号直接 LLM | MuckScraper pgvector 向量预筛粗排 + LLM 精判 | LLM 调用量大；召回受限 |
| A5 | 抓取无源级冷却/失败持久化 | crawl4ai 偶发过载（CLAUDE.md 记录 66% 正文缺失），无 per-source 冷却 | MuckScraper domain cooldown + 坏抓取审计 | crawl4ai 过载时逐源硬试 |
| A6 | 定时依赖本机+登录态 | Windows 任务计划「仅登录时运行」，未登录/睡眠静默漏跑 | GitHub Actions cron（大量项目用） | 自动化可靠触发的最大断点 |

---

## 三、候选措施

### 组 A — 管线架构（核心，与痛点直接对应）

| ID | 措施 | 改动位置 | 借鉴对象 | 一句话说明 |
|----|------|---------|---------|-----------|
| **A1** | **抓取通道数据化**：定义 `fetchSource(source, {backends})` 接口，`backends` 成为信源配置字段（`keyword_sources` 加列或 `source-tiers.json` 加字段）；`search.js` 只遍历信源按链尝试 | `src/search.js` + 信源配置表 | changedetection `content_fetchers/` | 每信源声明主通道+回退顺序，新增/调优信源改数据不改代码；可给 claude.com 配 `['crawl4ai']`、TechCrunch 配 `['crawl4ai','direct']` |
| **A2** | **增量幂等闸**：每信源维护「最近 N 条已见 id」环形缓冲（URL 归一化 hash），在**抓取后、AI 评分前**剔除已见；重跑管线不重复入库、省 AI 预算 | `src/store.js` 或新增 `src/seen.js` + `src/index.js` 的 fetchCandidates 阶段 | Huginn `memory['seen_ids']` | 第一道增量闸，缓解「score 0 永久固化」与 crawl4ai 过载 |
| **A3** | **通知分发器**：抽 `src/notify.js` 统一 `send({channels, payload})`，通道配置外置（`.env` 的 `NOTIFY_*`）；邮件复用 `email.js`，新增 webhook/Telegram 通道各一模块；日报+失败告警收口 | 新增 `src/notify.js` + `email.js` 复用 + `run-pipeline.js` 告警改造 | Miniflux `integration/` + Apprise | 通知与业务解耦，多通道可配置，失败告警可走即时通道 |
| A4 | embedding 预筛去重（进阶）：`dedupeBySimilarity` 前加低成本向量粗筛候选，减少 LLM 聚类调用 | `src/crosscheck.js` | MuckScraper pgvector | 提高召回、降 LLM 预算 |
| A5 | 抓取源级冷却（进阶）：记录每源最近失败时间/错误，连续失败 N 次冷却跳过 | `src/search.js` + 状态落 Supabase/logs | MuckScraper domain cooldown | crawl4ai 过载时逐源快速跳过而非硬试 |
| A6 | GitHub Actions cron 备选（进阶）：包一层 workflow 跑纯直抓场景 | `.github/workflows/` | 大量项目 | 无本机场景的备选调度 |

### 组 B — 自动化可靠性与可观测性（顺带收口昨天发现的断点）

| ID | 措施 | 说明 |
|----|------|------|
| B1 | `run-pipeline.js` 日志收尾 flush 修复（等 `'finish'` 再 `process.exit`） | 日志有 `exit code=0` 结尾行，避免「以为没跑完」 |
| B2 | 任务计划改「无论用户是否登录都运行」（`/ru SYSTEM` 需管理员）或补「错过即补跑」 | 根治「仅登录态触发」静默漏跑 |
| B3 | 邮件/前端可观测性：确认收件、前端数据直读 Supabase 无需重部署 | 现状已在 README/CLAUDE.md，无需改代码 |

---

## 四、推荐（最小起步）✅ 已采纳（2026-08-09）

**A1 + A2 + A3 + B1**：
- **A1 抓取通道数据化**是「新增/调优信源零代码」的地基，直接缓解 Anthropic 单通道依赖，且与 changedetection/Horizon 两个成熟项目对齐。
- **A2 增量幂等闸**直击「score 0 永久固化」和「crawl4ai 过载」两个已验证痛点，是增量抓取省预算的第一步。
- **A3 通知分发器**把日报 + 自愈告警收口，为未来 Telegram/webhook 铺路，成本低。
- **B1 日志收尾**一行修复，消除「定时任务没跑」的误判来源（昨天实际跑成功了，但日志看起来像被中断）。
- A4/A5/A6 视 A1-A3 落地体验再定；B2 需管理员权限，可单独评估。

---

## 五、决策方式 ✅ 已完成（2026-08-09）

1. **勾选采纳范围**：✅ **A1 + A2 + A3 + B1**。A4（embedding 预筛）/ A5（源级冷却）/ A6（GitHub Actions cron）暂缓，视 A1-A3 落地体验再评估；B2（任务计划无论登录都运行）需管理员权限，单独评估。
2. **DECISION 文档**：✅ 已定稿 [DECISION-架构借鉴-吸收开源成熟监控组件.md](DECISION-架构借鉴-吸收开源成熟监控组件.md)（选型依据 + 实施设计 + 风险回滚）。
3. **实施计划**：见 `docs/superpowers/plans/2026-08-09-架构借鉴-抓取通道数据化-增量幂等-通知分发.md`，按模块测试 → 功能测试 → 端到端测试推进。

---

## 六、调研来源

- 架构模式深挖：RSSHub / changedetection.io / Huginn / FreshRSS / Miniflux / Horizon / NewsAgent / FeedMind / glean / ai-digest
- 同类项目排序：MuckScraper / AI-Gov-Content-Curator / RSSbrew / condenseit / ai-news-aggregator（Supabase）/ miniflux-ai / AI-News-Ranker / ai-podcast-studio 等
- 完整调研报告存于 subagent 输出（需要时可归档进 `docs/archive/`）
