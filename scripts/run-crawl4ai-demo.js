require('dotenv').config();
const { loadKeywords, filterNewItems, saveArticles } = require('../src/store');
const { analyzeResult } = require('../src/ai');
const { crosscheck } = require('../src/crosscheck');

// crawl4ai 一次性验证脚本（方案BC 配套）
// 输入：scripts/_crawl4ai-items.json（agent 用 crawl4ai MCP 抓取后结构化整理的 items）
// 流程：URL去重 → AI 评分(event+category) → 事件聚类交叉验证 → 入库，与 run-mu-only.js 完全一致，
//       唯一区别是 items 来源从 searchAll 换成 MCP 抓取的文件。
const INPUT = require('path').join(__dirname, '_crawl4ai-items.json');

async function runDemo() {
  console.log('=== crawl4ai 一次性验证 demo ===');
  console.log(`时间: ${new Date().toLocaleString('zh-CN')}\n`);

  const keywords = await loadKeywords();
  const mu = keywords.find(k => k.id === 'manchester-united');
  if (!mu) { console.log('未找到 manchester-united 关键词'); return; }

  const items = require(INPUT);
  console.log(`输入 items: ${items.length} 条（覆盖 tier: ${[...new Set(items.map(i => i.tier))].join('/')}）`);
  console.log(`  category_schema: ${Object.keys(mu.category_schema || {}).length} 类`);

  const newItems = await filterNewItems(items, mu.id);
  console.log(`  未处理: ${newItems.length}/${items.length}（其余为已入库去重）`);
  if (newItems.length === 0) { console.log('  无新文章，退出'); return; }

  // 逐篇 AI 分析（带 event + category）
  const toProcess = newItems.slice(0, 15);
  const analyzed = [];
  for (const item of toProcess) {
    try {
      const r = await analyzeResult({ query: mu.query, title: item.title, snippet: item.snippet, tier: item.tier, categorySchema: mu.category_schema });
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
  const relevantUrls = new Set(crosschecked.map(r => r.url));
  const toSave = toProcess.map(item => {
    const xc = crosschecked.find(r => r.url === item.url);
    return {
      keyword_id: mu.id,
      title: item.title,
      url: item.url,
      source: item.source || mu.type,
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
}

runDemo().catch(err => { console.error('运行出错:', err); process.exit(1); });
