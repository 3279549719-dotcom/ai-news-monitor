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

function todayIso() {
  return new Date().toISOString().split('T')[0];
}

function tierLabel(tier) {
  if (tier == null) return '';
  return `[T${tier}] `;
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

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Build a lightweight HTML version of the same digest. Inline styles only
 * (email clients strip <style>/external CSS). Sent alongside the text part;
 * clients render whichever they support.
 */
function buildDigestHtml(sections) {
  const total = sections.reduce((n, s) => n + s.results.length, 0);
  const parts = [
    `<div style="font-family:-apple-system,'Segoe UI','Microsoft YaHei',sans-serif;max-width:640px;margin:0 auto;color:#111827;">`,
    `<h2 style="margin:0 0 4px;font-size:18px;">AI News Monitor 每日摘要 — ${todayIso()}</h2>`,
    `<p style="margin:0 0 16px;color:#6b7280;font-size:13px;">相关新内容 <b>${total}</b> 条</p>`,
  ];
  for (const { keyword, results } of sections) {
    if (!results || results.length === 0) continue;
    parts.push(
      `<h3 style="margin:20px 0 8px;padding-left:8px;border-left:3px solid #2563eb;font-size:15px;">${escapeHtml(keyword.name)} <span style="color:#6b7280;font-weight:normal;">(${results.length})</span></h3>`
    );
    for (const item of results) {
      const meta = [];
      if (item.tier != null) meta.push(`T${item.tier}`);
      if (item.score != null) meta.push(`${item.score}分`);
      const metaHtml = meta.length
        ? `<div style="margin-top:2px;color:#6b7280;font-size:12px;">${meta.map(escapeHtml).join(' · ')}</div>`
        : '';
      parts.push(
        `<div style="padding:10px 0;border-bottom:1px solid #e5e7eb;">` +
          `<a href="${escapeHtml(item.url)}" style="color:#2563eb;text-decoration:none;font-size:14px;">${escapeHtml(item.title)}</a>${metaHtml}` +
          `</div>`
      );
    }
  }
  if (total === 0) {
    parts.push(`<p style="color:#6b7280;font-size:13px;">今日无新增关注内容。</p>`);
  }
  parts.push(`<p style="margin:16px 0 0;color:#9ca3af;font-size:12px;">— AI News Monitor 自动生成</p>`, `</div>`);
  return parts.join('\n');
}

function buildSubject(sections) {
  const total = sections.reduce((n, s) => n + s.results.length, 0);
  return `【AI News Monitor】${todayIso()} 每日摘要 · 相关 ${total} 条`;
}

function isEmailConfigured(cfg = config) {
  return Boolean(cfg.EMAIL_ENABLED && cfg.SMTP_HOST && cfg.EMAIL_USER && cfg.EMAIL_AUTH_CODE && cfg.RECEIVER_EMAIL);
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
    auth: { user: cfg.EMAIL_USER, pass: cfg.EMAIL_AUTH_CODE },
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
    const subject = buildSubject(sections);
    const text = buildDigestText(sections);
    const html = buildDigestHtml(sections);
    if (opts.sender) return await opts.sender({ subject, text, html });
    return await sendEmail({ subject, text, html }, opts);
  } catch (err) {
    return { sent: false, reason: err.message };
  }
}

module.exports = { buildDigestText, buildDigestHtml, buildSubject, isEmailConfigured, sendEmail, sendDailyDigest, isNotable, filterDigestSections };
