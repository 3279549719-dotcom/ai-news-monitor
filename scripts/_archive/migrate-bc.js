require('dotenv').config();
const https = require('https');

const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const REF = process.env.SUPABASE_URL.replace('https://', '').replace('.supabase.co', '');

const SQL = `
ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS event TEXT,
  ADD COLUMN IF NOT EXISTS confidence TEXT CHECK (confidence IN ('high','medium','low')),
  ADD COLUMN IF NOT EXISTS corroboration_count INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS conflict_flag BOOLEAN DEFAULT false;

ALTER TABLE keywords
  ADD COLUMN IF NOT EXISTS category_schema JSONB;

UPDATE keywords SET category_schema = '{
  "official": "官方公告",
  "transfer": "转会&合同动态",
  "injury": "伤病&停赛",
  "management": "管理层·教练组·更衣室",
  "match": "赛事竞技资讯",
  "rumour": "未证实传闻",
  "conflict": "冲突与辟谣",
  "academy_women": "青训&女足"
}' WHERE id = 'manchester-united';

UPDATE keywords SET category_schema = '{
  "official": "官方公告",
  "product": "产品发布",
  "research": "研究进展",
  "other": "其他"
}' WHERE id IN ('anthropic', 'dallas-mavericks', 'claude-blog');
`;

function api(path, method = 'GET', body = null) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'api.supabase.com',
      path,
      method,
      headers: {
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
        'User-Agent': 'alice-migrate',
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    }, (res) => {
      let b = '';
      res.on('data', d => b += d);
      res.on('end', () => resolve({ status: res.statusCode, body: b.substring(0, 600) }));
    });
    req.on('error', e => resolve({ status: 0, body: e.message }));
    if (data) req.write(data);
    req.end();
  });
}

(async () => {
  // 1. Verify token with GET /v1/projects
  const check = await api('/v1/projects');
  console.log('Token check → GET /v1/projects:', check.status);
  if (check.status !== 200) {
    console.log('  Response:', check.body);
    console.log('\n❌ Token 无效。请确认：');
    console.log('  1. Token 是否从 https://supabase.com/dashboard/account/tokens 生成');
    console.log('  2. Token 是否完整复制（sbp_ 开头 + 40位）');
    console.log('  3. 生成后是否需要在邮件中确认激活');
    return;
  }
  console.log('✅ Token valid! Projects:', check.body.substring(0, 200));

  // 2. Execute SQL
  console.log('\nExecuting migration SQL...');
  const r = await api(`/v1/projects/${REF}/database/query`, 'POST', { query: SQL });
  console.log('Migration:', r.status, r.body.substring(0, 300));
})();
