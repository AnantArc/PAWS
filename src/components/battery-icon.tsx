import { cn } from "@/lib/utils";

/** Battery color thresholds (shared by header + system panel): >60% green, 25–60% yellow, <25% red. */
export function batteryTone(pct: number): string {
  return pct > 60 ? "text-ok" : pct > 25 ? "text-warn" : "text-critical";
}

export function batteryBarCls(pct: number): string {
  return pct > 60 ? "bg-ok" : pct > 25 ? "bg-warn" : "bg-critical";
}

/** Battery glyph whose fill level tracks `pct` and whose color follows batteryTone(). */
export function BatteryIcon({ pct, className }: { pct: number; className?: string }) {
  const fill = Math.max(0, Math.min(100, pct));
  return (
    <span
      className={cn("inline-flex shrink-0 items-center", batteryTone(pct), className)}
      role="img"
      aria-label={`Battery ${Math.round(pct)}%`}
    >
      <svg viewBox="0 0 28 14" className="h-[14px] w-[28px]">
        <rect x="1" y="1.5" width="22" height="11" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <rect x="24.5" y="5" width="2.5" height="4" rx="1" fill="currentColor" />
        <rect x="3" y="3.5" width={(18 * fill) / 100} height="7" rx="1.2" fill="currentColor" />
      </svg>
    </span>
  );
}
