# REVIEW: 管线搬 GitHub Actions（纯 CI）

> 复核日期: 2026-08-11 ｜ 复核 agent: Evaluator（independent）
> 对应 PLAN: docs/PLAN-管线搬GitHub.md ｜ 风险等级: 🟡 中（关键路径——crawl4ai 冒烟 / daily-pipeline dispatch / Supabase 落库——待 Phase 4 实机，本机无法真跑）
> 依据: docs/SPRINT-20260811-github-pipeline.md §2 审核清单 + review package d056d2d..3e20530

## 复核结论

**✅ PASS** — 所有 C1-C3 / V1-V4 / S1-S3 逐项通过。无阻塞项，无需要修改项。
（遗留均为"待 Phase 4 实机"项 + 非阻塞观察，见下。）

---

## 一、独立重跑验证（Evaluator 全部自行重跑，非 Generator 粘贴）

### 1.1 `node --check scripts/run-pipeline.js`
```
NODE_CHECK_EXIT=0
```

### 1.2 `node --test scripts/run-pipeline.test.js -v`
```
TAP version 13
# Subtest: parseArgs: --ci → ci=true
ok 1 - parseArgs: --ci → ci=true
# Subtest: parseArgs: 无参全 false
ok 2 - parseArgs: 无参全 false
# Subtest: parseArgs: --no-docker + --no-alert
ok 3 - parseArgs: --no-docker + --no-alert
# Subtest: healthCheckOutputPath: win32 → nul
ok 4 - healthCheckOutputPath: win32 → nul
# Subtest: healthCheckOutputPath: linux → /dev/null
ok 5 - healthCheckOutputPath: linux → /dev/null
1..5
# tests 5
# pass 5
# fail 0
```

### 1.3 `npm test`
```
1..118
# tests 118
# pass 118
# fail 0
```
基线核对：父提交 d056d2d 测试文件 13 个 → HEAD 14 个（+`scripts/run-pipeline.test.js`）；新增 5 条在 npm test 下真实执行（subtest 1-5）。118 = 113 基线 + 5，无减少。

### 1.4 `npm run check`（lint + type-check + test）
```
CHECK_EXIT=0
```
lint:backend / lint:client / type-check / test 全绿（118/118）。

### 1.5 actionlint（两个新 workflow）
```
$ actionlint .github/workflows/daily-pipeline.yml .github/workflows/crawl4ai-smoke.yml
ACTIONLINT_EXIT=0
```
actionlint v1.7.12（windows_amd64）。

---

## 二、工作流语义手工复核

| 检查项 | 结果 | 证据 |
|--------|------|------|
| cron = `0 0 * * *`（北京 08:00）+ `workflow_dispatch` | ✅ | daily-pipeline.yml L4-6：`schedule: - cron: '0 0 * * *'` + `workflow_dispatch:` |
| `docker run` 传 `-e CRAWL4AI_API_TOKEN` + `-p 11235:11235` | ✅ | daily-pipeline.yml L30-31 / crawl4ai-smoke.yml L12-13，两处都传 token |
| env 传 `SUPABASE_SERVICE_KEY`（非 publishable `SUPABASE_KEY`） | ✅ | L49 `SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}`；workflow 未出现 `SUPABASE_KEY` |
| `X_TWIKIT_ENABLED: '0'` | ✅ | L52；config.js L63 `X_TWIKIT_ENABLED !== '0'` → CI 下为 false，X 跳过 |
| `EMAIL_ENABLED` 读 `vars` | ✅ | L53 `EMAIL_ENABLED: ${{ vars.EMAIL_ENABLED }}`；非 secret，Phase 4 可用 `gh variable set` 切换 |
| Secret 名与 src/config.js 一一对应 | ✅ | 15 个 env 名逐一 grep config.js 全部命中（详见下表） |
| 失败分支 `if: failure()` + `gh issue create` + `issues: write` | ✅ | L8-10 `permissions: issues: write`；L73-88 `if: failure()` + `gh issue create`，对齐 ops-check.yml 模式 |
| `run-pipeline.js --ci` 本地路径不回归 | ✅ | `--ci` 分支在 `if (noDocker)`（L157）之后、`dockerStart(2)`（L181）之前插入；`CI_MODE` 默认 false，本地不加 `--ci` 原样走 dockerStart |
| `healthCheckOutputPath` 跨平台 | ✅ | L43-45 win32→`nul`，否则→`/dev/null`；L110 curl `-o` 使用该函数；单测覆盖两端 |
| `autoPushLogs` CI 守卫 | ✅ | L264 `if (CI_MODE) { return; }`，日志交 upload-artifact |
| ops-check.yml L31 secret 语法 | ✅ | `SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}` 无多余空格，与 DECISION §2.4 一致 |

