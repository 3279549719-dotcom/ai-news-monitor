# DOCUMENT_MAP — ai-news-monitor

> ⚠️ 本文件只负责导航，不记录产品事实。路径变更时及时更新。

---

## 核心入口（必读）

| 文档 | 路径 | 阅读时机 |
|------|------|---------|
| 项目总览 + Hook | [CLAUDE.md](CLAUDE.md) | 每次新会话第一件事 |
| Agent 行为规范 | [AGENTS.md](AGENTS.md) | 编码前 |
| 本地运行指南 | [docs/LOCAL_SETUP.md](docs/LOCAL_SETUP.md) | 新环境跑起 / 定时自动化 / 前端访问 |

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
| ✅ Phase9 需求（回填去重+空态，已交付） | [docs/REQ-Phase9-历史数据回填去重与前端空态.md](docs/REQ-Phase9-历史数据回填去重与前端空态.md) | 历史数据回填/去重/前端空态验收 |
| ✅ Phase9 决策纪要（已交付） | [docs/DECISION-Phase9-历史数据回填去重与前端空态.md](docs/DECISION-Phase9-历史数据回填去重与前端空态.md) | 回填/去重/空态选型 + 执行结果偏差 |
| ✅ REQ：Harness 加固（反馈验证闭环+架构约束，Decided） | [docs/REQ-Harness加固-反馈验证闭环与架构约束.md](docs/REQ-Harness加固-反馈验证闭环与架构约束.md) | harness 自评 + 加固候选（用户已拍板均衡推荐） |
| ✅ DECISION：Harness 加固（采纳均衡推荐 A1+A2+A4+B1+B2） | [docs/DECISION-Harness加固-反馈验证闭环与架构约束.md](docs/DECISION-Harness加固-反馈验证闭环与架构约束.md) | 决策依据 + 实现设计 + 风险回滚 |
| 前端原型 | [docs/prototype-board.html](docs/prototype-board.html) | 板块视图 UI 参照 |
| 产品流程介绍 | [docs/pipeline-flowchart.html](docs/pipeline-flowchart.html) | 对外客户版流程图（无技术细节，浏览器打开，附 PNG 导出版） |

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
| 交叉验证 + 去重 | `src/crosscheck.js` | event 聚类 + 置信度/印证数/冲突标记 + 同事件去重（dedupeBySimilarity 双信号 / collapseSameEvent / dedupeAgainstExisting） |
| 配置 / item 规整 / 日报 | `src/config.js` / `src/items.js` / `src/report.js` | env+常量集中 / toItem / buildReport |
| 数据访问 | `src/store.js` (Supabase) | keywords / keyword_sources / articles CRUD |
| Tier 工具 | `src/tiers.js` + `src/source-tiers.json` | URL 域名 → Tier 映射 |
| 前端 | `client/src/` | React SPA，直连 Supabase |

## 输出

| 类型 | 路径 | 说明 |
|------|------|------|
| 日报 | `reports/YYYY-MM-DD.md` | 每次运行时自动生成 |
| 前端视觉截图 | `screenshots/*.png` | Phase9 起 Playwright 截图产物（`scripts/screenshot-ui.js`） |
