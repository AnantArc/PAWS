"use client";

import type { ConsoleState } from "@/lib/types";
import { cn } from "@/lib/utils";
import { BatteryIcon, batteryBarCls, batteryTone } from "@/components/battery-icon";

const GAIT_LABELS = ["STOP", "FWD", "BWD", "TURN L", "TURN R"];

function sevCls(severity: string): string {
  return severity === "critical" ? "text-critical" : severity === "warn" ? "text-warn" : "text-text-muted";
}

function fmtAgo(ts: number, now: number): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  return `${m}m ago`;
}

/**
 * SYSTEM · ESP32 — live firmware telemetry from the single `telemetry` row
 * (id = 1): battery icon + % + status bar, gait, current error string, and
 * the newest alert rows (BATTERY_LOW / SYSTEM_ERROR land in `alerts`).
 * Demo mode shows the simulated block (high battery, errorText "NONE").
 */
export function FirmwarePanel({ state }: { state: ConsoleState }) {
  const fw = state.firmware;
  const now = state.now;
  const errors = fw && fw.errorText !== "NONE" ? fw.errorText.split(";").map((e) => e.trim()).filter(Boolean) : [];
  const recentAlerts = state.alerts.slice(0, 5);

  const batPct = fw?.batteryPct ?? null;
  const batCls = batPct == null ? "text-text-muted" : batteryTone(batPct);

  return (
    <section className="flex h-full flex-col rounded-lg border border-border bg-surface shadow-sm">
      <header className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2.5">
        <h3 className="text-[12px] font-bold uppercase tracking-[0.12em] text-text-muted">System · ESP32</h3>
        <span className={cn("text-[10.5px] font-bold uppercase tracking-wider", fw ? "text-ok" : "text-text-faint")}>
          {fw ? `${fmtAgo(fw.updatedAt, now)} heartbeat` : "no telemetry yet"}
        </span>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto p-3.5">
        {!fw ? (
          <p className="text-[12px] text-text-faint">
            Waiting for the first ESP32 upload to telemetry (id = 1)…
          </p>
        ) : (
          <>
            {/* battery: icon + % + status bar + details */}
            <div>
              <div className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-text-faint">Battery</div>
              <div className="mt-1 flex items-end justify-between gap-2">
                <div className="flex items-center gap-2">
                  <BatteryIcon pct={batPct ?? 0} className="[&>svg]:h-[20px] [&>svg]:w-[40px]" />
                  <span className={cn("tnum text-[26px] font-bold leading-none", batCls)}>
                    {batPct != null ? `${batPct}%` : "—"}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-right text-[11px] text-text-muted">
                  <span className="text-text-faint">VOLTAGE</span>
                  <span className="tnum font-semibold text-text-primary">{fw.batteryVoltage != null ? `${fw.batteryVoltage.toFixed(2)} V` : "—"}</span>
                  <span className="text-text-faint">EST. RUNTIME</span>
                  <span className="tnum font-semibold text-text-primary">{fw.estRuntimeMin != null ? `${fw.estRuntimeMin} min` : "—"}</span>
                  <span className="text-text-faint">GAIT</span>
                  <span className="tnum font-semibold text-text-primary">
                    {fw.gaitState != null ? (GAIT_LABELS[fw.gaitState] ?? String(fw.gaitState)) : "—"}
                  </span>
                </div>
              </div>
              {batPct != null && (
                <div className="mt-2 h-2 w-full overflow-hidden rounded-full border border-border bg-bg">
                  <div
                    className={cn("h-full rounded-full transition-all duration-500", batteryBarCls(batPct))}
                    style={{ width: `${batPct}%` }}
                  />
                </div>
              )}
            </div>

            {/* current error string (demo mode always reports NONE) */}
            <div>
              <div className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-text-faint">Error log</div>
              {errors.length === 0 ? (
                <div className="mt-1 text-[12px] font-semibold text-ok">NONE — all systems nominal</div>
              ) : (
                <div className="mt-1 flex flex-wrap gap-1">
                  {errors.map((e) => (
                    <span key={e} className="rounded border border-critical/40 bg-critical/10 px-1.5 py-0.5 text-[10.5px] font-bold text-critical">
                      {e}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* newest alerts (real mode: firmware BATTERY_LOW / SYSTEM_ERROR rows) */}
            <div className="min-h-0 flex-1">
              <div className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-text-faint">Latest alerts</div>
              {recentAlerts.length === 0 ? (
                <div className="mt-1 text-[11.5px] text-text-faint">no alerts</div>
              ) : (
                <ul className="mt-1 space-y-1">
                  {recentAlerts.map((a) => (
                    <li key={a.id} className="flex items-start justify-between gap-2 text-[11.5px]">
                      <span className={cn("font-medium", sevCls(a.severity))}>{a.message}</span>
                      <span className="tnum shrink-0 text-text-faint">{fmtAgo(a.ts, now)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
