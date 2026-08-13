# Agent 工作台（Local Agent Workbench）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搭建本地 agent 工作台：网页输入一句话目标 → `claude -p` 无头自主完成软件项目（feature 循环 + 质量门 + 断点续跑）→ 人只审最终产物。

**Architecture:** 薄壳复用模式——不自建 agent 引擎。Node 零依赖后端做控制面（任务状态机 + 执行器 + 质量门 + 预算护栏），`claude -p` 做执行引擎（复用用户全局 DeepSeek 配置），文件系统即状态（progress.md + git commit + accept.json Default-FAIL）。前端单文件原生 JS + EventSource。

**Tech Stack:** Node ≥18（仅内置模块：http/child_process/fs/events/node:test）、vanilla JS 单文件前端、git（任务目录 checkpoint）、`claude -p` CLI。

**依据 Spec:** `docs/superpowers/specs/2026-08-14-agent-workbench-design.md`（2026-08-14 定稿，含用户补充「工具注册表动态化 + 会话使用记录」）。

## 计划时对 spec 的补充（2 个新模块）

为可测试性，计划在 spec 目录结构基础上新增 2 个 server 模块：

- `server/orchestrator.js` — 运行循环（feature 循环 / NEEDS_WORK 重做 / 状态迁移 / 交付说明）。spec 里这段逻辑在 index.js，抽出便于独立 TDD。
- `server/planner.js` — AI 规划会话（目标 → feature 清单 + 验收项）。spec 里归 protocol.js，抽出为独立会话执行器。

其余模块一一对应 spec。目标目录 `E:\claude\agent-workbench\` 当前为空（尚未 `git init`，任务目录各自独立成 git 仓库）。

## Global Constraints

- **项目根**：`E:\claude\agent-workbench\`（独立目录，不在 ai-news-monitor 内）。计划文档本身提交在 ai-news-monitor 的 `docs/superpowers/plans/`。
- **后端零 npm 依赖**：只用 Node 内置模块（http、child_process、fs、path、events、node:test）。不得 `npm install` 任何运行时包。
- **Node ≥ 18**（测试用 `node --test`，`fetch` 全局可用）。
- **前端单文件** `web/index.html`：原生 JS + EventSource，无框架、无构建步骤。
- **任务目录 = 独立 git 仓库**：`git init`，每 feature 至少一个 checkpoint commit；commit 一律 `-c user.name=workbench -c user.email=workbench@local`（避免依赖用户 git 配置），并 `--no-verify`、`--allow-empty`。
- **accept.json Default-FAIL**：每个验收项从 `false` 开始，仅当质量门出示证据后才置 `true`。
- **claude -p 会话复用用户全局配置**（DeepSeek 端点），不新建/覆盖任何配置；无头执行用 `--dangerously-skip-permissions`（任务目录是隔离 git 仓库、无 .env），护栏靠 claude.config.md + approve 门 + 预算兜底。
- **工具注册表动态引用**：claude.config.md 提示 agent 经 `getToolIndex`/`getTool` 引用既有工具注册表（如 ai-news-monitor/src/tools/registry.js），**不硬编码工具清单**；每个 builder 会话的工具调用明细落盘 `notes/usage-b-<step>.json`（「使用记录」）。
- **测试隔离**：所有 server 模块的根路径经 `process.env.WORKBENCH_ROOT` 覆盖（默认 `path.resolve(__dirname,'..')`），测试文件顶部先设 env 再 require，避免污染真实 state/。
- **测试不得真实调 claude**：runner/gate/planner 全部通过注入 `spawnFn`（fake spawn）测试；真实 claude 只在 `scripts/e2e-*.js` 与 M1/M3 gate 手动跑。
- **状态机合法迁移**（`TRANSITIONS`）：
  `PENDING → ACTIVE/FAILED/CANCELLED`；`ACTIVE → GATE/DONE/FAILED/PAUSED`；`GATE → ACTIVE/DONE/NEEDS_WORK/FAILED/PAUSED`；`NEEDS_WORK → ACTIVE`；`PAUSED → ACTIVE`；`DONE/FAILED/CANCELLED` 终态。

## File Structure

```
E:\claude\agent-workbench\
  package.json            # scripts: start / test / e2e；零依赖
  .gitignore              # node_modules/ state/ *.log .env*
  README.md               # 项目说明 + 快速开始
  claude.config.md        # 任务目录共用的 CLAUDE.md 模板（约束+护栏+工具动态引用）
  server/
    index.js              # http 控制面 + SSE + 静态托管（startServer 导出，main 启动）
    tasks.js              # 任务注册表 + 状态机 + 落盘 state/tasks.json + taskDirOf
    protocol.js           # 文档链文件操作：init/expand/brief/plan/accept/progress
    runner.js             # 执行器：spawnClaude（win 兼容）+ runBuilder + usage 记录 + git
    gate.js               # 质量门：evaluator 会话 + parseVerdict + accept 更新
    orchestrator.js       # 运行循环：feature 循环 / NEEDS_WORK 重做 / 迁移 / 交付说明 / recover
    planner.js            # AI 规划会话：goal → features + accept
    budget.js             # 预算护栏：rounds/maxTurns
  web/
    index.html            # 单文件前端（列表 + 详情 + 日志流 + 续跑/批准按钮）
  scripts/
    e2e-m1.js             # M1 端到端：真实 claude 跑一个最小 feature
  state/
    tasks.json            # 运行时生成
  tasks/
    <task-id>/            # 运行时生成：brief/plan/progress/accept.json/CLAUDE.md/notes/delivery.md
```

---

## Task 1: Scaffold — 项目骨架

**Files:**
- Create: `E:\claude\agent-workbench\package.json`
- Create: `E:\claude\agent-workbench\.gitignore`
- Create: `E:\claude\agent-workbench\README.md`
- Create: `E:\claude\agent-workbench\claude.config.md`
- Create: `E:\claude\agent-workbench\web\index.html`（占位，Task 5 替换）
- Create: `E:\claude\agent-workbench\server\.gitkeep`、`E:\claude\agent-workbench\scripts\.gitkeep`

**Interfaces:**
- Produces: `npm start` / `npm test` / `npm run e2e` 脚本入口；`claude.config.md` 模板（Task 3 的 protocol.js 读取）。

- [ ] **Step 1: 创建目录与文件**

```bash
mkdir -p /e/claude/agent-workbench/{server,web,scripts,state,tasks}
```

`package.json`：
```json
{
  "name": "agent-workbench",
  "version": "0.1.0",
  "private": true,
  "description": "本地 agent 工作台：一句话目标 → agent 自主完成软件项目",
  "main": "server/index.js",
  "scripts": {
    "start": "node server/index.js",
    "test": "node --test server/",
    "e2e": "node scripts/e2e-m1.js"
  },
  "engines": { "node": ">=18" }
}
```

`.gitignore`：
```
node_modules/
state/
*.log
.env*
```

`web/index.html`（占位，Task 5 完整版替换）：
```html
<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>Agent 工作台</title></head>
<body><h1>Agent 工作台</h1><p>建设中…</p></body></html>
```

`claude.config.md`（任务目录共用的 CLAUDE.md 模板——**Task 3 会把它拷进每个任务目录**）：
```markdown
# Agent 工作台任务约束

你是一个软件工程师，在本地任务目录中按 plan.md 逐 feature 自主实现一个软件项目。每完成一步更新 progress.md。

## 护栏
- 禁止 git push / force-push / 删除远端数据。
- 禁止删除未备份的文件；必须覆盖已有文件时，先说明理由再操作。
- 禁止读取、输出 .env 与密钥文件内容。
- 危险动作（删除、覆盖、外部发送）先写 action-request.json（{action,target,reason}）并结束会话，等待人工批准。
- 不引入重型依赖；优先零依赖实现。

## 进度
- 每步更新 progress.md：已完成 / 进行中 / 下一步 / 阻塞。
- 不要声称完成未经验证的部分（Default-FAIL 心态）。

## 工具
- 可用工具经 getToolIndex/getTool 动态索引引用（如 ai-news-monitor/src/tools/registry.js），引用而非硬编码清单。
```

`README.md`：项目简介、快速开始（`npm start` → 打开 http://localhost:4173）、目录结构、里程碑状态表（M0-M3 一行一个，标 pending）。

- [ ] **Step 2: 验证测试命令可用（0 测试通过）**

Run: `cd /e/claude/agent-workbench && npm test`
Expected: 输出 0 tests 通过，exit 0。

- [ ] **Step 3: Commit**

```bash
cd /e/claude/agent-workbench
git init -q
git add -A
git -c user.name=workbench -c user.email=workbench@local commit -m "chore: scaffold agent-workbench" --no-verify
```

---

## Task 2: tasks.js — 任务注册表 + 状态机 + 落盘

**Files:**
- Create: `E:\claude\agent-workbench\server\tasks.js`
- Test: `E:\claude\agent-workbench\server\tasks.test.js`

**Interfaces:**
- Consumes: 无（仅 fs/path）
- Produces:
  - `createTask({goal, features?, budget?}) → task`（建记录 + 任务目录，status `PENDING`；features 缺省 `['deliverable']`；budget 缺省 `{maxTurns:200, rounds:0, estTokens:0}`）
  - `getTask(id) → task|null` / `listTasks() → task[]` / `updateTask(id, patch) → task|null`（每次读/写 `state/tasks.json`）
  - `transition(id, to) → task`（校验 `TRANSITIONS`，非法抛错）
  - `taskDirOf(id) → path`（任务目录绝对路径，Task 3/6/8 复用）
  - `ensureDirs()` / `saveTasks(tasks)`
  - task 形：`{id, goal, status, currentStep, createdAt, budget, features, acceptCount:{pass,total}}`

- [ ] **Step 1: 写失败测试**

```js
const os = require('node:os'), path = require('node:path'), fs = require('node:fs');
process.env.WORKBENCH_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-'));
const tasks = require('./tasks');

test('createTask 建记录 + 目录 + PENDING', () => {
  const t = tasks.createTask({ goal: '生成 README' });
  assert.equal(t.status, 'PENDING');
  assert.ok(fs.existsSync(tasks.taskDirOf(t.id)));
  assert.equal(t.features.length, 1); // 缺省 ['deliverable']
});

test('状态机合法/非法迁移', () => {
  const t = tasks.createTask({ goal: 'x' });
  tasks.transition(t.id, 'ACTIVE');           // PENDING→ACTIVE 合法
  assert.equal(tasks.getTask(t.id).status, 'ACTIVE');
  assert.throws(() => tasks.transition(t.id, 'NEEDS_WORK')); // ACTIVE→NEEDS_WORK 非法
  assert.throws(() => tasks.transition(t.id, 'PENDING'));    // 回退非法
});

