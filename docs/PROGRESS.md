# ai-news-monitor 项目进度

> 最后更新：2026-08-02

## 功能进度

| ID | 功能 | 状态 | 验证 |
|---|---|---|---|
| F-001 | MVP：claude.com/blog 监控 + AI 摘要 | 已完成 | 2026-08-01 实机验证 |
| F-002 | Phase 2：多关键词 + Google News RSS + HackerNews 搜索 | 已完成 | 2026-08-01 实机验证（manchester united trade 14/15相关）|
| F-003 | Phase 3：Supabase 持久化 + cron 定时 + 代码重构 | 已完成 | 2026-08-02 实机验证，4个关键词全部通过 |

## F-003 交付内容（2026-08-02）

**新增：**
- Supabase `keywords` + `articles` 表，RLS 已启用
- `src/db.js`：Supabase client 单例 + `withRetry` 重试工具
- `src/store.js`：`loadKeywords`、`filterNewItems`（RPC）、`saveArticles`
- RPC 函数 `get_new_urls`：规避 Google News 长URL 导致的 PostgREST Bad Request
- `CRON_SCHEDULE` 环境变量：可选定时调度

**重构：**
- Pipeline 策略模式（`PIPELINES` 对象替代两个重复函数）
- `analyzeItems` 用 `reduce` 替代 filter+map 双循环
- 单次 `saveArticles` 调用（合并相关/不相关记录）
- 关键词顺序处理（避免并发压垮 Supabase 连接池）
- `keywords.json` 已弃用，关键词改为从 Supabase 管理

**已解决的 Bug：**

| ID | 描述 | 修复方式 |
|---|---|---|
| B-001 | Bing scraper 被 JS 反爬 | 换 Google News RSS |
| B-002 | filterNewItems 对大 URL 数组触发 PostgREST Bad Request | 改用 RPC + `ANY()` |
| B-003 | 并发关键词处理导致 Supabase 连接 fetch failed | 改为顺序处理 |
| B-004 | get_new_urls 函数 search_path 可变（安全 WARN）| 添加 `SET search_path = ''` |

## 安全备注

- `allow_all_keywords` / `allow_all_articles` RLS 策略当前为宽松模式（个人项目）
- 上线前需改为基于 `auth.uid()` 的细粒度策略

## 遗留与待跟进

- [ ] 前端 UI（展示 Supabase articles 数据）
- [ ] 信息源扩展（Reddit、RSS feed 等）
- [ ] RLS 策略收紧（从宽松模式改为认证模式）
- [ ] seen.json 和 keywords.json 可以安全删除
