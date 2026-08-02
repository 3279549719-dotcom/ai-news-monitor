const axios = require('axios');
const cheerio = require('cheerio');

// Google News RSS — public feed, no API key, clean XML
async function searchGoogleNews(query) {
  try {
    const url =
      `https://news.google.com/rss/search?q=${encodeURIComponent(query)}` +
      `&hl=en-US&gl=US&ceid=US:en`;
    const { data } = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 15000,
    });

    const $ = cheerio.load(data, { xmlMode: true });
    const results = [];

    $('item').each((_, el) => {
      const rawTitle = $(el).find('title').first().text().trim();
      const link = $(el).find('link').first().text().trim() ||
                   $(el).find('link').first().next().text().trim();
      const description = $(el).find('description').first().text()
        .replace(/<[^>]+>/g, '').trim();
      const pubDate = $(el).find('pubDate').first().text().trim();

      // Google News titles sometimes include " - Source Name" suffix
      const title = rawTitle.replace(/ - [^-]+$/, '').trim();
      const href = link || $(el).find('guid').first().text().trim();

      if (title && href && href.startsWith('http')) {
        results.push({
          title,
          url: href,
          source: 'google-news',
          snippet: description.slice(0, 300),
          publishedAt: pubDate ? new Date(pubDate) : null,
        });
      }
    });

    return results;
  } catch (err) {
    console.error(`  [Google News] 搜索失败: ${err.message}`);
    return [];
  }
}

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
      }));
  } catch (err) {
    console.error(`  [HackerNews] 搜索失败: ${err.message}`);
    return [];
  }
}

function deduplicateByUrl(results) {
  const seen = new Set();
  return results.filter(r => {
    const key = r.url
      .replace(/^https?:\/\/(www\.)?/, '')
      .replace(/[?#].*$/, '')
      .replace(/\/$/, '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function searchAll(query) {
  const [gnRes, hnRes] = await Promise.allSettled([
    searchGoogleNews(query),
    searchHackerNews(query),
  ]);

  const combined = [
    ...(gnRes.status === 'fulfilled' ? gnRes.value : []),
    ...(hnRes.status === 'fulfilled' ? hnRes.value : []),
  ];

  return deduplicateByUrl(combined);
}

module.exports = { searchAll, searchGoogleNews, searchHackerNews };
