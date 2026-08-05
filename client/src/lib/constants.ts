import type { FilterState } from '../types';

/** Initial filter state (shared by App / KeywordsTab / SearchTab). */
export const DEFAULT_FILTERS: FilterState = { keywordId: '', source: '', sortBy: 'published_at', search: '', tier: null, includeOld: false };

/** Keywords that use the board grid view (currently MU + Dallas). */
export const MU_KEYWORD_ID = 'manchester-united';
export const DAL_KEYWORD_ID = 'dallas-mavericks';

/**
 * Paywall source labels (key = article.source slug; when hit, the article card
 * shows a "premium content" corner badge).
 */
export const PAYWALL_SOURCES: Record<string, string> = {
  'dallas-morning-news': '正文需订阅',
};
