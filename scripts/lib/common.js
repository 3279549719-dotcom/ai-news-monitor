'use strict';

/**
 * scripts/lib/common.js — 脚本公共工具层（重构建议 2）
 *
 * 统一所有 scripts/ 下脚本的初始化与常用辅助，消灭重复：
 *   - env()      → dotenv 统一入口（cwd 归一化到仓库根后再加载 .env）
 *   - getDb()    → Supabase 客户端（复用 src/db.js 单例，不再各处 createClient）
 *   - ts()       → ISO 时间戳日志前缀
 *   - localDate()→ 本地日期 YYYY-MM-DD
 *   - log()      → 带时间戳的 console.log
 *   - flag()     → CLI 参数解析（--key value / --key=value / 布尔）
 *
 * 原则：
 *   - 本文件不依赖 config.js 的 dotenv（避免双重加载）；env() 自持。
 *   - 所有函数容错：路径/参数异常时不抛，返回默认值。
 */

const path = require('path');
const fs = require('fs');

/** 仓库根（本文件位于 scripts/lib/，向上两级）。 */
const ROOT = path.resolve(__dirname, '..', '..');

/**
 * 归一化 cwd 到仓库根并加载 .env（幂等：重复调用安全）。
 * @returns {string} 仓库根路径。
 */
function env() {
  try {
    process.chdir(ROOT);
  } catch (e) { /* cwd 不可变时忽略 */ }
  try {
    require('dotenv').config({ path: path.join(ROOT, '.env') });
  } catch (e) { /* dotenv 缺失时忽略（模块已声明依赖） */ }
  return ROOT;
}

/**
 * Supabase 客户端（复用 src/db.js 单例）。
 * 注意：必须先调 env() 加载 .env。
 * @returns {object} Supabase client；配置缺失时抛错（与 db.js 行为一致）。
 */
function getDb() {
  return require(path.join(ROOT, 'src', 'db')).getClient();
}

/** ISO 时间戳（本地时区，YYYY-MM-DD HH:mm:ss）。 */
function ts(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
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
 * CLI 参数解析：--key value、--key=value、布尔 flag。
 * @param {string[]} argv - process.argv.slice(2)。
 * @param {string} name - 参数名（不含 --）。
 * @param {string} [def=''] - 默认值。
 * @returns {string} 参数值。
 */
function flag(argv, name, def = '') {
  const i = argv.indexOf(`--${name}`);
  if (i !== -1 && i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
    return argv[i + 1];
  }
  const eq = argv.find(a => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  return def;
}

module.exports = { ROOT, env, getDb, ts, localDate, log, flag };
