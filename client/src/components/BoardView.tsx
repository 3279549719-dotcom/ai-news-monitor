import { ExternalLink } from 'lucide-react';
import { cn } from '../lib/utils';
import { formatArticleDate } from '../utils/relativeTime';
import { TierBadge, ConfidenceBadge } from './badges';
import { MU_KEYWORD_ID, DAL_KEYWORD_ID, PAYWALL_SOURCES } from '../lib/constants';
import type { Article } from '../types';

// 曼联板块定义（顺序即展示顺序）
export const MU_BOARDS: { key: string; label: string; emoji: string; official?: boolean }[] = [
  { key: 'official', label: '官方公告', emoji: '🔴', official: true },
  { key: 'transfer', label: '转会 & 合同动态', emoji: '🟡' },
  { key: 'injury', label: '伤病 & 停赛', emoji: '🏥' },
  { key: 'management', label: '管理层 · 教练组', emoji: '🏛️' },
  { key: 'match', label: '赛事竞技资讯', emoji: '⚽' },
];

// Dallas Mavericks 板块定义（顺序即展示顺序）
export const DAL_BOARDS: { key: string; label: string; emoji: string; official?: boolean }[] = [
  { key: 'official', label: '官方公告', emoji: '🔵', official: true },
  { key: 'trade', label: '交易签约', emoji: '🔄' },
  { key: 'injury', label: '伤病报告', emoji: '🏥' },
  { key: 'management', label: '管理层·教练组', emoji: '🏛️' },
  { key: 'match', label: '赛事战报', emoji: '🏀' },
];

// 通用板块（非曼联/独行侠关键词）
export const GENERIC_BOARDS: { key: string; label: string; emoji: string; official?: boolean }[] = [
  { key: 'official', label: '官方公告', emoji: '🔴' },
  { key: 'product', label: '产品发布', emoji: '🚀' },
  { key: 'research', label: '研究进展', emoji: '🔬' },
  { key: 'other', label: '其他', emoji: '📄' },
];

function ArticleCard({ article }: { article: Article }) {
  const paywallLabel = PAYWALL_SOURCES[article.source];
  return (
    <div className="border border-slate-100 bg-[#fafbfc] rounded-lg p-3 mb-2 hover:shadow-sm transition-shadow">
      <div className="flex items-center gap-1.5 text-[11px] text-slate-400 mb-1.5">
        <span className="font-medium text-slate-500">{article.source}</span>
        <TierBadge tier={article.source_tier} className="font-bold text-[10px] text-white" />
        <ConfidenceBadge confidence={article.confidence} />
        {article.corroboration_count != null && article.corroboration_count > 1 && (
          <span className="text-blue-500 font-medium">{article.corroboration_count}源印证</span>
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
      <h4 className="text-[13px] font-semibold text-slate-800 leading-snug mb-1">
        <a href={article.url} target="_blank" rel="noopener noreferrer" className="hover:text-blue-700 hover:underline">
          {article.title}
        </a>
      </h4>
      {article.summary && (
        <p className="text-[11px] text-slate-500 leading-relaxed mb-1.5">{article.summary}</p>
      )}
      <div className="flex items-center justify-between">
        {article.category ? (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 font-semibold">
            {article.category}
          </span>
        ) : (
          <span />
        )}
        <a href={article.url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-blue-500 hover:underline inline-flex items-center gap-0.5">
          原始链接 <ExternalLink className="w-3 h-3" />
        </a>
      </div>
    </div>
  );
}

interface BoardViewProps {
  articles: Article[];
  keywordId: string;
  keywordName: string;
}

export default function BoardView({ articles, keywordId, keywordName }: BoardViewProps) {
  const isMU = keywordId === MU_KEYWORD_ID;
  const isDAL = keywordId === DAL_KEYWORD_ID;
  const boards = isMU ? MU_BOARDS : isDAL ? DAL_BOARDS : GENERIC_BOARDS;

  const byCategory = (key: string) => articles.filter(a => a.category === key);

  // 兜底：不在任何板块定义内的分类（如 rumour/conflict/academy_women）进「其他」板，避免静默丢弃
  const unmatched = articles.filter(
    a => a.category && !boards.some(b => b.key === a.category) && a.category !== 'other'
  );

  // 今日概览统计
  const highCount = articles.filter(a => a.confidence === 'high').length;
  const conflictCount = articles.filter(a => a.conflict_flag).length;

  return (
    <div>
      {/* 顶部筛选已由 FilterSortBar 提供，这里仅展示标题 */}
      <div className="mb-4">
        <h2 className="text-lg font-bold text-slate-800">{keywordName}</h2>
        <p className="text-xs text-slate-400">白名单信源 · AI 评分 · Tier 可信度分级</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {boards.map(board => {
          const items = byCategory(board.key);
          return (
            <section
              key={board.key}
              className={cn(
                'bg-white rounded-xl p-4 shadow-sm border self-start',
                board.official ? 'border-2 border-red-500' : 'border-slate-100'
              )}
            >
              <div className="flex items-center gap-2 mb-3">
                <span className="text-base">{board.emoji}</span>
                <h3 className="text-sm font-bold text-slate-800">{board.label}</h3>
                {board.official && (
                  <span className="text-[10px] bg-red-500 text-white rounded-full px-2 py-0.5 font-bold">置顶 Tier0</span>
                )}
                {items.length > 0 && (
                  <span className="ml-auto text-[11px] text-slate-400">{items.length} 条</span>
                )}
              </div>
              {items.length === 0 ? (
                <p className="text-[11px] text-slate-300 text-center py-4">暂无内容</p>
              ) : (
                items.slice(0, 4).map(a => <ArticleCard key={a.id} article={a} />)
              )}
            </section>
          );
        })}

        {/* 兜底「其他」板：未匹配到任何板块定义的分类 */}
        {unmatched.length > 0 && (
          <section className="bg-white rounded-xl p-4 shadow-sm border border-slate-100 self-start">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-base">📄</span>
              <h3 className="text-sm font-bold text-slate-800">其他</h3>
              <span className="ml-auto text-[11px] text-slate-400">{unmatched.length} 条</span>
            </div>
            {unmatched.slice(0, 4).map(a => <ArticleCard key={a.id} article={a} />)}
          </section>
        )}

        {/* 今日概览卡 */}
        <section className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-base">📊</span>
            <h3 className="text-sm font-bold text-slate-800">今日概览</h3>
          </div>
          <div className="flex gap-2">
            <div className="flex-1 bg-[#fafbfc] rounded-lg p-3 text-center border border-slate-100">
              <div className="text-xl font-extrabold text-slate-800">{articles.length}</div>
              <div className="text-[10px] text-slate-400 mt-0.5">相关文章</div>
            </div>
            <div className="flex-1 bg-[#fafbfc] rounded-lg p-3 text-center border border-slate-100">
              <div className="text-xl font-extrabold text-blue-600">{highCount}</div>
              <div className="text-[10px] text-slate-400 mt-0.5">高置信</div>
            </div>
            <div className="flex-1 bg-[#fafbfc] rounded-lg p-3 text-center border border-slate-100">
              <div className="text-xl font-extrabold text-red-500">{conflictCount}</div>
              <div className="text-[10px] text-slate-400 mt-0.5">冲突</div>
            </div>
          </div>
          {conflictCount > 0 && (
            <div className="mt-3 text-[11px] text-red-600 bg-red-50 rounded-lg p-2.5 leading-relaxed">
              ⚠️ 有 {conflictCount} 条内容与官方信息存在冲突，请注意甄别
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
