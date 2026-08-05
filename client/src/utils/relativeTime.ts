// 解析日期字符串，非法/空输入返回 null（两个格式化函数共用）
function parseDate(dateStr: string | null | undefined): Date | null {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  return isNaN(date.getTime()) ? null : date;
}

// 注：client 已引入 date-fns，如需替换请先对齐输出文案（如 '5 分钟前'/'刚刚'），避免 UI 文本漂移。
/**
 * Relative time label in Chinese ("刚刚" / "X 分钟前" / "X 天前" / ...).
 * Returns '' for null/undefined/unparseable dates.
 * @param dateStr - ISO date string.
 * @returns Relative label, or ''.
 */
export function relativeTime(dateStr: string | null | undefined): string {
  const date = parseDate(dateStr);
  if (!date) return '';
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 0) return '刚刚';
  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);
  if (seconds < 60) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  if (hours < 24) return `${hours} 小时前`;
  if (days < 30) return `${days} 天前`;
  if (months < 12) return `${months} 个月前`;
  return `${years} 年前`;
}

/**
 * Format a date as an absolute Chinese date-time string ("YYYY/MM/DD HH:mm").
 * Returns '' for null/undefined/unparseable dates.
 * @param dateStr - ISO date string.
 * @returns Formatted string, or ''.
 */
export function formatDateTime(dateStr: string | null | undefined): string {
  const date = parseDate(dateStr);
  if (!date) return '';
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// 30 天内的相对时间阈值（与 useArticles 的 recency 窗口保持一致）
const RECENT_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Article-card date label:
 * - published_at within 30 days  → relativeTime ("X 分钟前" / "X 小时前" / "X 天前")
 * - published_at older than 30 days → formatDateTime (absolute date)
 * - published_at null → 「发现于 {relativeTime(created_at)}」
 * @param publishedAt - Article publish date (may be null).
 * @param createdAt - Article discovery date (fallback when publish date is null).
 * @returns Display label.
 */
export function formatArticleDate(publishedAt: string | null | undefined, createdAt: string | null | undefined): string {
  const published = parseDate(publishedAt);
  if (published) {
    return Date.now() - published.getTime() <= RECENT_MS
      ? relativeTime(publishedAt)
      : formatDateTime(publishedAt);
  }
  return createdAt ? `发现于 ${relativeTime(createdAt)}` : '';
}
