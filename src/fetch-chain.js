'use strict';

const crawl4ai = require('./crawl4ai-fetch');
const directFetch = require('./scraper-direct');
const xFetch = require('./x-fetch');

// 通道注册表：每通道取到空结果抛错，让链继续降级。
const BACKENDS = {
  crawl4ai: async (source) => {
    const items = await crawl4ai.fetchSourceArticles(source);
    if (!Array.isArray(items) || items.length === 0) throw new Error('crawl4ai 空结果');
    return items;
  },
  direct: async (source) => {
    const items = await directFetch.fetchSource(source);
    if (!Array.isArray(items) || items.length === 0) throw new Error('direct 空结果');
    return items;
  },
  twikit: async (source) => {
    const items = await xFetch.fetchXSourceArticles(source);
    if (!Array.isArray(items) || items.length === 0) throw new Error('twikit 空结果');
    return items;
  },
};

// 信源 → 有序通道链：优先信源声明的 backends；旧数据（无 backends）按 X/普通 分类给兼容默认。
function resolveBackends(source) {
  if (Array.isArray(source.backends) && source.backends.length > 0) {
    return source.backends;
  }
  return crawl4ai.isXUrl(source.scrape_url) ? ['twikit', 'crawl4ai'] : ['crawl4ai', 'direct'];
}

async function fetchSourceWithChain(source, registry = BACKENDS) {
  const chain = resolveBackends(source);
  let lastErr = null;
  for (const name of chain) {
    const fn = registry[name];
    if (typeof fn !== 'function') {
      lastErr = new Error(`未知 backend: ${name}`);
      console.warn(`  [${source.source_name}] 跳过未知通道 ${name}`);
      continue;
    }
    try {
      const items = await fn(source);
      if (!Array.isArray(items) || items.length === 0) {
        lastErr = new Error(`${name} 空结果`);
        console.log(`  [${name}] ${source.source_name} → 降级: 空结果`);
        continue;
      }
      console.log(`  [${name}] ${source.source_name}: ${items.length} 条`);
      return items;
    } catch (err) {
      lastErr = err;
      console.log(`  [${name}] ${source.source_name} → 降级: ${err.message}`);
    }
  }
  console.error(`  ${source.source_name} 全链失败: ${lastErr ? lastErr.message : '无可用通道'}`);
  return [];
}

module.exports = { BACKENDS, resolveBackends, fetchSourceWithChain };
