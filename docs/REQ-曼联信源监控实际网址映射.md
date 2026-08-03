我看了一下两个版本。原 REQ 偏**工程实现规范**，新的 Source Map 偏**体育信息源知识体系**。二者不冲突，应该融合成：

* **REQ 保留：系统目标、架构、数据库、AI流程**
* **Source Map 补充：真正可执行的信息源资产层**
* 增加：`sources_registry`（信源注册表）、`journalists`（记者表）、`source_priority`（抓取优先级）
* 修正几个地方：

  1. BBC 不应该同时 Tier1 和 Tier2，应该拆开：

     * Simon Stone = Tier1
     * BBC Sport 普通栏目 = Tier2
  2. The Athletic 不应该整体 Tier1，因为不同作者质量不同：

     * Ornstein / Whitwell = Tier1
     * 普通 Athletic 曼联文章 = Tier2
  3. MEN 保留 Tier1（曼彻斯特本地属性），但权重建议 7，不要和 Ornstein 等完全等价。
  4. X 账号必须独立建模，不应该混入普通 URL。

下面是整合后的版本。

---

# REQ: Manchester United Overseas Intelligence Monitoring System v2.0

> Status: Draft
> Project: Manchester United AI Intelligence System
> Architecture: Craw4AI MCP + Firecrawl + Supabase + LLM Verification
> Principle: White-list First + Source Graph + Event Intelligence

---

# 一、项目目标

## 1.1 项目定位

建立一个针对 Manchester United 的海外信息自动监控系统。

系统不进行全网搜索，不接入 Google News 等开放聚合渠道。

采用：

```
可信信源白名单
        ↓
定向抓取
        ↓
AI语义过滤
        ↓
事件聚类
        ↓
多源交叉验证
        ↓
可信度评分
        ↓
结构化知识库
```

目标：

* 自动捕获曼联官方消息
* 自动追踪转会内幕
* 自动监控伤病、管理层、比赛信息
* 自动判断新闻可信程度
* 自动生成日报/事件流

---

# 二、核心设计原则

## 2.1 White-list First

系统只允许：

```
Tier 0
Tier 1
Tier 2
```

进入抓取池。

禁止：

```
Tier 3
Tier 4
```

产生网络请求。

数据流：

```
Supabase source_registry

        ↓

Crawler

        ↓

Articles
```

而不是：

```
全网抓取

↓

过滤垃圾
```

原因：

* 降低成本
* 降低幻觉污染
* 提高AI判断质量

---

# 三、Source Trust Model

## 3.1 Tier体系

| Tier  | Weight | 定义                          | 作用     |
| ----- | ------ | --------------------------- | ------ |
| Tier0 | 10     | Official Truth Layer        | 最终事实确认 |
| Tier1 | 8      | Breaking Intelligence Layer | 内幕、首发  |
| Tier2 | 6      | Verification Layer          | 验证、分析  |
| Tier3 | 3      | Low Quality                 | 禁止接入   |

---

# 四、Tier0 信源

# Official Truth Layer

## 4.1 Manchester United Official

