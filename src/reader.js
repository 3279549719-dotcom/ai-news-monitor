const axios = require('axios');
const cheerio = require('cheerio');

async function fetchArticleContent(url) {
  const { data } = await axios.get(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    timeout: 15000,
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
