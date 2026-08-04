const http = require('http');
const https = require('https');
const fs = require('fs');

const TOKEN = fs.readFileSync('E:/claude/ai-news-monitor/.crawl4ai-token', 'utf8').trim();

const URLS = [
  // Tier 0 - Official - using redirect destinations
  { label: 'nba-mavs-news', url: 'https://www.nba.com/mavs/news', tier: 'Tier-0' },
  { label: 'mavs-com-redirect', url: 'https://www.mavs.com/news', tier: 'Tier-0' },
  
  // Tier 1 - Journalist X feeds
  { label: 'stein-X', url: 'https://x.com/TheSteinLine', tier: 'Tier-1' },
  { label: 'macmahon-X', url: 'https://x.com/espn_macmahon', tier: 'Tier-1' },
  { label: 'townsend-X', url: 'https://x.com/townbrad', tier: 'Tier-1' },
  { label: 'caplan-X', url: 'https://x.com/CallieCaplan', tier: 'Tier-1' },
  
  // Tier 2 - Sports media
  { label: 'espn-mavs', url: 'https://www.espn.com/nba/team/_/name/dal/dallas-mavericks', tier: 'Tier-2' },
  { label: 'dallasnews', url: 'https://www.dallasnews.com/sports/mavericks/', tier: 'Tier-2' },
  { label: 'si-mavs', url: 'https://www.si.com/nba/mavericks', tier: 'Tier-2' },
  { label: 'cbs-mavs', url: 'https://www.cbssports.com/nba/teams/DAL/dallas-mavericks/', tier: 'Tier-2' },
  { label: 'yahoo-mavs', url: 'https://sports.yahoo.com/nba/teams/dallas/', tier: 'Tier-2' },
  { label: 'athletic-mavs', url: 'https://www.nytimes.com/athletic/nba/team/mavericks/', tier: 'Tier-2' },
  { label: 'bleacher-mavs', url: 'https://bleacherreport.com/dallas-mavericks', tier: 'Tier-2' },
];

async function crawl4aiDeep(label, url, tier) {
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
      timeout: 120000
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let result = { label, url, tier, success: false, statusCode: res.statusCode, mdLength: 0, internalLinks: 0, externalLinks: 0, internalLinkSample: [], externalLinkSample: [], hasArticleLinks: false, error: null, structure: null };
        
        try {
          const parsed = JSON.parse(data);
          result.structure = Object.keys(parsed);
          
          if (parsed.results && Array.isArray(parsed.results)) {
            for (const page of parsed.results) {
              // crawl4ai v2+ returns markdown in results[].markdown
              if (page.markdown) {
                result.mdLength += page.markdown.length;
              }
              // Sometimes under different keys
              if (page.extracted_content) {
                result.mdLength += page.extracted_content.length;
              }
              
              // Check links structure
              if (page.links) {
                if (page.links.internal && Array.isArray(page.links.internal)) {
                  result.internalLinks = page.links.internal.length;
                  result.internalLinkSample = page.links.internal.slice(0, 10).map(l => typeof l === 'string' ? l : (l.href || l.url || JSON.stringify(l).substring(0, 100)));
                }
                if (page.links.external && Array.isArray(page.links.external)) {
                  result.externalLinks = page.links.external.length;
                  result.externalLinkSample = page.links.external.slice(0, 10).map(l => typeof l === 'string' ? l : (l.href || l.url || JSON.stringify(l).substring(0, 100)));
                }
              }
              
              // Check for article-like links
              const allLinkStrs = [...(result.internalLinkSample || []), ...(result.externalLinkSample || [])]
                .map(l => String(l).toLowerCase());
              result.hasArticleLinks = allLinkStrs.some(l => /\/(news|article|story|202[0-9]|blog|post|rumor)\//i.test(l));
              
              // Full data keys
              if (!result.pageKeys) result.pageKeys = Object.keys(page);
            }
            
            if (parsed.results.length > 0 && result.mdLength > 0) {
              result.success = true;
            }
          }
          
          // Also check for direct markdown
          if (parsed.markdown) {
            result.mdLength = parsed.markdown.length;
            result.success = true;
          }
          
          // Check crawl4ai v1 format
          if (parsed.pages && Array.isArray(parsed.pages)) {
            for (const page of parsed.pages) {
              if (page.content) {
                result.mdLength += page.content.length;
                result.success = true;
              }
            }
          }
        } catch (e) {
          result.error = 'JSON parse error: ' + e.message + ' | raw: ' + data.substring(0, 200);
        }
        
        resolve(result);
      });
    });

    req.on('error', (err) => {
      resolve({ label, url, tier, success: false, statusCode: null, mdLength: 0, internalLinks: 0, externalLinks: 0, internalLinkSample: [], externalLinkSample: [], hasArticleLinks: false, error: err.message, structure: null });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ label, url, tier, success: false, statusCode: null, mdLength: 0, internalLinks: 0, externalLinks: 0, internalLinkSample: [], externalLinkSample: [], hasArticleLinks: false, error: 'timeout (120s)', structure: null });
    });

    req.write(body);
    req.end();
  });
}

