// 信源展示配置（标签 + 配色）。FilterSortBar 的过滤选项由此派生，避免两份清单漂移。
export const SOURCE_CONFIG: Record<string, { label: string; color: string }> = {
  blog: { label: 'Blog', color: 'bg-violet-100 text-violet-700' },
  hackernews: { label: 'HackerNews', color: 'bg-orange-100 text-orange-700' },
};

export const SOURCE_OPTIONS = Object.entries(SOURCE_CONFIG).map(([value, cfg]) => ({
  value,
  label: cfg.label,
}));
