'use strict';

/**
 * scripts/lib/ops-common.js — 运维脚本公共层（重构建议 8）
 *
 * auto-heal.js / ops-check.js / ops-stats.js / issue-close.js 四个运维脚本
 * 共享的辅助函数与路径约定，统一在此维护：
 *   - ts / localDate / log（与 scripts/lib/common.js 同签名，但本模块零依赖独立）
 *   - 日志/状态文件路径约定（logs/ 下统一）
 *   - readJsonFile / writeJsonFile（容错的状态文件读写）
 *
 * 为什么独立于 lib/common.js：common.js 依赖 dotenv，而 ops 脚本可能在
 * 无 .env 的环境跑（如 CI 巡检的轻量场景）；ops-common 保持零依赖。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const LOGS_DIR = path.join(ROOT, 'logs');

/** ISO 时间戳（本地时区）。 */
function ts(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** ISO 8601 时间戳（与 auto-heal/issue-close 原 ts() 一致：toISOString）。 */
function tsIso() {
  return new Date().toISOString();
}

/** 本地日期 YYYY-MM-DD。 */
function localDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 带时间戳前缀的日志。 */
function log(...args) {
  console.log(`[${ts()}]`, ...args);
}

/**
 * 容错读 JSON 文件。
 * @param {string} fp - 文件路径。
 * @param {*} [def] - 缺失/损坏时的默认值。
 * @returns {*} 解析结果。
 */
function readJsonFile(fp, def = null) {
  try {
    if (!fs.existsSync(fp)) return def;
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch {
    return def;
  }
}

/**
 * 容错写 JSON 文件（自动建目录）。
 * @param {string} fp - 文件路径。
 * @param {*} data - 要写入的数据。
 * @returns {boolean} 是否成功。
 */
function writeJsonFile(fp, data) {
  try {
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch {
    return false;
  }
}

module.exports = { ROOT, LOGS_DIR, ts, tsIso, localDate, log, readJsonFile, writeJsonFile };
