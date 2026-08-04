const http = require('http');
const https = require('https');
const fs = require('fs');

const TOKEN = fs.readFileSync('E:/claude/ai-news-monitor/.crawl4ai-token', 'utf8').trim();

const URLS = [
  { label: 'mavs-news', url: 'https://www.mavs.com/news' },
  { label: 'nba-mavs', url: 'https://www.nba.com/mavericks/news' },
  { label: 'espn-mavs', url: 'https://www.espn.com/nba/team/_/name/dal/dallas-mavericks' },
  { label: 'steinline', url: 'https://x.com/TheSteinLine' },
  { label: 'macmahon', url: 'https://x.com/espn_macmahon' },
  { label: 'dallasnews', url: 'https://www.dallasnews.com/sports/mavericks/' },
  { label: 'si-mavs', url: 'https://www.si.com/nba/mavericks' },
  { label: 'cbs-mavs', url: 'https://www.cbssports.com/nba/teams/DAL/dallas-mavericks/' },
  { label: 'yahoo-mavs', url: 'https://sports.yahoo.com/nba/teams/dallas/' },
];

async function crawl4aiTest(label, url) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ urls: [url], max_pages_to_crawl: 1 });
    const options = {
      hostname: 'localhost',
      port: 11235,
      path: '/crawl',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: 90000
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(data); } catch(e) { /* ignore */ }

        let mdLength = 0;
        let internalLinks = 0;
        let externalLinks = 0;
        let hasArticleLinks = false;

        if (parsed && Array.isArray(parsed)) {
          for (const page of parsed) {
            if (page.markdown) {
              mdLength += page.markdown.length;
            }
            if (page.links) {
              if (page.links.internal) {
                internalLinks += page.links.internal.length;
                // Check for article-looking links
                for (const link of page.links.internal) {
                  const href = (link.href || link.url || '').toLowerCase();
                  if (/\/(news|article|story|202[0-9]|blog|post)\//.test(href)) {
                    hasArticleLinks = true;
                  }
                }
              }
              if (page.links.external) {
                externalLinks += page.links.external.length;
                for (const link of page.links.external) {
                  const href = (link.href || link.url || '').toLowerCase();
                  if (/\/(news|article|story|202[0-9]|blog|post)\//.test(href)) {
                    hasArticleLinks = true;
                  }
                }
              }
            }
            // Fallback: check raw result structure
            if (page.result && page.result.markdown) {
              mdLength = page.result.markdown.length;
            }
            if (page.result && page.result.links) {
              const il = (page.result.links.internal || []).length;
              const el = (page.result.links.external || []).length;
              if (il > internalLinks) internalLinks = il;
              if (el > externalLinks) externalLinks = el;
            }
          }
        }

        resolve({
          label,
          url,
          success: res.statusCode === 200,
          statusCode: res.statusCode,
          mdLength,
          internalLinks,
          externalLinks,
          hasArticleLinks,
          error: parsed && parsed.detail ? JSON.stringify(parsed.detail) : (res.statusCode !== 200 ? data.substring(0, 500) : null),
          rawKeys: parsed ? (Array.isArray(parsed) ? parsed.map(p => Object.keys(p)) : Object.keys(parsed)) : []
        });
      });
    });

    req.on('error', (err) => {
      resolve({ label, url, success: false, statusCode: null, mdLength: 0, internalLinks: 0, externalLinks: 0, hasArticleLinks: false, error: err.message, rawKeys: [] });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ label, url, success: false, statusCode: null, mdLength: 0, internalLinks: 0, externalLinks: 0, hasArticleLinks: false, error: 'timeout (90s)', rawKeys: [] });
    });

    req.write(body);
    req.end();
  });
}

async function directTest(label, url) {
  return new Promise((resolve) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
      },
      timeout: 30000
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        // Count article-like links in HTML
        const articleLinkMatches = data.match(/href="[^"]*(?:\/news\/|\/article\/|\/story\/|\/202[0-9]\/|\/blog\/|\/post\/)[^"]*"/gi) || [];
        resolve({
          label,
          url,
          status: res.statusCode,
          htmlLength: data.length,
          articleLinkCount: articleLinkMatches.length,
          redirectUrl: res.headers.location || null,
          error: null
        });
      });
    });
    req.on('error', (err) => {
      resolve({ label, url, status: null, htmlLength: 0, articleLinkCount: 0, redirectUrl: null, error: err.message });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ label, url, status: null, htmlLength: 0, articleLinkCount: 0, redirectUrl: null, error: 'timeout (30s)' });
    });
  });
}

(async () => {
  console.log('=== CRAWL4AI TESTS ===');
  const crawlResults = [];
  for (const { label, url } of URLS) {
    console.log(`Testing crawl4ai: ${label} -> ${url}`);
    const r = await crawl4aiTest(label, url);
    crawlResults.push(r);
    console.log(JSON.stringify(r, null, 2));
  }

  console.log('\n=== DIRECT HTTP TESTS ===');
  const directResults = [];
  for (const { label, url } of URLS) {
    console.log(`Testing direct: ${label} -> ${url}`);
    const r = await directTest(label, url);
    directResults.push(r);
    console.log(JSON.stringify(r));
  }

  const output = { crawl4ai: crawlResults, direct: directResults, timestamp: new Date().toISOString() };
  fs.writeFileSync('E:/claude/ai-news-monitor/data/dallas-crawl4ai-results.json', JSON.stringify(output, null, 2));
  console.log('\nSaved to dallas-crawl4ai-results.json');
})();
