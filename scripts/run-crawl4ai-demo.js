'use strict';

/**
 * run-crawl4ai-demo.js — crawl4ai 一次性验证 demo（薄壳，重构后）
 *
 * 核心管线逻辑已抽到 src/run-single-keyword.js（与 run-mu-only.js 共享）。
 * 本脚本只负责：读 MCP 抓取的 items 文件 → 调共享管线。
 *
 * 输入：scripts/_crawl4ai-items.json（agent 用 crawl4ai MCP 抓取后结构化整理的 items）
 * 流程：URL去重 → AI 评分(event+category) → 事件聚类交叉验证 → 入库（与 run-mu-only 完全一致）
 *
 * 用法: node scripts/run-crawl4ai-demo.js
 */

require('dotenv').config();
const path = require('path');
const { runSingleKeyword } = require('../src/run-single-keyword');

const INPUT = path.join(__dirname, '_crawl4ai-items.json');

async function main() {
  console.log('=== crawl4ai 一次性验证 demo ===');
  console.log(`时间: ${new Date().toLocaleString('zh-CN')}\n`);

  const items = require(INPUT);
  console.log(`输入 items 文件: ${INPUT}（覆盖 tier: ${[...new Set(items.map(i => i.tier))].join('/')}）`);

  await runSingleKeyword({
    keywordId: 'manchester-united',
    items,
    itemsLabel: `MCP 抓取文件 ${path.basename(INPUT)}`,
    limit: 15,
  });
}

main().catch(err => { console.error('运行出错:', err); process.exit(1); });
