# PLAN — 管线搬 GitHub Actions（纯 CI）

> 来源: [DECISION-管线搬GitHub-纯CI方案.md](DECISION-管线搬GitHub-纯CI方案.md) + [REQ-三代理工作流-P0双任务.md](REQ-三代理工作流-P0双任务.md)
> 状态: Planned ｜ Planner: 主会话 ｜ 日期: 2026-08-11
> **Generator 唯一依据**：按本文件改动，完成定义见 [SPRINT-20260811-github-pipeline.md](SPRINT-20260811-github-pipeline.md)。

---

## 一、目标

把每日 08:00 定时管线从 Windows 任务计划搬到 GitHub Actions（纯 CI，无自愈）：

1. `.github/workflows/daily-pipeline.yml` — cron `0 0 * * *`（北京 08:00 = UTC 00:00）+ `workflow_dispatch`
2. job 内 `docker run` 动态启动 crawl4ai 容器 → 健康检查 → `node scripts/run-pipeline.js --ci`
3. `run-pipeline.js` 增加 `--ci` 模式（跳过 docker start / Windows 引擎重启 / 日志 auto-push）
4. crawl4ai 启动失败 → 降级 scraper-direct + 告警（不做自愈重启）
5. X/twikit 在 CI 跳过（`X_TWIKIT_ENABLED=0`）
6. 失败时 `gh issue create` 建 Issue 告警
7. 附 `crawl4ai-smoke.yml` 冒烟工作流，先在真实 runner 上验证镜像可独立启动

**本地 Windows 行为不得改变**：`run-pipeline.js` 不加 `--ci` 时保持原逻辑（docker start + PowerShell 引擎重启 + 日志 auto-push）。

---

## 二、改动文件清单

| 文件 | 动作 | 说明 |
|------|------|------|
| `scripts/run-pipeline.js` | 修改 | 加 `--ci` 模式 + 跨平台 curl 输出设备 |
| `scripts/run-pipeline.test.js` | 新建 | `parseArgs` / `healthCheckOutputPath` 纯函数单测 |
| `package.json` | 修改 | `test` script glob 加 `"scripts/*.test.js"` |
| `.github/workflows/daily-pipeline.yml` | 新建 | 每日管线 |
| `.github/workflows/crawl4ai-smoke.yml` | 新建 | 镜像冒烟 |

---

## 三、run-pipeline.js 具体改动

### 3.1 参数解析提取为纯函数（文件顶部，原第 26-29 行处）

原代码：
```js
const args = process.argv.slice(2);
const noDocker = args.includes('--no-docker');
const noAlert = args.includes('--no-alert');
```

改为：
```js
/** 解析 CLI 参数（纯函数，便于单测）。 */
function parseArgs(argv) {
  const args = argv.slice(2);
  return {
    ci: args.includes('--ci'),
    noDocker: args.includes('--no-docker'),
    noAlert: args.includes('--no-alert'),
  };
}
const { ci: CI_MODE, noDocker, noAlert } = parseArgs(process.argv);
```

### 3.2 curl 输出设备跨平台（原第 98 行 `'-o', 'nul'`）

新增纯函数：
```js
/** curl -o 输出设备：win32 用 nul，其余平台用 /dev/null。 */
function healthCheckOutputPath(platform = process.platform) {
  return platform === 'win32' ? 'nul' : '/dev/null';
}
```

`checkCrawl4aiHealth` 内 `'-o', 'nul',` → `'-o', healthCheckOutputPath(),`。

### 3.3 `ensureCrawl4ai` 加 CI 分支（原第 144 行 `if (noDocker)` 之后）

