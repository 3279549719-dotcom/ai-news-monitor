# ai-news-monitor

> HOOK：开始任务前先读 [DOCUMENT_MAP.md](DOCUMENT_MAP.md) 定位相关文档，按图索骥，不凭记忆猜路径。**

AI 驱动的多关键词信息监控工具。从用户配置的白名单信源页面直接抓取内容，AI 评分过滤并生成中文摘要，结果持久化到 Supabase。后端 Node.js CommonJS，前端 React18 + TypeScript + Vite + Tailwind。

## 运行

```bash
node src/index.js              # 手动运行一次
npm run ops:run-auto           # 手动模拟定时（含拉起 crawl4ai + 落日志）
npm run ops:schedule           # 注册 Windows 任务计划：每日 08:00 自动跑（默认时间，--time HH:MM 覆盖）
npm run ops:schedule:info      # 查看定时任务；npm run ops:unschedule 卸载
CRON_SCHEDULE="0 8 * * *" node src/index.js  # 备选：常驻进程内 node-cron（需手动起进程，重启即停）
```

> 定时日志：`logs/pipeline-YYYY-MM-DD.log`；前端线上：`https://ai-news-monitor-silk.vercel.app`（Vercel 部署，详见 [docs/LOCAL_SETUP.md](docs/LOCAL_SETUP.md)）

## 技术栈

- 后端：Node.js CommonJS
- 抓取：crawl4ai 容器（`src/crawl4ai-fetch.js` 主通道，REST 调 `localhost:11235`）+ `scraper-direct.js`（降级路径：axios 拉取 HTML + DeepSeek 识别链接）
- 解析：cheerio / 正则提取
- 数据层：@supabase/supabase-js（keywords / keyword_sources / articles）
- AI：openai SDK 指向 DeepSeek API（评分 + 摘要 + 链接识别）
- 定时：node-cron（可选）
- 前端：React 18 + TypeScript + Vite + Tailwind CSS（`client/`）

## 目录结构

```
src/
  index.js          主流程：关键词循环、pipeline 调度、报告生成（processKeyword 拆为 fetchCandidates→analyzeAndCrosscheck→dedupeAgainstRecent→assembleRecords→persist 阶段函数）
  config.js         环境变量与常量集中读取（MIN_SCORE/RESULT_LIMIT/HTTP/DeepSeek/crawl4ai/Supabase）
  db.js             Supabase client 单例 + withRetry 工具
  store.js          数据访问层：loadKeywords、loadKeywordSources、filterNewItems、saveArticles、loadRecentRelevant
  search.js         search 类型：白名单信源逐源调度（按 tier 升序 + 非 T0 单源上限 MAX_PER_SOURCE，crawl4ai 优先 → 降级 scraper-direct）+ HackerNews 兜底；HN 走 toItem + normalizeUrlKey 去重
  keyword-roots.js  关键词词根映射表（KEYWORD_ROOTS / getKeywordRoots，供 preFilter + C1 验收；词根外置直接编辑本文件）
  x-fetch.js        X 账号编排（twikit 主 → crawl4ai 兜底 → []）：runTwikit spawn `scripts/x-fetch-tweets.py` 60s 超时 + parseTwikitRows；X 不降级 Direct
  x-tweet-parse.js  X 推文卡纯解析模块（extractTweetsFromMarkdown 雪花 ID 解码时间 / parseTwikitRows / handleFromProfileUrl）
  crawl4ai-fetch.js crawl4ai 抓取通道（Phase E 主通道）：REST 调本地容器 → 站点文章 URL 模式筛选（模式表外置 article-patterns.json）；X 账号仅作兜底（markdown 推文卡提取）
  article-patterns.json 站点 → 文章 URL 模式表（按 host 分组多模式，新增信源/改模式直接编辑本文件不动代码）
  scraper-direct.js 信源直抓降级：axios 拉 HTML → 正则提取链接 → AI 精选文章
  scraper.js/reader.js blog 类型：claude-blog 抓列表 + 读正文
  ai.js             getOpenAI 单例 + analyzeResult(options)/parseAnalyzeResult/selectArticleLinks（共享链接精选）；提示词外置 prompts/
  prompts/          AI 提示词集中目录（analyze-prompt.js 摘要6铁律 / select-links-prompt.js 链接精选）
  items.js          抓取结果 → 入库 items 形状规整（toItem/sourceSlug/normalizeUrlKey，多通道共用）
  crosscheck.js     交叉验证（方案B）：event 聚类 + 置信度/印证数/冲突标记 + 同事件去重（dedupeBySimilarity 双信号 / collapseSameEvent / dedupeAgainstExisting）
  report.js         日报 buildReport（按 category_schema 分组）
  tiers.js          getTier(url)：域名 → Tier 映射
  source-tiers.json 域名可信度映射表
  *.test.js         node:test 单元测试（npm test）
docs/               需求、决策、计划、验收、进度文档（见导航）
reports/            每日报告 YYYY-MM-DD.md（运行时自动生成）
client/             React SPA
scripts/            运维脚本（run-pipeline/install-schedule 定时自动化、test-scrape、update-sources、backfill-resummarize、dedup-existing、screenshot-ui 等）；x-fetch-tweets.py 为 twikit 桥接（读 .env 凭证，stdout 推文 JSON）
```

