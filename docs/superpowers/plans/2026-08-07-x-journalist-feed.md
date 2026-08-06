# X 记者推文进 feed 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** X 记者（Ornstein/Stone/Whitwell/Mitten）原帖推文以"推文卡"形式直接进 feed——twikit 主通道 + crawl4ai guest 兜底，纯文字爆料不再漏。

**Architecture:** 新增纯解析模块 `src/x-tweet-parse.js`（可单测）→ 新增编排模块 `src/x-fetch.js`（twikit 优先、crawl4ai 兜底）→ `crawl4ai-fetch.js` X 分支改为 markdown 推文卡解析 → `search.js` X 源走 x-fetch → 配 2 个新 T1 记者。

**Tech Stack:** Node.js CommonJS、Python 3.13/3.14 + twifork（twikit fork）、crawl4ai 容器（localhost:11235）、node:test、Supabase。

**Spec:** `docs/superpowers/specs/2026-08-07-x-journalist-feed-design.md`

## Global Constraints

- 后端 CommonJS（`require` / `module.exports`），不引入 ES Module。
- 凭证只进 `.env`（gitignored），不在代码/对话中出现。
- X 源**不降级 Direct**；单源失败不阻塞管线其余信源。
- 推文卡 `title` ≤280 字符；`url` = `https://x.com/<handle>/status/<id>`。
- 测试：`npm test` = `node --test "src/*.test.js"`；全绿用 `npm run check`。
- 只暂存本次任务文件，不碰 AGENTS.md 未提交改动与 `flowchart/`。

---

### Task 1: 纯解析模块 `src/x-tweet-parse.js`（TDD）

**Files:**
- Create: `src/x-tweet-parse.js`
- Create: `src/x-tweet-parse.test.js`

**Interfaces:**
- Produces: `snowflakeTimestamp(statusId) → Date|null`、`handleFromProfileUrl(url) → string`、`statusUrlFor(handle, id) → string`、`extractTweetsFromMarkdown(md, handle) → [{title,url,publishedAt}]`、`parseTwikitRows(source, rows) → [item]`（item 形状 = `{title,url,snippet,publishedAt,source_name,source,tier}`）

- [ ] **Step 1: 写失败测试**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { snowflakeTimestamp, handleFromProfileUrl, statusUrlFor, extractTweetsFromMarkdown, parseTwikitRows } = require('./x-tweet-parse');

test('雪花 ID 解码为发推时间', () => {
  // 实测 2085376698753655092 → 2026-08-07 左右（比 1288834974657 大即为合理）
  const d = snowflakeTimestamp('2085376698753655092');
  assert.ok(d instanceof Date);
  assert.ok(d.getTime() > Date.UTC(2026, 0, 1));
  assert.equal(snowflakeTimestamp(''), null);
  assert.equal(snowflakeTimestamp(null), null);
});

test('从账号页 URL 提取 handle', () => {
  assert.equal(handleFromProfileUrl('https://x.com/David_Ornstein'), 'David_Ornstein');
  assert.equal(handleFromProfileUrl('https://x.com/sistoney67/with_replies'), 'sistoney67');
});

test('构造状态链接', () => {
  assert.equal(statusUrlFor('David_Ornstein', '123'), 'https://x.com/David_Ornstein/status/123');
});

