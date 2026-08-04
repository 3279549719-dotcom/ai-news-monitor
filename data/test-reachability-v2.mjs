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

function getMarkdown(result) {
  if (!result) return '';
  if (typeof result.markdown === 'string') return result.markdown;
  if (result.markdown?.raw_markdown) return result.markdown.raw_markdown;
  if (result.extracted_content) return result.extracted_content;
  return '';
}

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
    
    const resultsArray = data.results || (Array.isArray(data) ? data : [data]);
    const result = resultsArray[0] || {};
    
    const md = getMarkdown(result);
    const hasContent = md.length > 100;
    const links = extractLinks(md, url);
    const statusCode = result.status_code || null;

    return {
      name,
      url,
      tier: URLS.find(u => u.url === url)?.tier || null,
      method: 'crawl4ai',
      success: hasContent,
      statusCode,
      markdownLength: md.length,
      internalLinks: links.internal.length,
      externalLinks: links.external.length,
      sampleInternalLinks: links.internal.slice(0, 10).map(l => ({ text: l.text, href: l.href })),
      sampleExternalLinks: links.external.slice(0, 5).map(l => ({ text: l.text, href: l.href })),
      hasArticleLinks: assessArticleLinks(links.internal, url),
      elapsedMs: elapsed,
      serverTime: data.server_processing_time_s || null,
      error: null,
    };
  } catch (err) {
    const elapsed = Date.now() - start;
    return {
      name, url,
      tier: URLS.find(u => u.url === url)?.tier || null,
      method: 'crawl4ai',
      success: false,
      statusCode: err.response?.status || null,
      markdownLength: 0,
      internalLinks: 0, externalLinks: 0,
      sampleInternalLinks: [], sampleExternalLinks: [],
      hasArticleLinks: { count: 0, sample: [] },
      elapsedMs: elapsed,
      serverTime: null,
      error: err.code || err.message?.slice(0, 300),
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
      name, url, method: 'direct',
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
      name, url, method: 'direct',
      success: false,
      statusCode: err.response?.status || null,
      htmlLength: 0, linkCount: 0, elapsedMs: elapsed,
      error: err.code || err.message?.slice(0, 300),
    };
  }
}

function extractLinks(md, baseUrl) {
  const internal = [];
  const external = [];
  const linkRe = /\[([^\]]*)\]\(([^)]+)\)/g;
  let m;
  let domain = '';
  try { domain = new URL(baseUrl).hostname.replace('www.', ''); } catch {}
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
      if (href.startsWith('/') || !href.includes('://')) {
        internal.push({ text: m[1].slice(0, 80), href });
      }
    }
  }
  return { internal, external };
}

function assessArticleLinks(links, baseUrl) {
  const articleLike = links.filter(l => {
    const t = l.href.toLowerCase();
    const skip = ['/tag/', '/author/', '/about', '/contact', '/privacy', '/terms', '/login', '/signup', '/search', '/rss', '/feed', '/#', '#', '/account'];
    if (skip.some(s => t.includes(s))) return false;
    if (/\d{4}\/\d{1,2}\/\d{1,2}/.test(t)) return true;
    if (/\/(news|article|blog|story|post|research|papers?|202\d)\//.test(t)) return true;
    const parts = t.split('/').filter(Boolean);
    return parts.length > 2;
  });
  return {
    count: articleLike.length,
    sample: articleLike.slice(0, 5).map(l => ({ text: l.text, href: l.href })),
  };
}

async function main() {
  console.log('=== Anthropic Source Reachability Tests ===');
  console.log(`Time: ${new Date().toISOString()}\n`);

  const results = [];

  // Test crawl4ai
  for (const { name, url } of URLS) {
    console.log(`[crawl4ai] ${name}`);
    const r = await testCrawl4ai(url, name);
    results.push(r);
    console.log(`  success=${r.success} | md=${r.markdownLength}B | internalLinks=${r.internalLinks} | articleLinks=${r.hasArticleLinks.count} | ${r.elapsedMs}ms${r.error ? ' | ERR: '+r.error : ''}`);
  }

  // Test direct
  for (const { name, url } of URLS) {
    console.log(`[direct]   ${name}`);
    const r = await testDirect(url, name);
    results.push(r);
    console.log(`  success=${r.success} | status=${r.statusCode} | html=${r.htmlLength}B | links=${r.linkCount} | ${r.elapsedMs}ms${r.error ? ' | ERR: '+r.error : ''}`);
  }

  const c4a = results.filter(r => r.method === 'crawl4ai');
  const direct = results.filter(r => r.method === 'direct');

  const summary = {
    testedAt: new Date().toISOString(),
    crawl4aiBase: CRAWL4AI_URL,
    totalUrls: URLS.length,
    crawl4ai: {
      success: c4a.filter(r => r.success).length,
      fail: c4a.filter(r => !r.success).length,
      avgTimeMs: Math.round(c4a.reduce((s, r) => s + r.elapsedMs, 0) / c4a.length),
      totalLinks: c4a.reduce((s, r) => s + r.internalLinks, 0),
    },
    direct: {
      success: direct.filter(r => r.success).length,
      fail: direct.filter(r => !r.success).length,
      avgTimeMs: Math.round(direct.reduce((s, r) => s + r.elapsedMs, 0) / direct.length),
    },
  };

  const output = { summary, results };
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`\nResults -> ${OUTPUT_PATH}`);
  console.log('\n=== SUMMARY ===');
  console.log(`crawl4ai: ${summary.crawl4ai.success}/${URLS.length} success, ${summary.crawl4ai.avgTimeMs}ms avg`);
  console.log(`direct:   ${summary.direct.success}/${URLS.length} success, ${summary.direct.avgTimeMs}ms avg`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
