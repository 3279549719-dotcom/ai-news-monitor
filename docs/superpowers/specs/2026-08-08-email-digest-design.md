# Email 每日摘要通知 — 设计

> 日期：2026-08-08 ｜ 状态：已确认 ｜ 触发：用户要补一个通知系统，选定「每日定时摘要 + Email SMTP + 精简列表 + 空结果照发」。

## 1. 目标与场景

管线每日 08:00 跑完后，把当天新增的相关内容以**精选邮件**（只推 T0/T1 信源，事件 + 中文摘要 HTML 卡片）推送给用户；当天无新内容也照发（含"今日无值得关注的新内容。"文案，作管线心跳确认）。

**明确不做**（本范围外）：
- WebSocket / 前端实时刷新（用户已选每日摘要，页面实时无意义）
- Server酱 / 企业微信 / Telegram 等其他渠道

> **v2 反转（2026-08-08）**：原「明确不做」中的「HTML 富文本邮件模板」已确认反转为实现（见 §4）；「邮件内板块（category_schema）分组」也由 v2 落地（外层关键词 → 内层板块），二者不再属于明确不做。

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

> **v2 新增导出**：`buildDigestHtml(sections)`（HTML 卡片版正文）、`isNotable(item)`（T0/T1 过滤）+ `filterDigestSections(sections)`（保留 keyword 结构的过滤）——详见 §4。

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

## 4. 邮件格式（v2：T0/T1 精选 · HTML 卡片 + 纯文本双格式）

**过滤规则（展示层，不动数据流）**：`sendDailyDigest` 内统一应用 `isNotable(item)`（`item.tier === 0 || item.tier === 1`）→ `filterDigestSections(sections)`。T2 媒体及无 tier 的项不进邮件，但内容照常入库/进日报——邮件只是展示层过滤，不改数据流。

**主题**：`【AI News Monitor】YYYY-MM-DD 每日摘要 · 精选 N 条`

**HTML part（可扫读卡片）**：
- 深色头部卡片：`AI NEWS MONITOR · 每日摘要` + 日期 + 「今日 N 件值得关注（T0/T1 信源）」
- 外层按关键词分组（标题 `keyword.name (N)`），内层按该关键词的 `category_schema` 分板块（`◆ 板块标签 (N)`；category 不在 schema 键内的归「未分类」）——与 report.js 同一数据源
- 每条卡片：**事件一句话加粗**（`item.event || item.title`）+ 中文摘要【要点】【为什么重要】（`【事件】`段剥离，避免与加粗行重复）+ 彩色徽章 + 源域名链接
  - 彩色徽章：Tier（蓝 `T0/T1`）｜置信度（黄，`CONFIDENCE_LABEL`：高置信/待核实/存疑）｜多源印证（绿，≥2 源）｜冲突（红 `⚠️ 冲突`）
- 内联样式（邮件客户端剥 `<style>`/外部 CSS）；标题/URL 走 `escapeHtml` 转义

**text part（纯文本回退）**：同样关键词→板块分组，`◆ 板块标签 (N)`；每条 `- 事件  T1 | 高置信 | 2源印证 | ⚠️冲突` + 缩进摘要 + URL。

**双 part 发送**：nodemailer 同时携带 `text` 与 `html`，客户端不支持 HTML 时回退纯文本。

**空结果照发**：过滤后 total===0 时，正文输出「今日无值得关注的新内容。」，subject 条数为 0。

## 验收决定（2026-08-08 v2）

用户复核 v1（纯文本精简列表）后拍板确认的 v2 决策：

| 决策点 | 确认结果 |
|---|---|
| 推送范围 | **只推 T0/T1 信源**（官方 + 一线记者）；T2 不进邮件但照常入库/进日报 |
| 每条主体 | **AI 事件一句话（加粗）+ 中文摘要【要点】【为什么重要】**（【事件】段剥离避免重复） |
| 版面 | **可扫读 HTML 卡片**（深色头部 + 关键词→板块 + 事件粗体 + 彩色徽章 + 域名链接），并带纯文本回退 |
| 板块分组 | 外层关键词 → 内层板块，标签**复用 `keyword.category_schema`**（与 report.js 同一数据源） |
| 置信度标签 | **复用 `crosscheck.CONFIDENCE_LABEL`**（high 高置信 / medium 待核实 / low 存疑），不自造映射 |
| 空结果 | 照发（「今日无值得关注的新内容。」，subject 精选 0 条） |
| 失败语义 | 发送失败在 `sendDailyDigest` 内部吞掉返回 `{sent:false}`，绝不影响管线退出码 |

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
| 空结果 | `buildDigestText` 输出"今日无值得关注的新内容。"，邮件照发 |

## 7. 测试

`src/email.test.js`（node:test，纯函数，19 例 v2 用例；全量 `npm test` **72/72**）：
1. `isNotable`：T0/T1 保留，T2/null/非对象过滤
2. `filterDigestSections`：保留 keyword 结构，只留 T0/T1
3. `buildDigestText`：关键词→板块分组，事件 + 摘要 + 徽章（含 category 不在 schema 归「未分类」）
4. `buildDigestText`：summary 去掉【事件】段避免与加粗行重复
5. `buildDigestText`：空结果输出"今日无值得关注的新内容。"
6. `buildSubject`：含日期 + 精选条数
7. `buildDigestHtml`：头部卡片 + 板块分组 + 事件粗体 + 彩色徽章 + 域名链接 + 标题/URL 转义 + 缺失降级
8. `sendDailyDigest`：内部先过滤 T0/T1（sender 收到已过滤条数）；全部过滤后仍发空摘要
9. `isEmailConfigured` / `sendDailyDigest` 未配置态与异常吞掉

网络发送（真实 SMTP）不做单元测试，端到端用手动冒烟验证一次（真发一封到 RECEIVER_EMAIL）——2026-08-08 已冒烟：15 条 T0/T1 实发，exit 0。

## 8. 文档同步

- `CLAUDE.md`：目录结构加 `src/email.js`；已知陷阱/运行章节提摘要邮件
- `LOCAL_SETUP.md`：SMTP 配置步骤（键名 + 授权码获取）
- `PROGRESS.md`：新增 F-017 记录
- `DOCUMENT_MAP.md`：代码入口表加 `src/email.js`
