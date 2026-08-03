// 解析日期字符串，非法/空输入返回 null（两个格式化函数共用）
function parseDate(dateStr: string | null | undefined): Date | null {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  return isNaN(date.getTime()) ? null : date;
}

// 注：client 已引入 date-fns，如需替换请先对齐输出文案（如 '5 分钟前'/'刚刚'），避免 UI 文本漂移。
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
