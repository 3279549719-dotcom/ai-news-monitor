# Email 每日摘要升级（T0/T1 精选 · 事件+中文摘要 HTML）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把每日摘要邮件从"标题+链接纯文本"升级为"只推 T0/T1 信源、每条含 AI 事件一句话 + 中文摘要【要点】【为什么重要】+ 彩色徽章的 HTML 卡片"。

**Architecture:** 过滤与渲染逻辑全部收敛在 `src/email.js`（纯函数，可单测），`sendDailyDigest` 内部先 `filterDigestSections`（T0/T1）再构建 text+html 双 part 发送；`src/index.js` 调用点零改动（sections 已带全字段）。板块分组复用 `keyword.category_schema`（与 `report.js` 一致），置信度标签复用 `crosscheck.CONFIDENCE_LABEL`。

**Tech Stack:** Node.js CommonJS · nodemailer · node:test

## Global Constraints

- 后端必须 CommonJS（`require` / `module.exports`），不引入 ES Module
- 过滤规则**仅一条**：`item.tier === 0 || item.tier === 1`（T0/T1 信源）；T2 及无 tier 一律不进邮件，但内容照常入库/进日报（邮件只是展示层过滤，不动 index.js 的数据流）
- 板块标签**必须**来自 `keyword.category_schema`（`{categoryKey: label}` 映射）；`category` 不在 schema 键内的项归「未分类」
- 置信度中文标签**必须**复用 `src/crosscheck.js` 导出的 `CONFIDENCE_LABEL = { high:'高置信', medium:'待核实', low:'存疑' }`，不得自造映射
- 邮件同时携带 `text` 与 `html` 两个 part（nodemailer 双格式；客户端不支持 HTML 时回退纯文本）
- 空结果照发：过滤后 total===0 时正文输出"今日无值得关注的新内容。"，subject 条数为 0
- 发送失败在 `sendDailyDigest` 内部吞掉，返回 `{sent:false, reason}`，绝不影响管线退出码
- `npm test` 用 `node --test "src/*.test.js"`（**禁止** `node --test src/`）
- 一次性预览脚本 `scripts/render-email-preview.js` 与 `docs/email-digest-preview.html` 为验收产物，实现完成后删除（不进版本控制）
- 只暂存本任务涉及的文件；`.env*`、node_modules、`docs/email-digest-preview.html` 不入库

---

### Task 1: isNotable 过滤 + filterDigestSections 纯函数

**Files:**
- Modify: `src/email.js`（新增两个导出）
- Test: `src/email.test.js`（新增 2 例）

**Interfaces:**
- Consumes: 无（纯函数，不依赖其他模块）
- Produces: `isNotable(item)`、`filterDigestSections(sections)` —— 后续 Task 4 的 `sendDailyDigest` 消费

- [ ] **Step 1: 写失败测试**

在 `src/email.test.js` 顶部 import 行追加 `isNotable, filterDigestSections`，并在文件末尾追加：

```js
test('isNotable：T0/T1 保留，T2/null 过滤', () => {
  assert.equal(isNotable({ tier: 0 }), true);
  assert.equal(isNotable({ tier: 1 }), true);
  assert.equal(isNotable({ tier: 2 }), false);
  assert.equal(isNotable({ tier: null }), false);
  assert.equal(isNotable(null), false);
});

test('filterDigestSections：保留 keyword 结构，只留 T0/T1', () => {
  const s = [{ keyword: { name: 'MU' }, results: [{ title: 'a', tier: 0 }, { title: 'b', tier: 2 }, { title: 'c' }] }];
  const out = filterDigestSections(s);
  assert.equal(out.length, 1);
  assert.equal(out[0].keyword.name, 'MU');
  assert.equal(out[0].results.length, 1);
  assert.equal(out[0].results[0].title, 'a');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test`
Expected: FAIL —— `isNotable is not defined`（尚未实现）

- [ ] **Step 3: 实现**

在 `src/email.js` 的 `formatDigestItem` 之前插入：

```js
// 过滤规则：只推 T0/T1 信源（官方 + 一线记者）。T2 媒体不进邮件，
// 但内容照常入库/进日报 —— 此处只是展示层过滤，不改数据流。
function isNotable(item) {
  return item != null && (item.tier === 0 || item.tier === 1);
}

/**
 * Filter sections to T0/T1 items only, preserving the per-keyword structure.
 * @param {Array<{keyword:Object, results:Array}>} sections
 * @returns {Array<{keyword:Object, results:Array}>}
 */
function filterDigestSections(sections) {
  return sections.map(s => ({ ...s, results: (s.results || []).filter(isNotable) }));
}
```

