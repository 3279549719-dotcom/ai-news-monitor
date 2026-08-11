# Trust Escalation — AI 运维自治信任升级路径

> 仓库：ai-news-monitor | 更新：2026-08-11

---

## 概述

运维自动化从"AI 帮忙看"到"AI 自己动手"，需要分级信任——每级的权限、约束、升级条件都预先定义。本文档定义了 L0→L3 四级信任模型。

**当前目标**：从 L0 推进到 **L1（半自动）**，即 AI 在受控范围内执行低风险修复。

---

## 信任级别总览

<div class="rich-metrics">
<div class="rich-metric"><span class="rich-badge">L0</span> 纯人工<br>AI 只读诊断</div>
<div class="rich-metric"><span class="rich-badge">L1</span> 半自动<br>低风险修复 ⬅ 当前目标</div>
<div class="rich-metric"><span class="rich-badge">L2</span> 自动修复<br>白名单全量</div>
<div class="rich-metric"><span class="rich-badge">L3</span> 自治运维<br>全权+降级触发</div>
</div>

---

## L0 — 纯人工（基线）

| 维度 | 说明 |
|------|------|
| **AI 角色** | 只读诊断。观察→分析→报告，不动手。 |
| **允许的操作** | ops-check 运行、Issue 创建（含 @copilot 诊断指令）、日志归档 |
| **需要人工批准** | 任何修复操作（包括 docker restart、npm install） |
| **通知方式** | Issue 创建 + 邮件/微信告警 |
| **信任依据** | 人工复核每次诊断结论后再手动执行 |

### 升级到 L1 条件

- [ ] 连续 50 次诊断无误诊（误诊 = AI 诊断为根因 A，实际根因为 B）
- [ ] 诊断→人工修复闭环跑通 ≥10 次
- [ ] `.auto-fix.json` 白名单已创建并代码审查通过
- [ ] `auto-heal.js` 的 `diagnose()` 函数通过单元测试
- [ ] Patrick 明确批准升级

---

## L1 — 半自动（当前目标）

| 维度 | 说明 |
|------|------|
| **AI 角色** | 诊断 + 低风险修复。在受限白名单内自动执行，高风险操作仍报告给人。 |
| **允许的操作（自动）** | docker restart crawl4ai、npm ci、清理过期日志（>7天）、git pull、重新触发 pipeline |
| **需要人工批准** | 重启宿主机、修改配置文件（`.env`、`src/config.js`）、删除用户数据、升级依赖版本 |
| **每日限额** | 最多 3 次自动修复，冷却 30 分钟（`globalLimits` 控制） |
| **回滚机制** | `reversible: true` 的命令（如 npm ci）可在误操作后回滚；`reversible: false` 的命令有额外日志 |
| **通知方式** | Issue 自动评论+关闭、微信推送修复摘要 |

### 升级到 L2 条件

- [ ] 自动修复成功率 > 90%（连续统计 30 天）
- [ ] 误操作 < 1 次/月（误操作 = 修复导致服务中断或数据丢失）
- [ ] `.auto-heal.json` 日志记录完整，可审计
- [ ] ops-stats.js 面板显示 pipeline 成功率 > 85%
- [ ] Patrick 明确批准升级

---

## L2 — 自动修复

| 维度 | 说明 |
|------|------|
| **AI 角色** | 诊断 + 白名单内全量修复。诊断到问题直接修，不再逐条等批准。 |
| **允许的操作（自动）** | 白名单 `.auto-fix.json` 内所有命令，不限每日次数（但保留冷却） |
| **需要人工批准** | 白名单外的任何命令、修改权限配置、新增白名单条目 |
| **审计要求** | 每次修复写入 Issue 时间线，月度 ops-stats 统计报告 |
| **安全约束** | 禁止修改 `src/config.js`、`.env`、`.gitignore`；禁止执行 `rm -rf`、`git push --force` |

### 升级到 L3 条件

- [ ] 自动修复成功率 > 99%（连续统计 60 天）
- [ ] 连续 90 天无安全事故
- [ ] ops-stats 月报自动生成并推送到 Patrick
- [ ] Patrick 明确批准升级

---

## L3 — 自治运维

| 维度 | 说明 |
|------|------|
| **AI 角色** | 全权运维。自己发现问题、诊断根因、执行修复、汇报结果。 |
| **允许的操作（自动）** | 所有运维操作，包括配置修改、依赖升级、版本发布 |
| **禁止的操作** | 修改认证凭据（`.env` 中的 secret 值）、删除生产数据、force push |
| **降级触发** | 连续 3 次修复失败 → 自动降回 L2；安全事故 → 立即降回 L1 |
| **人机协作** | Patrick 保留一票否决权，随时可手动降级 |

### L3 降级规则

| 触发条件 | 降级到 | 恢复条件 |
|----------|--------|----------|
| 连续 3 次自动修复失败 | L2 | 连续 20 次成功修复后申请恢复 |
| 单次安全事故（数据丢失/服务中断>30min） | L1 | 人工审查 + 修复根因后申请恢复 |
| ops-stats 显示 pipeline 成功率 < 70% | L2 | 成功率恢复 > 85% 后自动恢复 |

---

## 信任升级流程图

```
L0 ──50次无误诊──▶ L1 ──成功率>90%──▶ L2 ──成功率>99%──▶ L3
  ◀──────────── 安全事故 ◀────── 连续3次失败 ◀────── 安全事故
```

---

## 相关文件

| 文件 | 用途 |
|------|------|
| `scripts/.auto-fix.json` | L1+ 命令白名单 |
| `scripts/auto-heal.js` | 自愈引擎（diagnose + heal） |
| `scripts/issue-close.js` | Issue 自动回写 |
| `scripts/ops-stats.js` | 运维统计面板 |
| `docs/GITHUB-SETUP-GUIDE.md` | GitHub Actions 配置指南 |
| `docs/OPENCLAW-CRON-SETUP.md` | OpenClaw cron 配置 |
