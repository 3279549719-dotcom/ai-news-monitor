'use strict';

/**
 * crawl4ai fetch channel (Phase E).
 *
 * Primary source-page fetcher that supersedes/prefixes Firecrawl and
 * scraper-direct. Talks via REST to the local Docker container
 * (unclecode/crawl4ai at localhost:11235), gated by an API token.
 *
 * Usage: call fetchSourceArticles(source) per source; it returns items in the
 * same shape as scraper-direct:
 *   { title, url, snippet, publishedAt, source_name, source, tier }
 *
 * Degradation: when the container is down / the request fails it throws, and
 * search.js falls back to scraper-direct. X/Twitter accounts use
 * links.external (t.co short links + post titles) without AI filtering.
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { selectArticleLinks } = require('./ai');
const { CRAWL4AI_URL, CRAWL4AI_API_TOKEN, JS_SOURCES, JS_WAIT_MS } = require('./config');
const { toItem } = require('./items');
const { extractPublishDateFromUrl } = require('./dates');

// 命中 JS_SOURCES 时返回等待毫秒数，否则 0（不等待）
function jsWaitMsFor(pageUrl) {
  try {
    const host = new URL(pageUrl).hostname;
    for (const s of JS_SOURCES) {
      if (host.includes(s)) return JS_WAIT_MS;
    }
  } catch {}
  return 0;
}

const BASE_URL = CRAWL4AI_URL;
const TOKEN_FILE = path.join(__dirname, '../.crawl4ai-token');

let _token = null;
function getToken() {
  if (_token) return _token;
  if (CRAWL4AI_API_TOKEN) { _token = CRAWL4AI_API_TOKEN; return _token; }
  try { _token = fs.readFileSync(TOKEN_FILE, 'utf8').trim(); } catch (err) { _token = ''; }
  return _token;
}

// 健康检查缓存 30s，避免每次信源都探活
let _healthCache = { at: 0, ok: false };
async function isAvailable() {
  if (Date.now() - _healthCache.at < 30000) return _healthCache.ok;
  try {
    const res = await axios.get(`${BASE_URL}/health`, {
      timeout: 5000,
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    _healthCache = { at: Date.now(), ok: !!(res.data && res.data.status === 'ok') };
  } catch (err) {
    _healthCache = { at: Date.now(), ok: false };
  }
  return _healthCache.ok;
}

// 抓单个页面，返回 CrawlResult（含 links / markdown）
// waitMs>0 时带 crawler_params.wait_for，等 JS 渲染完成（Mavs Moneyball / Smoking Cuban 需要）
async function crawlPage(url, waitMs = 0) {
  const body = { urls: [url], max_pages_to_crawl: 1 };
  if (waitMs > 0) body.crawler_params = { headless: true, wait_for: waitMs };
  const res = await axios.post(`${BASE_URL}/crawl`, body, {
    timeout: 90000,
    headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
  });
  const r = (res.data && res.data.results && res.data.results[0]) || res.data;
  if (!r) throw new Error('crawl4ai 无响应结果');
  return r;
}

/**
 * Detect X / Twitter page URLs.
 * @param {string} url - URL to test.
 * @returns {boolean} True for x.com / twitter.com links.
 */
function isXUrl(url) {
  return /^(https?:\/\/)?(www\.)?(x\.com|twitter\.com)/i.test(url || '');
}

