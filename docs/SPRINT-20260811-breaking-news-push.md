# SPRINT: 突发新闻即时推送

> 状态: Proposed ｜ Generator: generator-agent ｜ 日期: 2026-08-11
> 依据: [REQ-三代理工作流-P0双任务.md] [DECISION-三代理P0-技术选型.md]
> 复杂度: 🟡 L2 | Sprint Contract 需要 | A3 复核不需要

---

## §1 任务声明

### 1.1 我要构建什么

一个轻量级突发新闻即时推送系统：
1. **轻量抓取**（`src/fetch-breaking.js`）：每小时只抓 T0 信源 + T1 X 记者
2. **判定逻辑**（`src/breaking-filter.js`）：score ≥ 75 + 去重窗口 + 多源印证
3. **推送入口**（`scripts/breaking-check.js`）：串联轻量管线 → 判定 → 推送
4. **任务计划**（`scripts/install-breaking-schedule.js`）：注册 Windows 每小时任务

### 1.2 如何验证

| 验证项 | 方法 | 证据形式 |
|--------|------|---------|
| 轻量抓取过滤 | Mock T0/T1 信源 → 断言只调用目标 URL | `node:test` 断言 |
| 判定阈值 | score=80 → 应推送 / score=70 → 应跳过 | `node:test` 断言 |
| 去重窗口 | 同事件 30min 内重复 → 应被抑制 | `node:test` 时空间模拟 |
| 多源印证 | 1 源 → 可选推 / ≥2 源 → 必推 | `node:test` 断言 |
| 邮件格式 | 推送 → 断言 email 内容含 breaking 标识 | Mock notify |
| 72h 验收 | 连续运行 72h，日均 1-3 条，误报 <20% | 运维日志 |
| 回归闸门 | `npm run check` 全绿 + `npm test` 全绿 | CI 输出 |

### 1.3 本次不做

- T2 信源推送
- 用户可配置阈值（写死，后续 PR 再做）
- 前端推送历史面板
- 多平台推送（只做 email + Feishu）
- NLP 事件聚类（复用现有 crosscheck）

### 1.4 风险与回滚

| 风险 | 缓解 | 回滚 |
|------|------|------|
| API 调用量激增 | 轻量模式（只评分不含摘要） | `npm run ops:unschedule` 卸载任务计划 |
| crawl4ai 不可用 | 自动调用 repair.js | 降级 scraper-direct |
| 推送泛滥 | 72h 观察调参 | 收紧 score 阈值 |
| 重复推送 | 1h 去重窗口 | 增大窗口 |

---

## §2 审核清单

### C1-C3 理解检查

- [ ] C1 目标对齐：每小时 T0 + T1 源轻量轮询 → 判定 → 推送
- [ ] C2 范围边界：不改主管线、不改 DB schema、不改前端
- [ ] C3 数据影响：推送记录写 `logs/breaking-sent.json`（本地文件），不写 Supabase

### V1-V4 验证检查

- [ ] V1 正常路径：T0 源产出高评分文章 → 推送成功
- [ ] V2 边界路径：crawl4ai 离线 → 自动修复 → 降级抓取
- [ ] V3 降级路径：DeepSeek 不可用 → 跳过本轮（不推送），不阻塞
- [ ] V4 回归闸门：`npm run check` + `npm test` 全绿

### S1-S3 安全护栏

- [ ] S1 已知陷阱：无新增 known traps
- [ ] S2 硬反向操作：无（只有读操作和邮件推送）
- [ ] S3 密钥安全：Feishu webhook URL 从 `.env` 读取（已有），不新增密钥

---

## §3 协商记录

| 轮次 | 审核项 | 不通过项 | Evaluator 要求 | Generator 响应 |
|------|--------|---------|---------------|---------------|
| — | — | — | 待 Evaluator 审核 | — |

---

## §4 验收签名

### 4.1 验收结果表

| 验证项 | 预期 | 实际 | 证据 |
|--------|------|------|------|
| npm run check | exit 0 | — | — |
| npm test | 全部通过 | — | — |
| 判定逻辑覆盖率 | 100% | — | — |
| 抓取过滤覆盖率 | 100% | — | — |
| 72h 验收 | 日均 1-3 条 | — | — |

### 4.2 文档同步

| 文档 | 需要 | 已完成 |
|------|------|--------|
| CLAUDE.md | ✅ | — |
| DOCUMENT_MAP.md | ✅ | — |
| PROGRESS.md | ✅ | — |

### 4.3 签名

- [ ] Generator: _______ (日期: ________)
- [ ] Evaluator: _______ (日期: ________)
