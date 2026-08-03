import { useState } from 'react';
import { cn } from '../lib/utils';
import ArticleFeed from './ArticleFeed';
import BoardView from './BoardView';
import EmptyState from './EmptyState';
import LoadingSkeleton from './LoadingSkeleton';
import { useBoardArticles } from '../hooks/useArticles';
import { useKeywords } from '../hooks/useKeywords';
import { DEFAULT_FILTERS, MU_KEYWORD_ID } from '../lib/constants';

export default function KeywordsTab() {
  const [selectedId, setSelectedId] = useState('');
  const [page, setPage] = useState(1);
  // 关键词在本组件内拉取（仅在切到「按关键词」tab 时才请求）
  const { keywords, loading, error } = useKeywords();

  const select = (id: string) => { setSelectedId(id); setPage(1); };

  const selected = keywords.find(k => k.id === selectedId) ?? null;
  // 仅 MU 用板块视图；其余关键词直接走 ArticleFeed，避免无谓的板块查询
  const showBoard = selected?.id === MU_KEYWORD_ID;
  const { articles: boardArticles, loading: boardLoading } = useBoardArticles(showBoard ? selectedId : null);

  if (loading) return <LoadingSkeleton count={3} />;
  if (error) return <EmptyState message={`加载关键词失败：${error}`} />;
  if (keywords.length === 0) return <EmptyState message="暂无已启用的关键词" />;

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-6">
        {keywords.map((kw) => (
          <button
            key={kw.id}
            onClick={() => select(kw.id)}
            className={cn(
              'px-4 py-2 rounded-xl text-sm font-medium border transition-colors',
              selectedId === kw.id
                ? 'bg-blue-700 text-white border-blue-700'
                : 'bg-white text-slate-600 border-blue-100 hover:border-blue-400 hover:text-blue-700'
            )}
          >
            {kw.name}
            <span className={cn(
              'ml-1.5 text-xs rounded-full px-1.5 py-0.5',
              selectedId === kw.id ? 'bg-blue-500 text-white' : 'bg-blue-50 text-blue-500'
            )}>
              {kw.type}
            </span>
          </button>
        ))}
      </div>
      {selectedId ? (
        showBoard ? (
          boardLoading ? <LoadingSkeleton count={3} /> : (
            <BoardView articles={boardArticles} keywordId={selected.id} keywordName={selected.name} />
          )
        ) : (
          <ArticleFeed filters={{ ...DEFAULT_FILTERS, keywordId: selectedId }} page={page} onPageChange={setPage} />
        )
      ) : (
        <EmptyState message="选择一个关键词查看相关文章" />
      )}
    </div>
  );
}
