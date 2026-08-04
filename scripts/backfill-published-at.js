'use strict';

// Phase8 S2c 一次性回填脚本：
//   1) 全表 articles 按 URL 日期模式回填 published_at；URL 无日期 → 置 NULL（created_at 保留发现时间）。
//   2) 顺带输出导航垃圾行的 DELETE SQL（不执行，避免误删；只执行 UPDATE 回填）。
// 幂等：重复运行只覆盖同样结果。
//
// 用法：node scripts/backfill-published-at.js

require('dotenv').config();
const { getClient } = require('../src/db');
const { extractPublishDateFromUrl } = require('../src/dates');

const BATCH = 1000;

// 导航垃圾标题正则（对应 S2c 的 DELETE SQL）
const SPAM_TITLE_RE = /^(Schedule|Stats|Roster|Injuries|Odds|News|San Antonio Spurs|Chicago Bulls)$/;
const DELETE_SQL = `DELETE FROM articles WHERE score = 0 AND title ~ '^(Schedule|Stats|Roster|Injuries|Odds|News|San Antonio Spurs|Chicago Bulls)$';`;

async function main() {
  const client = getClient();
  let updated = 0; // 回填了真实日期
  let nulled = 0;   // URL 无日期 → 置 NULL
  let deleted = 0;  // 命中导航垃圾条件（仅计数，不删除）

  for (let from = 0; ; from += BATCH) {
    const { data, error } = await client
      .from('articles')
      .select('id, url, score, title')
      .order('id', { ascending: true })
      .range(from, from + BATCH - 1);
    if (error) throw new Error(`拉取 articles 失败: ${error.message}`);
    if (!data || data.length === 0) break;

    for (const row of data) {
      const d = extractPublishDateFromUrl(row.url);
      const publishedAt = d ? d.toISOString() : null;
      const { error: upErr } = await client
        .from('articles')
        .update({ published_at: publishedAt })
        .eq('id', row.id);
      if (upErr) throw new Error(`回填 id=${row.id} 失败: ${upErr.message}`);

      if (publishedAt) updated++;
      else nulled++;

      if (row.score === 0 && SPAM_TITLE_RE.test((row.title || '').trim())) deleted++;
    }

    console.log(`  已处理 ${from + data.length} 行（回填 ${updated}，置空 ${nulled}）`);
    if (data.length < BATCH) break;
  }

  console.log('\n=== 回填完成 ===');
  console.log(`  published_at 回填: ${updated} 行`);
  console.log(`  published_at 置空: ${nulled} 行`);
  console.log(`  导航垃圾行（score=0 且标题命中正则）: ${deleted} 行（未删除）`);
  console.log('\n如需清理导航垃圾行，请手动执行以下 SQL：');
  console.log(DELETE_SQL);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
