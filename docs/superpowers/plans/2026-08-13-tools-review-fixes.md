# 工具体系评审修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复工具体系评审发现的 P0-P3 全部问题（v2 接线、usage 真实捕获、前端误触发、suggest 语义、param↔flag 映射、CI 校验），让 18 工具从「文档价值」变为「可信单源工具」。

**Architecture:** 三个独立修复面：(A) harness-check 决策逻辑抽成纯函数 `planChecksForFile`（修前端误触发 + 回退 ReferenceError，可单测）；(B) ai.js 加 `analyzeResultSmart`/`selectArticleLinksSmart` 接线 v2（env `AI_FC=v1` 可回退）+ `command-map.js` + `harness-usage.js` hook 让使用日志真实捕获 Bash 调用；(C) `matchesCondition` 支持 `$gte/$gt/$lt/$lte/$ne` 运算符、修 tool-graph.json 数据、registry 全工具加 `cli_template`、脚本补命名 flag、CI 加 `check:tools`。

**Tech Stack:** Node.js 22 CommonJS、node:test、JSON Schema、GitHub Actions。

**Visual companion:** `docs/tools-optimization-roadmap-review.html`（现状→问题→分阶段→修前/修后效果）。

## Global Constraints

- 后端一律 CommonJS（`require`/`module.exports`），不引入 ES Module。
- 工具名 snake_case，带命名空间前缀（`check_`/`commit_`/`pipeline_`/`ops_`/`data_`/`test_`/`harness_`）。
- `tool-graph.json` 与 `registry.js` 工具名一一对应（`validateGraph()` 校验）。
- 使用日志 JSONL 追加写、静默降级、不记录 env/key、不进 Supabase。
- v2 保留 v1 fallback；`AI_FC` env 可强制回退 v1；不删 v1 函数。
- `usage-logger.js`/`graph.js` 保持零依赖（不 require config/db），harness 独立进程可用。
- 每个工具必须新增 `cli_template` 字段（AI 直接照模板填，消除 flag 记忆负担）。
- 提交用项目规范：`node scripts/git-commit.js "type(scope): 描述"`，走 pre-commit（npm run check）。
- 验收跑 `npm run check`（lint + type-check + test），`npm test` 需包含 `src/tools/*.test.js`。

---

### Task 1: 抽离 check 决策纯函数，修前端误触发 + 回退 ReferenceError（P1-3 / P1-4）

**Files:**
- Create: `src/tools/plan-checks.js`
- Test: `src/tools/plan-checks.test.js`
- Modify: `scripts/harness-check.js`（graph/回退两分支统一走 planChecksForFile）
- Modify: `package.json`（test glob 加 `src/tools/*.test.js`）

**Interfaces:**
- Consumes: `graphForFiles(file)` / `loadGraph()` from `src/tools/graph.js`（已存在）。
- Produces: `planChecksForFile(filePath, triggered?) → string[]`、`planChecksRaw(fp, trig, graphAvailable) → string[]`、`isBackendJs(fp)`、`isFrontend(fp)`。`triggered` 可选注入（测试用）；`graphAvailable` 控制 legacy 回退。

- [ ] **Step 1: 写失败的测试**

`src/tools/plan-checks.test.js`：
```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { planChecksRaw, planChecksForFile, isBackendJs, isFrontend } = require('./plan-checks');

test('前端 .tsx 只跑 type_check + lint，绝不触发 syntax/test（P1-3 修复）', () => {
  const trig = ['check_all', 'check_type', 'ops_screenshot']; // graph 对 App.tsx 的实际输出
  assert.deepEqual(planChecksRaw('client/src/App.tsx', trig, true), ['type_check', 'lint']);
});

test('后端 src/*.js 跑 syntax + test', () => {
  const trig = ['check_all', 'check_test', 'check_syntax'];
  assert.deepEqual(planChecksRaw('src/ai.js', trig, true), ['syntax', 'test']);
});

test('后端 scripts/*.js 触发 check_all 时跑 syntax + test（保持旧行为）', () => {
  const trig = ['check_all', 'check_syntax'];
  assert.deepEqual(planChecksRaw('scripts/run-pipeline.js', trig, true), ['syntax', 'test']);
});

test('docs/*.md 不触发任何检查', () => {
  assert.deepEqual(planChecksRaw('docs/x.md', [], true), []);
});

test('legacy 回退（graph 缺失）：后端仍检查', () => {
  assert.deepEqual(planChecksRaw('src/ai.js', [], false), ['syntax', 'test']);
});

test('legacy 回退（graph 缺失）：前端仍检查', () => {
  assert.deepEqual(planChecksRaw('client/src/App.tsx', [], false), ['type_check', 'lint']);
});

test('反斜杠路径归一化', () => {
  assert.deepEqual(planChecksForFile('src\\ai.js'), ['syntax', 'test']);
});

test('isBackendJs / isFrontend 分类', () => {
  assert.equal(isBackendJs('src/ai.js'), true);
  assert.equal(isBackendJs('client/src/App.tsx'), false);
  assert.equal(isFrontend('client/src/App.tsx'), true);
  assert.equal(isFrontend('docs/x.md'), false);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test src/tools/plan-checks.test.js`
Expected: FAIL with `Cannot find module './plan-checks'`（模块不存在）。

- [ ] **Step 3: 实现 plan-checks.js**

