# X 记者推文进 feed · 设计文档

> 状态: **设计定稿** ｜ 日期: 2026-08-07 ｜ 关键词: Manchester United
> 对应技能流程: superpowers:brainstorming（2026-08-07 会话）

## 一、背景与问题

**用户观察**：打开前端，一大堆是 ESPN / 卫报 / 90min 的内容；David Ornstein、Simon Stone 当天发了消息，但监控里看不到（用户在论坛上看到了他们的帖子）。

**诊断（4 层根因）**：

1. **X 分支只取 t.co 文章链，纯文字爆料整条漏**：`src/crawl4ai-fetch.js:166-176` 对 X 账号只取 `links.external` 中 href 含 `t.co/` 的项。Ornstein 的 breaking news 常是文字先行（先发"Manchester United 正在谈 XX"，链接后补）——这类帖子无 t.co 外部链，被整体丢弃。
2. **抓的是记者全量 feed，非曼联专属**：库里 Ornstein 近 40 天仅 15 条、Simon Stone 7 条，且多为 West Ham / Brighton / Newcastle 等其他俱乐部消息，靠相关性过滤收敛后曼联相关每天 0-2 条。
3. **入库 URL 是裸 `t.co/xxxx` 短链**：前端卡片直接挂短链，与直接抓到的原文 URL 对不上、去重失效、观感差。
4. **guest 视图属"能用但脆"**：登录墙、反爬限流、页面结构变动都会导致 X 抓取失败或数据受限。

**实证（2026-08-07）**：crawl4ai guest 抓 `x.com/David_Ornstein` 返回**新鲜推文**（1h / 3h 前）+ 完整正文 + 状态链接（`x.com/David_Ornstein/status/<id>`）+ 相对时间戳。当天 5 条全非曼联（被相关性过滤正确排除）。

## 二、目标与范围

**目标**：X 记者（Ornstein / Stone + 新增 Whitwell / Mitten）的**原帖推文直接进 feed**——标题=推文正文、主链=原推状态链接、时间=真实发推时刻。纯文字爆料不再漏。

**范围内**：
- X 抓取通道改造（twikit 主 + crawl4ai 兜底）
- T1 记者扩容 2 名（Laurie Whitwell、Andy Mitten）

**范围外**（记入 `docs/FUTURE_IMPROVEMENTS.md`）：
- T2 媒体堆积整治（90min 等单源上限/降权）
- X 推文"上位实体判定层"（正名过滤）
- Fabrizio Romano 扩容、多账号池（twscrape）

## 三、架构

### 3.1 抓取通道：twikit 主 + crawl4ai 兜底

```
X 账号（4 个: Ornstein / Stone / Whitwell / Mitten）
  ├─【主】twikit（宿主 Python venv）
  │    scripts/x-fetch-tweets.py   ← ~40 行 Python，读 .env 凭证
  │    → client.get_user_tweets() → 结构化 JSON（text / created_at_datetime / status id）
  │    src/x-fetch.js              ← child_process.spawn 调用 → 解析 JSON → toItem 推文卡
  ├─【兜底】crawl4ai guest
  │    crawl4ai-fetch.js X 分支 → extractTweetsFromMarkdown()（雪花 ID 解码时间）
  └─ 都失败 → 跳过该源（X 不降级 Direct）
  ↓
  preFilter（推文专用收紧词根）→ DeepSeek 评分 ≥60 → 入库 articles → 前端
```

- **宿主 Python 3.14.2 已确认存在**（2026-08-07），twikit 走宿主 venv（`.venv` 或独立目录），不碰 docker exec。
- twikit 直接用**维护中的 fork**：`twifork`（`pip install twifork`）或 `unclecode/twikit`（与现有 crawl4ai 容器同作者）。上游 `d60/twikit` 已坏（2026-03 起 KEY_BYTE indices 错误），勿用。
- **凭证**：优先 cookie（`auth_token` + `ct0`，存 `.env` 的 `X_AUTH_TOKEN` / `X_CT0`）；密码登录（`X_USERNAME` / `X_PASSWORD`）可能撞 Cloudflare 验证码，作后备。
- **降级链**：twikit 异常（会话过期/被封/依赖缺失）→ crawl4ai guest → 0 条则跳过。全程不阻塞管线其余信源。

### 3.2 推文卡形态

| 字段 | 值 |
|---|---|
| `title` | 推文正文（截断 280 字符） |
| `url` | `x.com/<acct>/status/<id>`（天然唯一，URL 去重即用） |
| `publishedAt` | twikit 绝对时间戳；crawl4ai 兜底路径用雪花 ID 解码 `(id >> 22) + 1288834974657` |
| `source` / `source_name` / `tier` | 沿用（T1） |

> 现有 X 分支的 `links.external` t.co 提取**被替换**：不再单独产出 t.co 文章卡，由推文卡统一替代；t.co 卡片仅作为推文内上下文，不入库（v1 不加 `article_url`）。

### 3.3 T1 记者扩容（纯配置）

`keyword_sources` 新增两行（`fetch_type='firecrawl'`，`enabled=true`，`rss_url` 填 `scrape_url` 同值以过 NOT NULL 约束）：

| 账号 | 抓取页 | Tier | 预期噪音 |
|---|---|---|---|
| Laurie Whitwell | `x.com/lauriewhitwell` | 1 | 低（基本纯曼联，The Athletic 跟队） |
| Andy Mitten | `x.com/AndyMitten` | 1 | 低（曼联文化/更衣室，长周期） |