并在 `module.exports` 追加 `isNotable, filterDigestSections`。

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test`
Expected: PASS，新增 2 例通过，其余 68 例不受影响（本任务只加不改）

- [ ] **Step 5: 提交**

```bash
git add src/email.js src/email.test.js
git commit -m "feat(email): isNotable T0/T1 过滤 + filterDigestSections 纯函数"
```

---

### Task 2: 共享板块分组 + 纯文本版升级为事件+摘要

**Files:**
- Modify: `src/email.js`（新增 `groupByBoards` / `summaryBody`，重写 `buildDigestText` / `buildSubject`）
- Test: `src/email.test.js`（重写 5 例文本/主题测试）

**Interfaces:**
- Consumes: `isNotable`（Task 1）；`CONFIDENCE_LABEL`（`require('./crosscheck')`）
- Produces: `groupByBoards(keyword, results)`、`summaryBody(summary)`、升级版 `buildDigestText(sections)` / `buildSubject(sections)` —— Task 3 的 HTML 复用 `groupByBoards` / `summaryBody`

- [ ] **Step 1: 写失败测试（重写文本相关测试）**

删除 `src/email.test.js` 中旧的 5 例（`buildDigestText：按关键词分组…`、`buildDigestText：缺 score/tier 的项优雅降级`、`buildDigestText：空结果输出"今日无新增"文案`、`buildSubject：含日期与总条数`、`buildSubject：空结果条数为 0`），替换为：

```js
const FULL_SECTIONS = [
  {
    keyword: {
      name: 'MU',
      category_schema: { official: '官方公告', match: '赛事竞技资讯', other: '其他' },
    },
    results: [
      { title: 'Confirmed: United squad for PSG', url: 'https://www.manutd.com/a', score: 90, tier: 0, category: 'official', event: '曼联确认对阵巴黎圣日耳曼的阵容', summary: '【事件】曼联官方确认对阵巴黎圣日耳曼的出征名单。【要点】标题未列出具体球员姓名。【为什么重要】曼联球迷可据此了解欧冠关键战的阵容选择。', confidence: 'medium', corroboration_count: 1, conflict_flag: false },
      { title: 'Man Utd squad for PSG', url: 'https://x.com/ornstein/1', score: 80, tier: 1, category: 'match', event: '曼联公布对阵PSG大名单，多名主力回归', summary: '【事件】曼联公布明日对阵PSG大名单。【要点】1.蒂勒曼斯首次入选；2.外场青训球员仅剩5人。【为什么重要】球迷可据阵容判断对阵PSG的排兵布阵。', confidence: 'high', corroboration_count: 2, conflict_flag: true },
    ],
  },
  { keyword: { name: 'Dallas', category_schema: {} }, results: [] },
];

test('buildDigestText：关键词→板块分组，事件+摘要+徽章', () => {
  const text = buildDigestText(FULL_SECTIONS);
  assert.match(text, /【MU】\(2\)/);
  assert.match(text, /◆ 官方公告 \(1\)/);
  assert.match(text, /曼联确认对阵巴黎圣日耳曼的阵容/);
  assert.match(text, /T0 \| 待核实/); // medium → 待核实
  assert.match(text, /标题未列出具体球员姓名。/);
  assert.match(text, /◆ 赛事竞技资讯 \(1\)/);
  assert.match(text, /T1 \| 高置信 \| 2源印证 \| ⚠️冲突/);
  assert.match(text, /蒂勒曼斯首次入选/);
  assert.doesNotMatch(text, /【Dallas】/); // 空结果组不渲染
});

test('buildDigestText：summary 去掉【事件】段避免与加粗行重复', () => {
  const text = buildDigestText(FULL_SECTIONS);
  assert.doesNotMatch(text, /【事件】曼联官方确认对阵巴黎圣日耳曼的出征名单。/);
});

