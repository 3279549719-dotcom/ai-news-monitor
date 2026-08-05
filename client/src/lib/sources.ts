import type { SourceConfig } from '../types';

/**
 * Source display config (label + color). FilterSortBar's filter options are
 * derived from this table to avoid two drifting lists.
 */
export const SOURCE_CONFIG: Record<string, SourceConfig> = {
  blog: { label: 'Blog', color: 'bg-violet-100 text-violet-700' },
  hackernews: { label: 'HackerNews', color: 'bg-orange-100 text-orange-700' },
};

/** Filter options derived from SOURCE_CONFIG ({value, label} pairs). */
export const SOURCE_OPTIONS = Object.entries(SOURCE_CONFIG).map(([value, cfg]) => ({
  value,
  label: cfg.label,
}));