## 文档导航

| 内容 | 路径 | 何时读 |
|------|------|--------|
| 路径总索引 | [DOCUMENT_MAP.md](DOCUMENT_MAP.md) | 每次任务开始前 |
| 本地运行指南 | [docs/LOCAL_SETUP.md](docs/LOCAL_SETUP.md) | 新环境跑起 / 定时自动化 / 前端访问 |
| Agent 行为规范 | [AGENTS.md](AGENTS.md) | 编码前 |
| 技术规范 / 数据模型 | [docs/PRD.md](docs/PRD.md) | 改表结构或了解 pipeline |
| 功能进度 / Bug | [docs/PROGRESS.md](docs/PROGRESS.md) | 了解状态或更新进度 |
| 曼联需求文档 | [docs/REQ-曼联信源监控.md](docs/REQ-曼联信源监控.md) | 曼联相关功能对齐（含信源资产与实测） |
| 技术决策纪要 | [docs/DECISION-方案选型纪要.md](docs/DECISION-方案选型纪要.md) | 了解架构选型原因 |
| 前端原型 | [docs/prototype-board.html](docs/prototype-board.html) | 板块视图 UI 参照 |
| 历史归档 | [docs/archive/README.md](docs/archive/README.md) | 已完成的 PLAN/CHECKLIST/spec 回溯 |

## 关键约束

- 关键词统一从 Supabase `keywords` 表读取（`keywords.json` 已删除）
- search 类型：AI 评分 ≥60 视为相关（`MIN_SCORE=60`）；blog 类型已下线（`claude-blog` 关键词停用，官方内容由 anthropic 关键词的 T0 信源覆盖）
- **抓取通道（Phase E）**：`src/search.js` 逐源调用 `src/crawl4ai-fetch.js`（REST 调本地 crawl4ai 容器）→ 失败/空结果自动降级 `src/scraper-direct.js`（axios + DeepSeek 识别链接）。Firecrawl API 已停用。**定时管线依赖 Docker 容器 `crawl4ai` 在线**（`docker start crawl4ai`）；容器不可用时自动逐源降级，不影响其余源。**X 账号信源（Phase F 起）走 twikit 主通道**：`src/x-fetch.js` spawn `scripts/x-fetch-tweets.py`（.env 凭证）→ 失败回退 crawl4ai guest 推文卡 → 全败跳过（axios 抓 X 无意义，不降 Direct）；推文卡直入 feed（title=推文正文 / url=原推状态链 / 时间=真实发推时刻）
- **白名单信源**：只抓取 `keyword_sources` 表中 `fetch_type='firecrawl'` 且 `enabled=true` 的信源页面。无白名单的关键词走 HackerNews 兜底
- 当前关键词覆盖：MU（9 源三 tier，含 4 个 X 记者：Stone/Ornstein/Whitwell/Mitten）、Anthropic（6 源二 tier）、Dallas Mavericks（8 源三 tier，含 Marc Stein X），详见各 REQ 文档
- 信源页面选择实测可达站点：优先 crawl4ai 容器（可过墙），Node 直连不可达但容器可达的站点（Guardian、claude.com/blog）仍可纳入白名单
- **RLS 已收紧（Phase10）**：anon 仅 SELECT（articles/keywords/keyword_sources），后端写库用 `.env` 的 `SUPABASE_SERVICE_KEY`（service role 绕过 RLS，`src/db.js` 单例优先 service key、缺省回退 `SUPABASE_KEY`）；前端仍用 publishable key 匿名读
- Windows 路径统一使用 `E:\claude\ai-news-monitor`（Git Bash 用 `/e/claude/...`）

