const { createClient } = require('@supabase/supabase-js');
const { SUPABASE_URL, SUPABASE_KEY, SUPABASE_SERVICE_KEY } = require('./config');

/**
 * Supabase client singleton + retry wrapper.
 *
 * All data-access modules (store.js etc.) go through this module so that a
 * single client is shared across the process and transient network errors are
 * retried with exponential backoff.
 *
 * The client uses the service-role key (SUPABASE_SERVICE_KEY) so the pipeline
 * can write articles even after RLS is tightened to anon-read-only for the
 * public frontend. Falls back to SUPABASE_KEY for legacy single-key setups.
 */

let _client;

/**
 * Get the shared Supabase client, lazily creating it on first use.
 * Throws if SUPABASE_URL is missing and neither SUPABASE_KEY nor
 * SUPABASE_SERVICE_KEY is configured.
 * @returns {object} Supabase client instance.
 */
function getClient() {
  if (!_client) {
    const key = SUPABASE_SERVICE_KEY || SUPABASE_KEY;
    if (!SUPABASE_URL || !key) {
      throw new Error('SUPABASE_URL and SUPABASE_KEY (or SUPABASE_SERVICE_KEY) must be set in .env');
    }
    _client = createClient(SUPABASE_URL, key, {
      db: { schema: 'public' },
      global: { headers: { 'X-Client': 'ai-news-monitor' } },
    });
  }
  return _client;
}

/**
 * Retry wrapper for transient network errors.
 * @param {Function} fn - Async function to run; resolved value is returned.
 * @param {number} [retries=3] - Max retry attempts after the first failure.
 * @param {number} [delayMs=1000] - Base delay in ms; grows linearly per attempt.
 * @returns {Promise<*>} Result of fn, or throws the last error when retries run out.
 */
async function withRetry(fn, retries = 3, delayMs = 1000) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < retries) await new Promise(r => setTimeout(r, delayMs * (i + 1)));
    }
  }
  throw lastErr;
}

module.exports = { getClient, withRetry };
