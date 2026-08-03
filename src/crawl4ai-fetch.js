'use strict';

/**
 * crawl4ai 抓取通道（Phase E，2026-08-03）
 *
 * 替代/前置 Firecrawl 与 scraper-direct 的信源页面抓取。
 * 通过 REST 调本地 Docker 容器（unclecode/crawl4ai, localhost:11235）。
 *
 * 用法：每个信源调 fetchSourceArticles(source)，返回与 scraper-direct 相同形状的 items：
 *   { title, url, snippet, publishedAt, source_name, source, tier }
 *
 * 降级：容器不可用 / 请求失败时抛错，由 search.js 回退 scraper-direct。
 * X 账号信源：用 links.external（t.co 短链 + 帖子标题），无需 AI 筛选。
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { selectArticleLinks } = require('./ai');
const { CRAWL4AI_URL, CRAWL4AI_API_TOKEN } = require('./config');
const { toItem } = require('./items');

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
async function crawlPage(url) {
  const res = await axios.post(`${BASE_URL}/crawl`, { urls: [url], max_pages_to_crawl: 1 }, {
    timeout: 90000,
    headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
  });
  const r = (res.data && res.data.results && res.data.results[0]) || res.data;
  if (!r) throw new Error('crawl4ai 无响应结果');
  return r;
}

// X / Twitter 页面判断
function isXUrl(url) {
  return /^(https?:\/\/)?(www\.)?(x\.com|twitter\.com)/i.test(url || '');
}

// 明显非文章链接的 URL 标记（视频/导航/交易/社交/账号）
function isNonArticleUrl(url) {
  return /(video|watch|live-blog|\/live$|\/scores|\/fixtures|transfer-centre|\/topic\/|\/tag\/|\/category\/|\/listing|players|staff|mutv|tickets|store|membership|become-a-member|login|signup|onboarding|header_photo|\/photo$|following|verified_followers|compose|\/status\/|javascript:|mailto:|\.css|\.js$)/i.test(url);
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

// 站点 → 文章 URL 模式（用模式直接筛选，避免 DeepSeek 被导航淹没）
const ARTICLE_PATTERNS = [
  { host: 'manutd.com', re: /\/en\/news\// },
  { host: 'theguardian.com', re: /\/football\/20\d\d\// },
  { host: 'skysports.com', re: /\/football\/(news\/\d+|transfer-paper-talk\/\d+|.*?\/report\/\d+|live-blog\/\d+)/ },
  { host: 'espn.com', re: /\/soccer\/story\/_\/id\// },
  { host: 'si.com', re: /\/soccer\/(?!teams|video|news)[a-z0-9-]+$/ },
  { host: '90min.com', re: /\/soccer\// },
];
function getArticlePattern(pageUrl) {
  try {
    const host = new URL(pageUrl).hostname;
    const found = ARTICLE_PATTERNS.find(p => host.includes(p.host));
    return found ? found.re : null;
  } catch { return null; }
}

// 空标题时从 URL slug 生成占位标题
function titleFromSlug(url) {
  const slug = (url.split('/').pop() || '').split(/[?#]/)[0].replace(/[-_]/g, ' ');
  return slug ? slug.replace(/\b\w/g, c => c.toUpperCase()).slice(0, 100) : '';
}

/**
 * 抓取单个信源，返回 items 数组（与 scraper-direct.fetchSource 相同形状）。
 * 容器不可用 / 请求失败时抛错（上层降级）；页面无结果时返回 []。
 */
async function fetchSourceArticles(source) {
  if (!source || !source.scrape_url) return [];
  if (!(await isAvailable())) throw new Error('crawl4ai 容器不可用');

  const r = await crawlPage(source.scrape_url);
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
      publishedAt: new Date(),
    }));
  }

  // 普通信源：候选合并 → 站点文章 URL 模式筛选（≥3 直接用标题）；不足退回 DeepSeek 精选
  const md = r.markdown || {};
  const mdStr = [md.fit_markdown, md.raw_markdown].filter(Boolean).join('\n');

  const candidates = new Map(); // url -> {title, url}
  const add = (url, text) => {
    if (!url || isNonArticleUrl(url)) return;
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

  const pattern = getArticlePattern(source.scrape_url);
  const matched = pattern ? [...candidates.values()].filter(c => pattern.test(c.url)) : [];
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

  return selected.map(a => toItem(source, { title: a.title, url: a.url, publishedAt: new Date() }));
}

module.exports = { fetchSourceArticles, isXUrl };