`src/tools/plan-checks.js`：
```js
'use strict';

/**
 * plan-checks.js — 决定"某文件变更该跑哪些检查"的纯函数（评审修复 P1-3/P1-4）
 *
 * 从 harness-check.js 抽出的决策逻辑。修复：
 *   P1-3 前端 .tsx 不再被 graph 的 check_all 触发 node --check（Node 对 .tsx
 *        抛 ERR_UNKNOWN_FILE_EXTENSION）或后端 npm test —— 前端只跑 type_check+lint
 *   P1-4 回退分支不再有未定义变量 —— 决策统一走本模块
 *
 * graph 缺失时回退 legacy 硬编码规则（与原 harness-check.js 回退路径等价）。
 */

const { graphForFiles, loadGraph } = require('./graph');

function isBackendJs(fp) {
  return /^(src|scripts)\//.test(fp) && /\.js$/.test(fp);
}

function isFrontend(fp) {
  return /^client\//.test(fp) && /\.(ts|tsx|js|jsx|css)$/.test(fp);
}

/**
 * 纯决策函数：根据文件 + 触发工具 + graph 可用性，返回应执行的检查阶段。
 * @param {string} fp - 变更文件（仓库相对路径，可含反斜杠）。
 * @param {string[]} trig - 触发的工具名列表。
 * @param {boolean} graphAvailable - tool-graph.json 是否可用（false 走 legacy 回退）。
 * @returns {string[]} 阶段名数组，如 ['type_check','lint'] 或 ['syntax','test']。
 */
function planChecksRaw(fp, trig, graphAvailable) {
  const norm = String(fp).replace(/\\/g, '/');
  const useLegacy = !graphAvailable || (trig || []).length === 0;
  const backend = isBackendJs(norm);
  const frontend = isFrontend(norm);
  const out = [];

  if (frontend && (useLegacy || trig.includes('check_type'))) out.push('type_check');
  if (frontend && (useLegacy || trig.includes('ops_screenshot'))) out.push('lint');
  if (backend && (useLegacy || trig.some(t => ['check_all', 'check_test', 'check_syntax'].includes(t)))) out.push('syntax');
  if (backend && (useLegacy || trig.some(t => ['check_all', 'check_test'].includes(t)))) out.push('test');
  return out;
}

/**
 * 公共入口：自动加载 graph 并计算触发工具。
 * @param {string} filePath - 变更文件。
 * @param {string[]} [triggered] - 可选注入（测试/复用用）。
 * @returns {string[]}
 */
function planChecksForFile(filePath, triggered) {
  const fp = String(filePath || '').replace(/\\/g, '/');
  const graphAvailable = !!loadGraph();
  const trig = triggered || (graphAvailable ? graphForFiles([fp]) : []);
  return planChecksRaw(fp, trig, graphAvailable);
}

module.exports = { planChecksForFile, planChecksRaw, isBackendJs, isFrontend };
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test src/tools/plan-checks.test.js`
Expected: PASS（8/8）。

- [ ] **Step 5: 重构 harness-check.js 用纯函数**

在 `scripts/harness-check.js` 顶部 import 替换 graph require：
```js
const { checkFile } = require('./lib/check-js');
const { planChecksForFile, isBackendJs, isFrontend } = require('../src/tools/plan-checks');
```
把 `const graph = ...` 到 `process.exit(0)` 之间的整段（原 graph 分支 + 回退分支）替换为：
```js
const stageExec = {
  type_check: () => run('npm', ['run', 'type-check'], path.join(ROOT, 'client')),
  lint: () => run('npm', ['run', 'lint'], path.join(ROOT, 'client')),
  syntax: () => {
    const r = checkFile(fp, { silent: true });
    return { ok: r.ok, stdout: '', stderr: r.stderr };
  },
  test: () => run('npm', ['test'], ROOT),
};

const t0 = Date.now();
const stages = planChecksForFile(norm);
const results = stages.map(stage => {
  const r = stageExec[stage]();
  return {
    stage,
    passed: r.ok,
    summary: r.ok ? '检查通过' : (r.stderr || '检查失败'),
    suggestion: r.ok ? null : suggestFix(norm, stage, r.stderr),
  };
});
// 记录工具使用日志（hook_posttooluse 触发）
try {
  const { logToolUse } = require('../src/tools/usage-logger');
  logToolUse({
    tool: 'hook:harness_check',
    trigger: 'hook_posttooluse',
    files: [norm],
    success: results.every(r => r.passed),
    durationMs: Date.now() - t0,
    meta: { stages: stages.join(',') || 'none' },
  });
} catch (e) { /* 日志失败静默 */ }
```
JSON 输出段把 `_isFrontend`/`_isBackend` 改为引用 import 的函数：
```js
  const type = isFrontend(norm) ? 'frontend' : isBackendJs(norm) ? 'backend' : 'skipped';
```
保留 `suggestSyntaxFix`/`suggestFix`/`process.exit(0)` 不变。删除原 `graph` 变量与回退分支（`triggered` 未定义 bug 随之消失）。

- [ ] **Step 6: 更新 package.json test glob**

`package.json` scripts.test 改为：
```json
"test": "node --test \"src/*.test.js\" \"src/tools/*.test.js\" \"scripts/*.test.js\""
```

- [ ] **Step 7: 跑全套验证**

Run: `npm run check`
Expected: lint + type-check + test 全通过（新增 plan-checks 8 例 + graph 15 例进 npm test 统计）。

- [ ] **Step 8: 手动冒烟（前端不误触发）**

Run: `echo '{"tool_input":{"file_path":"client/src/App.tsx"}}' | node scripts/harness-check.js --json`
Expected: `"type":"frontend"`, stages 只含 `type_check` 与 `lint`，无 `syntax`（修前会多一个失败 syntax）。

