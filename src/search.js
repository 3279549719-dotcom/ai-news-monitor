const axios = require('axios');
const { fetchSource } = require('./scraper-direct');
const crawl4ai = require('./crawl4ai-fetch');
const { getTier } = require('./tiers');
const { toItem, normalizeUrlKey } = require('./items');

// HackerNews via Algolia API — best for tech topics, free
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
        // HN 特有字段补充
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

// Deduplicate by normalized URL, keeping the entry with the lower (more trusted) tier.
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

// crawl4ai 优先；失败/空结果降级 scraper-direct；X 账号仅走 crawl4ai（axios 抓 X 无意义）
async function fetchSourceWithFallback(source) {
  try {
    const items = await crawl4ai.fetchSourceArticles(source);
    if (items.length === 0) throw new Error('crawl4ai 空结果');
    console.log(`  [Crawl4ai] ${source.source_name}: ${items.length} 篇`);
    return items;
  } catch (err) {
    if (crawl4ai.isXUrl(source.scrape_url)) {
      console.log(`  [Crawl4ai] X 源 ${source.source_name} 无结果，跳过降级: ${err.message}`);
      return [];
    }
    console.log(`  [Crawl4ai] ${source.source_name} → 降级 Direct: ${err.message}`);
    try { return await fetchSource(source); } catch (e) {
      console.error(`  [Direct] ${source.source_name} 降级也失败: ${e.message}`);
      return [];
    }
  }
}

async function searchAll(query, keywordSources = []) {
  const configuredSources = keywordSources.filter(s => s.fetch_type === 'firecrawl' && s.scrape_url);

  const combined = [];
  // HackerNews only when no whitelist sources configured
  if (configuredSources.length === 0) {
    combined.push(...await searchHackerNews(query));
  } else {
    // 逐源顺序抓取（避免并发压垮 crawl4ai 容器）
    for (const source of configuredSources) {
      combined.push(...await fetchSourceWithFallback(source));
    }
  }

  return deduplicateByUrl(combined);
}

module.exports = { searchAll, deduplicateByUrl };
