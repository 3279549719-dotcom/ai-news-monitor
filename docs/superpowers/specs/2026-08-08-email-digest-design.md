# Email 每日摘要通知 — 设计

> 日期：2026-08-08 ｜ 状态：已确认 ｜ 触发：用户要补一个通知系统，选定「每日定时摘要 + Email SMTP + 精简列表 + 空结果照发」。

## 1. 目标与场景

管线每日 08:00 跑完后，把当天新增的相关内容以**精简列表邮件**推送给用户；当天无新内容也照发（含"今日无新增"文案，作管线心跳确认）。

**明确不做**（本范围外）：
- WebSocket / 前端实时刷新（用户已选每日摘要，页面实时无意义）
- Server酱 / 企业微信 / Telegram 等其他渠道
- HTML 富文本邮件模板（选的是纯文本精简列表）
- 邮件内板块（category_schema）分组（那是日报的事，邮件只按关键词分组）

## 2. 架构与模块划分

### 2.1 方案：管线内直发（已确认方案 A）

新增 `src/email.js`，在 `run()` 末尾把已组好的 `sections` 直接渲染成邮件发出。空结果分支从「直接 return」改为「也发邮件」。不用独立脚本（避免"当天新文章"语义模糊 + 重复查库），不上云端（偏离本机批处理架构）。

### 2.2 `src/email.js` 三个导出

| 导出 | 职责 | 纯函数 |
|---|---|---|
| `buildDigestText(sections)` | sections → 纯文本正文（含空结果文案） | ✅ 可单测 |
| `buildSubject(sections)` | sections → 邮件主题（含日期 + 条数） | ✅ 可单测 |
| `sendDailyDigest(sections)` | 拼 subject+text → nodemailer 发送 → 吞异常返回 `{sent, reason?, subject?}` | 编排层（吞异常，不发网络错误） |

内部辅助 `isEmailConfigured()`：SMTP 配置齐 + `EMAIL_ENABLED` 未禁用 → true；否则 `sendDailyDigest` 直接返回 `{sent:false, reason:'未配置/未启用'}`，不发网络请求。

### 2.3 依赖

- 新增 `nodemailer`（CommonJS 兼容，`require('nodemailer')`）。`npm install nodemailer`。

## 3. 数据流（`src/index.js` 尾部改造）

现状：
```js
if (!hasResults) { console.log('本次无相关新内容。'); return; }
const report = buildReport(sections);
... 写 reports/YYYY-MM-DD.md ...
```

改为：
```js
const hasResults = sections.some(s => s.results.length > 0);
if (hasResults) { buildReport(sections) → 写 reports/*.md }   // 报告文件语义不变：有内容才写
const digest = await sendDailyDigest(sections);               // 无条件调用：空结果内部出空摘要文案
if (digest.sent) console.log('摘要邮件已发送:', digest.subject);
else console.log('摘要邮件未发送:', digest.reason);
```

**关键约束**：
- 报告文件仍只在 `hasResults` 时生成（不改语义）
- 邮件无条件发（用户选定"照发含空摘要"）
- `sendDailyDigest` 内部 `try/catch` 吞异常 → **邮件失败绝不影响管线退出码**（数据已入库，邮件是 best-effort 通知）
- 手动验证跑管线（`node src/index.js` / `npm run ops:run-auto`）也会发邮件——由 `EMAIL_ENABLED` 控制，想测试不发就设 `EMAIL_ENABLED=0`

## 4. 邮件格式（纯文本精简列表）

**主题**：`【AI News Monitor】2026-08-08 每日摘要 · 相关 4 条`

**正文**：
```
AI News Monitor 每日摘要 — 2026-08-08
相关新内容 4 条

【MU - 曼联信源监控】(3)
[T0] 标题1 (85分)
  https://...
[T1] 标题2 (80分)
  https://...

【Anthropic】(1)
[T2] 标题3 (70分)
  https://...

---
今日无新增关注内容。      ← 仅 total===0 时出现
```

- 每条：`[Tx] 标题 (N分)` + 缩进 URL 行
- tier 用文本标记（`[T0]/[T1]/[T2]`）替代前端色条；无 score/tier 的项优雅降级（不输出对应段）
- 按关键词分组，标题 `【keyword.name】(N)`

## 5. 配置（`src/config.js` + `.env`）

`.env`（用户已配好，键名以此为准）：
```
SMTP_HOST=smtp.qq.com
SMTP_PORT=465
SMTP_SECURE=true
EMAIL_USER=xxx@qq.com        # 发件人（SMTP 用户名）
EMAIL_AUTH_CODE=xxxx         # QQ/163 授权码（非登录密码）
RECEIVER_EMAIL=yyy@qq.com    # 收件人（逗号分隔可多收件人）
EMAIL_ENABLED=1              # 可选；缺省=已配置即启用；设 0 禁用（测试用）
```

`src/config.js` 新增：
```js
EMAIL_ENABLED: process.env.EMAIL_ENABLED !== '0',
SMTP_HOST: process.env.SMTP_HOST || '',
SMTP_PORT: Number(process.env.SMTP_PORT) || 465,
SMTP_SECURE: process.env.SMTP_SECURE !== '0' && process.env.SMTP_SECURE !== 'false',
EMAIL_USER: process.env.EMAIL_USER || '',
EMAIL_AUTH_CODE: process.env.EMAIL_AUTH_CODE || '',
RECEIVER_EMAIL: process.env.RECEIVER_EMAIL || '',
```

发送器配置：
- `nodemailer.createTransport({ host, port, secure, auth:{ user: EMAIL_USER, pass: EMAIL_AUTH_CODE }, connectionTimeout: 15000, socketTimeout: 20000 })`
- `from: AI News Monitor <EMAIL_USER>`，`to: RECEIVER_EMAIL`
- 发送完 `transport.close()`（QQ SMTP 长连接及时释放）

## 6. 错误处理

| 场景 | 行为 |
|---|---|
| SMTP 未配置 / `EMAIL_ENABLED=0` | `sendDailyDigest` 返回 `{sent:false, reason}`，不建 transport，零网络请求 |
| 连接失败 / 认证失败 / 超时 | 异常被吞，返回 `{sent:false, reason: err.message}`，管线照常退出 0 |
| 空结果 | `buildDigestText` 输出"今日无新增关注内容。"，邮件照发 |

## 7. 测试

`src/email.test.js`（node:test，纯函数）：
1. `buildDigestText`：多关键词分组 + `[Tx] 标题 (N分)` + URL 行格式正确
2. `buildDigestText`：空 sections → 含"今日无新增关注内容。"
3. `buildDigestText`：item 缺 score/tier → 优雅降级（无 `(N分)`/`[Tx]`）
4. `buildSubject`：含日期 + 条数
5. `sendDailyDigest`（未配置态）：返回 `{sent:false}`，不抛错

网络发送（真实 SMTP）不做单元测试，端到端用手动冒烟验证一次（真发一封到 RECEIVER_EMAIL）。

## 8. 文档同步

- `CLAUDE.md`：目录结构加 `src/email.js`；已知陷阱/运行章节提摘要邮件
- `LOCAL_SETUP.md`：SMTP 配置步骤（键名 + 授权码获取）
- `PROGRESS.md`：新增 F-017 记录
- `DOCUMENT_MAP.md`：代码入口表加 `src/email.js`
