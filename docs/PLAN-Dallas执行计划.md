# PLAN: Dallas Mavericks 信源监控 — 执行计划

> 创建: 2026-08-04 ｜ 范围: F-010 Dallas 白名单信源 + 前端 BoardView 扩展
> 参考: PLAN-方案A执行计划.md（MU 执行计划）

---

## 当前状态总览

| 模块 | 状态 | 备注 |
|------|------|------|
| `keyword_sources` 表 | ✅ 已存在 | dallas-mavericks 当前 0 行 |
| `articles` 表 | ✅ 已存在 | Dallas 0 篇文章 |
| `keywords` 表 | ✅ dallas-mavericks 已启用 | category_schema 为通用 4 类（需更新） |
| `src/crawl4ai-fetch.js` | ✅ 需新增 Dallas ARTICLE_PATTERNS |  |
| `src/source-tiers.json` | ✅ 需新增 Dallas 域名映射 |  |
| 前端 BoardView | ✅ 已有 MU_BOARDS + GENERIC_BOARDS | 需新增 DAL_BOARDS |
| 前端 KeywordsTab | ✅ 仅 MU 走 BoardView | 需扩展 showBoard 条件 |
| crawl4ai 容器 | ✅ 在线 | `docker ps` 确认 healthy |

---

## 执行步骤

### Phase 1: 后端数据迁移

- [x] **P1-1** 清理 dallas-mavericks 旧 keyword_sources（如有）
- [x] **P1-2** 插入 5 条信源：NBA Mavs News (T0) + Marc Stein (T1) + Dallas Morning News + Yahoo Sports + Bleacher Report (T2)
- [x] **P1-3** 更新 dallas-mavericks category_schema 为 8 类 NBA 模板
- [x] **P1-4** 验证 Supabase 数据：`SELECT * FROM keyword_sources WHERE keyword_id='dallas-mavericks'`

### Phase 2: 后端代码改动

- [x] **P2-1** `src/source-tiers.json`：新增 nba.com(0) / dallasnews.com(2) / sports.yahoo.com(2) / bleacherreport.com(2)
- [x] **P2-2** `src/crawl4ai-fetch.js` ARTICLE_PATTERNS：新增 4 组 Dallas URL 模式
- [x] **P2-3** 语法检查：`node --check src/crawl4ai-fetch.js`
- [x] **P2-4** 单元测试：`npm test` 22 例全过

### Phase 3: 前端 BoardView 扩展

- [x] **P3-1** `client/src/lib/constants.ts`：新增 `DAL_KEYWORD_ID = 'dallas-mavericks'`
- [x] **P3-2** `client/src/components/BoardView.tsx`：新增 `DAL_BOARDS`（5 板块定义）
- [x] **P3-3** `client/src/components/KeywordsTab.tsx`：扩展 showBoard 条件（MU 或 DAL）
- [x] **P3-4** 前端 build 验证：`cd client && npm run build`

### Phase 4: 端到端验证

- [x] **P4-1** `node src/index.js` 运行，确认 dallas-mavericks 产出文章入库
- [x] **P4-2** Supabase `articles` 表 `keyword_id='dallas-mavericks'` 有新记录
- [x] **P4-3** 日报 `reports/YYYY-MM-DD.md` 包含 Dallas 内容
- [x] **P4-4** 前端 MU Tab BoardView 不受影响（回归验证）
- [x] **P4-5** 前端 Anthropic Tab ArticleFeed 不受影响（回归验证）

### Phase 5: 文档 + Git

- [x] **P5-1** 更新 `CLAUDE.md`：新增 Dallas 关键约束 + 已知陷阱
- [x] **P5-2** 更新 `DOCUMENT_MAP.md`：新增 Dallas REQ/DECISION 导航
- [x] **P5-3** 更新 `docs/PROGRESS.md`：新增 F-010 条目
- [x] **P5-4** Git commit：后端 + 前端 + 文档

---

## 最终交付物（给你的验收材料）

1. **终端日志** — `node src/index.js` 完整运行结果，关键看 Dallas 段抓取成功日志
2. **Supabase 数据** — `articles` 表中 Dallas 新记录
3. **Markdown 日报** — `reports/` 目录下当日报告
4. **前端截图** — Dallas Tab → BoardView 板块视图（5 板块 + 今日概览）
5. **验证清单打勾表** — 下面 checklist 逐项 ✅
