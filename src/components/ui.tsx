"use client";

import { cn } from "@/lib/utils";
import type { ReactNode, ButtonHTMLAttributes } from "react";
import type { Freshness } from "@/lib/types";

/* ------------------------------------------------------------------ Card */
export function Card({
  className,
  bodyClass,
  title,
  sub,
  right,
  children,
  pad = true,
}: {
  className?: string;
  bodyClass?: string;
  title?: string;
  sub?: string;
  right?: ReactNode;
  children: ReactNode;
  pad?: boolean;
}) {
  return (
    <section className={cn("overflow-hidden rounded-lg border border-border bg-surface", className)}>
      {(title || right) && (
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-x-2 gap-y-1.5 border-b border-border px-4 py-2.5">
          {/* min-w-fit keeps the title full width: if a wide status chip can't fit
              on the same line, the chip wraps to its own row instead of clipping it. */}
          <div className="min-w-fit flex-1">
            {title && (
              <h3 className="text-[12px] font-semibold uppercase tracking-[0.12em] text-text-muted">{title}</h3>
            )}
            {sub && <p className="mt-0.5 text-[11px] text-text-faint">{sub}</p>}
          </div>
          {right && <div className="flex shrink-0 items-center gap-2">{right}</div>}
        </header>
      )}
      <div className={cn(pad && "p-4", bodyClass)}>{children}</div>
    </section>
  );
}

/* ---------------------------------------------------------------- Button */
export function Button({
  className,
  variant = "default",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "primary" | "danger" | "ghost" | "success";
}) {
  const styles = {
    default: "bg-surface-2 text-text-primary border border-border hover:border-accent/50",
    primary: "bg-accent text-slate-950 font-semibold hover:brightness-110",
    danger: "bg-critical/15 text-critical border border-critical/40 hover:bg-critical/25",
    success: "bg-ok/15 text-ok border border-ok/40 hover:bg-ok/25",
    ghost: "bg-transparent text-text-muted hover:text-text-primary hover:bg-surface-2",
  } as const;
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        styles[variant],
        className
      )}
      {...props}
    />
  );
}

/* ------------------------------------------------------------ StatusChip */
const FRESH_LABEL: Record<Freshness, { label: string; cls: string }> = {
  live: { label: "LIVE", cls: "bg-ok/15 text-ok border border-ok/40" },
  delayed: { label: "DELAYED", cls: "bg-warn/15 text-warn border border-warn/40" },
  stale: { label: "STALE", cls: "bg-warn/15 text-warn border border-warn/40" },
  offline: { label: "OFFLINE", cls: "bg-critical/15 text-critical border border-critical/40" },
  not_installed: { label: "NOT INSTALLED", cls: "bg-surface-2 text-text-faint border border-border" },
  simulated: { label: "LIVE", cls: "bg-ok/15 text-ok border border-ok/40" },
};

export function FreshnessChip({ f, heardAt }: { f: Freshness; heardAt?: number }) {
  const c = FRESH_LABEL[f];
  return (
    <span
      className={cn("chip", c.cls)}
      title={heardAt ? `last reading ${new Date(heardAt).toLocaleTimeString()}` : undefined}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          f === "live" && "animate-pulse bg-ok",
          f === "delayed" && "bg-warn",
          f === "stale" && "bg-warn",
          f === "offline" && "bg-critical",
          (f === "not_installed" || f === "simulated") && "bg-current"
        )}
      />
      {c.label}
    </span>
  );
}

/* ------------------------------------------------------------------ Meta */
export function Meta({ label, value, title }: { label: string; value: ReactNode; title?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-text-faint">{label}</div>
      <div className="tnum mt-0.5 truncate text-[13px] font-semibold text-text-primary" title={title}>
        {value}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- KeyValue */
export function KV({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5 text-[12px]">
      <span className="text-text-muted">{k}</span>
      <span className="tnum text-right font-medium text-text-primary">{v}</span>
    </div>
  );
}

/* -------------------------------------------------------------- Badge */
export function LevelBadge({ level }: { level: string }) {
  const map: Record<string, string> = {
    none: "text-text-faint bg-surface-2",
    low: "text-warn bg-warn/10",
    moderate: "text-warn bg-warn/15",
    high: "text-ok bg-ok/15",
    clear: "text-ok bg-ok/10",
    elevated: "text-warn bg-warn/15",
    severe: "text-critical bg-critical/15",
    mobile: "text-ok bg-ok/10",
    constrained: "text-warn bg-warn/15",
    blocked: "text-critical bg-critical/15",
  };
  return (
    <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide", map[level] ?? map.none)}>
      {level}
    </span>
  );
}

/* ------------------------------------------------------------------ Modal */
export function Modal({
  open,
  onClose,
  children,
  title,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  title?: string;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-md animate-risein rounded-xl border border-border bg-surface p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          {title && <h3 className="text-sm font-semibold text-text-primary">{title}</h3>}
          <button onClick={onClose} className="text-text-faint hover:text-text-primary" aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
