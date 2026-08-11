# Sprint Contract: 管线搬 GitHub Actions（纯 CI）

> 状态: Proposed（待 Evaluator 审核） ｜ Generator: 待派发 ｜ 创建: 2026-08-11
> 关联: [PLAN-管线搬GitHub.md](PLAN-管线搬GitHub.md) [DECISION-管线搬GitHub-纯CI方案.md](DECISION-管线搬GitHub-纯CI方案.md)
> 本文件定义本次任务的"完成"标准——Generator 在编码前提出（Planner 预填，Generator 可修正），Evaluator 审核通过后作为唯一验收依据。

---

## 一、任务声明（Generator 提出）

### 1.1 我要构建什么

把每日 08:00 定时管线搬到 GitHub Actions：新建 `daily-pipeline.yml`（cron + dispatch），job 内动态启动 crawl4ai 容器，`run-pipeline.js` 增加 `--ci` 模式跑完整管线；crawl4ai 失败降级 scraper-direct + 告警；X 在 CI 跳过；附 `crawl4ai-smoke.yml` 冒烟工作流。**本地 Windows 不加 `--ci` 时行为不变。**

### 1.2 如何验证我构建对了

**正常路径：**
1. `node --test scripts/run-pipeline.test.js -v` → 5 条 PASS（parseArgs/healthCheckOutputPath 覆盖 win32 + linux 两端）
2. `npm run check` → 全绿，`npm test` 118/118（基线 113 + 新增 5）
3. `npx --yes actionlint .github/workflows/daily-pipeline.yml .github/workflows/crawl4ai-smoke.yml` → exit 0
4. `node scripts/run-pipeline.js --help`（或 `-h`）路径不回归：本地不加 `--ci` 时 `ensureCrawl4ai` 仍走 `dockerStart(2)` 原逻辑（用 `node --check` + 代码审读确认）

**边界/异常情况验证：**
1. `--ci` 且 crawl4ai 健康检查失败 → 走降级分支（`writeStatusFile(false, 'unhealthy in CI')` + 告警），不抛未捕获异常（`node --test` 之外，用 `CI_MODE=1` 环境下直接跑一次逻辑分支确认不崩，或依赖 `--ci` 分支代码审读 + 单测覆盖 `parseArgs`）
2. `healthCheckOutputPath('win32')` 与 `('linux')` 都正确（单测覆盖，避免 `-o nul` 在 Linux 上建垃圾文件）

**无回归：**
1. `npm run check` 全绿（后端 `node --check` + `npm test` + 前端 type-check + lint）
2. `npm test` 总数 ≥ 118（基线 113 不得减少）

**证据形式：**
- [x] 测试输出（命令 + 结果，贴进 GENERATOR_DONE.md）
- [x] 配置文件 diff（`git diff --cached --name-only` + 关键文件 diff）
- [ ] 日志片段（本地 `logs/pipeline-*.log` 关键行，如有跑）
- [ ] 数据库查询结果（Supabase SQL 抽查，如适用）
- [ ] 前端截图（不适用）

### 1.3 本次不做

1. 不做自愈（diagnose/repair/self-heal 不接入 CI）
2. 不做 X/twikit 登录（CI 跳过）
3. 不改数据库表结构、不改 `src/config.js` 的 key 名
4. 不做 breaking-check 每小时轮询
5. 不换 Firecrawl

### 1.4 风险与回滚

| 风险 | 影响 | 回滚方式 |
|------|------|---------|
| `unclecode/crawl4ai:latest` runner 独立启动失败 | daily-pipeline 容器步骤失败 | 先跑 smoke；调 tag/参数；回滚 = 恢复 run-pipeline.js 原样、暂缓 CI |
| `--ci` 分支误入本地路径 | 本地 `ops:run-auto` 行为被改 | 不加 `--ci` 即走原逻辑；`parseArgs` 单测兜底 |
| Secret 名与 config.js 不一致 | 管线静默缺 key | Evaluator 用 grep 核对；§1.2 验收含此检查 |

---

## 二、Evaluator 审核清单

> Generator 预填，Evaluator 逐项审核后勾选。

### 2.1 理解检查

