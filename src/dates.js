'use strict';

/**
 * URL date extraction.
 *
 * Pure function (no side effects) that derives a real publish date from an
 * article URL. Two URL date patterns are supported:
 *   - Guardian English-month path:  /2026/jun/08/   (validated via month table)
 *   - Numeric date path:            /2026/8/12/    (TechCrunch / Dallas Morning News ...)
 * Future dates (later than now) and invalid dates (e.g. Feb 30) return null.
 */

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
 * Extract a publish date from an article URL.
 * @param {string} url - Article URL.
 * @returns {Date|null} Local-timezone Date when extracted, otherwise null.
 */
function extractPublishDateFromUrl(url) {
  if (!url) return null;
  const u = String(url).replace(/[?#].*$/, ''); // strip query string / anchor

  // Guardian style: /2026/jun/08/
  let m = u.match(/\/(20\d{2})\/([a-z]{3})\/(\d{1,2})\//i);
  if (m && MONTHS[m[2].toLowerCase()]) {
    return makeDate(m[1], MONTHS[m[2].toLowerCase()], m[3]);
  }

  // Numeric date style: /2026/8/12/
  m = u.match(/\/(20\d{2})\/(\d{1,2})\/(\d{1,2})\//);
  if (m) {
    return makeDate(m[1], m[2], m[3]);
  }

  return null;
}

module.exports = { extractPublishDateFromUrl };
