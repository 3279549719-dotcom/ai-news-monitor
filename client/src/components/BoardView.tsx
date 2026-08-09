import { ExternalLink } from 'lucide-react';
import { cn } from '../lib/utils';
import { formatArticleDate } from '../utils/relativeTime';
import { TierBadge, ConfidenceBadge } from './badges';
import { MU_KEYWORD_ID, DAL_KEYWORD_ID, PAYWALL_SOURCES } from '../lib/constants';
import type { Article, BoardDef } from '../types';

// Manchester United board definitions (order = display order).
export const MU_BOARDS: BoardDef[] = [
  { key: 'official', label: '官方公告', emoji: '🔴', official: true },
  { key: 'transfer', label: '转会 & 合同动态', emoji: '🟡' },
  { key: 'injury', label: '伤病 & 停赛', emoji: '🏥' },
  { key: 'management', label: '管理层 · 教练组', emoji: '🏛️' },
  { key: 'match', label: '赛事竞技资讯', emoji: '⚽' },
];

// Dallas Mavericks board definitions (order = display order).
export const DAL_BOARDS: BoardDef[] = [
  { key: 'official', label: '官方公告', emoji: '🔵', official: true },
  { key: 'trade', label: '交易签约', emoji: '🔄' },
  { key: 'injury', label: '伤病报告', emoji: '🏥' },
  { key: 'management', label: '管理层·教练组', emoji: '🏛️' },
  { key: 'match', label: '赛事战报', emoji: '🏀' },
];

// Generic boards for keywords without a dedicated board schema.
export const GENERIC_BOARDS: BoardDef[] = [
  { key: 'official', label: '官方公告', emoji: '🔴' },
  { key: 'product', label: '产品发布', emoji: '🚀' },
  { key: 'research', label: '研究进展', emoji: '🔬' },
  { key: 'other', label: '其他', emoji: '📄' },
];

// 卡片左色条 = Tier（Phase9 签名元素：把可信度编码进视觉，T0 官方红 / T1 琥珀 / T2 石板灰）
const TIER_RULE: Record<number, string> = {
  0: 'border-l-[#c63b3b]',
  1: 'border-l-[#c9851f]',
  2: 'border-l-[#5b6b7d]',
};
function tierRule(tier?: number | null) {
  return tier != null && TIER_RULE[tier] ? TIER_RULE[tier] : 'border-l-[#a7b0bd]';
}

