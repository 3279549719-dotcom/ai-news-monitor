import { supabase } from '../lib/supabase';
import { useSupabaseQuery } from './useSupabaseQuery';
import type { Keyword } from '../types';

/** Return contract of useKeywords. */
export interface UseKeywordsResult {
  keywords: Keyword[];
  loading: boolean;
  error: string | null;
}

/**
 * Load all enabled keywords, ordered by name.
 * @returns {UseKeywordsResult} Keywords + loading/error.
 */
export function useKeywords(): UseKeywordsResult {
  const { data, loading, error } = useSupabaseQuery<Keyword>(
    () => supabase.from('keywords').select('*').eq('enabled', true).order('name'),
    []
  );
  return { keywords: data, loading, error };
}
