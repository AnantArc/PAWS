"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Pause, Play } from "lucide-react";
import type { ConsoleState, Command } from "@/lib/types";
import type { SessionUser } from "@/lib/auth";
import { useConsoleState } from "./use-console-state";
import { Header } from "./header";
import { CameraPanel } from "./camera-panel";
import { ScorePanel } from "./score-panel";
import {
  SoundPanel,
  GasPanel,
  ThermalPanel,
  DistancePanel,
  TiltPanel,
  ClimatePanel,
  PirPanel,
  VisionPanel,
  LinkPanel,
} from "./panels";
import { CommandBar } from "./command-bar";
import { FeedPanel } from "./feed";
import { RobotMap } from "@/components/map";
import { QrShareButton } from "./qr-button";
import { LoadingScreen } from "@/components/loading-screen";
import { cn } from "@/lib/utils";

export function ConsoleClient({ user }: { user: SessionUser }) {
  const { state } = useConsoleState();
  const router = useRouter();
  const [mapMode, setMapMode] = useState<"score" | "gas">("score");
  const [toast, setToast] = useState<string | null>(null);

  const notify = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  };

  const cmd = useCallback(
    async (type: Command["type"], params?: Record<string, string>) => {
      const res = await fetch("/api/command", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type, params: params ?? {} }),
      });
      const data = await res.json();
      notify(res.ok ? `Command ${type} queued` : data.error ?? "Command failed");
    },
    [notify]
  );

  const ack = useCallback(async (id: string) => {
    await fetch("/api/alerts/ack", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
  }, []);

  const mission = useCallback(
    async (action: "start" | "pause" | "resume" | "end") => {
      const res = await fetch("/api/mission", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          name: action === "start" ? "Warehouse Sweep — Demo" : undefined,
          robotId: action === "start" ? user.robotId : undefined,
        }),
      });
      const labels: Record<string, string> = {
        start: "Mission started",
        pause: "Mission paused",
        resume: "Mission resumed",
        end: "Mission ended",
      };
      notify(res.ok ? labels[action] : "Mission action failed");
    },
    [notify]
  );

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  if (!state) {
    return (
      <>
        <LoadingScreen label="CONNECTING TO PAWS" />
        <div className="min-h-screen bg-bg" />
      </>
    );
  }

  const s: ConsoleState = state;
  const running = s.mission.status === "running";
  const isObserver = user.role === "observer";

  return (
    <div className="flex min-h-screen flex-col bg-bg text-text-primary">
      <Header state={s} onLogout={logout} />

      <main className="flex flex-1 flex-col gap-3.5 p-3.5">
        {/* ROW 1 — camera | score | map | mission+activity: one top line, one bottom line */}
        <div className="grid grid-cols-12 gap-3.5">
          <div className="col-span-12 md:col-span-6 xl:col-span-3 xl:h-[345px]">
            <CameraPanel state={s} simulated={s.simulated} />
          </div>
          <div className="col-span-12 md:col-span-6 xl:col-span-3 xl:h-[345px]">
            <ScorePanel state={s} />
          </div>
          <div className="col-span-12 md:col-span-6 xl:col-span-3 xl:h-[345px]">
            <section className="flex h-full flex-col rounded-lg border border-border bg-surface shadow-sm">
              <header className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2.5">
                <h3 className="text-[12px] font-bold uppercase tracking-[0.12em] text-text-muted">Position</h3>
                <div className="flex gap-1 rounded-md border border-border bg-bg p-0.5">
                  {(["score", "gas"] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => setMapMode(m)}
                      className={cn(
                        "rounded px-2.5 py-0.5 text-[10.5px] font-bold uppercase tracking-wider transition-colors",
                        mapMode === m ? "bg-accent text-slate-950" : "text-text-muted hover:text-text-primary"
                      )}
                    >
                      {m === "score" ? "Map" : "Gas map"}
                    </button>
                  ))}
                </div>
              </header>
              <div className="min-h-0 flex-1 p-2.5">
                <RobotMap
                  trail={s.trail}
                  detections={s.detections}
                  position={s.sensors.position}
                  mode={mapMode}
                  rebase={s.rebase}
                  className="h-full w-full rounded"
                />
              </div>
              <div className="shrink-0 border-t border-border px-3 py-2 bg-surface-2/30">
                <div className="flex flex-wrap items-center justify-between gap-2 text-[10.5px] text-text-faint">
                  <span className="tnum">
                    {s.sensors.position
                      ? `pos (${(s.sensors.position.xM - s.rebase.xM).toFixed(1)}, ${(s.sensors.position.yM - s.rebase.yM).toFixed(1)}) m relative to origin · hdg ${Math.round(s.sensors.position.headingDeg)}° · drift ±${s.sensors.position.driftM.toFixed(1)} m`
                      : "waiting for first position reading"}
                  </span>
                  <span>drag to pan · zoom +/− · ⟲ resets</span>
                </div>
              </div>
            </section>
          </div>
          <div className="col-span-12 xl:col-span-3 xl:h-[345px]">
            <div className="flex h-full flex-col gap-2">
              <div className="flex shrink-0 gap-1.5">
                {s.mission.status === "paused" ? (
                  <button
                    onClick={() => mission("resume")}
                    disabled={isObserver}
                    title={isObserver ? "Observer role: mission control disabled" : undefined}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-ok/40 bg-ok/10 py-2 text-[12px] font-semibold text-ok hover:bg-ok/20 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Play size={13} /> Resume mission
                  </button>
                ) : (
                  <button
                    onClick={() => mission("start")}
                    disabled={running || isObserver}
                    title={isObserver ? "Observer role: mission control disabled" : undefined}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border bg-surface py-2 text-[12px] font-semibold text-text-primary hover:border-accent/50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Play size={13} /> {s.mission.status === "ended" ? "New mission" : "Start mission"}
                  </button>
                )}
                {running ? (
                  <button
                    onClick={() => mission("pause")}
                    disabled={isObserver}
                    title={isObserver ? "Observer role: mission control disabled" : undefined}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border bg-surface py-2 text-[12px] font-semibold text-text-primary hover:border-warn/50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Pause size={13} /> Pause
                  </button>
                ) : null}
                <button
                  onClick={() => mission("end")}
                  disabled={s.mission.status === "ended" || isObserver}
                  title={isObserver ? "Observer role: mission control disabled" : undefined}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border bg-surface py-2 text-[12px] font-semibold text-text-muted hover:border-critical/50 hover:text-critical disabled:cursor-not-allowed disabled:opacity-40"
                >
                  ✓ End mission
                </button>
              </div>
              <div className="flex shrink-0 gap-1.5 xl:hidden">
                {[
                  { href: "/replay", label: "Replay" },
                  { href: "/settings", label: "Settings" },
                  { href: "/status", label: "Status" },
                ].map((l) => (
                  <Link
                    key={l.href}
                    href={l.href}
                    className="flex-1 rounded-md border border-border bg-surface py-1.5 text-center text-[11.5px] font-medium text-text-muted hover:text-accent"
                  >
                    {l.label}
                  </Link>
                ))}
              </div>
              <div className="min-h-0 flex-1">
                <FeedPanel state={s} role={user.role} onAck={ack} />
              </div>
            </div>
          </div>
        </div>

        {/* ROW 2 — six sensor panels, all equal height with clean text wrapping */}
        <div className="grid grid-cols-12 gap-3.5">
          <div className="col-span-6 md:col-span-4 xl:col-span-2 xl:h-[340px]">
            <SoundPanel state={s} />
          </div>
          <div className="col-span-6 md:col-span-4 xl:col-span-2 xl:h-[340px]">
            <GasPanel state={s} />
          </div>
          <div className="col-span-6 md:col-span-4 xl:col-span-2 xl:h-[340px]">
            <ThermalPanel state={s} />
          </div>
          <div className="col-span-6 md:col-span-6 xl:col-span-2 xl:h-[340px]">
            <DistancePanel state={s} />
          </div>
          <div className="col-span-6 md:col-span-4 xl:col-span-2 xl:h-[340px]">
            <TiltPanel state={s} />
          </div>
          <div className="col-span-6 md:col-span-4 xl:col-span-2 xl:h-[340px]">
            <ClimatePanel state={s} />
          </div>
        </div>

        {/* ROW 3 — motion / vision / link */}
        <div className="grid grid-cols-12 gap-3.5">
          <div className="col-span-6 md:col-span-4 xl:col-span-3 xl:h-[270px]">
            <PirPanel state={s} />
          </div>
          <div className="col-span-6 md:col-span-8 xl:col-span-5 xl:h-[270px]">
            <VisionPanel state={s} />
          </div>
          <div className="col-span-12 xl:col-span-4 xl:h-[270px]">
            <LinkPanel state={s} />
          </div>
        </div>

        {/* ROW 4 — command bar (full width) */}
        <div className="grid grid-cols-12 gap-3.5">
          <div className="col-span-12">
            <CommandBar state={s} role={user.role} onCommand={cmd} />
          </div>
        </div>
      </main>

      <QrShareButton role={user.role} missionId={s.mission.id} />

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 animate-risein rounded-md border border-border bg-surface px-4 py-2 text-[12.5px] font-medium text-text-primary shadow-2xl">
          {toast}
        </div>
      )}
    </div>
  );
}