- [ ] **Step 9: Commit**

```bash
git add src/tools/plan-checks.js src/tools/plan-checks.test.js scripts/harness-check.js package.json
node scripts/git-commit.js "fix(harness): 前端 tsx 不再误触发 node --check/后端测试，决策抽纯函数（P1-3/P1-4）"
```

---

### Task 2: matchesCondition 运算符 + tool-graph 数据修复 + suggested_next 消费（P2-5 / P2-6 / P2-7）

**Files:**
- Modify: `src/tools/graph.js`（matchesCondition 支持 `$gte/$gt/$lt/$lte/$ne/$eq/$and/$or`）
- Modify: `src/tools/tool-graph.json`（data_backfill / harness_diagnose / commit_git / update_sources 数据修复）
- Modify: `src/tools/graph.test.js`（运算符用例）
- Modify: `scripts/run-pipeline.js`（outputJsonStatus 追加 `suggested_next`）

**Interfaces:**
- Consumes: `graphSuggestNext(tool, result)`（已存在，本次仅增强匹配器）。
- Produces: run-pipeline `--json` 输出新增字段 `suggested_next: Array<{tool, reason}>`。

- [ ] **Step 1: 写失败的运算符测试**

追加到 `src/tools/graph.test.js`：
```js
test('matchesCondition: $gte 数值比较', () => {
  assert.equal(matchesCondition({ issue_count: { $gte: 1 } }, { issue_count: 3 }), true);
  assert.equal(matchesCondition({ issue_count: { $gte: 1 } }, { issue_count: 0 }), false);
});

test('matchesCondition: $gt / $lt / $lte', () => {
  assert.equal(matchesCondition({ processed: { $gt: 0 } }, { processed: 2 }), true);
  assert.equal(matchesCondition({ processed: { $lt: 5 } }, { processed: 2 }), true);
  assert.equal(matchesCondition({ score: { $lte: 60 } }, { score: 60 }), true);
});

test('matchesCondition: 未知操作符保守不匹配', () => {
  assert.equal(matchesCondition({ n: { $bogus: 1 } }, { n: 1 }), false);
});

test('matchesCondition: $and / $or 组合', () => {
  assert.equal(matchesCondition({ $and: [{ a: 1 }, { b: { $gte: 2 } }] }, { a: 1, b: 3 }), true);
  assert.equal(matchesCondition({ $or: [{ a: 1 }, { b: 1 }] }, { a: 0, b: 0 }), false);
});

test('graphSuggestNext: data_backfill processed>0 → check_quality（语义修复）', () => {
  const r = graphSuggestNext('data_backfill', { processed: 3 });
  assert.deepEqual(r, [{ tool: 'check_quality', reason: '回填处理了文章，建议重新验收日报质量' }]);
});

test('graphSuggestNext: data_backfill processed=0 → 无建议', () => {
  assert.deepEqual(graphSuggestNext('data_backfill', { processed: 0 }), []);
});

test('graphSuggestNext: harness_diagnose issue_count>=1 → check_all', () => {
  const r = graphSuggestNext('harness_diagnose', { issue_count: 3 });
  assert.deepEqual(r, [{ tool: 'check_all', reason: '诊断发现问题，修复后建议跑全套验证' }]);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test src/tools/graph.test.js`
Expected: 新增用例 FAIL（`$gte` 不识别、data_backfill processed:3 不命中）。

- [ ] **Step 3: 升级 matchesCondition**

`src/tools/graph.js` 的 `matchesCondition` 整段替换为：
```js
function matchesCondition(cond, result) {
  if (!cond || Object.keys(cond).length === 0) return true;
  if (!result || typeof result !== 'object') return false;

  // $and / $or 顶层组合
  if (cond.$and && Array.isArray(cond.$and)) {
    if (!cond.$and.every(c => matchesCondition(c, result))) return false;
  }
  if (cond.$or && Array.isArray(cond.$or)) {
    if (!cond.$or.some(c => matchesCondition(c, result))) return false;
  }

  for (const [k, v] of Object.entries(cond)) {
    if (k === '$and' || k === '$or') continue;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      // 操作符对象，如 { $gte: 1 }
      const rv = result[k];
      for (const [op, target] of Object.entries(v)) {
        switch (op) {
          case '$gte': if (!(rv >= target)) return false; break;
          case '$gt':  if (!(rv > target))  return false; break;
          case '$lte': if (!(rv <= target)) return false; break;
          case '$lt':  if (!(rv < target))  return false; break;
          case '$ne':  if (rv === target)   return false; break;
          case '$eq':  if (rv !== target)   return false; break;
          default: return false; // 未知操作符保守不匹配
        }
      }
      continue;
    }
    if (Array.isArray(v)) {
      // 数组包含匹配：不匹配即返回 false，匹配则继续检查其余键（与运算符分支一致，避免提前退出）
      if (!(Array.isArray(result[k]) && v.every(x => result[k].includes(x)))) return false;
      continue;
    }
    if (result[k] !== v) return false;
  }
  return true;
}
```

- [ ] **Step 4: 修 tool-graph.json 数据**

`src/tools/tool-graph.json` 四处修改：
1. `data_backfill.suggest_next` → 原 `{ "if": { "processed": 0 } ... }` 改为：
```json
"data_backfill": {
  "triggers_on": [],
  "suggest_next": [
    { "when": "回填处理了文章", "if": { "processed": { "$gt": 0 } }, "then": { "tool": "check_quality", "reason": "回填处理了文章，建议重新验收日报质量" } }
  ]
}
```
2. `harness_diagnose.suggest_next` → `{ "if": { "issue_count": { "$gte": 1 } } }`（reason 不变）。
3. `commit_git.suggest_next` → `[]`（删掉与提交无关的 pushed:false→pipeline_schedule）。
4. `update_sources.triggers_on` → `[]`（DB 写工具不该被本地 JSON 变更触发），`suggest_next` 保留 `test_scrape`。

