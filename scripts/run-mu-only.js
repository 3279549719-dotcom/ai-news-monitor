'use strict';

/**
 * run-mu-only.js — 单跑 Manchester United（薄壳，重构后）
 *
 * 核心管线逻辑已抽到 src/run-single-keyword.js（与 run-crawl4ai-demo.js 共享）。
 * 本脚本只负责：取关键词 → 实时 searchAll 搜 items → 调共享管线。
 *
 * 用法: node scripts/run-mu-only.js
 */

require('dotenv').config();
const { runSingleKeyword, searchAll } = require('../src/run-single-keyword');

async function main() {
  console.log('=== 单跑 Manchester United ===');
  console.log(`时间: ${new Date().toLocaleString('zh-CN')}\n`);

  const keywordId = 'manchester-united';
  const { loadKeywords, loadKeywordSources } = require('../src/store');
  const keywords = await loadKeywords();
  const mu = keywords.find(k => k.id === keywordId);
  if (!mu) {
    console.log('未找到 manchester-united 关键词');
    return;
  }
  const sources = await loadKeywordSources(mu.id);
  const allItems = await searchAll(mu.query, sources);
  console.log(`  搜索找到 ${allItems.length} 条`);

  await runSingleKeyword({
    keywordId,
    items: allItems,
    itemsLabel: `searchAll 实时搜索`,
    limit: 15,
  });
}

main().catch(err => { console.error('运行出错:', err); process.exit(1); });
