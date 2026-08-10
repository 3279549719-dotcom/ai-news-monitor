# ai-news-monitor

> **HOOK：开始任务前先读 [DOCUMENT_MAP.md](DOCUMENT_MAP.md) 定位相关文档，按图索骥。** 行为规范见 [AGENTS.md](AGENTS.md)。**遇到异常/报错/工具报错/管道失败 → 先查 [docs/KNOWN_TRAPS.md](docs/KNOWN_TRAPS.md)，再从零排查。**

AI 驱动的多关键词信息监控工具。从用户配置的白名单信源页面直接抓取内容，AI 评分过滤并生成中文摘要，结果持久化到 Supabase。后端 Node.js CommonJS，前端 React18 + TypeScript + Vite + Tailwind。

## 运行

```bash
node src/index.js              # 手动运行一次
npm run ops:run-auto           # 手动模拟定时（含拉起 crawl4ai + 落日志）
npm run ops:schedule           # 注册 Windows 任务计划：每日 08:00 自动跑
npm run ops:schedule:info      # 查看定时任务；npm run ops:unschedule 卸载
```

> 定时日志：`logs/pipeline-YYYY-MM-DD.log`；前端线上：`https://ai-news-monitor-silk.vercel.app`

## 目录结构

```
src/
  index.js          主流程：关键词循环、pipeline 调度、报告生成（~130 行纯编排）
  pipeline-stages.js 管线 5 阶段函数（fetchCandidates → analyzeAndCrosscheck → dedupe → assembleRecords → persist）
  config.js         env 与常量集中读取；敏感 key 经 getSecret() 闭包化
  db.js             Supabase client 单例
  store.js          数据访问层（keywords / keyword_sources / articles）
  search.js         白名单信源逐源调度（crawl4ai 优先 → 降级 scraper-direct）+ HN 兜底
  crawl4ai-fetch.js crawl4ai 抓取通道（主通道，REST 调本地容器）
  scraper-direct.js 信源直抓降级（axios + DeepSeek 链接识别）
  x-fetch.js        X 账号编排（twikit 主 → crawl4ai 兜底）
  x-tweet-parse.js  X 推文卡纯解析模块
  ai.js             DeepSeek 评分 + 摘要
  prompts/          AI 提示词集中目录
  items.js          抓取结果 → 入库形状规整（含 toArticleRecord）
  crosscheck.js     交叉验证 + 同事件去重
  report.js         日报 buildReport
  email.js          每日摘要邮件
  notify.js         通知分发器（收口 email）
  fetch-chain.js    抓取通道数据化执行
  seen.js           增量幂等闸（每源 200 条环形缓冲）
  tiers.js          URL → Tier 映射（含 applyTierFloor）
  keyword-roots.js  关键词词根映射（含 preFilter；数据来自 keyword-roots.json）
  keyword-roots.json 词根数据文件（新增关键词只需改此 JSON）
  article-patterns.json 站点 → 文章 URL 模式表（外置，按 host 分组）
  source-tiers.json 域名可信度映射表
  legacy/           已废弃模块（scraper.js、reader.js）
docs/               需求、决策、计划、验收、进度文档
reports/            每日报告 YYYY-MM-DD.md
client/             React SPA（Vite + Tailwind）
scripts/            运维脚本（run-pipeline / install-schedule / test-scrape / backfill-resummarize / screenshot-ui / restart-docker-engine 等）
```

## 关键约束

- 关键词统一从 Supabase `keywords` 表读取（`keywords.json` 已删除）
- AI 评分 ≥60 视为相关（`MIN_SCORE=60`）；blog 类型已下线
- **抓取通道**：crawl4ai 容器（`localhost:11235`）主通道 → 失败自动降级 `scraper-direct.js`。定时管线依赖 Docker 容器 `crawl4ai` 在线。**X 账号走 twikit 主通道**（`scripts/x-fetch-tweets.py`）→ 失败回退 crawl4ai guest 推文卡 → 全败跳过
- **T0 官方信源**：preFilter 免词根预筛 + score floor 85（`T0_FLOOR`），保证官方内容必入库
- **白名单信源**：只抓取 `keyword_sources` 表中 `enabled=true` 的信源；无白名单的关键词走 HackerNews 兜底
- **新增信源**：同步更新 `source-tiers.json` + `article-patterns.json`
- **数据通道化**：`keyword_sources.backends`（jsonb）驱动每信源降级链，新增/调优信源优先改数据
- **RLS 已收紧**：anon 仅 SELECT，后端写库用 service key

## 代码规范

- 后端 CommonJS（`require` / `module.exports`），不引入 ES Module
- 前端不走后端 Node 模块，所有数据访问通过 Supabase JS SDK
- `useArticles` effect 依赖使用标量字段，不传 `filters` 对象本身
- 提交前 `npm run check`（lint + type-check + test）
- 新增信源时同步更新 `source-tiers.json` + `article-patterns.json`

---

> **本文由 AI 自行维护。** 遇到新约束或模块增删时更新对应章节。陷阱/故障排除 → `docs/KNOWN_TRAPS.md`。完整文档导航 → `DOCUMENT_MAP.md`。