- [ ] **Step 5: 跑测试确认通过**

Run: `node --test src/tools/graph.test.js`
Expected: PASS（含新增 8 例，总数 23）。

- [ ] **Step 6: run-pipeline --json 输出 suggested_next**

`scripts/run-pipeline.js` 顶部加 require（graph.js 零依赖，安全）：
```js
const { graphSuggestNext } = require('../src/tools/graph');
```
`outputJsonStatus(crawl4aiReady, exitCode)` 的 JSON 对象加字段：
```js
    success: exitCode === 0,
    suggested_next: graphSuggestNext('pipeline_run', { success: exitCode === 0, crawl4ai_ready: crawl4aiReady }),
```

- [ ] **Step 7: 跑全套验证 + 冒烟**

Run: `npm run check`（全绿）
Run: `node -e "const g=require('./src/tools/graph'); console.log(JSON.stringify(g.graphSuggestNext('pipeline_run',{success:false,crawl4ai_ready:false})))"`
Expected: `[{"tool":"ops_check","reason":"crawl4ai 不可用，建议巡检 Docker/容器健康"},{"tool":"ops_check","reason":"管线异常退出，建议巡检基础设施"}]`

- [ ] **Step 8: Commit**

```bash
git add src/tools/graph.js src/tools/graph.test.js src/tools/tool-graph.json scripts/run-pipeline.js
node scripts/git-commit.js "feat(tools): suggest_next 支持数值运算符 + 数据语义修复 + pipeline --json 输出建议（P2-5/6/7）"
```

---

### Task 3: 接线 v2 function calling（P0-1）

**Files:**
- Modify: `src/ai.js`（加 `fcMode()` + `analyzeResultSmart` + `selectArticleLinksSmart`）
- Modify: `src/pipeline-stages.js:43`（analyzeResult → analyzeResultSmart）
- Modify: `src/run-single-keyword.js:20,35`（默认 analyze → analyzeResultSmart）
- Modify: `src/crawl4ai-fetch.js:226`（selectArticleLinks → selectArticleLinksSmart）
- Modify: `src/scraper-direct.js:65`（selectArticleLinks → selectArticleLinksSmart）
- Test: `src/ai.test.js`（Smart 路由 DI 测试，不触网）

**Interfaces:**
- Consumes: `analyzeResultV2(options)` / `selectArticleLinksV2(links, sourceName, pageUrl, logPrefix)`（已存在，内部自带 v1 fallback）。
- Produces: `fcMode() → 'auto'|'v1'`（读 `process.env.AI_FC`，默认 auto）；`analyzeResultSmart(options, _impl?)`；`selectArticleLinksSmart(links, sourceName, pageUrl, logPrefix, _impl?)`。`_impl` 为测试注入的 `{v1, v2}` 实现；缺省时 v2 走真实 function calling（内部回退 v1）。

- [ ] **Step 1: 写失败的路由测试**

追加到 `src/ai.test.js`：
```js
const ai = require('./ai'); // 顶部已有 require 则复用

test('analyzeResultSmart 默认（auto）走 v2 实现', async () => {
  const calls = [];
  const smart = ai.analyzeResultSmart({ query: 'q', title: 't', snippet: 's' }, {
    v1: async () => { calls.push('v1'); return { relevant: true, score: 70, summary: '', event: '', event_type: '', category: '' }; },
    v2: async () => { calls.push('v2'); return { relevant: true, score: 88, summary: '', event: '', event_type: '', category: '' }; },
  });
  const r = await smart;
  assert.deepEqual(calls, ['v2']);
  assert.equal(r.score, 88);
});

test('analyzeResultSmart AI_FC=v1 强制走 v1 实现', async () => {
  process.env.AI_FC = 'v1';
  try {
    const calls = [];
    await ai.analyzeResultSmart({ query: 'q', title: 't', snippet: 's' }, {
      v1: async () => { calls.push('v1'); return { relevant: true, score: 55, summary: '', event: '', event_type: '', category: '' }; },
      v2: async () => { calls.push('v2'); return { relevant: false, score: 0, summary: '', event: '', event_type: '', category: '' }; },
    });
    assert.deepEqual(calls, ['v1']);
  } finally {
    delete process.env.AI_FC;
  }
});

test('selectArticleLinksSmart 默认走 v2，AI_FC=v1 走 v1', async () => {
  process.env.AI_FC = 'v1';
  try {
    const calls = [];
    await ai.selectArticleLinksSmart([], 'src', 'http://x', 'T', {
      v1: async () => { calls.push('v1'); return [{ title: 'a', url: 'u' }]; },
      v2: async () => { calls.push('v2'); return []; },
    });
    assert.deepEqual(calls, ['v1']);
  } finally {
    delete process.env.AI_FC;
  }
});

test('fcMode 默认 auto', () => {
  delete process.env.AI_FC;
  assert.equal(ai.fcMode(), 'auto');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test src/ai.test.js`
Expected: FAIL with `ai.analyzeResultSmart is not a function`。

- [ ] **Step 3: ai.js 加 Smart 包装 + fcMode**

