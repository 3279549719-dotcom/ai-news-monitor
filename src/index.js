require('dotenv').config();
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');

const { fetchArticleList } = require('./scraper');
const { fetchArticleContent } = require('./reader');
const { summarizeArticle, analyzeResult } = require('./ai');
const { searchAll } = require('./search');
const { loadKeywords, filterNewItems, saveArticles, loadKeywordSources } = require('./store');
const { crosscheck, CONFIDENCE_LABEL } = require('./crosscheck');
const { buildReport } = require('./report');
const { RESULT_LIMIT } = require('./config');

// 词根映射表 — 用于 preFilter 和 C1 验收
function getKeywordRoots(name) {
  const map = {
    'Manchester United': ['man', 'united', 'mufc', 'mufc', '老特拉福德', '梦剧场', 'red devils', 'rashford', 'bruno', 'garnacho', 'højlund', 'ten hag'],
    'Anthropic': ['anthropic', 'claude', 'amodei'],
    'Dallas Mavericks': ['maverick', 'mavs', 'dallas', 'doncic', 'luka', 'kyrie', 'irving', 'cuban'],
  };
  return map[name] || [];
}

// 前置过滤：标题不含关键词词根的直接跳过（省 DeepSeek 调用）
function preFilter(items, keywordName) {
  const roots = getKeywordRoots(keywordName);
  if (roots.length === 0) return items;
  const filtered = [];
  const skipped = [];
  for (const item of items) {
    const t = (item.title || '').toLowerCase();
    if (roots.some(r => t.includes(r.toLowerCase()))) {
      filtered.push(item);
    } else {
      skipped.push(item);
    }
  }
  if (skipped.length > 0) {
    console.log(`  [PreFilter] ${skipped.length} 条跳过（标题不含词根）`);
  }
  return filtered;
}

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

async function analyzeItems(keyword, items, limit = RESULT_LIMIT) {
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

  const isBlog = keyword.type === 'blog';
  const label = isBlog ? keyword.url : `"${keyword.query}"`;
  console.log(`\n[${keyword.name}] ${isBlog ? '抓取' : '搜索'} ${label}`);

  const keywordSources = isBlog ? [] : await loadKeywordSources(keyword.id);

  const allItems = await pipeline.fetch(keyword, keywordSources);
  console.log(`  找到 ${allItems.length} 条`);

  const newItems = await filterNewItems(allItems, keyword.id);
  console.log(`  未处理: ${newItems.length}`);
  if (newItems.length === 0) return [];

  // 前置过滤：只在大批量时启用，避免误杀少量新文章
  let candidates = newItems;
  if (newItems.length >= 5) {
    candidates = preFilter(newItems, keyword.name);
    if (candidates.length === 0) return [];
  }

  const relevant = await analyzeItems(keyword, candidates);
  console.log(`  相关: ${relevant.length}/${Math.min(candidates.length, RESULT_LIMIT)}`);

  // 交叉验证（方案B）：事件聚类 + 置信度 + 冲突标记
  let crosschecked = relevant;
  if (relevant.length > 0) {
    crosschecked = crosscheck(relevant);
    const high = crosschecked.filter(a => a.confidence === 'high').length;
    const conflict = crosschecked.filter(a => a.conflict_flag).length;
    console.log(`  [Crosscheck] ${crosschecked.length} 篇 → 高置信 ${high}，单源 ${crosschecked.length - high}，冲突 ${conflict}`);
  }

  const toSave = newItems.slice(0, RESULT_LIMIT).map(item => {
    const xc = crosschecked.find(r => r.url === item.url);
    return {
      keyword_id: keyword.id,
      title: item.title,
      url: item.url,
      source: item.source || keyword.type,
      snippet: item.snippet || null,
      summary: xc?.summary ?? null,
      score: xc?.score ?? 0,
      published_at: item.publishedAt
        ? new Date(item.publishedAt).toISOString()
        : null,
      source_tier: item.tier ?? null,
      category: xc?.category ?? null,
      event: xc?.event ?? null,
      confidence: xc?.confidence ?? null,
      corroboration_count: xc?.corroboration_count ?? 0,
      conflict_flag: xc?.conflict_flag ?? false,
    };
  });

  await saveArticles(toSave);
  return crosschecked;
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

module.exports = { run, buildReport, getKeywordRoots, preFilter };
