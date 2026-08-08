require('dotenv').config();
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');

const { fetchArticleList } = require('./scraper');
const { fetchArticleContent } = require('./reader');
const { summarizeArticle, analyzeResult } = require('./ai');
const crawl4ai = require('./crawl4ai-fetch');
const { searchAll } = require('./search');
const { loadKeywords, filterNewItems, saveArticles, loadKeywordSources, loadRecentRelevant } = require('./store');
const { crosscheck, collapseSameEvent, dedupeAgainstExisting, CONFIDENCE_LABEL } = require('./crosscheck');
const { getKeywordRoots } = require('./keyword-roots');
const { buildReport } = require('./report');
const { sendDailyDigest } = require('./email');
const { RESULT_LIMIT, MIN_SCORE } = require('./config');

// ---------------------------------------------------------------------------
// 前置过滤：标题不含关键词词根的直接跳过（省 DeepSeek 调用）
// ---------------------------------------------------------------------------

function preFilter(items, keywordName) {
  const roots = getKeywordRoots(keywordName);
  if (roots.length === 0) return items;
  const filtered = [];
  const skipped = [];
  for (const item of items) {
    // T0 官方信源内容天然相关，免词根预筛（词根是为省 DeepSeek 调用；官方源量小且相关，标题未必含词根）
    if (item.tier === 0) {
      filtered.push(item);
      continue;
    }
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

// T0 官方信源相关性放行线：官方站内容天然相关（claude.com/anthropic.com/manutd.com/nba.com 等），
// AI 评分被标题/正文噪声（"Read more" 标题、导航正文）带偏低于此线时抬到此线，保证官方内容必入库。
const T0_FLOOR = 85;

/**
 * 对 T0 官方信源应用相关性放行：score 取下限 T0_FLOOR。非 T0 源原样返回。
 * @param {number} score - AI 原始评分。
 * @param {number|null} tier - 信源可信度层级。
 * @returns {number} 放行后的评分。
 */
function applyTierFloor(score, tier) {
  return tier === 0 ? Math.max(score, T0_FLOOR) : score;
}

// ---------------------------------------------------------------------------
// Pipelines
// ---------------------------------------------------------------------------

// LEGACY: blog 类型走专用 scraper/reader 链路，未来计划迁移到 search 管线统一处理。
// 目前仅老博客关键词使用，新增关键词请使用 search 类型。
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
    analyze: (kw, item) => analyzeResult({ query: kw.query, title: item.title, snippet: item.snippet, tier: item.tier, categorySchema: kw.category_schema, body: item.body }),
  },
};

// 并发池：为每个 item 抓单篇正文并挂到 item.body（失败/undefined → null，单篇失败不影响整体）。
// 正文用于 AI 摘要的事实锚点；抓不到就回落标题-only。
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
      // 推文卡跳过正文抓取（正文即推文内容，且 X 页抓取昂贵 4-21s/篇）
      if (/(x\.com|twitter\.com)\/.+\/status\//.test(item.url || '')) {
        item.body = null;
        continue;
      }
      try {
        const body = await crawl4ai.fetchArticleBody(item.url);
        item.body = typeof body === 'string' && body.trim() ? body : null;
      } catch (err) {
        item.body = null;
      }
    }
  });
  await Promise.allSettled(workers);
}

async function analyzeItems(keyword, items, limit = RESULT_LIMIT) {
  const { analyze } = PIPELINES[keyword.type];
  const toProcess = items.slice(0, limit);

  // 正文喂养：仅 search 类型，并发池 3 抓正文（失败回落标题-only）
  if (keyword.type === 'search') {
    await feedArticleBodies(toProcess, 3);
  }

  const settled = await Promise.allSettled(toProcess.map(item => analyze(keyword, item)));

  return toProcess.reduce((acc, item, i) => {
    const r = settled[i];
    if (r.status === 'rejected') {
      console.error(`  分析失败 (${item.title.slice(0, 30)}): ${r.reason?.message}`);
      return acc;
    }
    const { score, summary, event, event_type, category } = r.value;
    // T0 官方源抬到放行线；非 T0 维持 AI 原分
    const finalScore = applyTierFloor(score, item.tier);
    return finalScore >= MIN_SCORE ? [...acc, { ...item, score: finalScore, summary, event, event_type, category }] : acc;
  }, []);
}

