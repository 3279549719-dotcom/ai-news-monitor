# DECISION: 三代理工作流 P0 — 技术选型

> 状态: Decided ｜ 决策日期: 2026-08-11 ｜ 依据: [REQ-三代理工作流-P0双任务.md] + Anthropic 三代理原生架构 + 项目现有 Harness 体系

---

## 决策结论

对 P0 双任务（管线自诊断 + 突发新闻推送）采用以下技术方案：

| 维度 | 选型 | 理由 |
|------|------|------|
| **Agent 隔离** | Git Worktree × 3 | 物理文件隔离，已有实战经验，与 harness hooks 兼容 |
| **Sprint Contract** | 功能 A 强制（L3），功能 B 需要（L2） | 符合阶梯策略 |
| **A3 复核** | 功能 A 强制（含自动重启容器/重跑管线），功能 B 不需要 | 高风险操作需独立复核 |
| **诊断引擎** | 规则优先 + LLM 兜底 | 已知故障类型用规则匹配（快速确定），未知故障用 LLM 诊断 |
| **修复动作** | 脚本化 + action log | 每个修复动作为独立函数，有明确的成功/失败判定和日志 |
| **验证门禁** | Harness A2（收尾门禁）+ 烟雾测试 | 复用现有 `npm run check` + 新增烟雾测试 |
| **轮询频率** | 每小时一次（Windows 任务计划） | 平衡时效性和 API 成本 |
| **去重窗口** | 1 小时 | 同事件 1h 内只推 1 次 |
| **通知渠道** | Email 优先 + Feishu 可选 | 复用 `src/notify.js` |

---

## 一、诊断引擎设计

### 诊断流程

```
管线 exit code ≠ 0
     │
     ▼
┌─────────────────────┐
│ 1. 日志尾部读取      │ ← pipeline-YYYY-MM-DD.log 最后 200 行
│    错误码提取        │
└──────┬──────────────┘
       │
       ▼
┌─────────────────────┐
│ 2. 环境探测          │ ← docker ps, curl crawl4ai:11235/health,
│    (并行)            │    Supabase ping, X token 校验
└──────┬──────────────┘
       │
       ▼
┌─────────────────────┐
│ 3. 规则匹配          │ ← 按优先级匹配已知故障模式
│    (优先级排序)      │    DOCKER → CRAWL4AI → AUTH → API → NET
└──────┬──────────────┘
       │ 匹配到？
       ├─ YES ──▶ 4a. 执行对应修复
       │
       └─ NO ──▶ 4b. LLM 诊断（调用 DeepSeek 分析日志，
                          输出猜测根因 + 置信度）
                      │
                      ▼
                 5. 烟雾测试验证（fetch 1 T0 源）
                      │
               ┌──────┴──────┐
               ▼              ▼
            PASS            FAIL
               │              │
         更新 PROGRESS    升级告警（邮件）
         可选 AUTO_RERUN   等待人工
```

### 故障模式 vs 修复动作

| 故障模式 | 检测方式 | 修复动作 | 成功率（估计） | 验证方式 |
|----------|---------|---------|-------------|---------|
| DOCKER_NOT_RUNNING | `docker ps` 失败 | `scripts/restart-docker-engine.ps1` | 90% | `docker ps` + 健康检查 |
| CRAWL4AI_UNHEALTHY | Docker 在线但 `curl :11235/health` 返回非 200 | `docker restart crawl4ai` → 轮询健康 | 85% | `curl :11235/health` → 200 |
| AUTH_EXPIRED | X fetch 返回 401/403 | 重新运行 `scripts/x-fetch-tweets.py`（内部处理 cookie 刷新） | 70% | fetch 1 个 X 源成功 |
| API_QUOTA | DeepSeek 返回 429 | 切换降级模型配置 / 等待 5min 重试 | 60% | 一次 AI 调用成功 |
| SOURCE_FETCH_FAIL | 单个信源 fetch 全失败 | 临时降级 scraper-direct / 标记源暂停 | 50% | 该源 fetch 成功（或确认不可达后跳过） |
| NETWORK | 多个外部调用超时 | 等待 2min 重试 / 通知人工 | 30% | ping 外网恢复 |
| UNKNOWN | 以上都不匹配 | LLM 诊断 + 告警人工 | 不定 | 无 |

### 安全设计

- **最大重试次数**: 每类修复最多 2 次（防死循环）
- **最大自动重跑管线次数**: 1 次（防无限重跑烧 API 费用）
- **动作前 dry-run**: 重启容器前先 `docker ps` 确认状态
- **修复超时**: 每个修复动作 60s 超时
- **全流程超时**: 整个诊断+修复流程 10 分钟超时

---

## 二、即时推送设计

### 判定条件（AND 逻辑）

```
候选文章同时满足以下全部条件：

① score ≥ 75（高评分）
② 来源为 T0 信源（score floor 85）或 T1 X 记者
③ 去重通过：最近 1h 内未推送过同一事件
  （复用 crosscheck.js 的 evSim + tSim 双信号，
   阈值收紧：evSim > 0.85 AND tSim > 0.80）
④ 多源印证：≥2 个信源报道同一事件（可选，降低误报）
  （如果只有一个 T0 源报了，但 score ≥ 85，也推）
```

