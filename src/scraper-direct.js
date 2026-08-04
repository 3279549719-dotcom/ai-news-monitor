'use strict';

const axios = require('axios');
const { selectArticleLinks } = require('./ai');
const { HTTP_USER_AGENT, HTTP_TIMEOUT_MS } = require('./config');
const { toItem } = require('./items');
const { extractPublishDateFromUrl } = require('./dates');

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

// 抓单个信源：axios 拉 HTML → 正则提取链接 → AI 精选文章
async function scrapeSourceUrl(pageUrl, sourceName) {
  try {
    const { data: html } = await axios.get(pageUrl, {
      timeout: HTTP_TIMEOUT_MS,
      headers: { 'User-Agent': HTTP_USER_AGENT },
      maxRedirects: 5,
    });

    const links = extractLinks(html, pageUrl);
    if (links.length === 0) {
      console.log(`  [Direct] ${sourceName}: 未提取到链接`);
      return [];
    }

    const articles = await selectArticleLinks(links, sourceName, pageUrl, 'Direct');
    return articles.map(a => ({ ...a, publishedAt: extractPublishDateFromUrl(a.url) }));
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

  return articles.filter(a => a.url).map(a => toItem(source, a));
}

module.exports = { fetchSource };
