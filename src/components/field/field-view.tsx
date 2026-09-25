"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Radio, LocateFixed, Compass } from "lucide-react";
import { RobotMap } from "@/components/map";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme";
import { fmtClock, fmtAgo, cn } from "@/lib/utils";

/**
 * FIELD RESCUE VIEW — the phone screen behind the share QR.
 * Read-only, mobile-first, auto-refreshing. A rescuer marks where they are
 * standing on the map and gets an honest distance + bearing to every
 * reported survivor. No controls, no commands, no fake data.
 */

interface Pin {
  id: string;
  ts: number;
  confidence: number;
  position: { xM: number; yM: number };
}

interface FieldState {
  mission: { name: string; status: string; startedAt: number };
  device: { link: "online" | "delayed" | "offline"; lastSeenAt: number };
  position: { xM: number; yM: number; headingDeg: number; driftM: number } | null;
  gasPpm: number | null;
  pins: Pin[];
  recentEvents: Array<{ id: string; ts: number; kind: string; level: string; text: string }>;
  latestScore: number;
  now: number;
}

export function FieldView({ token }: { token: string }) {
  const [data, setData] = useState<FieldState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mark, setMark] = useState<{ xM: number; yM: number } | null>(null);
  const [newPinIds, setNewPinIds] = useState<Set<string>>(new Set());
  const seenPins = useRef<Set<string> | null>(null);
  const audioRef = useRef<AudioContext | null>(null);

  // Poll (3 s) — small payloads, friendly to phone networks.
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(`/api/field/state?token=${encodeURIComponent(token)}`, { cache: "no-store" });
        const json = await res.json();
        if (!alive) return;
        if (!res.ok) {
          setError(json.error ?? "Link unavailable");
          return;
        }
        setError(null);
        const s = json as FieldState;
        // buzz only on NEW survivor pins after the first load
        if (seenPins.current === null) {
          seenPins.current = new Set(s.pins.map((p) => p.id));
        } else {
          const fresh = s.pins.filter((p) => !seenPins.current!.has(p.id));
          if (fresh.length > 0) {
            fresh.forEach((p) => seenPins.current!.add(p.id));
            setNewPinIds(new Set(fresh.map((p) => p.id)));
            try {
              navigator.vibrate?.(400);
            } catch {
              /* not supported */
            }
            buzz();
          }
        }
        setData(s);
      } catch {
        /* transient network — keep last data */
      }
    };
    load();
    const t = setInterval(load, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [token]);

  function buzz() {
    try {
      const Ctx = window.AudioContext;
      if (!Ctx) return;
      if (!audioRef.current) audioRef.current = new Ctx();
      const ctx = audioRef.current;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.18, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
      osc.start();
      osc.stop(ctx.currentTime + 0.5);
    } catch {
      /* audio not permitted — vibration alone still fires */
    }
  }

  const pinsWithBearing = useMemo(() => {
    if (!data) return [];
    return data.pins.map((p) => {
      if (!mark) return { ...p, distance: null, bearing: null };
      const dx = p.position.xM - mark.xM;
      const dy = p.position.yM - mark.yM;
      const distance = Math.hypot(dx, dy);
      const bearing = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
      return { ...p, distance, bearing };
    });
  }, [data, mark]);

  const linkOk = data?.device.link === "online";

  return (
    <div className="min-h-screen bg-bg pb-24 text-text-primary">
      {/* header */}
      <header className="sticky top-0 z-20 border-b border-border bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-md items-center gap-2.5 px-4 py-3">
          <Logo size={32} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-bold">{data?.mission.name ?? "Field Rescue View"}</div>
            <div className="text-[10.5px] uppercase tracking-wider text-text-faint">READ-ONLY · LIVE MISSION FEED</div>
          </div>
          <span
            className={cn(
              "chip",
              data?.mission.status === "running"
                ? linkOk
                  ? "border border-ok/40 bg-ok/15 text-ok"
                  : "border border-warn/40 bg-warn/15 text-warn"
                : "border border-border bg-surface-2 text-text-faint"
            )}
          >
            {data ? data.mission.status.toUpperCase() : "…"}
          </span>
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto max-w-md space-y-3 p-4">
        {error && (
          <div className="rounded-lg border border-critical/40 bg-critical/10 p-3 text-[12px] text-critical">
            {error} — ask mission control for a fresh link.
          </div>
        )}

        {/* status strip */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <StatusTile label="Robot link" value={data ? (linkOk ? "ONLINE" : "DEGRADED/OFFLINE") : "—"} tone={linkOk ? "ok" : "warn"} />
          <StatusTile
            label="Gas"
            value={data?.gasPpm != null ? `${Math.round(data.gasPpm)} ppm` : "—"}
            tone={data?.gasPpm != null && data.gasPpm >= 800 ? "warn" : "default"}
          />
          <StatusTile
            label="Survivor score"
            value={data ? data.latestScore.toFixed(2) : "—"}
            tone={data && data.latestScore > 0.35 ? "ok" : "default"}
          />
        </div>

        {/* survivor pins — the actionable list */}
        <section className="rounded-xl border border-border bg-surface">
          <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <h2 className="text-[12px] font-bold uppercase tracking-[0.12em] text-text-muted">Survivor reports</h2>
            <span className="tnum text-[11px] text-text-faint">
              {pinsWithBearing.length} pin{pinsWithBearing.length === 1 ? "" : "s"}
            </span>
          </header>
          <div className="divide-y divide-border">
            {pinsWithBearing.length === 0 && (
              <p className="px-4 py-6 text-center text-[12px] text-text-faint">
                No survivor detection reported yet. The feed updates every 3 s — keep this open.
              </p>
            )}
            {pinsWithBearing.map((p) => (
              <div key={p.id} className="flex items-center gap-3 px-4 py-3">
                <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-critical/15">
                  <Compass size={18} className="text-critical" />
                  {newPinIds.has(p.id) && (
                    <span className="absolute -right-0.5 -top-0.5 h-3 w-3 animate-ping rounded-full bg-critical" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="tnum text-[14px] font-bold">
                    ({p.position.xM.toFixed(1)}, {p.position.yM.toFixed(1)}) m{" "}
                    <span className="text-[10px] font-medium text-text-faint">from origin</span>
                  </div>
                  <div className="text-[11px] text-text-muted">
                    confidence {Math.round(p.confidence * 100)}% · {fmtAgo(p.ts, data?.now ?? Date.now())}
                  </div>
                </div>
                <div className="text-right">
                  {p.distance !== null && (
                    <>
                      <div className="tnum text-[15px] font-extrabold text-accent">{p.distance.toFixed(0)} m</div>
                      <div className="tnum text-[10px] text-text-faint">bearing {Math.round(p.bearing!)}°</div>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* map with mark */}
        <section className="rounded-xl border border-border bg-surface p-3">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-[12px] font-bold uppercase tracking-[0.12em] text-text-muted">Location</h2>
            <div className="flex gap-1.5">
              <button
                onClick={() => setMark(null)}
                className="rounded border border-border px-2 py-1 text-[10.5px] font-medium text-text-muted"
              >
                Clear
              </button>
              <button
                onClick={() =>
                  setMark((prev) => (prev ? prev : { xM: 0, yM: 0 }))
                }
                className="flex items-center gap-1 rounded border border-accent/50 bg-accent-dim px-2 py-1 text-[10.5px] font-semibold text-accent"
              >
                <LocateFixed size={11} /> Use origin
              </button>
            </div>
          </div>
          {data && (
            <RobotMap
              trail={[]}
              detections={data.pins.map((p) => ({
                id: p.id,
                ts: p.ts,
                label: "person" as const,
                confidence: p.confidence,
                bbox: { x: 0, y: 0, w: 0, h: 0 },
                position: p.position,
                source: "vision" as const,
              }))}
              position={
                data.position
                  ? {
                      ...data.position,
                      mode: "estimated_imu_odometry",
                      origin: { xM: 0, yM: 0, setAt: data.mission.startedAt },
                      heardAt: data.now,
                    }
                  : null
              }
              mark={mark}
              onMark={(x, y) => setMark({ xM: x, yM: y })}
              interactive
            />
          )}
          <p className="mt-2 text-[10.5px] leading-snug text-text-faint">
            {mark
              ? "You are marked — distances & bearings below each survivor pin update immediately."
              : "Tap the map where you are standing to get distance + bearing to every survivor. (Phone GPS can't be mapped onto the robot's anchor frame, so we ask you to mark — that's the honest way.)"}
          </p>
        </section>

        {/* live log */}
        <section className="rounded-xl border border-border bg-surface">
          <header className="flex items-center gap-2 border-b border-border px-4 py-2.5">
            <Radio size={13} className="text-accent" />
            <h2 className="text-[12px] font-bold uppercase tracking-[0.12em] text-text-muted">Live log</h2>
            <span className="tnum ml-auto text-[10px] text-text-faint">auto-refresh · 3 s</span>
          </header>
          <div className="scroll-thin max-h-64 divide-y divide-border overflow-y-auto">
            {(data?.recentEvents ?? []).length === 0 && (
              <p className="px-4 py-5 text-center text-[12px] text-text-faint">Waiting for events…</p>
            )}
            {(data?.recentEvents ?? []).map((e) => (
              <div key={e.id} className="flex gap-2.5 px-4 py-2">
                <span className="tnum shrink-0 text-[10px] text-text-faint">{fmtClock(e.ts)}</span>
                <p
                  className={cn(
                    "text-[12px] leading-snug",
                    e.level === "critical"
                      ? "font-semibold text-critical"
                      : e.level === "warn"
                        ? "text-warn"
                        : "text-text-primary"
                  )}
                >
                  {e.text}
                </p>
              </div>
            ))}
          </div>
        </section>

        <p className="pb-2 text-center text-[10px] text-text-faint">
          Field Rescue View · {data ? `mission started ${fmtAgo(data.mission.startedAt, data.now)}` : ""} · read-only
          link · works on any phone
        </p>
      </main>
    </div>
  );
}

function StatusTile({ label, value, tone }: { label: string; value: string; tone: "ok" | "warn" | "default" }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-2 py-2.5">
      <div className="text-[9px] font-semibold uppercase tracking-[0.12em] text-text-faint">{label}</div>
      <div
        className={cn(
          "tnum mt-0.5 text-[13px] font-bold",
          tone === "ok" && "text-ok",
          tone === "warn" && "text-warn",
          tone === "default" && "text-text-primary"
        )}
      >
        {value}
      </div>
    </div>
  );
}
