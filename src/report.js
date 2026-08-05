'use strict';

/**
 * Daily report builder.
 *
 * Groups each keyword's results by its board schema (category_schema) and
 * renders a markdown report with confidence / corroboration-count / conflict
 * markers. Written to reports/YYYY-MM-DD.md by the pipeline.
 */

const { CONFIDENCE_LABEL } = require('./crosscheck');

/**
 * Build the daily markdown report from per-keyword result sections.
 * @param {Array<{keyword:Object, results:Array}>} sections - Per-keyword results.
 * @returns {string} Markdown report text.
 */
function buildReport(sections) {
  const date = new Date().toLocaleString('zh-CN');
  const total = sections.reduce((n, s) => n + s.results.length, 0);
  const lines = [
    '# AI信息监控日报',
    `> 生成时间: ${date}  |  相关新内容: ${total} 条`,
    '',
  ];
  for (const { keyword, results } of sections) {
    if (results.length === 0) continue;
    lines.push(`## ${keyword.name}`, '');

    // 按板块模板分组；无 category 的文章归「未分类」
    const schema = keyword.category_schema || {};
    const boards = Object.entries(schema).map(([key, label]) => ({ key, label, items: [] }));
    boards.push({ key: '__uncat', label: '未分类', items: [] });
    for (const item of results) {
      const board = boards.find(b => b.key === item.category) || boards[boards.length - 1];
      board.items.push(item);
    }

    for (const board of boards) {
      if (board.items.length === 0) continue;
      lines.push(`### ${board.label}（${board.items.length}）`, '');
      for (const item of board.items) {
        const meta = [`来源: ${item.source || keyword.type}`];
        if (item.tier != null) meta.push(`T${item.tier}`);
        meta.push(`相关度: ${item.score}`);
        if (item.confidence) meta.push(CONFIDENCE_LABEL[item.confidence] || item.confidence);
        if (item.corroboration_count > 1) meta.push(`${item.corroboration_count}源印证`);
        if (item.conflict_flag) meta.push('⚠️冲突');
        if (item.publishedAt) meta.push(`发布: ${new Date(item.publishedAt).toLocaleDateString()}`);
        lines.push(`- ${item.title}`, `  > ${item.url}`, `  > ${meta.join('  |  ')}`, '', item.summary || '', '');
      }
      lines.push('');
    }
    lines.push('---', '');
  }
  return lines.join('\n');
}

module.exports = { buildReport };
