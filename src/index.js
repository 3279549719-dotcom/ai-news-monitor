require('dotenv').config();
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');

const { fetchArticleList } = require('./scraper');
const { fetchArticleContent } = require('./reader');
const { summarizeArticle, analyzeResult } = require('./ai');
const { searchAll } = require('./search');
const { loadKeywords, filterNewItems, saveArticles } = require('./store');

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
    fetch: (kw) => searchAll(kw.query),
    analyze: (kw, item) => analyzeResult(kw.query, item.title, item.snippet),
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
    const { relevant, score, summary } = r.value;
    return relevant ? [...acc, { ...item, score, summary }] : acc;
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

  const allItems = await pipeline.fetch(keyword);
  console.log(`  找到 ${allItems.length} 条`);

  const newItems = await filterNewItems(allItems, keyword.id);
  console.log(`  未处理: ${newItems.length}`);
  if (newItems.length === 0) return [];

  const relevant = await analyzeItems(keyword, newItems);
  console.log(`  相关: ${relevant.length}/${Math.min(newItems.length, 15)}`);

  const relevantUrls = new Set(relevant.map(r => r.url));
  const toSave = newItems.slice(0, 15).map(item => ({
    keyword_id: keyword.id,
    title: item.title,
    url: item.url,
    source: item.source || keyword.type,
    snippet: item.snippet || null,
    summary: relevantUrls.has(item.url)
      ? (relevant.find(r => r.url === item.url)?.summary ?? null)
      : null,
    score: relevantUrls.has(item.url)
      ? (relevant.find(r => r.url === item.url)?.score ?? 0)
      : 0,
    published_at: item.publishedAt
      ? new Date(item.publishedAt).toISOString()
      : null,
  }));

  await saveArticles(toSave);
  return relevant;
}

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
    for (const item of results) {
      const meta = [`来源: ${item.source || keyword.type}`, `相关度: ${item.score}`];
      if (item.publishedAt) meta.push(`发布: ${new Date(item.publishedAt).toLocaleDateString()}`);
      lines.push(`### ${item.title}`, `> ${item.url}`, `> ${meta.join('  |  ')}`, '', item.summary || '', '');
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
