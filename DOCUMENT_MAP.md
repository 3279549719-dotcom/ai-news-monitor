# DOCUMENT_MAP — ai-news-monitor

> ⚠️ 本文件只负责导航，不记录产品事实。路径变更时及时更新。
> 最后更新：2026-08-09

---

## 核心入口（必读）

| 文档 | 路径 | 阅读时机 |
|------|------|---------|
| 项目总览 + Hook | [CLAUDE.md](CLAUDE.md) | 每次新会话第一件事 |
| Agent 行为规范 | [AGENTS.md](AGENTS.md) | 编码前 |
| 已知陷阱 / 排错手册 | [docs/KNOWN_TRAPS.md](docs/KNOWN_TRAPS.md) | 遇到异常/报错/管道失败时 |
| 本地运行指南 | [docs/LOCAL_SETUP.md](docs/LOCAL_SETUP.md) | 新环境跑起 / 定时自动化 / 前端访问 |

## 需求与决策

| 文档 | 路径 | 阅读时机 |
|------|------|---------|
| 技术规范 / 数据模型 | [docs/PRD.md](docs/PRD.md) | 改表结构、了解 pipeline 架构 |
| 曼联需求文档 | [docs/REQ-曼联信源监控.md](docs/REQ-曼联信源监控.md) | 曼联相关功能对齐（含信源资产与实测） |
| Anthropic 需求文档 | [docs/REQ-Anthropic信源监控.md](docs/REQ-Anthropic信源监控.md) | Anthropic 信源配置与验收 |
| Dallas 需求文档 | [docs/REQ-Dallas信源监控.md](docs/REQ-Dallas信源监控.md) | Dallas 信源配置与验收 |
| 技术决策纪要 | [docs/DECISION-方案选型纪要.md](docs/DECISION-方案选型纪要.md) | 了解架构选型原因 |
| 三代理架构自审 | [docs/DECISION-三代理架构-自审评估.md](docs/DECISION-三代理架构-自审评估.md) | 三代理（Planner→Generator→Evaluator）架构对齐 Anthropic Harness 的自评 + 复盘 |
| 管线搬 GitHub 决策 | [docs/DECISION-管线搬GitHub-纯CI方案.md](docs/DECISION-管线搬GitHub-纯CI方案.md) | 每日管线搬 GitHub Actions 纯 CI 的决策（含 CI 无自愈、验证顺序） |
| 三代理工作流需求 | [docs/REQ-三代理工作流-P0双任务.md](docs/REQ-三代理工作流-P0双任务.md) | 三代理 P0 双任务（breaking-news push + pipeline 自愈）需求 |

### 历史 Phase 文档（已完成，供回溯）

| 文档 | 路径 | 阅读时机 |
|------|------|---------|
| Phase7 AI 分析优化 | [docs/REQ-Phase7-AI分析优化.md](docs/REQ-Phase7-AI分析优化.md) / [docs/DECISION-Phase7-AI分析优化.md](docs/DECISION-Phase7-AI分析优化.md) | 了解评分/摘要演进 |
| Phase8 获取层理解层 | [docs/REQ-Phase8-信息获取与理解层优化.md](docs/REQ-Phase8-信息获取与理解层优化.md) / [docs/DECISION-Phase8-获取层理解层优化.md](docs/DECISION-Phase8-获取层理解层优化.md) | 了解 published_at/snippet 改造 |
| Phase9 回填去重+空态 | [docs/REQ-Phase9-历史数据回填去重与前端空态.md](docs/REQ-Phase9-历史数据回填去重与前端空态.md) / [docs/DECISION-Phase9-历史数据回填去重与前端空态.md](docs/DECISION-Phase9-历史数据回填去重与前端空态.md) | 回填/去重/空态验收 |
| 架构借鉴 | [docs/REQ-架构借鉴-吸收开源成熟监控组件.md](docs/REQ-架构借鉴-吸收开源成熟监控组件.md) / [docs/DECISION-架构借鉴-吸收开源成熟监控组件.md](docs/DECISION-架构借鉴-吸收开源成熟监控组件.md) | 架构选型 |
| Anthropic 决策 | [docs/DECISION-Anthropic方案选型.md](docs/DECISION-Anthropic方案选型.md) | Anthropic 信源选型 |
| Dallas 决策 | [docs/DECISION-Dallas方案选型.md](docs/DECISION-Dallas方案选型.md) | Dallas 信源选型 |
| Harness 加固 | [docs/REQ-Harness加固-反馈验证闭环与架构约束.md](docs/REQ-Harness加固-反馈验证闭环与架构约束.md) / [docs/DECISION-Harness加固-反馈验证闭环与架构约束.md](docs/DECISION-Harness加固-反馈验证闭环与架构约束.md) | harness 自评 + 加固 |
| Loop 工程 | [docs/REQ-Loop工程-自主交付协议.md](docs/REQ-Loop工程-自主交付协议.md) | 自主交付协议候选 |

