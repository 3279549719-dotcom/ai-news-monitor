require('dotenv').config();
const { loadKeywords, loadKeywordSources, filterNewItems, saveArticles } = require('../src/store');
const { searchAll } = require('../src/search');
const { analyzeResult } = require('../src/ai');
const { crosscheck } = require('../src/crosscheck');

async function runMU() {
  console.log('=== 单跑 Manchester United ===');
  console.log(`时间: ${new Date().toLocaleString('zh-CN')}\n`);

  const keywords = await loadKeywords();
  const mu = keywords.find(k => k.id === 'manchester-united');
  if (!mu) { console.log('未找到 manchester-united 关键词'); return; }

  console.log(`[Manchester United] 搜索 "${mu.query}"`);
  console.log('  category_schema:', JSON.stringify(mu.category_schema));

  const sources = await loadKeywordSources(mu.id);
  console.log(`  白名单信源: ${sources.length} 个 (${sources.map(s => s.source_name).join(', ')})\n`);

  const allItems = await searchAll(mu.query, sources);
  console.log(`  找到 ${allItems.length} 条`);

  const newItems = await filterNewItems(allItems, mu.id);
  console.log(`  未处理: ${newItems.length}`);
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
  for (const [ev, items] of Object.entries(groups)) {
    console.log(`    📌 ${ev}`);
    for (const a of items) {
      console.log(`       ${a.source} | ${a.confidence} | 印证${a.corroboration_count} | 冲突${a.conflict_flag ? '⚠️' : '否'} | ${a.title.slice(0, 35)}`);
    }
  }

  // 入库
  const relevantUrls = new Set(crosschecked.map(r => r.url));
  const toSave = newItems.slice(0, 15).map(item => {
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

runMU().catch(err => { console.error('运行出错:', err); process.exit(1); });