test('从 crawl4ai markdown 提取推文卡（含卡片与纯文字）', () => {
  const md = `[](https://x.com/)
[Log in](https://x.com/i/jf/onboarding/web?mode=login)
[David Ornstein](https://x.com/David_Ornstein)
[@David_Ornstein](https://x.com/David_Ornstein)
[1h](https://x.com/David_Ornstein/status/2085376698753655092)
🚨 West Ham United talks with Tottenham Hotspur over Manor Solomon currently off for financial reasons. [#WHUFC](https://x.com/hashtag/WHUFC) [@TheAthleticFC](https://x.com/TheAthleticFC)
[ ![...](x)West Ham card ](https://t.co/fAe1PyA69M)[From nytimes.com](https://t.co/fAe1PyA69M)
463
568
10K
992K
[David Ornstein](https://x.com/David_Ornstein)
[@David_Ornstein](https://x.com/David_Ornstein)
[3h](https://x.com/David_Ornstein/status/2085342639696527389)
🚨 Carlos Baleba doubtful for start of new campaign through injury. [@TheAthleticFC](https://x.com/TheAthleticFC)
## Log in or sign up for X`;
  const tweets = extractTweetsFromMarkdown(md, 'David_Ornstein');
  assert.equal(tweets.length, 2);
  assert.ok(tweets[0].title.includes('West Ham United talks'));
  assert.equal(tweets[0].url, 'https://x.com/David_Ornstein/status/2085376698753655092');
  assert.ok(tweets[0].publishedAt instanceof Date);
  assert.ok(tweets[1].title.includes('Carlos Baleba'));
  // 卡片标题与 t.co 链接不进 title/url（t.co 卡片仅作上下文）
  assert.ok(!tweets[0].title.includes('West Ham card'));
});

test('parseTwikitRows：twikit JSON → item', () => {
  const source = { source_name: 'David Ornstein (X)', tier: 1 };
  const rows = [{
    handle: 'David_Ornstein',
    status_id: '2085376698753655092',
    text: 'Manchester United are in talks to sign a striker.',
    created_at: '2026-08-07T01:00:00+00:00',
  }];
  const items = parseTwikitRows(source, rows);
  assert.equal(items.length, 1);
  assert.equal(items[0].url, 'https://x.com/David_Ornstein/status/2085376698753655092');
  assert.equal(items[0].title, 'Manchester United are in talks to sign a striker.');
  assert.equal(items[0].source, 'david-ornstein-(x)');
  assert.equal(items[0].tier, 1);
  assert.ok(items[0].publishedAt instanceof Date);
});
```

- [ ] **Step 2: 运行测试确认失败** — `npm test` → 预期 FAIL（`Cannot find module './x-tweet-parse'`）

- [ ] **Step 3: 最小实现**

```js
'use strict';
const { sourceSlug, toItem } = require('./items');

/** 雪花 ID → 发推毫秒时间戳（status id 是 snowflake：右移 22 位 + 固定偏移）。失败返回 null。 */
function snowflakeTimestamp(statusId) {
  if (!statusId || !/^\d{1,19}$/.test(String(statusId))) return null;
  // 用 BigInt 精确右移（status id 达 2e18，Number 会丢精度、`>>` 会截断 32 位）
  const ms = Number(BigInt(statusId) >> 22n) + 1288834974657;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return new Date(ms);
}

/** 从 X 账号页 URL 提取 handle（pathname 第一段）。 */
function handleFromProfileUrl(url) {
  try {
    return new URL(url).pathname.split('/').filter(Boolean)[0] || '';
  } catch { return ''; }
}

/** 构造状态链接。 */
function statusUrlFor(handle, id) {
  return `https://x.com/${handle}/status/${id}`;
}

// 提取 crawl4ai markdown 中的状态链接（任意 x.com/twitter.com 账号）
const STATUS_RE = /\[[^\]]*\]\((?:https?:)?\/\/(?:x\.com|twitter\.com)\/[A-Za-z0-9_]+\/status\/(\d+)\)/g;

/**
 * 从 crawl4ai 返回的 X 账号页 markdown 提取推文卡。
 * 结构：`[相对时间](…/status/<id>)` 后跟推文正文（含 `[#tag](url)` markdown 链接）；
 * 卡片链接 `[卡片标题](https://t.co/…)` 仅作上下文，不进 title/url。
 * @param {string} md - crawl4ai markdown。
 * @param {string} handle - 账号 handle，用于拼状态链接。
 * @returns {Array} [{title,url,publishedAt}]
 */
