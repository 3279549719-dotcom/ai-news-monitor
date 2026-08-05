const axios = require('axios');
const cheerio = require('cheerio');
const { HTTP_USER_AGENT, HTTP_TIMEOUT_MS } = require('./config');

/**
 * LEGACY blog-type article reader (scraper/reader pipeline). The blog type is
 * currently deactivated; kept for reference only.
 * Extracts readable article text from a page for full-text summarization.
 */

/**
 * Fetch an article page and extract its readable text (strips nav/footer/etc).
 * @param {string} url - Article URL.
 * @returns {Promise<string>} Normalized plain text, truncated to 4000 chars.
 */
async function fetchArticleContent(url) {
  const { data } = await axios.get(url, {
    headers: { 'User-Agent': HTTP_USER_AGENT },
    timeout: HTTP_TIMEOUT_MS,
  });

  const $ = cheerio.load(data);
  $('script, style, nav, footer, header, aside').remove();

  const content =
    $('article').text() ||
    $('[class*="content"]').first().text() ||
    $('main').text() ||
    $('body').text();

  return content.replace(/\s+/g, ' ').trim().slice(0, 4000);
}

module.exports = { fetchArticleContent };