test('buildDigestText：category 不在 schema 归「未分类」', () => {
  const s = [{ keyword: { name: 'MU', category_schema: { official: '官方公告' } }, results: [{ title: 'x', url: 'https://x', tier: 0, category: 'unknown', event: '未知分类事件', summary: '【要点】要点内容。' }] }];
  const text = buildDigestText(s);
  assert.match(text, /◆ 未分类 \(1\)/);
});

test('buildDigestText：空结果输出"今日无值得关注"', () => {
  const text = buildDigestText([]);
  assert.match(text, /今日 0 件值得关注/);
  assert.match(text, /今日无值得关注的新内容。/);
});

test('buildSubject：含日期与精选条数', () => {
  assert.match(buildSubject(FULL_SECTIONS), /每日摘要 · 精选 2 条/);
  assert.match(buildSubject(FULL_SECTIONS), /20\d\d-\d\d-\d\d/);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test`
Expected: FAIL（新断言对旧格式不匹配 / `groupByBoards` 未定义）

- [ ] **Step 3: 实现**

在 `src/email.js`：

顶部 `const config = require('./config');` 之后加一行 `const { CONFIDENCE_LABEL } = require('./crosscheck');`

把 `formatDigestItem` 替换为两个共享辅助 + 升级版文本构建器：

```js
/**
 * Group a keyword's results into category boards using its category_schema
 * (same source of truth as report.js). Items whose category is not a schema
 * key fall into a trailing「未分类」board. Only non-empty boards returned.
 * @param {Object} keyword - keyword row (uses keyword.category_schema)
 * @param {Array} results - filtered items
 * @returns {Array<{key:string,label:string,items:Array}>}
 */
function groupByBoards(keyword, results) {
  const schema = (keyword && keyword.category_schema) || {};
  const boards = Object.entries(schema).map(([key, label]) => ({ key, label, items: [] }));
  boards.push({ key: '__uncat', label: '未分类', items: [] });
  for (const item of results) {
    const board = boards.find(b => b.key === item.category) || boards[boards.length - 1];
    board.items.push(item);
  }
  return boards.filter(b => b.items.length > 0);
}

// summary 去掉【事件】段（该内容已由 event 加粗行呈现），保留【要点】【为什么重要】
function summaryBody(summary) {
  if (!summary) return '';
  const m = summary.match(/^【事件】[^。]*。?\s*/);
  return m ? summary.slice(m[0].length) : summary;
}

function textMeta(item) {
  const meta = [];
  if (item.tier != null) meta.push(`T${item.tier}`);
  if (item.confidence) meta.push(CONFIDENCE_LABEL[item.confidence] || item.confidence);
  if ((item.corroboration_count || 0) >= 2) meta.push(`${item.corroboration_count}源印证`);
  if (item.conflict_flag) meta.push('⚠️冲突');
  return meta.join(' | ');
}

function buildDigestText(sections) {
  const total = sections.reduce((n, s) => n + s.results.length, 0);
  const lines = [
    `AI News Monitor 每日摘要 — ${todayIso()}`,
    `今日 ${total} 件值得关注（T0/T1 信源）`,
    '',
  ];
  for (const { keyword, results } of sections) {
    if (results.length === 0) continue;
    lines.push(`【${keyword.name}】(${results.length})`, '');
    for (const board of groupByBoards(keyword, results)) {
      lines.push(`◆ ${board.label} (${board.items.length})`, '');
      for (const item of board.items) {
        const title = item.event || item.title;
        lines.push(`- ${title}  ${textMeta(item)}`);
        const body = summaryBody(item.summary);
        if (body) lines.push(`  ${body}`);
        lines.push(`  ${item.url}`, '');
      }
    }
  }
  if (total === 0) lines.push('今日无值得关注的新内容。', '');
  return lines.join('\n');
}

function buildSubject(sections) {
  const total = sections.reduce((n, s) => n + s.results.length, 0);
  return `【AI News Monitor】${todayIso()} 每日摘要 · 精选 ${total} 条`;
}
```

删除旧 `buildDigestText`、旧 `buildSubject`、旧 `formatDigestItem`、旧 `tierLabel`（若不再被引用）。保留 `escapeHtml`（Task 3 用）。

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test`
Expected: PASS，5 例新文本/主题测试通过

- [ ] **Step 5: 提交**

```bash
git add src/email.js src/email.test.js
git commit -m "feat(email): 纯文本摘要升级为关键词→板块分组的事件+中文摘要版"
```

---

### Task 3: HTML 卡片版构建器（可扫读）

**Files:**
- Modify: `src/email.js`（新增 `hostOf`，重写 `buildDigestHtml`）
- Test: `src/email.test.js`（重写 4 例 HTML 测试）

**Interfaces:**
- Consumes: `groupByBoards` / `summaryBody`（Task 2）、`CONFIDENCE_LABEL`（已引入）
- Produces: 升级版 `buildDigestHtml(sections)` —— Task 4 的 `sendDailyDigest` 消费

- [ ] **Step 1: 写失败测试（重写 HTML 相关测试）**

删除 `src/email.test.js` 中旧的 4 例 HTML 测试（`buildDigestHtml：按关键词分组渲染标题链接与 tier/score`、`buildDigestHtml：标题特殊字符被转义`、`buildDigestHtml：缺 tier/score 不渲染 meta 行`、`buildDigestHtml：空结果输出"今日无新增"`），替换为：

```js
test('buildDigestHtml：头部卡片 + 板块分组 + 事件粗体 + 徽章', () => {
  const html = buildDigestHtml(FULL_SECTIONS);
  assert.match(html, /今日 <b style="color:#60a5fa;">2<\/b> 件值得关注/);
  assert.match(html, />MU <span/);
  assert.match(html, /◆ 官方公告/);
  assert.match(html, /曼联确认对阵巴黎圣日耳曼的阵容/);
  assert.match(html, /T0<\/span>/);
  assert.match(html, />待核实<\/span>/);
  assert.match(html, /标题未列出具体球员姓名。/);
  assert.match(html, />2源印证<\/span>/);
  assert.match(html, /⚠️ 冲突<\/span>/);
  assert.match(html, /href="https:\/\/www\.manutd\.com\/a"/);
  assert.doesNotMatch(html, /Dallas/); // 空结果组不渲染
});

test('buildDigestHtml：标题/URL 转义，block 内不出现【事件】段', () => {
  const s = [{ keyword: { name: 'A&B', category_schema: {} }, results: [{ title: '<script>', url: 'https://x.com/?a=1&b=2', tier: 0, event: 'E<&', summary: '【事件】E。【要点】P1。' }] }];
  const html = buildDigestHtml(s);
  assert.match(html, /A&amp;B/);
  assert.match(html, /https:\/\/x\.com\/\?a=1&amp;b=2/);
  assert.match(html, /E&lt;&amp;/);
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /【事件】/);
});

test('buildDigestHtml：event/summary 缺失优雅降级为 title', () => {
  const s = [{ keyword: { name: 'MU', category_schema: {} }, results: [{ title: '只有标题', url: 'https://x.com', tier: 1 }] }];
  const html = buildDigestHtml(s);
  assert.match(html, /只有标题/);
  assert.doesNotMatch(html, /undefined/);
});

test('buildDigestHtml：空结果输出"今日无值得关注"', () => {
  const html = buildDigestHtml([]);
  assert.match(html, /今日 <b style="color:#60a5fa;">0<\/b> 件值得关注/);
  assert.match(html, /今日无值得关注的新内容。/);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test`
Expected: FAIL（新断言对旧卡片格式不匹配）

- [ ] **Step 3: 实现**

在 `src/email.js` 中，把旧的 `buildDigestHtml`（含 `escapeHtml`）替换为：

```js
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function hostOf(url) {
  try {
    return String(url).replace(/^https?:\/\//, '').replace(/^www\./, '');
  } catch {
    return url;
  }
}

// 彩色徽章：Tier（蓝）/ 置信度（黄）/ 多源印证（绿）/ 冲突（红）
function badgeHtml(item) {
  const b = [];
  if (item.tier != null) b.push(`<span style="display:inline-block;background:#eef2ff;color:#3730a3;border-radius:999px;padding:0 8px;margin-right:6px;font-size:11px;">T${item.tier}</span>`);
  if (item.confidence) b.push(`<span style="display:inline-block;background:#fef3c7;color:#92400e;border-radius:999px;padding:0 8px;margin-right:6px;font-size:11px;">${escapeHtml(CONFIDENCE_LABEL[item.confidence] || item.confidence)}</span>`);
  if ((item.corroboration_count || 0) >= 2) b.push(`<span style="display:inline-block;background:#dcfce7;color:#166534;border-radius:999px;padding:0 8px;margin-right:6px;font-size:11px;">${item.corroboration_count}源印证</span>`);
  if (item.conflict_flag) b.push(`<span style="display:inline-block;background:#fee2e2;color:#991b1b;border-radius:999px;padding:0 8px;margin-right:6px;font-size:11px;">⚠️ 冲突</span>`);
  return b.join('');
}

/**
 * Build a lightweight HTML digest: dark header card + per-keyword boards with
 * event-bold cards. Inline styles only (email clients strip <style>/external
 * CSS). Sent alongside the text part; clients render whichever they support.
 */
function buildDigestHtml(sections) {
  const total = sections.reduce((n, s) => n + s.results.length, 0);
  const parts = [
    `<div style="font-family:-apple-system,'Segoe UI','Microsoft YaHei',sans-serif;max-width:680px;margin:0 auto;color:#111827;padding:24px 16px;">`,
    `<div style="background:#111827;color:#fff;border-radius:12px;padding:20px 24px;">`,
    `<div style="font-size:12px;letter-spacing:1px;opacity:.65;">AI NEWS MONITOR · 每日摘要</div>`,
    `<div style="font-size:22px;font-weight:600;margin-top:4px;">${todayIso()}</div>`,
    `<div style="margin-top:10px;font-size:14px;opacity:.9;">今日 <b style="color:#60a5fa;">${total}</b> 件值得关注（T0/T1 信源）</div>`,
    `</div>`,
  ];
  for (const { keyword, results } of sections) {
    if (results.length === 0) continue;
    parts.push(`<h3 style="margin:24px 0 4px;font-size:16px;color:#111827;">${escapeHtml(keyword.name)} <span style="color:#9ca3af;font-weight:normal;font-size:13px;">(${results.length})</span></h3>`);
    for (const board of groupByBoards(keyword, results)) {
      parts.push(`<div style="margin-top:14px;font-size:13px;font-weight:600;color:#2563eb;">◆ ${escapeHtml(board.label)} <span style="color:#9ca3af;font-weight:normal;">(${board.items.length})</span></div>`);
      for (const item of board.items) {
        const title = item.event || item.title;
        const body = summaryBody(item.summary);
        parts.push(
          `<div style="margin:10px 0 0;padding:12px 14px;background:#fff;border-radius:10px;border:1px solid #eef0f3;">` +
          `<div style="font-size:14px;font-weight:600;color:#111827;">${escapeHtml(title)}</div>` +
          `<div style="margin-top:6px;">${badgeHtml(item)}</div>` +
          (body ? `<div style="margin-top:8px;font-size:13px;color:#374151;line-height:1.6;">${escapeHtml(body)}</div>` : '') +
          `<a href="${escapeHtml(item.url)}" style="display:inline-block;margin-top:8px;font-size:12px;color:#9ca3af;text-decoration:none;">${escapeHtml(hostOf(item.url))} ↗</a>` +
          `</div>`
        );
      }
    }
  }
  if (total === 0) parts.push(`<p style="color:#6b7280;font-size:13px;">今日无值得关注的新内容。</p>`);
  parts.push(`</div>`);
  return parts.join('\n');
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test`
Expected: PASS，4 例 HTML 测试通过

- [ ] **Step 5: 提交**

```bash
git add src/email.js src/email.test.js
git commit -m "feat(email): HTML 卡片版摘要（头部统计+板块分组+事件粗体+彩色徽章）"
```

---

### Task 4: sendDailyDigest 内部过滤 + 手动重发脚本补全字段

**Files:**
- Modify: `src/email.js`（重写 `sendDailyDigest`）
- Modify: `scripts/send-html-digest-now.js`（补全查询字段 + 传 keyword.category_schema）
- Test: `src/email.test.js`（新增 2 例 send 层测试）

**Interfaces:**
- Consumes: `filterDigestSections`（Task 1）、`buildSubject`/`buildDigestText`/`buildDigestHtml`（Task 2/3）
- Produces: 过滤后的 `sendDailyDigest`；更新版手动重发脚本

- [ ] **Step 1: 写失败测试**

在 `src/email.test.js` 末尾追加：

```js
test('sendDailyDigest：内部先过滤 T0/T1，sender 收到的条数已过滤', async () => {
  const sections = [
    { keyword: { name: 'MU' }, results: [
      { title: 'keep', url: 'https://a', tier: 0, event: '保留事件' },
      { title: 'drop', url: 'https://b', tier: 2, event: '丢弃事件' },
    ] },
  ];
  let received;
  const res = await sendDailyDigest(sections, { sender: async m => { received = m; return { sent: true }; } });
  assert.equal(res.sent, true);
  assert.match(received.text, /保留事件/);
  assert.doesNotMatch(received.text, /丢弃事件/);
  assert.doesNotMatch(received.html, /丢弃事件/);
  assert.match(received.subject, /精选 1 条/);
});

test('sendDailyDigest：全部过滤后仍发空摘要', async () => {
  const sections = [{ keyword: { name: 'MU' }, results: [{ title: 'drop', url: 'https://b', tier: 2 }] }];
  let received;
  await sendDailyDigest(sections, { sender: async m => { received = m; return { sent: true }; } });
  assert.match(received.text, /今日无值得关注的新内容。/);
  assert.match(received.subject, /精选 0 条/);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test`
Expected: FAIL（sendDailyDigest 尚未过滤，`精选 1 条` 不匹配）

- [ ] **Step 3: 实现 sendDailyDigest**

把 `src/email.js` 的 `sendDailyDigest` 替换为：

```js
async function sendDailyDigest(sections, opts = {}) {
  try {
    const filtered = filterDigestSections(sections);
    const subject = buildSubject(filtered);
    const text = buildDigestText(filtered);
    const html = buildDigestHtml(filtered);
    if (opts.sender) return await opts.sender({ subject, text, html });
    return await sendEmail({ subject, text, html }, opts);
  } catch (err) {
    return { sent: false, reason: err.message };
  }
}
```

`sendEmail` 保持不变（已支持 `{subject, text, html}`）。

- [ ] **Step 4: 更新手动重发脚本**

把 `scripts/send-html-digest-now.js` 的查询 select 改为全字段，sections 的 keyword 传完整行（带 category_schema）：

```js
const { data, error } = await getClient()
  .from('articles')
  .select('keyword_id, title, url, score, source_tier, category, event, event_type, summary, confidence, corroboration_count, conflict_flag, created_at')
  .gte('created_at', cutoff)
  .gte('score', 60)
  .order('created_at', { ascending: false });
```

并把 sections 构造改为：

```js
const sections = keywords.map(kw => ({
  keyword: kw, // 完整行：含 name + category_schema（板块分组依赖它）
  results: rows.filter(r => r.keyword_id === kw.id)
    .map(r => ({ title: r.title, url: r.url, score: r.score, tier: r.source_tier, category: r.category, event: r.event, event_type: r.event_type, summary: r.summary, confidence: r.confidence, corroboration_count: r.corroboration_count, conflict_flag: r.conflict_flag })),
}));
```

其余（isNotable 打印、sendDailyDigest 调用）保持不变。脚本中若定义了本地 `isNotable`，改为 `const { isNotable } = require('../src/email');` 复用单一实现。

- [ ] **Step 5: 跑测试确认通过**

Run: `npm test`
Expected: PASS，2 例新增 send 层测试通过

- [ ] **Step 6: 提交**

```bash
git add src/email.js src/email.test.js scripts/send-html-digest-now.js
git commit -m "feat(email): sendDailyDigest 内部 T0/T1 过滤 + 手动重发脚本补全字段"
```

---

### Task 5: 真实发信冒烟 + 清理预览产物

**Files:**
- Delete: `scripts/render-email-preview.js`
- Delete: `docs/email-digest-preview.html`
- 验证用，无代码改动

**Interfaces:**
- Consumes: Task 4 的 `scripts/send-html-digest-now.js`（已带全字段）

- [ ] **Step 1: 跑全量检查**

Run: `npm run check`
Expected: exit 0（lint + type-check + 68→N 例测试全绿）

- [ ] **Step 2: 真实发信冒烟**

Run: `node scripts/send-html-digest-now.js 3`
Expected:
- 脚本退出码 0，打印「近 3 天相关文章 M 条，发送 HTML 摘要邮件…」（send-html-digest-now.js 自身日志；不要求输出过滤统计）
- 打印「已发送: 【AI News Monitor】2026-08-08 每日摘要 · 精选 N 条」
- 收件箱收到一封 HTML 卡片邮件（深色头部 + 关键词→板块 + 事件粗体 + 徽章），且正文只含 T0/T1 事件
- **确认 `.env` 未被改动/输出**（grep 发件日志无授权码明文）

- [ ] **Step 3: 删除一次性预览产物**

两个预览产物从未入库（untracked），直接用 `rm -f`（勿用 `git rm`——对未跟踪文件会报 `pathspec did not match`）：

```bash
rm -f scripts/render-email-preview.js docs/email-digest-preview.html
```

- [ ] **Step 4: 确认工作区无残留**

删除后运行 `git status`：预览产物不应再出现；本任务无新提交（预览产物不进版本控制，删除不产生 git 变更）。若 Task 4 之后还有未提交变更，仅当属于本 feature 时才在收尾时一并提交。

---

### Task 6: 文档同步

**Files:**
- Modify: `docs/superpowers/specs/2026-08-08-email-digest-design.md`
- Modify: `docs/PROGRESS.md`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: Task 1-5 的最终行为

- [ ] **Step 1: 更新设计 spec**

在 `docs/superpowers/specs/2026-08-08-email-digest-design.md`：
- 第 1 节「明确不做」中删除「HTML 富文本邮件模板（选的是纯文本精简列表）」，改为确认反转为做 HTML 卡片
- 第 4 节「邮件格式」改为：过滤规则（T0/T1）、HTML 卡片结构（深色头部+关键词→板块+事件粗体+徽章+域名链接）、text/html 双 part、空结果文案「今日无值得关注的新内容。」
- 补一节「验收决定（2026-08-08 v2）」：用户确认只推 T0/T1、事件+中文摘要为主体、可扫读卡片、板块标签用 category_schema、置信度标签用 CONFIDENCE_LABEL

- [ ] **Step 2: 更新 PROGRESS.md**

新增一行 F-018：邮件升级 T0/T1 精选 · 事件+中文摘要 HTML 卡片（过滤/分组/双格式/冒烟已验），标注 commit。

- [ ] **Step 3: 更新 CLAUDE.md**

目录结构 `email.js` 行改为：
```
email.js         每日摘要邮件（SMTP，run() 末尾无条件发送；只推 T0/T1 信源，HTML+纯文本双格式，事件+中文摘要+徽章；发送失败不影响管线退出码）
```

- [ ] **Step 4: 全量检查 + 提交**

Run: `npm run check`
Expected: exit 0

```bash
git add docs/superpowers/specs/2026-08-08-email-digest-design.md docs/PROGRESS.md CLAUDE.md
git commit -m "docs(email): v2 设计定稿（T0/T1 精选 + HTML 卡片）+ PROGRESS F-018 + CLAUDE 同步"
```

---

## Self-Review

**1. Spec coverage（对照已确认设计）：**
- 只推 T0/T1 → Task 1 `isNotable` + Task 4 `sendDailyDigest` 过滤 ✅
- 每条事件粗体 + 中文摘要【要点】【为什么重要】→ Task 2/3 `item.event || item.title` + `summaryBody` ✅
- 彩色徽章（tier/置信度/印证/冲突）→ Task 2 `textMeta` + Task 3 `badgeHtml` ✅
- 外层关键词内层板块 → Task 2/3 `groupByBoards`（category_schema）✅
- HTML + 纯文本双格式 → Task 3 `buildDigestHtml` + Task 2 `buildDigestText`，Task 4 双 part ✅
- 管线 run() 末尾无条件发 → index.js 零改动（sections 已带全字段）✅
- 空结果照发 → Task 2/3/4 的 total===0 分支 ✅
- 删除一次性预览产物 → Task 5 ✅

**2. Placeholder 扫描：** 无 TBD/TODO；每个代码块含完整实现 ✅

**3. 类型一致性：**
- `buildDigestSections` 在 Task 1 命名，但后续统一用 `filterDigestSections`（Task 1 实现、Task 4 消费）——Task 1 测试断言里已用 `filterDigestSections`，一致 ✅
- `groupByBoards(keyword, results)` 返回 `{key,label,items}[]`，Task 2/3 一致消费 ✅
- `CONFIDENCE_LABEL` 统一从 crosscheck 引入，文本/HTML 共用 ✅
- `sendDailyDigest(sections, opts)` 签名不变，index.js 调用点无需改 ✅
