'use strict';

/**
 * Keyword root-token map.
 *
 * Maps each keyword to a set of root tokens used by preFilter and the C1
 * acceptance check: a title containing any root is treated as a candidate,
 * otherwise it is skipped by the pre-filter to save DeepSeek calls. Matching
 * is case-insensitive and supports both Chinese and English tokens.
 */

const KEYWORD_ROOTS = {
  'Manchester United': ['man', 'united', 'mufc', '老特拉福德', '梦剧场', 'red devils', 'rashford', 'bruno', 'garnacho', 'højlund', 'ten hag'],
  'Anthropic': ['anthropic', 'claude', 'amodei'],
  'Dallas Mavericks': ['maverick', 'mavs', 'dallas', 'doncic', 'luka', 'kyrie', 'irving', 'cuban'],
};

/**
 * Get the root tokens for a keyword name.
 * @param {string} name - Keyword display name.
 * @returns {string[]} Root tokens (empty array when unknown).
 */
function getKeywordRoots(name) {
  return KEYWORD_ROOTS[name] || [];
}

module.exports = { getKeywordRoots, KEYWORD_ROOTS };
