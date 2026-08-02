import { useState } from 'react';
import { Newspaper, Tag, Search as SearchIcon } from 'lucide-react';
import { cn } from './lib/utils';
import FilterSortBar from './components/FilterSortBar';
import ArticleFeed from './components/ArticleFeed';
import LoadingSkeleton from './components/LoadingSkeleton';
import EmptyState from './components/EmptyState';
import { useKeywords } from './hooks/useKeywords';
import type { FilterState, Keyword } from './types';

const DEFAULT_FILTERS: FilterState = {
  keywordId: '',
  source: '',
  sortBy: 'created_at',
  search: '',
};

type Tab = 'all' | 'keywords' | 'search';

function KeywordsTab({ keywords }: { keywords: Keyword[] }) {
  const [selectedId, setSelectedId] = useState('');
  const [page, setPage] = useState(1);

  const filters: FilterState = { ...DEFAULT_FILTERS, keywordId: selectedId };

  const select = (id: string) => {
    setSelectedId(id);
    setPage(1);
  };

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
        <ArticleFeed filters={filters} page={page} onPageChange={setPage} />
      ) : (
        <EmptyState message="选择一个关键词查看相关文章" />
      )}
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState<Tab>('all');
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const { keywords, loading: kwLoading } = useKeywords();

  const handleTabChange = (t: Tab) => {
    setTab(t);
    setPage(1);
    setFilters(DEFAULT_FILTERS);
  };

  const handleFilterChange = (f: FilterState) => {
    setFilters(f);
    setPage(1);
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchQuery(searchInput);
    setPage(1);
  };

  const TABS = [
    { id: 'all' as Tab, label: '全部', Icon: Newspaper },
    { id: 'keywords' as Tab, label: '按关键词', Icon: Tag },
    { id: 'search' as Tab, label: '搜索', Icon: SearchIcon },
  ];

  return (
    <div className="min-h-screen bg-[#f0f4ff]">
      <header className="bg-blue-700 text-white sticky top-0 z-20 shadow-md">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
          <Newspaper className="w-5 h-5 opacity-80" />
          <h1 className="text-base font-bold">AI News Monitor</h1>
        </div>
      </header>

      <nav className="bg-white border-b border-blue-100 sticky top-[52px] z-10">
        <div className="max-w-5xl mx-auto px-4 flex">
          {TABS.map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => handleTabChange(id)}
              className={cn(
                'flex items-center gap-1.5 px-5 py-3 text-sm font-medium border-b-2 transition-colors',
                tab === id
                  ? 'border-blue-700 text-blue-700'
                  : 'border-transparent text-slate-500 hover:text-blue-600'
              )}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-4 py-6">
        {tab === 'all' && (
          <>
            <FilterSortBar filters={filters} onChange={handleFilterChange} />
            <ArticleFeed filters={filters} page={page} onPageChange={setPage} />
          </>
        )}

        {tab === 'keywords' && (
          kwLoading ? (
            <LoadingSkeleton count={3} />
          ) : keywords.length === 0 ? (
            <EmptyState message="暂无已启用的关键词" />
          ) : (
            <KeywordsTab keywords={keywords} />
          )
        )}

        {tab === 'search' && (
          <div>
            <form onSubmit={handleSearch} className="flex gap-2 mb-6">
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
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
            {searchQuery ? (
              <ArticleFeed
                filters={{ ...DEFAULT_FILTERS, search: searchQuery }}
                page={page}
                onPageChange={setPage}
              />
            ) : (
              <EmptyState message="输入关键词开始搜索" />
            )}
          </div>
        )}
      </main>
    </div>
  );
}
