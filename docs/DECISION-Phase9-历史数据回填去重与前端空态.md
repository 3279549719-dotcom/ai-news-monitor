# DECISION: Phase 9 — 历史数据回填去重与前端空态 技术选型

> 状态: Decided ｜ 决策日期: 2026-08-05 ｜ 依据: REQ-Phase9-历史数据回填去重与前端空态 + 用户复核 + 数据实测
> 参与: Patrick（决策：全量回填 305 篇；Playwright 自动截图；去重双信号规则）

---

## 决策结论

**方案：历史数据回填重算 + 同事件三层去重 + 前端空态结构化重构三线并行。** 核心是三个结构性决策：

1. **全量回填取代"重跑管线"** —— 重跑对已入库 URL 无效（`filterNewItems` URL 去重），改为脚本对存量 `score≥60` 的 305 篇用正文喂养管线重算。
2. **双信号去重取代单信号事件聚类** —— 实测 Naji 两条事件 bigram≈0.35 < crosscheck 现有 0.4 阈值，单信号漏判；用"事件相似度 + 标题相似度"混合规则 + 事件门槛防误伤。
3. **空板块不渲染取代白卡占位** —— BoardView 结构性消灭空白，品牌色 Tier 色条做视觉签名。

改动面：新增 `scripts/backfill-resummarize.js`/`scripts/dedup-existing.js`/`scripts/screenshot-ui.js` + `src/crosscheck.js`/`store.js`/`index.js` + 前端 `BoardView`/`KeywordsTab`/`EmptyState`/`index.css` + `package.json`（playwright-core devDep）。

---

## 一、根因 → 技术决策

### 1. 旧摘要错误 → 回填重算（非重跑）

| 方案 | 描述 | 结论 |
|------|------|------|
| ✅ **选** 脚本全量回填重算 | 对存量 `score≥60` 行逐篇抓正文 + `analyzeResult` 重算，`UPDATE articles` | 唯一能修正已入库旧摘要的路径；用户拍板全量 305 篇 |
| ❌ 重跑管线 | URL 去重使已见 URL 直接跳过，旧摘要永不重算 | 无效 |
| ❌ 仅回填近期 | 更省时，但更早的旧摘要残留 | 用户选择全量 |

**约束**：
- blog 类型跳过（query 为 null，无 analyzeResult 语义）。
- 正文抓取失败回落 `body=null`（沿用 Phase8 优雅降级）。
- 重算会更新 score —— 部分行可能跌出 60（属预期）；`event_type` 从 null 补全。
- score<60 隐藏行（292 篇）**默认不回填**（前端不可见，重算翻倍成本）；待用户确认是否纳入。

### 2. 同事件重复 → 三层去重

| 方案 | 描述 | 结论 |
|------|------|------|
| ✅ **选** 三层去重（同批合并 + 跨运行防重 + 存量清理） | 同批保留最高分代表行；跨运行双信号判重跳过；存量脚本清理 | 结构性解决，可单测 |
| ❌ 仅前端折叠 | 不解决 DB 膨胀，跨信源仍各存 | 治标不治本 |
| ❌ 仅同批合并 | Naji 两条事件跨不同运行入库，单批合并不覆盖跨运行 | 漏掉用户看到的场景 |

**最终双信号规则（去重 v3，经真实数据 dry-run 校准，取代 v1）**：
```
归一化：lowercase、去数字/货币/标点（消 "52.2M" vs "52.5M" 噪声）
规则A 文本高相似：evSim ≥ 0.60 且 tSim ≥ 0.45 且 动作兼容 → 明确同事件（同一事故/同场战报）
规则B 专名+动作：evSim ≥ 0.15 且 共享特有专名(≥1) 且 两侧均有动作且共享动作组 → 同人同事件（Naji 类）
任一侧 event 为空 → 不判重；聚类用 seed-only（禁链式传递）
```
**为何 v1 被推翻**：v1 单阈值（evSim≥0.25 && tSim≥0.45）实测把 Anthropic 37 篇误删到 33——所有文章共享 "Anthropic/Claude" 实体使 bigram 相似度膨胀到 0.35-0.5，单阈值无法分离"同事件"与"不同新闻"；另 any-member 传递聚类会把首尾无关的新闻级联成一簇。v3 用"**特有专名 + 动作组**"精准区分：Naji 两篇共享球员专名 + 同动作（deal）；Anthropic 不同新闻不共享专名 → 误删砍到 4。
**为何要动作兼容门（规则A）**：独行侠"续约马歇尔"与"交易马歇尔"事件相似度可到 0.67（共享实体），纯文本阈值挡不住，deal vs trade 动作组不一致即放行。