## 代码规范

- 后端使用 Node.js CommonJS（`require` / `module.exports`），不引入 ES Module
- 前端数据访问统一走 Supabase JS SDK（`client/src/hooks/`），不引入后端 Node 模块
- 前端评分门槛常量 `MIN_SCORE = 60` 定义在 `client/src/hooks/useArticles.ts`，前后端保持一致
- `useArticles` 的 effect 依赖使用标量字段（`filters.keywordId`、`filters.source`、`filters.search`、`filters.sortBy`、`filters.tier`），不传 `filters` 对象本身（对象引用每次渲染都变，会触发无效重请求）
- 提交前运行检查：一条 `npm run check` 搞定（= `lint` + `type-check` + `npm test`，含 `lint:backend` 对 src/scripts 全量 `node --check`）；需出构建产物再 `npm run build`（`prebuild` 自动先跑 type-check）。单项命令：后端 `npm test`；前端 `cd client && npm run type-check && npm run lint && npm run build`。格式化 `npm run format`（prettier，src/scripts/client/src）
- 只暂存本次任务涉及的文件；`.env*`、node_modules、本地产物不入库
- 新增信源时同步更新 `source-tiers.json` 域名映射（如无映射则 AI 评分不获 tier 提示）+ `article-patterns.json` 站点文章 URL 模式（如无模式命中则退回 DeepSeek 链接精选）

## 已知陷阱

