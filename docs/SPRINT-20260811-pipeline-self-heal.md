# SPRINT: 管线自诊断与自动修复

> 状态: Proposed ｜ Generator: generator-agent ｜ 日期: 2026-08-11
> 依据: [REQ-三代理工作流-P0双任务.md] [DECISION-三代理P0-技术选型.md]
> 复杂度: 🔴 L3 | Sprint Contract 强制 | A3 复核强制

---

## §1 任务声明

### 1.1 我要构建什么

一个管线自诊断与自动修复系统。当 `scripts/run-pipeline.js` 非零退出时：
1. **诊断引擎**（`src/diagnose.js`）读取 pipeline log 尾部 + 环境探测 → 输出诊断报告
2. **修复动作库**（`src/repair.js`）按诊断结果执行修复
3. **自愈编排**（`scripts/self-heal.js`）串联诊断→修复→烟雾测试→可选的自动重跑
4. **集成到现有管线**：修改 `scripts/run-pipeline.js` 失败出口 + `scripts/ops-check.js`

### 1.2 如何验证

| 验证项 | 方法 | 证据形式 |
|--------|------|---------|
| 诊断规则匹配 | 注入模拟日志 → 断言诊断输出类型正确 | `node:test` 断言 |
| Docker 重启修复 | 模拟 Docker 不可用 → 调用 repair → 验证调用链 | Mock + spy 断言 |
| crawl4ai 健康检查 | 模拟 unhealthy → 修复 → 验证重启命令 | Mock + spy 断言 |
| 烟雾测试 | 修复后 fetch 1 T0 源 → 断言正常产出 | 真实网络（E2E） |
| 自愈全流程 | 管线失败 → self-heal → 回归通过 | E2E 日志 |
| 回归闸门 | `npm run check` 全绿 + `npm test` 全绿 | CI 输出 |
| A3 复核 | Evaluator 独立跑烟雾测试 + 审查修复日志 | REVIEW-A3-*.md |

### 1.3 本次不做

- AI 评分异常的智能诊断（那是 P2 的功能）
- 修复动作的并行执行
- 前端诊断面板
- 多管线并行诊断
- 邮件告警模板的美化（用现有 notify 格式即可）

### 1.4 风险与回滚

| 风险 | 缓解 | 回滚 |
|------|------|------|
| 误诊断导致错误修复 | 烟雾测试门控 | `git revert` |
| 自动重跑烧 API 费 | 最多重跑 1 次 | 环境变量 `SELF_HEAL_MAX_RERUN=0` 禁用 |
| Docker 重启失败 | 超时 + 告警 | 手动重启 |
| 诊断流程超时阻塞下轮 | 全流程 10 分钟超时 | 超时后自动告警退出 |

---

## §2 审核清单

### C1-C3 理解检查

- [ ] C1 目标对齐：诊断覆盖所有已知故障模式（DOCKER/CRAWL4AI/AUTH/API/SOURCE/NET/UNKNOWN）
- [ ] C2 范围边界：不改 DB schema、不改前端、不改 RLS/settings.json
- [ ] C3 数据影响：诊断日志写 `logs/diagnosis-*.log`，不写入 Supabase

### V1-V4 验证检查

- [ ] V1 正常路径：管线失败 → 诊断匹配 → 修复成功 → 烟雾测试 PASS
- [ ] V2 边界路径：修复失败 → 不进入重跑 → 升级告警
- [ ] V3 降级路径：LLM 不可用 → 规则诊断兜底
- [ ] V4 回归闸门：`npm run check` + `npm test` 全绿

### S1-S3 安全护栏

- [ ] S1 已知陷阱：`--keep-ids=` 等号形式（B1 已拦截，不需额外处理）
- [ ] S2 硬反向操作：修复包含 Docker 重启（不可逆但安全），自动重跑管线（消耗 API token，有上限）
- [ ] S3 密钥安全：不新增 .env* 变更，不新增外部 API 密钥

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
| 诊断规则覆盖率 | 100% | — | — |
| 修复动作覆盖率 | 100% | — | — |
| E2E 烟雾测试 | PASS | — | — |

### 4.2 文档同步

| 文档 | 需要 | 已完成 |
|------|------|--------|
| CLAUDE.md | ✅ | — |
| KNOWN_TRAPS.md | ✅ (新陷阱记录) | — |
| DOCUMENT_MAP.md | ✅ | — |
| PROGRESS.md | ✅ | — |

### 4.3 签名

- [ ] Generator: _______ (日期: ________)
- [ ] Evaluator: _______ (日期: ________)