| # | 检查项 | 通过标准 | Evaluator 判定 |
|---|--------|---------|---------------|
| C1 | 目标对齐 | 实现与 PLAN/DECISION 目标一致：纯 CI、动态 crawl4ai、`--ci` 模式、本地不变、X 跳过 | ☐ 通过 ☐ 不通过 |
| C2 | 范围边界 | 不做项（自愈/X 登录/改表/breaking-check/Firecrawl）均未被悄悄扩大 | ☐ 通过 ☐ 不通过 |
| C3 | 数据影响 | 不涉及新增/修改持久化数据或表结构；config.js key 名不变 | ☐ 通过 ☐ 不通过 |

### 2.2 验证检查

| # | 检查项 | 通过标准 | Evaluator 判定 |
|---|--------|---------|---------------|
| V1 | 正常路径可验 | 每个验证步骤是具体命令：node --test / npm run check / actionlint | ☐ 通过 ☐ 不通过 |
| V2 | 边界覆盖 | 覆盖 crawl4ai 健康检查失败降级 + 平台差异（nul vs /dev/null） | ☐ 通过 ☐ 不通过 |
| V3 | 回归闸门 | 验证方案含 `npm run check` 全绿作为回归门禁 | ☐ 通过 ☐ 不通过 |
| V4 | 证据可查 | 每步指定证据形式（命令输出贴 GENERATOR_DONE） | ☐ 通过 ☐ 不通过 |

### 2.3 安全与护栏检查

| # | 检查项 | 通过标准 | Evaluator 判定 |
|---|--------|---------|---------------|
| S1 | 已知陷阱规避 | 不触发 KNOWN_TRAPS（docker CLI 挂起、NO_PROXY、crawl4ai token 必传、Windows nul） | ☐ 通过 ☐ 不通过 |
| S2 | 硬反向操作 | 不删数据/改历史/外部 API 写 | ☐ 通过 ☐ 不通过 ☐ 不涉及 |
| S3 | 密钥安全 | 不提交 .env、token、secret 值；Secret 名只出现在 workflow 的 `${{ secrets.* }}` | ☐ 通过 ☐ 不通过 |

---

## 三、协商记录

### 审核 #1（2026-08-11）

**审核人：** [Evaluator 标识]

**结论：** ☐ 全部通过，可进入编码  ☐ 部分不通过，需修改后重新审核

**不通过项：**

| 编号 | 不通过原因 | 修改要求 | Generator 回复（如有） |
|------|-----------|---------|----------------------|
| | | | |

**附加要求：** [Evaluator 额外提出的检查项或修改]

---

## 四、验收签名

### 4.1 验收结果（编码完成后 Generator 回填）

| 验证步骤 | 预期结果 | 实际结果 | 证据 | 通过 |
|---------|---------|---------|------|------|
| node --test scripts/run-pipeline.test.js -v | 5 PASS | | | ☐ |
| npm test | ≥118/118 | | | ☐ |
| npm run check | exit 0 | | | ☐ |
| actionlint 两个 yml | exit 0 | | | ☐ |

### 4.2 回归闸门

- [ ] `npm run check` 全绿（exit 0）
- [ ] `npm test` 用例数：118/118（与基线 113 对比，无减少）
- [ ] 前端 type-check + lint + build 全绿（npm run check 内含 type-check + lint）

### 4.3 文档同步

- [ ] CLAUDE.md：运行节改"CI 每日管线"（Phase 5 收尾统一改，本任务可留空标"待 5.3"）
- [ ] AGENTS.md：如行为规范变化已更新（本任务不涉及）
- [ ] KNOWN_TRAPS.md：如发现新陷阱已记录（冒烟结果在 Phase 4 记录）
- [ ] DOCUMENT_MAP.md：如新增文档已注册（Phase 5 统一改）
- [ ] PROGRESS.md：已完成 + 遗留项已更新（Phase 5 统一改）
- [x] 以上无需全部立即更新（本任务只交付代码 + 交接文档，文档同步集中在 Phase 5）

### 4.4 签名

| 角色 | 签名 | 日期 |
|------|------|------|
| Generator | [agent 标识] | YYYY-MM-DD |
| Evaluator | [agent/用户 标识] | YYYY-MM-DD |
