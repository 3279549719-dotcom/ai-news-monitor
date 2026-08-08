# Email 每日摘要通知 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 管线每次跑完后，通过 SMTP 把当天新增内容以精简列表邮件推送给用户；当天无新内容也照发（含"今日无新增"文案）。

**Architecture:** 方案 A「管线内直发」。新增 `src/email.js`（纯文本正文/主题构建 + nodemailer 发送层），在 `src/index.js` 的 `run()` 末尾无条件调用 `sendDailyDigest(sections)`。报告文件语义不变（有内容才写 `reports/*.md`），邮件无条件发。发送失败内部吞掉，绝不影响管线退出码。

**Tech Stack:** Node.js CommonJS、`nodemailer`（新依赖）、`node:test`（单测）、SMTP 走 `.env`（QQ/163 授权码）。

## Global Constraints

- 后端只用 CommonJS（`require` / `module.exports`），不引入 ES Module
- `npm test` = `node --test "src/*.test.js"`（**禁止** `node --test src/`，会误触发真实管线）
- 单测风格：`node:test` + `assert/strict`，测试名用中文（见 `src/dates.test.js`）
- `.env` 键名已配好，**以此为准**：`SMTP_HOST` `SMTP_PORT` `SMTP_SECURE` `EMAIL_USER`（发件人/SMTP 用户名）`EMAIL_AUTH_CODE`（授权码）`RECEIVER_EMAIL`（收件人，逗号分隔可多收件人）。`EMAIL_ENABLED` 可选，缺省即启用，设 `0` 禁用
- 邮件是 best-effort 通知：任何发送失败都不得改变管线退出码
- 空结果也要发邮件（`buildDigestText` 输出"今日无新增关注内容。"）
- 报告文件 `reports/YYYY-MM-DD.md` 仅在 `hasResults` 时生成，语义不变
- 提交只暂存本次任务涉及的文件；`.env*`、node_modules 永不入库
- 项目 B1 hook（`scripts/harness-pretooluse.js`）会拦 `node --test src` 等 footgun——照计划写，不要触发

---

### Task 1: 安装 nodemailer 依赖

**Files:**
- Modify: `package.json`（由 npm 自动）+ `package-lock.json`

**Interfaces:**
- Produces: `nodemailer` 出现在 `dependencies`，后续 Task 3 惰性 `require('nodemailer')` 可解析

- [ ] **Step 1: 安装依赖**

```bash
cd /e/claude/ai-news-monitor && npm install nodemailer
```

Expected: npm 正常退出，`package.json` `dependencies` 出现 `"nodemailer": "^6.x"`。

- [ ] **Step 2: 验证依赖可解析 + 回归**

```bash
node -e "require('nodemailer'); console.log('nodemailer ok')"
npm test
```

Expected: 输出 `nodemailer ok`；`npm test` 现有用例全绿。

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: 新增 nodemailer 依赖（每日摘要邮件发送）"
```

---

### Task 2: email.js 纯函数层（正文/主题构建）+ 单测

**Files:**
- Create: `src/email.js`
- Test: `src/email.test.js`

**Interfaces:**
- Produces（后续 Task 3 扩展同模块、Task 4 消费）:
  - `buildDigestText(sections) → string`（纯文本正文，含空结果文案）
  - `buildSubject(sections) → string`（邮件主题，含日期 + 条数）
  - `sections` 形状：`Array<{ keyword: {name:string}, results: Array<{title:string, url:string, score?:number, tier?:number}> }>`（与 `src/report.js` 消费的同一形状）

- [ ] **Step 1: 写失败测试**

创建 `src/email.test.js`：

```js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildDigestText, buildSubject } = require('./email');

const SECTIONS = [
  {
    keyword: { name: 'MU - 曼联信源监控' },
    results: [
      { title: 'Man Utd 官宣续约', url: 'https://www.manutd.com/a', score: 90, tier: 0 },
      { title: 'Ornstein 转会消息', url: 'https://x.com/ornstein/1', score: 80, tier: 1 },
    ],
  },
  { keyword: { name: 'Anthropic' }, results: [] },
  {
    keyword: { name: 'Dallas' },
    results: [{ title: '无评分无 tier 项', url: 'https://nba.com/mavs/2' }],
  },
];

