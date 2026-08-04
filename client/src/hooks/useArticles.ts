import { supabase } from '../lib/supabase';
import { useSupabaseQuery } from './useSupabaseQuery';
import type { Article, FilterState } from '../types';

export const PAGE_SIZE = 20;
// 评分门槛，与后端 ai.js 的 MIN_SCORE 保持一致（score>=60 视为相关）
export const MIN_SCORE = 60;

// 默认 recency 窗口：只看 30 天内发布的文章（T0 信源与无发布日期的文章豁免）
const RECENT_WINDOW_DAYS = 30;

function recentCutoffIso(): string {
  return new Date(Date.now() - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

export function useArticles(filters: FilterState, page: number) {
  const { data, count, loading, error } = useSupabaseQuery<Article>(() => {
    let query = supabase
      .from('articles')
      .select('*, keywords(name, type)', { count: 'exact' })
      .gte('score', MIN_SCORE);

    if (filters.keywordId) query = query.eq('keyword_id', filters.keywordId);
    if (filters.source) query = query.eq('source', filters.source);
    if (filters.tier !== null && filters.tier !== undefined) query = query.eq('source_tier', filters.tier);
    if (filters.search.trim()) {
      const term = `%${filters.search.trim()}%`;
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
 * 板块视图专用：取最近 N 条（不分页），用于 BoardView 网格展示。
 * keywordId 为 null 时不发请求。默认应用 30 天 recency 窗口（T0/null 豁免），
 * 按 published_at 降序（null 靠后）排列。
 */
export function useBoardArticles(keywordId: string | null, limit = 60, includeOld = false) {
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
