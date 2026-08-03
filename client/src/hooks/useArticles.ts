import { supabase } from '../lib/supabase';
import { useSupabaseQuery } from './useSupabaseQuery';
import type { Article, FilterState } from '../types';

export const PAGE_SIZE = 20;
// 评分门槛，与后端 ai.js 的 MIN_SCORE 保持一致（score>=60 视为相关）
export const MIN_SCORE = 60;

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

    if (filters.sortBy === 'score') {
      query = query.order('score', { ascending: false }).order('created_at', { ascending: false });
    } else {
      query = query.order('created_at', { ascending: false });
    }

    const from = (page - 1) * PAGE_SIZE;
    return query.range(from, from + PAGE_SIZE - 1);
  }, [filters.keywordId, filters.source, filters.search, filters.sortBy, filters.tier, page]);

  return { articles: data, total: count, loading, error };
}

/**
 * 板块视图专用：取最近 N 条（不分页），用于 BoardView 网格展示。
 * keywordId 为 null 时不发请求。
 */
export function useBoardArticles(keywordId: string | null, limit = 60) {
  const { data, loading, error } = useSupabaseQuery<Article>(() => {
    if (!keywordId) return Promise.resolve({ data: [], error: null });
    return supabase
      .from('articles')
      .select('*, keywords(name, type)')
      .eq('keyword_id', keywordId)
      .gte('score', MIN_SCORE)
      .order('created_at', { ascending: false })
      .limit(limit);
  }, [keywordId, limit]);

  return { articles: data, loading, error };
}
