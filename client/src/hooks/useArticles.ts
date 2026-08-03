import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import type { Article, FilterState } from '../types';

export const PAGE_SIZE = 20;
export const MIN_SCORE = 60;

export function useArticles(filters: FilterState, page: number) {
  const [articles, setArticles] = useState<Article[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);

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
    query = query.range(from, from + PAGE_SIZE - 1);

    query.then(({ data, error, count }) => {
      if (error) setError(error.message);
      else {
        setArticles(data ?? []);
        setTotal(count ?? 0);
      }
      setLoading(false);
    });
  }, [filters.keywordId, filters.source, filters.search, filters.sortBy, filters.tier, page]);

  return { articles, total, loading, error };
}
