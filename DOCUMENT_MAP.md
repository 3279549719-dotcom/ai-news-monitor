# DOCUMENT_MAP — ai-news-monitor

导航索引，只记录路径，不记录产品或技术事实。

| 职责 | 路径 | 说明 |
|---|---|---|
| 项目协作规范 | `AGENTS.md` | Agent 行为规则与索引 |
| 产品需求与技术规范 | `docs/PRD.md` | 技术栈、模块、数据模型、验证要求 |
| 项目进度 | `docs/PROGRESS.md` | 功能进度与 Bug 记录 |
| 每日报告输出 | `reports/YYYY-MM-DD.md` | 自动生成，每次运行产出 |
| 前端（SPA） | `client/` | React18 + TypeScript + Vite + Tailwind，直连 Supabase |
| 入口 | `src/index.js` | 主流程与报告生成 |
| 信息源抓取 | `src/scraper.js` | claude.com/blog 文章列表 |
| 文章正文读取 | `src/reader.js` | 单篇文章正文提取 |
| AI 评分与摘要 | `src/ai.js` | DeepSeek API 调用，search 类型评分（≥60 相关） |
| 数据访问层 | `src/store.js` | Supabase：loadKeywords、filterNewItems（RPC）、saveArticles |
