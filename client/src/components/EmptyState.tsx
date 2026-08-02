import { Newspaper } from 'lucide-react';

interface EmptyStateProps {
  message: string;
}

export default function EmptyState({ message }: EmptyStateProps) {
  return (
    <div className="text-center py-16 text-slate-400">
      <Newspaper className="w-10 h-10 mx-auto mb-3 opacity-25" />
      <p className="text-sm">{message}</p>
    </div>
  );
}