function extractTweetsFromMarkdown(md, handle) {
  if (!md || !handle) return [];
  const matches = [];
  let m;
  STATUS_RE.lastIndex = 0;
  while ((m = STATUS_RE.exec(md)) !== null) {
    matches.push({ id: m[1], index: m.index });
  }
  const tweets = [];
  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i];
    const end = i + 1 < matches.length ? matches[i + 1].index : md.length;
    let block = md.slice(cur.index, end);
    // 剥掉状态链接自身的 markdown
    block = block.replace(/\[[^\]]*\]\([^)]*\/status\/\d+\)/, '');
    // 剥 [text](url) → 保留 text；t.co 卡片标题会被并入，但用截断 + 过滤兜底
    block = block.replace(/\[([^\]]*)\]\([^)]*\)/g, (_, txt) => txt || '');
    const text = block
      .split('\n')
      .map(l => l.trim())
      .filter(l => l
        && !/^[\d.,KMB+]+$/.test(l)                    // 互动数（463/568/10K）
        && !/^Log in|^Sign up|^Terms|^Privacy|^Cookie|^Ads|^©/.test(l) // 页脚
        && !/^(Follow|Mention|Posts|Replies|Media)$/.test(l)
        && !/^!?\[/.test(l))                            // 残留图链
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text.length >= 15) {
      const ts = snowflakeTimestamp(cur.id);
      tweets.push({
        title: text.slice(0, 280),
        url: statusUrlFor(handle, cur.id),
        publishedAt: ts || null,
      });
    }
  }
  return tweets;
}

/** twikit 结构化行 → item（toItem 形状）。 */
function parseTwikitRows(source, rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter(r => r && r.text && r.text.trim().length >= 15)
    .map(r => toItem(source, {
      title: String(r.text).trim().slice(0, 280),
      url: statusUrlFor(r.handle || '', String(r.status_id || '')),
      publishedAt: r.created_at ? new Date(r.created_at) : null,
    }))
    .filter(i => i.url.includes('/status/'));
}

module.exports = { snowflakeTimestamp, handleFromProfileUrl, statusUrlFor, extractTweetsFromMarkdown, parseTwikitRows };
```

- [ ] **Step 4: 运行测试确认通过** — `npm test` → 该文件 PASS

- [ ] **Step 5: 提交**

```bash
git add src/x-tweet-parse.js src/x-tweet-parse.test.js
git commit -m "feat: X 推文卡纯解析模块（雪花时间戳/markdown 提取/twikit 行解析）"
```

---

### Task 2: crawl4ai X 分支改为 markdown 推文卡

**Files:**
- Modify: `src/crawl4ai-fetch.js`（X 分支 165-176 行）
- Test: `src/x-tweet-parse.test.js`（已覆盖解析函数）

**Interfaces:**
- Consumes: `extractTweetsFromMarkdown`、`handleFromProfileUrl`、`snowflakeTimestamp`（Task 1）
- Produces: `crawl4ai.fetchSourceArticles(source)` 对 X 源返回推文卡 items（不再返回 t.co 文章卡）

- [ ] **Step 1: 改 X 分支**

替换 `src/crawl4ai-fetch.js` 顶部 import 与 X 分支：

```js
const { extractTweetsFromMarkdown, handleFromProfileUrl } = require('./x-tweet-parse');
```

```js
  // X 账号：从 markdown 解析推文卡（状态链接+正文+雪花时间戳）；纯文字爆料也可见
  if (isXUrl(source.scrape_url)) {
    const md = r.markdown || {};
    const mdStr = [md.fit_markdown, md.raw_markdown].filter(Boolean).join('\n');
    const handle = handleFromProfileUrl(source.scrape_url);
    return extractTweetsFromMarkdown(mdStr, handle)
      .map(t => toItem(source, { title: t.title, url: t.url, publishedAt: t.publishedAt }));
  }
