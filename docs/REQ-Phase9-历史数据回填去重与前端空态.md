# REQ: Phase 9 — 历史数据回填去重与前端空态优化

> 状态: **Implemented（2026-08-05 验收全绿）** ｜ 创建: 2026-08-05 ｜ 关联: PRD、REQ-Phase8-信息获取与理解层优化、REQ-Dallas信源监控
> 方法: Phase8 交付后用户复核 → 实测发现 3 类遗留问题 → 本 REQ 定义修复范围与验收标准
> 范围: 存量 305 篇相关文章回填重算（v2 修复模式扩至 score<60）/ 同事件三层去重（v3 双信号）/ 前端空态重构 / 前端截图能力
> 实施结果：见 DECISION-Phase9 §六 执行结果与偏差 + PROGRESS F-013

---

## 一、背景：Phase8 交付后复核发现的 3 类问题

Phase8（信息获取与理解层优化）交付后，用户复核前端发现以下遗留问题：

| # | 问题 | 现象 | 实例 |
|---|------|------|------|
| ① | **旧摘要错误** | 旧管线（正文喂养上线前）生成的历史摘要，把曼联主教练 Michael Carrick 当成球员写成"踢中卫/防守型中场" | Guardian `/football/2026/jul/29/manchester-united-michael-carrick-central-defence-...`，DB `score=70` |
| ② | **同事件重复** | 同一新闻事件跨信源、跨运行各存各的，前端显示内容几乎一致的多篇 | Naji Marshall 续约，DB 有 4 条 `score≥60`（BR/Yahoo/SI×2，同一事件不同信源措辞） |
| ③ | **前端空态大片空白** | `BoardView` 固定渲染 5 板块 + 今日概览卡片，空板块白卡占位，3 列网格形成大片空白 | Dallas/MU 板块视图，多数板块无内容时页面大部分空白 |

---

## 二、根因（已实锤）

### 2.1 旧摘要无法自我修复（重跑无效）

- `filterNewItems` 按 `(keyword_id, url)` 去重（RPC `get_new_urls`）→ 已入库 URL 重跑直接跳过 → **旧摘要永不重算**。
- 旧管线（Phase8 前）只喂标题，`snippet` 写死为空 → 摘要只能复述标题；且模型无 2026 时间线知识（不知 Carrick 已任曼联主帅）→ 望文生义。

### 2.2 去重粒度不足（仅 URL + 单次运行聚类）

- 去重仅 URL 级（`filterNewItems`）；`crosscheck.clusterByEvent` 只在**单次运行内**聚类（DECISION 方案B D-06：先做运行内聚类）。
- 同一事件跨运行、跨信源 → 多行入库。
- **实测 Naji 两条事件描述 bigram 相似度 ≈ 0.35 < crosscheck 阈值 0.4** → 单靠现有事件聚类无法合并。

### 2.3 前端结构性问题

- `BoardView` 固定渲染所有板块卡片（含空板块的"暂无内容"占位）+ 今日概览卡 → 内容稀疏时网格被空白白卡填满。
- 板块卡片字号过小（11px）、无视觉层次，内容少时更显空。

---

## 三、需求范围

### R1 历史数据回填重算（`scripts/backfill-resummarize.js` 新增）

- 全量 `score≥60` 相关文章（**305 篇**：MU 119 / Anthropic 100 / Dallas 86；blog 类型跳过）用 Phase8 正文喂养管线重算。
- 每篇：`crawl4ai.fetchArticleBody(url)` 抓正文（失败回落 `body=null`）→ `analyzeResult(query, title, snippet, tier, category_schema, body)` 重算 `summary/event/event_type/category/score` → 分批 `UPDATE articles`。
- 参数：`--dry-run`（预览清单+数量）、`--keyword <id>`、`--limit <N>`、`--days <N>`。
- **预期副作用**：旧行 `event_type` 从 null 补全；category 按新 schema 重归类；部分行 score 重算后可能跌出 60（属预期，前端隐藏）。

### R2 同事件去重（三层）

