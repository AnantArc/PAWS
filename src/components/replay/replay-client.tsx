"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Play, Pause, RotateCcw, ChevronLeft } from "lucide-react";
import type { MissionTimeline } from "@/lib/store";
import type { Detection, FeedEvent, ScoreResult, TrailPoint } from "@/lib/types";
import { RobotMap } from "@/components/map";
import { ThemeToggle } from "@/components/theme";
import { fmtClock, fmtAgo, cn } from "@/lib/utils";
import { LoadingScreen } from "@/components/loading-screen";

/**
 * MISSION REPLAY — read-only timeline scrubber over stored data.
 * Works with zero network, zero robot: the demo insurance.
 */
export function ReplayClient() {
  const [missions, setMissions] = useState<Array<{ id: string; name: string; status: string; startedAt: number }>>([]);
  const [missionId, setMissionId] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<MissionTimeline | null>(null);
  const [t, setT] = useState(0); // ms into mission
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);

  useEffect(() => {
    fetch("/api/mission")
      .then((r) => r.json())
      .then((d) => {
        setMissions(d.missions ?? []);
        if (d.missions?.[0]) setMissionId(d.missions[0].id);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!missionId) return;
    fetch(`/api/timeline?mission=${encodeURIComponent(missionId)}`)
      .then((r) => r.json())
      .then((d) => setTimeline(d as MissionTimeline))
      .catch(() => setTimeline(null));
  }, [missionId]);

  const end = timeline
    ? Math.max(5000, (timeline.trail.at(-1)?.ts ?? timeline.events.at(-1)?.ts ?? 0) - timeline.mission.startedAt)
    : 0;

  useEffect(() => {
    if (!playing || end === 0) return;
    const id = setInterval(() => {
      setT((prev) => {
        const next = prev + 90 * speed;
        if (next >= end) {
          setPlaying(false);
          return end;
        }
        return next;
      });
    }, 90);
    return () => clearInterval(id);
  }, [playing, speed, end]);

  const view = useMemo(() => {
    if (!timeline) return null;
    const cut = timeline.mission.startedAt + t;
    const trail: TrailPoint[] = timeline.trail.filter((p) => p.ts <= cut);
    const events: FeedEvent[] = timeline.events.filter((e) => e.ts <= cut);
    const detections: Detection[] = timeline.detections.filter((d) => d.ts <= cut);
    const score: ScoreResult | null = [...timeline.scoreHistory].reverse().find((s) => s.ts <= cut) ?? null;
    const pos = trail.at(-1);
    return { trail, events, detections, score, pos, cut };
  }, [timeline, t]);

  if (!missions.length) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg">
        <LoadingScreen label="LOADING MISSION ARCHIVE" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg p-4 text-text-primary">
      <div className="mx-auto max-w-6xl space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/console" className="flex items-center gap-1 text-[12.5px] text-text-muted hover:text-accent">
            <ChevronLeft size={14} /> Console
          </Link>
          <h1 className="text-lg font-bold">Mission Replay</h1>
          <select
            value={missionId ?? ""}
            onChange={(e) => {
              setMissionId(e.target.value);
              setT(0);
              setPlaying(true);
            }}
            className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-text-primary outline-none focus:border-accent"
          >
            {missions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} · {m.status} · {fmtAgo(m.startedAt, Date.now())}
              </option>
            ))}
          </select>
          <span className="chip border border-border bg-surface-2 text-text-muted">read-only · no robot needed</span>
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </div>

        {!timeline || !view ? (
          <p className="py-16 text-center text-[13px] text-text-faint">Loading timeline…</p>
        ) : (
          <>
            {/* scrubber */}
            <div className="rounded-lg border border-border bg-surface p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <button
                  onClick={() => {
                    setT(0);
                    setPlaying(true);
                  }}
                  className="rounded border border-border p-1.5 text-text-muted hover:text-accent"
                  title="Restart"
                >
                  <RotateCcw size={13} />
                </button>
                <button onClick={() => setPlaying((p) => !p)} className="rounded bg-accent p-1.5 text-slate-950">
                  {playing ? <Pause size={13} /> : <Play size={13} />}
                </button>
                <div className="flex items-center gap-1">
                  {[0.5, 1, 2, 4].map((s) => (
                    <button
                      key={s}
                      onClick={() => setSpeed(s)}
                      className={cn(
                        "tnum rounded px-2 py-1 text-[11px] font-bold",
                        speed === s ? "bg-accent text-slate-950" : "text-text-muted hover:text-text-primary"
                      )}
                    >
                      {s}×
                    </button>
                  ))}
                </div>
                <input
                  type="range"
                  min={0}
                  max={end}
                  value={t}
                  onChange={(e) => {
                    setT(Number(e.target.value));
                    setPlaying(false);
                  }}
                  className="tnum min-w-0 flex-1"
                />
                <span className="tnum text-[11px] text-text-muted">
                  {fmtClock(timeline.mission.startedAt + t)}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[11px] text-text-faint">
                <span>mission {timeline.mission.name}</span>
                <span>started {fmtAgo(timeline.mission.startedAt, Date.now())}</span>
                <span>{view.trail.length} trail points</span>
                <span>{view.events.length} events</span>
                <span>{view.detections.length} detections</span>
              </div>
            </div>

            {/* animated view */}
            <div className="grid gap-3 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <RobotMap
                  trail={view.trail}
                  detections={view.detections}
                  position={
                    view.pos
                      ? {
                          xM: view.pos.xM,
                          yM: view.pos.yM,
                          headingDeg: 0,
                          driftM: 0.4,
                          mode: "estimated_imu_odometry",
                          origin: { xM: 0, yM: 0, setAt: timeline.mission.startedAt },
                          heardAt: view.pos.ts,
                        }
                      : null
                  }
                  mode="score"
                />
              </div>
              <div className="space-y-2">
                <div className="rounded-lg border border-border bg-surface p-4">
                  <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-text-faint">
                    Survivor likelihood @ {fmtClock(view.cut)}
                  </div>
                  <div className="tnum mt-1 text-4xl font-extrabold text-text-primary">
                    {view.score ? view.score.survivor.value.toFixed(2) : "0.00"}
                  </div>
                  {view.score && (
                    <ul className="mt-2 space-y-0.5">
                      {view.score.survivor.reasons.slice(0, 3).map((r, i) => (
                        <li key={i} className="text-[11px] leading-snug text-text-muted">
                          {r}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {/* replay feed */}
                <div className="scroll-thin max-h-64 overflow-y-auto rounded-lg border border-border bg-surface p-2.5">
                  {view.events
                    .slice()
                    .reverse()
                    .map((e) => (
                      <div key={e.id} className="flex gap-2 border-b border-border/40 py-1.5 last:border-0">
                        <span className="tnum shrink-0 text-[10px] text-text-faint">{fmtClock(e.ts)}</span>
                        <p
                          className={cn(
                            "text-[11.5px]",
                            e.level === "critical" ? "text-critical" : e.level === "warn" ? "text-warn" : "text-text-primary"
                          )}
                        >
                          {e.text}
                        </p>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