`src/ai.js`（V2 区块末尾，`module.exports` 前）追加：
```js
/**
 * 评审修复 P0-1：v2 接线入口。
 * AI_FC env：auto（默认）→ v2（内部自带 v1 fallback）；v1 → 强制旧路径。
 * _impl 为测试注入点（可选），生产不传。
 */
function fcMode() {
  return process.env.AI_FC || 'auto';
}

async function analyzeResultSmart(options, _impl) {
  const impl = _impl || { v2: analyzeResultV2, v1: analyzeResult };
  return fcMode() === 'v1' ? impl.v1(options) : impl.v2(options);
}

async function selectArticleLinksSmart(links, sourceName, pageUrl, logPrefix = '', _impl) {
  const impl = _impl || { v2: selectArticleLinksV2, v1: selectArticleLinks };
  return fcMode() === 'v1'
    ? impl.v1(links, sourceName, pageUrl, logPrefix)
    : impl.v2(links, sourceName, pageUrl, logPrefix);
}
```
`module.exports` 增加：`fcMode, analyzeResultSmart, selectArticleLinksSmart`。

- [ ] **Step 4: 切换 4 个调用方**

- `src/pipeline-stages.js:26`：`const { summarizeArticle, analyzeResult } = require('./ai');` → 换 `analyzeResultSmart`；`:43` 的 `analyze:` 值改 `analyzeResultSmart`。
- `src/run-single-keyword.js:20`：`const { analyzeResult } = require('./ai');` → `const { analyzeResultSmart: analyzeResult } = require('./ai');`（默认参数 `analyze = analyzeResult` 不变，doc 注释同步改）。
- `src/crawl4ai-fetch.js:22`：`const { selectArticleLinks } = require('./ai');` → `const { selectArticleLinks: selectArticleLinksSmart } = require('./ai');`（保持 `:226` 调用名不变）。
- `src/scraper-direct.js:12`：同上替换。

- [ ] **Step 5: 跑测试确认通过**

Run: `node --test src/ai.test.js src/run-single-keyword.js`
Expected: 全 PASS。注意 `src/run-single-keyword.js` 直接 `node --test` 单跑确认无副作用（它只导出函数）。

- [ ] **Step 6: 跑全套验证**

Run: `npm run check`
Expected: 全绿（pipeline-stages/crawl4ai-fetch/scraper-direct 的既有测试继续通过）。

- [ ] **Step 7: 真实单次验证（有 DEEPSEEK_API_KEY 才跑，CI 跳过）**

Run: `node -e "const {analyzeResultSmart}=require('./src/ai'); analyzeResultSmart({query:'anthropic', title:'Anthropic announces ...', snippet:'...'}).then(r=>console.log(JSON.stringify(r)))"`
Expected: 输出含 score/summary 的对象；若 function calling 兼容性异常会自动回退 v1 并在 stderr 打 warn。

- [ ] **Step 8: Commit**

```bash
git add src/ai.js src/pipeline-stages.js src/run-single-keyword.js src/crawl4ai-fetch.js src/scraper-direct.js src/ai.test.js
node scripts/git-commit.js "feat(ai): 接线 v2 function calling（AI_FC=v1 可回退），4 个调用方切 Smart 包装（P0-1）"
```

---

### Task 4: 使用日志真实捕获 Bash 调用（P0-2）

**Files:**
- Create: `src/tools/command-map.js`
- Test: `src/tools/command-map.test.js`
- Create: `scripts/harness-usage.js`
- Modify: `.claude/settings.json`（PostToolUse 加 Bash matcher）
- Modify: `scripts/harness-check.js`（tool 名 `harness_check` → `hook:harness_check`，Task 1 已改，此处仅确认）

**Interfaces:**
- Consumes: `REGISTRY` from `src/tools/registry.js`；`logToolUse` from `src/tools/usage-logger.js`。
- Produces: `mapCommandToTool(command) → string|null`（bash 命令 → registry 工具名）；`harness-usage.js` 作为 PostToolUse Bash hook，把每次 Bash 调用记入 `logs/.tool-usage.jsonl`。

- [ ] **Step 1: 写失败的映射测试**

`src/tools/command-map.test.js`：
```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mapCommandToTool } = require('./command-map');

test('npm run check → check_all', () => {
  assert.equal(mapCommandToTool('npm run check'), 'check_all');
});

test('node scripts/run-pipeline.js --json → pipeline_run', () => {
  assert.equal(mapCommandToTool('node scripts/run-pipeline.js --json'), 'pipeline_run');
});

test('npm test → check_test', () => {
  assert.equal(mapCommandToTool('npm test'), 'check_test');
});

test('npm run ops:quality --report-path=x → check_quality', () => {
  assert.equal(mapCommandToTool('npm run ops:quality --report-path=x'), 'check_quality');
});

test('未知命令 → null', () => {
  assert.equal(mapCommandToTool('echo hello'), null);
});

test('空命令 → null', () => {
  assert.equal(mapCommandToTool(''), null);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test src/tools/command-map.test.js`
Expected: FAIL with `Cannot find module './command-map'`。

- [ ] **Step 3: 实现 command-map.js**

