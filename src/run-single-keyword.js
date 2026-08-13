'use strict';

/**
 * run-single-keyword.js — 单关键词管线共享核心（重构建议 4）
 *
 * 从 run-mu-only.js 与 run-crawl4ai-demo.js 抽出的完全一致的 45 行管线逻辑：
 *   输入 items → URL/已入库去重 → 逐篇 AI 分析（event+category）→ 交叉验证 → 入库
 *
 * 两个脚本的唯一区别是 items 来源：
 *   run-mu-only.js        → searchAll 实时搜索
 *   run-crawl4ai-demo.js  → 文件/MCP 抓取结果
 * 本模块把来源做成可注入参数，两处调用方都变薄壳。
 *
 * 注意：本模块被 scripts/ 直接 require 时也会被 npm test 的 src/*.test.js glob 匹配？
 * 不会——node --test 只跑 *.test.js 文件。本文件无副作用（只导出函数）。
 */

const { loadKeywords, loadKeywordSources, filterNewItems, saveArticles } = require('./store');
const { searchAll } = require('./search');
const { analyzeResultSmart: analyzeResult } = require('./ai');
const { crosscheck } = require('./crosscheck');

/**
 * 单关键词完整管线。
 * @param {Object} opts - 选项。
 * @param {string} opts.keywordId - 关键词 id（如 manchester-united）。
 * @param {Array} opts.items - 候选 items（[{title, url, snippet, tier, publishedAt, source}]）。
 * @param {string} opts.itemsLabel - items 来源描述（日志用）。
 * @param {number} [opts.limit=15] - 最多分析条数。
 * @param {Function} [opts.analyze] - 分析函数（默认 ai.analyzeResultSmart），便于测试注入。
 * @param {boolean} [opts.dryRun=false] - true 时不入库（只跑分析+交叉验证）。
 * @returns {Promise<{keyword:Object, analyzed:Array, crosschecked:Array, saved:Array}>}
 */
async function runSingleKeyword(opts) {
  const { keywordId, items, itemsLabel, limit = 15, analyze = analyzeResult, dryRun = false } = opts;

  const keywords = await loadKeywords();
  const kw = keywords.find(k => k.id === keywordId);
  if (!kw) {
    console.log(`未找到 ${keywordId} 关键词`);
    return { keyword: null, analyzed: [], crosschecked: [], saved: [] };
  }

  console.log(`[${kw.name || keywordId}] 搜索 "${kw.query}"`);
  console.log('  category_schema:', JSON.stringify(kw.category_schema));

  const sources = await loadKeywordSources(kw.id);
  console.log(`  白名单信源: ${sources.length} 个 (${sources.map(s => s.source_name).join(', ')})\n`);

  console.log(`输入 items: ${items.length} 条（${itemsLabel}）`);

  const newItems = await filterNewItems(items, kw.id);
  console.log(`  未处理: ${newItems.length}/${items.length}（其余为已入库去重）`);
  if (newItems.length === 0) {
    console.log('  无新文章，退出');
    return { keyword: kw, analyzed: [], crosschecked: [], saved: [] };
  }

  // 逐篇 AI 分析（带 event + category）
  const toProcess = newItems.slice(0, limit);
  const analyzed = [];
  for (const item of toProcess) {
    try {
      const r = await analyze({
        query: kw.query,
        title: item.title,
        snippet: item.snippet,
        tier: item.tier,
        categorySchema: kw.category_schema,
      });
      console.log(`  [AI] ${r.relevant ? '✅' : '❌'} score=${r.score} cat=${r.category || '-'} | ${item.title.slice(0, 40)}`);
      if (r.relevant) analyzed.push({ ...item, ...r });
    } catch (err) {
      console.log(`  [AI] 失败: ${err.message}`);
    }
  }
  console.log(`\n  相关: ${analyzed.length}/${toProcess.length}`);

  // 交叉验证
  const crosschecked = crosscheck(analyzed);
  console.log('\n  [Crosscheck] 事件聚类结果:');
  const groups = {};
  for (const a of crosschecked) {
    const key = a.event || '未分类';
    if (!groups[key]) groups[key] = [];
    groups[key].push(a);
  }
  for (const [ev, arr] of Object.entries(groups)) {
    console.log(`    📌 ${ev}`);
    for (const a of arr) {
      console.log(`       ${a.source} | ${a.confidence} | 印证${a.corroboration_count} | 冲突${a.conflict_flag ? '⚠️' : '否'} | ${a.title.slice(0, 35)}`);
    }
  }

  // 入库
  if (dryRun) {
    console.log('\n  （dry-run：跳过入库）');
    return { keyword: kw, analyzed, crosschecked, saved: [] };
  }

  const relevantUrls = new Set(crosschecked.map(r => r.url));
  const toSave = toProcess.map(item => {
    const xc = crosschecked.find(r => r.url === item.url);
    return {
      keyword_id: kw.id,
      title: item.title,
      url: item.url,
      source: item.source || kw.type,
      snippet: item.snippet || null,
      summary: relevantUrls.has(item.url) ? (xc?.summary ?? null) : null,
      score: relevantUrls.has(item.url) ? (xc?.score ?? 0) : 0,
      published_at: item.publishedAt ? new Date(item.publishedAt).toISOString() : null,
      source_tier: item.tier ?? null,
      category: xc?.category ?? null,
      event: xc?.event ?? null,
      confidence: xc?.confidence ?? null,
      corroboration_count: xc?.corroboration_count ?? 0,
      conflict_flag: xc?.conflict_flag ?? false,
    };
  });

  await saveArticles(toSave);
  console.log(`\n  ✅ 已入库 ${toSave.length} 条`);
  return { keyword: kw, analyzed, crosschecked, saved: toSave };
}

module.exports = { runSingleKeyword, searchAll };