| Source        | URL                                                                                          | 类型       |
| ------------- | -------------------------------------------------------------------------------------------- | -------- |
| 官网            | [https://www.manutd.com/en](https://www.manutd.com/en)                                       | Official |
| 新闻            | [https://www.manutd.com/en/news](https://www.manutd.com/en/news)                             | News     |
| Transfer News | [https://www.manutd.com/en/news/transfer-news](https://www.manutd.com/en/news/transfer-news) | Transfer |
| First Team    | [https://www.manutd.com/en/players-and-staff](https://www.manutd.com/en/players-and-staff)   | Squad    |
| Fixtures      | [https://www.manutd.com/en/fixtures](https://www.manutd.com/en/fixtures)                     | Match    |
| Match Report  | [https://www.manutd.com/en/news/match-reports](https://www.manutd.com/en/news/match-reports) | Report   |

数据库：

```json
{
"name":"Manchester United Official",
"type":"club",
"tier":0,
"weight":10,
"authority":"absolute"
}
```

---

## 4.2 Premier League Official

URL:

```
https://www.premierleague.com
```

用途：

* 官方注册信息
* 比赛数据
* 禁赛
* 球员统计

---

# 五、Tier1 信源

# Breaking Intelligence Layer

## 5.1 David Ornstein

来源：

```
X:
https://x.com/David_Ornstein

Organization:
The Athletic
```

能力：

* 转会
* 董事会
* 管理层

配置：

```json
{
"name":"David Ornstein",
"tier":1,
"weight":8,
"topics":[
"transfer",
"board",
"manager"
]
}
```

---

## 5.2 Fabrizio Romano

来源：

```
X:
https://x.com/FabrizioRomano
```

能力：

* 转会最快消息
* Agent network

注意：

AI需要降低：

```
confirmed
here we go
interest
monitoring
```

之间的等级差异。

---

## 5.3 Simon Stone

来源：

```
X:
https://x.com/sistoney67
```

BBC记者。

能力：

* 官方关系
* 管理层
* 教练
* 伤病

---

## 5.4 Laurie Whitwell

来源：

```
X:
https://x.com/lauriewhitwell
```

The Athletic Manchester United。

能力：

* Carrington
* 训练
* 球员状态

---

## 5.5 Andy Mitten

来源：

```
X:
https://x.com/AndyMitten

Website:
https://www.uwsonline.com
```

定位：

不是最快消息源。

优势：

* 更衣室文化
* 球迷生态
* 长周期判断

---

## 5.6 Manchester Evening News

URL:

```
https://www.manchestereveningnews.co.uk/sport/football/manchester-united-fc/
```

Tier:

```
1
```

原因：

曼彻斯特本地媒体。

优势：

* Carrington
* 本地采访
* 球迷反馈

---

# 六、Tier2 信源

# Verification Layer

## BBC Sport

URL:

```
https://www.bbc.com/sport/football/teams/manchester-united
```

用途：

验证。

注意：

```
Simon Stone ≠ BBC普通新闻
```

分开。

---

## Sky Sports

```
https://www.skysports.com/manchester-united
```

用途：

* 比赛
* 转会汇总

---

## The Guardian

```
https://www.theguardian.com/football/manchester-united
```

用途：

* 战术
* 深度分析

---

## Telegraph

```
https://www.telegraph.co.uk/football/teams/manchester-united/
```

---

## The Times

```
https://www.thetimes.co.uk/topic/manchester-united
```

---

## The Athletic Manchester United

普通文章：

Tier2

特殊记者：

Tier1

---

# 七、X信息源模型

X不作为URL。

单独：

```
social_sources
```

结构：

```sql
id

platform

account

tier

topics

trust_score
```

示例：

```json
{
"platform":"X",
"account":"David_Ornstein",
"tier":1,
"trust_score":9
}
```

---

# 八、数据库调整

## 8.1 source_registry

```sql
source_id

name

url

source_type

tier

weight

crawl_method

enabled
```

---

## 8.2 journalist_registry

```sql
id

name

platform

account

tier

speciality
```

---

## 8.3 articles

新增：

```sql
event

category

confidence

corroboration_count

conflict_flag

fact_type
```

---

# 九、AI处理流程

```
Crawler

↓

Article Extraction

↓

Entity Recognition

↓

Event Generation

↓

Category Classification

↓

Source Weight

↓

Cross Validation

↓

Confidence Score

↓

Database

↓

Frontend
```

---

# 十、可信度算法

基础：

```
Confidence =
Source Weight
×
Cross Confirmation
×
Freshness
```

例：

### 单独Ornstein

```
8 × 1 = 8
```

### Ornstein + Romano

```
8 × 1.5 =12
```

### 官方确认

```
10 ×2=20
```

---

# 十一、AI必须输出字段

每篇文章：

```json
{
"title":"",
"source":"",
"tier":1,

"event":
"Manchester United interested in player X",

"category":
"transfer",

"fact_type":
"reported_claim",

"confidence":
82,

"corroboration_count":
3,

"conflict_flag":
false
}
```

---

# 十二、曼联分类模板

```json
{
"category_schema":[

"official",

"transfer",

"injury",

"management",

"match",

"rumour",

"conflict",

"academy_women"

]
}
```

---

# 十三、前端展示规则

## 六宫格

```
┌──────────┬──────────┬──────────┐
│ 官方公告 │ 转会合同 │ 伤病停赛 │
├──────────┼──────────┼──────────┤
│ 管理层   │ 比赛竞技 │ 今日概览 │
└──────────┴──────────┴──────────┘
```

卡片：

```
来源
Tier

日期

标题

AI摘要

分类标签

原文链接

Confidence
```

---

# 十四、MVP白名单

最终14个核心源：

```
Tier0:

1 Manchester United Official
2 Premier League


Tier1:

3 David Ornstein
4 Fabrizio Romano
5 Simon Stone
6 Laurie Whitwell
7 Andy Mitten
8 Manchester Evening News


Tier2:

9 BBC Sport
10 Sky Sports
11 Guardian Football
12 Telegraph Sport
13 Times Football
14 Athletic MUFC
```

---

# 十五、后续扩展

同一套 Source Graph 可以复制：

足球：

```
Arsenal
Liverpool
Real Madrid
Bayern
Barcelona
```

篮球：

```
NBA Team Intelligence
```

核心资产不是 crawler，而是：

```
Source Trust Graph

+

Event Verification Engine
```

这会比普通新闻聚合系统更接近真正的体育情报系统。

---

# 附：信源可达性实测（2026-08-03，crawl4ai 容器）

> 一次性验证脚本 `scripts/run-crawl4ai-demo.js` + `scripts/_crawl4ai-items.json`（gitignore）实测。用于接入生产管线前的信源选型依据。

| 源 | Tier | 实测 | 备注 |
|---|---|---|---|
| manutd.com/en/news | 0 | ✅ 可达 | 官方战报/声明/前瞻/转会栏目 |
| x.com/sistoney67（Simon Stone） | 1 | ✅ 可达 | 帖子正文 + BBC 链接可提取 |
| x.com/David_Ornstein | 1 | ✅ 可达 | 同上；当日内容偏其他俱乐部，靠相关性过滤 |
| manchestereveningnews.co.uk/.../manchester-united-fc/ | 1 | ❌ 404 | 文档 URL 失效，需确认 MEN 新栏目路径 |
| fabrizioromano.com | 1 | ❌ 勿用 | 非足球记者（意大利艺术家站点） |
| theathletic.com/football/manchester-united | 1/2 | ❌ paywall | 跳转 NYT 登录墙 |
| skysports.com/manchester-united | 2 | ✅ 可达 | 战报/转会汇总/分析齐全 |
| theguardian.com/football/manchester-united | 2 | ✅ 可达 | Node 直连不可达，crawl4ai 容器可达 |
| 90min.com/teams/manchester-united | 2 | ✅ 可达 | 跳转 si.com，内容可用 |
| espn.com/soccer/team/_/id/360/manchester-united | 2 | ❌ 空页 | JS 重，md 提取为空 |
| bbc.com/sport/football/teams/manchester-united | 2 | 未测 | Simon Stone X 帖子可作 T1/BBC 内容替代 |

**跨 tier 交叉印证效果**：Atleti 友谊赛（T0 manutd + T2 Sky + T2 90min）、Tielemans（T2 Sky + T2 Guardian）、Mount 中场分析（T1 Stone + T2 Sky）均可聚类为 high 置信度。
