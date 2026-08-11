# OpenClaw Cron 配置 — AI 自愈定时任务

本文档描述如何配置 OpenClaw cron，使 ai-news-monitor 具备每 2 小时自动巡检+自愈能力。

## 1. 项目背景

ai-news-monitor 通过 `scripts/auto-heal.js` 实现 AI 自愈：
1. 检查每日 pipeline 状态
2. 运行 `ops-check.js` 诊断
3. 根据诊断结果匹配白名单命令自动修复
4. 修复成功后可通过微信通知

自愈行为受 `scripts/.auto-fix.json` 白名单约束：
- `maxFixesPerDay`: 每日最多修复次数（默认 3）
- `cooldownMinutes`: 两次修复最小冷却间隔（默认 30 分钟）

---

## 2. OpenClaw Cron Job 配置

在 OpenClaw 的 cron 配置中注册以下 job：

```json
{
  "name": "ai-news-monitor-auto-heal",
  "schedule": "0 */2 * * *",
  "command": "node E:\\claude\\ai-news-monitor\\scripts\\auto-heal.js",
  "workingDir": "E:\\claude\\ai-news-monitor",
  "isolated": true,
  "agentTurn": true,
  "timeoutSeconds": 900,
  "retry": {
    "attempts": 1,
    "delaySeconds": 120
  },
  "notification": {
    "onFailure": true,
    "channels": ["weixin"]
  }
}
```

### 参数说明

| 参数 | 值 | 说明 |
|------|-----|------|
| `schedule` | `0 */2 * * *` | 每 2 小时整点触发（00:00, 02:00, 04:00, …） |
| `isolated` | `true` | 独立进程运行，不污染主 session |
| `agentTurn` | `true` | 启用 AI Agent 能力（可调用 firecrawl / ops-check） |
| `timeoutSeconds` | `900` | 15 分钟超时（考虑到 `restart-pipeline` 命令最多需要 10 分钟） |
| `retry.attempts` | `1` | 失败后最多重试 1 次（间隔 120s） |

---

## 3. Cron Prompt 内容

当 `agentTurn: true` 时，OpenClaw 会将以下 prompt 发送给 AI Agent：

```
## ai-news-monitor Auto-Heal Cron

你是一个运维巡检 agent，负责检查 ai-news-monitor 项目的健康状况。

### 任务
1. 读取 `E:\claude\ai-news-monitor\logs\.last-run.json`，检查今天 pipeline 是否成功运行
2. 如果今天已成功运行 → 回复 "NOOP: pipeline already ran successfully today"
3. 如果未运行或失败 → 执行以下步骤：
   a. 运行 `node scripts/ops-check.js --light` 进行快速诊断
   b. 读取 `scripts/.auto-fix.json` 获取白名单命令
   c. 根据诊断失败的检查项，匹配白名单命令
   d. 按优先级执行修复命令：
      - 如果 Docker 失败 → `docker restart crawl4ai`（60s timeout）
      - 如果 node_modules 缺失 → `npm ci`（120s timeout）
      - 如果 pipeline 未跑 → `node scripts/run-pipeline.js --no-alert`（600s timeout）
   e. 每个命令执行后记录结果到 `logs\.auto-heal.json`

### 约束
- **每日最多修复 3 次**（跨所有 cron runs）
- **两次修复间隔至少 30 分钟**
- 所有命令必须来自 `scripts/.auto-fix.json` 白名单
- 如果自愈成功且 pipeline 已跑，进行 24h 冷却（跳过后续 cron runs）
- 如果自愈失败 → 发送微信通知（参考第 4 节）

### 输出
- 简短的成功/失败摘要
- 如果失败，包含具体失败原因和建议的人工介入步骤
```

---

## 4. 微信通知配置模板

如果 ai-news-monitor 配置了 weixin 通道，cron 失败时可通过 OpenClaw 发送微信通知。

### OpenClaw cron 通知字段

```json
"notification": {
  "onFailure": true,
  "channels": ["weixin"],
  "message": {
    "title": "⚠️ ai-news-monitor 自愈失败",
    "body": "最近 2 小时 cron 巡检发现问题且自动修复失败。请手动检查 E:\\claude\\ai-news-monitor\\logs\\.auto-heal.json 了解详情。"
  }
}
```

### 候选：脚本内微信通知

