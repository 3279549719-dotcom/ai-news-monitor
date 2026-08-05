import { useState, useEffect, type DependencyList } from 'react';

/**
 * The thenable shape returned by a supabase query builder passed to
 * useSupabaseQuery. Mirrors the PostgREST response (data rows + optional count
 * + error object).
 */
export type QueryResult<T> = {
  data: T[] | null;
  count?: number | null;
  error: { message: string } | null;
};

/**
 * Return contract of useSupabaseQuery: unified data/count/loading/error shape.
 * `data` and `count` are always defined (defaulting to [] / 0).
 */
export interface UseQueryResult<T> {
  data: T[];
  count: number;
  loading: boolean;
  error: string | null;
}

/**
 * Generic Supabase query hook: unifies loading/error handling and cancels
 * stale requests (rapid filter switches never let an old response overwrite
 * newer data). `buildQuery` returns a supabase query thenable; pass scalar
 * values in `deps` to avoid invalid re-queries caused by object references.
 * @template T Row type of the queried table.
 * @param buildQuery - Builds the query thenable to run.
 * @param deps - Dependency list controlling when the query re-runs.
 * @returns {UseQueryResult<T>} Unified data/count/loading/error result.
 */
export function useSupabaseQuery<T>(
  buildQuery: () => PromiseLike<QueryResult<T>>,
  deps: DependencyList
): UseQueryResult<T> {
  const [data, setData] = useState<T[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.resolve(buildQuery())
      .then(({ data: rows, count: total, error: err }) => {
        if (cancelled) return;
        if (err) setError(err.message);
        else {
          setData(rows ?? []);
          if (typeof total === 'number') setCount(total);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // buildQuery 每次渲染重建，用显式 deps 精确控制重查
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, count, loading, error };
}