// ---------------------------------------------------------------------------
// processKeyword 拆分的命名阶段函数
// ---------------------------------------------------------------------------

/**
 * 阶段 1：抓取候选文章
 * 调用 pipeline.fetch 获取原始列表，经 filterNewItems 过滤已入库 URL。
 */
async function fetchCandidates(keyword) {
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

  const newItems = await filterNewItems(allItems, keyword.id);
  console.log(`  未处理: ${newItems.length}`);

  return newItems;
}

/**
 * 阶段 2：分析 + 交叉验证
 * preFilter → analyzeItems → crosscheck → collapseSameEvent
 */
async function analyzeAndCrosscheck(keyword, newItems) {
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

  // Phase9 同批合并：按双信号同事件聚类，每簇保留最高分代表行。
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
 * 阶段 3：跨运行去重
 * 代表行 event 与近 30 天已存相关事件双信号比对，命中跳过。
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
 * 模块级纯函数：构造入库记录
 * @param {Object} item    - 文章对象（title, url, source, snippet, publishedAt, tier）
 * @param {Object} keyword - 关键词对象（id, type, category_schema）
 * @param {Object} overrides - 额外字段（summary, score, category, event, ...）
 */
function toArticleRecord(item, keyword, overrides = {}) {
  const schemaKeys = keyword.category_schema && !Array.isArray(keyword.category_schema)
    ? Object.keys(keyword.category_schema)
    : [];

  return {
    keyword_id: keyword.id,
    title: item.title,
    url: item.url,
    source: item.source || keyword.type,
    snippet: item.snippet || null,
    published_at: item.publishedAt ? new Date(item.publishedAt).toISOString() : null,
    source_tier: item.tier ?? null,
    ...overrides,
    // category 越界清洗：AI 返回的分类不在关键词 schema 键内 → 置 null
    category: overrides.category && schemaKeys.includes(overrides.category) ? overrides.category : null,
  };
}

/**
 * 阶段 4：构造入库记录
 * 相关行入库；无关行（含被去重吞掉的重复行）score=0 标记已见。
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
      summary: null,
      score: 0,
      category: null,
      event: null,
      event_type: null,
      confidence: null,
      corroboration_count: 0,
      conflict_flag: false,
    }));

  return [...relevantRecords, ...irrelevantRecords];
}

/**
 * 阶段 5：持久化入库
 */
async function persist(records) {
  await saveArticles(records);
}

// ---------------------------------------------------------------------------
// processKeyword：编排各阶段
// ---------------------------------------------------------------------------

async function processKeyword(keyword) {
  // 阶段 1：抓取候选
  const newItems = await fetchCandidates(keyword);
  if (newItems === null) return [];   // 未知类型
  if (newItems.length === 0) return [];

  // 阶段 2：分析 + 交叉验证
  const toSaveRelevant = await analyzeAndCrosscheck(keyword, newItems);

  // 阶段 3：跨运行去重
  const deduped = await dedupeAgainstRecent(toSaveRelevant, keyword.id, 30);

  // 阶段 4：构造记录
  const records = assembleRecords(keyword, deduped, newItems);

  // 阶段 5：持久化
  await persist(records);

  return deduped;
}

// ---------------------------------------------------------------------------
// run & entry point
// ---------------------------------------------------------------------------

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
  } else {
    const report = buildReport(sections);
    const reportsDir = path.join(__dirname, '../reports');
    if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });
    const date = new Date().toISOString().split('T')[0];
    const reportPath = path.join(reportsDir, `${date}.md`);
    fs.writeFileSync(reportPath, report, 'utf8');
    console.log(`\n报告已保存: ${reportPath}`);
  }

  // 每日摘要邮件：无条件发送（空结果走 buildDigestText 的"今日无新增"文案）。
  // 发送失败在 sendDailyDigest 内部被吞掉，绝不影响管线退出码。
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

module.exports = { run, buildReport, getKeywordRoots, preFilter, processKeyword, toArticleRecord, applyTierFloor, T0_FLOOR };
