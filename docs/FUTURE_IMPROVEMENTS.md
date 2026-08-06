# Future Improvements

> 范围外改进清单。发现于任务但不在当前范围、且暂不实现的想法，记录于此，避免散落在对话里丢失。
> 规则：**只记录，不实现**。实现需另开任务并经用户确认。

## 2026-08-07 · X 记者链路改造（当前任务）期间发现

### 1. X 推文"上位实体判定层"（正名过滤）

用户提出的"上位者概念分类"思路，映射到推文过滤：

**问题**：现有 preFilter 用子串词根（`man`/`united`），对推文文本有误伤——`united` 匹配 "West Ham United"、`bruno` 匹配纽卡球员 Bruno Guimaraes，造成无效 DeepSeek 调用（虽不会错误入库）。

**思路（正名）**：DeepSeek 打分前，先给每条推文"定名分"——判定其上位概念归属：
1. 命中 `mu_entities`（manchester united / man utd / mufc / 曼联 / 红魔 / 老特拉福德 / 梦剧场 / red devils / ineos / 球员教练名…）→ 放行
2. 命中 `competitor_clubs`（west ham / newcastle / leeds / arsenal / chelsea / liverpool / man city / tottenham…）**且**无 MU 实体**且**无 bare "united" → 直接丢弃（省 DeepSeek 调用）
3. 歧义/两可 → 交 DeepSeek 仲裁

**落法**：`src/x-entity-lexicon.json`（仿 keyword-roots 模式）+ 规则函数 + 单测。轻量版，不建复杂本体库。与现有 `category_schema`（MU 8 类板块）同构——上位概念即板块，实体判定即定归属。

### 2. T2 高量源堆积整治

**问题**：前端被 T2 媒体边角料淹没（近 40 天 90min 72 / 卫报 19 / ESPN 11 / Sky 20），X 记者 T1 信息被稀释。

**已落地（部分，2026-08-07 Phase F `3a24502`）**：
- `src/search.js` 信源按 tier 升序（T0→T1→T2）+ 非 T0 源每源上限 `MAX_PER_SOURCE=5`（`src/config.js`），通用防单源淹没，X 推文不再被挤出。Dallas 的 Yahoo/BR/SI 等 T2 高量源同样受益。

**仍未实现**：
- 90min 等个别源更高门槛 / 特判
- 前端按 Tier 排序权重调整（T1 > T2）
- 单源日上限（per-source daily cap，跨运行累计而非单轮截断）

### 3. Fabrizio Romano 扩容

转会最快消息源，但全欧转 feed 噪音大（是 Ornstein 的几倍），需更强的曼联实体过滤（即条目 1）配套后才值得接入。
