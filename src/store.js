const { getClient, withRetry } = require('./db');

/**
 * Data-access layer for Supabase.
 *
 * Centralizes all keyword / keyword-source / article persistence used by the
 * pipeline. Every query is wrapped in withRetry to absorb transient network
 * errors. Returned rows are plain objects matching the DB columns.
 */

/**
 * Load all enabled keywords, ordered by creation time.
 * @returns {Promise<Array>} List of keyword rows from the `keywords` table.
 */
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

/**
 * Filter out items whose URL already exists for the keyword.
 * Uses the get_new_urls RPC to avoid PostgREST URL length limits on big arrays.
 * @param {Array} items - Candidate items with a `url` field.
 * @param {string} keywordId - Target keyword id.
 * @returns {Promise<Array>} Only items whose URL is new.
 */
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

/**
 * Upsert article records, deduplicating on (keyword_id, url).
 * @param {Array} records - Article rows to insert/update.
 * @returns {Promise<void>}
 */
async function saveArticles(records) {
  if (records.length === 0) return;
  await withRetry(async () => {
    const { error } = await getClient()
      .from('articles')
      .upsert(records, { onConflict: 'keyword_id,url', ignoreDuplicates: false });
    if (error) throw new Error(`saveArticles: ${error.message}`);
  });
}

/**
 * Load the enabled whitelist sources for a keyword.
 * @param {string} keywordId - Target keyword id.
 * @returns {Promise<Array>} Source rows (rss_url, scrape_url, source_name, tier, fetch_type, backends).
 */
async function loadKeywordSources(keywordId) {
  return withRetry(async () => {
    const { data, error } = await getClient()
      .from('keyword_sources')
      .select('rss_url, scrape_url, source_name, tier, fetch_type, backends')
      .eq('keyword_id', keywordId)
      .eq('enabled', true);
    if (error) throw new Error(`loadKeywordSources: ${error.message}`);
    return data || [];
  });
}

/**
 * Load recent relevant (score>=60) articles for cross-run dedupe (Phase9):
 * compares new events against already-stored ones to avoid re-ingesting the
 * same event across runs.
 * @param {string} keywordId - Target keyword id.
 * @param {number} [days=30] - Recency window in days.
 * @returns {Promise<Array>} Up to 150 recent relevant article rows.
 */
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
