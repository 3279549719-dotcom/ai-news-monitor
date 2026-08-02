import { ArrowDownUp, RotateCcw } from 'lucide-react';
import { cn } from '../lib/utils';
import type { FilterState } from '../types';

const SOURCES = [
  { value: '', label: '全部来源' },
  { value: 'blog', label: 'Blog' },
  { value: 'google-news', label: 'Google News' },
  { value: 'hackernews', label: 'HackerNews' },
];

const SORTS: { value: FilterState['sortBy']; label: string }[] = [
  { value: 'created_at', label: '最新发现' },
  { value: 'score', label: '最高相关' },
];

interface FilterSortBarProps {
  filters: FilterState;
  onChange: (filters: FilterState) => void;
}

export default function FilterSortBar({ filters, onChange }: FilterSortBarProps) {
  const update = <K extends keyof FilterState>(key: K, value: FilterState[K]) => {
    onChange({ ...filters, [key]: value });
  };

  const hasActiveFilter = filters.source !== '' || filters.sortBy !== 'created_at';

  return (
    <div className="flex items-center gap-2 flex-wrap mb-4">
      {/* Sort */}
      <div className="flex items-center gap-1 bg-white rounded-xl border border-blue-100 p-1">
        <ArrowDownUp className="w-3.5 h-3.5 text-slate-400 ml-2" />
        {SORTS.map((s) => (
          <button
            key={s.value}
            onClick={() => update('sortBy', s.value)}
            className={cn(
              'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
              filters.sortBy === s.value
                ? 'bg-blue-700 text-white'
                : 'text-slate-500 hover:text-blue-700'
            )}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Source filter */}
      <div className="flex items-center gap-1 flex-wrap">
        {SOURCES.map((s) => (
          <button
            key={s.value}
            onClick={() => update('source', s.value)}
            className={cn(
              'px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors',
              filters.source === s.value
                ? 'bg-blue-700 text-white border-blue-700'
                : 'bg-white text-slate-500 border-blue-100 hover:border-blue-300 hover:text-blue-700'
            )}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Reset */}
      {hasActiveFilter && (
        <button
          onClick={() => onChange({ ...filters, source: '', sortBy: 'created_at' })}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs text-slate-400 hover:text-blue-700 transition-colors"
        >
          <RotateCcw className="w-3 h-3" />
          重置
        </button>
      )}
    </div>
  );
}
