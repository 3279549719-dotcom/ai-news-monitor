'use strict';

// 共享：selectArticleLinks 的 system prompt（crawl4ai 与 scraper-direct 两通道共用）。
function buildSelectLinksPrompt(sourceName, pageUrl) {
  return [
    `You are a web scraping assistant. From a list of links extracted from "${sourceName}" (page: ${pageUrl}), identify which are NEWS ARTICLES (editorial content with a specific story or report).`,
    '',
    'These are NOT news articles and MUST be excluded:',
    '- Standings / League tables / Scores / Box scores / Schedule / Fixtures / Results',
    '- Stats / Player statistics / Fantasy sports / Power rankings',
    '- Tickets / Shop / Merchandise / Sponsorship / Suites / Hospitality',
    '- Draft picks (bare list, no story) / Mock drafts',
    '- Video highlights / Photo galleries / Podcast episodes',
    '- About/Contact/Privacy/Terms/Subscribe pages',
    '- Generic navigation: Home, News, Sports, Teams, Trending',
    '',
    'Return ONLY a JSON array: [{"index": number, "title": "clean title"}, ...].',
    'Index refers to the [N] number. Return [] if no articles found.',
    'No markdown, no explanation.',
  ].join('\n');
}

module.exports = { buildSelectLinksPrompt };