- `source-tiers.json` 的 x.com 域名映射已存在，tier 来自 source 行，无需改。
- `article-patterns.json` 不改（X 分支不走 URL 模式筛选）。
- 同步更新 `docs/REQ-曼联信源监控.md` §5.4 生产白名单。

## 四、数据模型（无 DDL）

推文卡全部复用现有 `articles` 列（`url` / `title` / `published_at` / `source` / `tier`）。**v1 不加 `article_url` 列**（决定：t.co 相关文章多为付费墙点不开，原推内可点开卡片；省一次 DDL 与 schema 变更风险）。

## 五、过滤策略

- 推文分支用**收紧词根集**（`manchester` / `mufc` / `曼联` / `红魔` / `老特拉福德` / `梦剧场` / `rashford` / `bruno` / `garnacho` / `højlund` / `ten hag` / `red devils` 等），宁多花几毛 DeepSeek 成本也不漏 T1 爆料。
- 别队消息（如 West Ham / Baleba）进 DeepSeek 后 score<60 照旧过滤，不会错误入库。
- **上位实体判定层：本轮不做**，记入 `FUTURE_IMPROVEMENTS.md`（正名过滤，优化成本而非正确性）。

## 六、前端呈现

- 推文卡：`title`=推文原文（≤280 字符）；现有卡片组件需确认截断样式（预计已含 line-clamp，实施时验证）。
- 来源徽章已带 "(X)"；可选加"🔵 推文"小角标区分文章卡（用现有 `event_type` 列，不加列）。
- 排序：`published_at`=真实发推时间 → 推文按发推时刻排，30 天窗口正常命中。
- `MIN_SCORE = 60` 不变（前后端一致）。

## 七、去重与交叉验证

- 状态 URL 唯一 → 跨运行 URL 去重天然生效（裸 t.co 短链问题一并消失）。
- 同一事件多记者推文 → 现有 `crosscheck.js` 聚类/印证处理；`collapseSameEvent` 是否会折叠印证行为，实施时验证。

## 八、错误处理与降级

| 故障 | 处理 |
|---|---|
| twikit 会话过期 / 被封 | 捕获异常 → 回退 crawl4ai guest |
| Python 缺失 / 依赖未装 | 检测失败 → 回退 crawl4ai guest |
| crawl4ai 也 0 条 / 失败 | 跳过该源（X 不降 Direct） |
| 单源失败 | 不影响其余信源 |

## 九、安全

- 凭证只进 `.env`（已 gitignore）。
- **使用低调小号，不用主号**（任何登录爬取都有封号风险）。
- 保持日频一次（与现有每日 08:00 定时一致）。

## 十、测试

1. `scripts/x-fetch-tweets.py` 冒烟：mock JSON 输出。
2. Node 解析函数单测：喂样例 twikit JSON / 样例 X markdown → 断言 toItem 形状。
3. 雪花 ID 时间戳解码函数单测。
4. 端到端：手动跑一次，验证 4 账号推文卡入库、别队消息被过滤。
5. `npm run check` 全绿（lint + type-check + npm test）。

## 十一、文档联动

- `CLAUDE.md`：X 通道描述（twikit 主 + crawl4ai 兜底）、已知陷阱（Python 依赖、凭证、twikit fork 选择）。
- `docs/REQ-曼联信源监控.md`：§5.4 白名单加 Whitwell/Mitten，§6 X 账号模型更新。
- `docs/PROGRESS.md`：新增功能进度。

## 十二、验收标准

1. 四个 X 账号的近期推文卡入库（含**纯文字推文**）。
2. 别队消息仍被过滤（score<60 不入库）。
3. Ornstein 当天曼联爆料，次日 08:00 定时运行后出现在前端。
4. 现有非 X 信源（manutd/Sky/Guardian/ESPN/90min/Dallas/Anthropic）不受影响。
5. `npm run check` 全绿。

## 十三、风险

| 风险 | 缓解 |
|---|---|
| X 反爬持续升级 | twikit 走维护中 fork + crawl4ai guest 兜底双通道 |
| 账号被封 | 低调小号 + 日频；必要时换 cookie 不换密码 |
| Python 3.14 与 twifork 兼容性 | 实施时先 `pip install twifork` 验证；不行降级 Python 3.13（本机已有） |
| twikit 获取不到某账号 timeline | 该源静默回退 crawl4ai，不阻塞 |

## 十四、实施要点（给 writing-plans）

**新文件**：
- `scripts/x-fetch-tweets.py` — twikit 桥接，读 `.env` 凭证 → stdout JSON
- `src/x-fetch.js` — Node 侧 spawn + 解析 → toItem
- `src/x-tweet-parse.js` — 解析函数 + 雪花解码（可单测）
- `tests` 对应 `*.test.js`

**改动**：
- `src/crawl4ai-fetch.js` — X 分支改造：新增 `extractTweetsFromMarkdown()`，X 分支改为兜底路径
- `src/search.js` — X 源先走 `x-fetch.js`，失败回退 crawl4ai
- `src/config.js` — 读取 `X_AUTH_TOKEN` / `X_CT0`（及 `X_USERNAME` / `X_PASSWORD` 后备）
- `src/keyword-roots.js` — 推文专用收紧词根集
- `docs/REQ-曼联信源监控.md`、`CLAUDE.md`、`PROGRESS.md`

**数据**：
- Supabase `keyword_sources` INSERT 两行（Whitwell / Mitten，tier=1，rss_url 填同值）
