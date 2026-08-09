# DECISION: 架构借鉴 — 吸收开源成熟监控组件

> 状态: **已定稿（2026-08-09）** ｜ 对应 REQ: [REQ-架构借鉴](REQ-架构借鉴-吸收开源成熟监控组件.md)
> 决策方式: 用户评审 REQ 勾选采纳范围 → 本 DECISION 记录选型依据 + 实施设计 + 风险回滚
> 采纳范围: **A1（抓取通道数据化）+ A2（增量幂等闸）+ A3（通知分发器）+ B1（日志收尾 flush）**
> 暂缓: A4（embedding 预筛去重）/ A5（抓取源级冷却）/ A6（GitHub Actions cron）；B2（任务计划无论登录都运行）需管理员权限，单独评估

---

## 一、背景与触发痛点

2026-08-09 诊断（详见 REQ 第一节）：

1. **Dallas / Anthropic 连续多日低产出**，是多层问题叠加：①T0 官方源 nba.com crawl4ai 抓取失效；②AI 误判明显相关文章为 0 分（Marc Stein X 23 条全 0、nba-mavs-news 8 条全 0）；③**score 0「已见标记」把误杀永久固化**——`assembleRecords` 把 <60 行以 score=0 入库，`filterNewItems` 的 `get_new_urls` RPC 按 URL 命中（含 score=0）即视为已见，永不重评；④`MAX_PER_SOURCE=5` 截断 X 新推文。
2. **自动化可观测性缺口**：定时任务实际成功运行但用户「以为没跑」（`run-pipeline.js` 日志收尾 `log.end()` + `process.exit` 竞态丢最后一行）；邮件/前端显示存疑。
3. 用户要求 **不要再造轮子**：调研 GitHub 同类项目（changedetection.io / Huginn / MuckScraper / Miniflux 等），吸收成熟组件模式后改造，而非替换整体架构。

核心判断（调研综合）：本项目「白名单源 → 定时抓取 → AI 评分过滤 → 事件聚类去重 → 持久化 → 前端+邮件」是被开源反复验证的主流形态，但「tier 分级 + 阈值评分 + 事件聚类」的精确组合无现成开源整体可抄，故**逐组件吸收成熟模式**。

---

## 二、采纳范围总览

| ID | 措施 | 借鉴对象 | 直击痛点 |
|----|------|---------|---------|
| **A1** | 抓取通道数据化（`backends` 配置列 + 通道链） | changedetection `content_fetchers/` | 信源通道写死在代码分支；Anthropic 单通道依赖；新增信源要改代码 |
| **A2** | 增量幂等闸（每源 seen ring 缓冲 + score-0 放行 RPC） | Huginn `memory['seen_ids']` | score-0 永久固化；重跑管线重复分析浪费 AI 预算 |
| **A3** | 通知分发器（多通道可插拔，日报+告警收口） | Miniflux `integration/` + Apprise | 通知单通道硬编码；加 Telegram/webhook 要改代码 |
| **B1** | 日志收尾 flush 修复 | —（本仓库 bug） | 定时任务日志缺 `exit code=0` 结尾行 →「以为没跑」 |

**不采纳（暂缓）**：

- **A4 embedding 预筛去重**：当前 `crosscheck.js` LLM 双信号聚类在 RESULT_LIMIT=30 规模下调用量可控，无量化瓶颈证据；待 A1-A3 落地后视 LLM 预算与召回率再评估。需引入 pgvector + embedding 生成，成本高、收益当前不迫切。
- **A5 抓取源级冷却**：crawl4ai 过载主要靠 F-019 引擎自愈 + A1 每源可配链缓解；源级失败状态持久化涉及新表/文件，纳入后续迭代。
- **A6 GitHub Actions cron**：本机 Windows 任务计划已工作（仅登录态限制），B2 是更轻的替代；CI cron 需公网可达数据源 + secrets 迁移，改动面大。
- **B2 任务计划「无论登录都运行」**：`/ru SYSTEM` 需管理员权限 + 密码录入，涉及安全配置，单独评估。

---

## 三、选型依据（逐措施）

### A1 抓取通道数据化

