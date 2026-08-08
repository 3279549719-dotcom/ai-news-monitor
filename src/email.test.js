'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildDigestText, buildDigestHtml, buildSubject, isEmailConfigured, sendEmail, sendDailyDigest } = require('./email');

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

test('buildDigestHtml：按关键词分组渲染标题链接与 tier/score', () => {
  const html = buildDigestHtml(SECTIONS);
  assert.match(html, />MU - 曼联信源监控 <span/);
  assert.match(html, /<a href="https:\/\/www\.manutd\.com\/a"/);
  assert.match(html, /Man Utd 官宣续约/);
  assert.match(html, /T0 · 90分/);
  assert.match(html, /Ornstein 转会消息/);
  assert.match(html, /T1 · 80分/);
  assert.doesNotMatch(html, /Anthropic/); // 空结果组不渲染
});

test('buildDigestHtml：标题特殊字符被转义', () => {
  const html = buildDigestHtml([
    { keyword: { name: 'A&B <X>' }, results: [{ title: '标题 <script>alert(1)</script>', url: 'https://x.com/?a=1&b=2' }] },
  ]);
  assert.match(html, /A&amp;B &lt;X&gt;/);
  assert.match(html, /标题 &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /https:\/\/x\.com\/\?a=1&amp;b=2/);
  assert.doesNotMatch(html, /<script>/);
});

test('buildDigestHtml：缺 tier/score 不渲染 meta 行', () => {
  const html = buildDigestHtml(SECTIONS);
  assert.match(html, /无评分无 tier 项/);
  assert.doesNotMatch(html, /Tundefined/);
  assert.doesNotMatch(html, /undefined分/);
});

test('buildDigestHtml：空结果输出"今日无新增"', () => {
  const html = buildDigestHtml([]);
  assert.match(html, /相关新内容 <b>0<\/b> 条/);
  assert.match(html, /今日无新增关注内容。/);
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