### 工具 / 依赖
- **Firecrawl 已停用并删除**（HTTP 402 余额耗尽）：管线主抓取通道为 crawl4ai（`src/crawl4ai-fetch.js`），`src/firecrawl.js` 已于 2026-08-04 删除。如需恢复 Firecrawl，改 `search.js` 的逐源通道即可
- **cheerio 解析现代 SPA 页面**：页面内联 CSS/JS 会被误判为选择器（报 `Unknown pseudo-class` / `Unmatched selector`）。提取链接优先使用正则：`/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi`，再交给 DeepSeek 筛选
- **Sky Sports / 90min**：AI 链接识别偶发返回空 JSON（非标准页面结构），单源失败自动跳过，不影响其他源
- **Crawl4AI**：Docker 容器 `unclecode/crawl4ai` 跑在 `localhost:11235`，既是 Agent 交互式抓取 MCP（`crawl4ai`），也是**定时管线主抓取通道（Phase E，`src/crawl4ai-fetch.js`）**，带 `CRAWL4AI_API_TOKEN` 鉴权（token 存 `.crawl4ai-token`，已 gitignore）。用前需 `docker start crawl4ai`。**本机代理陷阱**：Windows 用户级 `HTTP_PROXY=127.0.0.1:7890` 会拦截 localhost 导致 502，已设用户级 `NO_PROXY=localhost,127.0.0.1`（新开终端才生效）
- **Crawl4AI 持续并发过载陷阱（2026-08-05 实测）**：容器能扛短时并发（3 路 2 轮全成功），但**长时间持续并发（如 pool3 批量回填）会渐进性资源耗尽，正文抓取大面积失败（实测 66% 缺失）**。回填脚本 `backfill-resummarize.js` 必须 **pool 1 串行 + 正文重试**；正文缺失时 score 下限 60 保可见。单篇正文抓取 4-21s（容器空闲时）
- **crawl4ai 信源可达性实测（2026-08-03）**：跨 Tier 均可抓——T0 manutd.com、T1 X 账号（Simon Stone/Ornstein 帖子+链接可提取）、T2 Sky/Guardian（Guardian Node 直连不可达但容器可达）/90min（跳转 si.com）。**不可用**：MEN 站点 404（文档 URL 失效）、ESPN 团队页 JS 重拿不到内容。**容器限制**：SSRF 保护使容器内浏览器无法访问宿主机 localhost / host.docker.internal（不能给本地 dev server 截图）；execute_js 端点默认禁用，需 `CRAWL4AI_EXECUTE_JS_ENABLED=true` 重建容器
- **twikit 抓 X（Phase F，2026-08-07）**：`scripts/x-fetch-tweets.py` 走宿主 venv `.venv-x/`（gitignored）。⚠️ **fork 选择**：上游 `d60/twikit` 2026-03 起 KEY_BYTE indices 错误；PyPI `twifork` 2.3.5 的 ondemand.s 解析也落后于 X 前端；用维护中 **`unclecode/twikit`**（`pip install git+https://github.com/unclecode/twikit.git`，含 2026-05-17 两段式正则补丁）。⚠️ **必须显式传 `proxy=`**（读 `X_PROXY`/`HTTP(S)_PROXY`，国内直连 x.com ConnectTimeout）。⚠️ twikit 2.x 是 **async API**（全部 await）；`get_user_tweets(user_id, tweet_type='Tweets', count=N)`。⚠️ Windows stdout 需 `reconfigure(encoding='utf-8')`（推文 emoji 撞 GBK）。凭证键名必须下划线（`.env` 里 `X cto=` 等空格键读不到）
- **X 推文分析预算（Phase F）**：`src/search.js` 信源按 tier 升序 + 非 T0 源每源上限 `MAX_PER_SOURCE=5`，保证 T1 X 推文先吃 `RESULT_LIMIT=30` 预算，不被 T2 媒体挤出。改这两个常量在 `src/config.js`
- **一次性验证脚本 `scripts/run-crawl4ai-demo.js`**：读 `scripts/_crawl4ai-items.json`（crawl4ai 抓取整理的真实 items）→ 复用 analyzeResult + crosscheck + saveArticles 跑通三 tier 交叉验证。仅验证用，不入生产管线
- **⚠️ `scripts/dedup-existing.js` 的 `--keep-ids` 只认空格分隔**：`flag()` 解析 `--keep-ids ID1,ID2`，**不接受 `--keep-ids=ID1,ID2`（等号形式被静默忽略 → keep 集为空 → 全部行被删）**。2026-08-05 曾因此误删用户要求保留的 Cisse + Project Fetch 两行（Cisse 已恢复，Project Fetch 经用户确认弃留）。传参必须空格分隔；`--apply` 前务必先跑 `--dry-run` 核对清单
- **`npm test` 不要用 `node --test src/`**：Node 22 会把 `src` 当作单个测试入口、误执行 `src/index.js`，触发一次真实管线运行（连 crawl4ai + DeepSeek + Supabase，写库并生成日报，耗时近 1 分钟）。2026-08-04 曾因此误跑一次。统一用 package.json 的 `node --test "src/*.test.js"`（只跑 4 个 *.test.js）
- **前端视觉验证用 Playwright（Phase9）**：crawl4ai 容器 SSRF 保护无法访问 localhost（实测 `URL blocked (SSRF protection)`），前端截图改走 `scripts/screenshot-ui.js`（devDependency `playwright-core`）。**浏览器已迁到 `E:\caches\playwright\ms-playwright`（2026-08-06 C 盘整治）**，用户级 `PLAYWRIGHT_BROWSERS_PATH=E:\caches\playwright\ms-playwright` 已设（新终端生效）；找不到时以此变量兜底。✅ **已跑通**（2026-08-05 产出 `screenshots/ui-board-dallas-final.png` / `screenshots/ui-board-mu-final.png`）
- **Phase9 最终交付（2026-08-05）**：历史数据回填去重 + 前端空态验收全绿（npm test 42/42、前端三件套、Carrick score 90、Naji 4→1），已 commit 并 push `origin/master`（caa4808 + 文档收尾提交）
- **Windows 定时任务 `ai-news-monitor-daily`（Phase10）**：`npm run ops:schedule` 注册每日 08:00 跑 `scripts/run-pipeline.js`（chdir 仓库根 → 幂等 `docker start crawl4ai` → `node src/index.js` → 追加 `logs/pipeline-YYYY-MM-DD.log`）。任务以当前用户**登录时**运行（无需管理员），机器休眠/未登录不触发；卸载 `npm run ops:unschedule`。前端已部署 Vercel（`ai-news-monitor-silk.vercel.app`），本地兜底 `npm run serve`
- **⚠️ `.env` 相对 `process.cwd()` 加载（非 `__dirname`）**：`src/config.js` 的 `require('dotenv').config()` 按当前工作目录解析 `.env`；从任意 cwd 启动的脚本（任务计划/npm prefix）会**静默漏读 DEEPSEEK/SUPABASE 密钥**（不报错）。任何需要环境变量的脚本开头先 `process.chdir(仓库根)`（参考 `scripts/run-pipeline.js`）
- **⚠️ Docker daemon 未运行时 `docker` CLI 会长时间阻塞（实测 >120s 不返回，2026-08-05）**：自动化脚本 spawn docker 必须带超时——`spawnSync('docker', [...], { timeout: 30000 })`（参考 `run-pipeline.js` 的 `startCrawl4ai`）。容器已设 `--restart unless-stopped`（随 Docker Desktop 自启，2026-08-05），但引擎未启动时 CLI 仍会挂。自检三步：`docker ps -a --filter name=crawl4ai` → `docker logs crawl4ai --tail 50` → `curl -s http://localhost:11235/health`
- **⚠️ Docker UI「Engine running」但 CLI 全挂 = 僵尸 backend（2026-08-05）**：只跑 `wsl --shutdown` 再 `Start-Process Docker Desktop` **不够**——旧的 `com.docker.backend.exe` 会继续占着 named pipe、UI 仍显示 running，而 WSL 里 dockerd 已死（`docker-desktop` Stopped / 无 `docker.sock`）。证据：backend CreationDate 仍是前一天、`docker version` 超时、11235 HTTP 000。**正确恢复**：`powershell -ExecutionPolicy Bypass -File scripts\restart-docker-engine.ps1`（杀光 Docker 进程 → wsl --shutdown → 干净启动 → 等到 Server 版本 → `docker start crawl4ai`）。勿用「只关 WSL」当重启
- **⚠️ C 盘打满会渐进性杀死 Docker 引擎（2026-08-06 实测）**：磁盘 0 可用 → WSL2 VHD 无法增长 → crawl4ai 逐源 500 → 引擎崩溃 → CLI 挂死。**Docker 数据已迁 `E:\Docker\wsl`（junction：`C:\Users\asus\AppData\Local\Docker\wsl → E:\Docker\wsl`，2026-08-06）**，迁移步骤见 `docs/archive/DISK-CLEANUP-2026-08-06.md`（归档，含 disk-cleanup-*.bat 脚本）。清理 C 盘务必预留 ≥5G 余量，避免重蹈覆辙
- **Vercel 部署：项目未创建时报 `project_not_found`**：`vercel deploy --project <name>` 不会自动建项目，需先 `vercel project add <name> --scope <team>`；`VITE_*` 构建变量用 `vercel env add` 持久化到项目级
- **⚠️ Vercel 前端部署标准姿势（2026-08-07 实测）**：`cd client && vercel deploy --prod`。⚠️ **勿用仓库根 `vercel deploy client --prod`**——`.vercel` 链接错乱时会误建 `patrick-wen/client` 项目。部署前先 `cat client/.vercel/project.json` 确认 `projectName` 是 `ai-news-monitor`；链接错了 `cd client && vercel link --project ai-news-monitor --yes` 修复。Vercel 免费版构建队列一次只跑一个部署，**反复 cancel/redeploy 会让新部署卡 QUEUED**，等队列清空或一条干净重试即可
- **⚠️ Vercel 构建 `npm install` 503 陷阱（2026-08-07）**：本机 `C:\Users\asus\.npmrc` 的 `registry=https://registry.npmmirror.com` 会被 Vercel 构建机继承，npmmirror 对美国节点不稳定（实测 `strip-ansi` 拉包 503 → 部署 Error）。**项目级加 `NPM_CONFIG_REGISTRY=https://registry.npmjs.org/` 环境变量强制官方源**（`vercel env add` 或 API 加）

