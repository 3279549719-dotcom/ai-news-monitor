'use strict';

/**
 * Daily digest email module.
 *
 * Builds both a plain-text and an HTML concise digest (grouped by keyword)
 * from the pipeline's per-keyword result sections and sends it via SMTP after
 * each run. The pure builders (buildDigestText / buildDigestHtml / buildSubject)
 * live here so they are unit-testable without touching the network; the send
 * layer (isEmailConfigured / sendEmail / sendDailyDigest) is best-effort and
 * never affects the pipeline exit code.
 */

const config = require('./config');
const { CONFIDENCE_LABEL } = require('./crosscheck');
const notify = require('./notify');

function todayIso() {
  return new Date().toISOString().split('T')[0];
}

// 过滤规则：只推 T0/T1 信源（官方 + 一线记者）。T2 媒体不进邮件，
// 但内容照常入库/进日报 —— 此处只是展示层过滤，不改数据流。
function isNotable(item) {
  return item != null && (item.tier === 0 || item.tier === 1);
}

/**
 * Filter sections to T0/T1 items only, preserving the per-keyword structure.
 * @param {Array<{keyword:Object, results:Array}>} sections
 * @returns {Array<{keyword:Object, results:Array}>}
 */
function filterDigestSections(sections) {
  return sections.map(s => ({ ...s, results: (s.results || []).filter(isNotable) }));
}

/**
 * Group a keyword's results into category boards using its category_schema
 * (same source of truth as report.js). Items whose category is not a schema
 * key fall into a trailing「未分类」board. Only non-empty boards returned.
 * @param {Object} keyword - keyword row (uses keyword.category_schema)
 * @param {Array} results - filtered items
 * @returns {Array<{key:string,label:string,items:Array}>}
 */
function groupByBoards(keyword, results) {
  const schema = (keyword && keyword.category_schema) || {};
  const boards = Object.entries(schema).map(([key, label]) => ({ key, label, items: [] }));
  boards.push({ key: '__uncat', label: '未分类', items: [] });
  for (const item of results) {
    const board = boards.find(b => b.key === item.category) || boards[boards.length - 1];
    board.items.push(item);
  }
  return boards.filter(b => b.items.length > 0);
}

// summary 去掉【事件】段（该内容已由 event 加粗行呈现），保留【要点】【为什么重要】
function summaryBody(summary) {
  if (!summary) return '';
  const m = summary.match(/^【事件】.+?(?=【|$)/);
  return m ? summary.slice(m[0].length).replace(/^\s+/, '') : summary;
}

function textMeta(item) {
  const meta = [];
  if (item.tier != null) meta.push(`T${item.tier}`);
  if (item.confidence) meta.push(CONFIDENCE_LABEL[item.confidence] || item.confidence);
  if ((item.corroboration_count || 0) >= 2) meta.push(`${item.corroboration_count}源印证`);
  if (item.conflict_flag) meta.push('⚠️冲突');
  return meta.join(' | ');
}

