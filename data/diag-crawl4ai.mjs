import axios from 'axios';

const TOKEN = '056354c4a52f15411599e16d304d1f30cd6103feb3cb176d';
const URL = 'https://www.anthropic.com/research';

(async () => {
  const res = await axios.post('http://localhost:11235/crawl', {
    urls: [URL],
    max_pages_to_crawl: 1,
  }, {
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    timeout: 30000,
  });
  
  const data = res.data;
  console.log('Top-level keys:', Object.keys(data));
  console.log('success:', data.success);
  
  if (data.results) {
    console.log('results type:', Array.isArray(data.results) ? `array[${data.results.length}]` : typeof data.results);
    for (let i = 0; i < data.results.length; i++) {
      const r = data.results[i];
      console.log(`\nResult[${i}] keys:`, Object.keys(r));
      console.log(`Result[${i}] url:`, r.url);
      console.log(`Result[${i}] success:`, r.success);
      if (r.markdown !== undefined && r.markdown !== null) {
        const mdType = typeof r.markdown;
        console.log(`Result[${i}] markdown type:`, mdType);
        if (mdType === 'string') {
          console.log(`Result[${i}] markdown length:`, r.markdown.length);
          console.log(`Result[${i}] markdown preview:`, r.markdown.slice(0, 500));
        } else if (mdType === 'object') {
          console.log(`Result[${i}] markdown is object:`, JSON.stringify(r.markdown).slice(0, 500));
        } else {
          console.log(`Result[${i}] markdown value:`, r.markdown);
        }
      } else {
        console.log(`Result[${i}] markdown: ${r.markdown}`);
      }
      if (r.error) {
        console.log(`Result[${i}] error:`, r.error);
      }
      // Print all non-markdown fields compactly
      const shallow = {};
      for (const k of Object.keys(r)) {
        if (k === 'markdown' || k === 'html' || k === 'cleaned_html') {
          shallow[k] = `[${typeof r[k]} length=${r[k]?.length || 0}]`;
        } else {
          shallow[k] = r[k];
        }
      }
      console.log(`Result[${i}] shallow:`, JSON.stringify(shallow, null, 2).slice(0, 2000));
    }
  }

  console.log('\nserver_processing_time_s:', data.server_processing_time_s);
  console.log('server_memory_delta_mb:', data.server_memory_delta_mb);
})();
