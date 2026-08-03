import { cn } from '../lib/utils';

// Tier 徽章统一配色（语义：T0 官方=红 / T1 顶级=琥珀 / T2 主流=蓝 / T3=灰）。
// 列表视图与板块视图共用同一张颜色表，避免两处漂移。
const TIER_COLORS: Record<number, string> = {
  0: 'bg-red-100 text-red-700',
  1: 'bg-amber-100 text-amber-700',
  2: 'bg-blue-100 text-blue-700',
  3: 'bg-slate-200 text-slate-600',
};

export function TierBadge({ tier, className }: { tier?: number | null; className?: string }) {
  if (tier == null) return null;
  return (
    <span
      className={cn(
        'rounded px-1.5 py-0.5 font-semibold text-[11px]',
        TIER_COLORS[tier] ?? 'bg-slate-100 text-slate-500',
        className
      )}
    >
      {`T${tier}`}
    </span>
  );
}

// 置信度徽章（交叉验证输出）。文案与后端 crosscheck.js 的 CONFIDENCE_LABEL 保持一致。
const CONFIDENCE_CONFIG: Record<string, { label: string; cls: string }> = {
  high: { label: '高置信', cls: 'bg-green-50 text-green-700 border-green-200' },
  medium: { label: '待核实', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  low: { label: '存疑', cls: 'bg-red-50 text-red-600 border-red-200' },
};

export function ConfidenceBadge({ confidence, className }: { confidence?: string | null; className?: string }) {
  if (!confidence) return null;
  const cfg = CONFIDENCE_CONFIG[confidence];
  if (!cfg) return null;
  return (
    <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold border', cfg.cls, className)}>
      {cfg.label}
    </span>
  );
}
