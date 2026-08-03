# PLAN: 方案B（交叉验证）+ 方案C（板块视图）执行计划

> 创建: 2026-08-03 ｜ 配套: docs/REQ-曼联信源监控.md §7、docs/DECISION-方案选型纪要.md 追加决策
> 前置: 方案A 已落地（F-005，2026-08-03 端到端验证通过）

---

## 目标

1. **交叉验证**：AI 输出事件描述 → 聚类 → 印证加分/单源降权 → T0 冲突标记 → 置信度展示
2. **板块分类**：关键词级模板，AI 输出 category，articles 加列
3. **前端板块视图**：照原型图改造（2行3列网格 + 今日概览卡）

---

## 执行步骤

### Phase 1: 数据库迁移（Supabase）

- [ ] **T1-1** articles 表加 5 列：`category` / `event` / `confidence` / `corroboration_count` / `conflict_flag`
- [ ] **T1-2** keywords 表加 1 列：`category_schema JSONB`
- [ ] **T1-3** 为 manchester-united 插入 MU 专属模板（8 类），为其他 3 个关键词插入通用模板（4 类）
- [ ] 验证：`SELECT column_name FROM information_schema.columns` 确认新列存在

### Phase 2: 后端交叉验证（src/ai.js + src/index.js）

- [ ] **T2-1** `analyzeResult` 输出扩展：`{score, summary, event, category}`（prompt 加要求）
- [ ] **T2-2** 新增 `src/crosscheck.js`：
  - `clusterByEvent(articles)` — 按 event 字符串模糊聚类（本次运行内）
  - `computeConfidence(cluster)` — 组内源数×Tier 计算：≥2 源高置信 / 1 源中置信 / 与 T0 冲突 → low + conflict_flag
- [ ] **T2-3** `index.js` 管线接入：analyzeItems 后 → crosscheck → saveArticles 写入新字段
- [ ] **T2-4** 日报（buildReport）按 category 分组输出（官方/转会/伤病/管理/赛事 + 传闻/冲突折叠区）

### Phase 3: 前端板块视图（client/src/）

- [ ] **T3-1** 数据层：`useArticles` 查询加 `category`、`confidence`、`corroboration_count`、`conflict_flag` 字段
- [ ] **T3-2** 新组件 `BoardView.tsx`：2行3列网格布局（照 docs/prototype-board.html）
  - 板块1 官方公告（红框置顶） / 板块2 转会合同 / 板块3 伤病停赛 / 板块4 管理层教练组 / 板块5 赛事竞技 / 板块6 今日概览
- [ ] **T3-3** 卡片升级：分类标签（蓝色胶囊）+ 置信度徽章（高/中/低）+ 印证数
- [ ] **T3-4** 关键词切换：MU 用 BoardView（按 category_schema 渲染板块），其他关键词用通用模板视图
- [ ] **T3-5** 顶部筛选栏保持：Tier / 搜索 / 时间 / 排序

### Phase 4: 验证

- [ ] **T4-1** `node --check src/*.js` 全部通过
- [ ] **T4-2** `node src/index.js` 完整运行，日志显示聚类结果（如 `[Crosscheck] 事件"乌加特转会" 3源印证 → high`）
- [ ] **T4-3** Supabase 查询新字段有值（category 非 NULL，confidence 正确）
- [ ] **T4-4** 前端 localhost 显示板块视图，卡片带分类标签 + 置信度
- [ ] **T4-5** 回归：其他关键词（Anthropic 等）正常展示

---

## 最终交付物（验收材料）

1. 终端日志（聚类 + 置信度输出）
2. Supabase 数据（新字段填充）
3. 前端板块视图截图（照原型图）
4. Markdown 日报（按板块分组）
5. 验证清单打勾表

---

## 风险与备注

- **event 聚类质量**：依赖 AI 事件描述一致性，轻量版（本次运行内）误差可控；如聚类效果差，可退回"按标题关键词分组"或升级标准版（7 天窗口）
- **AI 调用量**：每次运行多 1 次聚类调用（≤15 条文章），成本增量极小
- **前端兼容**：旧数据（无 category）显示为"未分类"，不阻塞
