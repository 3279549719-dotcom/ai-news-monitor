import axios from 'axios';
import fs from 'fs';

const TOKEN = '056354c4a52f15411599e16d304d1f30cd6103feb3cb176d';
const CRAWL4AI_URL = 'http://localhost:11235/crawl';
const OUTPUT_PATH = 'E:/claude/ai-news-monitor/data/anthropic-source-reachability.json';

const URLS = [
  { name: 'TechCrunch Anthropic Tag', url: 'https://techcrunch.com/tag/anthropic/', tier: 1 },
  { name: 'The Verge AI', url: 'https://www.theverge.com/ai-artificial-intelligence', tier: 1 },
  { name: 'Ars Technica Anthropic Tag', url: 'https://arstechnica.com/tag/anthropic/', tier: 1 },
  { name: 'VentureBeat Anthropic Tag', url: 'https://venturebeat.com/tag/anthropic/', tier: 1 },
  { name: 'ZDNet Anthropic Topic', url: 'https://www.zdnet.com/topic/anthropic/', tier: 2 },
  { name: 'Wired Anthropic Tag', url: 'https://www.wired.com/tag/anthropic/', tier: 2 },
  { name: 'Anthropic Research (Official)', url: 'https://www.anthropic.com/research', tier: 'official' },
];

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function testCrawl4ai(url, name) {
  const start = Date.now();
  try {
    const res = await axios.post(CRAWL4AI_URL, {
      urls: [url],
      max_pages_to_crawl: 1,
    }, {
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      timeout: 90000,
    });
    const elapsed = Date.now() - start;
    const data = res.data;
    // crawl4ai returns an array of results; check first
    let result = null;
    if (Array.isArray(data) && data.length > 0) {
      result = data[0];
    } else if (data && typeof data === 'object') {
      result = data;
    }
    
    const hasMarkdown = result?.markdown && result.markdown.length > 100;
    const links = extractLinks(result?.markdown || '', url);
    return {
      name,
      url,
      tier: URLS.find(u => u.url === url)?.tier || null,
      method: 'crawl4ai',
      success: !!hasMarkdown,
      statusCode: result?.status_code || null,
      markdownLength: result?.markdown?.length || 0,
      internalLinks: links.internal.length,
      externalLinks: links.external.length,
      sampleInternalLinks: links.internal.slice(0, 10),
      hasArticleLinks: assessArticleLinks(links.internal, url),
      elapsedMs: elapsed,
      error: null,
      rawKeys: Object.keys(result || {}),
    };
  } catch (err) {
    const elapsed = Date.now() - start;
    return {
      name,
      url,
      tier: URLS.find(u => u.url === url)?.tier || null,
      method: 'crawl4ai',
      success: false,
      statusCode: err.response?.status || null,
      markdownLength: 0,
      internalLinks: 0,
      externalLinks: 0,
      sampleInternalLinks: [],
      hasArticleLinks: false,
      elapsedMs: elapsed,
      error: err.code || err.message?.slice(0, 300),
      rawKeys: [],
    };
  }
}

async function testDirect(url, name) {
  const start = Date.now();
  try {
    const res = await axios.get(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
      timeout: 30000,
      maxRedirects: 5,
      validateStatus: () => true,
    });
    const elapsed = Date.now() - start;
    const html = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
    const htmlLength = html.length;
    const linkCount = (html.match(/<a\s+href=["']([^"']+)["']/gi) || []).length;
    return {
      name,
      url,
      method: 'direct',
      success: res.status >= 200 && res.status < 400 && htmlLength > 2000,
      statusCode: res.status,
      htmlLength,
      linkCount,
      elapsedMs: elapsed,
      error: res.status >= 400 ? `HTTP ${res.status}` : null,
    };
  } catch (err) {
    const elapsed = Date.now() - start;
    return {
      name,
      url,
      method: 'direct',
      success: false,
      statusCode: err.response?.status || null,
      htmlLength: 0,
      linkCount: 0,
      elapsedMs: elapsed,
      error: err.code || err.message?.slice(0, 300),
    };
  }
}

function extractLinks(md, baseUrl) {
  const internal = [];
  const external = [];
  const linkRe = /\[([^\]]*)\]\(([^)]+)\)/g;
  let m;
  const domain = new URL(baseUrl).hostname.replace('www.', '');
  while ((m = linkRe.exec(md)) !== null) {
    const href = m[2];
    if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) continue;
    try {
      const u = new URL(href, baseUrl);
      const linkDomain = u.hostname.replace('www.', '');
      if (linkDomain === domain) {
        internal.push({ text: m[1].slice(0, 80), href });
      } else {
        external.push({ text: m[1].slice(0, 80), href });
      }
    } catch {
      // relative
      if (href.startsWith('/') || !href.includes('://')) {
        internal.push({ text: m[1].slice(0, 80), href });
      }
    }
  }
  return { internal, external };
}

function assessArticleLinks(links, baseUrl) {
  // Look for links that look like article links (not just nav/about/home)
  const articleLike = links.filter(l => {
    const t = l.href.toLowerCase();
    const skip = ['/tag/', '/author/', '/about', '/contact', '/privacy', '/terms', '/login', '/signup', '/search', '/rss', '/feed', '/#', '#', '/account'];
    if (skip.some(s => t.includes(s))) return false;
    // article-like patterns: year in URL, /news/, /article/, /blog/, long paths
    if (/\d{4}\/\d{1,2}\/\d{1,2}/.test(t)) return true;
    if (/\/(news|article|blog|story|post|research|papers?|202\d)\//.test(t)) return true;
    // generic: path segments > 2
    const parts = t.split('/').filter(Boolean);
    return parts.length > 2;
  });
  return {
    count: articleLike.length,
    sample: articleLike.slice(0, 5).map(l => ({ text: l.text, href: l.href })),
  };
}

async function main() {
  console.log('Starting Anthropic source reachability tests...\n');

  const results = [];

  // Test crawl4ai first
  for (const { name, url } of URLS) {
    console.log(`[crawl4ai] Testing: ${name} (${url})`);
    const r = await testCrawl4ai(url, name);
    results.push(r);
    console.log(`  -> success=${r.success}, links=${r.internalLinks}, time=${r.elapsedMs}ms`);
    if (r.error) console.log(`  -> ERROR: ${r.error}`);
  }

  // Test direct axios
  for (const { name, url } of URLS) {
    console.log(`[direct] Testing: ${name} (${url})`);
    const r = await testDirect(url, name);
    results.push(r);
    console.log(`  -> success=${r.success}, status=${r.statusCode}, htmlLen=${r.htmlLength}, time=${r.elapsedMs}ms`);
    if (r.error) console.log(`  -> ERROR: ${r.error}`);
  }

  // Summary
  const summary = {
    testedAt: new Date().toISOString(),
    crawl4aiBase: CRAWL4AI_URL,
    totalUrls: URLS.length,
    crawl4ai: {
      success: results.filter(r => r.method === 'crawl4ai' && r.success).length,
      fail: results.filter(r => r.method === 'crawl4ai' && !r.success).length,
    },
    direct: {
      success: results.filter(r => r.method === 'direct' && r.success).length,
      fail: results.filter(r => r.method === 'direct' && !r.success).length,
    },
  };

  const output = { summary, results };
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`\nResults written to ${OUTPUT_PATH}`);
  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify(summary, null, 2));
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
