'use strict';

// 把抓取到的原始文章规整为入库 items 形状（crawl4ai 与 scraper-direct 两通道共用）

function sourceSlug(name) {
  return (name || '').toLowerCase().replace(/\s+/g, '-');
}

function toItem(source, { title, url, publishedAt }) {
  return {
    title,
    url,
    snippet: '',
    publishedAt: publishedAt || new Date(),
    source_name: source.source_name,
    source: sourceSlug(source.source_name),
    tier: source.tier,
  };
}

module.exports = { sourceSlug, toItem };