test('持久化往返（模拟重启：重新读取同一文件）', () => {
  const t = tasks.createTask({ goal: 'y' });
  tasks.updateTask(t.id, { currentStep: 'feature-1' });
  assert.equal(tasks.getTask(t.id).currentStep, 'feature-1');
  assert.equal(tasks.listTasks().some(x => x.id === t.id), true);
});
```

（顶部声明：`const { test } = require('node:test'); const assert = require('node:assert');`）

- [ ] **Step 2: 运行确认失败**

Run: `node --test server/tasks.test.js`
Expected: FAIL — `Cannot find module './tasks'`。

- [ ] **Step 3: 实现**

```js
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.env.WORKBENCH_ROOT || path.resolve(__dirname, '..');
const STATE_DIR = path.join(ROOT, 'state');
const TASKS_FILE = path.join(STATE_DIR, 'tasks.json');
const TASKS_DIR = path.join(ROOT, 'tasks');
const DEFAULT_FEATURES = ['deliverable'];

const TRANSITIONS = {
  PENDING: ['ACTIVE', 'FAILED', 'CANCELLED'],
  ACTIVE: ['GATE', 'DONE', 'FAILED', 'PAUSED'],
  GATE: ['ACTIVE', 'DONE', 'NEEDS_WORK', 'FAILED', 'PAUSED'],
  NEEDS_WORK: ['ACTIVE'],
  PAUSED: ['ACTIVE'],
  DONE: [], FAILED: [], CANCELLED: [],
};

function ensureDirs() { fs.mkdirSync(STATE_DIR, { recursive: true }); fs.mkdirSync(TASKS_DIR, { recursive: true }); }
function loadTasks() { ensureDirs(); try { return JSON.parse(fs.readFileSync(TASKS_FILE, 'utf8')); } catch { return []; } }
function saveTasks(list) { ensureDirs(); fs.writeFileSync(TASKS_FILE, JSON.stringify(list, null, 2)); }
function taskDirOf(id) { return path.join(TASKS_DIR, id); }
function getTask(id) { return loadTasks().find(t => t.id === id) || null; }
function listTasks() { return loadTasks(); }
function updateTask(id, patch) {
  const list = loadTasks(); const i = list.findIndex(t => t.id === id);
  if (i === -1) return null;
  list[i] = { ...list[i], ...patch, updatedAt: new Date().toISOString() };
  saveTasks(list); return list[i];
}
function transition(id, to) {
  const t = getTask(id);
  if (!t) throw new Error(`task ${id} not found`);
  if (!(TRANSITIONS[t.status] || []).includes(to)) throw new Error(`invalid transition ${t.status} -> ${to}`);
  return updateTask(id, { status: to });
}
function newId() {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `task-${ymd}-${String(loadTasks().length + 1).padStart(3, '0')}`;
}
function createTask({ goal, features, budget }) {
  ensureDirs();
  const id = newId(); const dir = taskDirOf(id);
  fs.mkdirSync(dir, { recursive: true }); fs.mkdirSync(path.join(dir, 'notes'), { recursive: true });
  const task = {
    id, goal, status: 'PENDING', currentStep: null,
    createdAt: new Date().toISOString(),
    budget: budget || { maxTurns: 200, estTokens: 0, rounds: 0 },
    features: (features && features.length) ? features : DEFAULT_FEATURES,
    acceptCount: { pass: 0, total: 0 },
  };
  saveTasks([...loadTasks(), task]);
  return task;
}

module.exports = { ROOT, ensureDirs, loadTasks, saveTasks, taskDirOf, getTask, listTasks, updateTask, transition, createTask, TRANSITIONS };
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test server/tasks.test.js`
Expected: PASS（3 个用例）。

- [ ] **Step 5: Commit**

```bash
cd /e/claude/agent-workbench
git add -A
git -c user.name=workbench -c user.email=workbench@local commit -m "feat: tasks.js 状态机 + 落盘" --no-verify
```

---

## Task 3: protocol.js — 协议文档链展开

**Files:**
- Create: `E:\claude\agent-workbench\server\protocol.js`
- Test: `E:\claude\agent-workbench\server\protocol.test.js`

**Interfaces:**
- Consumes: `tasks.taskDirOf`
- Produces:
  - `init(taskDir)` — mkdir、拷 `claude.config.md` → `taskDir/CLAUDE.md`、`git init`、写 `.gitignore`（`.env*\nnotes/\n`）
  - `expand(taskDir, goal, features)` — features 为 `string[]` 或 `[{name, accept}]`；写 `brief.md` + `plan.md`（`- [ ] fN: name`）+ `accept.json`（Default-FAIL：`{id:'fN', feature, label, pass:false, evidence:null}`）
  - `readAccept/writeAccept/readPlan/readProgress/writeProgress/appendProgress`
  - `markFeatureDone(taskDir, index)` — plan.md 打 `[x]`
  - `nextFeature(taskDir) → {index, name}|null` — 第一个未勾选 feature

- [ ] **Step 1: 写失败测试**

```js
const os = require('node:os'), path = require('node:path'), fs = require('node:fs');
process.env.WORKBENCH_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-'));
const tasks = require('./tasks');
const protocol = require('./protocol');

test('init+expand 生成 brief/plan/accept(Default-FAIL)/CLAUDE.md', () => {
  const t = tasks.createTask({ goal: 'G', features: ['引擎', '玩家'] });
  const dir = tasks.taskDirOf(t.id);
  protocol.init(dir); protocol.expand(dir, t.goal, t.features);
  assert.ok(fs.existsSync(path.join(dir, 'brief.md')));
  assert.ok(fs.existsSync(path.join(dir, 'plan.md')));
  assert.ok(fs.existsSync(path.join(dir, 'CLAUDE.md')));
  const items = protocol.readAccept(dir);
  assert.equal(items.length, 2);
  assert.ok(items.every(i => i.pass === false)); // Default-FAIL
});

test('expand 支持 {name,accept} 形态 + label', () => {
  const t = tasks.createTask({ goal: 'G', features: [{ name: '引擎', accept: '游戏可启动' }] });
  const dir = tasks.taskDirOf(t.id);
  protocol.init(dir); protocol.expand(dir, t.goal, t.features);
  assert.equal(protocol.readAccept(dir)[0].label, '游戏可启动');
});

test('nextFeature / markFeatureDone 依序推进', () => {
  const t = tasks.createTask({ goal: 'G', features: ['a', 'b'] });
  const dir = tasks.taskDirOf(t.id);
  protocol.init(dir); protocol.expand(dir, t.goal, t.features);
  assert.equal(protocol.nextFeature(dir).name, 'a');
  protocol.markFeatureDone(dir, 0);
  assert.equal(protocol.nextFeature(dir).name, 'b');
  protocol.markFeatureDone(dir, 1);
  assert.equal(protocol.nextFeature(dir), null);
});

test('progress 读写 + 追加', () => {
  const t = tasks.createTask({ goal: 'G', features: ['a'] });
  const dir = tasks.taskDirOf(t.id);
  protocol.init(dir); protocol.expand(dir, t.goal, t.features);
  protocol.appendProgress(dir, '> done step1');
  assert.match(protocol.readProgress(dir), /done step1/);
  protocol.appendProgress(dir, '> done step2');
  assert.match(protocol.readProgress(dir), /done step2/);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test server/protocol.test.js`
Expected: FAIL — `Cannot find module './protocol'`。

- [ ] **Step 3: 实现**

```js
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const TEMPLATE = path.resolve(__dirname, '..', 'claude.config.md');

function init(taskDir) {
  fs.mkdirSync(taskDir, { recursive: true });
  fs.mkdirSync(path.join(taskDir, 'notes'), { recursive: true });
  if (fs.existsSync(TEMPLATE)) fs.copyFileSync(TEMPLATE, path.join(taskDir, 'CLAUDE.md'));
  if (!fs.existsSync(path.join(taskDir, '.git'))) spawnSync('git', ['init', '-q'], { cwd: taskDir });
  fs.writeFileSync(path.join(taskDir, '.gitignore'), '.env*\nnotes/\n');
}

function normalize(features) {
  return (features || []).map((f, i) => (typeof f === 'string' ? { name: f, accept: `实现 ${f}` } : f));
}

function expand(taskDir, goal, features) {
  const items = normalize(features);
  fs.writeFileSync(path.join(taskDir, 'brief.md'),
    `# ${path.basename(taskDir)}\n\n## 目标\n${goal}\n\n## 范围\n见 plan.md（feature 清单，每 feature 一个会话）\n\n## 验收\n见 accept.json（Default-FAIL）\n`);
  fs.writeFileSync(path.join(taskDir, 'plan.md'),
    '# 实施计划（feature 清单）\n\n' + items.map((f, i) => `- [ ] f${i + 1}: ${f.name}`).join('\n') + '\n');
  fs.writeFileSync(path.join(taskDir, 'accept.json'), JSON.stringify({
    items: items.map((f, i) => ({ id: `f${i + 1}`, feature: f.name, label: f.accept, pass: false, evidence: null })),
  }, null, 2));
  return { items };
}

function readAccept(taskDir) { try { return JSON.parse(fs.readFileSync(path.join(taskDir, 'accept.json'), 'utf8')).items; } catch { return []; } }
function writeAccept(taskDir, items) { fs.writeFileSync(path.join(taskDir, 'accept.json'), JSON.stringify({ items }, null, 2)); }
function readPlan(taskDir) { try { return fs.readFileSync(path.join(taskDir, 'plan.md'), 'utf8'); } catch { return ''; } }
function nextFeature(taskDir) {
  const m = readPlan(taskDir).match(/^- \[ \] f(\d+): (.+)$/m);
  return m ? { index: Number(m[1]) - 1, name: m[2] } : null;
}
function markFeatureDone(taskDir, index) {
  const plan = readPlan(taskDir);
  fs.writeFileSync(path.join(taskDir, 'plan.md'), plan.replace(`- [ ] f${index + 1}:`, `- [x] f${index + 1}:`));
}
function readProgress(taskDir) { try { return fs.readFileSync(path.join(taskDir, 'progress.md'), 'utf8'); } catch { return null; } }
function writeProgress(taskDir, text) { fs.writeFileSync(path.join(taskDir, 'progress.md'), text); }
function appendProgress(taskDir, line) {
  const cur = readProgress(taskDir) || '# 进度\n';
  fs.writeFileSync(path.join(taskDir, 'progress.md'), `${cur}\n${line}\n`);
}

module.exports = { init, expand, normalize, readAccept, writeAccept, readPlan, nextFeature, markFeatureDone, readProgress, writeProgress, appendProgress };
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test server/protocol.test.js`
Expected: PASS（4 个用例）。

- [ ] **Step 5: Commit**

```bash
cd /e/claude/agent-workbench
git add -A
git -c user.name=workbench -c user.email=workbench@local commit -m "feat: protocol.js 文档链展开（Default-FAIL）" --no-verify
```

---

## Task 4: index.js — HTTP 控制面 + SSE + 静态托管

**Files:**
- Create: `E:\claude\agent-workbench\server\index.js`
- Test: `E:\claude\agent-workbench\server\index.test.js`

**Interfaces:**
- Consumes: `tasks`（createTask/getTask/listTasks）、`protocol`（init）
- Produces:
  - `startServer({port?, recover?, spawnFn?}) → http.Server`（`startServer` 返回 server；`main()` 在 `npm start` 时监听 `process.env.PORT||4173`；`spawnFn` 贯穿传给 runTask，测试注入 fake spawn，缺省走真实 claude）
  - 路由：`POST /api/tasks`、`GET /api/tasks`、`GET /api/tasks/:id`、`GET /api/tasks/:id/events`（SSE，先回放内存缓冲再实时）、`GET /` 及静态文件
  - `emitLine(id, line)` / `emitterOf(id)`（内部，供 Task 8 接日志）

- [ ] **Step 1: 写失败测试**

```js
const os = require('node:os'), path = require('node:path'), fs = require('node:fs');
process.env.WORKBENCH_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-'));
const { startServer } = require('./index');

let server, base;
test('server 启动 + 创建/列表/详情 + SSE + 静态', async () => {
  server = await startServer({ port: 0, recover: false });
  base = `http://127.0.0.1:${server.address().port}`;
  // 创建
  const created = await fetch(`${base}/api/tasks`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ goal: 'G', features: ['x'] }),
  }).then(r => r.json());
  assert.equal(created.status, 'PENDING');
  // 列表
  const list = await fetch(`${base}/api/tasks`).then(r => r.json());
  assert.equal(list.length, 1);
  // 详情（含 progress/plan/accept 字段）
  const detail = await fetch(`${base}/api/tasks/${created.id}`).then(r => r.json());
  assert.ok('progress' in detail && 'accept' in detail && 'plan' in detail);
  // SSE：创建时已缓冲一条 created 事件，连接后回放
  const res = await fetch(`${base}/api/tasks/${created.id}/events`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  const reader = res.body.getReader();
  const { value } = await reader.read();
  assert.match(new TextDecoder().decode(value), /created/);
  reader.cancel();
  // 静态
  const html = await fetch(`${base}/`).then(r => r.text());
  assert.match(html, /Agent 工作台/);
});
test.after(async () => { server && server.close(); });
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test server/index.test.js`
Expected: FAIL — `Cannot find module './index'`。

- [ ] **Step 3: 实现**

```js
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const tasks = require('./tasks');
const protocol = require('./protocol');

