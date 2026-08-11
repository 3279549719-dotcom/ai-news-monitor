# GENERATOR_DONE — 管线搬 GitHub Actions（纯 CI）

> 状态: GENERATOR 完成 ｜ 日期: 2026-08-11 ｜ 依据: [PLAN-管线搬GitHub.md](PLAN-管线搬GitHub.md) + [SPRINT-20260811-github-pipeline.md](SPRINT-20260811-github-pipeline.md)
> 交接方: Generator ｜ 接收方: Evaluator（独立复核）

所有验收命令已在本机跑绿，真实输出见 §4。提交 sha 见 §6。

---

## 1. Task 2.1 定位结果（run-pipeline.js 改动点行号）

以 worktree HEAD = d056d2d 为准，改动前的行号与 brief 一致：

| 区块 | 行号 | 说明 |
|------|------|------|
| 参数解析 | 31-33 | `const args = process.argv.slice(2)` + `noDocker`/`noAlert` |
| `dockerStart` | 62-90 | docker start + restart-docker-engine 重试 |
| `checkCrawl4aiHealth` | 92-120 | curl 健康检查，`'-o', 'nul'` 在 98 行 |
| `writeStatusFile` | 123-141 | 状态文件落盘 |
| `ensureCrawl4ai` | 144-175 | `if (noDocker)` 在 145 行，其后插入 CI 分支 |
| `autoPushLogs` | 232-250 | 函数体顶部插入 CI 守卫 |
| `module.exports` | 259 | 追加 `parseArgs, healthCheckOutputPath` |

**ops-check.yml secret 语法（Task 2.1 Step 2）已确认**：
```
31:          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
```
与 DECISION §2.4 一致（`${{ }}` 无多余空格），master 上的 fix(ops) 已修复。

**Secret 名与 src/config.js 核对**（PLAN §八 风险 4）：`DEEPSEEK_API_KEY / DEEPSEEK_BASE_URL / DEEPSEEK_MODEL / SUPABASE_URL / SUPABASE_SERVICE_KEY / CRAWL4AI_API_TOKEN / EMAIL_AUTH_CODE` 均能在 `src/config.js` 找到对应读取；`CRAWL4AI_URL` 默认 `http://localhost:11235` 与 workflow env 一致。

---

## 2. 改动 / 新增文件清单

| 文件 | 动作 | 摘要 |
|------|------|------|
| `scripts/run-pipeline.js` | 修改 | 加 `--ci` 模式（`ensureCrawl4ai` CI 分支 + `autoPushLogs` 守卫）+ `parseArgs`/`healthCheckOutputPath` 纯函数 + 导出 |
| `scripts/run-pipeline.test.js` | 新建 | 5 条单测：parseArgs 3 条 + healthCheckOutputPath 2 条 |
| `package.json` | 修改 | `test` script glob 加 `"scripts/*.test.js"` |
| `.github/workflows/daily-pipeline.yml` | 新建 | cron `0 0 * * *` + `workflow_dispatch` + 动态 crawl4ai + `--ci` 跑管线 + artifact + 失败建 Issue |
| `.github/workflows/crawl4ai-smoke.yml` | 新建 | 冒烟工作流：pull+run+health-check crawl4ai |

改动范围与 PLAN §二「改动文件清单」完全一致，无顺手重构（`test:watch` 保持原样）。

---

## 3. --ci 行为说明

- `parseArgs(process.argv)` → `CI_MODE`；无 `--ci` 时 `CI_MODE=false`，本地路径原样走 `dockerStart(2)`。
- `ensureCrawl4ai`：`--ci` 时只健康检查；成功 `writeStatusFile(true,'healthy')`；失败告警 + `writeStatusFile(false,'unhealthy in CI')` + 返回 false（降级 scraper-direct），不抛未捕获异常。
- `checkCrawl4aiHealth`：`'-o', healthCheckOutputPath()`（win32 → `nul`，其余 → `/dev/null`），Linux runner 上不会建垃圾文件。
- `autoPushLogs`：`--ci` 时直接 return（日志交给 upload-artifact）。

