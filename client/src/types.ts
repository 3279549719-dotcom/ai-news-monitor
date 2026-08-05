// ── Domain types (shared semantics with the backend; fields mirror DB columns) ──

/** Source credibility tier: 0 official / 1 top-tier / 2 mainstream / 3 other (see source-tiers.json). */
export type Tier = 0 | 1 | 2 | 3;

/** Cross-verification confidence (aligned with backend crosscheck.js CONFIDENCE_LABEL). */
export type Confidence = 'high' | 'medium' | 'low';

/** Article genre (aligned with the event_type extracted by backend analyzeResult). */
export type EventType =
  | 'interview'
  | 'match'
  | 'rumour'
  | 'injury'
  | 'deal'
  | 'official'
  | 'analysis'
  | 'other';

/** Article list sort key. */
export type SortBy = 'created_at' | 'score' | 'published_at';

/** A monitored keyword row (from the `keywords` table). */
export interface Keyword {
  id: string;
  name: string;
  type: 'blog' | 'search';
  query: string | null;
  url: string | null;
  enabled: boolean;
  created_at: string;
}

/** An article row (from the `articles` table), with optional joined keyword. */
export interface Article {
  id: string;
  keyword_id: string;
  title: string;
  url: string;
  source: string;
  snippet: string | null;
  summary: string | null;
  score: number;
  published_at: string | null;
  created_at: string;
  source_tier?: Tier | null;
  category?: string | null;
  event?: string | null;
  confidence?: Confidence | null;
  corroboration_count?: number | null;
  conflict_flag?: boolean | null;
  event_type?: EventType | null;
  keywords?: {
    name: string;
    type: string;
  } | null;
}

/** User-controllable filter/sort state for the article list view. */
export interface FilterState {
  keywordId: string;
  source: string;
  sortBy: SortBy;
  search: string;
  tier: Tier | null;
  includeOld: boolean;
}

// ── Presentation-layer types ──

/** Board definition (BoardView grid): key maps to a category_schema category. */
export interface BoardDef {
  key: string;
  label: string;
  emoji: string;
  official?: boolean;
}

/** Source display config (value type of SOURCE_CONFIG in lib/sources.ts). */
export interface SourceConfig {
  label: string;
  color: string;
}
