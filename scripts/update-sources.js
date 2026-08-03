require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function main() {
  // 1. Delete existing MU sources
  await s.from('keyword_sources').delete().eq('keyword_id', 'manchester-united');
  console.log('Deleted existing MU sources');

  // 2. Insert 4 accessible sources
  const sources = [
    { keyword_id: 'manchester-united', rss_url: 'https://www.manutd.com/en/news', scrape_url: 'https://www.manutd.com/en/news', source_name: 'Man Utd Official', tier: 0, fetch_type: 'firecrawl', enabled: true },
    { keyword_id: 'manchester-united', rss_url: 'https://www.skysports.com/manchester-united', scrape_url: 'https://www.skysports.com/manchester-united', source_name: 'Sky Sports', tier: 2, fetch_type: 'firecrawl', enabled: true },
    { keyword_id: 'manchester-united', rss_url: 'https://www.espn.com/soccer/team/_/id/360/manchester-united', scrape_url: 'https://www.espn.com/soccer/team/_/id/360/manchester-united', source_name: 'ESPN', tier: 2, fetch_type: 'firecrawl', enabled: true },
    { keyword_id: 'manchester-united', rss_url: 'https://www.90min.com/teams/manchester-united', scrape_url: 'https://www.90min.com/teams/manchester-united', source_name: '90min', tier: 2, fetch_type: 'firecrawl', enabled: true },
  ];

  const { error } = await s.from('keyword_sources').insert(sources);
  if (error) console.error('Insert error:', error.message);
  else console.log('Inserted 4 MU sources');

  // 3. Verify
  const { data } = await s.from('keyword_sources').select('*').eq('keyword_id', 'manchester-united');
  data.forEach(r => console.log(`  ${r.source_name} (T${r.tier}) → ${r.scrape_url}`));
}

main();