**Secret 名 ↔ src/config.js 对应核验**（`grep -c "process.env.X" src/config.js`）：

| env 名 | config.js 命中 | env 名 | config.js 命中 |
|--------|------|--------|------|
| DEEPSEEK_API_KEY | 1 | CRAWL4AI_API_TOKEN | 1 |
| DEEPSEEK_BASE_URL | 1 | X_TWIKIT_ENABLED | 1 |
| DEEPSEEK_MODEL | 1 | EMAIL_ENABLED | 1 |
| SUPABASE_URL | 1 | SMTP_HOST | 1 |
| SUPABASE_SERVICE_KEY | 1 | SMTP_PORT | 1 |
| CRAWL4AI_URL | 1 | SMTP_SECURE | 1 |
| EMAIL_USER | 1 | EMAIL_AUTH_CODE | 1 |
| RECEIVER_EMAIL | 1 | | |

---

## 三、Sprint Contract §2 逐项判定

### 3.1 理解检查

| # | 检查项 | 判定 | 证据 |
|---|--------|------|------|
| C1 | 目标对齐：纯 CI、动态 crawl4ai、`--ci` 模式、本地不变、X 跳过 | **PASS** | daily-pipeline.yml 动态 docker run；run-pipeline.js L163-179 CI_MODE 分支；L181 本地路径不变；L52 X 关闭 |
| C2 | 范围边界：不做自愈/X 登录/改表/breaking-check/Firecrawl | **PASS** | diff 仅 6 文件（2 workflow + run-pipeline.js + 测试 + package.json + 交接文档）；无 diagnose/repair 步骤；src/config.js 未改 |
| C3 | 数据影响：无表结构/持久化改动，config.js key 名不变 | **PASS** | `git diff d056d2d..3e20530 --name-only` 无 config.js/db 层文件 |

### 3.2 验证检查

| # | 检查项 | 判定 | 证据 |
|---|--------|------|------|
| V1 | 正常路径可验 | **PASS** | §1.1-1.5 五个命令均为可重跑的具体命令，真实输出如上 |
| V2 | 边界覆盖：健康检查失败降级 + 平台差异 | **PASS** | run-pipeline.test.js 5 条覆盖 parseArgs 3 + healthCheckOutputPath 2（win32/linux）；CI 降级分支代码审读确认（L170-177 返回 false + 告警 + writeStatusFile，无未捕获异常）。真实 `--ci` 降级跑属 Phase 4 实机 |
| V3 | 回归闸门：npm run check 全绿 | **PASS** | CHECK_EXIT=0 |
| V4 | 证据可查 | **PASS** | GENERATOR_DONE.md §4 含命令输出；本 REVIEW §1 已独立重跑确认一致 |

### 3.3 安全与护栏检查

