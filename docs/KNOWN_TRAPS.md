# KNOWN_TRAPS — ai-news-monitor

> 已知陷阱与排错手册。遇到异常/报错/工具报错/管道失败时先查本文，再从零排查。
> 最后更新：2026-08-11（新增 GitHub Actions / crawl4ai 容器 CI 陷阱）

---

## 工具 / 依赖

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
- **前端视觉验证用 Playwright（Phase9）**：crawl4ai 容器 SSRF 保护无法访问 localhost（实测 `URL blocked (SSRF protection)`），前端截图改走 `scripts/screenshot-ui.js`（devDependency `playwright-core`）。**浏览器已迁到 `E:\caches\playwright\ms-playwright`（2026-08-06 C 盘整治）**，用户级 `PLAYWRIGHT_BROWSERS_PATH=E:\caches\playwright\ms-playwright` 已设（新终端生效）；找不到时以此变量兜底
- **Windows 定时任务 `ai-news-monitor-daily`（Phase10）**：`npm run ops:schedule` 注册每日 08:00 跑 `scripts/run-pipeline.js`（chdir 仓库根 → 幂等 `docker start crawl4ai` → `node src/index.js` → 追加 `logs/pipeline-YYYY-MM-DD.log`）。任务以当前用户**登录时**运行（无需管理员），机器休眠/未登录不触发；卸载 `npm run ops:unschedule`
- **⚠️ `.env` 相对 `process.cwd()` 加载（非 `__dirname`）**：`src/config.js` 的 `require('dotenv').config()` 按当前工作目录解析 `.env`；从任意 cwd 启动的脚本（任务计划/npm prefix）会**静默漏读 DEEPSEEK/SUPABASE 密钥**（不报错）。任何需要环境变量的脚本开头先 `process.chdir(仓库根)`（参考 `scripts/run-pipeline.js`）
- **⚠️ Docker daemon 未运行时 `docker` CLI 会长时间阻塞（实测 >120s 不返回，2026-08-05）**：自动化脚本 spawn docker 必须带超时——`spawnSync('docker', [...], { timeout: 30000 })`（参考 `run-pipeline.js` 的 `startCrawl4ai`）。容器已设 `--restart unless-stopped`（随 Docker Desktop 自启，2026-08-05），但引擎未启动时 CLI 仍会挂。自检三步：`docker ps -a --filter name=crawl4ai` → `docker logs crawl4ai --tail 50` → `curl -s http://localhost:11235/health`
- **⚠️ Docker UI「Engine running」但 CLI 全挂 = 僵尸 backend（2026-08-05）**：只跑 `wsl --shutdown` 再 `Start-Process Docker Desktop` **不够**——旧的 `com.docker.backend.exe` 会继续占着 named pipe、UI 仍显示 running，而 WSL 里 dockerd 已死（`docker-desktop` Stopped / 无 `docker.sock`）。**正确恢复**：`powershell -ExecutionPolicy Bypass -File scripts\restart-docker-engine.ps1`（杀光 Docker 进程 → wsl --shutdown → 干净启动 → 等到 Server 版本 → `docker start crawl4ai`）
- **⚠️ C 盘打满会渐进性杀死 Docker 引擎（2026-08-06 实测）**：磁盘 0 可用 → WSL2 VHD 无法增长 → crawl4ai 逐源 500 → 引擎崩溃 → CLI 挂死。**Docker 数据已迁 `E:\Docker\wsl`（junction：`C:\Users\asus\AppData\Local\Docker\wsl → E:\Docker\wsl`，2026-08-06）**，迁移步骤见 `docs/archive/DISK-CLEANUP-2026-08-06.md`。清理 C 盘务必预留 ≥5G 余量

---

## GitHub Actions / CI（2026-08-11 管线搬 GitHub 实战记录）

