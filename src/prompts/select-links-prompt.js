'use strict';

/**
 * System prompt for link selection.
 *
 * Shared by the crawl4ai and scraper-direct channels: instructs the model to
 * pick only real news articles from a raw link list and exclude navigation /
 * stats / tickets / etc.
 */

/**
 * Build the system prompt for selectArticleLinks.
 * @param {string} sourceName - Source display name.
 * @param {string} pageUrl - Page the links came from.
 * @returns {string} System prompt text.
 */
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
