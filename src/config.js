'use strict';

/**
 * Central config module.
 *
 * Reads environment variables and exposes global constants so that individual
 * modules never touch `process.env` directly. dotenv is loaded here exactly
 * once; any entry point that requires this module gets the .env variables.
 */
require('dotenv').config();

module.exports = {
  // AI relevance threshold (search-type score>=60 counts as relevant) and the
  // maximum number of items processed per keyword.
  MIN_SCORE: 60,
  RESULT_LIMIT: 15,

  // Shared HTTP (axios) user-agent and timeout for scraping.
  HTTP_USER_AGENT: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  HTTP_TIMEOUT_MS: 20000,

  // DeepSeek LLM endpoint (OpenAI SDK compatible).
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
  DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
  DEEPSEEK_MODEL: process.env.DEEPSEEK_MODEL || 'deepseek-chat',

  // crawl4ai Docker container (primary fetch channel of the scheduled pipeline).
  CRAWL4AI_URL: process.env.CRAWL4AI_URL || 'http://localhost:11235',
  CRAWL4AI_API_TOKEN: process.env.CRAWL4AI_API_TOKEN || '',

  // JS-heavy sites: crawlPage must wait for client-side rendering before
  // collecting links, otherwise only the first-screen skeleton is returned.
  JS_SOURCES: new Set(['mavsmoneyball.com', 'thesmokingcuban.com']),
  JS_WAIT_MS: 5000,

  // Supabase connection.
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_KEY: process.env.SUPABASE_KEY,
  // Server-side service-role key used for writes (bypasses RLS). Present in
  // .env but never shipped to the client bundle; falls back to SUPABASE_KEY
  // when unset (legacy single-key setups).
  SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY || '',
};
