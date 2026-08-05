import { ExternalLink } from 'lucide-react';
import { cn } from '../lib/utils';
import { formatArticleDate } from '../utils/relativeTime';
import { SOURCE_CONFIG } from '../lib/sources';
import { PAYWALL_SOURCES } from '../lib/constants';
import { TierBadge } from './badges';
import type { Article } from '../types';

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

/** Props of ArticleCard. */
interface ArticleCardProps {
  article: Article;
}

/**
 * Compact article card used in the paginated list view: score badge, source
 * label, tier badge, paywall / genre markers and the AI summary.
 */
export default function ArticleCard({ article }: ArticleCardProps) {
  const { label: sourceLabel, color: sourceColor } = SOURCE_CONFIG[article.source] ?? {
    label: article.source,
    color: 'bg-slate-100 text-slate-600',
  };
  const paywallLabel = PAYWALL_SOURCES[article.source];

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
        <TierBadge tier={article.source_tier} />
        {article.keywords?.name && (
          <span className="bg-blue-50 text-blue-600 rounded px-1.5 py-0.5 text-[11px] font-medium">
            {article.keywords.name}
          </span>
        )}
        {paywallLabel && (
          <span className="text-[10px] text-orange-600 bg-orange-50 border border-orange-200 rounded px-1.5 py-0.5 font-semibold">
            {paywallLabel}
          </span>
        )}
        {article.event_type && (
          <span className="text-[10px] text-gray-400 bg-gray-100 rounded px-1.5 py-0.5">
            {article.event_type}
          </span>
        )}
        <span className="ml-auto">{formatArticleDate(article.published_at, article.created_at)}</span>
      </div>

      {article.summary && (
        <p className="text-sm text-slate-600 leading-relaxed border-l-2 border-blue-200 pl-3">
          {article.summary}
        </p>
      )}
    </article>
  );
}
