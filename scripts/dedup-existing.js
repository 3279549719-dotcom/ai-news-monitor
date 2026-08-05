require('dotenv').config();

/**
 * Phase9 存量同事件清理（scripts/dedup-existing.js）
 *
 * 对近 30 天 score≥60 的相关文章，按"双信号同事件"规则（dedupeBySimilarity）聚类，
 * 每簇保留最高分一篇（并列取先入库），其余删除。解决同一事件跨信源/跨运行各存各的
 * （如 Naji Marshall 续约 4 篇 → 1 篇）。
 *
 * 用法：
 *   node scripts/dedup-existing.js --dry-run        # 默认：预览保留/待删清单（不执行）
 *   node scripts/dedup-existing.js --apply          # 执行删除（先看 dry-run 确认）
 *   node scripts/dedup-existing.js --keyword dallas-mavericks --apply
 *
 * 复用：loadRecentRelevant(store) / collapseSameEvent(crosscheck)
 * 注意：删除不可逆，--apply 前务必核对 dry-run 清单。
 */

const { loadKeywords, loadRecentRelevant } = require('../src/store');
const { collapseSameEvent } = require('../src/crosscheck');
const { getClient } = require('../src/db');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const KEYWORD = flag('--keyword', '');
const DAYS = Number(flag('--days', '0')) || 30;
// 排除不删的 id（逗号分隔）：边缘误并但用户想保留的行
const KEEP_IDS = new Set((flag('--keep-ids', '') || '').split(',').map(s => s.trim()).filter(Boolean));

function flag(name, def) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : def;
}

async function main() {
  const keywords = (await loadKeywords()).filter(k => k.type === 'search');
  const targets = KEYWORD ? keywords.filter(k => k.id === KEYWORD) : keywords;
  if (targets.length === 0) {
    console.log(`没有匹配的关键词${KEYWORD ? `（--keyword ${KEYWORD}）` : ''}，退出。`);
    return;
  }

  let totalDropped = 0;
  for (const kw of targets) {
    const rows = await loadRecentRelevant(kw.id, DAYS); // {id, url, event, title, score, created_at}
    if (rows.length === 0) continue;

    const kept = collapseSameEvent(rows);
    const keptUrls = new Set(kept.map(r => r.url));
    const dropped = rows.filter(r => !keptUrls.has(r.url));

    if (dropped.length === 0) {
      console.log(`[${kw.name}] 无重复（${rows.length} 篇）`);
      continue;
    }

    console.log(`\n[${kw.name}] ${rows.length} 篇 → 保留 ${kept.length}，待删 ${dropped.length}`);
    for (const k of kept) console.log(`  保留: [${k.score}] ${k.title.slice(0, 62)}`);
    console.log('  待删:');
    for (const d of dropped) console.log(`    - [${d.score}] ${d.title.slice(0, 72)}  (${d.id})`);
    totalDropped += dropped.length;

    if (APPLY) {
      const ids = dropped.map(d => d.id).filter(id => !KEEP_IDS.has(id));
      if (ids.length === 0) continue;
      const { error } = await getClient().from('articles').delete().in('id', ids);
      if (error) throw new Error(`delete: ${error.message}`);
      console.log(`  [--apply] 已删除 ${ids.length} 行`);
    }
  }

  console.log(`\n合计待删 ${totalDropped} 行${APPLY ? '（已执行）' : '（dry-run 预览，加 --apply 才删除）'}`);
}

main().catch(err => {
  console.error('运行出错:', err.message);
  process.exit(1);
});
