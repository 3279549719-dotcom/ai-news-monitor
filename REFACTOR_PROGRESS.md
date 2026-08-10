# 重构进度 — 已完成

## 完成时间
2026-08-10 22:30

## 改动总结 — 第二轮

| # | 改动 | 涉及文件 | 效果 |
|---|------|----------|------|
| 1 | 管线阶段独立 | **pipeline-stages.js**（新） | 5 阶段函数从 index.js 迁出：fetchCandidates / analyzeAndCrosscheck / dedupeAgainstRecent / assembleRecords / persist。每个阶段可独立测试 |
| 2 | index.js 纯编排 | index.js | 从 ~380 行降到 ~130 行，只剩 processKeyword 编排 + run 入口 |
| 3 | 配置安全分离 | config.js | 敏感 key（DEEPSEEK_API_KEY / SUPABASE_KEY 等）移入闭包，通过 getSecret() 访问。`console.log(require('./config'))` 不再泄露密钥 |
| 4 | 下游适配 | ai.js / db.js / crawl4ai-fetch.js / email.js / x-fetch.js | DEEPSEEK_API_KEY 等改为 getSecret() 调用 |
| 5 | 测试修复 | email.test.js | FULL_CFG 适配 getSecret |
| 6 | 文档同步 | CLAUDE.md / DOCUMENT_MAP.md | 新增 pipeline-stages.js / keyword-roots.json / legacy/ 目录说明 |

## 验证
- npm test: 113/113 pass
- npm run lint:backend: 58/58 ok（新增 pipeline-stages.js）
- node --check: 全部通过
- 向后兼容: module.exports 未变，scripts/ 引用完好

## 两轮合计
- index.js: 410 行 → ~130 行（瘦身 68%）
- 新增模块: pipeline-stages.js, keyword-roots.json
- 函数归位: preFilter→keyword-roots, applyTierFloor→tiers, toArticleRecord→items
- 配置安全: 敏感 key 闭包化
- 遗留隔离: scraper.js/reader.js→legacy/
