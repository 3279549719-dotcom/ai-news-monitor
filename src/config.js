'use strict';

/**
 * Central config module — refactored 2026-08-10.
 *
 * Public constants are exported directly. Sensitive keys (API keys, tokens,
 * passwords) are accessed through `getSecret(name)` so they are never dumped
 * when a test or debug script does `console.log(require('./config'))`.
 *
 * dotenv is loaded here exactly once; any entry point that requires this
 * module gets the .env variables.
 */
require('dotenv').config();
const path = require('path');

// ============================================================================
// Public constants — safe to log / inspect
// ============================================================================

module.exports = {
  // AI relevance threshold (score>=60 counts as relevant).
  MIN_SCORE: 60,

  // Items per keyword per run.
  RESULT_LIMIT: 30,

  // T0 官方信源评分放行线。
  T0_FLOOR: 85,

  // T1 记者评分保底。
  T1_FLOOR: 40,

  // Pipeline type registry. blog = LEGACY, new keywords should use search.
  PIPELINES: { blog: 'blog', search: 'search' },

  // Non-T0 source cap per source.
  MAX_PER_SOURCE: 5,

  // Shared HTTP headers.
  HTTP_USER_AGENT: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  HTTP_TIMEOUT_MS: 20000,

  // DeepSeek LLM (non-sensitive parts).
  DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
  DEEPSEEK_MODEL: process.env.DEEPSEEK_MODEL || 'deepseek-chat',

  // crawl4ai container URL.
  CRAWL4AI_URL: process.env.CRAWL4AI_URL || 'http://localhost:11235',

  // JS-heavy sites that need extra render wait.
  JS_SOURCES: new Set(['mavsmoneyball.com', 'thesmokingcuban.com']),
  JS_WAIT_MS: 5000,

  // Seen ring (incremental dedup).
  SEEN_RING_SIZE: 200,
  SEEN_STORE_PATH: process.env.SEEN_STORE_PATH || path.join(__dirname, '../logs/.seen-ids.json'),

  // Notification channels (comma-separated).
  NOTIFY_CHANNELS: process.env.NOTIFY_CHANNELS || 'email',

  // X/Twitter fetch (non-sensitive).
  X_PYTHON: process.env.X_PYTHON || 'python',
  X_TWIKIT_ENABLED: process.env.X_TWIKIT_ENABLED !== '0',
  X_COOKIES_FILE: process.env.X_COOKIES_FILE || '',

  // Supabase (non-sensitive).
  SUPABASE_URL: process.env.SUPABASE_URL,

  // Email digest (non-sensitive).
  EMAIL_ENABLED: process.env.EMAIL_ENABLED !== '0',
  SMTP_HOST: process.env.SMTP_HOST || '',
  SMTP_PORT: Number(process.env.SMTP_PORT) || 465,
  SMTP_SECURE: process.env.SMTP_SECURE !== '0' && process.env.SMTP_SECURE !== 'false',
  EMAIL_USER: process.env.EMAIL_USER || '',
  RECEIVER_EMAIL: process.env.RECEIVER_EMAIL || '',
};

// ============================================================================
// Sensitive secrets — accessed via getSecret() only
// ============================================================================

const _secrets = {
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY || '',
  CRAWL4AI_API_TOKEN: process.env.CRAWL4AI_API_TOKEN || '',
  X_AUTH_TOKEN: process.env.X_AUTH_TOKEN || '',
  X_CT0: process.env.X_CT0 || '',
  X_USERNAME: process.env.X_USERNAME || '',
  X_PASSWORD: process.env.X_PASSWORD || '',
  SUPABASE_KEY: process.env.SUPABASE_KEY || '',
  SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY || '',
  EMAIL_AUTH_CODE: process.env.EMAIL_AUTH_CODE || '',
};

/**
 * Get a sensitive config value by name. Returns empty string when unset.
 * Use this instead of reading keys directly from config exports.
 * @param {string} name - Secret key name, e.g. 'DEEPSEEK_API_KEY'.
 * @returns {string}
 */
function getSecret(name) {
  return _secrets[name] || '';
}

module.exports.getSecret = getSecret;
// Only expose _secrets in test environment — production code must use getSecret()
if (process.env.NODE_ENV === 'test') module.exports._secrets = _secrets;
