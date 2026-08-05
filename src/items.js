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

module.exports = { sourceSlug, toItem, normalizeUrlKey };
