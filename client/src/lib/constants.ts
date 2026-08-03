import type { FilterState } from '../types';

// 筛选初始态（App / KeywordsTab / SearchTab 共用，避免三处字面量漂移）
export const DEFAULT_FILTERS: FilterState = { keywordId: '', source: '', sortBy: 'created_at', search: '', tier: null };

// 板块视图专用关键词（当前仅曼联配置了 category_schema 板块）
export const MU_KEYWORD_ID = 'manchester-united';
