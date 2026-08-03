import { useState } from 'react';
import { cn } from '../lib/utils';
import ArticleFeed from './ArticleFeed';
import BoardView from './BoardView';
import EmptyState from './EmptyState';
import LoadingSkeleton from './LoadingSkeleton';
import { useBoardArticles } from '../hooks/useArticles';
import type { FilterState, Keyword } from '../types';

const DEFAULT_FILTERS: FilterState = { keywordId: '', source: '', sortBy: 'created_at', search: '', tier: null };

export default function KeywordsTab({ keywords }: { keywords: Keyword[] }) {
  const [selectedId, setSelectedId] = useState('');
  const [page, setPage] = useState(1);

  const select = (id: string) => { setSelectedId(id); setPage(1); };

  const selected = keywords.find(k => k.id === selectedId) ?? null;
  const { articles: boardArticles, loading: boardLoading } = useBoardArticles(selectedId || null);

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
        selected?.id === 'manchester-united' ? (
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
