'use strict';

const path = require('path');
const { spawnSync } = require('child_process');
const config = require('./config');
const { parseTwikitRows, handleFromProfileUrl } = require('./x-tweet-parse');
const crawl4aiFetch = require('./crawl4ai-fetch');

/**
 * X 账号抓取编排：twikit 主通道 → crawl4ai guest 兜底 → []。
 *
 * twikit 返回结构化行（text / 绝对时间戳 / 状态 ID），数据质量最好；失败
 * （会话过期/被封/依赖缺失/无凭证）时回退 crawl4ai 抓账号页 markdown。
 * X 源不降级 Direct。
 *
 * 内部调用都走 impl 对象，便于单测替换 runTwikit / crawl4aiFetch。
 */
const impl = {
  runTwikit(handles) {
    if (!handles || handles.length === 0) return [];
    const script = path.join(__dirname, '../scripts/x-fetch-tweets.py');
    const py = config.X_PYTHON || 'python';
    const res = spawnSync(py, [script, ...handles], {
      encoding: 'utf8',
      timeout: 60000,
    });
    if (res.error || res.status !== 0) return [];
    try {
      const rows = JSON.parse(res.stdout);
      return Array.isArray(rows) ? rows : [];
    } catch {
      return [];
    }
  },

  crawl4aiFetch,

  async fetchXSourceArticles(source) {
    if (config.X_TWIKIT_ENABLED) {
      const handle = handleFromProfileUrl(source.scrape_url);
      const rows = impl.runTwikit(handle ? [handle] : []);
      if (rows.length > 0) {
        const items = parseTwikitRows(source, rows);
        if (items.length > 0) {
          console.log(`  [Twikit] ${source.source_name}: ${items.length} 条`);
          return items;
        }
      }
      console.log(`  [Twikit] ${source.source_name} 无结果，回退 crawl4ai`);
    }
    try {
      const items = await impl.crawl4aiFetch.fetchSourceArticles(source);
      console.log(`  [Crawl4ai] ${source.source_name}: ${items.length} 条`);
      return items;
    } catch (err) {
      console.log(`  [X] ${source.source_name} crawl4ai 兜底失败: ${err.message}`);
      return [];
    }
  },
};

module.exports = impl;
