'use strict';
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');

// --- config ---
const {
  RESULT_LIMIT, MIN_SCORE, SEEN_RING_SIZE, SEEN_STORE_PATH,
  T0_FLOOR, T1_FLOOR,
} = require('./config');

// --- pipeline helpers ---
const { getKeywordRoots, preFilter } = require('./keyword-roots');
const { applyTierFloor } = require('./tiers');
const { keyForUrl, SeenStore } = require('./seen');
const { toArticleRecord } = require('./items');
const crawl4ai = require('./crawl4ai-fetch');
const { searchAll } = require('./search');
const { loadKeywords, filterNewItems, saveArticles, loadKeywordSources, loadRecentRelevant } = require('./store');
const { crosscheck, collapseSameEvent, dedupeAgainstExisting } = require('./crosscheck');
const { buildReport } = require('./report');
const { sendDailyDigest } = require('./email');

// --- legacy blog pipeline ---
const { fetchArticleList } = require('./legacy/scraper');
const { fetchArticleContent } = require('./legacy/reader');
const { summarizeArticle, analyzeResult } = require('./ai');

// ============================================================================
// Pipeline 定义
// ============================================================================

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
    analyze: (kw, item) => analyzeResult({
      query: kw.query, title: item.title, snippet: item.snippet,
      tier: item.tier, categorySchema: kw.category_schema, body: item.body,
    }),
  },
};

// ============================================================================
// 正文喂养 + 分析
// ============================================================================

async function feedArticleBodies(items, poolSize = 3) {
  if (typeof crawl4ai.fetchArticleBody !== 'function') {
    for (const item of items) item.body = null;
    return;
  }
  let idx = 0;
  const workers = Array.from({ length: Math.min(poolSize, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      const item = items[i];
      if (/(x\.com|twitter\.com)\/.+\/status\//.test(item.url || '')) {
        item.body = null;
        continue;
      }
      try {
        const body = await crawl4ai.fetchArticleBody(item.url);
        item.body = typeof body === 'string' && body.trim() ? body : null;
      } catch { item.body = null; }
    }
  });
  await Promise.allSettled(workers);
}

async function analyzeItems(keyword, items, limit = RESULT_LIMIT) {
  const { analyze } = PIPELINES[keyword.type];
  const toProcess = items.slice(0, limit);
  if (keyword.type === 'search') await feedArticleBodies(toProcess, 3);

  const settled = await Promise.allSettled(toProcess.map(item => analyze(keyword, item)));
  return toProcess.reduce((acc, item, i) => {
    const r = settled[i];
    if (r.status === 'rejected') {
      console.error(`  分析失败 (${item.title.slice(0, 30)}): ${r.reason?.message}`);
      return acc;
    }
    const { score, summary, event, event_type, category } = r.value;
    const finalScore = applyTierFloor(score, item.tier);
    return finalScore >= MIN_SCORE
      ? [...acc, { ...item, score: finalScore, summary, event, event_type, category }]
      : acc;
  }, []);
}

// ============================================================================
// 幂等闸
// ============================================================================

function applySeenRing(items, seen) {
  if (!items || items.length === 0) return items;
  return items.filter(i => !seen.has(i.source, keyForUrl(i.url)));
}

// ============================================================================
// Pipeline 阶段函数
// ============================================================================

async function fetchCandidates(keyword, seen) {
  const pipeline = PIPELINES[keyword.type];
  if (!pipeline) {
    console.warn(`  [${keyword.name}] 未知类型 "${keyword.type}"，跳过`);
    return null;
  }
  const isBlog = keyword.type === 'blog';
  const label = isBlog ? keyword.url : `"${keyword.query}"`;
  console.log(`\n[${keyword.name}] ${isBlog ? '抓取' : '搜索'} ${label}`);

  const keywordSources = isBlog ? [] : await loadKeywordSources(keyword.id);
  const allItems = await pipeline.fetch(keyword, keywordSources);
  console.log(`  找到 ${allItems.length} 条`);

  const ringFresh = applySeenRing(allItems, seen);
  if (ringFresh.length < allItems.length) {
    console.log(`  [Seen] ${allItems.length - ringFresh.length} 条近期已分析，跳过`);
  }

  const newItems = await filterNewItems(ringFresh, keyword.id);
  console.log(`  未处理: ${newItems.length}`);
  return newItems;
}

