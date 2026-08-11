# GitHub Actions 配置与修复指南

**仓库**: `3279549719-dotcom/ai-news-monitor`
**更新**: 2026-08-11

---

## 1. 当前状态诊断

### 1.1 诊断总表

| 检查项 | 状态 | 说明 |
|--------|------|------|
| Remote YAML 语法 | ✅ 正常 | 所有 `${{ }}` 表达式完整，无截断 |
| Secrets 命名匹配 | ✅ 正常 | 13 个 secrets，全部与 YAML 引用一致 |
| Variable `EMAIL_ENABLED` | ✅ 正常 | 存在，值为 `"false"` |
| Workflow permissions | ⚠️ 需关注 | `default_workflow_permissions: read`，但各 workflow 已显式覆盖 |
| `SUPABASE` legacy secret | ⚠️ 冗余 | 旧版单一 secret，不再被任何 workflow 引用 |
| **GitHub billing** | **❌ BLOCKED** | 账户付款失败或 spending limit 已超 |

### 1.2 5 次 Failure 分析

| Run ID | 标题 | 分支 | 真实原因 |
|--------|------|------|----------|
| 31499152602 | crawl4ai Smoke | master | **Billing**: "recent account payments have failed" |
| 31499137341 | REVIEW 管线... | feat/experiment-gha-pipeline | Workflow file issue（旧分支 YAML） |
| 31498658119 | REVIEW 管线... | feat/experiment-gha-pipeline | Workflow file issue（旧分支 YAML） |
| 31493029394 | fix(ops): heredoc | master | Workflow file issue（修复前的 YAML） |
| 31492554839 | fix(ops): restore YAML | master | Workflow file issue（修复前的 YAML） |

> **核心结论**: 当前远程 master 的 YAML 文件语法完全正确，Secrets 配置也正确。**唯一阻止 workflow 运行的是 billing 问题。**

---

## 2. Secrets 正确命名清单

以下 12 个 secrets 必须精确命名（区分大小写），已全部配置正确：

| Secret 名称 | 用途 | YAML 引用文件 |
|-------------|------|---------------|
| `SUPABASE_URL` | Supabase 项目 URL | ops-check.yml, daily-pipeline.yml |
| `SUPABASE_SERVICE_KEY` | Supabase service_role key | ops-check.yml, daily-pipeline.yml |
| `DEEPSEEK_API_KEY` | DeepSeek API 密钥 | daily-pipeline.yml |
| `DEEPSEEK_BASE_URL` | DeepSeek API 地址 | daily-pipeline.yml |
| `DEEPSEEK_MODEL` | 模型名称 | daily-pipeline.yml |
| `CRAWL4AI_API_TOKEN` | Crawl4AI 容器 token | daily-pipeline.yml, crawl4ai-smoke.yml |
| `SMTP_HOST` | SMTP 服务器 | daily-pipeline.yml |
| `SMTP_PORT` | SMTP 端口 | daily-pipeline.yml |
| `SMTP_SECURE` | 是否 SSL (true/false) | daily-pipeline.yml |
| `EMAIL_USER` | 发件邮箱 | daily-pipeline.yml |
| `EMAIL_AUTH_CODE` | 邮箱授权码 | daily-pipeline.yml |
| `RECEIVER_EMAIL` | 收件邮箱 | daily-pipeline.yml |

### Variable 清单

| Variable 名称 | 值 | 用途 |
|---------------|-----|------|
| `EMAIL_ENABLED` | `false` | daily-pipeline.yml 中控制邮件开关 |

### 可清理的冗余 Secret

| Secret 名称 | 说明 |
|-------------|------|
| `SUPABASE` | 旧版命名，可能是合并的 JSON。现在 workflow 已改用 `SUPABASE_URL` + `SUPABASE_SERVICE_KEY`，此 secret 不再需要 |

---

## 3. 逐项修复步骤

### 步骤 1：解决 GitHub Billing 问题（阻塞项）🔴 P0

此问题必须由仓库 owner 在 GitHub 网页端解决：

1. 打开 GitHub → 右上角头像 → **Settings**
2. 左侧导航 → **Billing & plans**
3. 检查是否有未付账单或 spending limit 已达上限
4. 如果是 free plan 的 Actions 配额用完，等待每月重置或升级计划
5. 更多信息: https://github.com/settings/billing

**验证**: 任意触发一个 workflow (`workflow_dispatch`)，job 应能成功进入 `queued` → `in_progress` 状态

### 步骤 2：确认 Production Branch 的 Workflow 版本 🟡 P1

`feat/experiment-gha-pipeline` 分支曾推送有 YAML 语法错误的 workflow。如果该分支仍需使用：

```bash
# 确保该分支与 master 同步
git checkout feat/experiment-gha-pipeline
git rebase master
git push
```

如果该分支不再需要，删除即可。所有 workflow 当前在 master 上已正确注册。

