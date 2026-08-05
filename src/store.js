const { getClient, withRetry } = require('./db');

async function loadKeywords() {
  return withRetry(async () => {
    const { data, error } = await getClient()
      .from('keywords')
      .select('*')
      .eq('enabled', true)
      .order('created_at');
    if (error) throw new Error(`loadKeywords: ${error.message}`);
    return data || [];
  });
}

// 用 RPC 查重，规避 URL 数组过大触发 PostgREST 请求 URL 长度限制
async function filterNewItems(items, keywordId) {
  if (items.length === 0) return [];
  const urls = items.map(i => i.url);

  const { data, error } = await withRetry(() =>
    getClient().rpc('get_new_urls', { p_keyword_id: keywordId, p_urls: urls })
  );
  if (error) throw new Error(`filterNewItems RPC: ${error.message}`);

  const newUrlSet = new Set((data || []).map(r => r.url));
  return items.filter(item => newUrlSet.has(item.url));
}

async function saveArticles(records) {
  if (records.length === 0) return;
  await withRetry(async () => {
    const { error } = await getClient()
      .from('articles')
      .upsert(records, { onConflict: 'keyword_id,url', ignoreDuplicates: false });
    if (error) throw new Error(`saveArticles: ${error.message}`);
  });
}

async function loadKeywordSources(keywordId) {
  return withRetry(async () => {
    const { data, error } = await getClient()
      .from('keyword_sources')
      .select('rss_url, scrape_url, source_name, tier, fetch_type')
      .eq('keyword_id', keywordId)
      .eq('enabled', true);
    if (error) throw new Error(`loadKeywordSources: ${error.message}`);
    return data || [];
  });
}

// 近 N 天 score≥60 的相关文章（Phase9 跨运行去重用：比对已存事件，避免同一事件重复入库）
async function loadRecentRelevant(keywordId, days = 30) {
  if (!keywordId) return [];
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  return withRetry(async () => {
    const { data, error } = await getClient()
      .from('articles')
      .select('id, url, event, title, score, created_at')
      .eq('keyword_id', keywordId)
      .gte('score', 60)
      .gte('created_at', cutoff)
      .order('created_at', { ascending: false })
      .limit(150);
    if (error) throw new Error(`loadRecentRelevant: ${error.message}`);
    return data || [];
  });
}

module.exports = { loadKeywords, filterNewItems, saveArticles, loadKeywordSources, loadRecentRelevant };