**现状**：`src/search.js` 的 `fetchSourceWithFallback(source)` 用 if-else 写死通道：
- X URL（`crawl4ai.isXUrl`）→ `xFetch.fetchXSourceArticles`（内部 twikit 主 + crawl4ai 兜底，不降 Direct）；
- 其余 → 先 `crawl4ai.fetchSourceArticles`，空/失败 → `scraper-direct.fetchSource`。

信源「能不能被某通道抓、回退顺序」全在代码分支里，新增/调优信源要改代码。

**成熟做法（changedetection.io `content_fetchers/`）**：抓取后端可插拔，每 Watch 声明用哪个 fetcher + 参数，新增 fetcher 不碰核心循环。

**本方案**：`keyword_sources` 加 `backends` 列（`jsonb`，有序通道名数组），新增 `src/fetch-chain.js`：
- `BACKENDS` 通道注册表：`crawl4ai` / `direct` / `twikit` 三个实现，各自「取到空抛错」以便链式降级；
- `resolveBackends(source)`：有 `backends` 配置用之；无（旧数据）回退兼容逻辑（X→`['twikit','crawl4ai']`，其余→`['crawl4ai','direct']`）；
- `fetchSourceWithChain(source, registry)`：按链顺序尝试，首个非空即返回，全败返回 `[]`。
- `search.js` 的 `searchAll` 只保留「按 tier 排序 + `capSourceItems`」编排，逐源改调 `fetchSourceWithChain`。

**理由**：
1. 零代码新增/调优信源——claude.com/blog 配 `['crawl4ai']`（Direct 实测无效）、TechCrunch 配 `['crawl4ai','direct']`（双通道）、X 记者配 `['twikit','crawl4ai']`。
2. `backends` NULL 时行为与现状完全等价，向后兼容，可渐进式配置。
3. 通道实现仍收在本仓库（不变更抓取依赖），只是「谁用哪条链」数据化。

### A2 增量幂等闸

**现状**：
- `filterNewItems` → RPC `get_new_urls(p_keyword_id, p_urls)` 实测定义为：
  ```sql
  SELECT unnest(p_urls) EXCEPT SELECT a.url FROM public.articles a
  WHERE a.keyword_id = p_keyword_id AND a.url = ANY(p_urls);
  ```
  即**所有已存行（含 score=0）都算已见** → 被判 0 分的 URL 永久无法重评。
- 重跑管线：同 URL 每轮重新抓取 + 重新分析（X 源每轮重拉最近推文），浪费 AI 预算、加重 crawl4ai 负载。

**成熟做法（Huginn `memory['seen_ids']`）**：每 agent 记最近 N 条已见 id 的环形缓冲，可过期——「已见」是有界窗口而非永久事实。

**本方案（两部分）**：
- **A2-1 `src/seen.js` 环形缓冲**：`keyForUrl(url)`（复用 `normalizeUrlKey`）+ `SeenRing`（固定容量 Set+FIFO，`has/add` O(1)）+ `SeenStore`（持久化到 `logs/.seen-ids.json`，`{ version, [sourceSlug]: [urlKey,...] }`，容量上限 `SEEN_RING_SIZE`）。
  - 接入 `fetchCandidates`：抓取后、DB `filterNewItems` 前，按 `item.source`（slug）查 ring 剔除已见。
  - `processKeyword` 分析完成后把本轮 `newItems` 的 URL 写入 ring（mark 对象 = 进入分析预算的候选，每源每轮 ≤`MAX_PER_SOURCE`）。
  - `run()` 里 load 一次、全部 keyword 处理完 save 一次（一次磁盘写）。
- **A2-2 RPC 迁移（score-0 放行）**：`get_new_urls` 加 `AND a.score > 0`——score-0 行不再阻挡重评。误杀 URL 在 AI 评分修复后可重评；短期重复分析由 A2-1 ring 兜住（每源 200 容量，按每轮 ≤5 条进分析，40+ 轮才逐出）。

**理由**：
1. A2-2 是修复「Marc Stein 23 条误杀永久消失」的根因动作（score-0 不再是永久墓碑）。
2. A2-1 用有界窗口承接短期去重，避免 score-0 放行后每轮重评同一批无关 URL 的预算浪费——两者互为补充。
3. 纯本地文件持久化（`logs/` 已有 pipeline log + `.last-run.json` 先例），零新表，回滚简单（删文件即重置）。

### A3 通知分发器