async function directDeep(label, url, tier) {
  return new Promise((resolve) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      timeout: 30000,
      maxRedirects: 5
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        const articleLinkMatches = data.match(/href="[^"]*(?:\/news\/|\/article\/|\/story\/|\/202[0-9]\/|\/blog\/|\/post\/|\/rumor\/)[^"]*"/gi) || [];
        // Extract some article link samples
        const samples = articleLinkMatches.slice(0, 5);
        resolve({
          label, url, tier,
          status: res.statusCode,
          htmlLength: data.length,
          articleLinkCount: articleLinkMatches.length,
          articleLinkSamples: samples,
          redirectUrl: res.headers.location || null,
          contentType: res.headers['content-type'] || null,
          error: null
        });
      });
    });
    req.on('error', (err) => {
      resolve({ label, url, tier, status: null, htmlLength: 0, articleLinkCount: 0, articleLinkSamples: [], redirectUrl: null, contentType: null, error: err.message });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ label, url, tier, status: null, htmlLength: 0, articleLinkCount: 0, articleLinkSamples: [], redirectUrl: null, contentType: null, error: 'timeout (30s)' });
    });
  });
}

(async () => {
  console.log('=== DEEP CRAWL4AI TESTS ===');
  const crawlResults = [];
  for (const { label, url, tier } of URLS) {
    console.log(`\n[${tier}] crawl4ai: ${label} -> ${url}`);
    const r = await crawl4aiDeep(label, url, tier);
    crawlResults.push(r);
    console.log(`  success=${r.success} mdLen=${r.mdLength} intLinks=${r.internalLinks} extLinks=${r.externalLinks} hasArticles=${r.hasArticleLinks} err=${r.error ? r.error.substring(0, 80) : 'none'}`);
    if (r.internalLinkSample.length) console.log(`  intSample: ${r.internalLinkSample.slice(0,3).join(' | ')}`);
    if (r.externalLinkSample.length) console.log(`  extSample: ${r.externalLinkSample.slice(0,3).join(' | ')}`);
    if (r.pageKeys) console.log(`  pageKeys: ${r.pageKeys.join(', ')}`);
  }

  console.log('\n=== DEEP DIRECT HTTP TESTS ===');
  const directResults = [];
  for (const { label, url, tier } of URLS) {
    console.log(`\n[${tier}] direct: ${label} -> ${url}`);
    const r = await directDeep(label, url, tier);
    directResults.push(r);
    console.log(`  status=${r.status} htmlLen=${r.htmlLength} articleLinkCount=${r.articleLinkCount} redirectTo=${r.redirectUrl} err=${r.error ? r.error.substring(0, 60) : 'none'}`);
    if (r.articleLinkSamples.length) console.log(`  sample: ${r.articleLinkSamples.slice(0,3).join(' | ')}`);
  }

  const output = { crawl4ai: crawlResults, direct: directResults, timestamp: new Date().toISOString() };
  fs.writeFileSync('E:/claude/ai-news-monitor/data/dallas-crawl4ai-deep.json', JSON.stringify(output, null, 2));
  console.log('\n=== Saved to dallas-crawl4ai-deep.json ===');
})();
