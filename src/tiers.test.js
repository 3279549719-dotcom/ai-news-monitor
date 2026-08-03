'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getTier } = require('./tiers');

test('getTier 命中已知域名', () => {
  assert.equal(getTier('https://www.manutd.com/en/news'), 0);
  assert.equal(getTier('https://www.bbc.co.uk/sport/football'), 1);
  assert.equal(getTier('https://x.com/sistoney67'), 1);
  assert.equal(getTier('https://theguardian.com/football/manchester-united'), 2);
  assert.equal(getTier('https://www.skysports.com/manchester-united'), 2);
});

test('getTier 忽略 www 前缀', () => {
  assert.equal(getTier('https://manutd.com/en/news'), 0);
  assert.equal(getTier('https://www.manutd.com/en/news'), 0);
});

test('getTier 未知域名返回 null', () => {
  assert.equal(getTier('https://unknown-blog.com/post'), null);
});

test('getTier 非法输入不崩溃，返回 null', () => {
  assert.equal(getTier(''), null);
  assert.equal(getTier(null), null);
  assert.equal(getTier(undefined), null);
  assert.equal(getTier('not a url'), null);
});