```

（删除原 `links.external` t.co 提取块。）

- [ ] **Step 2: 语法检查** — `npx node scripts/check-syntax.js` 或 `node --check src/crawl4ai-fetch.js`

- [ ] **Step 3: 冒烟（需容器在线）** — `node -e "require('./src/crawl4ai-fetch').fetchSourceArticles({scrape_url:'https://x.com/David_Ornstein',source_name:'David Ornstein (X)',tier:1}).then(r=>console.log(JSON.stringify(r.slice(0,3),null,2)))"` → 预期输出推文卡 items（含 title/url/publishedAt）

- [ ] **Step 4: 提交**

```bash
git add src/crawl4ai-fetch.js
git commit -m "feat: crawl4ai X 分支改 markdown 推文卡解析（替代 t.co 短链提取）"
```

---

### Task 3: twikit Python 桥接脚本

**Files:**
- Create: `scripts/x-fetch-tweets.py`
- Create: `.venv-x/`（venv，不进 git）

**Interfaces:**
- Consumes: env `X_AUTH_TOKEN`/`X_CT0`（cookie）或 `X_USERNAME`/`X_PASSWORD`（密码）
- Produces: stdout JSON `[{handle,status_id,text,created_at,url}]`；退出码 0 成功、非 0 失败（stderr 说明）

- [ ] **Step 1: 建 venv + 装 twifork**

```bash
cd /e/claude/ai-news-monitor
python3 -m venv .venv-x
.venv-x/Scripts/python.exe -m pip install --upgrade pip
.venv-x/Scripts/python.exe -m pip install twifork
```

验证：`.venv-x/Scripts/python.exe -c "import twikit; print(twikit.__version__)"`（twifork 以 twikit 包名安装）

- [ ] **Step 2: 写脚本**

```python
#!/usr/bin/env python3
"""twikit 桥接：拉取 X 账号最近推文，输出结构化 JSON 到 stdout。
用法: python x-fetch-tweets.py <handle> [<handle>...]
凭证: 环境变量 X_AUTH_TOKEN/X_CT0（cookie，优先）或 X_USERNAME/X_PASSWORD（密码）。
"""
import json
import os
import sys

def build_client():
    from twikit import Client
    client = Client("en-US")
    cookie_file = os.environ.get("X_COOKIES_FILE", "")
    auth_token = os.environ.get("X_AUTH_TOKEN", "")
    ct0 = os.environ.get("X_CT0", "")
    username = os.environ.get("X_USERNAME", "")
    password = os.environ.get("X_PASSWORD", "")

    if cookie_file and os.path.exists(cookie_file):
        client.load_cookies(cookie_file)
    elif auth_token and ct0:
        client.set_cookies({"auth_token": auth_token, "ct0": ct0})
        if cookie_file:
            client.save_cookies(cookie_file)
    elif username and password:
        client.login(auth_info_1=username, password=password)
        if cookie_file:
            client.save_cookies(cookie_file)
    else:
        print("ERROR: no X credentials (X_AUTH_TOKEN/X_CT0 or X_USERNAME/X_PASSWORD)", file=sys.stderr)
        sys.exit(2)
    return client

def fetch_handle(client, handle, limit=20):
    try:
        user = client.get_user_by_screen_name(handle)
        tweets = client.get_user_tweets(user.id, count=limit)
        rows = []
        for t in tweets or []:
            rows.append({
                "handle": handle,
                "status_id": str(getattr(t, "id", "")),
                "text": getattr(t, "text", "") or "",
                "created_at": getattr(t, "created_at_datetime", None).isoformat() if getattr(t, "created_at_datetime", None) else None,
                "url": f"https://x.com/{handle}/status/{getattr(t, 'id', '')}",
            })
        return rows
    except Exception as e:
        print(f"WARN {handle}: {e}", file=sys.stderr)
        return []

def main():
    handles = sys.argv[1:]
    if not handles:
        print("usage: python x-fetch-tweets.py <handle>...", file=sys.stderr)
        sys.exit(1)
    client = build_client()
    out = []
    for h in handles:
        out.extend(fetch_handle(client, h))
    print(json.dumps(out, ensure_ascii=False))

if __name__ == "__main__":
    main()
