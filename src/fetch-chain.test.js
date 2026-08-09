'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveBackends, fetchSourceWithChain } = require('./fetch-chain');

test('resolveBackends：有 backends 配置直接返回', () => {
  assert.deepEqual(resolveBackends({ backends: ['crawl4ai'], scrape_url: 'https://claude.com/blog' }), ['crawl4ai']);
});

test('resolveBackends：无配置 + X URL → twikit 主链', () => {
  assert.deepEqual(resolveBackends({ scrape_url: 'https://x.com/someone' }), ['twikit', 'crawl4ai']);
});

test('resolveBackends：无配置 + 普通 URL → crawl4ai→direct', () => {
  assert.deepEqual(resolveBackends({ scrape_url: 'https://techcrunch.com/x' }), ['crawl4ai', 'direct']);
});

test('fetchSourceWithChain：首通道成功即返回，不再调后续通道', async () => {
  const calls = [];
  const registry = {
    a: async () => { calls.push('a'); return [{ url: 'https://x/1' }]; },
    b: async () => { calls.push('b'); return [{ url: 'https://x/2' }]; },
  };
  const items = await fetchSourceWithChain({ backends: ['a', 'b'] }, registry);
  assert.equal(items.length, 1);
  assert.deepEqual(calls, ['a']);
});

test('fetchSourceWithChain：首通道空数组 → 降级下一通道', async () => {
  const registry = {
    a: async () => [],
    b: async () => [{ url: 'https://x/2' }],
  };
  const items = await fetchSourceWithChain({ backends: ['a', 'b'] }, registry);
  assert.equal(items[0].url, 'https://x/2');
});

test('fetchSourceWithChain：首通道抛错 → 降级下一通道', async () => {
  const registry = {
    a: async () => { throw new Error('boom'); },
    b: async () => [{ url: 'https://x/2' }],
  };
  const items = await fetchSourceWithChain({ backends: ['a', 'b'] }, registry);
  assert.equal(items[0].url, 'https://x/2');
});

test('fetchSourceWithChain：全链失败返回空数组', async () => {
  const registry = {
    a: async () => { throw new Error('boom'); },
    b: async () => [],
  };
  const items = await fetchSourceWithChain({ backends: ['a', 'b'] }, registry);
  assert.deepEqual(items, []);
});

test('fetchSourceWithChain：未知通道名跳过继续，不抛错', async () => {
  const registry = { b: async () => [{ url: 'https://x/2' }] };
  const items = await fetchSourceWithChain({ backends: ['zzz', 'b'] }, registry);
  assert.equal(items[0].url, 'https://x/2');
});
