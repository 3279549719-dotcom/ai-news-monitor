'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseAnalyzeResult, buildCategoryHint, buildAnalyzePrompt } = require('./ai');
const ai = require('./ai');

test('解析合法 JSON', () => {
  const r = parseAnalyzeResult('{"score": 82, "summary": "概述", "event": "事件", "category": "transfer"}');
  assert.deepEqual(r, { relevant: true, score: 82, summary: '概述', event: '事件', category: 'transfer', event_type: '' });
});

test('score 低于门槛 → 不相关', () => {
  const r = parseAnalyzeResult('{"score": 40}');
  assert.equal(r.relevant, false);
  assert.equal(r.score, 40);
});

test('score 越界钳制到 [0,100]', () => {
  assert.equal(parseAnalyzeResult('{"score": 200}').score, 100);
  assert.equal(parseAnalyzeResult('{"score": -5}').score, 0);
});

test('markdown 围栏被剥离', () => {
  const r = parseAnalyzeResult('```json\n{"score": 75, "summary": "s"}\n```');
  assert.equal(r.relevant, true);
  assert.equal(r.score, 75);
});

test('脏前缀只取 JSON 对象', () => {
  const r = parseAnalyzeResult('好的，结果如下：{"score": 66} 结尾');
  assert.equal(r.relevant, true);
  assert.equal(r.score, 66);
});

test('非 JSON 文本 → 容错返回不相关', () => {
  assert.deepEqual(parseAnalyzeResult('not json at all'), { relevant: false, score: 0, summary: '', event: '', category: '', event_type: '' });
});

test('score 非数字 → 0', () => {
  assert.equal(parseAnalyzeResult('{"score": "abc"}').score, 0);
});

// ── 黄金样本（Phase8 S6）：只断言 prompt 构建文本，不调用真实 API ──

test('Yoro 访谈标题 → 归类指令含"访谈/人物特写 → other"', () => {
  const schema = { injury: '伤病', transfer: '转会', other: '其他' };
  const prompt = buildAnalyzePrompt({ query: 'manchester united', title: 'Leny Yoro exclusive interview: settling in at Old Trafford', snippet: 'snippet', tierHint: '', categoryHint: buildCategoryHint(schema), body: '' });
  assert.ok(prompt.includes('访谈/人物特写'));
  assert.ok(prompt.includes('→ other'));
  assert.ok(prompt.includes('永远不是 injury'));
});

test('"ruled out six weeks" 可归 injury', () => {
  const schema = { injury: '伤病', other: '其他' };
  const prompt = buildAnalyzePrompt({ query: 'manchester united', title: 'Rashford ruled out for six weeks with injury', snippet: 'snippet', tierHint: '', categoryHint: buildCategoryHint(schema), body: '' });
  assert.ok(prompt.includes('injury'));
  assert.ok(prompt.includes('恢复时间表'));
});

test('"agree £50m fee" 归 deal/transfer', () => {
  const schema = { transfer: '转会', other: '其他' };
  const prompt = buildAnalyzePrompt({ query: 'manchester united', title: 'Man Utd agree £50m fee for winger', snippet: 'snippet', tierHint: '', categoryHint: buildCategoryHint(schema), body: '' });
  assert.ok(prompt.includes('deal(转会/签约/续约)'));
});

test('访谈永不归 injury', () => {
  const schema = { injury: '伤病', other: '其他' };
  const prompt = buildAnalyzePrompt({ query: 'manchester united', title: 'Yoro interview: my first month at United', snippet: 'snippet', tierHint: '', categoryHint: buildCategoryHint(schema), body: '' });
  assert.ok(prompt.includes('访谈/特写永远不是 injury'));
});

test('JSON 输出格式含 event_type', () => {
  const prompt = buildAnalyzePrompt({ query: 'anthropic', title: 'Anthropic 宣布攻破 3 家公司', snippet: '', tierHint: '', categoryHint: buildCategoryHint({ other: '其他' }), body: '' });
  assert.ok(prompt.includes('"event_type":"体裁key或空"'));
});

test('正文片段按 body 渲染（可选事实锚点）', () => {
  const prompt = buildAnalyzePrompt({ query: 'anthropic', title: 'Anthropic 宣布攻破 3 家公司', snippet: 'snippet', tierHint: '', categoryHint: '', body: '攻击者利用 Anyscale 环境变量泄露窃取了机密训练权重。' });
  assert.ok(prompt.includes('正文片段：攻击者利用 Anyscale 环境变量泄露窃取了机密训练权重。'));
});

// ── P0-1 Smart 路由 DI 测试（不触网，注入 fake {v1,v2}）──

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