test('buildDigestText：按关键词分组，跳过空结果组', () => {
  const text = buildDigestText(SECTIONS);
  assert.match(text, /【MU - 曼联信源监控】\(2\)/);
  assert.match(text, /\[T0\] Man Utd 官宣续约 \(90分\)/);
  assert.match(text, /https:\/\/www\.manutd\.com\/a/);
  assert.match(text, /\[T1\] Ornstein 转会消息 \(80分\)/);
  assert.doesNotMatch(text, /【Anthropic】/); // 空结果组不渲染
  assert.match(text, /【Dallas】\(1\)/);
});

test('buildDigestText：缺 score/tier 的项优雅降级', () => {
  const text = buildDigestText(SECTIONS);
  assert.match(text, /无评分无 tier 项/);
  assert.doesNotMatch(text, /\(undefined分\)/);
  assert.doesNotMatch(text, /\[Tundefined\]/);
});

test('buildDigestText：空结果输出“今日无新增”文案', () => {
  const text = buildDigestText([]);
  assert.match(text, /相关新内容 0 条/);
  assert.match(text, /今日无新增关注内容。/);
});

test('buildSubject：含日期与总条数', () => {
  const subject = buildSubject(SECTIONS);
  assert.match(subject, /每日摘要 · 相关 3 条/);
  assert.match(subject, /20\d\d-\d\d-\d\d/);
});

