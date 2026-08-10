'use strict';
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');

const { RESULT_LIMIT, MIN_SCORE, SEEN_RING_SIZE, SEEN_STORE_PATH } = require('./config');
const { getKeywordRoots, preFilter } = require('./keyword-roots');
const { applyTierFloor } = require('./tiers');
const { keyForUrl, SeenStore } = require('./seen');
const { toArticleRecord } = require('./items');
const { loadKeywords } = require('./store');
const { buildReport } = require('./report');
const { sendDailyDigest } = require('./email');
const {
  fetchCandidates, analyzeAndCrosscheck, dedupeAgainstRecent,
  assembleRecords, persist, applySeenRing,
} = require('./pipeline-stages');

// 保持向后兼容：旧 tests/脚本可能依赖这些导出
const T0_FLOOR = require('./config').T0_FLOOR;
const T1_FLOOR = require('./config').T1_FLOOR;

// ============================================================================
// processKeyword：编排 5 阶段
// ============================================================================

async function processKeyword(keyword, seen) {
  const newItems = await fetchCandidates(keyword, seen);
  if (newItems === null) return [];
  if (newItems.length === 0) return [];

  const toSaveRelevant = await analyzeAndCrosscheck(keyword, newItems);

  for (const it of newItems.slice(0, RESULT_LIMIT)) {
    seen.add(it.source, keyForUrl(it.url));
  }

  const deduped = await dedupeAgainstRecent(toSaveRelevant, keyword.id, 30);
  const records = assembleRecords(keyword, deduped, newItems);
  await persist(records);
  return deduped;
}

// ============================================================================
// run & entry point
// ============================================================================

async function run() {
  console.log('=== AI News Monitor ===');
  console.log(`时间: ${new Date().toLocaleString('zh-CN')}`);

  const keywords = await loadKeywords();
  if (keywords.length === 0) {
    console.log('keywords 表中没有启用的关键词，退出。');
    return;
  }
  console.log(`\n监控 ${keywords.length} 个关键词: ${keywords.map(k => k.name).join(', ')}`);

  const seen = await SeenStore.load({ filePath: SEEN_STORE_PATH, capacity: SEEN_RING_SIZE });
  const sections = [];
  for (const kw of keywords) {
    try {
      sections.push({ keyword: kw, results: await processKeyword(kw, seen) });
    } catch (err) {
      console.error(`\n[${kw.name}] 错误: ${err.message}`);
      sections.push({ keyword: kw, results: [] });
    }
  }
  await seen.save({ filePath: SEEN_STORE_PATH });

  const hasResults = sections.some(s => s.results.length > 0);
  if (!hasResults) {
    console.log('\n本次无相关新内容。');
  } else {
    const report = buildReport(sections);
    const reportsDir = path.join(__dirname, '../reports');
    if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });
    const date = new Date().toISOString().split('T')[0];
    const reportPath = path.join(reportsDir, `${date}.md`);
    fs.writeFileSync(reportPath, report, 'utf8');
    console.log(`\n报告已保存: ${reportPath}`);
  }

  const digest = await sendDailyDigest(sections);
  if (digest.sent) console.log(`\n摘要邮件已发送: ${digest.subject}`);
  else console.log(`\n摘要邮件未发送: ${digest.reason}`);
}

if (require.main === module) {
  const cronSchedule = process.env.CRON_SCHEDULE;
  if (cronSchedule) {
    if (!cron.validate(cronSchedule)) {
      console.error(`CRON_SCHEDULE 格式无效: "${cronSchedule}"`);
      process.exit(1);
    }
    console.log(`定时任务已启动，计划: ${cronSchedule}`);
    run().catch(console.error);
    cron.schedule(cronSchedule, () => run().catch(console.error));
  } else {
    run().catch(err => {
      console.error('运行出错:', err.message);
      process.exit(1);
    });
  }
}

module.exports = {
  run, buildReport, getKeywordRoots, preFilter,
  processKeyword, toArticleRecord, applyTierFloor,
  applySeenRing, T0_FLOOR, T1_FLOOR,
};
