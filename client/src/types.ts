export interface Keyword {
  id: string;
  name: string;
  type: 'blog' | 'search';
  query: string | null;
  url: string | null;
  enabled: boolean;
  created_at: string;
}

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
  source_tier?: number | null;
  category?: string | null;
  event?: string | null;
  confidence?: 'high' | 'medium' | 'low' | null;
  corroboration_count?: number | null;
  conflict_flag?: boolean | null;
  keywords?: {
    name: string;
    type: string;
  } | null;
}

export interface FilterState {
  keywordId: string;
  source: string;
  sortBy: 'created_at' | 'score';
  search: string;
  tier: number | null;
}