也可以在 `auto-heal.js` 中集成通知。在 `src/notify.js` 已有的 webhook 通道基础上，新增 weixin 通道：

```javascript
// 在 src/notify.js 的 CHANNELS 中添加
weixin: require('./weixin').sendText,
```

`auto-heal.js` 在修复全失败时调用：

```javascript
const notify = require('../src/notify');
await notify({
  subject: 'ai-news-monitor 自愈失败',
  text: `时间: ${ts()}\n失败项: ${failedFixes.map(f => f.name).join(', ')}\n详情请查看 logs/.auto-heal.json`,
}, { channels: ['weixin'] });
```

---

## 5. 验证方式

### 5.1 本地手动验证

```powershell
# 1. 验证 auto-heal 脚本可运行（模块导入模式）
node -e "const { diagnose, heal, loadWhitelist } = require('./scripts/auto-heal'); console.log('exports ok:', Object.keys({diagnose, heal, loadWhitelist}))"
# 预期: exports ok: [ 'diagnose', 'heal', 'loadWhitelist' ]

# 2. 验证模块守卫（导入时不触发执行）
node -e "require('./scripts/auto-heal'); console.log('PASS: module guard worked')"
# 预期: PASS: module guard worked（无 auto-heal 日志输出）

# 3. 模拟 pipeline 未运行场景
node scripts/auto-heal.js
# 预期: 如果 .last-run.json 不存在或日期不是今天，触发诊断+修复流程

# 4. 验证 Node 语法
node --check scripts/auto-heal.js
# 预期: 无输出（退出码 0）
```

### 5.2 验证 Cron 配置已生效

```powershell
# 查看 OpenClaw cron 列表
openclaw cron list

# 应该看到 ai-news-monitor-auto-heal 条目，状态为 active
```

### 5.3 验证自愈日志

```powershell
# 每次修复操作都会写入此文件
type E:\claude\ai-news-monitor\logs\.auto-heal.json

# 预期内容示例:
# {
#   "lastDate": "2026-08-11",
#   "todayFixCount": 1,
#   "lastFixAt": "2026-08-11T14:00:00.000Z",
#   "lastFixName": "docker-restart",
#   "lastFixSuccess": true,
#   "lastFixDetail": "exit 0 | stdout: crawl4ai",
#   "history": [...]
# }
```

### 5.4 验证限额逻辑

```powershell
# 快速触发 3 次修复（每次间隔 <30min），第 4 次应被限额拦截
node scripts/auto-heal.js
node scripts/auto-heal.js
node scripts/auto-heal.js
# 第 4 次应该输出: 自愈限额已用尽: 今日已修复 3/3 次，达到限额
```

---

## 6. 故障排除

| 症状 | 可能原因 | 解决 |
|------|----------|------|
| Cron 未触发 | OpenClaw cron scheduler 未启用 | `openclaw cron start` |
| auto-heal 报错 "无法加载白名单" | `.auto-fix.json` 丢失或 JSON 格式错误 | 确认文件存在且格式正确 |
| 修复命令执行失败 | Docker 未安装 / npm 不在 PATH | 在终端手动执行对应命令确认环境 |
| 自愈后 pipeline 仍失败 | 根因不是 Docker/npm 问题 | 查看 `logs/pipeline-*.log` 排查具体错误 |
| 每日限额被过早消耗 | 频繁手动触发 auto-heal | 删除 `logs/.auto-heal.json` 重置计数器，或等待次日 00:00 自动重置 |

---

## 7. 与其他定期任务的协调

| 任务 | 频率 | 说明 |
|------|------|------|
| Pipeline 主运行 | 每日 1 次（schedule） | `node scripts/run-pipeline.js`，由 Windows Task Scheduler 或 cron 触发 |
| ops-check 巡检 | 每 2 小时 | 由 auto-heal cron 间接调用 |
| GitHub Actions CI | push 触发 | `daily-pipeline.yml` / `ops-check.yml` |

**优先级**：Pipeline 主运行 > ops-check 巡检 > auto-heal 修复。auto-heal 不应在 pipeline 正在运行时触发修复（通过 `.last-run.json` + cooldown 机制避免冲突）。

---

*文档创建日期: 2026-08-11*
*相关 Issue: SPRINT-20260811-pipeline-self-heal*
