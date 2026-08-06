require('dotenv').config();

/**
 * Phase9 历史数据回填重算（scripts/backfill-resummarize.js）
 *
 * 对存量相关文章用 Phase8 正文喂养管线重算摘要/event/event_type/category/score。
 * 背景：旧管线只喂标题，摘要可望文生义（如把主帅 Carrick 写成踢中卫）、event_type 全空；
 * 重跑管线无效（filterNewItems 按 (keyword_id,url) 去重）。只能显式重算。
 *
 * 用法：
 *   node scripts/backfill-resummarize.js --dry-run            # 预览
 *   node scripts/backfill-resummarize.js                       # 全量 score≥60 重算
 *   node scripts/backfill-resummarize.js --lt60                # 修复模式：只处理当前 score<60（含被上次并发过载误判压垮的行）
 *   node scripts/backfill-resummarize.js --keyword dallas-mavericks --limit 20
 *   node scripts/backfill-resummarize.js --pool 2              # 并发（默认 1；crawl4ai 容器并发过载会大面积正文缺失）
 *
 * 关键约束：
 * - 并发必须低：crawl4ai 容器在持续并发下渐进性资源耗尽，导致正文抓取大面积失败（pool3 实测 66% 缺失）。
 *   pool 1 串行 + 重试是最稳路径。容器空闲时单篇抓取 4-21s。
 * - 正文缺失时 v2 标题-only 判分不可靠（会把 slug 标题误判 score 0），故正文缺失的分数下限 60，
 *   保住已入库文章的可见性（修复模式不恶化）。
 *
 * 复用：loadKeywords(store) / analyzeResult(ai) / fetchArticleBody(crawl4ai-fetch) / getClient(db)
 * 依赖：crawl4ai 容器在线（docker start crawl4ai）；DeepSeek API 可用。
 */

const { loadKeywords } = require('../src/store');
const { analyzeResult } = require('../src/ai');
const crawl4ai = require('../src/crawl4ai-fetch');
const { getClient } = require('../src/db');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const KEYWORD = flag('--keyword', '');
const LIMIT = Number(flag('--limit', '0')) || 0; // 0 = 不限
const DAYS = Number(flag('--days', '0')) || 0; // 0 = 不限
const LT60 = args.includes('--lt60'); // 修复模式：只处理当前 score<60 的行

function flag(name, def) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : def;
}

const POOL = Number(flag('--pool', '2')) || 1; // 默认 2（正文失败主因是 google-news 死链，非并发；pool 2 + 重试足够）
const BATCH = 50; // UPDATE 分批大小

async function loadRows(keywordId, days) {
  let q = getClient()
    .from('articles')
    .select('id, title, url, snippet, source_tier, score, keyword_id')
    .order('created_at', { ascending: false });
  if (LT60) {
    q = q.lt('score', 60);
    // 修复模式排除 google-news 旧聚合链接（news.google.com/rss/articles/... 是重定向，
    // 正文永远抓不到；该源是白名单改造前遗留，已整体清零隐藏，不应重判）
    q = q.neq('source', 'google-news');
  } else q = q.gte('score', 60);
  if (keywordId) q = q.eq('keyword_id', keywordId);
  if (days > 0) q = q.gte('created_at', new Date(Date.now() - days * 86400000).toISOString());
  if (LIMIT > 0) q = q.limit(LIMIT);
  const { data, error } = await q;
  if (error) throw new Error(`loadRows: ${error.message}`);
  return data || [];
}

// 正文抓取 + 重试：容器偶发失败（并发/超时），重试一次可显著提高成功率
async function fetchBodyWithRetry(url, retries = 1) {
  for (let i = 0; i <= retries; i++) {
    try {
      const body = await crawl4ai.fetchArticleBody(url);
      if (body) return body;
    } catch {}
    if (i < retries) await new Promise(r => setTimeout(r, 3000));
  }
  return null;
}

// 单篇重算：抓正文（失败回落 null）→ analyzeResult 单轮重算。
// 正文缺失时 score 取 max(当前, 模型)：不盲目抬到 60（避免复活垃圾），也不恶化已入库行。
async function reprocess(row, keyword) {
  const body = await fetchBodyWithRetry(row.url);
  const r = await analyzeResult({
    query: keyword.query,
    title: row.title,
    snippet: row.snippet || null,
    tier: row.source_tier ?? null,
    categorySchema: keyword.category_schema,
    body,
  });
  const score = body ? r.score : Math.max(row.score || 0, r.score);
  return {
    id: row.id,
    body,
    score,
    relevant: score >= 60,
    summary: r.summary,
    event: r.event,
    event_type: r.event_type,
    category: r.category,
  };
}