const WEB_DIR = path.resolve(__dirname, '..', 'web');
const emitters = new Map();     // id → EventEmitter
const logBuffer = new Map();    // id → string[]（SSE 回放，上限 500）

function emitterOf(id) { if (!emitters.has(id)) emitters.set(id, new EventEmitter()); return emitters.get(id); }
function emitLine(id, line) {
  const buf = logBuffer.get(id) || []; buf.push(line); if (buf.length > 500) buf.shift();
  logBuffer.set(id, buf);
  emitterOf(id).emit('line', line);
}
function readBody(req) { return new Promise((resolve, reject) => { let b = ''; req.on('data', c => b += c); req.on('end', () => resolve(b)); req.on('error', reject); }); }
function resJson(res, status, obj) { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); }

function serveStatic(req, res) {
  const url = new URL(req.url, 'http://x');
  let p = url.pathname === '/' ? '/index.html' : url.pathname;
  if (p.includes('..')) { res.writeHead(403); return res.end(); }
  const file = path.join(WEB_DIR, p);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end('not found'); }
  const type = p.endsWith('.html') ? 'text/html; charset=utf-8'
    : p.endsWith('.js') ? 'application/javascript'
    : p.endsWith('.css') ? 'text/css' : 'text/plain';
  res.writeHead(200, { 'content-type': type });
  fs.createReadStream(file).pipe(res);
}

function sse(res, id) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  for (const line of logBuffer.get(id) || []) res.write(`data: ${JSON.stringify(line)}\n\n`);
  const onLine = line => res.write(`data: ${JSON.stringify(line)}\n\n`);
  emitterOf(id).on('line', onLine);
  res.on('close', () => emitterOf(id).off('line', onLine));
}

async function startServer({ port = Number(process.env.PORT || 4173), recover = true, spawnFn } = {}) {
  if (recover) require('./orchestrator').recover?.();
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    try {
      if (req.method === 'POST' && p === '/api/tasks') {
        const body = JSON.parse((await readBody(req)) || '{}');
        if (!body.goal) return resJson(res, 400, { error: 'goal required' });
        const task = tasks.createTask({ goal: body.goal, features: body.features });
        protocol.init(tasks.taskDirOf(task.id));
        emitLine(task.id, { t: 'event', kind: 'created', ts: new Date().toISOString() });
        resJson(res, 201, task);
      } else if (req.method === 'GET' && p === '/api/tasks') {
        resJson(res, 200, tasks.listTasks());
      } else if (req.method === 'GET' && /^\/api\/tasks\/[^/]+$/.test(p)) {
        const id = p.split('/')[3]; const t = tasks.getTask(id);
        if (!t) return resJson(res, 404, { error: 'not found' });
        const dir = tasks.taskDirOf(id);
        resJson(res, 200, { ...t, progress: protocol.readProgress(dir), plan: protocol.readPlan(dir), accept: protocol.readAccept(dir) });
      } else if (req.method === 'GET' && /^\/api\/tasks\/[^/]+\/events$/.test(p)) {
        return sse(res, p.split('/')[3]);
      } else if (req.method === 'GET') {
        return serveStatic(req, res);
      } else {
        resJson(res, 405, { error: 'method not allowed' });
      }
    } catch (err) {
      resJson(res, 500, { error: err.message });
    }
  });
  await new Promise(r => server.listen(port, r));
  return server;
}

if (require.main === module) {
  startServer().then(server => {
    console.log(`Agent 工作台: http://localhost:${server.address().port}`);
  });
}

