import { ExternalLink } from 'lucide-react';
import { cn } from '../lib/utils';
import { relativeTime, formatDateTime } from '../utils/relativeTime';
import type { Article } from '../types';

const SOURCE_LABEL: Record<string, string> = {
  blog: 'Blog',
  'google-news': 'Google News',
  hackernews: 'HackerNews',
};

const SOURCE_COLOR: Record<string, string> = {
  blog: 'bg-violet-100 text-violet-700',
  'google-news': 'bg-blue-100 text-blue-700',
  hackernews: 'bg-orange-100 text-orange-700',
};

function ScoreBadge({ score }: { score: number }) {
  const color =
    score >= 80
      ? 'bg-green-100 text-green-700'
      : score >= 60
      ? 'bg-blue-100 text-blue-700'
      : 'bg-slate-100 text-slate-500';

  return (
    <span
      className={cn(
        'inline-flex items-center justify-center min-w-[2.25rem] h-9 rounded-lg font-bold text-sm px-2 flex-shrink-0',
        color
      )}
    >
      {score}
    </span>
  );
}

interface ArticleCardProps {
  article: Article;
}

export default function ArticleCard({ article }: ArticleCardProps) {
  const sourceLabel = SOURCE_LABEL[article.source] ?? article.source;
  const sourceColor = SOURCE_COLOR[article.source] ?? 'bg-slate-100 text-slate-600';
  const time = article.published_at ?? article.created_at;

  return (
    <article className="bg-white rounded-xl border border-blue-100 p-5 hover:shadow-md hover:border-blue-200 transition-all">
      <div className="flex items-start gap-3 mb-3">
        <ScoreBadge score={article.score} />
        <div className="flex-1 min-w-0">
          <h3 className="text-[15px] font-semibold text-slate-800 leading-snug">
            <a
              href={article.url}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-blue-700 hover:underline"
            >
              {article.title}
            </a>
          </h3>
        </div>
        <a
          href={article.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-shrink-0 text-slate-400 hover:text-blue-600 transition-colors mt-0.5"
          aria-label="打开文章"
        >
          <ExternalLink className="w-4 h-4" />
        </a>
      </div>

      <div className="flex items-center gap-2 text-xs text-slate-400 mb-3">
        <span className={cn('rounded px-1.5 py-0.5 font-semibold text-[11px]', sourceColor)}>
          {sourceLabel}
        </span>
        {article.keywords?.name && (
          <span className="bg-blue-50 text-blue-600 rounded px-1.5 py-0.5 text-[11px] font-medium">
            {article.keywords.name}
          </span>
        )}
        <span title={formatDateTime(time)} className="ml-auto">
          {relativeTime(time)}
        </span>
      </div>

      {article.summary && (
        <p className="text-sm text-slate-600 leading-relaxed border-l-2 border-blue-200 pl-3">
          {article.summary}
        </p>
      )}
    </article>
  );
}