### 网络访问
- **BBC Sport / The Guardian**：Node 直连（axios）ETIMEDOUT 不可达；crawl4ai 容器可达 Guardian。管线抓取仍优先选国内可达站点
- **claude.com/blog**：Node 直连超时（国内不可达），crawl4ai 容器可达（2026-08-04 实测 ✅）
- **anthropic.com/news / anthropic.com/research**：crawl4ai 容器可达（2026-08-04 实测 ✅）
- **TechCrunch / Wired**：双通道可达；**VentureBeat / Yahoo Sports / Bleacher Report**：仅 crawl4ai（Node 403/429 限流）
- **Ars Technica**：JS challenge wall，双通道均不可达（不可用）
- **SI Mavs / Mavs Moneyball / The Smoking Cuban**：crawl4ai 可达，Dallas 信源新增（2026-08-04 实测 ✅）
- **RealGM Dallas**：crawl4ai 被 bot 保护（HTTP 500），不可用
- **ESPN / SI / CBS Sports**：bot detection 或 JS SPA，crawl4ai 不可达（Dallas 场景排除）
- **nba.com/mavs/news / dallasnews.com**：crawl4ai 可达（2026-08-04 Dallas 实测 ✅）

### 抓取陷阱

- **ARTICLE_PATTERNS 已外置（2026-08-05 第一批重构）**：站点→文章 URL 模式表从 `crawl4ai-fetch.js` 抽到 `src/article-patterns.json`，按 host 分组**多模式数组**，匹配为逐一 `test()`（修 si.com 双条目——soccer/nba 各自匹配，Dallas 的 nba 模式不再被 `.find` 取第一条遮蔽）。新增信源/改 URL 模式**只编辑该 JSON**，勿改 crawl4ai-fetch.js 代码
- **⚠️ 门户页导航链接污染（2026-08-04 Dallas 踩坑）**：Yahoo Sports / Bleacher Report / NBA.com 团队门户页包含大量非文章导航链接（Scores/Standings/Schedule/Stats/Draft/Fantasy/Suites/Sponsorship 等），`crawl4ai-fetch.js` 的 `isNonArticleUrl()` 过滤器必须持续维护，否则垃圾链接会被当作"文章"入库。**修复**：在 `isNonArticleUrl()` 中新增 20+ NBA 特有导航关键词过滤。验证结果：修复后 Yahoo 从 15 条垃圾 → 0 条，Dallas 真实新闻占比 100%。
- **⚠️ 白名单 URL 准确性验证**：新加信源时，不能仅凭 HTTP 200 判断可用——必须人工验证 crawl4ai 返回的链接是否是真新闻文章（非导航/菜单/比分）。Yahoo `sports.yahoo.com/nba/teams/dallas/` 返回 200 但初始产出全部是比分板链接，修复后正常。
- **Dallas 信源特征**：休赛期 NBA 团队门户页新闻更新频率远低于足球赛季中。Mavs Moneyball / The Smoking Cuban 等博客产出量大（150+ 条/轮），靠 AI 评分 + URL 去重收敛。
- **Bleacher Report（Dallas）**：crawl4ai AI 链接识别偶发空 JSON，自动降级 Direct → Direct 403 → 跳过，不影响管线。

