'use strict';

/**
 * Keyword root-token map.
 *
 * Maps each keyword to a set of root tokens used by preFilter and the C1
 * acceptance check. Data loaded from keyword-roots.json so that adding a new
 * keyword does not require editing JS source code.
 */

const path = require('path');
const KEYWORD_ROOTS = require('./keyword-roots.json');

/**
 * Get the root tokens for a keyword name.
 * @param {string} name - Keyword display name.
 * @returns {string[]} Root tokens (empty array when unknown).
 */
function getKeywordRoots(name) {
  return KEYWORD_ROOTS[name] || [];
}

/**
 * Pre-filter items: keep only items whose title contains at least one keyword
 * root token. T0 official sources are exempt (always pass).
 * @param {Array} items - Candidate items with `title` and `tier` fields.
 * @param {string} keywordName - Display name of the keyword.
 * @returns {Array} Filtered items.
 */
function preFilter(items, keywordName) {
  const roots = getKeywordRoots(keywordName);
  if (roots.length === 0) return items;
  const filtered = [];
  const skipped = [];
  for (const item of items) {
    if (item.tier === 0) {
      filtered.push(item);
      continue;
    }
    const t = (item.title || '').toLowerCase();
    if (roots.some(r => t.includes(r.toLowerCase()))) {
      filtered.push(item);
    } else {
      skipped.push(item);
    }
  }
  if (skipped.length > 0) {
    console.log(`  [PreFilter] ${skipped.length} 条跳过（标题不含词根）`);
  }
  return filtered;
}

module.exports = { getKeywordRoots, preFilter, KEYWORD_ROOTS };
