# DOCUMENT_MAP — ai-news-monitor

> ⚠️ 本文件只负责导航，不记录产品事实。路径变更时及时更新。

---

## 核心入口（必读）

| 文档 | 路径 | 阅读时机 |
|------|------|---------|
| 项目总览 + Hook | [CLAUDE.md](CLAUDE.md) | 每次新会话第一件事 |
| Agent 行为规范 | [AGENTS.md](AGENTS.md) | 编码前 |

## 需求与决策

| 文档 | 路径 | 阅读时机 |
|------|------|---------|
| 技术规范 / 数据模型 | [docs/PRD.md](docs/PRD.md) | 改表结构、了解 pipeline 架构 |
| 曼联需求文档 | [docs/REQ-曼联信源监控.md](docs/REQ-曼联信源监控.md) | 曼联相关功能对齐（含信源资产与实测） |
| Anthropic 需求文档 | [docs/REQ-Anthropic信源监控.md](docs/REQ-Anthropic信源监控.md) | Anthropic 信源配置与验收 |
| Anthropic 决策纪要 | [docs/DECISION-Anthropic方案选型.md](docs/DECISION-Anthropic方案选型.md) | Anthropic 信源选型决策 |
| Dallas 需求文档 | [docs/REQ-Dallas信源监控.md](docs/REQ-Dallas信源监控.md) | Dallas 信源配置与验收 |
| Dallas 决策纪要 | [docs/DECISION-Dallas方案选型.md](docs/DECISION-Dallas方案选型.md) | Dallas 信源选型决策 |
| Dallas 执行计划 | [docs/PLAN-Dallas执行计划.md](docs/PLAN-Dallas执行计划.md) | Dallas 实施 checklist |
| 技术决策纪要 | [docs/DECISION-方案选型纪要.md](docs/DECISION-方案选型纪要.md) | 了解架构选型原因 |
| 前端原型 | [docs/prototype-board.html](docs/prototype-board.html) | 板块视图 UI 参照 |

## 进度与归档

| 文档 | 路径 | 阅读时机 |
|------|------|---------|
| 功能进度 / Bug | [docs/PROGRESS.md](docs/PROGRESS.md) | 了解完成状态、遗留项 |
| 历史归档（已完成的 PLAN/CHECKLIST/spec） | [docs/archive/README.md](docs/archive/README.md) | 回溯已落地需求的设计过程 |

## 代码入口

| 模块 | 路径 | 用途 |
|------|------|------|
| 主调度 | `src/index.js` | Pipeline 循环、交叉验证、报告生成 |
| 搜索 + 抓取 | `src/search.js` → `src/crawl4ai-fetch.js`（主）→ `src/scraper-direct.js`（降级） | 白名单信源逐源抓取 + HackerNews 兜底 |
| AI 评分 | `src/ai.js` | DeepSeek 评分 + 摘要 + event/category |
| 交叉验证 | `src/crosscheck.js` | event 聚类 + 置信度/印证数/冲突标记 |
| 配置 / item 规整 / 日报 | `src/config.js` / `src/items.js` / `src/report.js` | env+常量集中 / toItem / buildReport |
| 数据访问 | `src/store.js` (Supabase) | keywords / keyword_sources / articles CRUD |
| Tier 工具 | `src/tiers.js` + `src/source-tiers.json` | URL 域名 → Tier 映射 |
| 前端 | `client/src/` | React SPA，直连 Supabase |

## 输出

| 类型 | 路径 | 说明 |
|------|------|------|
| 日报 | `reports/YYYY-MM-DD.md` | 每次运行时自动生成 |