// 逐行 UPDATE（不碰其他列；upsert 需补齐 keyword_id/title/url/source 等 NOT NULL 列，容易踩约束）
async function updateBatch(records) {
  const results = await Promise.all(records.map(r =>
    getClient().from('articles').update({
      summary: r.summary,
      score: r.score,
      event: r.event,
      event_type: r.event_type,
      category: r.category,
    }).eq('id', r.id)
  ));
  const err = results.find(x => x.error);
  if (err) throw new Error(`updateBatch: ${err.message}`);
}

async function main() {
  const keywords = (await loadKeywords()).filter(k => k.type === 'search');
  const targets = KEYWORD ? keywords.filter(k => k.id === KEYWORD) : keywords;
  if (targets.length === 0) {
    console.log(`没有匹配的关键词${KEYWORD ? `（--keyword ${KEYWORD}）` : ''}，退出。`);
    return;
  }

  let total = 0;
  const plans = [];
  for (const kw of targets) {
    const rows = await loadRows(kw.id, DAYS);
    plans.push({ kw, rows });
    total += rows.length;
  }

  if (DRY_RUN) {
    console.log(`[Dry-run] 将重算 ${total} 篇（${LT60 ? 'score<60 修复模式' : 'score≥60'}${DAYS ? `，近 ${DAYS} 天` : ''}${KEYWORD ? `，keyword=${KEYWORD}` : ''}）`);
    for (const { kw, rows } of plans) {
      console.log(`  ${kw.name} (${kw.id}): ${rows.length} 篇`);
      for (const r of rows.slice(0, 3)) console.log(`    - [${r.score}] ${r.title.slice(0, 60)}`);
      if (rows.length > 3) console.log(`    ... 共 ${rows.length} 篇`);
    }
    const minMin = Math.ceil((total * 8) / POOL / 60);
    const maxMin = Math.ceil((total * 12) / POOL / 60);
    console.log(`\n预计耗时：${minMin}~${maxMin} 分钟（并发池 ${POOL}，含正文抓取+AI+重试）`);
    console.log('确认后去掉 --dry-run 执行；--keyword/--limit/--days/--pool 可调。');
    return;
  }

  console.log(`开始回填重算 ${total} 篇（${LT60 ? '修复模式' : '全量'}，并发池 ${POOL}）...`);
  let done = 0, bodyNull = 0, below60 = 0, fail = 0;

  for (const { kw, rows } of plans) {
    console.log(`\n[${kw.name}] ${rows.length} 篇`);
    const kwUpdates = [];
    let idx = 0;
    const workers = Array.from({ length: Math.min(POOL, rows.length) }, async () => {
      while (idx < rows.length) {
        const row = rows[idx++];
        try {
          const r = await reprocess(row, kw);
          if (r.body === null) bodyNull++;
          if (r.score < 60) below60++; // 修复模式 = 仍隐藏；全量模式 = 跌出60
          kwUpdates.push({
            id: r.id,
            summary: r.relevant ? (r.summary || null) : null,
            score: r.score,
            event: r.relevant ? r.event || null : null,
            event_type: r.relevant ? r.event_type || null : null,
            category: r.relevant ? r.category || null : null,
          });
          done++;
          if (done % 25 === 0 || done === total) {
            console.log(`  进度 ${done}/${total}（正文缺失 ${bodyNull}，score<60 ${below60}）`);
          }
        } catch (err) {
          fail++;
          console.error(`  失败 (${row.title.slice(0, 30)}): ${err.message}`);
        }
      }
    });
    await Promise.allSettled(workers);

    for (let i = 0; i < kwUpdates.length; i += BATCH) {
      const batch = kwUpdates.slice(i, i + BATCH);
      try {
        await updateBatch(batch);
      } catch (err) {
        console.error(`  写库失败: ${err.message}`);
        fail += batch.length;
      }
    }
    console.log(`  [${kw.name}] 已完成，写库 ${kwUpdates.length} 条`);
  }

  console.log(`\n回填完成：处理 ${done} 成功 / ${fail} 失败 ｜ 正文缺失 ${bodyNull}（score 下限 60 保可见）｜ score<60 ${below60} 条${LT60 ? '（仍隐藏）' : '（重算跌出60）'}`);
  if (LT60) console.log(`已恢复可见：${total - below60} 条`);
  console.log('建议下一步：node scripts/dedup-existing.js --dry-run 查看存量重复，确认后 --apply 清理。');
}

main().catch(err => {
  console.error('运行出错:', err.message);
  process.exit(1);
});
