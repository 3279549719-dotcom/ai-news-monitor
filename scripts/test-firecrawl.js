// Run from ai-news-monitor project dir so axios is available
require('dotenv').config({ path: '../../.env' });
const apiKey = process.env.FIRECRAWL_API_KEY;
console.log('Key found:', !!apiKey);
console.log('Key prefix:', apiKey?.substring(0, 5));

const axios = require('axios');
async function test() {
  try {
    const { status } = await axios.post(
      'https://api.firecrawl.dev/v1/scrape',
      {
        url: 'https://example.com',
        formats: ['markdown'],
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );
    console.log('HTTP Status:', status);
    console.log('✅ Firecrawl API Key 有效！');
  } catch (err) {
    if (err.response) {
      console.log('HTTP', err.response.status, ':', JSON.stringify(err.response.data).substring(0, 300));
    } else {
      console.log('Error:', err.message);
    }
  }
}
test();
