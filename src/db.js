const { createClient } = require('@supabase/supabase-js');
const { SUPABASE_URL, SUPABASE_KEY } = require('./config');

let _client;

function getClient() {
  if (!_client) {
    if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('SUPABASE_URL and SUPABASE_KEY must be set in .env');
    _client = createClient(SUPABASE_URL, SUPABASE_KEY, {
      db: { schema: 'public' },
      global: { headers: { 'X-Client': 'ai-news-monitor' } },
    });
  }
  return _client;
}

// Retry wrapper for transient network errors
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