```

- [ ] **Step 3: 语法检查 + 无凭证自检**

```bash
.venv-x/Scripts/python.exe -m py_compile scripts/x-fetch-tweets.py
X_AUTH_TOKEN= X_CT0= .venv-x/Scripts/python.exe scripts/x-fetch-tweets.py David_Ornstein
# 预期：stderr 输出 "ERROR: no X credentials"，退出码 2
```

- [ ] **Step 4: 提交**

```bash
git add scripts/x-fetch-tweets.py
git commit -m "feat: twikit 桥接脚本（cookie/密码登录，输出推文 JSON）"
```

---

### Task 4: Node 编排模块 `src/x-fetch.js`

**Files:**
- Create: `src/x-fetch.js`
- Create: `src/x-fetch.test.js`

**Interfaces:**
- Consumes: `crawl4ai.fetchSourceArticles`、`parseTwikitRows`/`handleFromProfileUrl`（Task 1）、`config.X_PYTHON`/`X_TWIKIT_ENABLED`
- Produces: `fetchXSourceArticles(source) → Promise<items>`（twikit 优先，crawl4ai 兜底，全败返回 []）

- [ ] **Step 1: 写失败测试**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const xFetch = require('./x-fetch');

test('twikit 有结果时用 twikit 行，不调用 crawl4ai', async () => {
  const source = { scrape_url: 'https://x.com/David_Ornstein', source_name: 'David Ornstein (X)', tier: 1 };
  const rows = [{ handle: 'David_Ornstein', status_id: '1', text: 'Manchester United in talks with target.', created_at: '2026-08-07T00:00:00+00:00' }];
  const origRun = xFetch.runTwikit;
  const origCrawl = xFetch.crawl4aiFetch;
  xFetch.runTwikit = () => rows;
  xFetch.crawl4aiFetch = { fetchSourceArticles: async () => { throw new Error('不应调用 crawl4ai'); } };
  try {
    const items = await xFetch.fetchXSourceArticles(source);
    assert.equal(items.length, 1);
    assert.equal(items[0].url, 'https://x.com/David_Ornstein/status/1');
  } finally {
    xFetch.runTwikit = origRun;
    xFetch.crawl4aiFetch = origCrawl;
  }
});

test('twikit 空 → 回退 crawl4ai', async () => {
  const source = { scrape_url: 'https://x.com/sistoney67', source_name: 'Simon Stone (X)', tier: 1 };
  const origRun = xFetch.runTwikit;
  const origCrawl = xFetch.crawl4aiFetch;
  xFetch.runTwikit = () => [];
  xFetch.crawl4aiFetch = { fetchSourceArticles: async () => [{ title: 'fallback', url: 'https://x.com/sistoney67/status/2', publishedAt: null, source: 'simon-stone-(x)', source_name: 'Simon Stone (X)', tier: 1, snippet: '' }] };
  try {
    const items = await xFetch.fetchXSourceArticles(source);
    assert.equal(items.length, 1);
    assert.equal(items[0].url, 'https://x.com/sistoney67/status/2');
  } finally {
    xFetch.runTwikit = origRun;
    xFetch.crawl4aiFetch = origCrawl;
  }
});
```

- [ ] **Step 2: 运行确认失败** — `npm test` → FAIL（module not found）

- [ ] **Step 3: 实现**

