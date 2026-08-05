import { Newspaper } from 'lucide-react';

/** Props of EmptyState. */
interface EmptyStateProps {
  message: string;
  hint?: string;
  actionLabel?: string;
  onAction?: () => void;
}

// 空态 = 行动引导，不是情绪占位（frontend-design：An empty screen is an invitation to act）
/**
 * Action-oriented empty state (not a passive placeholder): shows a message,
 * optional hint, and an optional call-to-action button.
 */
export default function EmptyState({ message, hint, actionLabel, onAction }: EmptyStateProps) {
  return (
    <div className="text-center py-14 text-slate-500 bg-white rounded-2xl border border-dashed border-slate-300">
      <Newspaper className="w-10 h-10 mx-auto mb-3 opacity-30" />
      <p className="text-sm font-medium">{message}</p>
      {hint && <p className="text-xs text-slate-400 mt-1.5">{hint}</p>}
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          className="inline-flex items-center px-4 py-2 mt-4 rounded-lg bg-blue-700 text-white text-sm font-medium hover:bg-blue-800 transition-colors"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
