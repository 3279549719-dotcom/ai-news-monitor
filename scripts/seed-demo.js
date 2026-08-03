require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// 演示数据：给空板块补几条（仅用于前端效果验证，真实运行由 AI 分类产生）
const demo = [
  {
    keyword_id: 'manchester-united', title: '曼联接近与乌加特达成个人条款', url: 'https://example.com/demo/transfer-ugarte',
    source: 'sky-sports', snippet: '', summary: '天空体育获悉，曼联已就乌加特转会与巴黎圣日耳曼展开新一轮谈判，个人条款接近达成。',
    score: 88, published_at: new Date().toISOString(), source_tier: 2,
    category: 'transfer', event: '曼联引进乌加特', confidence: 'high', corroboration_count: 2, conflict_flag: false,
  },
  {
    keyword_id: 'manchester-united', title: '曼联加速引进乌加特谈判', url: 'https://example.com/demo/transfer-ugarte2',
    source: 'espn', snippet: '', summary: 'ESPN 报道，曼联视乌加特为中场补强首选，谈判已进入实质阶段。',
    score: 85, published_at: new Date().toISOString(), source_tier: 2,
    category: 'transfer', event: '曼联引进乌加特', confidence: 'high', corroboration_count: 2, conflict_flag: false,
  },
  {
    keyword_id: 'manchester-united', title: '马奎尔肌肉拉伤将缺席两周', url: 'https://example.com/demo/injury-maguire',
    source: 'man-utd-official', snippet: '', summary: '俱乐部医疗组确认，马奎尔在训练中左腿腘绳肌拉伤，预计缺席两周，目标英超揭幕战前复出。',
    score: 90, published_at: new Date().toISOString(), source_tier: 0,
    category: 'injury', event: '马奎尔受伤', confidence: 'high', corroboration_count: 1, conflict_flag: false,
  },
  {
    keyword_id: 'manchester-united', title: '拉特克利夫：青训设施升级优先', url: 'https://example.com/demo/mgmt-ratcliffe',
    source: 'sky-sports', snippet: '', summary: '英力士集团确认未来两个转会窗预算优先用于青训设施升级，与一线队补强保持平衡。',
    score: 82, published_at: new Date().toISOString(), source_tier: 2,
    category: 'management', event: '拉特克利夫青训投资', confidence: 'medium', corroboration_count: 1, conflict_flag: false,
  },
  {
    keyword_id: 'manchester-united', title: '滕哈格：新赛季延续4-2-3-1阵型', url: 'https://example.com/demo/mgmt-tenhag',
    source: 'espn', snippet: '', summary: '主帅在赛前发布会确认新赛季将延续 4-2-3-1 体系，边锋内收战术为夏训重点。',
    score: 80, published_at: new Date().toISOString(), source_tier: 2,
    category: 'management', event: '滕哈格战术安排', confidence: 'medium', corroboration_count: 1, conflict_flag: false,
  },
];

async function main() {
  const { error } = await s.from('articles').insert(demo);
  if (error) console.error('Insert error:', error.message);
  else console.log('✅ 插入 5 条演示数据');
}

main();