async function analyzeAndCrosscheck(keyword, newItems) {
  let candidates = newItems;
  if (newItems.length >= 5) {
    candidates = preFilter(newItems, keyword.name);
    if (candidates.length === 0) return [];
  }

  const relevant = await analyzeItems(keyword, candidates);
  console.log(`  相关: ${relevant.length}/${Math.min(candidates.length, RESULT_LIMIT)}`);

  let crosschecked = relevant;
  if (relevant.length > 0) {
    crosschecked = crosscheck(relevant);
    const high = crosschecked.filter(a => a.confidence === 'high').length;
    const conflict = crosschecked.filter(a => a.conflict_flag).length;
    console.log(`  [Crosscheck] ${crosschecked.length} 篇 → 高置信 ${high}，单源 ${crosschecked.length - high}，冲突 ${conflict}`);
  }

  let toSaveRelevant = crosschecked;
  if (crosschecked.length > 0) {
    const before = crosschecked.length;
    toSaveRelevant = collapseSameEvent(crosschecked);
    const dropped = before - toSaveRelevant.length;
    if (dropped > 0) console.log(`  [Dedup] 同批合并: ${before} → ${toSaveRelevant.length}（丢弃 ${dropped} 条同事件重复）`);
  }
  return toSaveRelevant;
}

async function dedupeAgainstRecent(items, keywordId, days = 30) {
  if (!items || items.length === 0) return items;
  const existing = await loadRecentRelevant(keywordId, days);
  if (existing.length === 0) return items;

  const { kept, dropped } = dedupeAgainstExisting(items, existing);
  for (const item of dropped) {
    console.log(`  [Dedup] 跨运行跳过: ${item.title.slice(0, 50)}（近${days}天已存在相似事件）`);
  }
  if (dropped.length > 0) console.log(`  [Dedup] 跨运行共跳过 ${dropped.length} 条`);
  return kept;
}

function assembleRecords(keyword, toSaveRelevant, allNewItems) {
  const savedRelevant = new Set(toSaveRelevant.map(r => r.url));
  const slice = allNewItems.slice(0, RESULT_LIMIT);

  const relevantRecords = toSaveRelevant.map(item => toArticleRecord(item, keyword, {
    summary: item.summary ?? null,
    score: item.score ?? 0,
    category: item.category ?? null,
    event: item.event ?? null,
    event_type: item.event_type ?? null,
    confidence: item.confidence ?? null,
    corroboration_count: item.corroboration_count ?? 0,
    conflict_flag: item.conflict_flag ?? false,
  }));

  const irrelevantRecords = slice
    .filter(i => !savedRelevant.has(i.url))
    .map(item => toArticleRecord(item, keyword, {
      summary: null, score: 0, category: null, event: null,
      event_type: null, confidence: null, corroboration_count: 0, conflict_flag: false,
    }));

  return [...relevantRecords, ...irrelevantRecords];
}

async function persist(records) {
  await saveArticles(records);
}

// ============================================================================
// processKeyword：编排 5 阶段
// ============================================================================

async function processKeyword(keyword, seen) {
  const newItems = await fetchCandidates(keyword, seen);
  if (newItems === null) return [];
  if (newItems.length === 0) return [];

  const toSaveRelevant = await analyzeAndCrosscheck(keyword, newItems);

  for (const it of newItems.slice(0, RESULT_LIMIT)) {
    seen.add(it.source, keyForUrl(it.url));
  }

  const deduped = await dedupeAgainstRecent(toSaveRelevant, keyword.id, 30);
  const records = assembleRecords(keyword, deduped, newItems);
  await persist(records);
  return deduped;
}

// ============================================================================
// run & entry point
// ============================================================================

async function run() {
  console.log('=== AI News Monitor ===');
  console.log(`时间: ${new Date().toLocaleString('zh-CN')}`);

  const keywords = await loadKeywords();
  if (keywords.length === 0) {
    console.log('keywords 表中没有启用的关键词，退出。');
    return;
  }
  console.log(`\n监控 ${keywords.length} 个关键词: ${keywords.map(k => k.name).join(', ')}`);

  const seen = await SeenStore.load({ filePath: SEEN_STORE_PATH, capacity: SEEN_RING_SIZE });
  const sections = [];
  for (const kw of keywords) {
    try {
      sections.push({ keyword: kw, results: await processKeyword(kw, seen) });
    } catch (err) {
      console.error(`\n[${kw.name}] 错误: ${err.message}`);
      sections.push({ keyword: kw, results: [] });
    }
  }
  await seen.save({ filePath: SEEN_STORE_PATH });

  const hasResults = sections.some(s => s.results.length > 0);
  if (!hasResults) {
    console.log('\n本次无相关新内容。');
  } else {
    const report = buildReport(sections);
    const reportsDir = path.join(__dirname, '../reports');
    if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });
    const date = new Date().toISOString().split('T')[0];
    const reportPath = path.join(reportsDir, `${date}.md`);
    fs.writeFileSync(reportPath, report, 'utf8');
    console.log(`\n报告已保存: ${reportPath}`);
  }

  const digest = await sendDailyDigest(sections);
  if (digest.sent) console.log(`\n摘要邮件已发送: ${digest.subject}`);
  else console.log(`\n摘要邮件未发送: ${digest.reason}`);
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

module.exports = { run, buildReport, getKeywordRoots, preFilter, processKeyword, toArticleRecord, applyTierFloor, applySeenRing, T0_FLOOR, T1_FLOOR };