---

## 4. 验收命令真实输出

### 4.1 `node --check scripts/run-pipeline.js`
```
$ node --check scripts/run-pipeline.js
（exit 0，无输出）
```

### 4.2 `node --test scripts/run-pipeline.test.js -v`
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
# suites 0
# pass 5
# fail 0
# cancelled 0
# skipped 0
# todo 0
```
TDD 过程确认：改动前此命令 5 条全 FAIL（`parseArgs is not a function` / `healthCheckOutputPath is not a function`），改动后 5 PASS。

### 4.3 `npm test`
```
1..118
# tests 118
# suites 0
# pass 118
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 3025.1955
```
基线 113 + 新增 5 = 118/118，无减少。

### 4.4 `npm run check`（lint + type-check + test）
```
$ npm run check
> ai-news-monitor@1.0.0 check
> npm run lint && npm run type-check && npm test

> ai-news-monitor@1.0.0 lint
> npm run lint:backend && npm run lint:client
...（lint:backend check-syntax、lint:client eslint 均无错误）
> ai-news-monitor@1.0.0 type-check
> npm --prefix client run type-check
> tsc --noEmit
...（无错误）
> ai-news-monitor@1.0.0 test
> node --test "src/*.test.js" "scripts/*.test.js"
...
1..118
# tests 118
# pass 118
# fail 0
```
exit 0。

### 4.5 `actionlint`（两个 workflow）
```
$ actionlint .github/workflows/daily-pipeline.yml .github/workflows/crawl4ai-smoke.yml
（exit 0，无诊断输出）
```
actionlint v1.7.12（windows_amd64）。

---

## 5. 待实机验证项（Phase 4 接线时做）

1. **crawl4ai 镜像 runner 独立启动**：`unclecode/crawl4ai:latest` 在 ubuntu-latest 上 `docker run -p 11235:11235` + `/health` 可达性未验证。先 `workflow_dispatch` 跑 `crawl4ai-smoke.yml` 冒烟，再让 `daily-pipeline.yml` 首跑。
2. **daily-pipeline 首次 dispatch**：`workflow_dispatch` 手动触发，确认 `--ci` 完整管线 + artifact 上传 + 失败 Issue 建告。
3. **`--ci` 健康检查失败降级分支**：本机未跑真实 `--ci` 路径（需要 crawl4ai 容器在线 + DeepSeek/Supabase 密钥，属实机行为）。PLAN §3.3 与 SPRINT §1.2 接受代码审读 + `parseArgs` 单测兜底；代码审读确认 `ensureCrawl4ai` CI 分支同步返回 `healthy`，无 async 泄漏。
4. **`EMAIL_ENABLED` 用 `vars` 而非 secret**：Phase 4 用 `gh variable set EMAIL_ENABLED=false` 先关邮件（验证期），上线再开。

---

## 6. 提交记录

- 提交 1（代码产物）: `feat(generator): GitHub Actions 每日管线 + run-pipeline --ci + smoke 工作流`
- 提交 2（交接证据）: `docs(generator): GENERATOR_DONE 交接证据`

---

## 7. 偏离说明

- **actionlint 需要本地安装二进制**：`npx actionlint` 不可用（actionlint 是 Go 二进制，非 npm 包，`npx` 报 `could not determine executable to run`）。已从 GitHub Releases 下载 `actionlint_1.7.12_windows_amd64.zip` 到 `E:/claude/tools/actionlint/actionlint.exe`（不入版本库），验收命令用该本地二进制，输出见 §4.5。PLAN §七 命令字面等价。
- **package.json 只改 `test` glob**：brief Task 2.2 Step 4 只要求改 `test`；`test:watch` 保持原样，避免顺手改动。

> 本文由 Generator 撰写，供 Evaluator 独立复核。不信任本文件的自述，请按 SPRINT §2 清单复核目标文件 + 重跑验证命令。
