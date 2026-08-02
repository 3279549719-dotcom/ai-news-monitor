import ArticleCard from './ArticleCard';
import Pagination from './Pagination';
import LoadingSkeleton from './LoadingSkeleton';
import EmptyState from './EmptyState';
import { useArticles, PAGE_SIZE } from '../hooks/useArticles';
import type { FilterState } from '../types';

interface ArticleFeedProps {
  filters: FilterState;
  page: number;
  onPageChange: (p: number) => void;
}

export default function ArticleFeed({ filters, page, onPageChange }: ArticleFeedProps) {
  const { articles, total, loading, error } = useArticles(filters, page);

  if (loading) return <LoadingSkeleton count={5} />;
  if (error) return <EmptyState message={`加载失败：${error}`} />;
  if (articles.length === 0) return <EmptyState message="暂无相关内容" />;

  return (
    <>
      <p className="text-xs text-slate-400 mb-3">共 {total} 条结果</p>
      <div className="flex flex-col gap-3">
        {articles.map((a) => (
          <ArticleCard key={a.id} article={a} />
        ))}
      </div>
      <Pagination page={page} total={total} pageSize={PAGE_SIZE} onChange={onPageChange} />
    </>
  );
}
