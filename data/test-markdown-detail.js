const http = require('http');
const fs = require('fs');

const TOKEN = fs.readFileSync('E:/claude/ai-news-monitor/.crawl4ai-token', 'utf8').trim();

async function crawlDetail(url, label) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ urls: [url], max_pages_to_crawl: 1 });
    const req = http.request({
      hostname: 'localhost', port: 11235, path: '/crawl', method: 'POST',
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: 120000
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const r = JSON.parse(data);
          const result = {
            label, url,
            success: r.success,
            resultsCount: r.results ? r.results.length : 0,
          };
          
          if (r.results && r.results[0]) {
            const page = r.results[0];
            result.statusCode = page.status_code;
            result.redirectedUrl = page.redirected_url;
            
            // Markdown
            if (page.markdown) {
              const md = typeof page.markdown === 'string' ? page.markdown : JSON.stringify(page.markdown);
              result.mdLength = md.length;
              result.mdPreview = md.substring(0, 500);
              result.mdTail = md.substring(Math.max(0, md.length - 200));
              // Count article-like links in markdown
              const articleRefs = md.match(/\[([^\]]+)\]\(([^)]*(?:\/news\/|\/article\/|\/story\/|\/202[0-9]\/)[^)]*)\)/g) || [];
              result.articleLinksInMd = articleRefs.length;
              result.articleLinkSamples = articleRefs.slice(0, 10);
            } else {
              result.mdLength = 0;
              result.mdPreview = '(no markdown)';
            }
            
            // Extracted content
            if (page.extracted_content) {
              const ec = typeof page.extracted_content === 'string' ? page.extracted_content : JSON.stringify(page.extracted_content);
              result.ecLength = ec.length;
              result.ecPreview = ec.substring(0, 300);
            }
            
            // Links
            if (page.links) {
              result.internalLinkCount = (page.links.internal || []).length;
              result.externalLinkCount = (page.links.external || []).length;
              result.internalLinkSamples = (page.links.internal || []).slice(0, 5).map(l => typeof l === 'string' ? l : l.href || l.url || '');
              result.externalLinkSamples = (page.links.external || []).slice(0, 5).map(l => typeof l === 'string' ? l : l.href || l.url || '');
            }
            
            // Cleaned HTML
            if (page.cleaned_html) {
              result.cleanedHtmlLength = page.cleaned_html.length;
            }
          }
          
          resolve(result);
        } catch(e) {
          resolve({ label, url, error: e.message, raw: data.substring(0, 500) });
        }
      });
    });
    req.on('error', e => resolve({ label, url, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ label, url, error: 'timeout' }); });
    req.write(body);
    req.end();
  });
}

(async () => {
  const tests = [
    { label: 'nba-mavs-news', url: 'https://www.nba.com/mavs/news' },
    { label: 'dallasnews', url: 'https://www.dallasnews.com/sports/mavericks/' },
    { label: 'espn-mavs', url: 'https://www.espn.com/nba/team/_/name/dal/dallas-mavericks' },
    { label: 'bleacher-mavs', url: 'https://bleacherreport.com/dallas-mavericks' },
    { label: 'yahoo-mavs', url: 'https://sports.yahoo.com/nba/teams/dallas/' },
  ];
  
  const results = [];
  for (const t of tests) {
    console.log(`\n=== Testing ${t.label}: ${t.url} ===`);
    const r = await crawlDetail(t.url, t.label);
    results.push(r);
    console.log(`  success=${r.success} status=${r.statusCode} redirectTo=${r.redirectedUrl}`);
    console.log(`  mdLen=${r.mdLength} articleLinksInMd=${r.articleLinksInMd}`);
    if (r.mdPreview) console.log(`  mdPreview: ${r.mdPreview.substring(0, 200)}`);
    if (r.articleLinkSamples && r.articleLinkSamples.length) console.log(`  articleLinks: ${r.articleLinkSamples.slice(0, 5).join(' | ')}`);
    if (r.internalLinkCount) console.log(`  intLinks=${r.internalLinkCount} extLinks=${r.externalLinkCount}`);
    if (r.internalLinkSamples) console.log(`  intSamples: ${r.internalLinkSamples.slice(0,3).join(' | ')}`);
    if (r.ecLength) console.log(`  extractedContent: ${r.ecPreview ? r.ecPreview.substring(0, 150) : '(none)'}`);
  }
  
  fs.writeFileSync('E:/claude/ai-news-monitor/data/dallas-markdown-detail.json', JSON.stringify(results, null, 2));
  console.log('\nSaved to dallas-markdown-detail.json');
})();
