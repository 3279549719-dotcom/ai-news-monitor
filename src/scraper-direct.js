'use strict';

const axios = require('axios');
const OpenAI = require('openai');

const REQUEST_DELAY_MS = 2000;

let _openai = null;
function getAI() {
  if (!_openai) {
    _openai = new OpenAI({
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
    });
  }
  return _openai;
}

/**
 * Extract <a href="...">text</a> from HTML using regex (no CSS parsing).
 */
function extractLinks(html, baseUrl) {
  // Match <a ... href="..." ...>text</a>
  const linkRegex = /<a\s[^>]*?\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const links = [];
  const seen = new Set();

  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    const href = match[1];
    const rawText = match[2].replace(/<[^>]+>/g, '').trim().replace(/\s+/g, ' ');
    const text = rawText
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#x27;/g, '\'').replace(/&nbsp;/g, ' ');

    if (text.length < 20) continue;
    if (href.startsWith('#') || href.startsWith('javascript:')) continue;

    try {
      const fullUrl = new URL(href, baseUrl).href;
      const key = fullUrl.split('?')[0].split('#')[0];
      if (seen.has(key)) continue;
      seen.add(key);

      links.push({ text: text.substring(0, 200), url: fullUrl });
    } catch {}
  }

  return links.slice(0, 80);
}

async function scrapeSourceUrl(pageUrl, sourceName) {
  try {
    const { data: html } = await axios.get(pageUrl, {
      timeout: 20000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      maxRedirects: 5,
    });

    const links = extractLinks(html, pageUrl);
    if (links.length === 0) {
      console.log(`  [Direct] ${sourceName}: 未提取到链接`);
      return [];
    }

    // Ask AI to pick article links
    const linkList = links.map((l, i) => `[${i}] ${l.text}\n  URL: ${l.url}`).join('\n');

    const ai = getAI();
    const response = await ai.chat.completions.create({
      model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
      messages: [
        {
          role: 'system',
          content: `You are a web scraping assistant. From a list of links extracted from "${sourceName}" (page: ${pageUrl}), identify which are NEWS ARTICLES. Ignore navigation/menu/footer/social/homepage/trending-topic links. Return ONLY a JSON array: [{"index": number, "title": "clean title"}, ...]. Index refers to [N] number. Return [] if no articles found. No markdown, no explanation.`
        },
        { role: 'user', content: linkList },
      ],
      temperature: 0,
      max_tokens: 2000,
    });

    const raw = response.choices[0].message.content.trim();
    const jsonStr = raw.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
    let articles;
    try {
      articles = JSON.parse(jsonStr);
    } catch {
      console.log(`  [Direct] ${sourceName}: AI 返回非 JSON: ${raw.substring(0, 80)}`);
      return [];
    }

    if (!Array.isArray(articles)) return [];

    return articles
      .map(a => ({
        title: a.title || '',
        url: links[a.index]?.url || '',
        publishedAt: new Date(),
      }))
      .filter(a => a.url);

  } catch (err) {
    console.log(`  [Direct] ${sourceName} 跳过: ${err.message}`);
    return [];
  }
}

// 抓单个信源，返回 items 数组（供 search.js 逐源降级调用）
async function fetchSource(source) {
  console.log(`  [Direct] 抓取 ${source.source_name}...`);
  const articles = await scrapeSourceUrl(source.scrape_url, source.source_name);
  console.log(`  [Direct] ${source.source_name}: 找到 ${articles.length} 篇`);

  const sourceSlug = source.source_name.toLowerCase().replace(/\s+/g, '-');
  return articles
    .filter(item => item.url)
    .map(item => ({
      title: item.title,
      url: item.url,
      snippet: '',
      publishedAt: item.publishedAt || new Date(),
      source_name: source.source_name,
      source: sourceSlug,
      tier: source.tier,
    }));
}

async function fetchDirectSources(sources) {
  if (!sources || sources.length === 0) return [];

  const enabledSources = sources.filter(s => s.enabled !== false);
  if (enabledSources.length === 0) return [];

  const seen = new Set();
  const results = [];

  for (let i = 0; i < enabledSources.length; i++) {
    const source = enabledSources[i];
    if (i > 0) await new Promise(r => setTimeout(r, REQUEST_DELAY_MS));

    const items = await fetchSource(source);
    for (const item of items) {
      if (seen.has(item.url)) continue;
      seen.add(item.url);
      results.push(item);
    }
  }

  return results;
}

module.exports = { fetchDirectSources, fetchSource };
