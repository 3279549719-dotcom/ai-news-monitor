import { useState } from 'react';
import { Newspaper, Tag, Search as SearchIcon } from 'lucide-react';
import { cn } from './lib/utils';
import FilterSortBar from './components/FilterSortBar';
import ArticleFeed from './components/ArticleFeed';
import KeywordsTab from './components/KeywordsTab';
import SearchTab from './components/SearchTab';
import { DEFAULT_FILTERS } from './lib/constants';
import type { FilterState } from './types';

type Tab = 'all' | 'keywords' | 'search';

const TABS = [
  { id: 'all' as Tab, label: '全部', Icon: Newspaper },
  { id: 'keywords' as Tab, label: '按关键词', Icon: Tag },
  { id: 'search' as Tab, label: '搜索', Icon: SearchIcon },
];

export default function App() {
  const [tab, setTab] = useState<Tab>('all');
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [page, setPage] = useState(1);

  const handleTabChange = (t: Tab) => { setTab(t); setPage(1); setFilters(DEFAULT_FILTERS); };
  const handleFilterChange = (f: FilterState) => { setFilters(f); setPage(1); };

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
        {tab === 'keywords' && <KeywordsTab />}
        {tab === 'search' && <SearchTab />}
      </main>
    </div>
  );
}
