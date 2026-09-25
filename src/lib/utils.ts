import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function uid(prefix = "id"): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function fmtClock(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function fmtAgo(ts: number, now: number): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s} s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  return `${Math.floor(m / 60)} h ${m % 60} min ago`;
}

export function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(sec)}`;
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** Recency half-life decay: 1.0 now -> 0.5 after `halfLifeMs`. */
export function recency(ageMs: number, halfLifeMs: number): number {
  return Math.pow(0.5, ageMs / halfLifeMs);
}

/**
 * Survivor-likelihood bands. The "high" threshold is 0.70 so the badge agrees
 * with the operator rule shown on the card: expect a human above 70 %.
 */
export function levelFromScore(v: number): "none" | "low" | "moderate" | "high" {
  if (v <= 0.02) return "none";
  if (v < 0.35) return "low";
  if (v < 0.7) return "moderate";
  return "high";
}

export function hazardLevel(v: number): "clear" | "elevated" | "severe" {
  if (v < 0.35) return "clear";
  if (v < 0.7) return "elevated";
  return "severe";
}

export function accessibilityLevel(v: number): "mobile" | "constrained" | "blocked" {
  if (v > 0.7) return "mobile";
  if (v > 0.4) return "constrained";
  return "blocked";
}

/**
 * Design tokens are stored as space-separated RGB triplets
 * (`--accent: 34 211 238`) so Tailwind can apply alpha via
 * `rgb(var(--accent) / 0.5)`. Raw SVG attributes and inline styles
 * therefore need the rgb() wrapper — this helper is that wrapper.
 */
export function t(name: string): string {
  return `rgb(var(--${name}))`;
}
