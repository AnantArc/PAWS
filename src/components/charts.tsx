"use client";

import { useId } from "react";
import { t } from "@/lib/utils";

/** Lightweight hand-rolled SVG charts — no external chart lib, precise look. */

export function Sparkline({
  data,
  width = 220,
  height = 56,
  color = t("accent"),
  fill = true,
  baseline,
  events,
}: {
  data: Array<number | null>;
  width?: number;
  height?: number;
  color?: string;
  fill?: boolean;
  baseline?: number;
  events?: Array<{ index: number; color?: string }>;
}) {
  const id = useId();
  const vals = data.filter((d): d is number => d !== null);
  if (vals.length < 2) {
    return (
      <div className="flex items-center justify-center text-[10px] text-text-faint" style={{ height }}>
        collecting…
      </div>
    );
  }
  const min = Math.min(...vals, 0);
  const max = Math.max(...vals, 1);
  const span = max - min || 1;
  const N = Math.max(data.length - 1, 1);

  const pts = data.map((d, i) => {
    const x = (i / N) * width;
    const y = d === null ? height : height - ((d - min) / span) * (height - 6) - 3;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const path = `M${pts.join(" L")}`;
  const area = `${path} L${width},${height} L0,${height} Z`;
  const baseY = baseline !== undefined ? height - ((baseline - min) / span) * (height - 6) - 3 : null;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ height }} preserveAspectRatio="none">
      <defs>
        {fill && (
          <linearGradient id={`g${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        )}
      </defs>
      {baseY !== null && (
        <line x1="0" y1={baseY} x2={width} y2={baseY} stroke={t("border")} strokeDasharray="3 3" strokeWidth="1" />
      )}
      {fill && <path d={area} fill={`url(#g${id})`} />}
      <path d={path} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" />
      {events?.map((e, i) => (
        <line
          key={i}
          x1={(e.index / N) * width}
          x2={(e.index / N) * width}
          y1={6}
          y2={height - 6}
          stroke={e.color ?? t("status-critical")}
          strokeWidth="1"
          strokeDasharray="2 2"
          opacity="0.8"
        />
      ))}
    </svg>
  );
}

export function Gauge({
  value,
  min = -20,
  max = 80,
  label,
  unit = "°C",
  showValue = true,
}: {
  value: number;
  min?: number;
  max?: number;
  label?: string;
  unit?: string;
  showValue?: boolean;
}) {
  const id = useId();
  const norm = Math.min(1, Math.max(0, (value - min) / (max - min)));
  const R = 54;
  const arc = (start: number, end: number, color: string, r: number, opacity = 1) => {
    const a1 = ((start - 90) * Math.PI) / 180;
    const a2 = ((end - 90) * Math.PI) / 180;
    const x1 = 70 + r * Math.cos(a1);
    const y1 = 70 + r * Math.sin(a1);
    const x2 = 70 + r * Math.cos(a2);
    const y2 = 70 + r * Math.sin(a2);
    return (
      <path
        d={`M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`}
        stroke={color}
        strokeWidth="7"
        fill="none"
        strokeLinecap="round"
        opacity={opacity}
      />
    );
  };
  return (
    <div className="flex h-full w-full min-h-0 flex-col items-center justify-center overflow-hidden">
      <svg viewBox="0 0 140 118" preserveAspectRatio="xMidYMid meet" className="max-h-full w-full">
        <defs>
          <linearGradient id={`ga${id}`} x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor={t("accent")} />
            <stop offset="55%" stopColor={t("status-warn")} />
            <stop offset="100%" stopColor={t("status-critical")} />
          </linearGradient>
        </defs>
        {arc(-120, 120, t("border"), R, 0.55)}
        {arc(-120, -120 + norm * 240, `url(#ga${id})`, R)}
        {showValue && (
          <text x="70" y="84" textAnchor="middle" className="tnum" fontSize="30" fontWeight="700" fill={t("text-primary")}>
            {value.toFixed(1)}
          </text>
        )}
        <text x="70" y={showValue ? 102 : 94} textAnchor="middle" fontSize="11" fill={t("text-faint")}>
          {unit}
        </text>
      </svg>
      {label && <div className="mt-1 text-[11px] font-medium uppercase tracking-wider text-text-faint">{label}</div>}
    </div>
  );
}

export function MiniBars({
  data,
  color = t("accent"),
  width = 240,
  height = 46,
}: {
  data: number[];
  color?: string;
  width?: number;
  height?: number;
}) {
  const max = Math.max(...data, 1);
  const slice = data.slice(-40);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ height }} preserveAspectRatio="none">
      {slice.map((d, i) => {
        const h = (d / max) * (height - 4);
        return (
          <rect
            key={i}
            x={(i / slice.length) * width + 1}
            y={height - h}
            width={Math.max(1, width / slice.length - 2)}
            height={h}
            rx="1"
            fill={color}
            opacity="0.85"
          />
        );
      })}
    </svg>
  );
}

export function TrendBar({ value, color }: { value: number; color: string }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded bg-surface-2">
      <div
        className="h-full rounded"
        style={{
          width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`,
          background: color,
          transition: "width 0.6s ease",
        }}
      />
    </div>
  );
}