**现状**：`email.js` 的 `sendDailyDigest`（管线末尾）与 `run-pipeline.js` 的 `sendAlertEmail`（失败告警）都直接依赖 SMTP；通知 = 单通道硬编码，加 Telegram/webhook 要改多处代码。

**成熟做法（Miniflux `integration/` 每通道一包 + Apprise URL 即配置）**：通知通道即配置项，业务只发「意图」，通道负责投递。

**本方案**：新增 `src/notify.js`：
- `CHANNELS` 注册表：`email` 通道复用它 `email.js.sendEmail({subject,text,html})`；
- `resolveChannels()` 读 `config.NOTIFY_CHANNELS`（`.env`，逗号分隔，默认 `'email'`）；
- `notify({subject,text,html}, {channels, registry})`：逐通道投递，单通道失败不影响其他，返回 `{sent, results}`；无通道返回 `{sent:false, reason:'no channels'}`；
- `sendDailyDigest` 保持对外签名不变（`{sent, subject, reason}`，index.js 依赖），内部改走 `notify`；`run-pipeline.js` 的告警改走 `notify`。

**理由**：通知与业务解耦，未来新增 Telegram/webhook 通道 = 加一个 registry 条目 + `.env` 配一行，零改业务代码；`sendDailyDigest` 兼容签名保证 index.js 零改动。

### B1 日志收尾 flush

**现状**：`run-pipeline.js:220-234` 的 `child.on('exit')` 里 `log.write(...)` → `log.end()` → `console.log(...)` → `process.exit(code ?? 1)`。`log.end()` 排队异步 flush，但 `process.exit` 可能在其落盘前退出，日志缺 `exit code=0` 结尾行——用户看到「日志像被中断」误判任务失败（8/9 实测任务 rc=0 成功，但日志无收尾行）。

**修复**：`log.write(..., cb)` 回调内 `log.end(cb)`，`process.exit` 移到 end 回调里，保证收尾行落盘后再退出。`child.on('error')` 分支同样处理。

**理由**：一行级修复，直接消除「以为没跑」的主要误判来源。

---

## 四、实施设计

### 数据模型变更（Supabase）

```sql
-- A1: keyword_sources 加 backends 列（jsonb，有序通道名数组；NULL = 旧行为）
ALTER TABLE public.keyword_sources ADD COLUMN IF NOT EXISTS backends jsonb;

-- A2: get_new_urls 只把 score>0 的行视为已见（score-0 行放行重评）
CREATE OR REPLACE FUNCTION public.get_new_urls(p_keyword_id text, p_urls text[])
 RETURNS TABLE(url text)
 LANGUAGE sql
 SET search_path TO ''
AS $function$
  SELECT unnest(p_urls)
  EXCEPT
  SELECT a.url FROM public.articles a
  WHERE a.keyword_id = p_keyword_id
    AND a.url = ANY(p_urls)
    AND a.score > 0;
$function$;
```

### 文件改动

| 文件 | 动作 | 措施 |
|------|------|------|
| `src/fetch-chain.js` | 新增 | A1 通道注册表 + resolveBackends + fetchSourceWithChain |
| `src/search.js` | 改 | `fetchSourceWithFallback` → `fetchSourceWithChain`；`loadKeywordSources` 增选 backends（在 store.js） |
| `src/store.js` | 改 | `loadKeywordSources` select 加 `backends` |
| `src/seen.js` | 新增 | keyForUrl / SeenRing / SeenStore |
| `src/config.js` | 改 | `SEEN_RING_SIZE`、`SEEN_STORE_PATH`、`NOTIFY_CHANNELS` |
| `src/index.js` | 改 | `fetchCandidates(keyword, seen)` / `processKeyword(keyword, seen)` / `run()` load+save seen；A2 接入 |
| `src/notify.js` | 新增 | 通知分发器 |
| `src/email.js` | 改 | `sendDailyDigest` 内部改走 notify（签名不变） |
| `scripts/run-pipeline.js` | 改 | B1 日志 flush；A3 告警走 notify |
| `src/fetch-chain.test.js` | 新增 | A1 单元测试 |
| `src/seen.test.js` | 新增 | A2 单元测试 |
| `src/notify.test.js` | 新增 | A3 单元测试 |
| `src/index.test.js` | 改 | fetchCandidates/processKeyword 带 seen 的行为测试 |

### 信源 backends 配置（实施时用 SQL 落地）

