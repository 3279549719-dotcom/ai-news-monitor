import { useState, useEffect, type DependencyList } from 'react';

export type QueryResult<T> = {
  data: T[] | null;
  count?: number | null;
  error: { message: string } | null;
};

/**
 * 通用 Supabase 查询 hook：统一 loading/error 处理，并取消过期请求（快速切筛选时旧响应不覆盖新数据）。
 * buildQuery 返回 supabase 查询 thenable；deps 传标量字段，避免对象引用触发无效重请求。
 */
export function useSupabaseQuery<T>(
  buildQuery: () => PromiseLike<QueryResult<T>>,
  deps: DependencyList
) {
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