```js
'use strict';
const path = require('path');
const { spawnSync } = require('child_process');
const config = require('./config');
const { parseTwikitRows, handleFromProfileUrl } = require('./x-tweet-parse');
const crawl4aiFetch = require('./crawl4ai-fetch');

const impl = {
  runTwikit(handles) {
    if (!handles || handles.length === 0) return [];
    const script = path.join(__dirname, '../scripts/x-fetch-tweets.py');
    const py = config.X_PYTHON || 'python';
    const res = spawnSync(py, [script, ...handles], {
      encoding: 'utf8',
      timeout: 60000,
    });
    if (res.error || res.status !== 0) return [];
    try {
      const rows = JSON.parse(res.stdout);
      return Array.isArray(rows) ? rows : [];
    } catch { return []; }
  },

  crawl4aiFetch,

  /**
   * X 源抓取：twikit 主 → crawl4ai guest 兜底 → []。X 源不降级 Direct。
   */
  async fetchXSourceArticles(source) {
    if (config.X_TWIKIT_ENABLED) {
      const handle = handleFromProfileUrl(source.scrape_url);
      const rows = impl.runTwikit(handle ? [handle] : []);
      if (rows.length > 0) {
        const items = parseTwikitRows(source, rows);
        if (items.length > 0) {
          console.log(`  [Twikit] ${source.source_name}: ${items.length} 条`);
          return items;
        }
      }
      console.log(`  [Twikit] ${source.source_name} 无结果，回退 crawl4ai`);
    }
    try {
      const items = await impl.crawl4aiFetch.fetchSourceArticles(source);
      console.log(`  [Crawl4ai] ${source.source_name}: ${items.length} 条`);
      return items;
    } catch (err) {
      console.log(`  [X] ${source.source_name} crawl4ai 兜底失败: ${err.message}`);
      return [];
    }
  },
};

module.exports = impl;
```

- [ ] **Step 4: 运行测试确认通过** — `npm test`

- [ ] **Step 5: 提交**

```bash
git add src/x-fetch.js src/x-fetch.test.js
git commit -m "feat: X 源编排（twikit 主 + crawl4ai 兜底）"
```

---

### Task 5: search.js X 源路由 + config.js 凭证 + 正文跳过

**Files:**
- Modify: `src/search.js`（`fetchSourceWithFallback` 71-89 行）
- Modify: `src/config.js`（追加 X 配置）
- Modify: `src/index.js`（`feedArticleBodies` 跳过 X 状态链接正文抓取）

**Interfaces:**
- Consumes: `xFetch.fetchXSourceArticles`
- Produces: X 源在 `searchAll` 中走 x-fetch

- [ ] **Step 1: config.js 追加**

```js
  // X/Twitter 抓取（twikit 主 + crawl4ai 兜底）。凭证仅在 .env 提供。
  X_PYTHON: process.env.X_PYTHON || 'python',
  X_TWIKIT_ENABLED: process.env.X_TWIKIT_ENABLED !== '0',
  X_AUTH_TOKEN: process.env.X_AUTH_TOKEN || '',
  X_CT0: process.env.X_CT0 || '',
  X_USERNAME: process.env.X_USERNAME || '',
  X_PASSWORD: process.env.X_PASSWORD || '',
  X_COOKIES_FILE: process.env.X_COOKIES_FILE || '',
```

- [ ] **Step 2: search.js 路由**

```js
const xFetch = require('./x-fetch');
```

```js
// crawl4ai 优先；X 源走 x-fetch（twikit → crawl4ai 兜底）；非 X 源失败降级 Direct
async function fetchSourceWithFallback(source) {
  if (crawl4ai.isXUrl(source.scrape_url)) {
    return xFetch.fetchXSourceArticles(source);
  }
  try {
    const items = await crawl4ai.fetchSourceArticles(source);
    if (items.length === 0) throw new Error('crawl4ai 空结果');
    console.log(`  [Crawl4ai] ${source.source_name}: ${items.length} 篇`);
    return items;
  } catch (err) {
    console.log(`  [Crawl4ai] ${source.source_name} → 降级 Direct: ${err.message}`);
    try { return await fetchSource(source); } catch (e) {
      console.error(`  [Direct] ${source.source_name} 降级也失败: ${e.message}`);
      return [];
    }
  }
}
```

（删除原 X 分支的"跳过降级"逻辑，X 已改由 x-fetch 处理。）

- [ ] **Step 3: index.js 正文跳过**

`feedArticleBodies` 内加 X 状态链接跳过（推文正文已是内容，正文抓取 4-21s/篇太贵）：

```js
      const item = items[i];
      // 推文卡跳过正文抓取（正文即推文内容，且 X 页抓取昂贵）
      if (/(x\.com|twitter\.com)\/.+\/status\//.test(item.url || '')) {
        item.body = null;
        continue;
      }
```

