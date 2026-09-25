"use client";

import { useMemo, useRef, useState } from "react";
import type { Detection, PositionReading, TrailPoint } from "@/lib/types";
import { cn, t } from "@/lib/utils";

const VIEW_W = 720;
const VIEW_H = 460;

function hexLerp(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  const c = pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/** Survivor likelihood heat (0 → 1) */
export function scoreColor(v: number): string {
  if (v < 0.05) return t("border");
  if (v < 0.35) return hexLerp("#64748b", "#fbbf24", (v - 0.05) / 0.3);
  if (v < 0.65) return hexLerp("#fbbf24", "#f97316", (v - 0.35) / 0.3);
  return hexLerp("#f97316", "#ef4444", (v - 0.65) / 0.35);
}

/** Gas colour scale (ppm 0 → 1200+) */
export function gasColor(ppm: number): string {
  const p = Math.min(1, Math.max(0, ppm / 1200));
  if (p < 0.2) return hexLerp("#34d399", "#a3e635", p / 0.2);
  if (p < 0.4) return hexLerp("#a3e635", "#fbbf24", (p - 0.2) / 0.2);
  if (p < 0.66) return hexLerp("#fbbf24", "#f97316", (p - 0.4) / 0.26);
  return hexLerp("#f97316", "#ef4444", (p - 0.66) / 0.34);
}

export function RobotMap({
  trail,
  detections,
  position,
  mode = "score",
  mark,
  onMark,
  className,
  interactive = false,
  rebase = { xM: 0, yM: 0 },
}: {
  trail: TrailPoint[];
  detections: Detection[];
  position?: PositionReading | null;
  mode?: "score" | "gas";
  mark?: { xM: number; yM: number } | null;
  onMark?: (x: number, y: number) => void;
  className?: string;
  interactive?: boolean;
  /** Display rebase: every point is rendered as (value − rebase). */
  rebase?: { xM: number; yM: number };
}) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; panX: number; panY: number; moved: boolean } | null>(null);

  const { pts, dets } = useMemo(() => {
    const withPos = detections.filter((d) => d.position);
    const all = [
      ...trail.map((t) => ({ x: t.xM, y: t.yM })),
      ...withPos.map((d) => ({ x: d.position!.xM, y: d.position!.yM })),
      { x: 0, y: 0 },
      ...(mark ? [{ x: mark.xM, y: mark.yM }] : []),
      ...(position ? [{ x: position.xM, y: position.yM }] : []),
    ];
    const xs = all.map((p) => p.x);
    const ys = all.map((p) => p.y);
    const minX = Math.min(...xs) - 1.2;
    const maxX = Math.max(...xs) + 1.2;
    const minY = Math.min(...ys) - 1.2;
    const maxY = Math.max(...ys) + 1.2;
    const spanX = Math.max(maxX - minX, 2);
    const spanY = Math.max(maxY - minY, 2);
    return { pts: { minX, minY, spanX, spanY }, dets: withPos };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trail, detections, position, mark]);

  const pxPerM = Math.min((VIEW_W - 40) / pts.spanX, (VIEW_H - 40) / pts.spanY) * zoom;
  const baseOffsetX = (VIEW_W - pts.spanX * pxPerM) / 2 - pts.minX * pxPerM;
  const baseOffsetY = (VIEW_H - pts.spanY * pxPerM) / 2 - pts.minY * pxPerM;
  const offsetX = baseOffsetX + pan.x;
  const offsetY = baseOffsetY + pan.y;
  /** Everything drawn in DISPLAY coordinates: device value − rebase. */
  const toView = (x: number, y: number) => ({ x: offsetX + (x - rebase.xM) * pxPerM, y: offsetY + (y - rebase.yM) * pxPerM });

  const gridStep = pxPerM >= 26 ? 1 : pxPerM >= 13 ? 2 : 5;
  const gridLines = useMemo(() => {
    const lines: Array<{ x1: number; y1: number; x2: number; y2: number; label: string }> = [];
    const x0 = Math.floor(pts.minX / gridStep) * gridStep;
    const y0 = Math.floor(pts.minY / gridStep) * gridStep;
    for (let x = x0; x <= pts.minX + pts.spanX + gridStep; x += gridStep) {
      const a = toView(x, 0);
      const b = toView(x, 10);
      lines.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, label: `${x - rebase.xM}` });
    }
    for (let y = y0; y <= pts.minY + pts.spanY + gridStep; y += gridStep) {
      const a = toView(0, y);
      const b = toView(10, y);
      lines.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, label: `${y - rebase.yM}` });
    }
    return lines;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pts.minX, pts.minY, pts.spanX, pts.spanY, pxPerM, gridStep, pan, zoom, rebase]);

  // trail segments coloured by value
  const segments = useMemo(() => {
    const segs: Array<{ x1: number; y1: number; x2: number; y2: number; stroke: string }> = [];
    for (let i = 0; i < trail.length - 1; i++) {
      const a = toView(trail[i].xM, trail[i].yM);
      const b = toView(trail[i + 1].xM, trail[i + 1].yM);
      const v = mode === "score" ? trail[i + 1].score : trail[i + 1].gasPpm;
      segs.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: mode === "score" ? scoreColor(v) : gasColor(v) });
    }
    return segs;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trail, pxPerM, offsetX, offsetY, mode, pan, zoom, rebase]);

  // origin marker: the anchor sits at display (0, 0) — i.e. on the robot
  // the moment the operator re-anchors. Robot coordinates read (0, 0) there.
  const origin = toView(rebase.xM, rebase.yM);
  const robot = position ? toView(position.xM, position.yM) : null;

  // ------------------------------------------------ drag to pan / tap to mark
  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!svgRef.current) return;
    svgRef.current.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!drag.current || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const dx = ((e.clientX - drag.current.x) / rect.width) * VIEW_W;
    const dy = ((e.clientY - drag.current.y) / rect.height) * VIEW_H;
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.current.moved = true;
    setPan({ x: drag.current.panX + dx, y: drag.current.panY + dy });
  };
  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.moved || !interactive || !onMark || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const vx = ((e.clientX - rect.left) / rect.width) * VIEW_W;
    const vy = ((e.clientY - rect.top) / rect.height) * VIEW_H;
    // convert click → DEVICE coordinates (display = device − rebase)
    const devX = (vx - offsetX) / pxPerM + rebase.xM;
    const devY = (vy - offsetY) / pxPerM + rebase.yM;
    onMark(devX, devY);
  };

  return (
    <div className={cn("relative h-full min-h-[300px] w-full", className)}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="xMidYMid meet"
        className="h-full w-full cursor-grab touch-none rounded-md bg-bg/60 active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (drag.current = null)}
        style={interactive ? undefined : undefined}
      >
        {/* grid */}
        {gridLines.map((l, i) => (
          <g key={i}>
            <line x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke={t("border")} strokeWidth="0.5" opacity="0.55" />
          </g>
        ))}
        {/* axis labels */}
        {gridLines.map((l, i) => (
          <text key={`t${i}`} x={l.x1 + 3} y={l.y1 + 12} fontSize="9" fill={t("text-faint")} className="tnum">
            {l.label} m
          </text>
        ))}

        {/* origin — moves to the robot when re-anchored (display 0,0) */}
        <g>
          <circle cx={origin.x} cy={origin.y} r="7" fill="none" stroke={t("accent")} strokeWidth="1.4" />
          <line x1={origin.x - 12} y1={origin.y} x2={origin.x + 12} y2={origin.y} stroke={t("accent")} strokeWidth="1" opacity="0.6" />
          <line x1={origin.x} y1={origin.y - 12} x2={origin.x} y2={origin.y + 12} stroke={t("accent")} strokeWidth="1" opacity="0.6" />
          <text x={origin.x + 14} y={origin.y - 10} fontSize="10" fontWeight="600" fill={t("accent")}>
            ORIGIN (0,0)
          </text>
        </g>

        {/* heat trail */}
        <g className={trail.length > 8 ? "trail-glow" : undefined}>
          {segments.map((s, i) => (
            <line
              key={i}
              x1={s.x1}
              y1={s.y1}
              x2={s.x2}
              y2={s.y2}
              stroke={s.stroke}
              strokeWidth="2.6"
              strokeLinecap="round"
              opacity="0.95"
            />
          ))}
        </g>

        {/* survivor pins */}
        {dets.map((d, i) => {
          const p = toView(d.position!.xM, d.position!.yM);
          const latest = i === 0;
          return (
            <g key={d.id} transform={`translate(${p.x},${p.y})`}>
              <circle
                r={latest ? 14 : 9}
                fill={t("status-critical")}
                opacity="0.15"
                className={latest ? "animate-pulse-ring origin-center" : undefined}
              />
              <circle r="6.5" fill={t("status-critical")} stroke="#fff" strokeWidth="1.2" />
              <text y="-12" textAnchor="middle" fontSize="9.5" fontWeight="700" fill={t("status-critical")} className="tnum">
                {Math.round(d.confidence * 100)}%
              </text>
              {latest && (
                <text y="22" textAnchor="middle" fontSize="9" fill={t("text-muted")}>
                  LATEST
                </text>
              )}
            </g>
          );
        })}

        {/* rescuer mark (field view) */}
        {mark && (
          <g transform={`translate(${toView(mark.xM, mark.yM).x},${toView(mark.xM, mark.yM).y})`}>
            <circle r="7" fill={t("status-info")} stroke="#fff" strokeWidth="1.4" />
            <text y="-12" textAnchor="middle" fontSize="9" fontWeight="700" fill={t("status-info")}>
              YOU
            </text>
          </g>
        )}

        {/* robot — THE REAL PAWS BADGE, upright, no arrow (per spec) */}
        {robot && position && (
          <g transform={`translate(${robot.x},${robot.y})`}>
            {/* drift halo — honest uncertainty, grows with the mission */}
            {position.driftM > 0.3 && (
              <circle
                r={position.driftM * pxPerM}
                fill="none"
                stroke={t("status-warn")}
                strokeWidth="1"
                strokeDasharray="4 4"
                opacity="0.5"
              />
            )}
            <circle r="15" fill="rgb(10 15 26 / 0.55)" />
            {/* highlighted ring so the badge pops on dark AND light maps */}
            <circle r="16" fill="none" stroke={t("accent")} strokeWidth="1.6" opacity="0.9" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <image
              href="/logo.png"
              x="-12"
              y="-12"
              width="24"
              height="24"
              className="rounded-full"
              style={{ filter: "drop-shadow(0 0 5px rgba(34, 211, 238, 0.85))" }}
            />
            <text y="28" textAnchor="middle" fontSize="9" fontWeight="700" fill={t("text-muted")} className="tnum">
              {Math.round(position.headingDeg)}°
            </text>
          </g>
        )}
      </svg>

      {/* zoom + reset pan controls */}
      <div className="absolute right-2 top-2 flex flex-col gap-1">
        {[1.35, 0.75].map((f, i) => (
          <button
            key={i}
            onClick={() => setZoom((z) => Math.min(3.5, Math.max(0.7, z * f)))}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-surface text-[13px] font-bold text-text-muted hover:text-accent"
            aria-label={f > 1 ? "Zoom in" : "Zoom out"}
          >
            {f > 1 ? "+" : "−"}
          </button>
        ))}
        <button
          onClick={() => {
            setPan({ x: 0, y: 0 });
            setZoom(1);
          }}
          className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-surface text-[11px] font-bold text-text-muted hover:text-accent"
          aria-label="Reset view"
          title="Reset view"
        >
          ⟲
        </button>
      </div>

      {/* scale bar */}
      <div className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded bg-bg/70 px-2 py-1 backdrop-blur-sm">
        <div className="h-0.5 border-b border-t border-text-muted" style={{ width: Math.max(8, 1 * pxPerM) }} />
        <span className="tnum text-[10px] text-text-muted">1 m</span>
      </div>

      {/* legend */}
      <div className="absolute bottom-2 right-2 rounded bg-bg/70 px-2 py-1.5 backdrop-blur-sm">
        <div className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-text-faint">
          {mode === "score" ? "Survivor likelihood" : "Gas concentration"}
        </div>
        <div className="flex items-center gap-1.5">
          <div
            className="h-1.5 w-24 rounded-full"
            style={{
              background:
                mode === "score"
                  ? "linear-gradient(90deg,#64748b,#fbbf24,#f97316,#ef4444)"
                  : "linear-gradient(90deg,#34d399,#fbbf24,#f97316,#ef4444)",
            }}
          />
          <span className="tnum text-[9px] text-text-muted">{mode === "score" ? "0 → 1" : "0 → 1200+ ppm"}</span>
        </div>
      </div>

      {interactive && (
        <div className="absolute left-2 top-2 rounded bg-info/15 px-2 py-1 text-[10px] font-medium text-info">
          Drag to pan · tap the map to mark where you are standing
        </div>
      )}
    </div>
  );
}
