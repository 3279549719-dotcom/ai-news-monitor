const https = require('https');

// Scrape blog directory pages that list beat reporters
const sources = [
  // Mavs beat reporter lists
  'https://www.mavsmoneyball.com/',
  'https://thesmokingcuban.com/dallas-mavericks-news/',
  // Dallas Morning News Mavs page
  'https://www.dallasnews.com/sports/mavericks/',
  // ESPN Mavs
  'https://www.espn.com/nba/team/_/name/dal/dallas-mavericks',
  // SI Mavs
  'https://www.si.com/nba/mavericks',
];

async function getHtml(url) {
  return new Promise((resolve) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 15000
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        // Extract journalist names and X handles
        const xHandles = data.match(/@[A-Za-z0-9_]{3,30}/g) || [];
        const uniqueX = [...new Set(xHandles)];
        
        // Extract article links
        const articleLinks = data.match(/href="([^"]*(?:\/202[0-9]\/|\/news\/|\/article\/)[^"]*)"/gi) || [];
        
        // Extract journalist names (common patterns)
        const bylines = data.match(/(?:By|by)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})/g) || [];
        
        resolve({
          url,
          status: res.statusCode,
          length: data.length,
          uniqueXHandles: uniqueX.slice(0, 30),
          articleLinkCount: articleLinks.length,
          articleLinkSamples: articleLinks.slice(0, 10),
          bylineSamples: [...new Set(bylines)].slice(0, 15)
        });
      });
    }).on('error', (e) => resolve({ url, error: e.message }));
  });
}

(async () => {
  for (const url of sources) {
    console.log(`\n=== ${url} ===`);
    const r = await getHtml(url);
    console.log(JSON.stringify(r, null, 2));
  }
})();