- [ ] **Step 4: 语法 + 既有测试** — `node --check src/search.js && node --check src/config.js && node --check src/index.js && npm test`

- [ ] **Step 5: 提交**

```bash
git add src/search.js src/config.js src/index.js
git commit -m "feat: X 源路由走 x-fetch + X 凭证配置 + 推文卡跳过正文抓取"
```

---

### Task 6: Supabase 新增 Whitwell / Mitten 两个 T1 信源

**Files:**
- 数据变更（`keyword_sources` 表）

**Interfaces:**
- Consumes: MU 关键词 id
- Produces: `keyword_sources` 两行（tier=1、fetch_type='firecrawl'、rss_url=scrape_url 过 NOT NULL）

- [ ] **Step 1: 查 MU 关键词 id**

```sql
select id, name from keywords where name = 'Manchester United';
```

- [ ] **Step 2: INSERT 两行**

```sql
insert into keyword_sources (keyword_id, source_name, scrape_url, rss_url, tier, fetch_type, enabled)
values
  ('<MU_ID>', 'Laurie Whitwell (X)', 'https://x.com/lauriewhitwell', 'https://x.com/lauriewhitwell', 1, 'firecrawl', true),
  ('<MU_ID>', 'Andy Mitten (X)', 'https://x.com/AndyMitten', 'https://x.com/AndyMitten', 1, 'firecrawl', true);
```

（若 `(keyword_id, rss_url)` 唯一约束冲突：先 DELETE 同名旧行再 INSERT。）

- [ ] **Step 3: 验证**

```sql
select source_name, scrape_url, tier, enabled from keyword_sources
where keyword_id = '<MU_ID>' order by tier, source_name;
```

- [ ] **Step 4: 提交**（无代码；记录到 PROGRESS.md，随 Task 9）

---

### Task 7: `.env` 凭证 + 本机冒烟

**Files:**
- Modify: `.env`（gitignored，不提交）

- [ ] **Step 1: 用户提供凭证后写入 .env**

```
X_PYTHON=E:\claude\ai-news-monitor\.venv-x\Scripts\python.exe
X_AUTH_TOKEN=<你的 auth_token>
X_CT0=<你的 ct0>
# 或密码：X_USERNAME=xxx / X_PASSWORD=xxx
X_COOKIES_FILE=E:\claude\ai-news-monitor\cookies.json
```

> 凭证不放进对话/代码；用户直接编辑 `.env`。cookie（auth_token+ct0）优先于密码（密码登录可能撞 Cloudflare 验证码）。

- [ ] **Step 2: twikit 冒烟**

```bash
.venv-x/Scripts/python.exe scripts/x-fetch-tweets.py David_Ornstein
# 预期：stdout JSON 数组（含 text/status_id/created_at）
```

- [ ] **Step 3: 全链路冒烟（twikit 优先）**

```bash
node -e "require('./src/x-fetch').fetchXSourceArticles({scrape_url:'https://x.com/David_Ornstein',source_name:'David Ornstein (X)',tier:1}).then(r=>console.log(r.length, r.slice(0,2)))"
```

---

### Task 8: `npm run check` 全绿

- [ ] **Step 1** — `npm run check` → lint + type-check + `npm test` 全绿
- [ ] **Step 2** — 若有失败，修复后重跑

---

### Task 9: 端到端管线验证 + 文档联动

**Files:**
- Modify: `docs/REQ-曼联信源监控.md`（§5.4 白名单加两行，§6 X 模型更新）
- Modify: `CLAUDE.md`（X 通道描述、已知陷阱：twikit 主/crawl4ai 兜底、Python 依赖、凭证）
- Modify: `docs/PROGRESS.md`（进度条目）

- [ ] **Step 1: 跑一次管线**

```bash
npm run ops:run-auto
```

验证：日志出现 `[Twikit]` 或 `[Crawl4ai] <X源>: N 条`；`reports/2026-08-07.md` 含推文卡（若有曼联相关）；非曼联推文 score=0 不入库。

