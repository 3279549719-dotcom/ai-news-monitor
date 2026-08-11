# REQ: 三代理工作流 P0 — 管线自诊断与自动修复 + 突发新闻即时推送

> 状态: Draft ｜ 创建: 2026-08-11 ｜ 关联: [DECISION-三代理P0-技术选型.md]
> **Handoff 摘要**：这是 ai-news-monitor 首次使用三 Agent（Planner/Generator/Evaluator）原生架构开发的两个 P0 功能。管线自诊断（失败后自动诊断+修复+重跑）和突发新闻推送（T0 源每小时轻量轮询 + 即时推送），两者共享诊断/修复/验证基础设施。

---

## 功能 A：管线自诊断与自动修复（Pipeline Self-Diagnosis & Auto-Repair）

### 用户故事

**作为** ai-news-monitor 的运维者，**我想要** 定时管线失败后系统自动读取日志、诊断根因、尝试修复并验证修复结果，**以便** 减少人工排查故障的频率，让定时管线在没有人工干预时也能保持高可用。

### 验收标准（判定式）

1. [ ] 管线 exit code ≠ 0 时，系统自动触发诊断流程
2. [ ] 诊断流程读取 pipeline log 尾部（最后 200 行）+ 环境探测 → 输出 DIAGNOSIS.md（根因分类 + 置信度 + 修复计划）
3. [ ] 支持以下故障类型的诊断：DOCKER_NOT_RUNNING / CRAWL4AI_UNHEALTHY / AUTH_EXPIRED / API_QUOTA / SOURCE_FETCH_FAIL / NETWORK / UNKNOWN
4. [ ] 对 DOCKER_NOT_RUNNING → 自动运行 `restart-docker-engine.ps1` → 轮询健康检查 → 成功后回归验证
5. [ ] 对 CRAWL4AI_UNHEALTHY → 自动重启容器 → 健康轮询 → 回归验证
6. [ ] 对 AUTH_EXPIRED → 重新获取 X token/cookie → 验证
7. [ ] 对 SOURCE_FETCH_FAIL → 临时降级为 scraper-direct → 标记该源 → 回归验证
8. [ ] 所有修复操作有 action log（记录每一步的输出和结果）
9. [ ] Evaluator 对修复结果做烟雾测试（fetch 1 个 T0 源）→ PASS/FAIL
10. [ ] FAIL 时自动升级告警（邮件通知人工介入），不做无限重试
11. [ ] 诊断日志持久化写入 `logs/diagnosis-YYYY-MM-DD.log`

### 本次不做

1. AI 评分异常、摘要质量下降的诊断（AI 质量是主观问题，不同于机械故障）
2. 前端面板展示诊断历史（那是 P1 质量监控面板的内容）
3. 远程重启 Docker Engine 服务（只重启容器，不重启 Docker Desktop）
4. 管线性能优化（那是 P2 的功能）
5. 多管线并行诊断（当前只有一条管线）

### 涉及模块

| 模块 | 路径 | 影响类型 |
|------|------|---------|
| 诊断引擎 | `src/diagnose.js`（新建） | 新增 |
| 修复动作库 | `src/repair.js`（新建） | 新增 |
| 自愈编排 | `scripts/self-heal.js`（新建） | 新增 |
| 管线入口 | `scripts/run-pipeline.js` | 改（失败后调用 self-heal） |
| 运维检查 | `scripts/ops-check.js` | 改（集成诊断触发） |
| 邮件通知 | `src/notify.js` | 改（新增诊断失败告警模板） |
| 配置 | `src/config.js` | 改（新环境变量） |

### 复杂度评估

| 维度 | 评级 | 说明 |
|------|------|------|
| 文件数 | 4-8（3 新建 + 3 修改） | |
| 数据影响 | 无 | 不新增 DB 表 |
| 跨模块 | 是（scripts/ + src/ + src/notify） | |
| 高风险操作 | 有 | 自动重启 Docker 容器、自动重跑管线 |
| **综合** | 🔴 L3 复杂 | 需要 Sprint Contract + A3 复核 |

---

## 功能 B：突发新闻即时推送（Breaking News Instant Push）

### 用户故事

**作为** ai-news-monitor 的用户，**我想要** 当 T0/T1 信源产出高评分 + 多源印证的事件时，不等每日 08:00 定时管线，立即收到推送通知，**以便** 在新闻发生后 1 小时内获知，而不是等到第二天早上。

### 验收标准（判定式）

1. [ ] 新增 `scripts/breaking-check.js`，可独立运行（不依赖主管线上下文）
2. [ ] 轻量轮询只针对 T0 源（3 个关键词 × 各 2-5 个 T0 信源）+ T1 X 记者
3. [ ] 每小时自动运行一次（Windows 任务计划注册）
4. [ ] 判定条件：score ≥ 75 + T0/T1 源 + 多源印证（≥2 源报道同一事件）+ 距上次推送同事件 > 1h
5. [ ] 推送走 email（复用 `src/notify.js`）+ 可选 Feishu webhook
6. [ ] 去重：同事件 1 小时内只推 1 次
7. [ ] crawl4ai 容器不可用时自动尝试启动（复用功能 A 的自愈能力）→ 仍不可用则降级为 scraper-direct
8. [ ] 失败时写 breaking-check-failure.log（不推送、不阻塞后续轮询）
9. [ ] 验收：连续运行 72 小时，日均推送 1-3 条，误报率 < 20%

### 本次不做

1. T2 信源（低可信度）的即时推送
2. 多平台推送（只做 email + Feishu）
3. 用户可配置的推送频率和阈值（先写死，后续做成可配置）
4. 前端展示推送历史
5. 基于 NLP 的事件聚类（用现有 crosscheck 去重逻辑即可）

### 涉及模块

| 模块 | 路径 | 影响类型 |
|------|------|---------|
| 即时检查入口 | `scripts/breaking-check.js`（新建） | 新增 |
| 轻量抓取 | `src/fetch-breaking.js`（新建） | 新增 |
| 突发布尔判定 | `src/breaking-filter.js`（新建） | 新增 |
| 任务计划安装 | `scripts/install-breaking-schedule.js`（新建） | 新增 |
| 通知分发 | `src/notify.js` | 改（新增 breaking 模板） |
| 配置 | `src/config.js` | 改（breaking 相关环境变量） |

### 复杂度评估

| 维度 | 评级 | 说明 |
|------|------|------|
| 文件数 | 4-8（4 新建 + 2 修改） | |
| 数据影响 | 需追踪已推送事件（内存或临时文件，不建新表） | |
| 跨模块 | 是（scripts/ + src/ + src/notify） | |
| 高风险操作 | 无 | 不删数据、不改 DDL/RLS/settings.json |
| **综合** | 🟡 L2 中等 | 需要 Sprint Contract，不需要 A3 复核 |

---

## 两个功能的联动关系

管线自诊断（功能 A）和突发新闻推送（功能 B）共享基础设施：
- 功能 B 的轻量轮询如果发现 crawl4ai 不可用，调用功能 A 的 `src/repair.js` 自动修复
- 功能 A 的 Diagnoser 诊断出的故障模式，功能 B 可直接复用（如 AUTH_EXPIRED 检测）
- 两个功能共用 `src/notify.js` 的邮件/Feishu 推送通道
- 两个功能共用 `src/config.js` 的环境变量管理

---

## 历史

| 日期 | 事件 | Agent |
|------|------|-------|
| 2026-08-11 | 创建 | Planner（主 Agent） |