function buildDigestText(sections) {
  const total = sections.reduce((n, s) => n + s.results.length, 0);
  const lines = [
    `AI News Monitor 每日摘要 — ${todayIso()}`,
    `今日 ${total} 件值得关注（T0/T1 信源）`,
    '',
  ];
  for (const { keyword, results } of sections) {
    if (results.length === 0) continue;
    lines.push(`【${keyword.name}】(${results.length})`, '');
    for (const board of groupByBoards(keyword, results)) {
      lines.push(`◆ ${board.label} (${board.items.length})`, '');
      for (const item of board.items) {
        const title = item.event || item.title;
        lines.push(`- ${title}  ${textMeta(item)}`);
        const body = summaryBody(item.summary);
        if (body) lines.push(`  ${body}`);
        lines.push(`  ${item.url}`, '');
      }
    }
  }
  if (total === 0) lines.push('今日无值得关注的新内容。', '');
  return lines.join('\n');
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function hostOf(url) {
  if (!url) return '';
  return String(url).replace(/^https?:\/\//, '').replace(/^www\./, '');
}

// 彩色徽章：Tier（蓝）/ 置信度（黄）/ 多源印证（绿）/ 冲突（红）
function badgeHtml(item) {
  const b = [];
  if (item.tier != null) b.push(`<span style="display:inline-block;background:#eef2ff;color:#3730a3;border-radius:999px;padding:0 8px;margin-right:6px;font-size:11px;">T${item.tier}</span>`);
  if (item.confidence) b.push(`<span style="display:inline-block;background:#fef3c7;color:#92400e;border-radius:999px;padding:0 8px;margin-right:6px;font-size:11px;">${escapeHtml(CONFIDENCE_LABEL[item.confidence] || item.confidence)}</span>`);
  if ((item.corroboration_count || 0) >= 2) b.push(`<span style="display:inline-block;background:#dcfce7;color:#166534;border-radius:999px;padding:0 8px;margin-right:6px;font-size:11px;">${item.corroboration_count}源印证</span>`);
  if (item.conflict_flag) b.push(`<span style="display:inline-block;background:#fee2e2;color:#991b1b;border-radius:999px;padding:0 8px;margin-right:6px;font-size:11px;">⚠️ 冲突</span>`);
  return b.join('');
}

/**
 * Build a lightweight HTML digest: dark header card + per-keyword boards with
 * event-bold cards. Inline styles only (email clients strip <style>/external
 * CSS). Sent alongside the text part; clients render whichever they support.
 */
function buildDigestHtml(sections) {
  const total = sections.reduce((n, s) => n + s.results.length, 0);
  const parts = [
    `<div style="font-family:-apple-system,'Segoe UI','Microsoft YaHei',sans-serif;max-width:680px;margin:0 auto;color:#111827;padding:24px 16px;">`,
    `<div style="background:#111827;color:#fff;border-radius:12px;padding:20px 24px;">`,
    `<div style="font-size:12px;letter-spacing:1px;opacity:.65;">AI NEWS MONITOR · 每日摘要</div>`,
    `<div style="font-size:22px;font-weight:600;margin-top:4px;">${todayIso()}</div>`,
    `<div style="margin-top:10px;font-size:14px;opacity:.9;">今日 <b style="color:#60a5fa;">${total}</b> 件值得关注（T0/T1 信源）</div>`,
    `</div>`,
  ];
  for (const { keyword, results } of sections) {
    if (results.length === 0) continue;
    parts.push(`<h3 style="margin:24px 0 4px;font-size:16px;color:#111827;">${escapeHtml(keyword.name)} <span style="color:#9ca3af;font-weight:normal;font-size:13px;">(${results.length})</span></h3>`);
    for (const board of groupByBoards(keyword, results)) {
      parts.push(`<div style="margin-top:14px;font-size:13px;font-weight:600;color:#2563eb;">◆ ${escapeHtml(board.label)} <span style="color:#9ca3af;font-weight:normal;">(${board.items.length})</span></div>`);
      for (const item of board.items) {
        const title = item.event || item.title;
        const body = summaryBody(item.summary);
        parts.push(
          `<div style="margin:10px 0 0;padding:12px 14px;background:#fff;border-radius:10px;border:1px solid #eef0f3;">` +
          `<div style="font-size:14px;font-weight:600;color:#111827;">${escapeHtml(title)}</div>` +
          `<div style="margin-top:6px;">${badgeHtml(item)}</div>` +
          (body ? `<div style="margin-top:8px;font-size:13px;color:#374151;line-height:1.6;">${escapeHtml(body)}</div>` : '') +
          `<a href="${escapeHtml(item.url)}" style="display:inline-block;margin-top:8px;font-size:12px;color:#9ca3af;text-decoration:none;">${escapeHtml(hostOf(item.url))} ↗</a>` +
          `</div>`
        );
      }
    }
  }
  if (total === 0) parts.push(`<p style="color:#6b7280;font-size:13px;">今日无值得关注的新内容。</p>`);
  parts.push(`</div>`);
  return parts.join('\n');
}

function buildSubject(sections) {
  const total = sections.reduce((n, s) => n + s.results.length, 0);
  return `【AI News Monitor】${todayIso()} 每日摘要 · 精选 ${total} 条`;
}

function isEmailConfigured(cfg = config) {
  return Boolean(cfg.EMAIL_ENABLED && cfg.SMTP_HOST && cfg.EMAIL_USER && cfg.getSecret('EMAIL_AUTH_CODE') && cfg.RECEIVER_EMAIL);
}

async function sendEmail({ subject, text, html }, opts = {}) {
  const cfg = opts.config || config;
  if (!isEmailConfigured(cfg)) return { sent: false, reason: 'SMTP 未配置或未启用' };
  // 惰性 require：纯函数单测路径不加载 nodemailer
  const nodemailer = require('nodemailer');
  const transport = nodemailer.createTransport({
    host: cfg.SMTP_HOST,
    port: cfg.SMTP_PORT,
    secure: cfg.SMTP_SECURE,
    auth: { user: cfg.EMAIL_USER, pass: cfg.getSecret('EMAIL_AUTH_CODE') },
    connectionTimeout: 15000,
    socketTimeout: 20000,
  });
  try {
    await transport.sendMail({
      from: `AI News Monitor <${cfg.EMAIL_USER}>`,
      to: cfg.RECEIVER_EMAIL,
      subject,
      text,
      html,
    });
    return { sent: true, subject };
  } finally {
    transport.close();
  }
}

async function sendDailyDigest(sections, opts = {}) {
  try {
    const filtered = filterDigestSections(sections);
    const payload = {
      subject: buildSubject(filtered),
      text: buildDigestText(filtered),
      html: buildDigestHtml(filtered),
    };
    // 单测 hook：opts.sender 直透 payload（不走 notify），保持既有 email.test.js 语义
    if (opts.sender) return await opts.sender(payload);
    // 生产路径：统一走通知分发器（默认 email 通道 → sendEmail）
    return await notify(payload, opts);
  } catch (err) {
    return { sent: false, reason: err.message };
  }
}

module.exports = { buildDigestText, buildDigestHtml, buildSubject, isEmailConfigured, sendEmail, sendDailyDigest, isNotable, filterDigestSections };
