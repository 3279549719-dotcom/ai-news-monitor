import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import type { Keyword } from '../types';

export function useKeywords() {
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from('keywords')
      .select('*')
      .eq('enabled', true)
      .order('name')
      .then(({ data, error }) => {
        if (error) setError(error.message);
        else setKeywords(data ?? []);
        setLoading(false);
      });
  }, []);

  return { keywords, loading, error };
}
