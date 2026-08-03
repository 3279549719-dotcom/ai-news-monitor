require('dotenv').config();
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');

const { fetchArticleList } = require('./scraper');
const { fetchArticleContent } = require('./reader');
const { summarizeArticle, analyzeResult } = require('./ai');
const { searchAll } = require('./search');
const { loadKeywords, filterNewItems, saveArticles, loadKeywordSources } = require('./store');
const { crosscheck } = require('./crosscheck');

const PIPELINES = {
  blog: {
    fetch: (kw) => fetchArticleList(kw.url),
    analyze: async (_kw, item) => {
      const content = await fetchArticleContent(item.url);
      const summary = await summarizeArticle(item.title, content);
      return { relevant: true, score: 100, summary };
    },
  },
  search: {
    fetch: (kw, sources = []) => searchAll(kw.query, sources),
    analyze: (kw, item) => analyzeResult(kw.query, item.title, item.snippet, item.tier, kw.category_schema),
  },
};

async function analyzeItems(keyword, items, limit = 15) {
  const { analyze } = PIPELINES[keyword.type];
  const toProcess = items.slice(0, limit);
  const settled = await Promise.allSettled(toProcess.map(item => analyze(keyword, item)));

  return toProcess.reduce((acc, item, i) => {
    const r = settled[i];
    if (r.status === 'rejected') {
      console.error(`  分析失败 (${item.title.slice(0, 30)}): ${r.reason?.message}`);
      return acc;
    }
    const { relevant, score, summary, event, category } = r.value;
    return relevant ? [...acc, { ...item, score, summary, event, category }] : acc;
  }, []);
}

async function processKeyword(keyword) {
  const pipeline = PIPELINES[keyword.type];
  if (!pipeline) {
    console.warn(`  [${keyword.name}] 未知类型 "${keyword.type}"，跳过`);
    return [];
  }

  const label = keyword.type === 'blog' ? keyword.url : `"${keyword.query}"`;
  console.log(`\n[${keyword.name}] ${keyword.type === 'blog' ? '抓取' : '搜索'} ${label}`);

  const keywordSources = keyword.type === 'search'
    ? await loadKeywordSources(keyword.id)
    : [];

  const allItems = await pipeline.fetch(keyword, keywordSources);
  console.log(`  找到 ${allItems.length} 条`);

  const newItems = await filterNewItems(allItems, keyword.id);
  console.log(`  未处理: ${newItems.length}`);
  if (newItems.length === 0) return [];

  const relevant = await analyzeItems(keyword, newItems);
  console.log(`  相关: ${relevant.length}/${Math.min(newItems.length, 15)}`);

  // 交叉验证（方案B）：事件聚类 + 置信度 + 冲突标记
  let crosschecked = relevant;
  if (relevant.length > 0) {
    crosschecked = crosscheck(relevant);
    const high = crosschecked.filter(a => a.confidence === 'high').length;
    const conflict = crosschecked.filter(a => a.conflict_flag).length;
    console.log(`  [Crosscheck] ${crosschecked.length} 篇 → 高置信 ${high}，单源 ${crosschecked.length - high}，冲突 ${conflict}`);
  }

  const relevantUrls = new Set(crosschecked.map(r => r.url));
  const toSave = newItems.slice(0, 15).map(item => {
    const xc = crosschecked.find(r => r.url === item.url);
    return {
    keyword_id: keyword.id,
    title: item.title,
    url: item.url,
    source: item.source || keyword.type,
    snippet: item.snippet || null,
    summary: relevantUrls.has(item.url)
      ? (xc?.summary ?? null)
      : null,
    score: relevantUrls.has(item.url)
      ? (xc?.score ?? 0)
      : 0,
    published_at: item.publishedAt
      ? new Date(item.publishedAt).toISOString()
      : null,
    source_tier: item.tier ?? null,
    category: xc?.category ?? null,
    event: xc?.event ?? null,
    confidence: xc?.confidence ?? null,
    corroboration_count: xc?.corroboration_count ?? 0,
    conflict_flag: xc?.conflict_flag ?? false,
  };});

  await saveArticles(toSave);
  return crosschecked;
}

