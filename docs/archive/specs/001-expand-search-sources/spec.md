# Feature Spec: 信息源可信度分级与按关键词定向采集

**Feature ID**: 001  
**Created**: 2026-08-02  
**Status**: Draft

---

## Overview

不同关键词对信息来源的可信度要求差异极大：监控曼联转会动态需要盯住 The Athletic、BBC Sport 等 Tier 1 记者，而不是让 Google News 聚合器混入《太阳报》等低质量小报。本功能让每个关键词可以指定一组可信 RSS 来源（作为"定向采集"替代或补充通用搜索），并在 AI 评分时纳入来源可信度，显著提升信噪比。

---

## Problem Statement

现有 `search` 类型关键词统一走 `searchAll()` → Google News RSS（聚合所有媒体，含大量低质小报）+ HackerNews（对曼联类关键词完全无关）。用户无法区分 David Ornstein 发布的实锤消息与《每日邮报》的捕风捉影，AI 评分也不知道来源质量，导致噪声高、关键信息被稀释。

---

## User Scenarios & Testing

### 主流程：关键词使用定向可信 RSS 源

1. 用户在 `keywords` 表中为"Manchester United"关键词绑定一组信任 RSS 来源（如 BBC Sport、MEN、The Athletic 等）
2. 定时任务触发时，该关键词不再走通用 Google News 搜索，而是直接拉取这些 RSS feed 的最新条目
3. 每条条目带有来源名称和可信度等级（Tier 1 / 2 / 3）
4. AI 评分时获知来源等级，Tier 1 来源文章在同等标题下获得更高基础分
5. 最终只有 score ≥ 60 的条目写入 `articles` 表

### 降级场景：关键词未绑定定向 RSS

- 关键词无绑定 RSS 时，行为与现有 `search` 类型完全一致（向后兼容）

### 边界场景

- 某 RSS feed 拉取失败：静默跳过该源，其余源继续
- RSS 条目无 pubDate：以采集时间兜底
- 同一 URL 在多个 RSS feed 中出现：去重后只保留一条（优先保留来源等级最高的那条的 source 标记）

---

## Clarifications

### Session 2026-08-02

- Q: RSS来源列表存在哪里？ → A: Option B — 新增 `keyword_sources` 关联表（一对多）
- Q: 关键词绑定了 RSS 来源后，原有 searchAll() 还跑吗？ → A: Option B — RSS + searchAll() 同时跑，结果合并去重
- Q: 来源可信度等级映射存在哪里？ → A: Option B — `src/source-tiers.json` 配置文件

---



### FR-01：新增 `keyword_sources` 关联表

新建 `keyword_sources` 表（一对多，关联 `keywords`），每行代表一个 RSS feed 绑定：
- `id` UUID 主键
- `keyword_id` TEXT 外键 → keywords(id) ON DELETE CASCADE
- `rss_url` TEXT（RSS feed 地址）
- `source_name` TEXT（显示名，如 "BBC Sport"）
- `tier` INTEGER（0-3，来源可信度等级）
- `enabled` BOOLEAN DEFAULT true
- `created_at` TIMESTAMPTZ

关键词无绑定行时，行为与现有 `search` 类型完全一致（向后兼容）。

### FR-02：RSS Feed 采集模块（RSS + searchAll() 并行）

当关键词有 `keyword_sources` 绑定时，RSS 采集与现有 `searchAll()`（Google News + HackerNews）**同时运行**，结果合并后统一去重、AI 评分。无绑定时仅跑 `searchAll()`，行为不变。

RSS 采集能力：
- 拉取任意公开 RSS/Atom feed（RSS 2.0 + Atom 1.0）
- 解析标题、链接、摘要、发布时间
- 每个 feed 请求间隔至少 2 秒，携带真实 User-Agent
- 单个 feed 失败静默跳过，不影响其他来源

可借助 Firecrawl MCP 插件处理需要 JavaScript 渲染或反爬的来源页面（作为 axios 的备用抓取通道）。

### FR-03：信息源可信度等级配置

系统维护一份内置的来源可信度映射表，按域名或来源名识别等级：

| 等级 | 说明 | 示例 |
|------|------|------|
| Tier 0 | 官方权威（俱乐部官网、PA 通讯社） | manutd.com、pressassociation.com |
| Tier 1 | 顶级可信记者/媒体（准确率 95%+） | theathletic.com、bbc.co.uk、manchestereveningnews.co.uk |
| Tier 2 | 次可靠补充（需搭配 Tier 1 验证） | skysports.com、talksport.co.uk |
| Tier 3 | 低可信 / 小报（仅供参考） | thesun.co.uk、dailymail.co.uk |

该映射存储在 `src/source-tiers.json` 配置文件中，按域名键值对维护，修改文件重启即生效，无需数据库迁移。

### FR-04：AI 评分纳入来源可信度

`analyzeResult` 调用时传入来源等级，AI prompt 中明确说明：
- Tier 0/1 来源：评分应相对宽松，实质内容有价值即可 ≥60
- Tier 3 来源：评分应严格，标题党、捕风捉影内容主动降分
- 未知来源：按现有标准处理

### FR-05：`articles` 表新增来源等级字段

每条入库记录附带 `source_tier`（整数 0-3），供前端筛选和未来分析使用。

---

## Success Criteria

1. 曼联关键词绑定 BBC Sport + MEN RSS 后，采集结果中《太阳报》/《每日邮报》类条目占比降至 0（因为根本不从那里抓）
2. 同一标题的文章，来自 theathletic.com 的 AI 评分不低于来自 thesun.co.uk 的评分（Tier 加权有效）
3. 已绑定定向 RSS 的关键词与未绑定的关键词，在 `articles` 结果质量（用户主观判断相关且可信）上有明显差异
4. RSS 采集模块拉取失败不影响其他关键词的正常运行
5. 旧有 `search` 类型关键词（无 RSS 绑定）行为 100% 不变

---

## Assumptions

- The Athletic 有公开 RSS（付费内容摘要仍可免费获取）；若无公开 RSS，该来源可通过 URL 轮询方式补充
- Twitter/X 记者推文（Ornstein、Romano 等）不在本期范围，需要付费 API
- 来源等级映射表初期以硬编码形式维护，不需要 UI 管理界面
- 查询扩展（Query Expansion）为独立后续功能，本期不包含

---

## Out of Scope

- Twitter/X 记者推文监控
- 国内信息源（微博、B 站、搜狗）
- 前端来源等级筛选 UI（`source_tier` 字段入库后留待后续）
- 查询扩展（AI 将关键词扩展为多个相关词）
- 关键词管理前端 UI（增删改）
