import { ArrowDownUp, RotateCcw } from 'lucide-react';
import { cn } from '../lib/utils';
import type { FilterState } from '../types';

const SOURCES = [
  { value: '', label: '全部来源' },
  { value: 'blog', label: 'Blog' },
  { value: 'hackernews', label: 'HackerNews' },
];

const TIERS = [
  { value: null, label: '全部层级' },
  { value: 0, label: 'T0 官方' },
  { value: 1, label: 'T1 顶级' },
  { value: 2, label: 'T2 主流' },
  { value: 3, label: 'T3 其他' },
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

  const hasActiveFilter = filters.source !== '' || filters.sortBy !== 'created_at' || filters.tier !== null;

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

      {/* Tier filter */}
      <div className="flex items-center gap-1 flex-wrap">
        {TIERS.map((t) => (
          <button
            key={String(t.value)}
            onClick={() => update('tier', t.value)}
            className={cn(
              'px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors',
              filters.tier === t.value
                ? 'bg-blue-700 text-white border-blue-700'
                : 'bg-white text-slate-500 border-blue-100 hover:border-blue-300 hover:text-blue-700'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Reset */}
      {hasActiveFilter && (
        <button
          onClick={() => onChange({ ...filters, source: '', sortBy: 'created_at', tier: null })}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs text-slate-400 hover:text-blue-700 transition-colors"
        >
          <RotateCcw className="w-3 h-3" />
          重置
        </button>
      )}
    </div>
  );
}