// 明显非文章链接的 URL 标记（视频/导航/交易/社交/账号）
function isNonArticleUrl(url) {
  if (!url) return true;
  // 先剥查询串/锚点与尾部斜杠，避免 "/schedule/" 等被 $ 锚点破防
  const u = String(url).replace(/[?#].*$/, '').replace(/\/+$/, '');
  return /(video|watch|live-blog|\/live$|\/scores|\/scoreboard|\/fixtures|transfer-centre|\/topic\/|\/tag\/|\/category\/|\/listing|players|staff|mutv|tickets|store|membership|become-a-member|login|signup|onboarding|header_photo|\/photo$|following|verified_followers|compose|\/status\/|javascript:|mailto:|\.css|\.js$|standings|\bstats\b|\bschedule\b|\bplayoffs\b|fantasy|premium|suites|sponsorship|\/gem$|ticketprogram|newsroom|natural-resources|personal-finance|college-football|college-basketball|womens-college-basketball|all-elite-wrestling|philadelphia-76ers|\/nba\/draft\/|\/nba\/teams$|powered-by|roster|injuries|odds|depth-chart|transactions|shop\b|\bscores\b|\bvideo\b|\.(png|jpe?g|webp|gif|svg|avif)$|s\.yimg\.com|cdn\.|images\.|\bi\.)/i.test(u);
}

// 明显垃圾标题（导航词/图片文件名）。用于 add() 与快路径 matched 两处标题过滤
function isSpamTitle(title) {
  const t = (title || '').trim().toLowerCase();
  if (!t) return false;
  // 图片文件名
  if (/\.(png|jpe?g|webp|gif|svg|avif)$/.test(t)) return true;
  // 纯导航词标题（如 "Schedule"、"Roster"、"Shop"）
  return /\b(schedule|standings|roster|stats|injuries|odds|scores|scoreboard|shop|tickets|transactions|depth-chart|video|fixtures|fantasy)\b/.test(t);
}

// 从 markdown 提取 [text](url) / Guardian 式 [](url)+###标题 链接
function extractMarkdownLinks(md) {
  const links = [];
  const seen = new Set();
  const add = (url, text) => {
    const clean = url.split(/[)#]/)[0];
    if (!clean || seen.has(clean)) return;
    seen.add(clean);
    links.push({ url: clean, text: (text || '').trim() });
  };
  for (const m of md.matchAll(/\[([^\]]{0,120})\]\((https?:\/\/[^)\s]+)\)/g)) {
    add(m[2], m[1]);
  }
  for (const m of md.matchAll(/\[\]\((https?:\/\/[^)\s]+)\)\s*###\s*([^\n]+)/g)) {
    add(m[1], m[2]);
  }
  return links;
}

// 站点 → 文章 URL 模式表（外置 JSON，按 host 分组多模式）
// getArticlePatterns 返回该 host 的全部 RegExp 数组（逐一 test），无匹配返回 []
const ARTICLE_PATTERNS_RAW = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'article-patterns.json'), 'utf8')
);
// 预编译为 { host: [RegExp, ...] }
const ARTICLE_PATTERNS = {};
for (const [host, patterns] of Object.entries(ARTICLE_PATTERNS_RAW)) {
  ARTICLE_PATTERNS[host] = patterns.map(p => new RegExp(p));
}
function getArticlePatterns(pageUrl) {
  try {
    const host = new URL(pageUrl).hostname;
    const found = ARTICLE_PATTERNS[host];
    return found || [];
  } catch { return []; }
}