- **⚠️ crawl4ai 容器不传 `CRAWL4AI_API_TOKEN` 时入口只绑 `[::]`，端口映射不可达**：`unclecode/crawl4ai` 的 entrypoint 仅在设置了 API token 时才监听可映射的地址；不传 token 时 `-p 11235:11235` 映射的端口无法访问 `/health`。**CI/本地启动必须带 `-e CRAWL4AI_API_TOKEN=...`**（daily-pipeline.yml / crawl4ai-smoke.yml 已带，`KNOWN_TRAPS` 补录原文以免漏）
- **⚠️ GitHub Actions 账户级计费阻断（2026-08-11 实测，已解决）**：job 完全不启动，annotation 报 `recent account payments have failed or your spending limit needs to be increased`。这是 **GitHub 账户 Billing & plans** 问题（失败付款 / spending limit），**与代码、模型、Secret 均无关**。**根因**：私有仓库 + free 计划 + 无支付方式 = 账户级锁死；绑卡又卡在 Stripe 只认国际卡（中国银联/支付宝不支持）+ 中国区贸易合规误报（"You have not added a payment method" 空白页）。**解法**：**把仓库转 public** —— 公开仓库标准 runner 免费不限量、不消耗配额、**不需要支付方式**，计费锁随之解除（本仓库 2026-08-11 转 public 后首个 run 即成功）。注意：转公开前务必清理 git 历史中的真实密钥（见下条）。
- **⚠️ 转公开前必须扫 git 历史里的真实密钥（2026-08-11 教训）**：`scripts/_tokentest.js` 曾含真实 Supabase Personal Access Token（`sbp_...`，2026-08-04 `7c903bd` 起入库并已 push 到 3 个远端分支）。删除文件挡不住 git 历史残留——**唯一彻底解法 = 撤销该 token 本身**（Supabase → Account Settings → Access Tokens → Revoke，验证方法：`curl -H "Authorization: Bearer <token>" https://api.supabase.com/v1/projects` 应返回 401）。事后执行：`git rm` 该文件 + 加 gitignore + 提交（本仓库 `39281f5`）。**教训：任何含 `_` 前缀的一次性测试脚本，先查是否有真实密钥再入库；仓库将转公开前先 `git grep` 扫 `sbp_`/`sk-`/`service_role`/`ghp_`。**
- **GitHub Actions 只在默认分支跑 workflow_dispatch（2026-08-11 实测）**：`gh workflow run <file>` 报 `404 not found on default branch` —— 即使文件已在当前分支。workflow 文件必须先在默认分支（master）上存在，或用 `--ref <branch>` 指定含该文件的已推送分支。
- **run-pipeline.js `--ci` 模式（CI 专用，2026-08-11 新增）**：CI 容器由 workflow job 启动，`--ci` 只做健康检查（失败降级 scraper-direct + 告警），跳过 docker start / Windows 引擎重启 / 日志 auto-push。本地手动跑**不要加 `--ci`**（否则跳过 docker 启动步骤，抓取直接走降级）。`X_TWIKIT_ENABLED=0` 时 X 账号跳过（runner 无法交互登录）。
- **`EMAIL_ENABLED` 读 `vars` 而非 secret（daily-pipeline.yml）**：变量未设置时展开为空串，config.js `EMAIL_ENABLED !== '0'` 判断为**默认开启邮件**。验证期务必先 `gh variable set EMAIL_ENABLED=false`（已设），否则 SMTP secret 配齐后会发空摘要邮件。
- **`gh` CLI 在 Git Bash 下的路径改写坑**：`gh api`/`gh workflow run` 的 URL 参数可能被 MSYS 路径转换改写（`invalid API endpoint` / `404`）。加 `MSYS_NO_PATHCONV=1` 前缀可禁用。
- **actionlint 非 npm 包**：`npx actionlint` 报 `could not determine executable to run`。需从 GitHub Releases 下载 Windows/Linux 二进制（本机已放 `E:/claude/tools/actionlint/actionlint.exe`，不入版本库）。
- **本地 run-pipeline 健康检查 `-o nul` vs Linux `/dev/null`**：curl 输出设备在 Windows 是 `nul`、Linux 是 `/dev/null`。`run-pipeline.js` 的 `healthCheckOutputPath(platform)` 纯函数按平台返回，单测覆盖两端。

---

## 网络访问

- **⚠️ Git 推拉 GitHub 走代理（2026-08-08 实测）**：本机 GitHub HTTPS 443 直连不可达（`Connection reset` / `Could not connect`），SSH 22 端口通但本地 `id_rsa` 未被仓库所属 GitHub 账户授权（`Permission denied (publickey)`）。**解决**：`netstat -ano` 确认代理（Clash/V2Ray）监听 `127.0.0.1:7890` → `git config --global http.proxy http://127.0.0.1:7890` + `https.proxy` 同值。环境变量 `HTTP_PROXY`/`HTTPS_PROXY` 为空时，Git 不走进程继承，必须显式配 config 层。注意与 Crawl4AI 的 `NO_PROXY=localhost` 配合使用（两者不冲突：Git 走代理出站，crawl4ai 不走代理访问本地容器）
- **BBC Sport / The Guardian**：Node 直连（axios）ETIMEDOUT 不可达；crawl4ai 容器可达 Guardian
- **claude.com/blog**：Node 直连超时（国内不可达），crawl4ai 容器可达。⚠️ **容器不可用时此源 100% 颗粒无收**——Direct 降级对 claude.com 完全无效
- **anthropic.com/news / anthropic.com/research**：crawl4ai 容器可达。⚠️ **Direct 降级脆弱**：Node 直连可拉 HTML 但 AI 链接识别频繁失败（非标准页面结构）
- **TechCrunch / Wired**：双通道可达；**VentureBeat / Yahoo Sports / Bleacher Report**：仅 crawl4ai（Node 403/429 限流）
- **Ars Technica**：JS challenge wall，双通道均不可达（不可用）
- **SI Mavs / Mavs Moneyball / The Smoking Cuban**：crawl4ai 可达
- **RealGM Dallas**：crawl4ai 被 bot 保护（HTTP 500），不可用
- **ESPN / SI / CBS Sports**：bot detection 或 JS SPA，crawl4ai 不可达（Dallas 场景排除）
- **nba.com/mavs/news / dallasnews.com**：crawl4ai 可达

---

## 抓取陷阱

