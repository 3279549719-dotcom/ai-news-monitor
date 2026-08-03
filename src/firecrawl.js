const axios = require('axios');

const FIRECRAWL_API = 'https://api.firecrawl.dev/v1/scrape';
const RETRY_COUNT = 2;
const REQUEST_DELAY_MS = 2000;

const EXTRACT_SCHEMA = {
  type: 'object',
  properties: {
    articles: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          url: { type: 'string' },
          publishedDate: { type: 'string' },
        },
        required: ['title', 'url'],
      },
    },
  },
};

async function scrapeWithRetry(url, apiKey, attempts = RETRY_COUNT + 1) {
  for (let i = 0; i < attempts; i++) {
    try {
      const { data } = await axios.post(
        FIRECRAWL_API,
        {
          url,
          formats: ['extract'],
          extract: {
            prompt: 'Extract all news article items from this page. Return articles array.',
            schema: EXTRACT_SCHEMA,
          },
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        }
      );
      return data;
    } catch (err) {
      if (i < attempts - 1) continue;
      throw err;
    }
  }
}

async function fetchFirecrawlSources(sources) {
  if (!sources || sources.length === 0) return [];

  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    console.warn('[Firecrawl] FIRECRAWL_API_KEY 未设置，跳过 firecrawl 源');
    return [];
  }

  const enabledSources = sources.filter(s => s.enabled !== false);
  if (enabledSources.length === 0) return [];

  const seen = new Set();
  const results = [];

  for (let i = 0; i < enabledSources.length; i++) {
    const source = enabledSources[i];

    if (i > 0) {
      await new Promise(r => setTimeout(r, REQUEST_DELAY_MS));
    }

    try {
      const data = await scrapeWithRetry(source.scrape_url, apiKey);
      const articles = data?.data?.extract?.articles || data?.extract?.articles || [];

      for (const item of articles) {
        if (!item.url || seen.has(item.url)) continue;
        seen.add(item.url);

        let publishedAt;
        if (item.publishedDate) {
          const d = new Date(item.publishedDate);
          publishedAt = isNaN(d.getTime()) ? new Date() : d;
        } else {
          publishedAt = new Date();
        }

        results.push({
          title: item.title || '',
          url: item.url,
          snippet: '',
          publishedAt,
          source_name: source.source_name,
          source: source.source_name.toLowerCase().replace(/\s+/g, '-'),
          tier: source.tier,
        });
      }
    } catch (err) {
      console.log(`[Firecrawl] 跳过 ${source.source_name}: ${err.message}`);
    }
  }

  return results;
}

module.exports = { fetchFirecrawlSources };