```js
if (CI_MODE) {
  // CI 容器由 workflow job 启动，这里只做健康检查；失败即告警 + 降级，不做 docker start/引擎重启。
  console.log('[pipeline] --ci: 容器由 job 管理，仅健康检查');
  const healthy = checkCrawl4aiHealth();
  if (healthy) {
    console.log('[pipeline] crawl4ai ready ✓ (CI)');
    writeStatusFile(true, 'healthy');
  } else {
    console.error('[pipeline] crawl4ai 健康检查失败(CI)，降级 scraper-direct');
    sendAlertEmail(
      '⚠️ ai-news-monitor: CI crawl4ai 不可用',
      `<p>${ts()} GitHub Actions 中 crawl4ai 健康检查失败，管线已降级运行（scraper-direct）。</p><p><small>— run-pipeline.js --ci</small></p>`,
    );
    writeStatusFile(false, 'unhealthy in CI');
  }
  return healthy;
}
```

### 3.4 `autoPushLogs` 加守卫（原第 233 行函数体顶部）

```js
if (CI_MODE) {
  console.log('[pipeline] --ci: 跳过日志 auto-push（由 upload-artifact 承担）');
  return;
}
```

### 3.5 导出追加

`module.exports = { ensureCrawl4ai, dockerStart, checkCrawl4aiHealth, sendAlertEmail, writeStatusFile, parseArgs, healthCheckOutputPath };`

---

## 四、`scripts/run-pipeline.test.js`（新建，TDD）

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseArgs, healthCheckOutputPath } = require('./run-pipeline');

test('parseArgs: --ci → ci=true', () => {
  assert.strictEqual(parseArgs(['node', 'run-pipeline.js', '--ci']).ci, true);
});

test('parseArgs: 无参全 false', () => {
  const a = parseArgs(['node', 'run-pipeline.js']);
  assert.strictEqual(a.ci, false);
  assert.strictEqual(a.noDocker, false);
  assert.strictEqual(a.noAlert, false);
});

test('parseArgs: --no-docker + --no-alert', () => {
  const a = parseArgs(['node', 'run-pipeline.js', '--no-docker', '--no-alert']);
  assert.strictEqual(a.noDocker, true);
  assert.strictEqual(a.noAlert, true);
});

test('healthCheckOutputPath: win32 → nul', () => {
  assert.strictEqual(healthCheckOutputPath('win32'), 'nul');
});

test('healthCheckOutputPath: linux → /dev/null', () => {
  assert.strictEqual(healthCheckOutputPath('linux'), '/dev/null');
});
```

---

## 五、`.github/workflows/daily-pipeline.yml`（新建，全文）

```yaml
name: Daily Pipeline

on:
  schedule:
    - cron: '0 0 * * *'   # 北京 08:00 = UTC 00:00
  workflow_dispatch:

permissions:
  contents: read
  issues: write

jobs:
  daily-pipeline:
    runs-on: ubuntu-latest
    timeout-minutes: 45
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'

      - run: npm ci

      - name: Start crawl4ai container (dynamic)
        run: |
          docker run -d --name crawl4ai -p 11235:11235 \
            -e CRAWL4AI_API_TOKEN="${{ secrets.CRAWL4AI_API_TOKEN }}" \
            unclecode/crawl4ai:latest
          for i in $(seq 1 30); do
            if curl -sf http://localhost:11235/health; then
              echo "crawl4ai healthy (${i} checks)"
              exit 0
            fi
            sleep 5
          done
          echo "::error::crawl4ai 150s 内未就绪"
          exit 1

      - name: Run daily pipeline (--ci)
        env:
          DEEPSEEK_API_KEY: ${{ secrets.DEEPSEEK_API_KEY }}
          DEEPSEEK_BASE_URL: ${{ secrets.DEEPSEEK_BASE_URL }}
          DEEPSEEK_MODEL: ${{ secrets.DEEPSEEK_MODEL }}
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
          CRAWL4AI_URL: http://localhost:11235
          CRAWL4AI_API_TOKEN: ${{ secrets.CRAWL4AI_API_TOKEN }}
          X_TWIKIT_ENABLED: '0'
          EMAIL_ENABLED: ${{ vars.EMAIL_ENABLED }}
          SMTP_HOST: ${{ secrets.SMTP_HOST }}
          SMTP_PORT: ${{ secrets.SMTP_PORT }}
          SMTP_SECURE: ${{ secrets.SMTP_SECURE }}
          EMAIL_USER: ${{ secrets.EMAIL_USER }}
          EMAIL_AUTH_CODE: ${{ secrets.EMAIL_AUTH_CODE }}
          RECEIVER_EMAIL: ${{ secrets.RECEIVER_EMAIL }}
        run: node scripts/run-pipeline.js --ci

      - name: Upload pipeline logs
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: pipeline-logs
          path: |
            logs/pipeline-*.log
            logs/.last-run.json
            logs/.seen-ids.json
          retention-days: 7

      - name: Alert on failure (create issue)
        if: failure()
        run: |
          cat > /tmp/issue_body.md << 'BODYEOF'
          ## Daily Pipeline Failed
          Run: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}

          请查看 pipeline-logs artifact 定位失败原因。
          BODYEOF
          gh issue create \
            --title "Daily Pipeline Failed — Run ${{ github.run_id }}" \
            --body-file /tmp/issue_body.md \
            --label "ops" \
            --repo ${{ github.repository }}
        env:
          GH_TOKEN: ${{ github.token }}
