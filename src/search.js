const axios = require('axios');
const { getTier } = require('./tiers');
const { toItem, normalizeUrlKey } = require('./items');
const { MAX_PER_SOURCE } = require('./config');
const { fetchSourceWithChain } = require('./fetch-chain');

/**
 * Search orchestration for the search keyword type.
 *
 * When a keyword has whitelist sources configured, fetches each source through
 * its backend chain (fetch-chain, driven by the source's backends config);
 * otherwise falls back to HackerNews. All results are URL-deduped keeping the
 * most trusted tier.
 */

// HackerNews via Algolia API — best for tech topics, free.
async function searchHackerNews(query) {
  try {
    const since = Math.floor(Date.now() / 1000) - 7 * 24 * 3600;
    const url =
      `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}` +
      `&tags=story&hitsPerPage=10&numericFilters=created_at_i>${since}`;
    const { data } = await axios.get(url, { timeout: 10000 });

    const fakeSource = { source_name: 'HackerNews', tier: null };

    return (data.hits || [])
      .filter(h => h.url)
      .map(h => {
        const item = toItem(fakeSource, {
          title: h.title || '',
          url: h.url,
          publishedAt: h.created_at ? new Date(h.created_at) : null,
        });
        // HN-specific field enrichment
        item.snippet = (h.story_text || '').replace(/<[^>]+>/g, '').slice(0, 300);
        item.source = 'hackernews';
        item.tier = getTier(h.url);
        return item;
      });
  } catch (err) {
    console.error(`  [HackerNews] 搜索失败: ${err.message}`);
    return [];
  }
}

/**
 * Deduplicate items by normalized URL, keeping the entry with the lower
 * (more trusted) tier. Items without a tier rank last (treated as Infinity).
 * @param {Array} results - Items with `url` and `tier`.
 * @returns {Array} Deduplicated items.
 */
function deduplicateByUrl(results) {
  const tierOf = r => (r.tier === null || r.tier === undefined) ? Infinity : r.tier;
  const map = new Map();

  for (const r of results) {
    const key = normalizeUrlKey(r.url);
    if (!map.has(key)) {
      map.set(key, r);
    } else {
      if (tierOf(r) < tierOf(map.get(key))) {
        map.set(key, r);
      }
    }
  }

  return Array.from(map.values());
}

/**
 * Sort whitelist sources by credibility tier (ascending): T0 official first,
 * then T1 (X journalists), then T2 media. Sources without a tier rank last.
 * Non-mutating. Ensures high-trust sources consume the analysis budget first.
 * @param {Array} sources - keyword_sources rows (each with `tier`).
 * @returns {Array} New array sorted by tier.
 */
function sortSourcesByTier(sources) {
  const tierOf = s => (s.tier === null || s.tier === undefined) ? Infinity : s.tier;
  return [...sources].sort((a, b) => tierOf(a) - tierOf(b));
}

/**
 * Cap a single source's contribution to the candidate pool (non-T0 sources).
 * Keeps one source from flooding the pool and starving others (e.g. X tweets
 * behind a media wall), while T0 official stays uncapped.
 * @param {Array} items - Items fetched for one source.
 * @param {number} maxPerSource - Upper bound.
 * @returns {Array} At most `maxPerSource` items (or the original when shorter).
 */
function capSourceItems(items, maxPerSource) {
  if (!Array.isArray(items) || items.length === 0) return items;
  return items.slice(0, maxPerSource);
}

/**
 * Main search entry: gather candidate items for a keyword query.
 * Uses whitelist sources when present (per-source sequential fetch to avoid
 * overloading the crawl4ai container), else HackerNews. Final URL dedupe.
 * @param {string} query - Search query.
 * @param {Array} [keywordSources=[]] - Whitelist sources for the keyword.
 * @returns {Promise<Array>} Deduplicated candidate items.
 */
async function searchAll(query, keywordSources = []) {
  const configuredSources = keywordSources.filter(s => s.fetch_type === 'firecrawl' && s.scrape_url);

  const combined = [];
  // HackerNews only when no whitelist sources configured
  if (configuredSources.length === 0) {
    combined.push(...await searchHackerNews(query));
  } else {
    // 高可信源优先（T0→T1→T2），保证 X 记者等 T1 推文先吃分析预算；
    // 非 T0 源每源上限 MAX_PER_SOURCE 条，防单源淹没、保证多源覆盖。
    const ordered = sortSourcesByTier(configuredSources);
    for (const source of ordered) {
      let items = await fetchSourceWithChain(source);
      const tier = source.tier ?? Infinity;
      if (tier > 0) items = capSourceItems(items, MAX_PER_SOURCE);
      combined.push(...items);
    }
  }

  return deduplicateByUrl(combined);
}

module.exports = { searchAll, deduplicateByUrl, sortSourcesByTier, capSourceItems };
