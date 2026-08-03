# REQ: 曼联海外信源自动化监控需求文档

> 状态: **Draft** ｜ 创建: 2026-08-03 ｜ 最后更新: 2026-08-03（加入白名单准入 + 交叉校验要求）

---

## 一、项目目标

自动化监控曼联（Manchester United）海外多源信息。采用**白名单前置准入**模式：仅从用户预先配置的 T0/T1/T2 高可信信源页面定向抓取，不接入 Google News 全网搜索。AI 评分 + 多信源交叉校验 + Tier0 官方终审兜底。T3/T4 低质信源从根源不发起网络请求。

---

## 二、信源可信度 Tier 分级

| Tier | 权重 | 类型 | 示例 | 采信规则 |
|------|------|------|------|----------|
| **Tier 0** | 10 | 俱乐部官方 | manutd.com、Premier League 官网 | 唯一盖章依据，任何信源与 T0 冲突以 T0 为准 |
| **Tier 1** | 8 | 顶级跟队记者/媒体 | BBC Sport、The Athletic、MEN、Fabrizio Romano | 高度可信，≥2 条交叉印证等同准官宣 |
| **Tier 2** | 6 | 主流媒体体育板块 | Sky Sports、The Guardian、The Telegraph、The Times | 用于佐证 T1，不单独下定论 |
| **Tier 3** | 3 | 次级/小报 | Goal.com、ESPN UK、The Sun、Daily Mail | **不纳入白名单，不抓取、不入库** |

### 核心设计原则：白名单前置准入

- `keyword_sources` 表中只配置 `tier ∈ {0,1,2}` 的信源记录
- Firecrawl 只请求白名单中的页面 URL → T3/T4 数据**从源头不存在**
- 不需要"抓完再丢"的后置过滤代码，也不需要黑名单正则
- 新增信源只需在 Supabase 加一行记录，无需改代码

---

## 三、保留的必要校验（不可省略）

即使只有 T0-T2 信源，以下环节必须保留：

### 3.1 Supabase URL 去重
同一篇新闻被多家媒体转载，`articles` 表 `UNIQUE(keyword_id, url)` 约束 + RPC `get_new_urls()` 查重，只入库一次。

### 3.2 AI 语义相关度打分（0–100）
同一信源页面也会出现无关内容（女足、青训边角料等），DeepSeek 判断是否紧扣一线队主线。score ≥ 60 入库。

### 3.3 同事件多信源交叉校验
T1 记者之间爆料可能冲突（Ornstein vs Simon Stone 对同一谈判描述不同）、消息可能反转（前期猜测→后续辟谣）。AI 按事件聚类，交叉印证加分、孤立传闻降权。T0 官方公告为最终兜底。

### 3.4 事实 / 主观观点区分
"教练发布会原话"是客观事实；"记者预测夏窗引援名单"是主观推论。AI 自动拆分两类内容输出。

---

## 四、架构流程

```
管理员配置 Supabase 白名单 (T0/T1/T2 固定 URL)
  → 定时 Cron 触发
  → 定向串行抓取（Firecrawl 主路径；余额不足自动降级 scraper-direct.js：axios + DeepSeek 识别链接）
  → URL 去重（已存在跳过）
  → LLM 相关度打分 (score ≥ 60 通过)
  → 按事件自动聚类 + 多源交叉可信度校验
  → Tier0 冲突检测（与官方公告冲突 → 标记降权）
  → 结构化写入 articles 表
  → 生成 Markdown 日报
  → React 前端按 Tier/时间检索
```

### 已移除的冗余模块

| 移除项 | 原因 |
|--------|------|
| Google News RSS 全网搜索 | 白名单定向抓取替代，不需要聚合搜索 |
| Tier3/Tier4 后置过滤分支 | 垃圾源从根源不发起请求 |
| URL 黑名单正则脚本 | 白名单天然实现拦截 |
| 低质源丢弃代码 | 无此类数据流入 |

---

## 五、信源清单（Manchester United — MVP 白名单）

| 信源名称 | 抓取页面 | Tier | fetch_type |
|----------|---------|------|------------|
| Man Utd Official | `manutd.com/en/news` | 0 | firecrawl |
| BBC Sport | `bbc.com/sport/football/teams/manchester-united` | 1 | firecrawl |
| The Athletic | `theathletic.com/football/manchester-united/` | 1 | firecrawl |
| MEN | `manchestereveningnews.co.uk/sport/football/manchester-united-fc/` | 1 | firecrawl |
| Sky Sports | `skysports.com/manchester-united` | 2 | firecrawl |
| The Guardian | `theguardian.com/football/manchester-united` | 2 | firecrawl |
| The Telegraph | `telegraph.co.uk/manchester-united/` | 2 | firecrawl |
| The Times | `thetimes.co.uk/topic/manchester-united` | 2 | firecrawl |

> 以上为主要推荐信源，后续可按需增删。

---

## 六、技术栈

| 层 | 技术 |
|----|------|
| 抓取 | Firecrawl API（主路径，固定 URL）；余额不足时降级 `scraper-direct.js`（axios + DeepSeek 识别链接）|
| 存储 | Supabase PostgreSQL（`keywords` + `keyword_sources` + `articles`）|
| AI | DeepSeek API（评分 + 摘要 + 交叉校验 + 事实/观点拆分）|
| 后端 | Node.js CommonJS（`src/index.js` 主调度）|
| 前端 | React 18 + TypeScript + Vite + Tailwind |
| 调度 | node-cron（`CRON_SCHEDULE` 环境变量）|
