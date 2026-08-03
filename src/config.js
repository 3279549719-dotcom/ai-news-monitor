'use strict';

// 集中读取环境变量与全局常量，避免各模块散读 process.env。
// dotenv 在此加载一次，任何直接 require 本模块的入口都会拿到 .env 变量。
require('dotenv').config();

module.exports = {
  // AI 评分门槛（search 类型 score>=60 视为相关）与每关键词最多处理条数
  MIN_SCORE: 60,
  RESULT_LIMIT: 15,

  // HTTP 抓取（axios）统一 UA 与超时
  HTTP_USER_AGENT: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  HTTP_TIMEOUT_MS: 20000,

  // DeepSeek（openai SDK 兼容端点）
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
  DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
  DEEPSEEK_MODEL: process.env.DEEPSEEK_MODEL || 'deepseek-chat',

  // crawl4ai 容器（定时管线主抓取通道）
  CRAWL4AI_URL: process.env.CRAWL4AI_URL || 'http://localhost:11235',
  CRAWL4AI_API_TOKEN: process.env.CRAWL4AI_API_TOKEN || '',

  // Supabase
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_KEY: process.env.SUPABASE_KEY,
};
