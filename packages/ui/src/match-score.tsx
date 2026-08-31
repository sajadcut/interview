export function MatchScore({ value, label = "Match" }: { value: number; label?: string }) {
  const safeValue = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className="inline-flex items-baseline gap-2" aria-label={`${label}: ${safeValue}%`}>
      <span className="text-2xl font-bold tabular-nums">{safeValue}%</span>
      <span className="text-xs text-[var(--muted)]">{label}</span>
    </div>
  );
}