// 空标题时从 URL slug 生成占位标题
function titleFromSlug(url) {
  const slug = (url.split('/').pop() || '').split(/[?#]/)[0].replace(/[-_]/g, ' ');
  return slug ? slug.replace(/\b\w/g, c => c.toUpperCase()).slice(0, 100) : '';
}

/**
 * Fetch a single source, returning an items array (same shape as
 * scraper-direct.fetchSource). Throws when the container is unavailable / the
 * request fails (caller degrades); returns [] when the page has no results.
 * @param {Object} source - Source row (scrape_url, source_name, tier).
 * @returns {Promise<Array>} Normalized items from the source.
 */
async function fetchSourceArticles(source) {
  if (!source || !source.scrape_url) return [];
  if (!(await isAvailable())) throw new Error('crawl4ai 容器不可用');

  const r = await crawlPage(source.scrape_url, jsWaitMsFor(source.scrape_url));
  if (!r || r.success === false) return [];

  const links = r.links || {};

  // X 账号：external 链接即文章（t.co 短链 + 帖子标题）
  if (isXUrl(source.scrape_url)) {
    const exts = (links.external || [])
      .filter(l => l.href && /t\.co\//.test(l.href))
      .filter(l => (l.title || l.text || '').trim().length >= 15)
      .slice(0, 15);
    return exts.map(l => toItem(source, {
      title: (l.title || l.text || '').trim().substring(0, 200),
      url: l.href,
      publishedAt: extractPublishDateFromUrl(l.href),
    }));
  }

  // 普通信源：候选合并 → 站点文章 URL 模式筛选（≥3 直接用标题）；不足退回 DeepSeek 精选
  const md = r.markdown || {};
  const mdStr = [md.fit_markdown, md.raw_markdown].filter(Boolean).join('\n');

  const candidates = new Map(); // url -> {title, url}
  const add = (url, text) => {
    if (!url || isNonArticleUrl(url)) return;
    if (isSpamTitle(text)) return;
    const clean = url.split('#')[0];
    if (clean.length < 15) return;
    const t = (text || '').trim();
    const existing = candidates.get(clean);
    if (!existing || (!existing.title && t)) {
      candidates.set(clean, { title: t, url: clean });
    }
  };
  for (const l of (links.internal || [])) {
    const t = (l.title || l.text || '').trim();
    if (l.href && t.length >= 15) add(l.href, t);
  }
  for (const l of extractMarkdownLinks(mdStr)) add(l.url, l.text);

  const patterns = getArticlePatterns(source.scrape_url);
  const matched0 = patterns.length > 0 ? [...candidates.values()].filter(c => patterns.some(re => re.test(c.url))) : [];
  const matched = matched0.filter(c => !isSpamTitle(c.title));
  for (const c of matched) if (!c.title) c.title = titleFromSlug(c.url);

  let selected;
  if (matched.length >= 3) {
    selected = matched;
  } else {
    const list = [...candidates.values()].slice(0, 60);
    if (list.length === 0) return [];
    try {
      selected = await selectArticleLinks(list, source.source_name, source.scrape_url, 'Crawl4ai');
    } catch (err) {
      console.log(`  [Crawl4ai] ${source.source_name} AI 筛选失败: ${err.message}`);
      return [];
    }
  }

  return selected.map(a => toItem(source, { title: a.title, url: a.url, publishedAt: extractPublishDateFromUrl(a.url) }));
}

/**
 * 抓取单篇正文（S1e，正文喂养用）。
 * 复用 crawlPage（waitMs=0）抓单篇 → md.fit_markdown || md.raw_markdown，
 * 剔除导航行（menu / Sign in / Subscribe / Cookie）与重复出现 ≥3 次的段落，
 * 截断到 1500 字符。失败 / 无内容返回 null。
 * @param {string} url 文章 URL
 * @returns {Promise<string|null>} 清洗后的正文片段，失败返回 null
 */
async function fetchArticleBody(url) {
  if (!url) return null;
  let r;
  try {
    r = await crawlPage(url, 0);
  } catch (err) {
    return null;
  }
  if (!r || r.success === false) return null;

  const md = r.markdown || {};
  const text = md.fit_markdown || md.raw_markdown;
  if (!text) return null;

  // 按空行切段落：剥导航段（密集链接的段，如 Guardian 顶部 News/Opinion/Sport 导航）
  // 与导航词，统计重复段落剔除 ≥3 次的。导航前奏会把 1500 字截断占满，正文反而被挤出。
  const counts = new Map();
  const paras = [];
  for (const p of text.split(/\n\s*\n/)) {
    const t = p.replace(/\s+/g, ' ').trim();
    if (!t) continue;
    if (/menu|sign in|subscribe|cookie/i.test(t)) continue;
    const links = (t.match(/\[[^\]]*\]\([^)]*\)/g) || []).length;
    // 导航段特征：≥3 个链接且剥掉链接后几乎无正文文字（如 Guardian 顶部/足球子导航）
    if (links >= 3) {
      const plain = t.replace(/\[[^\]]*\]\([^)]*\)/g, '').replace(/[^一-龥a-zA-Z0-9]+/g, '');
      if (plain.length < 100) continue;
    }
    const key = t.toLowerCase();
    counts.set(key, (counts.get(key) || 0) + 1);
    paras.push({ t, key });
  }

  const body = paras.filter(x => (counts.get(x.key) || 0) < 3).map(x => x.t).join('\n\n');
  return body ? body.slice(0, 1500) : null;
}

module.exports = { fetchSourceArticles, isXUrl, fetchArticleBody };
