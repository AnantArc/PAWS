import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { readSessionFromCookies } from "@/lib/auth";
import type { SensorSnapshot } from "@/lib/types";
import { getStore } from "@/lib/store";
import { fmtClock, fmtDuration } from "@/lib/utils";
import { PrintButton, ExportJsonButton } from "@/components/report/actions";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme";

export const dynamic = "force-dynamic";

/**
 * MISSION SUMMARY — print-ready report: event log + the full sensor
 * snapshot at every event timestamp, survivor pins, command audit, alerts.
 * Use the browser's Print (or Save as PDF) on this page.
 */
export default async function ReportPage({ params }: { params: { missionId: string } }) {
  const user = readSessionFromCookies();
  if (!user) redirect(`/login?next=/report/${params.missionId}`);

  const timeline = await getStore().getMissionTimeline(params.missionId);
  if (!timeline) notFound();

  const { mission, events, detections, commands, alerts, trail, scoreHistory } = timeline;
  const maxScore = scoreHistory.length ? Math.max(...scoreHistory.map((s) => s.survivor.value)) : 0;
  const lastScore = scoreHistory.at(-1)?.survivor.value ?? 0;

  return (
    <div className="min-h-screen bg-bg p-6 text-text-primary">
      <div className="mx-auto max-w-3xl">
        <div className="no-print mb-4 flex items-center justify-between">
          <Link href="/console" className="text-[12.5px] text-text-muted hover:text-accent">
            ← Console
          </Link>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <PrintButton />
            <ExportJsonButton data={timeline} filename={`paws-mission-${mission.id}.json`} />
          </div>
        </div>

        {/* printable sheet */}
        <article className="print-surface rounded-xl border border-border bg-surface p-8">
          <header className="mb-6 flex items-start justify-between border-b border-border pb-4">
            <div className="flex items-center gap-2.5">
              <Logo size={44} />
              <div>
                <h1 className="text-lg font-extrabold">PAWS Mission Summary</h1>
                <p className="text-[12px] text-text-muted">
                  {mission.name} · {mission.status}
                </p>
              </div>
            </div>
            <div className="text-right text-[12px] text-text-muted">
              <div className="tnum">started {fmtClock(mission.startedAt)}</div>
              {mission.endedAt && <div className="tnum">ended {fmtClock(mission.endedAt)}</div>}
              <div className="tnum">duration {fmtDuration((mission.endedAt ?? Date.now()) - mission.startedAt)}</div>
            </div>
          </header>

          {/* score summary */}
          <section className="mb-6 grid grid-cols-3 gap-3">
            <div className="rounded-lg border border-border p-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-text-faint">Peak survivor score</div>
              <div className="tnum text-2xl font-extrabold text-text-primary">{maxScore.toFixed(2)}</div>
            </div>
            <div className="rounded-lg border border-border p-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-text-faint">Final survivor score</div>
              <div className="tnum text-2xl font-extrabold text-text-primary">{lastScore.toFixed(2)}</div>
            </div>
            <div className="rounded-lg border border-border p-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-text-faint">Reports</div>
              <div className="tnum text-2xl font-extrabold text-text-primary">{detections.length}</div>
            </div>
          </section>

          {/* survivor pins */}
          {detections.length > 0 && (
            <section className="mb-6">
              <h2 className="mb-2 text-[13px] font-bold uppercase tracking-wider text-text-muted">
                Survivor reports (relative coordinates)
              </h2>
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-border text-left text-[10px] uppercase tracking-wider text-text-faint">
                    <th className="py-1">Time</th>
                    <th>Position (m)</th>
                    <th>Confidence</th>
                    <th>Score at time</th>
                  </tr>
                </thead>
                <tbody className="tnum">
                  {detections.map((d) => (
                    <tr key={d.id} className="border-b border-border/50">
                      <td className="py-1.5">{fmtClock(d.ts)}</td>
                      <td>{d.position ? `(${d.position.xM.toFixed(1)}, ${d.position.yM.toFixed(1)})` : "—"}</td>
                      <td>{Math.round(d.confidence * 100)}%</td>
                      <td>
                        {scoreHistory.find((s) => Math.abs(s.ts - d.ts) < 2000)?.survivor.value.toFixed(2) ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {/* event log WITH sensor snapshots at each timestamp */}
          <section>
            <h2 className="mb-2 text-[13px] font-bold uppercase tracking-wider text-text-muted">
              Event log · {events.length} entries (sensor state at each time)
            </h2>
            <div className="space-y-2">
              {events
                .slice()
                .reverse()
                .map((e) => (
                  <div key={e.id} className="rounded-md border border-border p-2.5">
                    <div className="flex items-baseline gap-3">
                      <span className="tnum shrink-0 text-[11px] text-text-faint">{fmtClock(e.ts)}</span>
                      <span className="text-[12.5px] font-medium">{e.text}</span>
                    </div>
                    <p className="tnum mt-1 text-[10.5px] text-text-faint">snapshot: {fmtSnapshot(e)}</p>
                  </div>
                ))}
              {events.length === 0 && <p className="text-[12px] text-text-faint">No events recorded.</p>}
            </div>
          </section>

          {/* command audit */}
          {commands.length > 0 && (
            <section className="mt-6">
              <h2 className="mb-2 text-[13px] font-bold uppercase tracking-wider text-text-muted">Command audit</h2>
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-border text-left text-[10px] uppercase tracking-wider text-text-faint">
                    <th className="py-1">Issued</th>
                    <th>Command</th>
                    <th>By</th>
                    <th>Final state</th>
                  </tr>
                </thead>
                <tbody className="tnum">
                  {commands.map((c) => (
                    <tr key={c.id} className="border-b border-border/50">
                      <td className="py-1.5">{fmtClock(c.issuedAt)}</td>
                      <td>{c.type}</td>
                      <td>{c.issuedBy}</td>
                      <td>{c.current}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {/* alerts */}
          {alerts.length > 0 && (
            <section className="mt-6">
              <h2 className="mb-2 text-[13px] font-bold uppercase tracking-wider text-text-muted">Alerts</h2>
              <table className="w-full text-[12px]">
                <tbody className="tnum">
                  {alerts.map((a) => (
                    <tr key={a.id} className="border-b border-border/50">
                      <td className="py-1.5">{fmtClock(a.ts)}</td>
                      <td>{a.message}</td>
                      <td className="text-right">{a.ackedBy ? `acked by ${a.ackedBy}` : "unacknowledged"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          <footer className="mt-8 border-t border-border pt-3 text-[10.5px] text-text-faint">
            Generated by PAWS Console · trail points recorded: {trail.length} · scores evaluated: {scoreHistory.length} ·
            fusion weights v2.1
          </footer>
        </article>
      </div>
    </div>
  );
}

function fmtSnapshot(e: { snapshot: SensorSnapshot }): string {
  const s = e.snapshot;
  const parts: string[] = [];
  if (s.position) parts.push(`pos (${s.position.xM.toFixed(1)}, ${s.position.yM.toFixed(1)}) m`);
  if (s.gas) parts.push(`gas ${Math.round(s.gas.ppm)} ppm`);
  if (s.thermal) parts.push(`obj ${s.thermal.objectC.toFixed(1)}°C · amb ${s.thermal.ambientC.toFixed(1)}°C`);
  if (s.sound) parts.push(`sound ${(s.sound.amp * 100).toFixed(0)}%`);
  if (s.distance) parts.push(`clearance ${s.distance.mm} mm`);
  if (s.tilt) parts.push(`tilt ${Math.max(Math.abs(s.tilt.pitchDeg), Math.abs(s.tilt.rollDeg)).toFixed(1)}°`);
  if (s.detection) parts.push(`detection ${Math.round(s.detection.confidence * 100)}%`);
  return parts.length ? parts.join(" · ") : "no sensor data yet";
}
