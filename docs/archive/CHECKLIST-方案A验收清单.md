# CHECKLIST: 方案A落地验收清单

> 创建: 2026-08-03 ｜ 配套: docs/PLAN-方案A执行计划.md  
> 原则: 每条可客观验证（跑命令/看数据库/看前端），不依赖主观判断

---

## Phase 1: 端到端验证

### 1.1 Firecrawl 抓取成功

| # | 检查项 | 验证方式 | 通过标准 |
|---|--------|---------|---------|
| C01 | BBC Sport 抓取正常 | `node src/index.js` 日志含 `[Firecrawl] 抓取 BBC Sport` | 无 ETIMEDOUT/403/404，找到 X ≥ 1 条 |
| C02 | MEN 抓取正常 | 日志含 `[Firecrawl] 抓取 Manchester Evening News` | 无错误，找到 Y ≥ 0 条（MEN 可能无新文章）|
| C03 | 单个源失败不中断全局 | 手动改一处 scrape_url 为无效地址 | 日志 `[Firecrawl] 跳过` + 其他关键词继续运行 |

### 1.2 AI 评分 + 入库

| # | 检查项 | 验证方式 | 通过标准 |
|---|--------|---------|---------|
| C04 | AI 评分产出 ≥60 文章 | 日志 `相关: K/15`，K ≥ 0 | 不报错，正常输出 |
| C05 | `source_tier` 写入 | Supabase 查询 `articles WHERE keyword_id='manchester-united' AND source_tier IS NOT NULL ORDER BY created_at DESC LIMIT 5` | 至少 1 条 `source_tier` = 1 |
| C06 | 已见文章不去重 | 连续运行 2 次 `node src/index.js` | 第 2 次 Manchester United 显示 `未处理: 0` |

---

## Phase 2: 冗余清理

### 2.1 删除文件

| # | 检查项 | 验证方式 | 通过标准 |
|---|--------|---------|---------|
| C07 | `src/rss.js` 已删除 | `ls src/rss.js` | 文件不存在 |
| C08 | `keywords.json` 已删除 | `ls keywords.json` | 文件不存在 |
| C09 | `rss-parser` 依赖已移除 | `node -e "require('rss-parser')"` | 报错 `Cannot find module` |

### 2.2 语法检查

| # | 检查项 | 验证方式 | 通过标准 |
|---|--------|---------|---------|
| C10 | 所有 JS 文件语法正确 | `node --check src/*.js` | 全部通过，无错误输出 |

### 2.3 完整运行无引用错误

| # | 检查项 | 验证方式 | 通过标准 |
|---|--------|---------|---------|
| C11 | 全量 pipeline 无异常 | `node src/index.js` | 4 个关键词全部处理完，无 `MODULE_NOT_FOUND` 或 `ReferenceError` |

---

## Phase 3: 前端验收

### 3.1 Tier 展示

| # | 检查项 | 验证方式 | 通过标准 |
|---|--------|---------|---------|
| C12 | 文章卡片显示 Tier 徽章 | 浏览器访问 `client/` dev server，筛选 Manchester United | 卡片右上角/左侧有 T1 标签 |
| C13 | Tier 徽章样式可区分 | 观察不同 Tier 的文章卡片 | T1 和 T2 视觉上有明显差异 |
| C14 | 无 source_tier 的文章不崩溃 | 切换到 Anthropic / Dallas Mavericks | 文章正常展示，无非 Tier 徽章也不报错 |

### 3.2 Tier 筛选功能

| # | 检查项 | 验证方式 | 通过标准 |
|---|--------|---------|---------|
| C15 | 筛选框包含所有选项 | 点开 Tier 筛选下拉 | 有 全部/Tier 0/Tier 1/Tier 2（无 Tier 3 可接受）|
| C16 | 筛选生效 | 选 Tier 1 | 页面只显示 T1 文章 |
| C17 | 筛选后翻页不丢失 | 筛选 Tier 1 → 翻到第 2 页 | 仍只显示 T1 文章 |

---

## Phase 4: 回归验证

### 4.1 其他关键词不受影响

| # | 检查项 | 验证方式 | 通过标准 |
|---|--------|---------|---------|
| C18 | Anthropic 正常产出 | 日志含 `[Anthropic] 搜索 "Anthropic"` | 找到 N > 0 条，相关 K > 0 |
| C19 | Dallas Mavericks 正常 | 日志含 `[Dallas Mavericks] 搜索` | 找到 N ≥ 0 条，无报错 |
| C20 | Claude Blog 正常 | 日志含 `[Claude Blog] 抓取` | 正常产出或提示无新内容 |

---

## 验收通过条件

**全部 20 条检查项中，C01-C06 + C10-C11 + C18-C20 为硬性通过项（共 10 项），C07-C09 + C12-C17 为软性通过项（共 10 项）。**

- ✅ **全部通过** → 方案 A 落地完成，可进入交叉校验（方案 B）开发
- ⚠️ **硬性项全过、软性项有瑕疵** → 可接受，记录遗留问题后续修复
- ❌ **硬性项有失败** → 阻塞，先修 bug 再重跑
