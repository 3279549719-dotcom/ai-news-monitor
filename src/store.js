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

// Use RPC to avoid PostgREST URL length limit with long URLs (e.g. Google News)
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

module.exports = { loadKeywords, filterNewItems, saveArticles };
