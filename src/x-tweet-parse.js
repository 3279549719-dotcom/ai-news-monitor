'use strict';

const { toItem } = require('./items');

/**
 * X 推文卡纯解析模块。
 *
 * 把 X 记者内容解析成管线 item（title=推文正文、url=状态链接、publishedAt=真实发推时刻）。
 * 两个输入源：
 *  - twikit（主通道）：结构化行 {handle, status_id, text, created_at}
 *  - crawl4ai guest 兜底：账号页 markdown → extractTweetsFromMarkdown
 */

/** 雪花 ID → 发推毫秒时间戳（status id 是 snowflake：右移 22 位 + 固定偏移）。失败返回 null。 */
function snowflakeTimestamp(statusId) {
  if (!statusId || !/^\d{1,19}$/.test(String(statusId))) return null;
  // 用 BigInt 精确右移（status id 达 2e18，Number 会丢精度、`>>` 会截断 32 位）
  const ms = Number(BigInt(statusId) >> 22n) + 1288834974657;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return new Date(ms);
}

/** 从 X 账号页 URL 提取 handle（pathname 第一段）。 */
function handleFromProfileUrl(url) {
  try {
    return new URL(url).pathname.split('/').filter(Boolean)[0] || '';
  } catch {
    return '';
  }
}

/** 构造状态链接。 */
function statusUrlFor(handle, id) {
  return `https://x.com/${handle}/status/${id}`;
}

// 提取 crawl4ai markdown 中的状态链接（任意 x.com/twitter.com 账号）
const STATUS_RE =
  /\[[^\]]*\]\((?:https?:)?\/\/(?:x\.com|twitter\.com)\/[A-Za-z0-9_]+\/status\/(\d+)\)/g;

/**
 * 从 crawl4ai 返回的 X 账号页 markdown 提取推文卡。
 * 结构：`[相对时间](…/status/<id>)` 后跟推文正文（含 `[#tag](url)` markdown 链接）；
 * 卡片链接 `[卡片标题](https://t.co/…)` 仅作上下文，不进 title/url。
 * @param {string} md - crawl4ai markdown。
 * @param {string} handle - 账号 handle，用于拼状态链接。
 * @returns {Array} [{title,url,publishedAt}]
 */
function extractTweetsFromMarkdown(md, handle) {
  if (!md || !handle) return [];
  const matches = [];
  let m;
  STATUS_RE.lastIndex = 0;
  while ((m = STATUS_RE.exec(md)) !== null) {
    matches.push({ id: m[1], index: m.index });
  }
  const tweets = [];
  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i];
    const end = i + 1 < matches.length ? matches[i + 1].index : md.length;
    let block = md.slice(cur.index, end);
    const text = block
      .split('\n')
      .map(l => l.trim())
      // 纯链接行（卡片/头像/导航）整行丢弃，正文行保留
      .filter(l => l && !/^(!?\[[^\]]*\]\([^)]*\))+/.test(l))
      // 互动数 / 页脚 / 头像残留
      .filter(l =>
        !/^[\d.,KMB+]+$/.test(l) &&
        !/^Log in|^Sign up|^Terms|^Privacy|^Cookie|^Ads|^©/.test(l) &&
        !/^(Follow|Mention|Posts|Replies|Media)$/.test(l) &&
        !/user avatar|profile_images|header_photo|hero_photo/.test(l)
      )
      // 正文行内：剥图片链 + [text](url)→text + 清残留括号
      .map(l =>
        l
          .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
          .replace(/\[([^\]]*)\]\([^)]*\)/g, (_, txt) => txt || '')
          .replace(/\]\([^)\s]+\)/g, ' ')
          .replace(/[\[\]()]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
      )
      .filter(Boolean)
      .join(' ')
      .trim();
    if (text.length >= 15) {
      const ts = snowflakeTimestamp(cur.id);
      tweets.push({
        title: text.slice(0, 280),
        url: statusUrlFor(handle, cur.id),
        publishedAt: ts || null,
      });
    }
  }
  return tweets;
}

/** twikit 结构化行 → item（toItem 形状）。 */
function parseTwikitRows(source, rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter(r => r && r.text && r.text.trim().length >= 15)
    .map(r =>
      toItem(source, {
        title: String(r.text).trim().slice(0, 280),
        url: statusUrlFor(r.handle || '', String(r.status_id || '')),
        publishedAt: r.created_at ? new Date(r.created_at) : null,
      })
    )
    .filter(i => i.url.includes('/status/'));
}

module.exports = {
  snowflakeTimestamp,
  handleFromProfileUrl,
  statusUrlFor,
  extractTweetsFromMarkdown,
  parseTwikitRows,
};