const CONFIDENCE_LABEL = { high: '高置信', medium: '待核实', low: '存疑' };

// 日报（方案C）：按关键词板块模板(category_schema)分组，附带置信度/印证数/冲突标记
function buildReport(sections) {
  const date = new Date().toLocaleString('zh-CN');
  const total = sections.reduce((n, s) => n + s.results.length, 0);
  const lines = [
    '# AI信息监控日报',
    `> 生成时间: ${date}  |  相关新内容: ${total} 条`,
    '',
  ];
  for (const { keyword, results } of sections) {
    if (results.length === 0) continue;
    lines.push(`## ${keyword.name}`, '');

    // 按板块模板分组；无 category 的文章归「未分类」
    const schema = keyword.category_schema || {};
    const boards = Object.entries(schema).map(([key, label]) => ({ key, label, items: [] }));
    boards.push({ key: '__uncat', label: '未分类', items: [] });
    for (const item of results) {
      const board = boards.find(b => b.key === item.category) || boards[boards.length - 1];
      board.items.push(item);
    }

    for (const board of boards) {
      if (board.items.length === 0) continue;
      lines.push(`### ${board.label}（${board.items.length}）`, '');
      for (const item of board.items) {
        const meta = [`来源: ${item.source || keyword.type}`];
        if (item.tier != null) meta.push(`T${item.tier}`);
        meta.push(`相关度: ${item.score}`);
        if (item.confidence) meta.push(CONFIDENCE_LABEL[item.confidence] || item.confidence);
        if (item.corroboration_count > 1) meta.push(`${item.corroboration_count}源印证`);
        if (item.conflict_flag) meta.push('⚠️冲突');
        if (item.publishedAt) meta.push(`发布: ${new Date(item.publishedAt).toLocaleDateString()}`);
        lines.push(`- ${item.title}`, `  > ${item.url}`, `  > ${meta.join('  |  ')}`, '', item.summary || '', '');
      }
      lines.push('');
    }
    lines.push('---', '');
  }
  return lines.join('\n');
}

async function run() {
  console.log('=== AI News Monitor ===');
  console.log(`时间: ${new Date().toLocaleString('zh-CN')}`);

  const keywords = await loadKeywords();
  if (keywords.length === 0) {
    console.log('keywords 表中没有启用的关键词，退出。');
    return;
  }
  console.log(`\n监控 ${keywords.length} 个关键词: ${keywords.map(k => k.name).join(', ')}`);

  const sections = [];
  for (const kw of keywords) {
    try {
      sections.push({ keyword: kw, results: await processKeyword(kw) });
    } catch (err) {
      console.error(`\n[${kw.name}] 错误: ${err.message}`);
      sections.push({ keyword: kw, results: [] });
    }
  }

  const hasResults = sections.some(s => s.results.length > 0);
  if (!hasResults) {
    console.log('\n本次无相关新内容。');
    return;
  }

  const report = buildReport(sections);
  const reportsDir = path.join(__dirname, '../reports');
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });
  const date = new Date().toISOString().split('T')[0];
  const reportPath = path.join(reportsDir, `${date}.md`);
  fs.writeFileSync(reportPath, report, 'utf8');
  console.log(`\n报告已保存: ${reportPath}`);
}

if (require.main === module) {
  const cronSchedule = process.env.CRON_SCHEDULE;
  if (cronSchedule) {
    if (!cron.validate(cronSchedule)) {
      console.error(`CRON_SCHEDULE 格式无效: "${cronSchedule}"`);
      process.exit(1);
    }
    console.log(`定时任务已启动，计划: ${cronSchedule}`);
    run().catch(console.error);
    cron.schedule(cronSchedule, () => run().catch(console.error));
  } else {
    run().catch(err => {
      console.error('运行出错:', err.message);
      process.exit(1);
    });
  }
}

module.exports = { run, buildReport };