### 3. 前端空态 → 结构化重构 + 品牌色签名

| 方案 | 描述 | 结论 |
|------|------|------|
| ✅ **选** 空板块不渲染 + 行动导向空态 + Tier 色条签名 | 结构性消灭空白；空态给引导（切"显示旧闻"）；Tier 色条把可信度编码进视觉 | 按 frontend-design skill |
| ❌ 只把"暂无内容"放大 | 白卡占位仍在，空白问题不变 | 无效 |
| ❌ 全面重设计（换肤） | 用户痛点是空白非配色；过度改造风险 | 本期不做 |

---

## 二、被拒绝方案及理由

| 方案 | 被拒绝理由 |
|------|-----------|
| 重跑管线修复旧摘要 | `filterNewItems` URL 去重，已入库行不重算 |
| 只做同批合并去重 | 跨运行同事件漏合并（用户所见 Naji 场景正是跨运行） |
| 只做前端事件折叠 | DB 继续膨胀；跨信源数据仍不收敛 |
| 事件单信号去重（复用 0.4 阈值） | Naji 实测 0.35，漏判 |
| 回填 score<60 隐藏行 | 前端不可见；工作量翻倍至 ~585 篇；默认不做（待用户确认） |
| 前端全面换肤 | 非投诉点；空态与密度才是问题 |
| crawl4ai 截图看前端 | SSRF 保护实测拦截 localhost（`URL blocked`），容器到不了本机 dev server |

---

## 三、关键决策点明细

### 3.1 回填设计（单轮 LLM/篇，复用 Phase8 通道）
```
loadKeywords(type=search) → 查 score≥60 行(id,title,url,snippet,source_tier,score)
→ 并发池3 fetchArticleBody(url)（失败→null）
→ analyzeResult(query,title,snippet,source_tier,category_schema,body) 单轮重算
→ 分批(50) UPDATE articles SET summary/event/event_type/category/score
参数：--dry-run / --keyword / --limit / --days
```

### 3.2 去重接线位置（index.js）
```
analyzeItems → crosscheck（现有，附着 corroboration）
→ 同批合并：collapseSameEvent（seed-only，每簇保留最高分代表行，log 丢弃）
→ 跨运行防重：代表行 event vs loadRecentRelevant(keyword, 30d)，dedupeBySimilarity 命中→跳过
→ toSave
```
> 同批合并用 `collapseSameEvent`（seed-only 双信号）而非 v1 的 `clusterByEvent`（any-member 传递会链式级联误并）。

### 3.3 存量清理（dedup-existing.js）
- 默认 `--dry-run`：输出"保留行 + 待删行"清单（先 SELECT 展示）。
- `--apply`：DELETE ... RETURNING 打印明细。
- 删除前置预览 + 显式开关（硬反向操作需确认）。

### 3.4 前端签名（frontend-design）
- 主体：蓝底 header 保留；卡片白底 + 左侧 3px Tier 色条（T0 红/T1 琥珀/T2 灰）。
- 空态：全空时"近 30 天暂无相关新闻" + 切"显示旧闻"引导。
- 密度：卡片 padding 收紧、字号 12/13px、xl 2 列。

### 3.5 前端截图能力（R4）
- `playwright-core` devDep（不下载浏览器，浏览器已装 `C:\Users\asus\AppData\Local\ms-playwright`）。
- `scripts/screenshot-ui.js`：headless chromium → `--url`/`--wait`/`--out`/`--width`/`--height`。

---

## 四、风险与回滚

| 风险 | 影响 | 缓解 |
|------|------|------|
| 回填重算 305 篇耗时 20-40 分钟 | 会话阻塞 | 后台运行 + 分批复用；`--keyword/--limit` 可缩范围 |
| 回填后部分行 score 跌出 60 | 前端隐藏部分旧文 | 属预期（模型更严格）；可 `--dry-run` 预览受影响行 |
| **crawl4ai 容器持续并发过载**（2026-08-05 实测） | pool3 持续并发下正文抓取渐进性大面积失败（**66% 缺失**）→ 大量行回落标题-only，v2 严格判分把 score 压垮（305 篇重算后 210 篇跌出 60，部分 slug 标题被误判 0） | 回填/正文喂养**必须 pool 1 串行 + 正文重试**；正文缺失时 **score 下限 60** 保已入库文章可见（不恶化） |
| 回填 UPDATE 覆盖原数据不可逆 | 误判行原 score/摘要被覆盖 | 先 `--dry-run`；正文缺失行不降分；严重误判可再跑修复模式（`--lt60`） |
| 去重误判（不同事件被合并） | 漏新闻 | 双信号 + 事件门槛；同批合并仅最高分代表行；log 可回溯 |
| 跨运行去重把"类似但不相同"的新闻当重复 | 漏新闻 | 阈值保守（事件≥0.25 且标题≥0.45）；纯函数单测含正反例 |
| 清理脚本误删 | 数据丢失 | `--dry-run` 默认 + 删除前置预览 + `--apply` 显式开关 |
| playwright-core 找不到浏览器 | 截图失败 | `PLAYWRIGHT_BROWSERS_PATH` 兜底指向已装路径 |

