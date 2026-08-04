const https = require('https');

const ACCESS_TOKEN = 'sbp_1df8daface2dc09ad7b3eeab1d1828e82b72ba29';

function api(path) {
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.supabase.com',
      path,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
        'User-Agent': 'alice-migrate',
      },
    }, (res) => {
      let b = '';
      res.on('data', d => b += d);
      res.on('end', () => resolve({ status: res.statusCode, body: b.substring(0, 500) }));
    });
    req.on('error', e => resolve({ status: 0, body: e.message }));
    req.end();
  });
}

(async () => {
  // List all projects - if this works, token is valid
  const r = await api('/v1/projects');
  console.log('GET /v1/projects:', r.status);
  console.log(r.body);
})();
