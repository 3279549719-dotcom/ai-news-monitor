'use strict';

/**
 * Pipeline stage functions.
 *
 * Extracted from index.js to keep the main entry point lean (~130 lines).
 * Each stage function is independently testable and has a single responsibility.
 *
 * Stages: fetchCandidates → analyzeAndCrosscheck → dedupeAgainstRecent
 *         → assembleRecords → persist
 */

const crawl4ai = require('./crawl4ai-fetch');
const { searchAll } = require('./search');
const { loadKeywordSources, filterNewItems, saveArticles, loadRecentRelevant } = require('./store');
const { crosscheck, collapseSameEvent, dedupeAgainstExisting } = require('./crosscheck');
const { getKeywordRoots, preFilter } = require('./keyword-roots');
const { applyTierFloor } = require('./tiers');
const { keyForUrl } = require('./seen');
const { toArticleRecord } = require('./items');
const { RESULT_LIMIT, MIN_SCORE } = require('./config');

// --- legacy blog pipeline imports (lazy, only used when type=blog) ---
const { fetchArticleList } = require('./legacy/scraper');
const { fetchArticleContent } = require('./legacy/reader');
const { summarizeArticle, analyzeResultSmart } = require('./ai');

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
    analyze: (kw, item) => analyzeResultSmart({
      query: kw.query, title: item.title, snippet: item.snippet,
      tier: item.tier, categorySchema: kw.category_schema, body: item.body,
    }),
  },
};

// ============================================================================
// 正文喂养 + 分析
// ============================================================================

/**
 * 并发池：为每个 item 抓单篇正文（失败/undefined → null，单篇失败不影响整体）。
 */
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

/**
 * 分析 items：调用 pipeline analyze → 应用 tier floor → 过滤低于 MIN_SCORE 的。
 */
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

/**
 * 剔除 seen ring 内近期已分析过的 URL。
 */
function applySeenRing(items, seen) {
  if (!items || items.length === 0) return items;
  return items.filter(i => !seen.has(i.source, keyForUrl(i.url)));
}

// ============================================================================
// Pipeline 阶段函数
// ============================================================================

/**
 * 阶段 1：抓取候选文章。
 */
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

/**
 * 阶段 2：分析 + 交叉验证。
 */
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

/**
 * 阶段 3：跨运行去重。
 */
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

/**
 * 阶段 4：构造入库记录。相关行入库，无关行 score=0 标记已见。
 */
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

/**
 * 阶段 5：持久化入库。
 */
async function persist(records) {
  await saveArticles(records);
}

module.exports = {
  PIPELINES,
  feedArticleBodies,
  analyzeItems,
  applySeenRing,
  fetchCandidates,
  analyzeAndCrosscheck,
  dedupeAgainstRecent,
  assembleRecords,
  persist,
};
