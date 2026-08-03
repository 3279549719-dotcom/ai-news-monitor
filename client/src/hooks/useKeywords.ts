import { supabase } from '../lib/supabase';
import { useSupabaseQuery } from './useSupabaseQuery';
import type { Keyword } from '../types';

export function useKeywords() {
  const { data, loading, error } = useSupabaseQuery<Keyword>(
    () => supabase.from('keywords').select('*').eq('enabled', true).order('name'),
    []
  );
  return { keywords: data, loading, error };
}
