"use client";

import { useEffect, useMemo, useState } from "react";
import { Settings, Check, AlertTriangle, Tv } from "lucide-react";
import type { ConsoleState, Freshness } from "@/lib/types";
import { Card, FreshnessChip } from "@/components/ui";
import { fmtClock, fmtAgo, t } from "@/lib/utils";

const DEFAULT_CAM_URL = process.env.NEXT_PUBLIC_CAM_URL || "";

type RenderMode = "iframe" | "direct" | "proxy" | "snapshot";

export function CameraPanel({ state, simulated }: { state: ConsoleState; simulated: boolean }) {
  const now = state.now;
  const frame = state.sensors.camera;
  const det = state.latestDetection;
  const detRecent = det && now - det.ts < 60_000 ? det : null;
  const camAge = frame?.hasFrame ? now - frame.ts : null;

  const [camUrl, setCamUrl] = useState<string>(DEFAULT_CAM_URL);
  const [editingUrl, setEditingUrl] = useState(false);
  const [inputUrl, setInputUrl] = useState("");
  const [mode, setMode] = useState<RenderMode>("iframe");
  const [streamError, setStreamError] = useState(false);
  const [snapTick, setSnapTick] = useState(0);

  useEffect(() => {
    const saved = localStorage.getItem("paws-cam-url");
    const savedMode = localStorage.getItem("paws-cam-mode") as RenderMode | null;
    if (saved) setCamUrl(saved);
    else if (DEFAULT_CAM_URL) setCamUrl(DEFAULT_CAM_URL);
    if (savedMode === "iframe" || savedMode === "direct" || savedMode === "proxy" || savedMode === "snapshot") {
      setMode(savedMode);
    }
  }, []);

  useEffect(() => {
    if (mode !== "snapshot" || !camUrl) return;
    const interval = setInterval(() => {
      setSnapTick((t) => t + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [mode, camUrl]);

  const streaming = Boolean(camUrl);

  const snapshotUrl = useMemo(() => {
    if (!camUrl) return "";
    let base = camUrl;
    if (base.endsWith("/stream")) {
      base = base.replace(/\/stream$/, "/capture");
    }
    const sep = base.includes("?") ? "&" : "?";
    return `${base}${sep}_t=${snapTick}`;
  }, [camUrl, snapTick]);

  const activeSrc = useMemo(() => {
    if (!camUrl) return "";
    if (mode === "snapshot") return snapshotUrl;
    if (mode === "proxy") return `/api/camera-proxy?url=${encodeURIComponent(camUrl)}`;
    return camUrl;
  }, [camUrl, mode, snapshotUrl]);

  const status: Freshness = useMemo(() => {
    if (streamError) return "offline";
    if (streaming) return "live";
    if (!frame?.hasFrame) return "offline";
    if (simulated) return "simulated";
    if (camAge !== null && camAge > 6000) return "stale";
    return "live";
  }, [frame, camAge, simulated, streaming, streamError]);

  function handleSaveUrl() {
    const trimmed = inputUrl.trim();
    setCamUrl(trimmed);
    localStorage.setItem("paws-cam-url", trimmed);
    localStorage.setItem("paws-cam-mode", mode);
    setEditingUrl(false);
    setStreamError(false);
  }

  return (
    <Card
      title="PAWS-01 CAM — IR NIGHT MODE"
      sub={
        streaming
          ? `ESP32-CAM (${mode.toUpperCase()} MODE) · YOLO overlay`
          : "850nm IR Night Vision Feed · Realtime YOLO Classification"
      }
      right={
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => {
              setInputUrl(camUrl);
              setEditingUrl(!editingUrl);
            }}
            className="rounded p-1 text-text-faint hover:bg-surface-2 hover:text-text-primary transition-colors"
            title="Configure Camera Stream / Snapshots"
          >
            <Settings size={14} />
          </button>
          <FreshnessChip f={status} heardAt={frame?.ts} />
        </div>
      }
      pad={false}
      className="flex h-full flex-col shadow-sm"
      bodyClass="flex min-h-0 flex-1 flex-col"
    >
      <div className="relative min-h-0 flex-1 w-full overflow-hidden bg-black flex flex-col justify-between">
        {editingUrl ? (
          <div className="flex h-full w-full flex-col items-center justify-center p-4 text-center bg-surface overflow-y-auto z-20">
            <h4 className="mb-1.5 text-[12px] font-bold uppercase tracking-wider text-accent">ESP32-CAM Stream Settings</h4>
            <p className="mb-2 text-[10.5px] text-text-muted">
              Stream URL (e.g. <code className="text-accent">http://10.107.67.208:81/stream</code>)
            </p>
            <input
              type="text"
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
              placeholder="http://10.107.67.208:81/stream"
              className="mb-3 w-full rounded border border-border bg-bg px-3 py-1 text-[11.5px] text-text-primary outline-none focus:border-accent"
            />
            
            <div className="mb-3 flex w-full flex-col gap-1 text-left">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-text-faint">Mode Selector</span>
              <div className="grid grid-cols-4 gap-1">
                {(["iframe", "direct", "proxy", "snapshot"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    className={`rounded py-1 text-[9.5px] font-bold uppercase border ${mode === m ? "border-accent bg-accent/20 text-accent" : "border-border text-text-muted"}`}
                  >
                    {m === "iframe" ? "iFrame" : m === "direct" ? "Direct" : m === "proxy" ? "Proxy" : "Snap 1s"}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={handleSaveUrl}
                className="flex items-center gap-1 rounded bg-accent px-3 py-1 text-[11px] font-bold text-slate-950"
              >
                <Check size={12} /> Save Settings
              </button>
              <button
                onClick={() => setEditingUrl(false)}
                className="rounded border border-border px-3 py-1 text-[11px] text-text-muted"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : streaming ? (
          /* live hardware stream player */
          <div className="relative h-full w-full flex items-center justify-center bg-slate-950 overflow-hidden">
            {mode === "iframe" ? (
              <iframe src={camUrl} title="ESP32-CAM stream" className="h-full w-full border-0 bg-black overflow-hidden" />
            ) : (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={activeSrc}
                alt="PAWS camera feed"
                className="h-full w-full object-contain"
                onLoad={() => setStreamError(false)}
                onError={() => setStreamError(true)}
              />
            )}
          </div>
        ) : (
          /* High-Definition IR Night Mode Disaster Scene Overlay */
          <div className="relative h-full w-full bg-slate-950 overflow-hidden flex flex-col justify-between p-2 select-none">
            {/* Background IR Night Mode Rubble Visual Simulation */}
            <svg viewBox="0 0 600 350" className="absolute inset-0 h-full w-full object-cover opacity-90">
              <defs>
                <radialGradient id="irVignette" cx="50%" cy="50%" r="60%">
                  <stop offset="60%" stopColor="#4a5568" stopOpacity="0.4" />
                  <stop offset="100%" stopColor="#000000" stopOpacity="0.95" />
                </radialGradient>
                <linearGradient id="rubbleGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#2d3748" />
                  <stop offset="100%" stopColor="#1a202c" />
                </linearGradient>
              </defs>
              <rect width="600" height="350" fill="#0f172a" />
              {/* Concrete Rubble Blocks */}
              <polygon points="40,320 180,180 260,210 120,340" fill="#334155" />
              <polygon points="170,180 380,110 420,150 210,220" fill="#475569" />
              <polygon points="360,120 540,240 480,330 290,200" fill="#1e293b" />
              {/* Victim Outline Silhouette in Rubble */}
              <circle cx="280" cy="210" r="18" fill="#64748b" />
              <path d="M250,250 C260,225 300,225 310,250 L320,290 L240,290 Z" fill="#475569" />
              {/* IR Vignette Spotlight */}
              <rect width="600" height="350" fill="url(#irVignette)" />
            </svg>

            {/* Bottom status strip — read-only (no lamp controls on the console) */}
            <div className="relative z-10 flex items-center justify-end border-t border-slate-800/80 bg-slate-950/90 p-1.5 backdrop-blur-md rounded-b">
              <div className="text-[10px] font-mono text-emerald-400 font-bold hidden sm:block">
                ● LIVE SYNC
              </div>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
