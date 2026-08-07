# LOCAL_SETUP — 本地运行指南

> 目标：新机器/新环境从零跑起 ai-news-monitor，含**手动运行**与**定时自动化**两套玩法。技术细节与已知陷阱见 [CLAUDE.md](../CLAUDE.md)。

## 0. 前置依赖

| 依赖 | 用途 | 说明 |
|---|---|---|
| Node.js ≥ 20 | 后端管线 | 包管理器 npm |
| Docker Desktop + crawl4ai 容器 | 主抓取通道 | 容器跑 `localhost:11235`，先 `docker start crawl4ai` |
| Supabase 项目 | 数据存储 | 需 `SUPABASE_URL` + publishable key + service key |
| DeepSeek API Key | AI 评分/摘要 | OpenAI SDK 兼容 |

前端部署到 Vercel（公网 URL），**本机无需再起前端**。

## 1. 环境变量

复制 `.env.example` 到 `.env`（仓库根）与 `client/.env.example` → `client/.env`：

| 变量 | 位置 | 说明 |
|---|---|---|
| `DEEPSEEK_API_KEY` | `.env` | DeepSeek 密钥 |
| `SUPABASE_URL` | 两端 | https://xxx.supabase.co |
| `SUPABASE_KEY` | 两端 | publishable key（前端 bundle 内可见，安全） |
| `SUPABASE_SERVICE_KEY` | `.env`（后端） | service role key，**仅后端/运维脚本用**，勿进前端 |
| `CRAWL4AI_API_TOKEN` | `.env` | crawl4ai 容器鉴权（亦存 `.crawl4ai-token`） |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_KEY` | `client/.env` | 前端构建内联用 |

> `client/.env` 不进版本控制；缺失时前端启动即报错白屏。

## 2. 手动跑一次管线

```bash
docker start crawl4ai        # 确保容器在线
node src/index.js            # 或 npm start
```

- 产出：Supabase `articles` 表新数据 + `reports/YYYY-MM-DD.md` 日报
- 手动验证质量：`npm run ops:quality`（check-quality）
- 回归：`npm run check`（lint + type-check + 42 项单测）

## 3. 定时自动化（Windows 任务计划）

已提供包装 + 注册脚本，无需写 bat：

```bash
npm run ops:schedule                 # 注册每日 08:00 定时任务（默认时间）
npm run ops:schedule -- --time 07:30 # 改时间注册
npm run ops:schedule:info            # 查看任务
npm run ops:unschedule               # 卸载
```

机制：

- 任务名 `ai-news-monitor-daily`，以当前用户**登录时**运行（无需管理员）
- 触发 `scripts/run-pipeline.js`：先幂等 `docker start crawl4ai` → 跑 `node src/index.js` → 输出追加到 `logs/pipeline-YYYY-MM-DD.log`
- 与手动运行完全等价，只是无人值守；机器重启后任务自动恢复

> 依赖：定时触发时机器在登录状态 + Docker 在线（wrapper 会自动拉起容器）。容器不可用时管线逐源降级，不影响其余源。

## 4. 前端

### 线上（推荐，已部署 Vercel）

- 地址：`https://ai-news-monitor-silk.vercel.app`（项目 `ai-news-monitor`，team `patrick-wen`）
- 纯静态 SPA 直连 Supabase；更新前端后需重新部署（构建环境变量已持久化在项目上）

**部署命令（2026-08-07 实测标准流程，一条成功）：**

```bash
# ① 确认链接到正确项目（不是误建的 `client` 项目）
cat client/.vercel/project.json          # 应含 "projectName":"ai-news-monitor"
# 若链接错误：修复
cd client && vercel link --project ai-news-monitor --yes

# ② 从 client/ 目录部署到 production
cd client && vercel deploy --prod
```

> ⚠️ **勿用仓库根 `vercel deploy client --prod`**：该写法在 `.vercel` 链接错乱时会把 `client` 当项目名误建 `patrick-wen/client`（2026-08-07 实测）。正确姿势是从 `client/` 目录内 `vercel deploy --prod`，或先 `vercel link` 再部署。

### 本地调试

```bash
npm run dev      # Vite dev server → http://localhost:5173
npm run serve    # 生产构建 + 静态预览 → http://127.0.0.1:5173（本地兜底，不需 dev server）
```

> 前端视觉验证用 `scripts/screenshot-ui.js`（Playwright 截图，需先起 `npm run dev`）。

## 5. 常见排查

| 症状 | 排查 |
|---|---|
| 前端白屏 | `client/.env` 缺失（`supabase.ts` 启动即 throw）；Vercel 上检查项目环境变量 |
| 管线某源 0 产出 | crawl4ai 容器未启动 → `docker start crawl4ai`；单源失败自动跳过 |
| **UI 显示 Engine running，但 `docker ps` 挂起 / 11235 不通** | **僵尸 backend**：只跑了 `wsl --shutdown` + 再开 Desktop，旧的 `com.docker.backend` 仍活着，管道还在、引擎已死。不要只杀 WSL。运行：`powershell -ExecutionPolicy Bypass -File scripts\restart-docker-engine.ps1`（会杀光 Docker 进程 → shutdown WSL → 干净启动 → 等到 `docker version` 有 Server 版本 → `docker start crawl4ai`） |
| 定时任务没跑 | `npm run ops:schedule:info` 看状态；确认机器当时登录、Docker 在线 |
| 定时日志去哪了 | `logs/pipeline-YYYY-MM-DD.log` |
| 依赖本机代理 | Windows 用户级 `HTTP_PROXY=127.0.0.1:7890` 会拦 localhost → 设 `NO_PROXY=localhost,127.0.0.1` |

快速自检（区分「UI 假 running」与真引擎）：

```powershell
wsl -l -v                                          # docker-desktop 必须 Running
docker version --format "{{.Server.Version}}"      # 应立刻返回版本号；>10s 即引擎未就绪
curl http://127.0.0.1:11235/health                 # crawl4ai：应 HTTP 200
```

## 6. 运维脚本速查

```bash
npm run ops:backfill    # 历史文章重新摘要（改 prompt/正文后）
npm run ops:dedup       # 对存量文章同事件去重（先 --dry-run）
npm run ops:screenshot  # Playwright 截图
npm run ops:quality     # 质量验收
npm run ops:run-auto    # 等价于定时触发的包装脚本（手动模拟一次定时）
```

详见 [PROGRESS.md](PROGRESS.md) 与 [CLAUDE.md](../CLAUDE.md) 已知陷阱。
