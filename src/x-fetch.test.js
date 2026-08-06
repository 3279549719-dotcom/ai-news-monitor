'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const xFetch = require('./x-fetch');

test('twikit 有结果时用 twikit 行，不调用 crawl4ai', async () => {
  const source = {
    scrape_url: 'https://x.com/David_Ornstein',
    source_name: 'David Ornstein (X)',
    tier: 1,
  };
  const rows = [
    {
      handle: 'David_Ornstein',
      status_id: '1',
      text: 'Manchester United in talks with target.',
      created_at: '2026-08-07T00:00:00+00:00',
    },
  ];
  const origRun = xFetch.runTwikit;
  const origCrawl = xFetch.crawl4aiFetch;
  xFetch.runTwikit = () => rows;
  xFetch.crawl4aiFetch = {
    fetchSourceArticles: async () => {
      throw new Error('不应调用 crawl4ai');
    },
  };
  try {
    const items = await xFetch.fetchXSourceArticles(source);
    assert.equal(items.length, 1);
    assert.equal(items[0].url, 'https://x.com/David_Ornstein/status/1');
    assert.equal(items[0].title, 'Manchester United in talks with target.');
  } finally {
    xFetch.runTwikit = origRun;
    xFetch.crawl4aiFetch = origCrawl;
  }
});

test('twikit 空 → 回退 crawl4ai', async () => {
  const source = {
    scrape_url: 'https://x.com/sistoney67',
    source_name: 'Simon Stone (X)',
    tier: 1,
  };
  const origRun = xFetch.runTwikit;
  const origCrawl = xFetch.crawl4aiFetch;
  xFetch.runTwikit = () => [];
  xFetch.crawl4aiFetch = {
    fetchSourceArticles: async () => [
      {
        title: 'fallback',
        url: 'https://x.com/sistoney67/status/2',
        publishedAt: null,
        source: 'simon-stone-(x)',
        source_name: 'Simon Stone (X)',
        tier: 1,
        snippet: '',
      },
    ],
  };
  try {
    const items = await xFetch.fetchXSourceArticles(source);
    assert.equal(items.length, 1);
    assert.equal(items[0].url, 'https://x.com/sistoney67/status/2');
  } finally {
    xFetch.runTwikit = origRun;
    xFetch.crawl4aiFetch = origCrawl;
  }
});
