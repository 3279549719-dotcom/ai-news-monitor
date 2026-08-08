'use strict';

/**
 * Daily digest email module.
 *
 * Builds a plain-text concise digest (grouped by keyword) from the pipeline's
 * per-keyword result sections and sends it via SMTP after each run. The pure
 * text builders live here so they are unit-testable without touching the
 * network; the send layer (isEmailConfigured / sendEmail / sendDailyDigest)
 * is added in the next task.
 */

function todayIso() {
  return new Date().toISOString().split('T')[0];
}

function tierLabel(tier) {
  if (tier == null) return '';
  return `[T${tier}] `;
}

function formatDigestItem(item) {
  const tier = tierLabel(item.tier);
  const score = item.score != null ? ` (${item.score}分)` : '';
  return `${tier}${item.title}${score}\n  ${item.url}`;
}

function buildDigestText(sections) {
  const total = sections.reduce((n, s) => n + s.results.length, 0);
  const lines = [
    `AI News Monitor 每日摘要 — ${todayIso()}`,
    `相关新内容 ${total} 条`,
    '',
  ];
  for (const { keyword, results } of sections) {
    if (!results || results.length === 0) continue;
    lines.push(`【${keyword.name}】(${results.length})`, '');
    for (const item of results) lines.push(formatDigestItem(item), '');
  }
  if (total === 0) lines.push('今日无新增关注内容。', '');
  return lines.join('\n');
}

function buildSubject(sections) {
  const total = sections.reduce((n, s) => n + s.results.length, 0);
  return `【AI News Monitor】${todayIso()} 每日摘要 · 相关 ${total} 条`;
}

module.exports = { buildDigestText, buildSubject };
