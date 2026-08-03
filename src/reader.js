const axios = require('axios');
const cheerio = require('cheerio');
const { HTTP_USER_AGENT, HTTP_TIMEOUT_MS } = require('./config');

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
