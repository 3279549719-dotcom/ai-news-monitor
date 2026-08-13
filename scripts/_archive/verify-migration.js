require('dotenv').config();
const https = require('https');

const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const REF = process.env.SUPABASE_URL.replace('https://', '').replace('.supabase.co', '');

const SQL = `
SELECT column_name FROM information_schema.columns
WHERE table_name = 'articles'
AND column_name IN ('category','event','confidence','corroboration_count','conflict_flag')
ORDER BY column_name;

SELECT id, category_schema FROM keywords ORDER BY id;
`;

function api(path, method = 'POST', body = null) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'api.supabase.com',
      path,
      method,
      headers: {
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
        'User-Agent': 'alice-verify',
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    }, (res) => {
      let b = '';
      res.on('data', d => b += d);
      res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    req.on('error', e => resolve({ status: 0, body: e.message }));
    if (data) req.write(data);
    req.end();
  });
}

(async () => {
  const r = await api(`/v1/projects/${REF}/database/query`, 'POST', { query: SQL });
  console.log('Status:', r.status);
  if (r.status === 200) {
    const rows = JSON.parse(r.body);
    console.log('\n=== articles 新列 ===');
    rows.filter(r => r.column_name).forEach(r => console.log(' ', r.column_name));
    console.log('\n=== keywords category_schema ===');
    rows.filter(r => r.id).forEach(r => console.log(' ', r.id, '→', Object.keys(r.category_schema || {}).join(', ')));
  } else {
    console.log(r.body.substring(0, 300));
  }
})();
