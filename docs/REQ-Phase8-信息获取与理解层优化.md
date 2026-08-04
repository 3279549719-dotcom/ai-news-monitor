# REQ: Phase 8 — 信息获取与理解层优化

> 状态: Draft ｜ 创建: 2026-08-04 ｜ 关联: PRD、REQ-Dallas信源监控、REQ-Phase7-AI分析优化
> 方法: 前端实测暴露问题 → 4 路 subagent 调研（时效性/分类/摘要/信源健康）定位根因 → 本 REQ 定义修复范围与验收标准

---

## 一、背景：前端暴露的 4 类问题

用户打开前端（BoardView + ArticleFeed）实测后反馈：

| # | 问题 | 现象 | 实例 |
|---|------|------|------|
| ① | **摘要车轱辘话** | 摘要只说"续约对象为锋线球员""这一举措回应了关切"，不点名、没数字，还得点进原文才看到真事实 | "What Mavericks Extending Naji Marshall Means..." → 摘要未点名 Naji Marshall |
| ② | **付费墙信源体验差** | 点文章链接就要订阅，尤其 Dallas Morning News | dallasnews.com 计量墙（10篇/30天） |
| ③ | **分类不准确** | 文章进错板块 | BBC Yoro 个人访谈被归为 `injury`（伤病） |
| ④ | **时效性差** | 旧闻冒充新 | 6月8日 Guardian 文章在 8月4日显示为"3小时前" |

---

## 二、根因（4 路调研结论，已实锤）

### 2.1 三个跨关键词结构性缺陷

| 缺陷 | 根因 | 证据 |
|------|------|------|
| **假日期** | 三条抓取通道全硬编码 `publishedAt: new Date()`（首次被抓时间冒充发布日期）；`filterNewItems` 纯 URL 去重；前端按 `created_at` 排序 | `crawl4ai-fetch.js:150,193`、`scraper-direct.js:57`、`items.js:14` |
| **AI 无正文** | `items.js:13` 把 `snippet` 写死为空；`analyzeResult` 只喂标题 → 摘要只能复述标题、分类只能望文生义 | A4 事实率仅 9% |
| **分类/数据脏** | 分类指令"选最贴切"无证据门控、禁选 `other`、MU schema 无 `other` 键；Yahoo 导航垃圾漏网；BR/Moneyball/Cuban 0 产出 | Yoro 案例 `category=injury, score=85` |

### 2.2 附加 bug（调研顺带发现）

| Bug | 说明 | 影响 |
|-----|------|------|
| anthropic `category_schema` 是 JSON 数组 | `buildCategoryHint` 用 `Object.entries` → 数字键 `"0"~"6"` | AI 输出数字分类，已污染 30 行 |
| MU schema 8 键 vs 前端 5 板 | `rumour/conflict/academy_women` 无对应板块 | 板块视图静默丢弃文章 |
| A4 验收正则不认专名 | 只匹配"万/亿/欧元/美元/人/%/第X" | 模型写了人名也判 0，9% 有一半是测出的假象 |

---

## 三、需求范围（P0+P1+P2 全量）

### P0 获取层·数据卫生（低风险，先行）
1. Yahoo 导航垃圾四件套：`isNonArticleUrl` 加固 + `isSpamTitle` 标题过滤 + Yahoo pattern 收紧 `\.html$` + 快路径护栏
2. 0 产出源修复：Bleacher Report pattern → `/\/articles\//`；Mavs Moneyball / Smoking Cuban 抓取加 `wait_for`
3. 日期链路：新增 `src/dates.js`（URL 正则提取真实日期）→ 三通道改 `提取或 null` → 回填脚本修历史假日期
4. anthropic 数组 bug：`buildCategoryHint` 加 `Array.isArray` 分支

### P1 理解层·AI 重写
5. Prompt v2：摘要 6 铁律（不编造/首句即结论/要点是增量/为什么重要落地/禁词表/字数上限）+ 正反例
6. 分类指令 v2：体裁前置 + 证据门控 + `other` 兜底；MU schema 补 `other`
7. **正文喂养**：复用 crawl4ai 通道对相关 Top-N（`RESULT_LIMIT=15`）抓正文，单轮喂 `analyzeResult`（不引入两轮 LLM，尊重 Phase7 约束）
8. 验收 v2：A4a 事实锚点（标题回显专名）+ A4b 信息增量 + A4c 无空话
9. 前端时效：30 天 recency 窗口（T0 豁免）+ 按 `published_at` 排序 + 日期正确展示
10. `event_type` 体裁轴落地（提取 + 入库 + 卡片徽章）

### P2 信源整治
11. **DMN 保留并标注"正文需订阅"**（用户决策——本地最强跟队 Townsend/Caplan 独家，删了永久缺失）
12. 新增 HoopsHype Mavs tag（已实测 crawl4ai 可达）
13. ClutchPoints / r/Mavericks：实施时实测可达才加，否则记入待测候选

---

## 四、验收标准

### 读者视角
| # | 验收项 | 通过标准 |
|---|--------|----------|
| 1 | **摘要可操作** | 随机抽 5 篇，不点原文能说清"发生了什么+关键事实+为什么重要"；无"这一举措/该球员/对X而言这意味着"类空话 |
| 2 | **分类可信** | 随机抽 10 篇 ≥8 篇分类合理；访谈/特写不落 injury/transfer 等事件板 |
| 3 | **无垃圾** | 入库文章无导航垃圾（Schedule/Stats/图片文件名等）；Yahoo 0 垃圾行 |
| 4 | **时效真实** | 抽查历史文章 `published_at` 为真实发布日期（6月旧文不再冒充"3小时前"）；非 T0 超过 30 天默认不显示 |
| 5 | **付费墙可预期** | DMN 卡片带"正文需订阅"角标，用户点之前就知道 |

### 机器判定（check-quality.js v2）
| # | 检查项 | 判定 |
|---|--------|------|
| A2 | 无空话 | 禁词表扩展后 0 命中（白名单放行诚实回退语） |
| A3 | 三段式完整 | ≥80% |
| A4a | 事实锚点 | 扩宽正则 + 标题回显专名，≥70% |
| A4b | 信息增量 | summary 与标题公共字符占比 <60% |
| A4c | 无空话硬约束 | 硬空话词 0 命中；要点不以"这/该/其/此"开头 |
| C1 | 标题词根 | 0 异常 |
| C3 | preFilter 工作 | 日志 `[PreFilter] N` 且 N>0（修 GBK 编码误报） |

### 数据层
| # | 检查项 | 判定 |
|---|--------|------|
| D1 | 无 off-schema 分类 | `category NOT IN (schema_keys)` 为 0；anthropic 无数字分类 |
| D2 | event_type 落库 | 相关文章 `event_type` 非空 |
| D3 | 0 产出源修复 | BR/Moneyball/Cuban 有产出（wait_for 生效） |

### 无回归
- `node --check src/*.js` + `npm test` 全绿（新增 `dates.test.js` + `ai.test.js` 黄金样本）
- 前端 `npm run type-check` + `npm run lint` + `npm run build` 全绿
- `node src/index.js` 端到端通过，三关键词均有产出，日报生成

---

## 五、不做（本期范围外）

- ❌ 不做 crosscheck 算法升级（embedding）
- ❌ 不删除 DMN（保留并标注）
- ❌ 不做 event_type 与板块的深度解耦（仅提取+入库+徽章）
- ❌ 不改 RLS（`keyword_sources` 未启用 RLS 记入遗留）
- ❌ 不新增第三方依赖