### 外部协作产物（superpowers）

| 文档 | 路径 | 阅读时机 |
|------|------|---------|
| X 记者计划 | [docs/superpowers/plans/2026-08-07-x-journalist-feed.md](docs/superpowers/plans/2026-08-07-x-journalist-feed.md) | X 链路设计回溯 |
| 邮件摘要 v1 | [docs/superpowers/plans/2026-08-08-email-digest.md](docs/superpowers/plans/2026-08-08-email-digest.md) | 邮件功能设计回溯 |
| 邮件摘要 v2 | [docs/superpowers/plans/2026-08-08-email-digest-v2.md](docs/superpowers/plans/2026-08-08-email-digest-v2.md) | 邮件增强设计回溯 |
| A1-A3 架构 | [docs/superpowers/plans/2026-08-09-架构借鉴-抓取通道数据化-增量幂等-通知分发.md](docs/superpowers/plans/2026-08-09-架构借鉴-抓取通道数据化-增量幂等-通知分发.md) | 抓取通道数据化设计 |
| X 记者 spec | [docs/superpowers/specs/2026-08-07-x-journalist-feed-design.md](docs/superpowers/specs/2026-08-07-x-journalist-feed-design.md) | X 链路技术设计 |
| 邮件摘要 spec | [docs/superpowers/specs/2026-08-08-email-digest-design.md](docs/superpowers/specs/2026-08-08-email-digest-design.md) | 邮件技术设计 |
| 管线搬 GitHub 计划 | [docs/superpowers/plans/2026-08-11-github-pipeline-three-agent.md](docs/superpowers/plans/2026-08-11-github-pipeline-three-agent.md) | 三代理实战实施计划（Planner→Generator→Evaluator 文件交接验证） |

### 三代理交接产物（2026-08-11 管线搬 GitHub 实战）

| 文档 | 路径 | 说明 |
|------|------|------|
| 实现 PLAN | [docs/PLAN-管线搬GitHub.md](docs/PLAN-管线搬GitHub.md) | Generator 唯一依据（含代码/工作流全文 + 验收命令 + 风险回滚） |
| Sprint Contract | [docs/SPRINT-20260811-github-pipeline.md](docs/SPRINT-20260811-github-pipeline.md) | 完成定义 + Evaluator 审核清单（C/V/S） |
| Planner 交接 | [docs/PLANNER_DONE.md](docs/PLANNER_DONE.md) | Planner → Generator 交接信号 |
| Generator 交接 | [docs/GENERATOR_DONE.md](docs/GENERATOR_DONE.md) | Generator → Evaluator 交接（含 A4 验收证据） |
| Evaluator 终审 | [docs/REVIEW-20260811-github-pipeline.md](docs/REVIEW-20260811-github-pipeline.md) | 独立复核 + PASS 结论 + 待实机项 |

## 执行与计划

| 文档 | 路径 | 阅读时机 |
|------|------|---------|
| Dallas 执行计划 | [docs/PLAN-Dallas执行计划.md](docs/PLAN-Dallas执行计划.md) | Dallas 实施 checklist |
| Phase8 执行计划 | [docs/PLAN-Phase8-获取层理解层优化.md](docs/PLAN-Phase8-获取层理解层优化.md) | Phase8 实施 checklist |
| 重构计划 | [docs/PLAN-重构计划.md](docs/PLAN-重构计划.md) | 重构方案 |
| 范围外改进清单 | [docs/FUTURE_IMPROVEMENTS.md](docs/FUTURE_IMPROVEMENTS.md) | 记录/查阅待处理改进 |

## 进度与 Bug

| 文档 | 路径 | 阅读时机 |
|------|------|---------|
| 功能进度 / Bug | [docs/PROGRESS.md](docs/PROGRESS.md) | 了解完成状态、遗留项 |

## 模板文件

| 文档 | 路径 | 用途 |
|------|------|------|
| Bug 台账模板 | [docs/BUG_TRACKER.md.template](docs/BUG_TRACKER.md.template) | 新建 Bug 追踪 |
| 业务流程模板 | [docs/BUSINESS_FLOW.md.template](docs/BUSINESS_FLOW.md.template) | 新建业务流程文档 |
| 产品设计模板 | [docs/PDD.md.template](docs/PDD.md.template) | 新建产品设计文档 |
| 技术规范模板 | [docs/PRD.md.template](docs/PRD.md.template) | 新建技术规范文档 |
| 进度模板 | [docs/PROGRESS.md.template](docs/PROGRESS.md.template) | 新建进度文档 |