1. **同批合并**（`src/index.js`）：`crosscheck()` 后按事件聚类（复用 `crosscheck.clusterByEvent`），每簇保留 score 最高一篇，其余丢弃并 log。代表行自动携带全簇 `corroboration_count`（`computeConfidence` 按簇赋值），不丢失多源印证语义。
2. **跨运行防重**（`src/crosscheck.js` + `src/store.js` + `src/index.js`）：
   - `store.js` 新增 `loadRecentRelevant(keywordId, days=30)`：近 30 天 `score≥60` 文章 `{id, event, title}`。
   - `crosscheck.js` 新增纯函数 `dedupeBySimilarity(candidate, existing)`（**去重 v3 双信号**，经真实数据校准取代 v1 初稿，见 DECISION §一.2）：
     ```
     归一化：lowercase、去数字/货币/标点（消 "52.2M" vs "52.5M" 噪声）
     规则A 文本高相似：evSim ≥ 0.60 且 tSim ≥ 0.45 且 动作兼容 → 明确同事件
     规则B 专名+动作：evSim ≥ 0.15 且 共享特有专名 且 同动作组 → 同人同事件
     任一侧 event 为空 → 不判重；聚类 seed-only（禁链式传递）
     ```
   - `index.js`：对 `event` 非空的代表行与 `loadRecentRelevant` 结果比对，命中 → 跳过入库并 log（"同事件已存在"）。
3. **存量清理**（`scripts/dedup-existing.js` 新增）：按 keyword 加载近 30 天 `score≥60` 文章，用 B2 规则聚类；`--dry-run`（默认）输出"保留+待删"清单，`--apply` 每簇保留最高分（并列取先入库）一篇并 `DELETE ... RETURNING`。**预期**：Naji 4 条 → 1 条。

### R3 前端空态与密度（frontend-design skill）

- **空板块不渲染**（结构性消灭空白）；某关键词全部为空时渲染行动导向空态（"近 30 天暂无相关新闻" + 引导切"显示旧闻"）。
- **今日概览卡**仅在有文章时显示。
- 签名元素：卡片左侧 3px **Tier 色条**（T0 红 / T1 琥珀 / T2 灰）+ 板块标题**数量徽章**（"交易签约 · 4"）。
- 密度：缩小卡片 padding、字号 11px→12/13px、xl 下 2 列。
- `KeywordsTab` 板块视图加"显示旧闻"开关（复用 `includeOld` 语义）。

### R4 前端视觉查看能力

- `package.json` 根 devDependencies 加 `playwright-core`（不下载浏览器；浏览器已装 `C:\Users\asus\AppData\Local\ms-playwright`）。
- `scripts/screenshot-ui.js` 新增：headless chromium 打开 `--url`，`--wait` 后全页截图到 `--out`，支持 `--width/--height`。
- 背景：crawl4ai 容器 SSRF 保护无法访问 localhost（已实测 `URL blocked (SSRF protection)`），故本地视觉验证改走 Playwright。

---

## 四、验收标准

### 数据层
| # | 检查项 | 判定 | 结果（2026-08-05） |
|---|--------|------|------|
| D1 | 回填完成 | 305 篇全部处理，`event_type` 非空率从 ~0% 升至 ≥90%（正文可抓者） | ✅ v2 修复模式 324 篇 0 失败；正文缺失 41（12.7%）；ge60 event_type 率 65/72=90%；恢复可见 48 条 |
| D2 | 旧摘要修正 | Carrick 文章摘要不再把主帅当球员（SQL 抽查该 URL 行） | ✅ score 90，摘要把 Carrick 识别为主教练（列五名中卫名单） |
| D3 | 同事件去重 | Naji 续约 score≥60 由 4 条 → 1 条；新增管线运行不再重灌已存在事件 | ✅ 4→1（SQL 确认）；可见相关文章 82 篇（MU 29/Anth 33/Dallas 10/blog 10） |
| D4 | 管线回归 | `node src/index.js` 端到端通过，无重复事件新增 | ✅ 通过 |

### 前端
| # | 检查项 | 判定 | 结果（2026-08-05） |
|---|--------|------|------|
| F1 | 无空白占位 | 空板块不再渲染；全空关键词显示行动导向空态 | ✅ 截图验证（BoardView 空板块隐藏 + 空态引导） |
| F2 | 视觉签名 | Tier 色条 + 数量徽章渲染正确 | ✅ `screenshots/ui-board-dallas.png` / `ui-board-mu.png` |
| F3 | 截图验证 | `screenshot-ui.js` 抓取空态/有内容两态，无大片空白 | ✅ playwright-core 截图链路可用 |

### 无回归
- `node --check src/*.js scripts/*.js` + `npm test`（新增 `dedupeBySimilarity` 用例）全绿
- 前端 `cd client && npm run type-check && npm run lint && npm run build` 全绿

---

## 五、不做（本期范围外）

- ❌ **初定不清理 score<60 隐藏行**（292 篇）——但 v1 回填暴露 210 篇被压垮后，**v2 修复模式已重算 score<60 的 324 篇**（含恢复可见 48 条，google-news 240 死链行除外并清零）
- ❌ 不做跨运行事件语义匹配升级（无 embedding）
- ❌ 不改 RLS
- ❌ 不重设计 header/nav / FilterSortBar / ArticleFeed 分页（非投诉点）