### 数据约束
- **`keyword_sources.rss_url` 列有 NOT NULL 约束**：仅用 firecrawl 模式时，插入记录也要给 `rss_url` 填值（填与 `scrape_url` 相同的值）
- **`keyword_sources` 的 `(keyword_id, rss_url)` 有唯一约束**：更新信源时先 DELETE 旧行再 INSERT 新行
- **MU 关键词 query 字段**：使用宽泛词 `"Manchester United"`（白名单模式下信源已限定，query 无需附加限定词）
- **Anthropic 关键词 query 字段**：使用 `"anthropic AI"`，白名单 6 源（T0: anthropic.com/news + research + claude.com/blog | T1: TechCrunch + VentureBeat + Wired）
- **Dallas 关键词 query 字段**：使用 `"dallas mavericks"`，白名单 8 源（T0: nba.com/mavs/news | T1: Marc Stein(X) | T2: Dallas Morning News + Yahoo Sports + Bleacher Report + SI Mavs + Mavs Moneyball + The Smoking Cuban）
- **claude-blog 关键词已停用**（2026-08-04），原 blog pipeline（scraper.js/reader.js/summarizeArticle）保留代码但不再触发
- **`published_at` 语义（Phase8 起）**：真实发布日期，由 `src/dates.js` 的 `extractPublishDateFromUrl(url)` 从 URL 提取（Guardian 英文月 + 数字日期，拒绝未来/非法日期）；URL 无日期 → **NULL**，`created_at` 保留首次发现时间。前端 30 天 recency 窗口豁免 `published_at.is.null` 与 `source_tier.eq.0`
- **`articles.event_type` 列**（Phase8）：体裁（interview/match/rumour/injury/deal/official/analysis），由 AI 从 analyzeResult 提取，index.js 全链路入库；前端卡片显示小灰字体裁徽章
- **正文喂养**：`src/crawl4ai-fetch.js` 导出 `fetchArticleBody(url)→string|null`（正文片段，剥导航去重截 1500 字）；`src/index.js` 对 search 类型候选并发池 3 抓正文喂 `analyzeResult(..., body)`，失败回落标题-only。摘要质量（A4a 事实锚点）依赖此机制
- **DMN 付费墙**：dallasnews.com 计量墙（10篇/30天），保留信源但前端 `PAYWALL_SOURCES` 标注"正文需订阅"角标，不删除（本地最强跟队 Townsend/Caplan 独家）
- **Mavs Moneyball / Smoking Cuban**：JS 重渲染站点，crawl4ai 抓取需 `wait_for`（`JS_SOURCES` 命中自动 5s），否则 0 产出
- **同事件去重（Phase9 起，v3 双信号 + seed-only）**：入库前同批 `collapseSameEvent`（seed-only 聚类，禁链式传递）保留最高分代表行；跨运行 `dedupeBySimilarity` 双规则比对近 30 天已存事件：**规则A**（evSim≥0.60 且 tSim≥0.45 且动作兼容）或 **规则B**（共享特有专名 + 同动作组 + evSim≥0.15），任一侧 event 为空不判重。⚠️ **重跑管线不会重算已入库文章的旧摘要**（`filterNewItems` URL 去重），历史数据修正须用 `scripts/backfill-resummarize.js`

### Agent 行为
- **路径中的 "claude" 易被写成 "droid"**：使用 Windows 绝对路径（`E:\claude\...`）规避；Git Bash 必须用 `/e/claude/...`
- **TypeScript 锁定 `^5.8`**：与 `@typescript-eslint` 兼容上限一致，升级到 TS 7.x 会破坏 lint
- **前端 `client/.env`**：不进版本控制，新环境需手动创建（缺失时 `supabase.ts` 启动即 throw，页面白屏）

---

> **本文由 AI 自行维护。** 遇到新的已知陷阱、配置变更或模块增删时，更新本文对应章节。内容超过 200 行时，优先精简过时条目而非新增。
