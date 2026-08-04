'use strict';

// 从文章 URL 提取真实发布日期（纯函数，无副作用）。
// 支持两种 URL 日期模式：
//   - Guardian 英文月路径：/2026/jun/08/（用英文月名表校验）
//   - 数字日期路径：/2026/8/12/（TechCrunch / Dallas Morning News 等）
// 拒绝未来日期（URL 日期晚于当前时间 → null），非法日期（如 2 月 30 日）返回 null。

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

// 构造合法 Date；月份/日期越界（如 2 月 30 日）会被 JS 自动进位，需回验并拒绝。
function makeDate(year, month, day) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  if (date.getTime() > Date.now()) return null; // 拒绝未来日期
  return date;
}

/**
 * 从文章 URL 提取发布日期。
 * @param {string} url 文章 URL
 * @returns {Date|null} 提取成功返回本地时区的 Date，否则 null
 */
function extractPublishDateFromUrl(url) {
  if (!url) return null;
  const u = String(url).replace(/[?#].*$/, ''); // 剥查询串/锚点

  // Guardian 式：/2026/jun/08/
  let m = u.match(/\/(20\d{2})\/([a-z]{3})\/(\d{1,2})\//i);
  if (m && MONTHS[m[2].toLowerCase()]) {
    return makeDate(m[1], MONTHS[m[2].toLowerCase()], m[3]);
  }

  // 数字日期式：/2026/8/12/
  m = u.match(/\/(20\d{2})\/(\d{1,2})\/(\d{1,2})\//);
  if (m) {
    return makeDate(m[1], m[2], m[3]);
  }

  return null;
}

module.exports = { extractPublishDateFromUrl };