- [ ] **Step 2: 查库确认**

```sql
select source, title, url, score, published_at from articles
where source like '%(x)' and created_at > now() - interval '1 day' order by created_at desc;
```

- [ ] **Step 3: 文档更新**

- `docs/REQ-曼联信源监控.md` §5.4：加 Whitwell/Mitten 两行；§6：X 模型补"twikit 主通道 + crawl4ai 兜底"。
- `CLAUDE.md`：目录结构补 `x-fetch.js`/`x-tweet-parse.js`/`x-fetch-tweets.py`；已知陷阱补"X 抓取走 twikit（Python venv + twifork），失败回退 crawl4ai guest；凭证仅 .env；推文卡跳过正文抓取"。
- `docs/PROGRESS.md`：新功能条目 + 验收证据。

- [ ] **Step 4: 提交**

```bash
git add docs/REQ-曼联信源监控.md CLAUDE.md docs/PROGRESS.md
git commit -m "docs: X 记者链路实施完成 — REQ/CLAUDE/PROGRESS 同步"
```

---

## 验收对照（来自 spec §十二）

| 验收 | 对应任务 |
|---|---|
| 4 账号推文卡入库（含纯文字） | Task 1-5、9 |
| 别队消息仍被过滤（score<60） | 既有 analyze 评分链路（无需改） |
| Ornstein 当天曼联爆料次日 08:00 前出现在前端 | Task 7 凭证 + Task 9 验证 |
| 非 X 信源不受影响 | search.js 路由仅改 X 分支 |
| `npm run check` 全绿 | Task 8 |

---

## 实施偏差记录（相对 spec 的有意偏离）

1. **spec §5"推文收紧词根"→ 不实现**。理由：严格词根集（去掉 `united`/`man`）会误杀"United in talks to sign…"这类**不带 manchester/球员名的爆推文**，导致重新漏报——正是本次要修的 bug。保持现有宽松词根 + DeepSeek 评分收敛（别队消息 score<60 不入库），多花几毛成本换不漏。真正的正解是"上位实体判定层"（歧义交 AI 仲裁），已记入 `docs/FUTURE_IMPROVEMENTS.md`，本轮不做。
2. **spec §6"🔵 推文角标"→ 可选，未纳入**。现有来源徽章已带 "(X)"，足够区分；角标留待前端统一视觉时再做。
3. **spec §3.1"雪花 ID 解码"仅兜底路径需要**（twikit 主路径直接用 `created_at_datetime`），实现已覆盖两处。
4. **twifork 2.3.5 不可用 → 改用 `unclecode/twikit` git fork**。PyPI `twifork` 2.3.5 的 `get_indices` 仍是旧单段正则，对 X 2026-03 拆分后的 webpack 格式抛 `Couldn't get KEY_BYTE indices`（冒烟实测复现）。`pip install git+https://github.com/unclecode/twikit.git`（2.3.3，含 2026-05-17 两段式补丁）后 KEY_BYTE 通过。另：twikit 2.x 为 async API，脚本全改 await；需显式 `proxy=`（读 `X_PROXY`/`HTTP(S)_PROXY`）否则直连 x.com ConnectTimeout；Windows stdout `reconfigure(utf-8)` 防 emoji GBK 崩溃。
5. **发现并修复计划外缺口：X 推文被 `RESULT_LIMIT` 挤出**。E2E 实测 MU 源按 DB 顺序抓取、T2 媒体（Sky/ESPN/90min）排在 X 前，前 15 条分析预算被官方+ESPN 占满，X 推文（含 Whitwell/Mitten）整轮不落库，不满足验收 #1。修复（`3a24502`）：`src/search.js` 信源按 tier 升序 + 非 T0 源每源上限 `MAX_PER_SOURCE=5`；`src/config.js` `RESULT_LIMIT` 15→30。实测 Whitwell/Mitten/Stone 相关推文入库，Ornstein 别队消息 score 0 过滤。对应 spec §十二验收 #1。