`src/tools/command-map.js`：
```js
'use strict';

/**
 * command-map.js — bash 命令 → registry 工具名 的映射（评审修复 P0-2）
 *
 * 使用日志要能回答"18 工具真实使用率"，就得把 AI 实际跑的 bash 命令
 * 归一到 registry 工具名。匹配策略：
 *   1) 前缀匹配 registry 各工具的 command 字段（npm run xxx / node scripts/xxx.js）
 *   2) npm 脚本名先解析回命令再匹配（读 package.json scripts）
 * 匹配不上返回 null（记作 bash_other，不冒充工具）。
 */

const path = require('path');
const { REGISTRY } = require('./registry');

const PKG_PATH = path.join(__dirname, '..', '..', 'package.json'); // src/tools → 仓库根

let _scriptsCache = null;
function npmScripts() {
  if (_scriptsCache) return _scriptsCache;
  try {
    _scriptsCache = require(PKG_PATH).scripts || {};
  } catch {
    _scriptsCache = {};
  }
  return _scriptsCache;
}

function normalize(cmd) {
  return String(cmd || '').replace(/\\/g, '/').trim();
}

function mapCommandToTool(command) {
  const cmd = normalize(command);
  if (!cmd) return null;

  // npm run <script> → 解析脚本命令
  const npmRun = /^npm\s+run\s+([\w:-]+)/.exec(cmd);
  if (npmRun) {
    const script = npmScripts()[npmRun[1]];
    if (script) {
      const resolved = normalize(script);
      for (const t of Object.values(REGISTRY)) {
        const c = normalize(t.command || '');
        if (c && resolved.startsWith(c)) return t.name;
      }
    }
  }

  // 直接命令前缀匹配
  for (const t of Object.values(REGISTRY)) {
    const c = normalize(t.command || '');
    if (c && (cmd === c || cmd.startsWith(c + ' ') || cmd.startsWith(c + '\n'))) return t.name;
  }
  return null;
}

module.exports = { mapCommandToTool, npmScripts };
```

路径用 `PKG_PATH = path.join(__dirname, '..', '..', 'package.json')`（`src/tools` → `../..` = 仓库根），Step 5 的测试验证 npm run → 命令解析是否命中。

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test src/tools/command-map.test.js`
Expected: PASS（若 require 路径错，修成 `path.join(__dirname,'..','..','package.json')`）。

- [ ] **Step 5: 实现 harness-usage.js**

`scripts/harness-usage.js`：
```js
#!/usr/bin/env node
// harness-usage.js — PostToolUse(Bash) 钩子：每次 Bash 调用记使用日志（评审 P0-2）
// stdin: Claude Code PostToolUse hook JSON（tool_name / tool_input.command / exit_code / duration_ms）
const fs = require('fs');
const { logToolUse } = require('../src/tools/usage-logger');
const { mapCommandToTool } = require('../src/tools/command-map');

let input = {};
try { input = JSON.parse(fs.readFileSync(0, 'utf8')); } catch (e) { /* 非 JSON 输入忽略 */ }

const ti = input.tool_input || {};
const tr = input.tool_response || {};
const command = ti.command || ti.cmdline || '';
const tool = mapCommandToTool(command) || 'bash_other';
// exit_code 可能在顶层（PreToolUse）或 tool_response 里（PostToolUse），容错取
const exitCode = input.exit_code ?? tr.exit_code;

logToolUse({
  tool,
  trigger: 'ai_call',
  success: exitCode === 0,
  durationMs: input.duration_ms || 0,
  files: ti.file_path ? [ti.file_path] : [],
  meta: { command: command.slice(0, 120) },
});
process.exit(0);
```

- [ ] **Step 6: 接线 settings.json PostToolUse Bash hook**

`.claude/settings.json` 的 `hooks.PostToolUse` 数组加一条：
```json
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "cd /e/claude/ai-news-monitor && node scripts/harness-usage.js"
          }
        ]
      }
```

- [ ] **Step 7: 手动冒烟（不触网、不调真实工具）**

Run: `echo '{"tool_name":"Bash","tool_input":{"command":"node scripts/ops-check.js --light"},"exit_code":0,"duration_ms":42}' | node scripts/harness-usage.js`
Expected: 无输出、exit 0；`tail -1 logs/.tool-usage.jsonl` 出现 `"tool":"ops_check"`。测试后删除该行：`git checkout -- logs/.tool-usage.jsonl`（logs 已 gitignore，若在 git 内则手工删行）。

- [ ] **Step 8: Commit**

```bash
git add src/tools/command-map.js src/tools/command-map.test.js scripts/harness-usage.js .claude/settings.json
node scripts/git-commit.js "feat(tools): command-map + usage hook 让使用日志真实捕获 Bash 调用（P0-2）"
```

---

### Task 5: registry 参数 ↔ 真实 flag 映射 + 脚本补命名参数（P2-8 / P3-10）

**Files:**
- Modify: `src/tools/registry.js`（18 工具全加 `cli_template`；修正 P3-10 kebab 注释）
- Modify: `scripts/test-scrape.js`（接受 `--url` / `--source`）
- Modify: `scripts/check-quality.js`（loadInputs 接受 `--report-path` / `--log-path`）
- Modify: `src/tools/registry.js`（新增 `--check-cli` 模式 + `validateCli()`）
- Test: `src/tools/registry.test.js`（新建）

**Interfaces:**
- Consumes: `REGISTRY`（各工具新增 `cli_template` 字符串）；`validateCli(registry)` 校验每个工具的 parameters 名在其脚本文件中出现。
- Produces: `node src/tools/registry.js --check-cli` 输出一致性警告（非阻断）。

- [ ] **Step 1: 写 registry.test.js**

`src/tools/registry.test.js`：
```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { REGISTRY, getStats } = require('./registry');
const { validateCli } = require('./registry'); // 同模块导出

test('getStats: 18 工具 / 5 核 / 13 按需', () => {
  const s = getStats();
  assert.equal(s.total, 18);
  assert.equal(s.core, 5);
  assert.equal(s.deferred, 13);
});

