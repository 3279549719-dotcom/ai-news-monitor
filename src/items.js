'use strict';

/**
 * Item normalization utilities.
 *
 * Converts raw scraped articles into the shared "item" shape used by the
 * pipeline (crawl4ai and scraper-direct both feed through here). Also provides
 * URL canonicalization for dedupe keys.
 */

/**
 * Slugify a source name: lowercase, whitespace -> hyphen.
 * @param {string} name - Source display name.
 * @returns {string} Slug, e.g. "Manchester United" -> "manchester-united".
 */
function sourceSlug(name) {
  return (name || '').toLowerCase().replace(/\s+/g, '-');
}

/**
 * Build a pipeline item from a raw article and its source descriptor.
 * @param {Object} source - Source row (source_name, tier).
 * @param {{title:string, url:string, publishedAt?:Date|null}} a - Raw article.
 * @returns {Object} Normalized item with empty snippet and computed slug.
 */
function toItem(source, { title, url, publishedAt }) {
  return {
    title,
    url,
    snippet: '',
    publishedAt: publishedAt || null,
    source_name: source.source_name,
    source: sourceSlug(source.source_name),
    tier: source.tier,
  };
}

/**
 * Canonicalize a URL into a dedupe key: strip protocol, leading www, query
 * string, and trailing slash.
 * @param {string} url - Raw URL.
 * @returns {string} Canonical key.
 */
function normalizeUrlKey(url) {
  return (url || '')
    .replace(/^https?:\/\/(www\.)?/i, '')
    .replace(/[?#].*$/, '')
    .replace(/\/$/, '');
}

/**
 * 模块级纯函数：构造入库记录
 * @param {Object} item    - 文章对象（title, url, source, snippet, publishedAt, tier）
 * @param {Object} keyword - 关键词对象（id, type, category_schema）
 * @param {Object} overrides - 额外字段（summary, score, category, event, ...）
 */
function toArticleRecord(item, keyword, overrides = {}) {
  const schemaKeys = keyword.category_schema && !Array.isArray(keyword.category_schema)
    ? Object.keys(keyword.category_schema)
    : [];

  return {
    keyword_id: keyword.id,
    title: item.title,
    url: item.url,
    source: item.source || keyword.type,
    snippet: item.snippet || null,
    published_at: item.publishedAt ? new Date(item.publishedAt).toISOString() : null,
    source_tier: item.tier ?? null,
    ...overrides,
    category: overrides.category && schemaKeys.includes(overrides.category) ? overrides.category : null,
  };
}

module.exports = { sourceSlug, toItem, normalizeUrlKey, toArticleRecord };
