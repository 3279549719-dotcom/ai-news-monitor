import type { FilterState } from '../types';

// 筛选初始态（App / KeywordsTab / SearchTab 共用，避免三处字面量漂移）
export const DEFAULT_FILTERS: FilterState = { keywordId: '', source: '', sortBy: 'published_at', search: '', tier: null, includeOld: false };

// 板块视图专用关键词（当前仅曼联配置了 category_schema 板块）
export const MU_KEYWORD_ID = 'manchester-united';
export const DAL_KEYWORD_ID = 'dallas-mavericks';

// 付费墙信源标注（key 是 article.source，即信源 slug；命中时前端卡片显示付费墙角标）
export const PAYWALL_SOURCES: Record<string, string> = {
  'dallas-morning-news': '正文需订阅',
};
