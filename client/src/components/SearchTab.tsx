import { useState } from 'react';
import ArticleFeed from './ArticleFeed';
import EmptyState from './EmptyState';
import type { FilterState } from '../types';

const DEFAULT_FILTERS: FilterState = { keywordId: '', source: '', sortBy: 'created_at', search: '', tier: null };

export default function SearchTab() {
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setQuery(input);
    setPage(1);
  };

  return (
    <div>
      <form onSubmit={handleSubmit} className="flex gap-2 mb-6">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="搜索标题或摘要…"
          aria-label="搜索文章"
          className="flex-1 px-4 py-2.5 rounded-xl border border-blue-200 bg-white text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-200"
        />
        <button
          type="submit"
          className="px-5 py-2.5 bg-blue-700 text-white rounded-xl text-sm font-semibold hover:bg-blue-800 transition-colors"
        >
          搜索
        </button>
      </form>
      {query
        ? <ArticleFeed filters={{ ...DEFAULT_FILTERS, search: query }} page={page} onPageChange={setPage} />
        : <EmptyState message="输入关键词开始搜索" />}
    </div>
  );
}