module.exports = { startServer, emitLine, emitterOf };
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test server/index.test.js`
Expected: PASS（1 个用例）。

- [ ] **Step 5: Commit**

```bash
cd /e/claude/agent-workbench
git add -A
git -c user.name=workbench -c user.email=workbench@local commit -m "feat: index.js HTTP 控制面 + SSE + 静态托管" --no-verify
```

---

## Task 5: web/index.html v1 — 列表 + 创建 + 详情状态

**Files:**
- Modify: `E:\claude\agent-workbench\web\index.html`（替换占位）

**Interfaces:**
- Consumes: `GET /api/tasks`、`POST /api/tasks`、`GET /api/tasks/:id`
- Produces: M0 交付——`npm start` 后网页能创建任务并看到状态卡片。

- [ ] **Step 1: 写前端**

```html
<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>Agent 工作台</title>
<style>
  :root { color-scheme: dark; }
  body { font-family: system-ui, sans-serif; margin: 0; background: #111; color: #eee; height: 100vh; }
  header { padding: 12px 20px; border-bottom: 1px solid #333; }
  main { display: flex; height: calc(100vh - 56px); }
  aside { width: 340px; border-right: 1px solid #333; padding: 12px; overflow-y: auto; }
  section { flex: 1; padding: 16px; overflow-y: auto; }
  form { display: flex; gap: 8px; margin-bottom: 12px; }
  input { flex: 1; padding: 8px; background: #1d1d1d; color: #eee; border: 1px solid #444; border-radius: 6px; }
  button { padding: 8px 14px; border-radius: 6px; border: 1px solid #555; background: #2a2a2a; color: #eee; cursor: pointer; }
  .card { padding: 10px; border: 1px solid #333; border-radius: 8px; margin-bottom: 8px; cursor: pointer; }
  .card:hover { border-color: #777; }
  .badge { font-size: 11px; padding: 2px 8px; border-radius: 10px; margin-left: 6px; }
  .badge.PENDING { background:#333; } .badge.ACTIVE { background:#1e5; color:#000; }
  .badge.GATE { background:#fa0; color:#000; } .badge.NEEDS_WORK { background:#f70; color:#000; }
  .badge.PAUSED { background:#77f; color:#000; } .badge.DONE { background:#2a2; color:#fff; }
  .badge.FAILED { background:#c22; } .badge.CANCELLED { background:#666; }
  pre { background: #1a1a1a; border: 1px solid #333; border-radius: 6px; padding: 10px; white-space: pre-wrap; max-height: 260px; overflow-y: auto; }
  h3 { margin: 16px 0 6px; }
</style>
</head>
<body>
<header><h1>Agent 工作台</h1></header>
<main>
  <aside>
    <form id="createForm">
      <input id="goal" placeholder="一句话目标，如：参考本地《东方永夜抄》做一个可玩弹幕 demo">
      <button>创建任务</button>
    </form>
    <ul id="taskList" style="list-style:none;padding:0"></ul>
  </aside>
  <section id="detail">
    <h2 id="dTitle">← 选择左侧一个任务</h2>
    <div id="dStatus"></div>
    <h3>进度 progress.md</h3><pre id="dProgress">(无)</pre>
    <h3>验收 accept.json</h3><pre id="dAccept">(无)</pre>
  </section>
</main>
<script>
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
  const api = (p, opts) => fetch('/api' + p, opts).then(r => r.json());
  async function refresh() { renderList(await api('/tasks')); }
  function renderList(list) {
    const ul = $('taskList'); ul.innerHTML = '';
    for (const t of list) {
      const li = document.createElement('li');
      li.className = 'card';
      li.innerHTML = `<strong>${esc(t.goal)}</strong><span class="badge ${t.status}">${t.status}</span>`;
      li.onclick = () => selectTask(t.id);
      ul.appendChild(li);
    }
  }
  async function selectTask(id) {
    const d = await api('/tasks/' + id);
    $('dTitle').textContent = d.goal;
    $('dStatus').textContent = `${d.status}${d.currentStep ? ' · ' + d.currentStep : ''} · accept ${d.acceptCount.pass}/${d.acceptCount.total}`;
    $('dProgress').textContent = d.progress || '(无)';
    $('dAccept').textContent = JSON.stringify(d.accept, null, 2);
  }
  $('createForm').onsubmit = async e => {
    e.preventDefault();
    const t = await api('/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ goal: $('goal').value }) });
    $('goal').value = ''; await refresh(); selectTask(t.id);
  };
  setInterval(refresh, 2000); refresh();
</script>
</body></html>
```

- [ ] **Step 2: 验证（M0 gate）**

Run:
```bash
cd /e/claude/agent-workbench
node server/index.js &
sleep 1
curl -s http://localhost:4173/ | grep "Agent 工作台"
curl -s -X POST http://localhost:4173/api/tasks -H "content-type: application/json" -d '{"goal":"生成 README"}'
curl -s http://localhost:4173/api/tasks
kill %1
```
Expected: 页面含标题；POST 返回 `status:"PENDING"`；列表含刚建任务。

- [ ] **Step 3: Commit**

```bash
cd /e/claude/agent-workbench
git add -A
git -c user.name=workbench -c user.email=workbench@local commit -m "feat: web v1 任务列表 + 创建 + 详情状态（M0）" --no-verify
```

---

## Task 6: runner.js — 执行器（claude -p）

**Files:**
- Create: `E:\claude\agent-workbench\server\runner.js`
- Test: `E:\claude\agent-workbench\server\runner.test.js`

**Interfaces:**
- Consumes: `tasks.taskDirOf`、`protocol`（readProgress/readAccept/markFeatureDone/appendProgress）
- Produces:
  - `spawnClaude(args, {cwd, onLog, timeoutMs}) → {stdout, stderr}`（win32 走 `cmd.exe /d /s /c`；子进程输出回调）
  - `parseSession(stdout) → sessionJson`（兼容整体 JSON 或 NDJSON 末行）
  - `extractUsage(sessionJson) → [{tool, ts}]`（取 `tool_use` 块——**「使用记录」**）
  - `git(taskDir, args)`（`spawnSync('git', args, {cwd})`）
  - `buildBuilderPrompt(task, feature, extra) → string`（约束+验收+进度+当前 feature+要求）
  - `runBuilder(task, feature, {spawnFn, onLog, extra}) → {ok, sessionJson}`（spawn → 落 `notes/session-b-<n>.json` + `notes/usage-b-<n>.json` → `git commit wip` → appendProgress）
  - `taskDirOf(id)`（转发 `tasks.taskDirOf`，gate/orchestrator 复用）

- [ ] **Step 1: 写失败测试**

```js
const os = require('node:os'), path = require('node:path'), fs = require('node:fs');
process.env.WORKBENCH_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-'));
const tasks = require('./tasks');
const protocol = require('./protocol');
const runner = require('./runner');

const fakeSpawn = async () => ({
  stdout: JSON.stringify({ messages: [{ role: 'assistant', content: [{ type: 'text', text: 'SUMMARY: DONE' }] }] }),
});

test('runBuilder：回写 session/usage + wip commit + progress', async () => {
  const t = tasks.createTask({ goal: 'G', features: ['引擎'] });
  const dir = tasks.taskDirOf(t.id);
  protocol.init(dir); protocol.expand(dir, t.goal, t.features);
  const f = protocol.nextFeature(dir);
  const calls = [];
  await runner.runBuilder(t, f, { spawnFn: fakeSpawn, onLog: l => calls.push(l) });
  assert.ok(fs.existsSync(path.join(dir, 'notes', 'session-b-1.json')));
  assert.ok(fs.existsSync(path.join(dir, 'notes', 'usage-b-1.json')));
  assert.ok(calls.length > 0);
  const log = require('node:child_process').spawnSync('git', ['log', '--oneline'], { cwd: dir, encoding: 'utf8' });
  assert.match(log.stdout, /wip/);
  assert.match(protocol.readProgress(dir), /f1/);
});

test('extractUsage 提取 tool_use', () => {
  const s = { messages: [{ role: 'assistant', content: [{ type: 'text', text: 'x' }, { type: 'tool_use', name: 'bash', timestamp: 't' }] }] };
  assert.equal(runner.extractUsage(s).length, 1);
  assert.equal(runner.extractUsage(s)[0].tool, 'bash');
});

test('buildBuilderPrompt 注入约束/验收/进度/当前 feature', () => {
  const t = tasks.createTask({ goal: 'G', features: ['引擎'] });
  const dir = tasks.taskDirOf(t.id);
  protocol.init(dir); protocol.expand(dir, t.goal, t.features);
  const p = runner.buildBuilderPrompt(t, { index: 0, name: '引擎' }, '');
  assert.match(p, /=== 当前 feature ===/);
  assert.match(p, /f1: 引擎/);
  assert.match(p, /accept\.json/);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test server/runner.test.js`
Expected: FAIL — `Cannot find module './runner'`。

- [ ] **Step 3: 实现**

```js
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const protocol = require('./protocol');

function shellQuote(s) { return `"${String(s).replace(/"/g, '\\"')}"`; }

function spawnClaude(args, { cwd, onLog = () => {}, timeoutMs = 5 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    const win = process.platform === 'win32';
    const full = win ? ['/d', '/s', '/c', `claude ${args.map(shellQuote).join(' ')}`] : ['claude', ...args];
    const child = spawn(win ? 'cmd.exe' : 'claude', full, { cwd, shell: false, windowsVerbatimArguments: win, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { const s = d.toString(); stdout += s; onLog(s); });
    child.stderr.on('data', d => { stderr += d.toString(); });
    const timer = setTimeout(() => { child.kill(); reject(new Error(`timeout ${timeoutMs}ms`)); }, timeoutMs);
    child.on('error', err => { clearTimeout(timer); reject(err); });
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`claude exit ${code}: ${stderr.slice(0, 400)}`)); });
  });
}

function parseSession(stdout) {
  const candidates = [stdout, stdout.trim().split('\n').pop()];
  for (const text of candidates) {
    try {
      const j = JSON.parse(text);
      if (Array.isArray(j)) return { messages: j };
      if (j && j.messages) return j;
      return j;
    } catch { /* try next */ }
  }
  return { raw: stdout };
}

function extractUsage(sessionJson) {
  const out = [];
  for (const msg of sessionJson?.messages || []) {
    for (const c of msg.content || []) if (c && c.type === 'tool_use') out.push({ tool: c.name, ts: c.timestamp || null });
  }
  return out;
}

function git(taskDir, args) { return spawnSync('git', args, { cwd: taskDir, stdio: 'ignore' }); }

function buildBuilderPrompt(task, feature, extra) {
  const dir = taskDirOf(task.id);
  const cfg = fs.existsSync(path.join(dir, 'CLAUDE.md')) ? fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8') : '';
  const progress = protocol.readProgress(dir) || '（尚无进度）';
  const accept = JSON.stringify(protocol.readAccept(dir), null, 2);
  return [
    '你是一个软件工程师，在任务目录中实现一个 feature。',
    '',
    '=== 约束（CLAUDE.md）===',
    cfg,
    '',
    '=== 验收清单（accept.json，Default-FAIL）===',
    accept,
    '',
    '=== 进度（progress.md）===',
    progress,
    '',
    '=== 当前 feature ===',
    `f${feature.index + 1}: ${feature.name}`,
    '',
    extra || '',
    '',
    '要求：',
    '1. 完成该 feature；不要声称完成未经验证的部分（Default-FAIL）。',
    '2. 更新 progress.md：已完成 / 进行中 / 下一步 / 阻塞。',
    '3. 完成后输出一行 SUMMARY: DONE 或 SUMMARY: FAILED。',
  ].join('\n');
}
function taskDirOf(id) { return require('./tasks').taskDirOf(id); }

async function runBuilder(task, feature, { spawnFn = spawnClaude, onLog = () => {}, extra = '' } = {}) {
  const dir = taskDirOf(task.id);
  const prompt = buildBuilderPrompt(task, feature, extra);
  const step = feature.index + 1;
  const { stdout } = await spawnFn(['-p', prompt, '--output-format', 'json', '--max-turns', '30', '--dangerously-skip-permissions'], { cwd: dir, onLog });
  const sessionJson = parseSession(stdout);
  fs.writeFileSync(path.join(dir, 'notes', `session-b-${step}.json`), JSON.stringify(sessionJson, null, 2));
  fs.writeFileSync(path.join(dir, 'notes', `usage-b-${step}.json`), JSON.stringify(extractUsage(sessionJson), null, 2));
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-m', `wip: f${step} ${feature.name}`, '--no-verify', '--allow-empty']);
  protocol.appendProgress(dir, `> [runner] f${step}「${feature.name}」会话结束，wip 已提交`);
  onLog(`[builder] f${step} 会话结束`);
  return { ok: true, sessionJson };
}

module.exports = { spawnClaude, parseSession, extractUsage, git, buildBuilderPrompt, runBuilder, taskDirOf };
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test server/runner.test.js`
Expected: PASS（3 个用例）。注意：`buildBuilderPrompt` 里的 `taskDirOf` 引用 `tasks.taskDirOf`，与 `git` 调用一起在 Task 8 的 orchestrator 里复用。

- [ ] **Step 5: Commit**

```bash
cd /e/claude/agent-workbench
git add -A
git -c user.name=workbench -c user.email=workbench@local commit -m "feat: runner.js claude -p 执行器（win 兼容 + usage 记录）" --no-verify
```

---

## Task 7: gate.js — 质量门（Default-FAIL evaluator）

**Files:**
- Create: `E:\claude\agent-workbench\server\gate.js`
- Test: `E:\claude\agent-workbench\server\gate.test.js`

**Interfaces:**
- Consumes: `tasks.taskDirOf`、`protocol`（readAccept/writeAccept/readProgress）、`runner.spawnClaude`
- Produces:
  - `buildEvaluatorPrompt(task) → string`（独立评审者，明确「只读，禁止写文件」）
  - `parseVerdict(sessionJson) → {items:[{id,pass,evidence}], verdict}`（取最后一条 assistant 文本里的 JSON）
  - `runEvaluator(task, {spawnFn, onLog}) → {verdict:'PASS'|'NEEDS_WORK', findings:[], items}`（按证据更新 accept.json；落 `notes/gate-<ts>.json`）

- [ ] **Step 1: 写失败测试**

```js
const os = require('node:os'), path = require('node:path'), fs = require('node:fs');
process.env.WORKBENCH_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-'));
const tasks = require('./tasks');
const protocol = require('./protocol');
const gate = require('./gate');

const passVerdict = JSON.stringify({ items: [{ id: 'f1', pass: true, evidence: 'e2e 验证通过' }] });
const failVerdict = JSON.stringify({ items: [{ id: 'f1', pass: false, evidence: null, finding: '缺少启动入口' }] });
const fakeSpawn = async (args) => ({
  stdout: JSON.stringify({ messages: [{ role: 'assistant', content: [{ type: 'text', text: args[1].includes('pass:true') ? passVerdict : failVerdict }] }] }),
});

test('PASS：accept.json 项被证据置 true', async () => {
  const t = tasks.createTask({ goal: 'G', features: ['引擎'] });
  const dir = tasks.taskDirOf(t.id);
  protocol.init(dir); protocol.expand(dir, t.goal, t.features);
  const g = await gate.runEvaluator(t, { spawnFn: fakeSpawn });
  assert.equal(g.verdict, 'PASS');
  assert.equal(protocol.readAccept(dir)[0].pass, true);
  assert.equal(protocol.readAccept(dir)[0].evidence, 'e2e 验证通过');
});

test('NEEDS_WORK：接受未置 true + 返回发现', async () => {
  const t = tasks.createTask({ goal: 'G', features: ['引擎'] });
  const dir = tasks.taskDirOf(t.id);
  protocol.init(dir); protocol.expand(dir, t.goal, t.features);
  const g = await gate.runEvaluator(t, { spawnFn: fakeSpawn });
  assert.equal(g.verdict, 'NEEDS_WORK');
  assert.ok(g.findings.length > 0);
  assert.equal(protocol.readAccept(dir)[0].pass, false); // Default-FAIL 保持
});

test('parseVerdict 解析最后一条 assistant 文本 JSON', () => {
  const session = { messages: [
    { role: 'assistant', content: [{ type: 'text', text: '前面的闲聊' }] },
    { role: 'assistant', content: [{ type: 'text', text: passVerdict }] },
  ] };
  const v = gate.parseVerdict(session);
  assert.equal(v.items[0].pass, true);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test server/gate.test.js`
Expected: FAIL — `Cannot find module './gate'`。

- [ ] **Step 3: 实现**

```js
const fs = require('node:fs');
const path = require('node:path');
const protocol = require('./protocol');
const { spawnClaude, taskDirOf } = require('./runner');

function buildEvaluatorPrompt(task) {
  const dir = taskDirOf(task.id);
  const accept = JSON.stringify(protocol.readAccept(dir), null, 2);
  const progress = protocol.readProgress(dir) || '（尚无进度）';
  return [
    '你是独立的代码评审者。只读检查，禁止写任何文件。',
    '',
    '=== 验收清单（accept.json，Default-FAIL）===',
    accept,
    '',
    '=== 项目进度 ===',
    progress,
    '',
    '对每个 pass=false 的验收项，检查任务目录中的实现，判断是否达标。',
    '达标的项给 evidence（能证明的具体证据：文件/日志/输出）。不达标的项给 finding（具体缺失或错误）。',
    '注意：只有出示证据的项才可标 pass=true。',
    '',
    '输出 JSON（务必完整）：{"items":[{"id":"f1","pass":true,"evidence":"...","finding":"..."}]}',
  ].join('\n');
}

function parseVerdict(sessionJson) {
  const texts = (sessionJson?.messages || [])
    .filter(m => m.role === 'assistant')
    .map(m => (m.content || []).map(c => (c.type === 'text' ? c.text : '')).join(''))
    .filter(Boolean);
  const last = texts[texts.length - 1] || '';
  const a = last.indexOf('{'), b = last.lastIndexOf('}');
  if (a < 0 || b < 0) throw new Error('no json in verdict');
  return JSON.parse(last.slice(a, b + 1));
}

async function runEvaluator(task, { spawnFn = spawnClaude, onLog = () => {} } = {}) {
  const dir = taskDirOf(task.id);
  const prompt = buildEvaluatorPrompt(task);
  let parsed;
  try {
    const { stdout } = await spawnFn(['-p', prompt, '--output-format', 'json', '--max-turns', '15', '--dangerously-skip-permissions'], { cwd: dir, onLog });
    parsed = parseVerdict(require('./runner').parseSession(stdout));
  } catch (err) {
    parsed = { items: [], verdict: 'NEEDS_WORK', findings: [`evaluator 不可解析: ${err.message}`] };
  }
  const next = protocol.readAccept(dir).map(it => {
    const r = (parsed.items || []).find(x => x.id === it.id);
    return (r && r.pass) ? { ...it, pass: true, evidence: r.evidence || null } : it;
  });
  protocol.writeAccept(dir, next);
  const passCount = next.filter(i => i.pass).length;
  const missing = next.filter(i => !i.pass);
  const verdict = (parsed.items || []).every(r => r.pass === true) ? 'PASS' : 'NEEDS_WORK';
  const findings = missing.map(i => `${i.id} ${i.label}：证据不足或未达标`);
  fs.writeFileSync(path.join(dir, 'notes', `gate-${Date.now()}.json`), JSON.stringify({ verdict, findings, items: next }, null, 2));
  onLog(`[gate] ${verdict} (${passCount}/${next.length} pass)`);
  return { verdict, findings, items: next };
}

module.exports = { buildEvaluatorPrompt, parseVerdict, runEvaluator };
```

> 注：`taskDirOf` 由 runner.js 转发导出（见 Task 6），gate 直接从 runner 解构。

- [ ] **Step 4: 运行确认通过**

Run: `node --test server/gate.test.js`
Expected: PASS（3 个用例）。

- [ ] **Step 5: Commit**

```bash
cd /e/claude/agent-workbench
git add -A
git -c user.name=workbench -c user.email=workbench@local commit -m "feat: gate.js 质量门（Default-FAIL evaluator）" --no-verify
```

---

## Task 8: orchestrator.js — 运行循环 + 接线 + SSE 日志

**Files:**
- Create: `E:\claude\agent-workbench\server\orchestrator.js`
- Modify: `E:\claude\agent-workbench\server\index.js`（POST /api/tasks 触发 runTask；SSE 接日志）
- Test: `E:\claude\agent-workbench\server\orchestrator.test.js`

**Interfaces:**
- Consumes: `tasks`、`protocol`、`runner`、`gate`、`budget`（budget 在 Task 11 建，此处先用内联的 rounds 检查占位——见 Step 3 注释）
- Produces:
  - `runTask(id, {spawnFn, onLog})` — 全生命周期：ensure docs → feature 循环 → 每 feature builder→gate→(PASS:mark+commit|NEEDS_WORK:重做) → DONE + `writeDelivery(id)`
  - `recover()` — 启动扫描：ACTIVE/GATE/NEEDS_WORK → PAUSED
  - `writeDelivery(id)` — 交付说明（验收结果 + **工具使用明细**）
  - 接线：index.js 的 create handler 里 `runTask(id, {spawnFn, onLog: l => emitLine(id, l)})`（fire-and-forget）

- [ ] **Step 1: 写失败测试**

```js
const os = require('node:os'), path = require('node:path'), fs = require('node:fs');
process.env.WORKBENCH_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-'));
const tasks = require('./tasks');
const protocol = require('./protocol');
const orchestrator = require('./orchestrator');

// fake spawn：按 prompt 内容区分 builder / evaluator
const fakeSpawn = async (args) => {
  const prompt = args[1] || '';
  const text = prompt.includes('=== 当前 feature ===')
    ? 'SUMMARY: DONE'
    : JSON.stringify({ items: [{ id: 'f1', pass: true, evidence: 'fake' }] });
  return { stdout: JSON.stringify({ messages: [{ role: 'assistant', content: [{ type: 'text', text }] }] }) };
};

test('runTask 全流程：ACTIVE→GATE→DONE，plan 全勾选，accept 全 pass，交付说明含使用记录', async () => {
  const t = tasks.createTask({ goal: 'G', features: ['引擎'] });
  const dir = tasks.taskDirOf(t.id);
  protocol.init(dir); protocol.expand(dir, t.goal, t.features);
  const logs = [];
  await orchestrator.runTask(t.id, { spawnFn: fakeSpawn, onLog: l => logs.push(l) });
  const final = tasks.getTask(t.id);
  assert.equal(final.status, 'DONE');
  assert.equal(protocol.nextFeature(dir), null);        // 全部勾选
  assert.ok(protocol.readAccept(dir).every(i => i.pass)); // 全部 pass
  assert.ok(fs.existsSync(path.join(dir, 'delivery.md')));
  const delivery = fs.readFileSync(path.join(dir, 'delivery.md'), 'utf8');
  assert.match(delivery, /工具使用明细/);
});

test('NEEDS_WORK 重做：先 FAIL 后 PASS，最终 DONE', async () => {
  let count = 0;
  const flakySpawn = async (args) => {
    const prompt = args[1] || '';
    if (prompt.includes('=== 当前 feature ===')) { count++; return { stdout: JSON.stringify({ messages: [{ role: 'assistant', content: [{ type: 'text', text: 'SUMMARY: DONE' }] }] }) }; }
    const verdict = count === 1 ? { items: [{ id: 'f1', pass: false, finding: '缺入口' }] } : { items: [{ id: 'f1', pass: true, evidence: '第二次过了' }] };
    return { stdout: JSON.stringify({ messages: [{ role: 'assistant', content: [{ type: 'text', text: JSON.stringify(verdict) }] }] }) };
  };
  const t = tasks.createTask({ goal: 'G', features: ['引擎'] });
  const dir = tasks.taskDirOf(t.id);
  protocol.init(dir); protocol.expand(dir, t.goal, t.features);
  await orchestrator.runTask(t.id, { spawnFn: flakySpawn });
  assert.equal(tasks.getTask(t.id).status, 'DONE');
  assert.ok(protocol.readAccept(dir).every(i => i.pass));
});

test('recover：把遗留 ACTIVE/GATE/NEEDS_WORK 置 PAUSED', () => {
  const t = tasks.createTask({ goal: 'G', features: ['x'] });
  tasks.transition(t.id, 'ACTIVE');
  orchestrator.recover();
  assert.equal(tasks.getTask(t.id).status, 'PAUSED');
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test server/orchestrator.test.js`
Expected: FAIL — `Cannot find module './orchestrator'`。

- [ ] **Step 3: 实现**

```js
const fs = require('node:fs');
const path = require('node:path');
const tasks = require('./tasks');
const protocol = require('./protocol');
const runner = require('./runner');
const gate = require('./gate');
const budget = require('./budget'); // Task 11 落地；此处先建最小版（见下）

function readActionRequest(dir) {
  const f = path.join(dir, 'action-request.json');
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; }
}

async function runTask(id, { spawnFn = runner.spawnClaude, onLog = () => {} } = {}) {
  const task = tasks.getTask(id);
  if (!task) throw new Error(`task ${id} not found`);
  const dir = tasks.taskDirOf(id);
  try {
    tasks.transition(id, 'ACTIVE');
    // 1) 确保协议文档（Task 13 前：有 features 直接展开）
    if (protocol.readAccept(dir).length === 0) {
      protocol.expand(dir, task.goal, task.features);
    }
    // 2) feature 循环
    let pendingFindings = '';
    while (budget.withinBudget(tasks.getTask(id))) {
      const feature = protocol.nextFeature(dir);
      if (!feature) break;
      tasks.updateTask(id, { currentStep: `feature-${feature.name}` });
      onLog(`▶ f${feature.index + 1}: ${feature.name}`);
      try {
        await runner.runBuilder(tasks.getTask(id), feature, { spawnFn, onLog, extra: pendingFindings });
        pendingFindings = '';
      } catch (err) {
        onLog(`✖ builder 失败: ${err.message}`);
        tasks.transition(id, 'FAILED'); return;
      }
      const actionReq = readActionRequest(dir);
      if (actionReq) {
        onLog(`⏸ 等待批准: ${actionReq.action} → ${actionReq.target}`);
        tasks.transition(id, 'PAUSED'); return;
      }
      budget.chargeRound(tasks.getTask(id));
      tasks.transition(id, 'GATE');
      let g;
      try { g = await gate.runEvaluator(tasks.getTask(id), { spawnFn, onLog }); }
      catch (err) { onLog(`✖ evaluator 失败: ${err.message}`); tasks.transition(id, 'FAILED'); return; }
      if (g.verdict === 'NEEDS_WORK') {
        tasks.transition(id, 'NEEDS_WORK'); tasks.transition(id, 'ACTIVE');
        pendingFindings = '上轮评审发现（本轮必须解决）：\n' + g.findings.map(f => '- ' + f).join('\n');
        onLog(`↻ NEEDS_WORK → 重做 f${feature.index + 1}`);
        continue;
      }
      protocol.markFeatureDone(dir, feature.index);
      runner.git(dir, ['add', '-A']);
      runner.git(dir, ['commit', '-m', `feature: ${feature.name}`, '--no-verify', '--allow-empty']);
      tasks.transition(id, 'ACTIVE');
      onLog(`✔ f${feature.index + 1} PASS`);
    }
    if (protocol.nextFeature(dir)) {
      tasks.transition(id, 'FAILED');
      onLog('✖ 预算耗尽，仍有未完成 feature');
    } else if (tasks.getTask(id).status === 'ACTIVE') {
      tasks.transition(id, 'DONE');
      writeDelivery(id);
      onLog(`✔ 任务完成 ${id}`);
    }
  } catch (err) {
    onLog(`✖ 任务异常: ${err.message}`);
    try { tasks.transition(id, 'FAILED'); } catch { /* 已是终态 */ }
  }
}

function writeDelivery(id) {
  const task = tasks.getTask(id); const dir = tasks.taskDirOf(id);
  const lines = [`# 交付说明 — ${id}`, '', `目标: ${task.goal}`, `状态: DONE`, ''];
  lines.push('## 验收结果');
  for (const it of protocol.readAccept(dir)) lines.push(`- ${it.id} ${it.pass ? '✔' : '✘'} ${it.label}${it.evidence ? `（${it.evidence}）` : ''}`);
  lines.push('', '## 工具使用明细');
  const notes = path.join(dir, 'notes');
  const usageFiles = fs.readdirSync(notes).filter(f => f.startsWith('usage-b-'));
  const all = usageFiles.flatMap(f => JSON.parse(fs.readFileSync(path.join(notes, f), 'utf8')));
  const counts = all.reduce((m, u) => { m[u.tool] = (m[u.tool] || 0) + 1; return m; }, {});
  for (const [tool, n] of Object.entries(counts)) lines.push(`- ${tool} × ${n}`);
  if (!Object.keys(counts).length) lines.push('- （无工具调用记录）');
  fs.writeFileSync(path.join(dir, 'delivery.md'), lines.join('\n'));
}

function recover() {
  for (const t of tasks.listTasks()) {
    if (['ACTIVE', 'GATE', 'NEEDS_WORK'].includes(t.status)) {
      try { tasks.transition(t.id, 'PAUSED'); } catch { /* ignore */ }
    }
  }
}

module.exports = { runTask, writeDelivery, recover };
```

> **占位说明**：Task 8 依赖 `budget.js`（Task 11 才建）。为了本任务可测，先建最小 `server/budget.js`（Step 5 后，Task 11 再补全并加测试）：
> ```js
> const { getTask, updateTask } = require('./tasks');
> function withinBudget(task) { return (task.budget.rounds || 0) < (task.budget.maxTurns || 200); }
> function chargeRound(task) { return updateTask(task.id, { budget: { ...task.budget, rounds: (task.budget.rounds || 0) + 1 } }); }
> module.exports = { withinBudget, chargeRound };
> ```

- [ ] **Step 4: 接线 index.js 并运行全量测试**

Modify `server/index.js`：
- 顶部 `const orchestrator = require('./orchestrator');`
- create handler 在 `emitLine(...created...)` 后追加：
```js
orchestrator.runTask(task.id, { spawnFn, onLog: line => emitLine(task.id, line) });
```
（`spawnFn` 来自 startServer 选项：测试注入 fake spawn，缺省走真实 claude。Task 8 的单测直接测 orchestrator，不测 index 的自动触发；Task 10/12 的路由测试注入 fake spawn。）

Run: `cd /e/claude/agent-workbench && npm test`
Expected: 全部 PASS（tasks/protocol/index/runner/gate/orchestrator）。

- [ ] **Step 5: Commit**

```bash
cd /e/claude/agent-workbench
git add -A
git -c user.name=workbench -c user.email=workbench@local commit -m "feat: orchestrator 运行循环 + 交付说明 + 接线" --no-verify
```

---

## Task 9: web v2 日志流 + e2e-m1 脚本（M1 gate）

**Files:**
- Modify: `E:\claude\agent-workbench\web\index.html`（加日志流 EventSource + 续跑按钮占位）
- Create: `E:\claude\agent-workbench\scripts\e2e-m1.js`

**Interfaces:**
- Consumes: `GET /api/tasks/:id/events`（SSE）、`GET /api/tasks/:id`（poll 详情）
- Produces: M1 gate——真实 claude 跑通「创建 → claude -p 做 feature → 回写 progress → 网页看到日志」。

- [ ] **Step 1: 前端加日志流（替换 v1 的 `<script>` 部分追加）**

在 `web/index.html` 中，把 `selectTask` 改为同时订阅 SSE，并加日志面板：

```html
<h3>日志</h3><pre id="dLog" style="max-height:300px"></pre>
```

```js
let es = null;
async function selectTask(id) {
  const d = await api('/tasks/' + id);
  $('dTitle').textContent = d.goal;
  $('dStatus').textContent = `${d.status}${d.currentStep ? ' · ' + d.currentStep : ''} · accept ${d.acceptCount.pass}/${d.acceptCount.total}`;
  $('dProgress').textContent = d.progress || '(无)';
  $('dAccept').textContent = JSON.stringify(d.accept, null, 2);
  if (es) es.close();
  $('dLog').textContent = '';
  es = new EventSource('/api/tasks/' + id + '/events');
  es.onmessage = e => { $('dLog').textContent += JSON.stringify(JSON.parse(e.data)) + '\n'; };
  es.onerror = () => { /* 重连由 EventSource 自动处理 */ };
}
```

（续跑按钮在 Task 10 接端点后启用；此处留空位即可。）

- [ ] **Step 2: 写 e2e-m1.js**

```js
// M1 端到端：真实 claude -p 跑一个最小任务
// 用法：node scripts/e2e-m1.js ["goal"] ["feature1,feature2"]
const { startServer } = require('../server/index');
const fs = require('node:fs');
const path = require('node:path');

const GOAL = process.argv[2] || '生成一个 README.md，说明本目录用途（1-3 行即可）';
const FEATURES = process.argv[3] ? process.argv[3].split(',') : ['README'];

(async () => {
  const server = await startServer({ port: 0, recover: false });
  const base = `http://127.0.0.1:${server.address().port}`;
  const t = await fetch(base + '/api/tasks', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ goal: GOAL, features: FEATURES }),
  }).then(r => r.json());
  console.log('task', t.id, t.status);
  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 2000));
    const d = await fetch(base + '/api/tasks/' + t.id).then(r => r.json());
    console.log('  ', d.status, d.currentStep || '', `accept ${d.acceptCount.pass}/${d.acceptCount.total}`);
    if (d.status === 'DONE') {
      const dir = path.join(process.env.WORKBENCH_ROOT || require('../server/tasks').ROOT, 'tasks', t.id);
      if (!fs.existsSync(path.join(dir, 'README.md'))) { console.error('FAIL: README.md 未生成'); process.exit(1); }
      console.log('DONE ok →', path.join(dir, 'README.md'));
      console.log('--- 交付说明 ---');
      console.log(fs.readFileSync(path.join(dir, 'delivery.md'), 'utf8'));
      process.exit(0);
    }
    if (d.status === 'FAILED' || d.status === 'CANCELLED') { console.error('FAILED'); process.exit(1); }
  }
  console.error('timeout'); process.exit(2);
})();
```

- [ ] **Step 3: 跑 M1 gate（真实 claude）**

Run: `cd /e/claude/agent-workbench && npm run e2e`
Expected: 状态流转 PENDING→ACTIVE→GATE→DONE；任务目录生成 README.md + delivery.md；`delivery.md` 含「工具使用明细」。
> ⚠️ 同时验证 spec 风险项「claude -p 无头下 hooks/CLAUDE.md 是否生效」：观察任务目录 `CLAUDE.md` 是否被会话遵守（例如 agent 是否更新了 progress.md）。若 CLAUDE.md 未生效，runner 的 prompt 内联兜底已覆盖约束，记为已知现象并记录到 README。

- [ ] **Step 4: Commit**

```bash
cd /e/claude/agent-workbench
git add -A
git -c user.name=workbench -c user.email=workbench@local commit -m "feat: web 日志流 + e2e-m1（M1 跑通）" --no-verify
```

---

## Task 10: resume + 崩溃恢复（M2）

**Files:**
- Modify: `E:\claude\agent-workbench\server\index.js`（加 `POST /api/tasks/:id/resume`）
- Modify: `E:\claude\agent-workbench\web\index.html`（续跑按钮接端点）
- Test: `E:\claude\agent-workbench\server\resume.test.js`

**Interfaces:**
- Consumes: `orchestrator.runTask`、`orchestrator.recover`（startServer 已调 recover）
- Produces: `POST /api/tasks/:id/resume` — PAUSED/FAILED → 重新 `runTask`（重读 progress → 从下一未完成 feature 继续）。

- [ ] **Step 1: 写失败测试**

```js
const os = require('node:os'), path = require('node:path'), fs = require('node:fs');
process.env.WORKBENCH_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-'));
const tasks = require('./tasks');
const protocol = require('./protocol');
const { startServer } = require('./index');

const fakeSpawn = async (args) => {
  const prompt = args[1] || '';
  const text = prompt.includes('=== 当前 feature ===')
    ? 'SUMMARY: DONE'
    : JSON.stringify({ items: [{ id: 'f1', pass: true, evidence: 'fake' }] });
  return { stdout: JSON.stringify({ messages: [{ role: 'assistant', content: [{ type: 'text', text }] }] }) };
};

test('崩溃恢复 + resume：遗留 ACTIVE → 启动变 PAUSED → resume 到 DONE', async () => {
  const server = await startServer({ port: 0, recover: false, spawnFn: fakeSpawn });
  const base = `http://127.0.0.1:${server.address().port}`;
  // 造一个遗留 ACTIVE 任务
  const t = tasks.createTask({ goal: 'G', features: ['引擎'] });
  const dir = tasks.taskDirOf(t.id);
  protocol.init(dir); protocol.expand(dir, t.goal, t.features);
  tasks.transition(t.id, 'ACTIVE');
  await server.close();
  // 重启（recover=true）→ ACTIVE 变 PAUSED
  const server2 = await startServer({ port: 0, recover: true, spawnFn: fakeSpawn });
  const base2 = `http://127.0.0.1:${server2.address().port}`;
  let d = await fetch(`${base2}/api/tasks/${t.id}`).then(r => r.json());
  assert.equal(d.status, 'PAUSED');
  // resume → DONE（fake spawn 走完流程）
  await fetch(`${base2}/api/tasks/${t.id}/resume`, { method: 'POST' });
  await new Promise(r => setTimeout(r, 300));
  d = await fetch(`${base2}/api/tasks/${t.id}`).then(r => r.json());
  assert.equal(d.status, 'DONE');
  server2.close();
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test server/resume.test.js`
Expected: FAIL — resume 路由返回 405/404。

- [ ] **Step 3: 实现 resume 路由**

在 `server/index.js` 的 handler 中、静态分支之前加：

```js
} else if (req.method === 'POST' && /^\/api\/tasks\/[^/]+\/resume$/.test(p)) {
  const id = p.split('/')[3]; const t = tasks.getTask(id);
  if (!t) return resJson(res, 404, { error: 'not found' });
  if (t.status !== 'PAUSED' && t.status !== 'FAILED') return resJson(res, 409, { error: `cannot resume from ${t.status}` });
  try { tasks.transition(id, 'ACTIVE'); } catch (err) { return resJson(res, 409, { error: err.message }); }
  emitLine(id, { t: 'event', kind: 'resume', ts: new Date().toISOString() });
  require('./orchestrator').runTask(id, { spawnFn, onLog: line => emitLine(id, line) });
  resJson(res, 202, { id, status: 'ACTIVE' });
}
```

- [ ] **Step 4: 前端续跑按钮**

在 `web/index.html` 的 detail 区加按钮并接上：

```html
<button id="dResume">续跑</button>
```

```js
$('dResume').onclick = async () => {
  if (!currentId) return;
  await api('/tasks/' + currentId + '/resume', { method: 'POST' });
  $('dLog').textContent = '';
  refresh();
};
```

（`currentId` 在 `selectTask` 里赋值：`let currentId = null;` → `currentId = id;`）

- [ ] **Step 5: 运行确认通过 + 全量**

Run: `cd /e/claude/agent-workbench && npm test`
Expected: 全部 PASS。

- [ ] **Step 6: Commit**

```bash
cd /e/claude/agent-workbench
git add -A
git -c user.name=workbench -c user.email=workbench@local commit -m "feat: resume + 崩溃恢复（M2）" --no-verify
```

---

## Task 11: budget.js — 预算护栏 + web 展示

**Files:**
- Modify: `E:\claude\agent-workbench\server\budget.js`（Task 8 的最小版补全：estCost + 文档）
- Modify: `E:\claude\agent-workbench\web\index.html`（detail 显示 rounds/maxTurns）
- Test: `E:\claude\agent-workbench\server\budget.test.js`

**Interfaces:**
- Consumes: `tasks.getTask/updateTask`
- Produces:
  - `withinBudget(task) → bool`（`rounds < maxTurns`）
  - `chargeRound(task) → task`（rounds+1，落盘）
  - `estCost(task) → {rounds, maxTurns}`

- [ ] **Step 1: 写失败测试**

```js
const os = require('node:os'), path = require('node:path'), fs = require('node:fs');
process.env.WORKBENCH_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-'));
const tasks = require('./tasks');
const budget = require('./budget');

test('预算限制：rounds 达上限后 withinBudget=false', () => {
  const t = tasks.createTask({ goal: 'G', features: ['x'], budget: { maxTurns: 2, rounds: 0, estTokens: 0 } });
  assert.equal(budget.withinBudget(t), true);
  budget.chargeRound(t); budget.chargeRound(t);
  assert.equal(budget.withinBudget(tasks.getTask(t.id)), false);
  assert.deepEqual(budget.estCost(tasks.getTask(t.id)), { rounds: 2, maxTurns: 2 });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test server/budget.test.js`
Expected: FAIL — `budget.chargeRound` 不存在（Task 8 最小版只有 withinBudget/chargeRound，没有 estCost）→ 补全。

- [ ] **Step 3: 补全 budget.js**

```js
const { getTask, updateTask } = require('./tasks');

function withinBudget(task) { return (task.budget.rounds || 0) < (task.budget.maxTurns || 200); }
function chargeRound(task) { return updateTask(task.id, { budget: { ...task.budget, rounds: (task.budget.rounds || 0) + 1 } }); }
function estCost(task) { return { rounds: task.budget.rounds || 0, maxTurns: task.budget.maxTurns || 200 }; }

module.exports = { withinBudget, chargeRound, estCost };
```

- [ ] **Step 4: 前端展示**

在 `web/index.html` 的 `renderDetail`（selectTask）里加一行：
```js
$('dStatus').textContent += ` · 预算 ${(d.budget?.rounds||0)}/${(d.budget?.maxTurns||200)}`;
```

- [ ] **Step 5: 运行确认通过**

Run: `cd /e/claude/agent-workbench && npm test`
Expected: 全部 PASS。

- [ ] **Step 6: Commit**

```bash
cd /e/claude/agent-workbench
git add -A
git -c user.name=workbench -c user.email=workbench@local commit -m "feat: budget.js 预算护栏 + web 展示" --no-verify
```

---

## Task 12: approve 危险动作门（P2）

**Files:**
- Modify: `E:\claude\agent-workbench\server\index.js`（加 `GET /api/tasks/:id/action`、`POST /api/tasks/:id/approve`）
- Modify: `E:\claude\agent-workbench\web\index.html`（批准按钮 + 请求展示）
- Test: `E:\claude\agent-workbench\server\approve.test.js`

**Interfaces:**
- Consumes: `orchestrator.runTask`（builder 后读 `action-request.json` → PAUSED）、`tasks`
- Produces:
  - `GET /api/tasks/:id/action` → `{request|null}`（读 `tasks/<id>/action-request.json`）
  - `POST /api/tasks/:id/approve` — 清空 action-request + 置 ACTIVE + `runTask` 继续

- [ ] **Step 1: 写失败测试**

```js
const os = require('node:os'), path = require('node:path'), fs = require('node:fs');
process.env.WORKBENCH_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-'));
const tasks = require('./tasks');
const protocol = require('./protocol');
const { startServer } = require('./index');

test('approve 门：builder 请求批准 → PAUSED → approve → DONE', async () => {
  const server = await startServer({ port: 0, recover: false, spawnFn: async () => ({ stdout: JSON.stringify({ messages: [] }) }) });
  const base = `http://127.0.0.1:${server.address().port}`;
  const t = tasks.createTask({ goal: 'G', features: ['引擎'] });
  const dir = tasks.taskDirOf(t.id);
  protocol.init(dir); protocol.expand(dir, t.goal, t.features);
  // 模拟 builder 会话后留下 action-request
  fs.writeFileSync(path.join(dir, 'action-request.json'), JSON.stringify({ action: '删除', target: 'tmp', reason: '清理' }));
  tasks.transition(t.id, 'ACTIVE');
  // 触发一次 runTask（orchestrator 应读到请求 → PAUSED）
  require('./orchestrator').runTask(t.id, { spawnFn: async () => ({ stdout: JSON.stringify({ messages: [] }) }) });
  await new Promise(r => setTimeout(r, 200));
  assert.equal(tasks.getTask(t.id).status, 'PAUSED');
  // approve
  let act = await fetch(`${base}/api/tasks/${t.id}/action`).then(r => r.json());
  assert.equal(act.request.action, '删除');
  await fetch(`${base}/api/tasks/${t.id}/approve`, { method: 'POST' });
  const d = await fetch(`${base}/api/tasks/${t.id}`).then(r => r.json());
  assert.equal(d.status, 'ACTIVE'); // 已从 PAUSED 解除（本轮是否 DONE 取决于 fake spawn，可忽略）
  server.close();
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test server/approve.test.js`
Expected: FAIL — action/approve 路由 404/405。

- [ ] **Step 3: 实现路由**

在 `server/index.js` 的 resume 路由附近加：

```js
} else if (req.method === 'GET' && /^\/api\/tasks\/[^/]+\/action$/.test(p)) {
  const id = p.split('/')[3]; const dir = tasks.taskDirOf(id);
  let request = null;
  try { request = JSON.parse(fs.readFileSync(path.join(dir, 'action-request.json'), 'utf8')); } catch { /* 无请求 */ }
  resJson(res, 200, { request });
} else if (req.method === 'POST' && /^\/api\/tasks\/[^/]+\/approve$/.test(p)) {
  const id = p.split('/')[3]; const t = tasks.getTask(id);
  if (!t) return resJson(res, 404, { error: 'not found' });
  try { fs.unlinkSync(path.join(tasks.taskDirOf(id), 'action-request.json')); } catch { /* 已清空 */ }
  try { tasks.transition(id, 'ACTIVE'); } catch (err) { return resJson(res, 409, { error: err.message }); }
  emitLine(id, { t: 'event', kind: 'approved', ts: new Date().toISOString() });
  require('./orchestrator').runTask(id, { spawnFn, onLog: line => emitLine(id, line) });
  resJson(res, 202, { id, status: 'ACTIVE' });
}
```

（`fs` 已在 index.js 顶部 require。）

- [ ] **Step 4: 前端批准按钮**

在 `web/index.html` 的 detail 区：

```html
<div id="dAction"></div>
<button id="dApprove" style="display:none">批准危险动作</button>
```

```js
async function refreshAction(id) {
  const a = await api('/tasks/' + id + '/action');
  $('dAction').textContent = a.request ? `⏸ 等待批准：${a.request.action} → ${a.request.target}（${a.request.reason}）` : '';
  $('dApprove').style.display = a.request ? 'inline-block' : 'none';
}
$('dApprove').onclick = async () => {
  if (!currentId) return;
  await api('/tasks/' + currentId + '/approve', { method: 'POST' });
  $('dLog').textContent = ''; refresh(); refreshAction(currentId);
};
// selectTask 里调用 refreshAction(id)；refresh() 循环里对当前任务也调一次
```

- [ ] **Step 5: 运行确认通过**

Run: `cd /e/claude/agent-workbench && npm test`
Expected: 全部 PASS。

- [ ] **Step 6: Commit**

```bash
cd /e/claude/agent-workbench
git add -A
git -c user.name=workbench -c user.email=workbench@local commit -m "feat: approve 危险动作门（P2）" --no-verify
```

---

## Task 13: planner.js — AI 规划会话（任意目标 → 协议展开）

**Files:**
- Create: `E:\claude\agent-workbench\server\planner.js`
- Modify: `E:\claude\agent-workbench\server\orchestrator.js`（ensure docs 改为：有 features 直接展开，否则 planner → 展开）
- Test: `E:\claude\agent-workbench\server\planner.test.js`

**Interfaces:**
- Consumes: `runner.spawnClaude/parseSession`
- Produces:
  - `plannerPrompt(task) → string`
  - `runPlanner(task, {spawnFn, onLog}) → {features:[{name,accept}]}`
  - `parsePlan(sessionJson) → {features}`

- [ ] **Step 1: 写失败测试**

```js
const os = require('node:os'), path = require('node:path'), fs = require('node:fs');
process.env.WORKBENCH_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-'));
const tasks = require('./tasks');
const planner = require('./planner');

const planJson = JSON.stringify({ features: [{ name: '引擎骨架', accept: '游戏可启动' }, { name: '玩家', accept: '可移动' }] });
const fakeSpawn = async () => ({ stdout: JSON.stringify({ messages: [{ role: 'assistant', content: [{ type: 'text', text: planJson }] }] }) });

test('runPlanner 产出 features 清单', async () => {
  const t = tasks.createTask({ goal: '做一个弹幕 demo', features: [] });
  const p = await planner.runPlanner(t, { spawnFn: fakeSpawn });
  assert.equal(p.features.length, 2);
  assert.equal(p.features[0].name, '引擎骨架');
  assert.equal(p.features[0].accept, '游戏可启动');
});

test('parsePlan 解析最后一条 assistant 文本 JSON', () => {
  const session = { messages: [{ role: 'assistant', content: [{ type: 'text', text: planJson }] }] };
  assert.equal(planner.parsePlan(session).features.length, 2);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test server/planner.test.js`
Expected: FAIL — `Cannot find module './planner'`。

- [ ] **Step 3: 实现**

```js
const { spawnClaude, parseSession } = require('./runner');

function plannerPrompt(task) {
  return [
    '你是技术规划师。把用户目标拆解为可执行的 feature 清单和验收项。',
    '目标：' + task.goal,
    '',
    '每个 feature 要足够小（能在一个 claude 会话内完成）、可独立验收。',
    '参考输入目录现状后输出 JSON（务必完整）：',
    '{"features":[{"name":"feature 名","accept":"可验证的验收标准"}]}',
  ].join('\n');
}

function parsePlan(sessionJson) {
  const texts = (sessionJson?.messages || [])
    .filter(m => m.role === 'assistant')
    .map(m => (m.content || []).map(c => (c.type === 'text' ? c.text : '')).join(''))
    .filter(Boolean);
  const last = texts[texts.length - 1] || '';
  const a = last.indexOf('{'), b = last.lastIndexOf('}');
  if (a < 0 || b < 0) throw new Error('no json in plan');
  return JSON.parse(last.slice(a, b + 1));
}

async function runPlanner(task, { spawnFn = spawnClaude, onLog = () => {} } = {}) {
  const prompt = plannerPrompt(task);
  const dir = require('./tasks').taskDirOf(task.id);
  const { stdout } = await spawnFn(['-p', prompt, '--output-format', 'json', '--max-turns', '15', '--dangerously-skip-permissions'], { cwd: dir, onLog });
  return parsePlan(parseSession(stdout));
}

module.exports = { plannerPrompt, parsePlan, runPlanner };
```

- [ ] **Step 4: 修改 orchestrator 的 ensure docs**

把 Task 8 里的：
```js
    if (protocol.readAccept(dir).length === 0) {
      protocol.expand(dir, task.goal, task.features);
    }
```
改为：
```js
    if (protocol.readAccept(dir).length === 0) {
      let features = task.features;
      if (!features || !features.length) {
        onLog('[planner] 拆解目标为 feature 清单…');
        const plan = await require('./planner').runPlanner(task, { spawnFn, onLog });
        features = plan.features;
        tasks.updateTask(id, { features: features.map(f => f.name) });
      }
      protocol.expand(dir, task.goal, features);
    }
```

- [ ] **Step 5: 运行确认通过 + 全量**

Run: `cd /e/claude/agent-workbench && npm test`
Expected: 全部 PASS（orchestrator 测试传了 features，走直接展开分支，不受影响）。

- [ ] **Step 6: Commit**

```bash
cd /e/claude/agent-workbench
git add -A
git -c user.name=workbench -c user.email=workbench@local commit -m "feat: planner.js AI 规划（任意目标 → 协议展开）" --no-verify
```

---

## Task 14: M3 gate — 东方 demo 首跑 + README 收尾

**Files:**
- Modify: `E:\claude\agent-workbench\README.md`（里程碑状态表更新 + 使用说明）
- Modify（视结果）: 东方 demo 任务目录产物

**Interfaces:**
- Consumes: 全部模块；真实 claude + planner
- Produces: M3 gate——通过工作台产出可玩的东方同人弹幕 demo（HTML5，自绘几何图形）。

- [ ] **Step 1: 更新 README 里程碑表**

把 M0/M1/M2 标为 ✅（按实际验证结果），M3 标 in-progress，补充「怎么用」：`npm start` → 浏览器输目标 → 看日志 → 必要时续跑/批准 → DONE 后看 `tasks/<id>/delivery.md` 和产物。

- [ ] **Step 2: 跑真实任务（M3 gate）**

Run（目标不带 features → 走 planner 展开）：
```bash
cd /e/claude/agent-workbench
node server/index.js
# 浏览器 http://localhost:4173
# 目标：参考本地《东方永夜抄》弹幕玩法，用 HTML5 Canvas 做一个可玩的东方同人弹幕 demo（素材自绘几何图形，本地运行）
# 观察：planner → 引擎骨架 → 玩家 → 弹幕 → 敌机/Boss → 关卡 → UI → DONE
```

Expected（手动验收）：
- 网页看到状态 PENDING→ACTIVE→GATE 循环 → DONE；日志流实时。
- `tasks/<id>/` 下：plan.md 全勾选、accept.json 全 pass（有证据）、progress.md 完整、delivery.md 含「工具使用明细」。
- 打开 `tasks/<id>/index.html`（或按 delivery.md 指示）能玩：能移动、能射击、有敌机/Boss、关卡可推进。
- 全程断线/关页后可 resume 续跑。
- 产物流入 git（feature 提交历史可查）。

- [ ] **Step 3: 记录运行日志与结果**

把本次运行的关键事实（任务 id、feature 数、accept 数、工具使用汇总、耗时、遇到的问题）写进 `docs/2026-08-14-agent-workbench-run1.md`（放 ai-news-monitor 的 docs/，便于长期查阅）。若计划有偏差，在此记录并回填到 spec/plan。

- [ ] **Step 4: 全量回归 + 收尾 commit**

Run: `cd /e/claude/agent-workbench && npm test`
Expected: 全部 PASS。

```bash
cd /e/claude/agent-workbench
git add -A
git -c user.name=workbench -c user.email=workbench@local commit -m "feat: M3 东方 demo 首跑完成" --no-verify
```

---

## Self-Review

**1. Spec 覆盖（逐节核对 spec → 计划任务）：**
- 决策表「执行引擎/薄壳/断点/质量门」→ Task 6-8 ✓
- 「工具注册表动态 + 使用记录」→ claude.config.md（Task 1）+ runner usage（Task 6）+ delivery 明细（Task 8）✓
- 目录结构（5 层）→ Task 1-5 + 8（orchestrator/planner 为计划新增，见头部说明）✓
- §5.1 HTTP 路由 → Task 4 + 10 + 12 ✓（approve 为 P2，Task 12）
- §5.2 状态机 → Task 2 ✓
- §5.3 runner → Task 6 ✓
- §5.4 gate（三原语）→ Task 7 + 12 ✓
- §5.5 protocol → Task 3 + 13 ✓
- §5.6 web → Task 5 + 9 + 10/11/12 增量 ✓
- §6 生命周期 → Task 8 ✓
- §7 数据模型 → Task 2（tasks.json）+ Task 3（accept.json）✓
- §8 护栏 → Task 11（预算）+ Task 12（批准门）+ claude.config.md（Task 1）+ git 层 .envignore ✓
- §9 错误恢复 → Task 10（recover/resume）+ orchestrator try/catch（Task 8）✓
- §10 测试 → 每任务 TDD + Task 9 e2e ✓
- §11 首批任务（东方 demo）→ Task 14 ✓
- §12 里程碑 M0-M3 → Task 5/9/10/14 ✓
- §13 范围外 → 无任务（未引入）✓
- §14 风险（hooks 生效、DeepSeek 稳定性、无头缺确认、素材版权）→ Task 9 Step 3 验证 + Task 12 批准门 + Task 14 自绘 ✓

**2. Placeholder 扫描：** 无 TBD/TODO；所有代码步骤带完整代码。

**3. 类型/接口一致性：**
- `taskDirOf(id)` 由 tasks.js 导出，runner/gate/planner/orchestrator 复用 ✓
- `protocol.init/expand/readAccept/nextFeature/markFeatureDone/appendProgress` 命名在各任务一致 ✓
- `runTask(id, {spawnFn, onLog})`、`runEvaluator → {verdict, findings, items}`、`parsePlan → {features}` 前后一致 ✓
- budget 最小版在 Task 8 先建、Task 11 补 `estCost`，接口向后兼容 ✓
