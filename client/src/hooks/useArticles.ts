import { supabase } from '../lib/supabase';
import { useSupabaseQuery } from './useSupabaseQuery';
import type { Article, FilterState } from '../types';

/** Number of articles per page in the paginated list view. */
export const PAGE_SIZE = 20;
/** Relevance threshold, kept in sync with backend ai.js MIN_SCORE (>=60 = relevant). */
export const MIN_SCORE = 60;

// Default recency window: only show articles published within the last 30 days
// (T0 sources and articles without a publish date are exempt).
const RECENT_WINDOW_DAYS = 30;

function recentCutoffIso(): string {
  return new Date(Date.now() - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * 将用户搜索词安全地包成 PostgREST `.or()` 逻辑树里可直接使用的值（含 `%...%` 包裹与引号）。
 * `.eq()`/`.ilike()` 等链式方法会自动转义参数，但 `.or()` 接收的是原始过滤字符串：
 * 未转义的 `,` `(` `)` 会破坏 or 语法（逗号拆分 or 列表、括号是分组符 → PostgREST 400），
 * `%` `_` 则是 LIKE 通配符 → 匹配语义错误。
 * PostgREST 的 or 语法不支持反斜杠转义逗号（实测 `\,` 会解析失败），文档规定用双引号
 * 包裹整个值（`or=(col.ilike."%a,b%")`）。但引号内 PostgREST 会把 `\x` 折叠成 `x`
 * （`\\`→`\`），因此 LIKE 通配符需写双反斜杠（`\\%`→解码为 `\%`→Postgres 字面量），
 * 字面反斜杠需写四反斜杠（`\\\\`→解码为 `\\`→Postgres 字面量），否则 `carr\ick` 会被
 * Postgres 当作 `carrick` 误匹配。
 */
function escapeOrValue(value: string): string {
  const inner = value
    .replace(/\\/g, '\\\\\\\\')
    .replace(/%/g, '\\\\%')
    .replace(/_/g, '\\\\_')
    .replace(/\*/g, '\\\\*')
    .replace(/"/g, '""');
  return `"%${inner}%"`;
}

/** Return contract of useArticles (paginated list view). */
export interface UseArticlesResult {
  articles: Article[];
  total: number;
  loading: boolean;
  error: string | null;
}

/** Return contract of useBoardArticles (board grid view, no pagination). */
export interface UseBoardArticlesResult {
  articles: Article[];
  loading: boolean;
  error: string | null;
}

/**
 * Fetch a paginated article list filtered/sorted by the given filters.
 * Applies MIN_SCORE, an optional keyword/source/tier/search filter, and the 30
 * day recency window (unless includeOld is set). Query re-runs only when a
 * scalar filter field or the page changes.
 * @param filters - Filter/sort state (keyword, source, tier, search, includeOld).
 * @param page - 1-based page number.
 * @returns {UseArticlesResult} Articles + total count + loading/error.
 */
export function useArticles(filters: FilterState, page: number): UseArticlesResult {
  const { data, count, loading, error } = useSupabaseQuery<Article>(() => {
    let query = supabase
      .from('articles')
      .select('*, keywords(name, type)', { count: 'exact' })
      .gte('score', MIN_SCORE);

    if (filters.keywordId) query = query.eq('keyword_id', filters.keywordId);
    if (filters.source) query = query.eq('source', filters.source);
    if (filters.tier !== null && filters.tier !== undefined) query = query.eq('source_tier', filters.tier);
    if (filters.search.trim()) {
      const term = escapeOrValue(filters.search.trim());
      query = query.or(`title.ilike.${term},summary.ilike.${term}`);
    }

    if (!filters.includeOld) {
      // 30 天 recency 窗口：published_at 在窗口内，或缺失，或 T0 信源豁免
      query = query.or(`published_at.gte.${recentCutoffIso()},published_at.is.null,source_tier.eq.0`);
    }

    if (filters.sortBy === 'score') {
      query = query.order('score', { ascending: false }).order('created_at', { ascending: false });
    } else if (filters.sortBy === 'published_at') {
      query = query.order('published_at', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false });
    } else {
      query = query.order('created_at', { ascending: false });
    }

    const from = (page - 1) * PAGE_SIZE;
    return query.range(from, from + PAGE_SIZE - 1);
  }, [filters.keywordId, filters.source, filters.search, filters.sortBy, filters.tier, filters.includeOld, page]);

  return { articles: data, total: count, loading, error };
}

/**
 * Fetch the most recent N articles for one keyword (no pagination) for the
 * board grid view. Sends no request when keywordId is null. Applies the 30 day
 * recency window by default (T0 / null publish date exempt) and orders by
 * published_at descending (nulls last).
 * @param keywordId - Keyword id, or null to skip fetching.
 * @param limit - Max number of articles to load.
 * @param includeOld - When true, ignore the recency window and include older items.
 * @returns {UseBoardArticlesResult} Articles + loading/error.
 */
export function useBoardArticles(keywordId: string | null, limit = 60, includeOld = false): UseBoardArticlesResult {
  const { data, loading, error } = useSupabaseQuery<Article>(() => {
    if (!keywordId) return Promise.resolve({ data: [], error: null });
    let query = supabase
      .from('articles')
      .select('*, keywords(name, type)')
      .eq('keyword_id', keywordId)
      .gte('score', MIN_SCORE);

    if (!includeOld) {
      query = query.or(`published_at.gte.${recentCutoffIso()},published_at.is.null,source_tier.eq.0`);
    }

    return query
      .order('published_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(limit);
  }, [keywordId, limit, includeOld]);

  return { articles: data, loading, error };
}
