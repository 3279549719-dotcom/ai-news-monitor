const axios = require('axios');
const cheerio = require('cheerio');

const DEFAULT_BLOG_URL = 'https://claude.com/blog';

async function fetchArticleList(blogUrl = DEFAULT_BLOG_URL) {
  const { data } = await axios.get(blogUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    timeout: 15000,
  });

  const $ = cheerio.load(data);
  const articles = [];
  const seenHrefs = new Set();

  // Extract base URL for relative links
  const base = new URL(blogUrl);
  const baseOrigin = base.origin;
  const basePath = base.pathname.replace(/\/$/, '');

  $('a').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;

    // Normalize href to absolute URL
    let absUrl;
    if (href.startsWith('http')) {
      absUrl = href;
    } else if (href.startsWith('/')) {
      absUrl = `${baseOrigin}${href}`;
    } else {
      return; // skip relative or anchor links
    }

    // Only include links that are sub-paths of the blog URL
    const parsed = new URL(absUrl);
    if (parsed.origin !== baseOrigin) return;
    if (!parsed.pathname.startsWith(basePath + '/')) return;
    if (parsed.pathname === basePath + '/') return;

    if (seenHrefs.has(parsed.pathname)) return;
    seenHrefs.add(parsed.pathname);

    const title =
      $(el).find('h3').first().text().trim() ||
      $(el).find('h2').first().text().trim() ||
      $(el).text().trim().split('\n')[0].trim();

    if (!title || title.length < 5) return;

    articles.push({ title, url: absUrl });
  });

  return articles;
}

module.exports = { fetchArticleList };