```sql
-- 单通道（Direct 无效/脆弱的源，只走 crawl4ai）
UPDATE keyword_sources SET backends = '["crawl4ai"]'
WHERE source_name IN ('Claude Blog') OR scrape_url LIKE '%claude.com/blog%';
UPDATE keyword_sources SET backends = '["crawl4ai"]'
WHERE scrape_url LIKE '%anthropic.com/news%' OR scrape_url LIKE '%anthropic.com/research%';

-- 双通道（Node 直连可达，crawl4ai 挂了还能 Direct 兜底）
UPDATE keyword_sources SET backends = '["crawl4ai","direct"]'
WHERE scrape_url LIKE '%techcrunch.com%' OR scrape_url LIKE '%nba.com/mavs/news%';

-- X 账号显式声明（默认等价，可不配；配了更清晰）
UPDATE keyword_sources SET backends = '["twikit","crawl4ai"]'
WHERE scrape_url LIKE '%x.com/%';
```

> 其余源保持 `backends = NULL`，走兼容默认链，行为不变。

---

## 五、风险与回滚

| 措施 | 风险 | 缓解 / 回滚 |
|------|------|------------|
| A1 | `backends` 配置错误导致某源全链失败（如把 `direct` 配在 claude.com 上浪费时间） | `backends` NULL 即回退旧行为；配置 SQL 可逆（`UPDATE ... SET backends = NULL`）；`resolveBackends` 对未知通道名直接跳过 |
| A1 | 改动 `searchAll` 引入回归（tier 排序/cap 逻辑被碰坏） | `searchAll` 编排逻辑不动，只替换单源抓取函数；`search.test.js` 现有用例覆盖 |
| A2-1 | seen 文件损坏/并发写坏 | 单进程独占；load 失败回退空 ring（不影响管线）；文件是缓存性质，删了即重置 |
| A2-2 | score-0 放行后旧 0 分 URL 每轮重评一次，多耗少量 DeepSeek 预算 | `SEEN_RING_SIZE=200` 兜短期；`MAX_PER_SOURCE`/`RESULT_LIMIT` 已限每源每轮进分析量；可调 `SEEN_RING_SIZE` 或回滚 RPC（`CREATE OR REPLACE` 回旧版一行） |
| A3 | 改造 `sendDailyDigest` 破坏日报邮件 | 保持对外签名 `{sent, subject, reason}` 不变；`email.test.js` 现有用例回归；回滚 = 恢复 sendDailyDigest 直连 sendEmail（一个 commit 可逆） |
| A3 | `NOTIFY_CHANNELS` 配错导致邮件不发 | 默认 `'email'`；notify 无通道返回 `{sent:false}` 不抛错；`.env` 改动即时生效 |
| B1 | end 回调永远不触发（极端流错误）导致进程不退出 | 日志流是本地文件写，失败概率极低；可选加超时兜底 `setTimeout(process.exit, 2000)` |

**总体回滚策略**：A1/A2/A3/B1 均为独立 commit；任何一项出问题可单独 `git revert` 对应 commit，其余不受影响。DB 变更（A1 列、A2 RPC）均可逆：`ALTER TABLE DROP COLUMN backends` / RPC `CREATE OR REPLACE` 还原。

---

## 六、决策记录

- **日期**: 2026-08-09
- **决策**: 采纳 A1 + A2 + A3 + B1；暂缓 A4/A5/A6、B2 单独评估
- **依据**: 直击已验证痛点（score-0 固化、单通道依赖、通知硬编码、日志误判）；组件级吸收成熟开源模式（changedetection/Huginn/Miniflux），非整体替换；零/低 DB 变更、独立 commit 可回滚
- **替代方案评估**：
  - 整体引入 MuckScraper / Horizon 等现成项目 → 拒绝：技术栈/数据模型/信源体系不匹配，迁移成本高
  - 只做 A1+A2 不做 A3 → 拒绝：A3 成本低（复用 email.js）且为通知多通道铺路
  - A2 只做 RPC 放行不做 ring → 拒绝：无 ring 兜底会每轮重评全部 0 分 URL，预算不可控

---

> 实施计划见 `docs/superpowers/plans/2026-08-09-架构借鉴-抓取通道数据化-增量幂等-通知分发.md`（模块测试 → 功能测试 → 端到端测试）。
