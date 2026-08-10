# 重构进度

## 已完成
- ✅ S1 审计：18 模块全读，8 问题识别，3 方案对比 HTML
- ✅ S2 配置层：config.js 新增 T0_FLOOR/T1_FLOOR/PIPELINES 常量
- ✅ S2 词根数据化：keyword-roots.json + preFilter 移入 keyword-roots.js
- ✅ S2 toArticleRecord：从 index.js 迁入 items.js
- ✅ S2 applyTierFloor：从 index.js 迁入 tiers.js
- ✅ S2 legacy 隔离：scraper.js/reader.js → src/legacy/
- ✅ S2 npm test：113/113 全绿 (worktree: E:\claude\ai-news-config)

## 进行中
- 🔄 S3 目录分层重组

## 待做
- ⬜ S4 全量 require 路径更新
- ⬜ S5 循环依赖修复 (notify↔email)
- ⬜ S6 scripts/ 引用检查
- ⬜ S7 npm test + npm run lint 全绿
- ⬜ S8 合并到 master
