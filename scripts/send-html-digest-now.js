// 一次性脚本：从 Supabase 拉最近 N 天的真实相关文章（score>=60），
// 复用 sendDailyDigest 发一封 HTML 版摘要邮件到 RECEIVER_EMAIL。
// 用法：node scripts/send-html-digest-now.js [days=1]
'use strict';
process.chdir(require('path').join(__dirname, '..')); // .env 相对 cwd 加载
require('dotenv').config();
const { getClient } = require('../src/db');
const { loadKeywords } = require('../src/store');
const { sendDailyDigest } = require('../src/email');

async function main() {
  const days = Number(process.argv[2] || 1);
  const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
  const keywords = await loadKeywords();

  const { data, error } = await getClient()
    .from('articles')
    .select('keyword_id, title, url, score, source_tier, category, event, event_type, summary, confidence, corroboration_count, conflict_flag, created_at')
    .gte('created_at', cutoff)
    .gte('score', 60)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`查询文章失败: ${error.message}`);
  const rows = data || [];

  const sections = keywords.map(kw => ({
    keyword: kw, // 完整行：含 name + category_schema（板块分组依赖它）
    results: rows.filter(r => r.keyword_id === kw.id)
      .map(r => ({ title: r.title, url: r.url, score: r.score, tier: r.source_tier, category: r.category, event: r.event, event_type: r.event_type, summary: r.summary, confidence: r.confidence, corroboration_count: r.corroboration_count, conflict_flag: r.conflict_flag })),
  }));

  const total = sections.reduce((n, s) => n + s.results.length, 0);
  console.log(`近 ${days} 天相关文章 ${total} 条，发送 HTML 摘要邮件…`);
  const digest = await sendDailyDigest(sections);
  if (digest.sent) console.log(`已发送: ${digest.subject}`);
  else { console.error(`未发送: ${digest.reason}`); process.exit(1); }
}

main().catch(err => { console.error(err.message); process.exit(1); });
