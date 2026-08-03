# ai-news-monitor

> ⚠️ **HOOK：开始任务前先读 [DOCUMENT_MAP.md](DOCUMENT_MAP.md) 定位相关文档，按图索骥，不凭记忆猜路径。**

AI 驱动的多关键词信息监控工具。从用户配置的白名单信源页面直接抓取内容，AI 评分过滤并生成中文摘要，结果持久化到 Supabase。后端 Node.js CommonJS，前端 React18 + TypeScript + Vite + Tailwind。

## 运行

```bash
node src/index.js              # 手动运行一次
CRON_SCHEDULE="0 8 * * *" node src/index.js  # 每天8点定时运行
```

## 技术栈

- 后端：Node.js CommonJS
- 抓取：Firecrawl API（主路径，余额充足时）+ `scraper-direct.js`（降级路径：axios 拉取 HTML + DeepSeek 识别链接）
- 解析：cheerio / 正则提取
- 数据层：@supabase/supabase-js（keywords / keyword_sources / articles）
- AI：openai SDK 指向 DeepSeek API（评分 + 摘要 + 链接识别）
- 定时：node-cron（可选）
- 前端：React 18 + TypeScript + Vite + Tailwind CSS（`client/`）

## 目录结构

```
src/
  index.js          主流程：关键词循环、pipeline 调度、报告生成
  db.js             Supabase client 单例 + withRetry 工具
  store.js          数据访问层：loadKeywords、loadKeywordSources、filterNewItems、saveArticles
  search.js         search 类型：白名单信源抓取调度 + HackerNews 兜底
  scraper-direct.js 信源直抓：axios 拉 HTML → 正则提取链接 → DeepSeek 识别文章
  firecrawl.js      Firecrawl API 抓取（当前余额不足，降级路径启用中）
  ai.js             summarizeArticle（blog）、analyzeResult（search，含 tier 评分）
  tiers.js          getTier(url)：域名 → Tier 映射
  source-tiers.json 域名可信度映射表
docs/               需求、决策、计划、验收、进度文档（见导航）
reports/            每日报告 YYYY-MM-DD.md（运行时自动生成）
client/             React SPA
scripts/            运维脚本（test-scrape、update-sources 等）
```

## 文档导航

| 内容 | 路径 | 何时读 |
|------|------|--------|
| 路径总索引 | [DOCUMENT_MAP.md](DOCUMENT_MAP.md) | 每次任务开始前 |
| Agent 行为规范 | [AGENTS.md](AGENTS.md) | 编码前 |
| 技术规范 / 数据模型 | [docs/PRD.md](docs/PRD.md) | 改表结构或了解 pipeline |
| 功能进度 / Bug | [docs/PROGRESS.md](docs/PROGRESS.md) | 了解状态或更新进度 |
| 曼联需求文档 | [docs/REQ-曼联信源监控.md](docs/REQ-曼联信源监控.md) | 曼联相关功能对齐 |
| 技术决策纪要 | [docs/DECISION-方案选型纪要.md](docs/DECISION-方案选型纪要.md) | 了解架构选型原因 |
| 执行计划 | [docs/PLAN-方案A执行计划.md](docs/PLAN-方案A执行计划.md) | 落地实施参照 |
| 验收清单 | [docs/CHECKLIST-方案A验收清单.md](docs/CHECKLIST-方案A验收清单.md) | 验证是否完成 |

## 关键约束

- 关键词统一从 Supabase `keywords` 表读取（`keywords.json` 已删除）
- search 类型：AI 评分 ≥60 视为相关（`MIN_SCORE=60`）；blog 类型：全部通过（score=100）
- **抓取通道**：优先 Firecrawl API（`src/firecrawl.js`）；当前 Firecrawl 余额不足（HTTP 402），`src/search.js` 自动走降级路径 `src/scraper-direct.js`（axios + DeepSeek 识别链接）。额度恢复后切回主路径即可，无需改代码
- **白名单信源**：只抓取 `keyword_sources` 表中 `fetch_type='firecrawl'` 且 `enabled=true` 的信源页面。无白名单的关键词走 HackerNews 兜底
- 信源页面选择国内可达站点（Man Utd Official、ESPN、Sky Sports、90min），避免 BBC / Guardian 等超时源
- RLS 当前宽松模式（`USING (true)`），上线前须收紧
- Windows 路径统一使用 `E:\claude\ai-news-monitor`（Git Bash 用 `/e/claude/...`）

## 代码规范

- 后端使用 Node.js CommonJS（`require` / `module.exports`），不引入 ES Module
- 前端数据访问统一走 Supabase JS SDK（`client/src/hooks/`），不引入后端 Node 模块
- 前端评分门槛常量 `MIN_SCORE = 60` 定义在 `client/src/hooks/useArticles.ts`，前后端保持一致
- `useArticles` 的 effect 依赖使用标量字段（`filters.keywordId`、`filters.source`、`filters.search`、`filters.sortBy`、`filters.tier`），不传 `filters` 对象本身（对象引用每次渲染都变，会触发无效重请求）
- 提交前运行检查：后端 `node --check src/*.js`；前端 `cd client && npm run type-check && npm run lint && npm run build`
- 只暂存本次任务涉及的文件；`.env*`、node_modules、本地产物不入库
- 新增信源时同步更新 `source-tiers.json` 域名映射（如无映射则 AI 评分不获 tier 提示）

## 已知陷阱

### 工具 / 依赖
- **Firecrawl 额度不足时**：`api.firecrawl.dev` 返回 HTTP 402，此时 `src/search.js` 走 `scraper-direct.js` 降级路径。额度恢复后切回 `firecrawl.js`
- **cheerio 解析现代 SPA 页面**：页面内联 CSS/JS 会被误判为选择器（报 `Unknown pseudo-class` / `Unmatched selector`）。提取链接优先使用正则：`/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi`，再交给 DeepSeek 筛选
- **Sky Sports / 90min**：AI 链接识别偶发返回空 JSON（非标准页面结构），单源失败自动跳过，不影响其他源

### 网络访问
- **BBC Sport / The Guardian**：国内网络 ETIMEDOUT 不可达，信源配置时优先选国内可达站点
- **claude.com/blog**：偶发超时（15s），属 Anthropic 服务端响应慢，重试即可

### 数据约束
- **`keyword_sources.rss_url` 列有 NOT NULL 约束**：仅用 firecrawl 模式时，插入记录也要给 `rss_url` 填值（填与 `scrape_url` 相同的值）
- **`keyword_sources` 的 `(keyword_id, rss_url)` 有唯一约束**：更新信源时先 DELETE 旧行再 INSERT 新行
- **MU 关键词 query 字段**：使用宽泛词 `"Manchester United"`（白名单模式下信源已限定，query 无需附加限定词）

### Agent 行为
- **路径中的 "claude" 易被写成 "droid"**：使用 Windows 绝对路径（`E:\claude\...`）规避；Git Bash 必须用 `/e/claude/...`
- **TypeScript 锁定 `^5.8`**：与 `@typescript-eslint` 兼容上限一致，升级到 TS 7.x 会破坏 lint
- **前端 `client/.env`**：不进版本控制，新环境需手动创建（缺失时 `supabase.ts` 启动即 throw，页面白屏）

---

> 📝 **本文由 AI 自行维护。** 遇到新的已知陷阱、配置变更或模块增删时，更新本文对应章节。内容超过 200 行时，优先精简过时条目而非新增。
