'use strict';

/**
 * 关键词词根映射表 — 用于 preFilter 和 C1 验收。
 *
 * 每个关键词对应一组词根：标题含任一词根即视为候选，否则前置过滤跳过。
 * 词根不区分大小写；中英文均可。
 */

const KEYWORD_ROOTS = {
  'Manchester United': ['man', 'united', 'mufc', '老特拉福德', '梦剧场', 'red devils', 'rashford', 'bruno', 'garnacho', 'højlund', 'ten hag'],
  'Anthropic': ['anthropic', 'claude', 'amodei'],
  'Dallas Mavericks': ['maverick', 'mavs', 'dallas', 'doncic', 'luka', 'kyrie', 'irving', 'cuban'],
};

function getKeywordRoots(name) {
  return KEYWORD_ROOTS[name] || [];
}

module.exports = { getKeywordRoots, KEYWORD_ROOTS };