test('buildSubject：空结果条数为 0', () => {
  assert.match(buildSubject([]), /相关 0 条/);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test`
Expected: FAIL——`Cannot find module './email'`。

- [ ] **Step 3: 写最小实现**

创建 `src/email.js`：

```js
'use strict';

/**
 * Daily digest email module.
 *
 * Builds a plain-text concise digest (grouped by keyword) from the pipeline's
 * per-keyword result sections and sends it via SMTP after each run. The pure
 * text builders live here so they are unit-testable without touching the
 * network; the send layer (isEmailConfigured / sendEmail / sendDailyDigest)
 * is added in the next task.
 */

function todayIso() {
  return new Date().toISOString().split('T')[0];
}

function tierLabel(tier) {
  if (tier == null) return '';
  return `[T${tier}] `;
}

function formatDigestItem(item) {
  const tier = tierLabel(item.tier);
  const score = item.score != null ? ` (${item.score}分)` : '';
  return `${tier}${item.title}${score}\n  ${item.url}`;
}

function buildDigestText(sections) {
  const total = sections.reduce((n, s) => n + s.results.length, 0);
  const lines = [
    `AI News Monitor 每日摘要 — ${todayIso()}`,
    `相关新内容 ${total} 条`,
    '',
  ];
  for (const { keyword, results } of sections) {
    if (!results || results.length === 0) continue;
    lines.push(`【${keyword.name}】(${results.length})`, '');
    for (const item of results) lines.push(formatDigestItem(item), '');
  }
  if (total === 0) lines.push('今日无新增关注内容。', '');
  return lines.join('\n');
}

function buildSubject(sections) {
  const total = sections.reduce((n, s) => n + s.results.length, 0);
  return `【AI News Monitor】${todayIso()} 每日摘要 · 相关 ${total} 条`;
}

module.exports = { buildDigestText, buildSubject };
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test`
Expected: 新增 5 例 PASS，现有用例不回归。

- [ ] **Step 5: Commit**

```bash
git add src/email.js src/email.test.js
git commit -m "feat: 每日摘要邮件正文/主题纯函数 + 单测"
```

---

### Task 3: email.js 发送层 + config.js SMTP 配置

**Files:**
- Modify: `src/config.js`（末尾加 SMTP 配置组）
- Modify: `src/email.js`（加 `isEmailConfigured` / `sendEmail` / `sendDailyDigest`，顶部 `require('./config')`，扩展 exports）
- Test: `src/email.test.js`（追加发送层用例）

**Interfaces:**
- Consumes: Task 1 的 `nodemailer`；`config.js` 新增字段 `EMAIL_ENABLED/SMTP_HOST/SMTP_PORT/SMTP_SECURE/EMAIL_USER/EMAIL_AUTH_CODE/RECEIVER_EMAIL`
- Produces（Task 4 消费）:
  - `sendDailyDigest(sections, opts?) → Promise<{sent:boolean, reason?:string, subject?:string}>`；`opts.config` 供测试注入假配置、`opts.sender` 供测试注入假发送器。**永不 reject**（内部 try/catch）
  - `isEmailConfigured(cfg?) → boolean`（纯判定）
  - `sendEmail({subject, text}, opts?) → Promise<{sent:boolean, reason?:string, subject?:string}>`

- [ ] **Step 1: 写失败测试**

向 `src/email.test.js` 追加（顶部 import 改为 `{ buildDigestText, buildSubject, isEmailConfigured, sendEmail, sendDailyDigest }`）：

```js
const { buildDigestText, buildSubject, isEmailConfigured, sendDailyDigest } = require('./email');

const FULL_CFG = { EMAIL_ENABLED: true, SMTP_HOST: 'smtp.qq.com', EMAIL_USER: 'a@qq.com', EMAIL_AUTH_CODE: 'x', RECEIVER_EMAIL: 'b@qq.com' };

test('isEmailConfigured：配置齐则启用', () => {
  assert.equal(isEmailConfigured(FULL_CFG), true);
});

test('isEmailConfigured：缺 SMTP_HOST 不启用', () => {
  assert.equal(isEmailConfigured({ ...FULL_CFG, SMTP_HOST: '' }), false);
});

test('isEmailConfigured：EMAIL_ENABLED=false 不启用', () => {
  assert.equal(isEmailConfigured({ ...FULL_CFG, EMAIL_ENABLED: false }), false);
});

test('sendDailyDigest：未配置返回 {sent:false} 且不抛错', async () => {
  const noCfg = { EMAIL_ENABLED: true, SMTP_HOST: '', EMAIL_USER: '', EMAIL_AUTH_CODE: '', RECEIVER_EMAIL: '' };
  const res = await sendDailyDigest([], { config: noCfg });
  assert.equal(res.sent, false);
  assert.match(res.reason, /未配置/);
});

test('sendDailyDigest：sender 抛异常被吞并返回 {sent:false}', async () => {
  const res = await sendDailyDigest([], { sender: async () => { throw new Error('boom'); } });
  assert.equal(res.sent, false);
  assert.equal(res.reason, 'boom');
});

test('sendDailyDigest：sender 成功透传 subject', async () => {
  const sections = [{ keyword: { name: 'MU' }, results: [{ title: 'x', url: 'https://x', score: 90, tier: 0 }] }];
  const res = await sendDailyDigest(sections, { sender: async ({ subject }) => ({ sent: true, subject }) });
  assert.equal(res.sent, true);
  assert.match(res.subject, /每日摘要/);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test`
Expected: FAIL——`isEmailConfigured is not a function`（模块尚未导出）。

- [ ] **Step 3: 写最小实现**

`src/config.js` 模块导出对象末尾（`SUPABASE_SERVICE_KEY` 之后）追加：

```js
  // Email digest SMTP（管线 run() 末尾推送每日摘要）。EMAIL_AUTH_CODE 用
  // QQ/163 的 SMTP 授权码（非登录密码）。EMAIL_ENABLED=0 可禁用（测试用）。
  EMAIL_ENABLED: process.env.EMAIL_ENABLED !== '0',
  SMTP_HOST: process.env.SMTP_HOST || '',
  SMTP_PORT: Number(process.env.SMTP_PORT) || 465,
  SMTP_SECURE: process.env.SMTP_SECURE !== '0' && process.env.SMTP_SECURE !== 'false',
  EMAIL_USER: process.env.EMAIL_USER || '',
  EMAIL_AUTH_CODE: process.env.EMAIL_AUTH_CODE || '',
  RECEIVER_EMAIL: process.env.RECEIVER_EMAIL || '',
```

`src/email.js`：顶部加 `const config = require('./config');`，在 `buildSubject` 之后、`module.exports` 之前加：

```js
function isEmailConfigured(cfg = config) {
  return Boolean(cfg.EMAIL_ENABLED && cfg.SMTP_HOST && cfg.EMAIL_USER && cfg.EMAIL_AUTH_CODE && cfg.RECEIVER_EMAIL);
}

async function sendEmail({ subject, text }, opts = {}) {
  const cfg = opts.config || config;
  if (!isEmailConfigured(cfg)) return { sent: false, reason: 'SMTP 未配置或未启用' };
  // 惰性 require：纯函数单测路径不加载 nodemailer
  const nodemailer = require('nodemailer');
  const transport = nodemailer.createTransport({
    host: cfg.SMTP_HOST,
    port: cfg.SMTP_PORT,
    secure: cfg.SMTP_SECURE,
    auth: { user: cfg.EMAIL_USER, pass: cfg.EMAIL_AUTH_CODE },
    connectionTimeout: 15000,
    socketTimeout: 20000,
  });
  try {
    await transport.sendMail({
      from: `AI News Monitor <${cfg.EMAIL_USER}>`,
      to: cfg.RECEIVER_EMAIL,
      subject,
      text,
    });
    return { sent: true, subject };
  } finally {
    transport.close();
  }
}

async function sendDailyDigest(sections, opts = {}) {
  try {
    const subject = buildSubject(sections);
    const text = buildDigestText(sections);
    if (opts.sender) return await opts.sender({ subject, text });
    return await sendEmail({ subject, text }, opts);
  } catch (err) {
    return { sent: false, reason: err.message };
  }
}
```

并把 `module.exports` 改为：`module.exports = { buildDigestText, buildSubject, isEmailConfigured, sendEmail, sendDailyDigest };`

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test`
Expected: 新增 6 例 PASS，现有用例不回归。

- [ ] **Step 5: Commit**

```bash
git add src/email.js src/email.test.js src/config.js
git commit -m "feat: email 发送层（isEmailConfigured/sendEmail/sendDailyDigest）+ config SMTP 配置"
```

---

### Task 4: index.js run() 尾部接线（空结果照发邮件）

**Files:**
- Modify: `src/index.js`（顶部加 require；`run()` 尾部 313-325 行重构）

**Interfaces:**
- Consumes: Task 3 的 `sendDailyDigest(sections) → Promise<{sent, reason?, subject?}>`

- [ ] **Step 1: 加 require**

`src/index.js` 第 14 行 `const { buildReport } = require('./report');` 之后加一行：

```js
const { sendDailyDigest } = require('./email');
```

- [ ] **Step 2: 重构 run() 尾部**

把 `src/index.js` 313-325 行：

```js
  const hasResults = sections.some(s => s.results.length > 0);
  if (!hasResults) {
    console.log('\n本次无相关新内容。');
    return;
  }

  const report = buildReport(sections);
  const reportsDir = path.join(__dirname, '../reports');
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });
  const date = new Date().toISOString().split('T')[0];
  const reportPath = path.join(reportsDir, `${date}.md`);
  fs.writeFileSync(reportPath, report, 'utf8');
  console.log(`\n报告已保存: ${reportPath}`);
```

替换为：

```js
  const hasResults = sections.some(s => s.results.length > 0);
  if (!hasResults) {
    console.log('\n本次无相关新内容。');
  } else {
    const report = buildReport(sections);
    const reportsDir = path.join(__dirname, '../reports');
    if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });
    const date = new Date().toISOString().split('T')[0];
    const reportPath = path.join(reportsDir, `${date}.md`);
    fs.writeFileSync(reportPath, report, 'utf8');
    console.log(`\n报告已保存: ${reportPath}`);
  }

  // 每日摘要邮件：无条件发送（空结果走 buildDigestText 的"今日无新增"文案）。
  // 发送失败在 sendDailyDigest 内部被吞掉，绝不影响管线退出码。
  const digest = await sendDailyDigest(sections);
  if (digest.sent) console.log(`\n摘要邮件已发送: ${digest.subject}`);
  else console.log(`\n摘要邮件未发送: ${digest.reason}`);
```

- [ ] **Step 3: 语法 + 回归**

```bash
node --check src/index.js
npm test
```

Expected: 两命令均成功；现有用例全绿（本任务不新增单测，接线为集成面，由 Task 6 冒烟覆盖）。

- [ ] **Step 4: Commit**

```bash
git add src/index.js
git commit -m "feat: 管线 run() 末尾接入每日摘要邮件（空结果照发）"
```

---

### Task 5: 文档同步

**Files:**
- Modify: `CLAUDE.md`、`LOCAL_SETUP.md`、`PROGRESS.md`、`DOCUMENT_MAP.md`

- [ ] **Step 1: CLAUDE.md**

1. 目录结构 `src/` 块，`report.js` 行后加：
   ```
   email.js        每日摘要邮件（SMTP，run() 末尾无条件发送；发送失败不影响管线退出码）
   ```
2. 技术栈列表加一行：`- 邮件通知：nodemailer（SMTP，管线 run() 末尾发每日摘要精简列表；空结果照发）`

- [ ] **Step 2: LOCAL_SETUP.md**

在合适章节加「SMTP 邮件配置」段，内容：键名（`SMTP_HOST/SMTP_PORT/SMTP_SECURE/EMAIL_USER/EMAIL_AUTH_CODE/RECEIVER_EMAIL`）、授权码获取方式（QQ 邮箱「设置 → 账号 → 开启 SMTP 服务 → 生成授权码」，163 类似）、`EMAIL_ENABLED=0` 可禁用、说明"每日 08:00 管线跑完后自动发送、空结果也发"。

- [ ] **Step 3: PROGRESS.md**

1. 功能进度表追加一行：
   ```
   | F-017 | Email 每日摘要通知（管线内直发，SMTP 精简列表，空结果照发） | **已完成** | 2026-08-08 冒烟验证（见 F-017 交付内容） |
   ```
2. 正文加「## F-017 Email 每日摘要通知交付内容（2026-08-08）」小节：方案 A（`src/email.js` 三个导出 + `config.js` SMTP + `index.js` 尾部接线 + nodemailer），交付验证（`npm test` 新增用例数、真实发信冒烟 exit 0）。

- [ ] **Step 4: DOCUMENT_MAP.md**

代码入口表加一行：`| 每日摘要邮件 | src/email.js | 管线 run() 末尾 SMTP 推送（buildDigestText/buildSubject/sendDailyDigest） |`

> 注：`DOCUMENT_MAP.md` 当前有上一会话遗留的未提交修改（`M DOCUMENT_MAP.md`，F-016 相关）。本次提交会一并带上；如需分开提交，先 `git commit` 掉旧改动再改本文件。

- [ ] **Step 5: 验证 + Commit**

```bash
grep -n "email.js" CLAUDE.md DOCUMENT_MAP.md
grep -n "F-017" PROGRESS.md
git add CLAUDE.md LOCAL_SETUP.md PROGRESS.md DOCUMENT_MAP.md
git commit -m "docs: Email 摘要通知文档同步（CLAUDE/LOCAL_SETUP/PROGRESS/DOCUMENT_MAP）"
```

Expected: 三处 grep 均命中；提交成功。

---

### Task 6: 全量检查 + 真实发信冒烟

**Files:** 无改动（纯验证）

- [ ] **Step 1: 全量检查**

```bash
npm run check
```

Expected: 全绿（`lint:backend` 语法检查 + 前端 type-check/lint + `npm test` 全过）。

- [ ] **Step 2: 真实发信冒烟（不跑管线，只验证发送链路）**

```bash
node -e "require('./src/email').sendDailyDigest([{keyword:{name:'冒烟测试'},results:[{title:'这是 Email 摘要冒烟测试',url:'https://example.com',score:90,tier:0}]}]).then(r=>{console.log(r);process.exit(r.sent?0:1)})"
```

Expected: 控制台输出 `{ sent: true, subject: '【AI News Monitor】<今日> 每日摘要 · 相关 1 条' }`，exit 0；`RECEIVER_EMAIL` 邮箱收到一封标题/正文符合格式的邮件。
若 `sent: false` 且有 reason（认证失败/超时等），把 reason 贴回会话排查（常见：授权码错误、`SMTP_PORT`/`SMTP_SECURE` 与邮箱服务商不符）。

- [ ] **Step 3: （可选）全链路 E2E**

```bash
npm run ops:run-auto
```

Expected: 真实管线跑完（写库 + 生成 `reports/YYYY-MM-DD.md`），日志末尾出现 `摘要邮件已发送: ...`。此步会真实写 Supabase 并触发一轮 AI 分析，确认日检正常后跳过也可——由执行者判断。

- [ ] **Step 4: 收尾确认**

确认 `git status` 只剩预期未跟踪文件，无 `.env*` 泄漏。若前几步有临时改动，回滚或提交。