```

> 注意：`EMAIL_ENABLED` 读 `vars`（非 secret），Phase 4 用 `gh variable set EMAIL_ENABLED=false` 先关邮件（验证期），上线再开。

---

## 六、`.github/workflows/crawl4ai-smoke.yml`（新建，全文）

```yaml
name: crawl4ai Smoke
on:
  workflow_dispatch:

jobs:
  smoke:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - name: Pull + run + health-check crawl4ai
        run: |
          docker run -d --name crawl4ai -p 11235:11235 \
            -e CRAWL4AI_API_TOKEN="${{ secrets.CRAWL4AI_API_TOKEN }}" \
            unclecode/crawl4ai:latest
          for i in $(seq 1 36); do
            if curl -sf http://localhost:11235/health; then
              echo "CRAWL4AI HEALTHY (${i} checks)"
              docker logs crawl4ai 2>&1 | tail -20
              exit 0
            fi
            sleep 5
          done
          echo "::error::crawl4ai 冒烟失败"
          docker logs crawl4ai 2>&1 | tail -60
          exit 1
```

---

## 七、验收命令（Generator 交付前必须全绿）

1. `node --check scripts/run-pipeline.js`
2. `node --test scripts/run-pipeline.test.js -v`（5 PASS）
3. `npm test`（118/118：基线 113 + 新增 5）
4. `npm run check`（lint + type-check + test 全绿）
5. `npx --yes actionlint .github/workflows/daily-pipeline.yml .github/workflows/crawl4ai-smoke.yml`

---

## 八、风险与回滚

| 风险 | 影响 | 回滚 |
|------|------|------|
| `unclecode/crawl4ai:latest` 在 runner 上独立启动失败（tag 不明 / 端口绑定 / 需额外 env） | daily-pipeline 的容器步骤失败 | 先跑 `crawl4ai-smoke.yml` 冒烟；失败则按 `docker logs` 调 tag/参数，回滚 = 恢复 run-pipeline.js 原样、暂缓 CI |
| curl 输出设备改错平台 | 健康检查输出异常 | 单测覆盖 `healthCheckOutputPath('win32'/'linux')` 两端 |
| `--ci` 分支误入本地路径 | 本地手动跑 `ops:run-auto` 行为被改 | 不加 `--ci` 参数即走原逻辑，参数解析有单测兜底 |
| Secret 名与 config.js 不一致 | 管线静默缺 key | §7 验收 + Evaluator 用 `grep` 核对 `src/config.js` |

---

## 九、不做（范围边界）

- 不做自愈（diagnose/repair/self-heal 不接入 CI）
- 不做 X/twikit 登录（CI 跳过，`X_TWIKIT_ENABLED=0`）
- 不改数据库表结构、不动 `src/config.js` 的 key 名
- 不做 breaking-check 每小时轮询
- 不换 Firecrawl