| # | 检查项 | 判定 | 证据 |
|---|--------|------|------|
| S1 | 已知陷阱规避 | **PASS** | docker CLI 挂起 → spawnSync timeout 30000（原代码保留）；NO_PROXY → CI runner 无本机代理拦截；crawl4ai token 必传 → workflow 两处传 `-e CRAWL4AI_API_TOKEN`；Windows nul → healthCheckOutputPath |
| S2 | 硬反向操作 | **PASS** | 不删数据/改历史；工作流仅 `gh issue create`（issues:write）建告 + docker run 临时容器 + 正常管线写库；无外部 API 写 |
| S3 | 密钥安全 | **PASS** | diff 无 .env/token/secret 值；密钥只出现在 `${{ secrets.* }}`；`git diff d056d2d..3e20530` 敏感值扫描干净 |

---

## 四、待实机回归项（Phase 4 接线时做，本机无法真实跑）

1. **crawl4ai 镜像 runner 独立启动**：`unclecode/crawl4ai:latest` 在 ubuntu-latest 上 `docker run -p 11235:11235` + `/health` 可达性。先 `workflow_dispatch` 跑 `crawl4ai-smoke.yml` 冒烟。
2. **daily-pipeline 首次 dispatch**：确认 `--ci` 完整管线 + artifact 上传（pipeline-logs）+ 失败 Issue 建告。
3. **`--ci` 健康检查失败降级分支实跑**：crawl4ai 容器在线 + DeepSeek/Supabase 密钥就绪后，验证 `writeStatusFile(false,'unhealthy in CI')` + 降级 scraper-direct 不抛未捕获异常。
4. **Supabase 落库抽查**：dispatch 后 SQL 抽查当日 articles 记录。
5. **`ops` label 存在性确认**：`gh issue create --label ops` 要求仓库已存在 `ops` label（ops-check.yml 同模式已用，预期存在）；缺失则该告警步骤失败——属 Phase 4 前置确认项。
6. **`vars.EMAIL_ENABLED` 设置**：Phase 4 首跑前执行 `gh variable set EMAIL_ENABLED=false`（见下"观察"）。

---

## 五、观察与建议（均非阻塞，不需要修改）

1. **Minor（提醒）** `EMAIL_ENABLED: ${{ vars.EMAIL_ENABLED }}` 若 Phase 4 忘记设变量，展开为空串，config.js `EMAIL_ENABLED !== '0'` → **默认开启**。叠加 email.js L165 凭证守卫（需 SMTP_HOST+EMAIL_USER+AUTH_CODE+RECEIVER 全齐才发），实际风险=验证期若配齐 SMTP secret 却忘关变量，会发空摘要邮件。**建议** Phase 4 在写 SMTP secrets **之前**先 `gh variable set EMAIL_ENABLED=false`。
2. **Minor（预存，非本次改动引入）** actionlint 对 `ops-check.yml:52`（`@copilot ...` 行）报 YAML parse 错误。该文件在 master、不在 d056d2d..3e20530 diff 内；本次两个新 workflow 均通过 actionlint exit 0。Generator 的 actionlint 声称（两文件 exit 0）**属实**。
3. **Minor（文档缺口）** KNOWN_TRAPS.md 未记载"crawl4ai 不传 token 入口只绑 `[::]` 则端口映射不可达"的原文，但代码已落地防御（两处传 token）。可延后补充。
4. **观察** 本次新 workflow 均用 `localhost:11235`（job 健康检查）与 run-pipeline.js `127.0.0.1:11235`（--ci 健康检查）——Linux runner 上两者等价，无影响。

---

## 六、范围合规

- `git diff d056d2d..3e20530 --stat`：6 files, +338/-6，与 PLAN §二「改动文件清单」一致，无顺手重构。
- package.json 仅改 `test` glob（`"scripts/*.test.js"`）；`test:watch` 原样。
- 密钥安全扫描干净（无 .env* 变更、无 token/secret 值）。
- 无危险操作（删数据/改 DDL/改 RLS/改 settings.json）。

> 复核人: Evaluator ｜ 日期: 2026-08-11
> 结论：**PASS**，可进入 Phase 4（接线 GitHub，Secret 写入前需向用户确认）。