### 步骤 3：清理冗余 `SUPABASE` Secret 🟢 P2

此 secret 不再被任何 workflow 引用，可直接删除：

**网页端操作**:
1. 打开 `https://github.com/3279549719-dotcom/ai-news-monitor/settings/secrets/actions`
2. 找到 `SUPABASE`，点击右侧垃圾桶图标
3. 确认删除

**CLI 操作**:
```bash
gh secret delete SUPABASE --repo 3279549719-dotcom/ai-news-monitor
```

### 步骤 4：(可选) 调整 default_workflow_permissions 🟢 P3

当前 `default_workflow_permissions: read` 足够——各 workflow 均显式声明 `permissions: issues: write`。

如要全局提升为 `write`（保险起见）：

**网页端操作**:
1. 打开 `https://github.com/3279549719-dotcom/ai-news-monitor/settings/actions`
2. **Workflow permissions** 区域
3. 选择 **"Read and write permissions"**
4. 勾选 **"Allow GitHub Actions to create and approve pull requests"**（可选）
5. 点击 **Save**

---

## 4. Workflow 文件对照

### 4.1 ops-check.yml

- **触发**: 每日 08:00、16:00 (UTC) + `workflow_dispatch`
- **权限**: `issues: write`
- **Secrets 使用**: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`
- **Token 使用**: `${{ github.token }}`（用于创建 issue）

### 4.2 daily-pipeline.yml

- **触发**: 每日 00:00 UTC（北京时间 08:00）+ `workflow_dispatch`
- **权限**: `contents: read`, `issues: write`
- **Secrets 使用**: `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL`, `DEEPSEEK_MODEL`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `CRAWL4AI_API_TOKEN`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `EMAIL_USER`, `EMAIL_AUTH_CODE`, `RECEIVER_EMAIL`
- **Variable 使用**: `EMAIL_ENABLED`
- **需要 Docker** (ubuntu-latest runner 自带 Docker)

### 4.3 crawl4ai-smoke.yml

- **触发**: `workflow_dispatch` 手动触发
- **权限**: 默认 (`read`)
- **Secrets 使用**: `CRAWL4AI_API_TOKEN`
- **用途**: 冒烟测试 crawl4ai 容器是否能正常启动和健康检查

---

## 5. 验证方式

### 5.1 Workflow 手动触发验证

1. 打开 `https://github.com/3279549719-dotcom/ai-news-monitor/actions`
2. 选择 **crawl4ai Smoke**（最简单、最快）
3. 点击 **Run workflow** → **Run workflow**
4. 观察 job 是否成功进入 running 状态
5. 成功后依次验证 ops-check.yml 和 daily-pipeline.yml

### 5.2 本地 YAML 快速验证

```bash
# 在项目目录
node -e "const yaml = require('js-yaml'); const fs = require('fs'); 
const files = ['ops-check.yml', 'daily-pipeline.yml', 'crawl4ai-smoke.yml']; 
files.forEach(f => { try { yaml.load(fs.readFileSync('.github/workflows/' + f, 'utf8')); console.log(f + ': OK'); } catch(e) { console.log(f + ': FAIL - ' + e.message); } });"
```

### 5.3 Secrets 完整性检查

```bash
gh secret list --repo 3279549719-dotcom/ai-news-monitor
# 验证输出包含上面清单中的所有 12 个 secrets 名称
```

---

## 6. 常见问题排查

| 现象 | 可能原因 | 解决方法 |
|------|----------|----------|
| Job stuck 在 "queued" | Billing 问题 | 去 Settings → Billing & plans 检查 |
| "workflow file issue" | YAML 语法错误 | `git push` 前本地做 YAML 验证（5.2） |
| Secrets 获取到空值 | Secret 名称大小写/拼写错误 | 对比上面清单精确重命名 |
| crawl4ai 健康检查超时 | 容器启动慢或 Docker 资源不足 | 增加 `for` 循环的 `seq` 上限 |
| Issue 创建失败 | GH_TOKEN 权限不足 | 确认 workflow 有 `permissions: issues: write` |

---

## 7. 关键链接

| 资源 | URL |
|------|-----|
| Actions 页面 | https://github.com/3279549719-dotcom/ai-news-monitor/actions |
| Secrets 管理 | https://github.com/3279549719-dotcom/ai-news-monitor/settings/secrets/actions |
| Actions 设置 | https://github.com/3279549719-dotcom/ai-news-monitor/settings/actions |
| Billing 页面 | https://github.com/settings/billing |
| crawl4ai Smoke 直接触发 | https://github.com/3279549719-dotcom/ai-news-monitor/actions/workflows/crawl4ai-smoke.yml |
| Daily Pipeline 直接触发 | https://github.com/3279549719-dotcom/ai-news-monitor/actions/workflows/daily-pipeline.yml |
