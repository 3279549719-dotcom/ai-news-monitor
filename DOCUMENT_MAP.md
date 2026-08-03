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
| 曼联需求文档 | [docs/REQ-曼联信源监控.md](docs/REQ-曼联信源监控.md) | 曼联相关功能对齐 |
| 技术决策纪要 | [docs/DECISION-方案选型纪要.md](docs/DECISION-方案选型纪要.md) | 了解架构选型原因 |
| 执行计划 | [docs/PLAN-方案A执行计划.md](docs/PLAN-方案A执行计划.md) | 落地实施参照 |
| 方案BC计划 | [docs/PLAN-方案BC执行计划.md](docs/PLAN-方案BC执行计划.md) | 交叉验证+板块视图开发参照 |
| 验收清单 | [docs/CHECKLIST-方案A验收清单.md](docs/CHECKLIST-方案A验收清单.md) | 验证是否完成 |
| 前端原型 | [docs/prototype-board.html](docs/prototype-board.html) | 板块视图 UI 参照 |

## 进度与 Spec

| 文档 | 路径 | 阅读时机 |
|------|------|---------|
| 功能进度 / Bug | [docs/PROGRESS.md](docs/PROGRESS.md) | 了解完成状态、遗留项 |
| Spec 001（信源分级） | [specs/001-expand-search-sources/](specs/001-expand-search-sources/) | 了解 Tier 基础设施设计 |
| Spec 002（Firecrawl 直抓） | [specs/002-firecrawl-mcp-tiered-fetch/](specs/002-firecrawl-mcp-tiered-fetch/) | 了解抓取管线设计（注意：Firecrawl API 已停用） |

## 代码入口

| 模块 | 路径 | 用途 |
|------|------|------|
| 主调度 | `src/index.js` | Pipeline 循环、报告生成 |
| 搜索 + 抓取 | `src/search.js` → `src/scraper-direct.js` | 白名单信源直抓 + HackerNews 兜底 |
| AI 评分 | `src/ai.js` | DeepSeek 评分 + 摘要 |
| 数据访问 | `src/store.js` (Supabase) | keywords / keyword_sources / articles CRUD |
| Tier 工具 | `src/tiers.js` + `src/source-tiers.json` | URL 域名 → Tier 映射 |
| 前端 | `client/src/` | React SPA，直连 Supabase |

## 输出

| 类型 | 路径 | 说明 |
|------|------|------|
| 日报 | `reports/YYYY-MM-DD.md` | 每次运行时自动生成 |
