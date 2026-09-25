"use client";

import type { ConsoleState } from "@/lib/types";
import type { Role } from "@/lib/auth";
import { Button } from "@/components/ui";
import { cn, fmtClock } from "@/lib/utils";

/**
 * ONE combined activity feed — the mission's plain-English story.
 * Sensor events, commands and system states all live here; alerts appear
 * inline with their ACK button. No second log.
 */
export function FeedPanel({
  state,
  role,
  onAck,
}: {
  state: ConsoleState;
  role: Role;
  onAck: (id: string) => Promise<void>;
}) {
  const unacked = state.alerts.filter((a) => !a.ackedBy);
  return (
    <section className="flex h-full min-h-0 flex-col rounded-lg border border-border bg-surface">
      <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div>
          <h3 className="text-[12px] font-semibold uppercase tracking-[0.12em] text-text-muted">Activity</h3>
          {unacked.length > 0 && (
            <p className="text-[10px] font-semibold text-warn">
              {unacked.length} unacknowledged alert{unacked.length > 1 ? "s" : ""}
            </p>
          )}
        </div>
        <span className="text-[10px] uppercase tracking-wider text-text-faint">live · operator English</span>
      </header>

      <div className="scroll-thin min-h-0 flex-1 space-y-1 overflow-y-auto p-2.5">
        {state.events.length === 0 && <p className="p-2 text-[12px] text-text-faint">Waiting for the first event…</p>}
        {state.events.map((e) => {
          const alert = e.refId ? state.alerts.find((a) => a.id === e.refId) : undefined;
          const isAlertEntry = alert !== undefined && e.kind === "alert";
          return (
            <div
              key={e.id}
              className={cn(
                "rounded-md border px-2.5 py-1.5",
                e.level === "critical"
                  ? "border-critical/40 bg-critical/10"
                  : e.level === "warn"
                    ? "border-warn/30 bg-warn/5"
                    : e.level === "success"
                      ? "border-ok/20 bg-ok/5"
                      : "border-border bg-bg/40"
              )}
            >
              <div className="flex items-start gap-2.5">
                <span className="tnum mt-0.5 shrink-0 text-[10px] text-text-faint">{fmtClock(e.ts)}</span>
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      "text-[12px] leading-snug",
                      e.level === "critical" ? "font-semibold text-critical" : "text-text-primary"
                    )}
                  >
                    {e.text}
                  </p>
                  {/* sensor snapshot at that exact moment — honest + useful */}
                  <p className="tnum mt-0.5 truncate text-[10px] text-text-faint">{snapshotLine(e)}</p>
                  {isAlertEntry && alert && !alert.ackedBy && role === "operator" && (
                    <Button variant="ghost" className="mt-1 h-6 px-2 text-[10.5px]" onClick={() => onAck(alert.id)}>
                      Acknowledge
                    </Button>
                  )}
                  {alert?.ackedBy && (
                    <span className="tnum text-[9.5px] text-ok">✓ acked by {alert.ackedBy}</span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function snapshotLine(e: {
  snapshot: {
    position?: { xM: number; yM: number };
    gas?: { ppm: number };
    sound?: { amp: number };
    distance?: { mm: number; status: string };
  };
}): string {
  const s = e.snapshot;
  const parts: string[] = [];
  if (s.position) parts.push(`pos (${s.position.xM.toFixed(1)}, ${s.position.yM.toFixed(1)}) m`);
  if (s.gas) parts.push(`gas ${Math.round(s.gas.ppm)} ppm`);
  if (s.sound) parts.push(`amp ${(s.sound.amp * 100).toFixed(0)}%`);
  if (s.distance && s.distance.status === "valid") parts.push(`clearance ${s.distance.mm} mm`);
  return parts.length ? parts.join(" · ") : "no sensor snapshot yet";
}
