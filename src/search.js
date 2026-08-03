const axios = require('axios');
const { fetchDirectSources } = require('./scraper-direct');
const { getTier } = require('./tiers');

// HackerNews via Algolia API — best for tech topics, free
async function searchHackerNews(query) {
  try {
    const since = Math.floor(Date.now() / 1000) - 7 * 24 * 3600;
    const url =
      `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}` +
      `&tags=story&hitsPerPage=10&numericFilters=created_at_i>${since}`;
    const { data } = await axios.get(url, { timeout: 10000 });

    return (data.hits || [])
      .filter(h => h.url)
      .map(h => ({
        title: h.title || '',
        url: h.url,
        source: 'hackernews',
        snippet: (h.story_text || '').replace(/<[^>]+>/g, '').slice(0, 300),
        publishedAt: h.created_at ? new Date(h.created_at) : null,
        tier: getTier(h.url),
      }));
  } catch (err) {
    console.error(`  [HackerNews] 搜索失败: ${err.message}`);
    return [];
  }
}

// Deduplicate by normalized URL, keeping the entry with the lower (more trusted) tier.
function deduplicateByUrl(results) {
  const tierOf = r => (r.tier === null || r.tier === undefined) ? Infinity : r.tier;
  const map = new Map();

  for (const r of results) {
    const key = r.url
      .replace(/^https?:\/\/(www\.)?/, '')
      .replace(/[?#].*$/, '')
      .replace(/\/$/, '');
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

async function searchAll(query, keywordSources = []) {
  const configuredSources = keywordSources.filter(s => s.fetch_type === 'firecrawl' && s.scrape_url);

  const tasks = [];
  // HackerNews only when no whitelist sources configured
  if (configuredSources.length === 0) {
    tasks.push(searchHackerNews(query));
  }
  if (configuredSources.length > 0) {
    tasks.push(fetchDirectSources(configuredSources));
  }

  const settled = await Promise.allSettled(tasks);

  const combined = [];
  for (const res of settled) {
    if (res.status === 'fulfilled') {
      combined.push(...res.value);
    }
  }

  return deduplicateByUrl(combined);
}

module.exports = { searchAll, searchHackerNews };
