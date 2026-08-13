require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// 为已有 MU 文章补充 category/confidence（模拟 AI 分类效果，仅用于前端展示验证）
const updates = [
  { match: 'Marc Skinner', category: 'official', confidence: 'high', conflict: false, corr: 1 },
  { match: 'Mbeumo brace', category: 'match', confidence: 'high', conflict: false, corr: 2 },
  { match: 'Atlético Madrid: Mbeumo', category: 'match', confidence: 'high', conflict: false, corr: 2 },
  { match: 'TV channel', category: 'match', confidence: 'medium', conflict: false, corr: 1 },
];

async function main() {
  const { data } = await s.from('articles').select('id,title').eq('keyword_id', 'manchester-united');
  let updated = 0;
  for (const u of updates) {
    const target = data.find(a => a.title.includes(u.match));
    if (!target) continue;
    const { error } = await s.from('articles')
      .update({
        category: u.category,
        confidence: u.confidence,
        corroboration_count: u.corr,
        conflict_flag: u.conflict,
      })
      .eq('id', target.id);
    if (!error) { console.log('✅', target.title.slice(0, 40)); updated++; }
  }
  console.log(`\nUpdated ${updated} articles`);
}

main();
