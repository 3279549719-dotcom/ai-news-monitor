import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../lib/utils';

interface PaginationProps {
  page: number;
  total: number;
  pageSize: number;
  onChange: (page: number) => void;
}

export default function Pagination({ page, total, pageSize, onChange }: PaginationProps) {
  const totalPages = Math.ceil(total / pageSize);
  if (totalPages <= 1) return null;

  const WINDOW = 3;
  const half = Math.floor(WINDOW / 2);
  let start = Math.max(1, page - half);
  const end = Math.min(totalPages, start + WINDOW - 1);
  if (end - start + 1 < WINDOW) start = Math.max(1, end - WINDOW + 1);

  const pages: (number | '...')[] = [];
  if (start > 1) { pages.push(1); if (start > 2) pages.push('...'); }
  for (let i = start; i <= end; i++) pages.push(i);
  if (end < totalPages) { if (end < totalPages - 1) pages.push('...'); pages.push(totalPages); }

  return (
    <div className="flex items-center justify-center gap-1 py-4">
      <button
        onClick={() => onChange(page - 1)}
        disabled={page === 1}
        className={cn(
          'p-1.5 rounded-lg transition-colors',
          page === 1
            ? 'text-slate-300 cursor-not-allowed'
            : 'text-slate-500 hover:text-blue-700 hover:bg-blue-50'
        )}
        aria-label="上一页"
      >
        <ChevronLeft className="w-4 h-4" />
      </button>

      {pages.map((p, i) =>
        p === '...' ? (
          <span key={`dots-${i}`} className="px-1 text-slate-400 text-sm">…</span>
        ) : (
          <button
            key={p}
            onClick={() => onChange(p)}
            className={cn(
              'w-8 h-8 rounded-lg text-sm font-medium transition-colors',
              page === p
                ? 'bg-blue-700 text-white'
                : 'text-slate-600 hover:bg-blue-50 hover:text-blue-700'
            )}
          >
            {p}
          </button>
        )
      )}

      <button
        onClick={() => onChange(page + 1)}
        disabled={page === totalPages}
        className={cn(
          'p-1.5 rounded-lg transition-colors',
          page === totalPages
            ? 'text-slate-300 cursor-not-allowed'
            : 'text-slate-500 hover:text-blue-700 hover:bg-blue-50'
        )}
        aria-label="下一页"
      >
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );
}