## 会话记忆（按需读取，不自动加载）

| 文档 | 路径 | 阅读时机 |
|------|------|---------|
| 当前任务 / 最近操作 | [.remember/now.md](.remember/now.md) | 了解上次会话做了什么 |
| 近期（周级）记录 | [.remember/recent.md](.remember/recent.md) | 了解近期背景 |
| 历史归档记录 | [.remember/archive.md](.remember/archive.md) | 了解更早的上下文 |
| 每日记录 | `.remember/today-YYYY-MM-DD.md` | 按日期回溯 |

## HTML 产品页

| 文档 | 路径 | 用途 |
|------|------|------|
| 产品流程介绍 | [docs/pipeline-flowchart.html](docs/pipeline-flowchart.html) | 对外客户版流程图（浏览器打开） |
| Loop 三层拆解 | [docs/loop-explainer.html](docs/loop-explainer.html) | harness loop 讲解 + 就绪度诊断（浏览器打开） |
| 前端原型 | [docs/prototype-board.html](docs/prototype-board.html) | 板块视图 UI 参照 |

## 代码入口

| 模块 | 路径 | 用途 |
|------|------|------|
| 主调度 | `src/index.js` | Pipeline 编排入口（~130 行） |
| 管线阶段 | `src/pipeline-stages.js` | 5 阶段函数：fetchCandidates → analyzeAndCrosscheck → dedupe → assembleRecords → persist |
| 搜索 + 抓取 | `src/search.js` → `src/crawl4ai-fetch.js`（主）→ `src/scraper-direct.js`（降级） | 白名单信源逐源抓取 + HN 兜底 |
| X 账号 | `src/x-fetch.js` → `scripts/x-fetch-tweets.py`（twikit） | X 记者推文主通道 |
| AI 评分 | `src/ai.js` | DeepSeek 评分 + 摘要 + event/category |
| 交叉验证 + 去重 | `src/crosscheck.js` | event 聚类 + 去重 + collapseSameEvent |
| 配置 | `src/config.js` | 常量集中 + getSecret() 密钥闭包化 |
| 条目规整 | `src/items.js` | toItem / normalizeUrlKey / toArticleRecord |
| 词根过滤 | `src/keyword-roots.js` + `keyword-roots.json` | preFilter + 数据驱动词根表 |
| 信源等级 | `src/tiers.js` | getTier / applyTierFloor |
| 日报 | `src/report.js` | buildReport (Markdown) |
| 通知 | `src/notify.js` → `src/email.js` | 统一通知分发（email 收口） |
| 数据访问 | `src/store.js` (Supabase) | keywords / keyword_sources / articles CRUD |
| 通道数据化 | `src/fetch-chain.js` + `keyword_sources.backends` | 每信源降级链执行 |
| 增量幂等 | `src/seen.js` | 每源 200 条环形缓冲 |
| 遗留模块 | `src/legacy/` | scraper.js / reader.js（已废弃 blog 类型） |
| 前端 | `client/src/` | React SPA，直连 Supabase |
| CI 每日管线 | `.github/workflows/daily-pipeline.yml` | GitHub Actions 每日 08:00（cron UTC 00:00），动态 crawl4ai + `run-pipeline --ci` + 失败建 Issue |
| crawl4ai 冒烟 | `.github/workflows/crawl4ai-smoke.yml` | 手动 dispatch，验证镜像在 runner 独立启动 |
| 运维巡检 | `.github/workflows/ops-check.yml` | push 触发，跑 `npm run check` |

## 输出

| 类型 | 路径 | 说明 |
|------|------|------|
| 日报 | `reports/YYYY-MM-DD.md` | 每次运行时自动生成 |
| 前端视觉截图 | `screenshots/*.png` | Playwright 截图产物 |
| 文档架构审计报告 | 2026-08-09 由 Alice 生成，见 `F:\openclaw\.openclaw-autoclaw\workspace\ai-news-monitor-doc-architecture-report.html` |

## 归档（已完成，供回溯）

| 文档 | 路径 | 说明 |
|------|------|------|
| 归档入口 | [docs/archive/README.md](docs/archive/README.md) | 已完成的 PLAN/CHECKLIST/spec 列表 |
| C 盘整治记录 | [docs/archive/DISK-CLEANUP-2026-08-06.md](docs/archive/DISK-CLEANUP-2026-08-06.md) | Docker 数据迁移 + 清理 |
