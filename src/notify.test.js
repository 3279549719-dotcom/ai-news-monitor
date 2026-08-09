'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveChannels, notify } = require('./notify');

test('resolveChannels：逗号分隔解析', () => {
  assert.deepEqual(resolveChannels({ channels: 'email,telegram' }), ['email', 'telegram']);
});

test('resolveChannels：空串/纯空白 → 空数组', () => {
  assert.deepEqual(resolveChannels({ channels: '' }), []);
  assert.deepEqual(resolveChannels({ channels: ' , ' }), []);
});

test('notify：单通道成功 → sent:true 透传 subject', async () => {
  const registry = { email: async () => ({ sent: true }) };
  const r = await notify({ subject: 'S', text: 'T' }, { channels: ['email'], registry });
  assert.equal(r.sent, true);
  assert.equal(r.subject, 'S');
});

test('notify：某通道失败不影响其他通道', async () => {
  const registry = {
    bad: async () => { throw new Error('boom'); },
    ok: async () => ({ sent: true }),
  };
  const r = await notify({ subject: 'S' }, { channels: ['bad', 'ok'], registry });
  assert.equal(r.sent, true);
  assert.equal(r.results.length, 2);
});

test('notify：全通道失败 → sent:false 带原因', async () => {
  const registry = { email: async () => ({ sent: false, reason: 'SMTP 未配置' }) };
  const r = await notify({ subject: 'S' }, { channels: ['email'], registry });
  assert.equal(r.sent, false);
  assert.equal(r.reason, 'SMTP 未配置');
});

test('notify：无通道 → sent:false 不抛错', async () => {
  const r = await notify({ subject: 'S' }, { channels: [] });
  assert.equal(r.sent, false);
  assert.equal(r.reason, 'no channels configured');
});

test('notify：未知通道名跳过，不抛错', async () => {
  const r = await notify({ subject: 'S' }, { channels: ['zzz'], registry: {} });
  assert.equal(r.sent, false);
});
