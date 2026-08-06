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
  RESULT_LIMIT: 30,

  // 单源产出上限（仅非 T0 源）：防单源淹没分析预算，保证多源（尤其 T1 X 记者）
  // 都能进入 feed。T0 官方源不设限。
  MAX_PER_SOURCE: 5,

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

  // X/Twitter 抓取（twikit 主 + crawl4ai 兜底）。凭证仅在 .env 提供。
  X_PYTHON: process.env.X_PYTHON || 'python',
  X_TWIKIT_ENABLED: process.env.X_TWIKIT_ENABLED !== '0',
  X_AUTH_TOKEN: process.env.X_AUTH_TOKEN || '',
  X_CT0: process.env.X_CT0 || '',
  X_USERNAME: process.env.X_USERNAME || '',
  X_PASSWORD: process.env.X_PASSWORD || '',
  X_COOKIES_FILE: process.env.X_COOKIES_FILE || '',

  // Supabase connection.
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_KEY: process.env.SUPABASE_KEY,
  // Server-side service-role key used for writes (bypasses RLS). Present in
  // .env but never shipped to the client bundle; falls back to SUPABASE_KEY
  // when unset (legacy single-key setups).
  SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY || '',
};