function ArticleCard({ article }: { article: Article }) {
  const paywallLabel = PAYWALL_SOURCES[article.source];
  return (
    <div
      className={cn(
        'bg-white border border-slate-200 border-l-4 rounded-lg p-3 mb-2 hover:shadow-sm transition-shadow',
        tierRule(article.source_tier)
      )}
    >
      <div className="flex items-center gap-1.5 text-[11px] text-slate-400 mb-1.5 flex-wrap">
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
        <p className="text-xs text-slate-500 leading-relaxed mb-1.5">{article.summary}</p>
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

/** Props of BoardView. */
interface BoardViewProps {
  articles: Article[];
  keywordId: string;
  keywordName: string;
  includeOld?: boolean;
  onToggleOld?: () => void;
}

/**
 * Board grid view (Phase9): groups articles by board category for a keyword,
 * shows an action-oriented empty state when there is nothing, hides empty
 * boards, and renders a full-width "today overview" strip below the grid.
 * T0/T1/T2 cards carry a tier color bar on their left border.
 */
export default function BoardView({ articles, keywordId, keywordName, includeOld, onToggleOld }: BoardViewProps) {
  const isMU = keywordId === MU_KEYWORD_ID;
  const isDAL = keywordId === DAL_KEYWORD_ID;
  const boards = isMU ? MU_BOARDS : isDAL ? DAL_BOARDS : GENERIC_BOARDS;

  // Remilia 角色图：只有 MU 板块视图展示，圆形头像 + 柔和阴影，位于标题下方居中
  const showRemilia = isMU;

  const byCategory = (key: string) => articles.filter(a => a.category === key);

  // 兜底：不在任何板块定义内的分类（如 rumour/conflict/academy_women）进「其他」板，避免静默丢弃
  const unmatched = articles.filter(
    a => a.category && !boards.some(b => b.key === a.category) && a.category !== 'other'
  );

  // 今日概览统计
  const highCount = articles.filter(a => a.confidence === 'high').length;
  const conflictCount = articles.filter(a => a.conflict_flag).length;

  // 空态：无任何相关文章 → 行动导向面板（非白卡占位）
  if (articles.length === 0) {
    return (
      <div>
        <div className="mb-4">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-bold text-slate-800">{keywordName}</h2>
            {isMU && (
              <img
                src="/remilia.png"
                alt="remilia"
                className="w-16 h-16 object-cover rounded-xl border border-slate-200 shadow-sm"
              />
            )}
          </div>
          <p className="text-xs text-slate-400">白名单信源 · AI 评分 · Tier 可信度分级</p>
        </div>
        <div className="bg-white rounded-2xl border border-dashed border-slate-300 py-16 px-6 text-center">
          <div className="font-display text-4xl mb-3">🗞️</div>
          <h3 className="font-display text-lg font-bold text-slate-700 mb-1.5">
            {includeOld ? '暂无相关新闻' : '近 30 天暂无相关新闻'}
          </h3>
          <p className="text-sm text-slate-500 mb-5">
            {includeOld
              ? '白名单信源还没有抓到任何相关的文章。'
              : '白名单信源这段时间没有抓到足够相关的文章，看看更早的旧闻？'}
          </p>
          {!includeOld && onToggleOld && (
            <button
              onClick={onToggleOld}
              className="inline-flex items-center px-4 py-2 rounded-lg bg-blue-700 text-white text-sm font-medium hover:bg-blue-800 transition-colors"
            >
              查看历史旧闻
            </button>
          )}
        </div>
      </div>
    );
  }

  // 只渲染有内容的板块（结构性消灭空白：空板块不再占位成白卡）
  const boardsWithItems = boards.filter(b => byCategory(b.key).length > 0);

  return (
    <div>
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-bold text-slate-800">{keywordName}</h2>
          <p className="text-xs text-slate-400">白名单信源 · AI 评分 · Tier 可信度分级</p>
        </div>
        {includeOld != null && onToggleOld && (
          <label className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs text-slate-500 cursor-pointer select-none hover:text-blue-700 transition-colors bg-white border border-blue-100">
            <input
              type="checkbox"
              checked={includeOld}
              onChange={onToggleOld}
              className="w-3.5 h-3.5 accent-blue-700 cursor-pointer"
            />
            显示旧闻
          </label>
        )}
      </div>

      {showRemilia && (
        <div className="flex justify-center mb-3">
          <img
            src="/remilia.png"
            alt="remilia"
            className="w-48 h-48 object-cover rounded-full border-2 border-white shadow-md"
          />
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 items-start">
        {boardsWithItems.map(board => {
          const items = byCategory(board.key);
          return (
            <section
              key={board.key}
              className={cn(
                'bg-white rounded-xl p-4 shadow-sm border self-start',
                board.official ? 'border-red-200' : 'border-slate-200'
              )}
            >
              <div className="flex items-center gap-2 mb-3">
                <span className="text-base">{board.emoji}</span>
                <h3 className="text-sm font-bold text-slate-800">{board.label}</h3>
                {board.official && (
                  <span className="text-[10px] bg-red-500 text-white rounded-full px-2 py-0.5 font-bold">置顶 Tier0</span>
                )}
                <span className="ml-auto inline-flex items-center text-[11px] text-slate-400 font-semibold bg-slate-50 border border-slate-200 rounded-full px-2 py-0.5">
                  {items.length} 条
                </span>
              </div>
              {items.slice(0, 4).map(a => <ArticleCard key={a.id} article={a} />)}
            </section>
          );
        })}

        {/* 兜底「其他」板：未匹配到任何板块定义的分类 */}
        {unmatched.length > 0 && (
          <section className="bg-white rounded-xl p-4 shadow-sm border border-slate-200 self-start">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-base">📄</span>
              <h3 className="text-sm font-bold text-slate-800">其他</h3>
              <span className="ml-auto inline-flex items-center text-[11px] text-slate-400 font-semibold bg-slate-50 border border-slate-200 rounded-full px-2 py-0.5">
                {unmatched.length} 条
              </span>
            </div>
            {unmatched.slice(0, 4).map(a => <ArticleCard key={a.id} article={a} />)}
          </section>
        )}

      </div>

      {/* 今日概览：全宽底带（放网格外，避免尾行右侧留白） */}
      <section className="mt-4 bg-white rounded-xl p-4 shadow-sm border border-slate-200">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-base">📊</span>
          <h3 className="text-sm font-bold text-slate-800">今日概览</h3>
        </div>
        <div className="flex gap-2">
          <div className="flex-1 bg-[#fafbfc] rounded-lg p-3 text-center border border-slate-100">
            <div className="font-display text-xl font-extrabold text-slate-800">{articles.length}</div>
            <div className="text-[10px] text-slate-400 mt-0.5">相关文章</div>
          </div>
          <div className="flex-1 bg-[#fafbfc] rounded-lg p-3 text-center border border-slate-100">
            <div className="font-display text-xl font-extrabold text-blue-600">{highCount}</div>
            <div className="text-[10px] text-slate-400 mt-0.5">高置信</div>
          </div>
          <div className="flex-1 bg-[#fafbfc] rounded-lg p-3 text-center border border-slate-100">
            <div className="font-display text-xl font-extrabold text-red-500">{conflictCount}</div>
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
  );
}