test('每个工具都有非空 cli_template（真实命令模板）', () => {
  for (const [name, t] of Object.entries(REGISTRY)) {
    assert.ok(t.cli_template && /(node |npm )/.test(t.cli_template),
      `${name} 缺 cli_template（应含 node 或 npm 调用）`);
  }
});

// 说明：不做"每个参数名必须出现在 cli_template"的强断言——语义参数（mode/action/skipCheck
// 等）的真实 flag 与 kebab 名不同（--light/--info/--no-check），模板本就用真实 flag。
// 参数↔flag 一致性由 registry --check-cli 的 validateCli() 做 best-effort 警告（非阻断）。
test('validateCli 不抛异常且返回数组', () => {
  const warns = validateCli();
  assert.ok(Array.isArray(warns));
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test src/tools/registry.test.js`
Expected: FAIL（缺 cli_template）。

- [ ] **Step 3: 给 18 个工具加 cli_template**

对 `REGISTRY` 每个工具对象加一个 `cli_template` 字段（紧挨 `command` 后）。模板用仓库根为 cwd、占位符 `<param>` 可替换：

| 工具 | cli_template |
|------|--------------|
| check_all | `npm run check` |
| check_test | `npm test` |
| commit_git | `node scripts/git-commit.js "<message>" [-p] [-n] [-a]` |
| pipeline_run | `node scripts/run-pipeline.js [--no-docker] [--no-alert] [--ci]` |
| ops_check | `node scripts/ops-check.js [--light|--actions]` |
| check_syntax | `npm run lint:backend` |
| check_type | `npm run type-check` |
| check_quality | `node scripts/check-quality.js [--report-path <report_path>] [--log-path <log_path>]` |
| pipeline_schedule | `node scripts/install-schedule.js [--info|--remove]` |
| pipeline_auto_heal | `node scripts/auto-heal.js` |
| data_backfill | `node scripts/backfill-resummarize.js [--dry-run] [--lt60] [--keyword <keyword>] [--limit <limit>] [--pool <pool>]` |
| data_dedup | `node scripts/dedup-existing.js [--dry-run|--apply] [--keyword <keyword>] [--days <days>] [--keep-ids <keep_ids>]` |
| ops_screenshot | `node scripts/screenshot-ui.js [--url <url>] [--out <out>] [--wait <wait>] [--width <width>] [--height <height>]` |
| ops_docker_restart | `npm run ops:docker-restart` |
| test_scrape | `node scripts/test-scrape.js [--url <url>] [--source <source_name>]` |
| seed_demo | `node scripts/seed-demo.js` |
| update_sources | `node scripts/update-sources.js --keyword <keyword>` |
| harness_diagnose | `node scripts/harness-diagnose.js --harness <harness_type> [--file <file_path>] [--json]` |

同时修正 P3-10：`registry.js:11` 注释 `kebab-case` → `snake_case`。

- [ ] **Step 4: 修 test-scrape.js 接受 --url/--source**

`scripts/test-scrape.js` 顶部 `main` 前加参数解析，`main` 改为可注入 targets：
```js
const argv = process.argv.slice(2);
function argVal(name) {
  const i = argv.indexOf('--' + name);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
}
async function main() {
  const url = argVal('url');
  const name = argVal('source');
  const targets = url ? [{ url, name: name || 'custom' }] : urls;
  for (const { url: u, name: n } of targets) {
    await test(u, n);
  }
}
```
（`test(url, name)` 函数本体不变。）

- [ ] **Step 5: 修 check-quality.js 接受命名参数**

`scripts/check-quality.js` 的 `loadInputs(argv)` 改为：
```js
function loadInputs(argv) {
  const today = ...; // 保留现有 today 计算
  function argFlag(name) {
    for (const a of argv) {
      if (a.startsWith(`--${name}=`)) return a.slice(`--${name}=`.length);
      const i = argv.indexOf(`--${name}`);
      if (i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1];
    }
    return null;
  }
  const reportPath = argFlag('report-path') || argv[2] || path.join(__dirname, '..', 'reports', `${today}.md`);
  const logPath = argFlag('log-path') || argv[3] || path.join(process.cwd(), 'run.log');
  // ...原有读取逻辑不变
}
```

- [ ] **Step 6: registry --check-cli 模式**

`registry.js` 的 `require.main === module` 守卫内，在 `--check-cli` 时调用 `validateCli()`：
```js
function validateCli(reg = REGISTRY) {
  const warnings = [];
  for (const [name, t] of Object.entries(reg)) {
    const scriptPath = /node scripts\/([\w-]+)\.js/.exec(t.command || '');
    if (!scriptPath) continue;
    const fp = path.join(__dirname, '..', '..', 'scripts', `${scriptPath[1]}.js`);
    let text = '';
    try { text = fs.readFileSync(fp, 'utf8'); } catch { warnings.push(`${name}: 找不到脚本 ${fp}`); continue; }
    for (const p of Object.keys(t.parameters.properties || {})) {
      const kebab = p.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
      if (!text.includes(`--${kebab}`) && !text.includes(`--${p}`) && p !== 'message') {
        warnings.push(`${name}: 参数 ${p}（--${kebab}）未在脚本 ${scriptPath[1]}.js 中发现`);
      }
    }
  }
  return warnings;
}
```
`registry.js` 顶部需 `const path = require('path'); const fs = require('fs');`（检查是否已有）。`module.exports` 需把 `validateCli` 一并导出（registry.test.js 从 './registry' 导入它）。守卫里：
```js
if (process.argv.includes('--check-cli')) {
  const warns = validateCli();
  if (warns.length) {
    console.warn('\n⚠️  cli 一致性警告（best-effort，非阻断）:');
    warns.forEach(w => console.warn('  - ' + w));
  } else {
    console.log('  ✓ 工具参数与脚本 flag 大体一致（脚本未见参数名的会列在警告）');
  }
}
```

- [ ] **Step 7: 跑测试确认通过**

Run: `node --test src/tools/registry.test.js`
Expected: PASS。Run: `node src/tools/registry.js --check-cli`
Expected: 输出统计 + 一致性警告列表（test_scrape 修后应消失，commit_git 的 message 例外）。

- [ ] **Step 8: 跑全套验证 + 冒烟**

Run: `npm run check`
Run: `node scripts/test-scrape.js --url https://example.com --source smoke`（应只测 1 个 URL，不再硬编码 6 个）
Run: `node scripts/check-quality.js --report-path reports/2026-08-13.md --log-path run.log`（正常解析，退出码按现有逻辑）

- [ ] **Step 9: Commit**

```bash
git add src/tools/registry.js src/tools/registry.test.js scripts/test-scrape.js scripts/check-quality.js
node scripts/git-commit.js "feat(tools): 18 工具加 cli_template + 脚本补命名参数 + --check-cli 校验（P2-8/P3-10）"
```

---

### Task 6: CI 一致性校验 + 文档对齐（P3-9 + 文档状态）

**Files:**
- Modify: `package.json`（加 `check:tools`）
- Modify: `.github/workflows/ops-check.yml`（加 `npm run check:tools` step）
- Modify: `docs/PROGRESS-tools-tool-use-optimization.md`（v2 状态、Phase 3 修复记录）
- Modify: `docs/REQ-tools-tool-use-optimization.md`（item 8 状态注）
- Modify: `docs/DECISION-tools-tool-use-optimization.md`（item 11 状态）
- Modify: `docs/REQ-tools-hook-usage-graph.md`（补充 P1-3/P0-2 修复说明）
- Modify: `docs/tools-dashboard.html`（若存在，标注「待优化」区；不存在则跳过）

**Interfaces:**
- Consumes: Task 1/5 的 `npm test` glob 与 `--check-cli`。
- Produces: `npm run check:tools` = registry 一致性 + tools 测试一次跑。

- [ ] **Step 1: package.json 加 check:tools**

```json
"check:tools": "node src/tools/registry.js --check-cli && node --test \"src/tools/*.test.js\""
```

- [ ] **Step 2: ops-check.yml 加 step**

`.github/workflows/ops-check.yml` 的 `ops-check` job，在 `- name: Run ops check` 之后加：
```yaml
      - name: Tool registry consistency
        run: npm run check:tools
```

- [ ] **Step 3: 本地验证 check:tools**

Run: `npm run check:tools`
Expected: 输出 registry 统计 + ✓ 一致性 + tools 全部测试 PASS（graph 23 + plan-checks 8 + command-map 6 + registry 2）。

- [ ] **Step 4: 文档状态对齐**

- `docs/PROGRESS-tools-tool-use-optimization.md`：维度 9 状态 `✅ done` 注释改为 `✅ 已接线 v2（AI_FC=v1 可回退，观察期）`；「当前阶段」段补一句「2026-08-13 评审修复已合并（前端误触发 / v2 接线 / usage hook / suggest 语义 / cli_template）」。新增一行记录 `usage hook（PostToolUse Bash）已接入`。
- `docs/REQ-tools-tool-use-optimization.md` 验收表 item 8：`✅ 已接线 v2（env AI_FC=v1 可回退）`。
- `docs/DECISION-tools-tool-use-optimization.md` 验收 item 11：`[ ]` → `[x] 已接线（AI_FC=v1 回退已验证）`。
- `docs/REQ-tools-hook-usage-graph.md`：验收表加一行「P1-3 前端不误触发 / P0-2 usage 全量捕获已落地」。

- [ ] **Step 5: 全套验证 + 冒烟**

Run: `npm run check`（全绿）
Run: `echo '{"tool_input":{"file_path":"client/src/App.tsx"}}' | node scripts/harness-check.js --json`（确认前端无 syntax 失败）

- [ ] **Step 6: Commit**

```bash
git add package.json .github/workflows/ops-check.yml docs/PROGRESS-tools-tool-use-optimization.md docs/REQ-tools-tool-use-optimization.md docs/DECISION-tools-tool-use-optimization.md docs/REQ-tools-hook-usage-graph.md docs/tools-optimization-roadmap-review.html
node scripts/git-commit.js "chore(tools): CI 一致性校验 + 文档状态对齐 + 评审路线图（P3-9）"
```

---

## 完成后验收清单

- [ ] `npm run check` 全绿（含新增 tools 测试）
- [ ] `npm run check:tools` 通过（registry 一致性 + 4 个 tools 测试文件）
- [ ] 前端 .tsx 编辑 → harness-check 只跑 type_check+lint，无假失败（Task 1 Step 8）
- [ ] 管线默认走 v2 function calling，`AI_FC=v1` 可回退（Task 3 Step 7）
- [ ] 每次 Bash 调用进 `logs/.tool-usage.jsonl`，映射到 18 工具名（Task 4 Step 7）
- [ ] `node src/tools/registry.js --check-cli` 无新警告（Task 5）
- [ ] CI ops-check 含 `npm run check:tools`（Task 6）
- [ ] 文档状态与代码实际一致（无悬空 ✅）