- **claude.com/blog 卡片式链接（F-020 修复）**：首页 markdown 是 `## 真实标题 | 日期 | [Read more](url)`，锚文本是 CTA 无标题信息。`extractMarkdownLinks` 已加卡片式行级匹配，`isGenericCta` 识别 Read more/Learn more 等并让 `titleFromSlug` 兜底——修复前 25 条里 10 条 title="Read more" 被 AI 判 0 分。**新增卡片式博客信源时沿用此机制，勿删**
- **`fetchArticleBody` 导航段污染（F-020 修复）**：claude.com 文章 `fit_markdown` 为空回落 `raw_markdown`，raw 顶部是 2700+ 字符站点导航。`cleanArticleBody` 现用 `isNavBlock`（链接密度/每链接纯文字比）剥导航段 + 最长正文段锚定兜底。别在 `cleanArticleBody` 上回退简化
- **ARTICLE_PATTERNS 已外置**：站点→文章 URL 模式表从 `crawl4ai-fetch.js` 抽到 `src/article-patterns.json`，按 host 分组多模式数组。新增信源/改 URL 模式**只编辑该 JSON**，勿改 crawl4ai-fetch.js
- **⚠️ 门户页导航链接污染（2026-08-04 Dallas 踩坑）**：Yahoo Sports / Bleacher Report / NBA.com 团队门户页包含大量非文章导航链接。`crawl4ai-fetch.js` 的 `isNonArticleUrl()` 过滤器必须持续维护
- **⚠️ 白名单 URL 准确性验证**：新加信源时，不能仅凭 HTTP 200 判断可用——必须人工验证 crawl4ai 返回的链接是否是真新闻文章（非导航/菜单/比分）
- **Dallas 信源特征**：休赛期 NBA 团队门户页新闻更新频率远低于足球赛季中。Mavs Moneyball / The Smoking Cuban 等博客产出量大（150+ 条/轮），靠 AI 评分 + URL 去重收敛
- **Bleacher Report（Dallas）**：crawl4ai AI 链接识别偶发空 JSON，自动降级 Direct → Direct 403 → 跳过

---

## 数据约束陷阱

- **`keyword_sources.rss_url` 列有 NOT NULL 约束**：仅用 firecrawl 模式时，插入记录也要给 `rss_url` 填值（填与 `scrape_url` 相同的值）
- **`keyword_sources` 的 `(keyword_id, rss_url)` 有唯一约束**：更新信源时先 DELETE 旧行再 INSERT 新行
- **DMN 付费墙**：dallasnews.com 计量墙（10篇/30天），保留信源但前端 `PAYWALL_SOURCES` 标注"正文需订阅"角标
- **Mavs Moneyball / Smoking Cuban**：JS 重渲染站点，crawl4ai 抓取需 `wait_for`（`JS_SOURCES` 命中自动 5s），否则 0 产出
- **同事件去重（Phase9 起，v3 双信号 + seed-only）**：入库前同批 `collapseSameEvent`（seed-only 聚类，禁链式传递）保留最高分代表行；跨运行 `dedupeBySimilarity` 双规则比对近 30 天已存事件。⚠️ **重跑管线不会重算已入库文章的旧摘要**（`filterNewItems` URL 去重），历史数据修正须用 `scripts/backfill-resummarize.js`

---

## Vercel 部署

- **Vercel 部署：项目未创建时报 `project_not_found`**：`vercel deploy --project <name>` 不会自动建项目，需先 `vercel project add <name> --scope <team>`；`VITE_*` 构建变量用 `vercel env add` 持久化到项目级
- **⚠️ Vercel 前端部署标准姿势（2026-08-07 实测）**：`cd client && vercel deploy --prod`。⚠️ **勿用仓库根 `vercel deploy client --prod`**——`.vercel` 链接错乱时会误建项目。部署前先 `cat client/.vercel/project.json` 确认 `projectName` 是 `ai-news-monitor`
- **前端部署快捷命令（2026-08-13 新增）**：直接 `npm run deploy`（含校验 project.json + 交互确认；`--no-confirm` 自动化，`--build` 先本地预检）。校验失败会打印修复指引，不要再手动折腾构建队列/项目根目录
- **⚠️ Vercel 构建 `npm install` 503 陷阱（2026-08-07）**：本机 `.npmrc` 的 npmmirror 会被 Vercel 构建机继承，对美国节点不稳定。**项目级加 `NPM_CONFIG_REGISTRY=https://registry.npmjs.org/` 环境变量**

---

## Agent 行为陷阱

- **路径中的 "claude" 易被写成 "droid"**：使用 Windows 绝对路径（`E:\claude\...`）规避；Git Bash 必须用 `/e/claude/...`
- **TypeScript 锁定 `^5.8`**：与 `@typescript-eslint` 兼容上限一致，升级到 TS 7.x 会破坏 lint
- **前端 `client/.env`**：不进版本控制，新环境需手动创建（缺失时 `supabase.ts` 启动即 throw，页面白屏）

---

> **本文由 AI 自行维护。** 遇到新陷阱或修复已知问题时更新对应章节。内容超过 200 行时优先精简过时条目。