### 轻量管线

```
每小时触发
     │
     ▼
1. 检查 crawl4ai 容器状态 → 不可用则尝试启动（调用 src/repair.js）
     │
     ▼
2. fetch T0 信源（3 关键词 × 各 2-5 源 ≈ 6-15 次 HTTP 请求）
   - 只抓首页/最新页（不翻页）
   - 每源 timeout 15s（主管线是 60s）
     │
     ▼
3. analyze（可选关闭正文喂养，只评分不摘要，减少 DeepSeek 调用）
   - 如果用轻量模式：只评分 + 标题摘要（token 消耗 ~30% 的完整分析）
     │
     ▼
4. 判定（score ≥ 75 + T0/T1 + 去重窗口）
     │
     ▼
5. 推送（email + Feishu webhook）
     │
     ▼
6. 记录（breaking-sent.json: {event_key, pushed_at, sources}）
```

### 成本估算

- HTTP 请求：6-15 次/小时 = 144-360 次/天
- DeepSeek API（轻量评分）：6-15 次/小时 = 144-360 次/天，每次 ~500 tokens
- 当前主管线：约 200-300 次 DeepSeek 调用/天
- 增量：约 50%-100% 的 API 调用量增加
- 预计月成本增加：$5-15/月（取决于信源数量和推送频率）

---

## 三、文件结构（新增/修改）

```
src/
  diagnose.js          (NEW) 诊断引擎：日志解析 + 环境探测 + 规则匹配 + LLM 诊断
  repair.js            (NEW) 修复动作库：restartCrawl4ai / refreshAuth / fallbackSource
  fetch-breaking.js    (NEW) 轻量抓取：只抓 T0 源 + T1 X 记者
  breaking-filter.js   (NEW) 判定逻辑：score 阈值 + 去重窗口 + 多源印证
  notify.js            (MOD) 新增 breakingAlert 模板（不同于每日摘要）
  config.js            (MOD) 新环境变量
scripts/
  self-heal.js         (NEW) 自愈编排入口：读日志 → 调用 diagnose → 执行 repair → 重跑管线
  breaking-check.js    (NEW) 即时推送入口：轻量管线 + 推送
  install-breaking-schedule.js (NEW) 注册每小时 Windows 任务计划
  run-pipeline.js      (MOD) 失败后调用 self-heal.js
  ops-check.js         (MOD) 集成诊断触发
docs/
  REQ-三代理工作流-P0双任务.md                        (NEW)
  DECISION-三代理P0-技术选型.md                        (NEW / this file)
  SPRINT-20260811-pipeline-self-heal.md                (NEW)
  SPRINT-20260811-breaking-news-push.md                (NEW)
tests/
  src/diagnose.test.js             (NEW)
  src/repair.test.js               (NEW)
  src/fetch-breaking.test.js       (NEW)
  src/breaking-filter.test.js      (NEW)
  scripts/self-heal.test.js        (NEW)
  scripts/breaking-check.test.js   (NEW)
logs/
  diagnosis-YYYY-MM-DD.log          (NEW)
  breaking-check-YYYY-MM-DD.log     (NEW)
  breaking-sent.json                (NEW)
```

---

## 四、测试策略

| 层级 | 覆盖目标 | 工具 | 最低覆盖率 |
|------|---------|------|-----------|
| 单元测试 | diagnose.js 诊断规则匹配 / repair.js 修复动作逻辑 / breaking-filter.js 判定条件 | `node:test` + `assert` | 诊断规则 100% / 修复动作 100% / 判定条件 100% |
| 模块测试 | fetch-breaking.js 抓取流程 / self-heal.js 编排流程 | `node:test` + mock | 正常路径 + 每个故障模式恢复路径 |
| E2E 测试 | 模拟管线失败 → 自愈 → 重跑 / 模拟轻量轮询 → 判定 → 推送 | `node:test` + Docker mock | 至少 1 条全流程 |
| 回归闸门 | `npm run check` 全绿 + `npm test` 全绿 | Harness A2 | 每次提交 |

---

## 五、风险与缓解

| 风险 | 等级 | 缓解措施 |
|------|------|---------|
| 误诊断导致错误修复（如误判 Docker 问题重启容器、实则网络波动） | 🟡 | Evaluator 烟雾测试验证 + 修复前日志记录 |
| 自动重跑管线烧 API 费用 | 🟡 | 最多重跑 1 次 + API 费用监控 |
| 轻量轮询增加 DeepSeek API 调用量 | 🟢 | 可选关闭正文喂养（只评分不含摘要） |
| 每小时轮询导致 crawl4ai 容器长期运行 | 🟢 | 已有 `restart-docker-engine.ps1` 自愈 |
| 突发推送泛滥（每小时 >5 条） | 🟡 | 收紧 score 阈值 + 72h 观察调参 |
| 诊断+修复流程超时阻塞下轮管线 | 🟡 | 全流程 10 分钟超时 + 超时后告警 |

---

## 六、历史

| 日期 | 事件 | Agent |
|------|------|-------|
| 2026-08-11 | 创建 | Planner（主 Agent） |
