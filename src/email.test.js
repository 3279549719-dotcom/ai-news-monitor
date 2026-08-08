'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildDigestText, buildDigestHtml, buildSubject, isEmailConfigured, sendEmail, sendDailyDigest, isNotable, filterDigestSections } = require('./email');

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
