# ai-news-monitor

AI 驱动的多关键词信息监控工具。从多个信息源抓取内容，AI 过滤相关结果并生成中文摘要报告，结果持久化到 Supabase。

## 运行

```bash
node src/index.js              # 手动运行一次
CRON_SCHEDULE="0 8 * * *" node src/index.js  # 每天8点定时运行
```

## 技术栈

- Node.js CommonJS
- axios + cheerio（HTTP 抓取与 HTML 解析）
- @supabase/supabase-js（数据层）
- openai SDK（指向 DeepSeek API）
- node-cron（定时调度，可选）
- dotenv（环境变量）

## 目录结构

```
src/
  index.js      主流程：关键词循环、pipeline 调度、报告生成
  db.js         Supabase client 单例 + withRetry 工具
  store.js      数据访问层：loadKeywords、filterNewItems、saveArticles
  scraper.js    blog 类型：抓取指定博客文章列表
  reader.js     blog 类型：读取单篇文章正文（截 4000 字）
  search.js     search 类型：Google News RSS + HackerNews Algolia
  ai.js         summarizeArticle（blog）、analyzeResult（search）
keywords.json   已弃用，关键词现在存储在 Supabase keywords 表
data/           运行产物（seen.json 已弃用，状态在 Supabase）
reports/        每日报告 YYYY-MM-DD.md（运行时自动生成）
```

## Supabase 表结构

- `keywords`：id, name, type(blog|search), query, url, enabled
- `articles`：keyword_id, title, url, source, snippet, summary, score, published_at
- RPC `get_new_urls(keyword_id, urls[])`: 返回未见过的 URL（规避 PostgREST URL 长度限制）

## 环境变量（.env）

| 变量 | 说明 |
|---|---|
| `DEEPSEEK_API_KEY` | DeepSeek API 密钥 |
| `DEEPSEEK_MODEL` | 模型 ID（如 `deepseek-chat`）|
| `DEEPSEEK_BASE_URL` | API 地址（默认 `https://api.deepseek.com`）|
| `SUPABASE_URL` | Supabase 项目 URL |
| `SUPABASE_KEY` | Supabase publishable key |
| `CRON_SCHEDULE` | cron 表达式，留空则手动运行（如 `0 8 * * *`）|

## 关键约束

- 关键词在 Supabase `keywords` 表管理，不再读取 `keywords.json`
- `get_new_urls` RPC 规避 PostgREST URL 长度限制（尤其 Google News 长URL）
- blog 类型 score 固定 100；search 类型 score 由 AI 评分（0-100），≥60 视为相关
- RLS 策略当前为个人项目宽松模式（`USING (true)`），上线前需收紧

## 文档导航

→ [DOCUMENT_MAP.md](DOCUMENT_MAP.md)
→ [docs/PRD.md](docs/PRD.md)
→ [docs/PROGRESS.md](docs/PROGRESS.md)