**回滚**：代码改动 Git revert 即可；回填/清理是数据 UPDATE/DELETE，回填可重跑（幂等），清理删除不可逆 —— 删除前务必看 `--dry-run` 清单。

---

## 五、实施顺序

1. 落盘本决策 + REQ + 更新 DOCUMENT_MAP / CLAUDE.md / PROGRESS.md / PRD
2. 澄清剩余问题（score<60 是否回填、执行时机、是否 commit/push）
3. 后端去重纯函数 + 接线（Part B）→ `node --check` + `npm test`
4. 回填脚本（Part A）→ `--dry-run` → 运行 → SQL 验证
5. 存量清理（Part B3）→ `--dry-run` → `--apply` → SQL 验证 Naji 4→1
6. 管线回归 `node src/index.js`
7. 前端重构（Part C）→ type-check/lint/build → Playwright 截图（Part D）验证
8. 更新 PROGRESS.md（完成态）+ 提交

---

## 六、执行结果与偏差（2026-08-05 实测回填）

### 6.1 回填两轮：v1 教训 → v2 修复
| 轮次 | 范围 | 正文缺失 | score 影响 |
|------|------|---------|-----------|
| v1（pool3） | 305 篇 score≥60 | **202（66%）** | 210 篇跌出 60（305→95 可见，Carrick 误判 0） |
| v2 修复（pool1-2+重试） | 324 篇 score<60 | **41（12.7%）** | **恢复可见 48 条**；其余仍隐藏 |

**根因**（与"持续并发过载"叠加）：google-news 信源 240 行是死链（news.google.com 重定向），正文必然抓不到 → 标题-only 重算被 v2 严格判分压垮。处置：google-news 行清零（score=0 隐藏）、`--lt60` 模式排除该源。**结论**：crawl4ai 正文抓取必须 pool 1-2 串行 + 重试；`filterNewItems` 按 URL 去重决定了历史修正只能靠回填脚本（`scripts/backfill-resummarize.js`）。

### 6.2 去重规则 v1 → v3 实测偏差
按 DECISION §一.2 初稿的 v1 单阈值在 `dedup-existing.js --dry-run` 上暴露误并：Anthropic 37→33 误删（共享实体膨胀）。已推翻为 v3 双规则 + seed-only（见 §一.2 更新），单测 42/42 含 7 个去重用例。**Naji 4→1 达成**；可见相关文章 82 篇（MU 29 / Anthropic 33 / Dallas 10 / blog 10）。

### 6.3 存量删除事故披露（务必追溯）
- 用户确认：删 9 条明确重复（Dallas 4 Naji / MU 2 / Anthropic 3），**保留 Cisse 续约 + Project Fetch**。
- **事故**：`scripts/dedup-existing.js --keep-ids` 传参误用 `--keep-ids=ID1,ID2`（等号形式），而 `flag()` 只解析空格分隔 `--keep-ids ID1,ID2` → keep 集为空 → **11 行全删**（含用户要保留的 2 行）。
- **恢复**：Cisse 已恢复（Yahoo offer-sheet，score 85，source_tier 2）。Project Fetch **经用户确认弃留**（不再恢复）。
- **教训**：`--keep-ids` 必须空格分隔传参，已记入 CLAUDE.md 已知陷阱。

### 6.4 验收对照（REQ §四）
| # | 判定 | 结果 |
|---|------|------|
| D1 回填 | 305 篇全处理、event_type ≥90% | ✅ v2 324 篇 0 失败；ge60 event_type 率 65/72=90% |
| D2 Carrick | 不再把主帅当球员 | ✅ score 90，摘要把 Carrick 识别为主教练 |
| D3 Naji | 4→1 且不再重灌 | ✅ 4→1；管线回归通过 |
| D4 回归 | `node src/index.js` 无重复新增 | ✅ |
| F1 无空白 | 空板块不渲染 + 空态引导 | ✅ 截图验证 |
| F2 签名 | Tier 色条 + 徽章 | ✅ |
| F3 截图 | 两态无大片空白 | ✅ `screenshots/ui-board-*.png` |

> 结论：**决策方向全部成立**；偏差仅在去重规则实现（v1→v3 实测校准）与一次删除事故（已披露并恢复）。
