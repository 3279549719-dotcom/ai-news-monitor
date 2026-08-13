require('dotenv').config();
const axios = require('axios');

const urls = [
  { url: 'https://www.manutd.com/en/news', name: 'Man Utd Official' },
  { url: 'https://www.skysports.com/manchester-united', name: 'Sky Sports' },
  { url: 'https://www.espn.com/soccer/team/_/id/360/manchester-united', name: 'ESPN' },
  { url: 'https://www.goal.com/en/manchester-united/1q0epepqgsjjb9ta0gj4ewfb2x', name: 'Goal.com' },
  { url: 'https://www.transfermarkt.com/manchester-united/startseite/verein/985', name: 'Transfermarkt' },
  { url: 'https://www.90min.com/teams/manchester-united', name: '90min' },
];

async function test(url, name) {
  try {
    const res = await axios.get(url, {
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      maxRedirects: 5
    });
    console.log(`✅ [${name}] HTTP ${res.status}, ${res.data.length} bytes`);
    const snips = (res.data.match(/Manchester|United|Ten Hag|transfer|fixture/gi) || []).length;
    console.log(`  MU-related words: ${snips}`);
  } catch (err) {
    console.log(`❌ [${name}] ${err.message}`);
  }
}

const argv = process.argv.slice(2);
// 命名参数：--url <url>、--source <source_name>（另兼容 --source-name / --source_name 别名）
function argVal(flag) {
  const i = argv.indexOf(flag);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
}

async function main() {
  const url = argVal('--url');
  const name = argVal('--source') || argVal('--source-name') || argVal('--source_name');
  const targets = url ? [{ url, name: name || 'custom' }] : urls;
  for (const {url: u, name: n} of targets) {
    await test(u, n);
  }
}
main();
