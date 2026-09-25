"use client";

import type { ConsoleState, Freshness } from "@/lib/types";
import { Card, FreshnessChip } from "@/components/ui";
import { Sparkline, Gauge } from "@/components/charts";
import { fmtAgo, fmtDuration, t } from "@/lib/utils";

/**
 * Uniform sensor-panel skeleton — every card shares clean padding and
 * line wrapping so no text is ever clipped or truncated with "...".
 */

export function freshnessFor(heardAt: number | undefined, intervalMs: number, now: number, linkOnline = true): Freshness {
  if (!heardAt) return "not_installed";
  const age = now - heardAt;
  if (!linkOnline) return "offline";
  if (age < intervalMs * 1.6) return "live";
  if (age < intervalMs * 3) return "delayed";
  if (age < intervalMs * 6) return "stale";
  return "offline";
}

function Fresh({ s, now, live }: { s: { heardAt?: number } | null; now: number; live: boolean }) {
  return <FreshnessChip f={freshnessFor(s?.heardAt, 2600, now, live)} heardAt={s?.heardAt} />;
}

function WordChip({ word, tone }: { word: string; tone: "ok" | "warn" | "critical" | "muted" }) {
  const cls =
    tone === "ok"
      ? "bg-ok/15 text-ok border border-ok/40"
      : tone === "warn"
        ? "bg-warn/15 text-warn border border-warn/40"
        : tone === "critical"
          ? "bg-critical/15 text-critical border border-critical/40"
          : "bg-surface-2 text-text-faint border border-border";
  return <span className={`chip whitespace-nowrap ${cls}`}>{word}</span>;
}

function Big({ value, unit, tone, sub }: { value: string; unit?: string; sub?: string; tone?: string }) {
  return (
    <div className="flex shrink-0 items-baseline justify-between gap-2 border-b border-border/40 pb-2">
      <span className={`tnum text-2xl font-extrabold tracking-tight ${tone ?? "text-text-primary"}`}>{value}</span>
      <span className="flex flex-col items-end">
        {unit && <span className="text-[10px] font-bold uppercase tracking-wider text-text-faint">{unit}</span>}
        {sub && <span className="tnum text-[10px] text-text-faint">{sub}</span>}
      </span>
    </div>
  );
}

/**
 * Two-column stacked field grid: the label sits above its value so every
 * reading prints in full — no side-by-side squeezing, no clipped text.
 */
function Stats({ items }: { items: Array<[string, string]> }) {
  return (
    <div className="mt-2.5 grid grid-cols-2 gap-x-2.5 gap-y-2 content-start">
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <div className="text-[9.5px] font-bold uppercase tracking-wider text-text-faint">{k}</div>
          <div className="tnum break-words text-[11.5px] font-semibold text-text-primary">{v}</div>
        </div>
      ))}
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-2 flex items-center leading-normal text-[10.5px] whitespace-nowrap text-text-faint">
      <div className="w-full">{children}</div>
    </div>
  );
}

function Foot({ children }: { children: React.ReactNode }) {
  return <div className="mt-2.5 min-h-0 flex-1">{children}</div>;
}

function Empty({ label }: { label: string }) {
  return (
    <div className="flex h-full min-h-24 flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border p-3 text-center">
      <span className="text-[11px] font-bold uppercase tracking-wider text-text-faint">{label}</span>
      <span className="text-[10px] text-text-faint">Awaiting telemetry reading</span>
    </div>
  );
}

/* ------------------------------------------------------------------- SOUND */
export function SoundPanel({ state }: { state: ConsoleState }) {
  const now = state.now;
  const s = state.sensors.sound;
  const db = s?.db;
  return (
    <Card
      title="Sound"
      sub="mic · SPL estimate"
      className="flex h-full flex-col shadow-sm"
      bodyClass="flex min-h-0 flex-1 flex-col p-3.5"
      right={
        s?.band ? (
          <WordChip word={s.band} tone={s.band === "HAZARD" || s.band === "LOUD" ? "warn" : "muted"} />
        ) : (
          <Fresh s={s} now={now} live={state.device.link === "online"} />
        )
      }
    >
      {s ? (
        <>
          <Big value={db != null ? `${Math.round(db)}` : `${Math.round(s.amp * 100)}%`} unit={db != null ? "dB SPL" : "amplitude"} />
          <Stats
            items={[
              ["Amp", `${(s.amp * 100).toFixed(0)}%`],
              ["Baseline", `${(s.baseline * 100).toFixed(0)}%`],
              ["Peak", db != null && s.peakDb != null ? `${Math.round(s.peakDb)} dB` : `${(s.peak * 100).toFixed(0)}%`],
              ["Read", fmtAgo(s.heardAt, now)],
            ]}
          />
          <Note>
            <span className="tnum">{fmtDuration(Math.max(0, s.heardAt - state.mission.startedAt))} · amplitude last 60 s</span>
          </Note>
          <Foot>
            <Sparkline data={state.history.sound.slice(-60)} color={t("accent")} baseline={s.baseline} />
          </Foot>
        </>
      ) : (
        <Empty label="Sound module offline" />
      )}
    </Card>
  );
}

/* --------------------------------------------------------------------- GAS */
export function GasPanel({ state }: { state: ConsoleState }) {
  const now = state.now;
  const s = state.sensors.gas;
  const hazard = !!s && (s.ppm >= 800 || s.aqiBand === "VERY POOR" || s.aqiBand === "SEVERE");
  const smokeVal = s ? (s.smoke != null ? s.smoke : s.ppm * 0.42).toFixed(1) : "—";
  const lpgVal = s ? s.ppm.toFixed(1) : "—";

  return (
    <Card
      title="Gas & Smoke"
      sub="Smoke + LPG"
      className="flex h-full flex-col shadow-sm"
      bodyClass="flex min-h-0 flex-1 flex-col justify-between p-3.5"
      right={
        s?.warming ? (
          <WordChip word="WARM-UP" tone="muted" />
        ) : hazard ? (
          <WordChip word="HAZARD" tone="critical" />
        ) : s?.aqiBand ? (
          <WordChip word={s.aqiBand} tone={s.aqiBand === "POOR" ? "warn" : "ok"} />
        ) : (
          <Fresh s={s} now={now} live />
        )
      }
    >
      {s ? (
        <div className="flex flex-1 flex-col justify-between">
          <div>
            <Big value={smokeVal} unit="SMOKE PPM" tone={hazard ? "text-critical" : undefined} />
            <Stats
              items={[
                ["LPG", `${lpgVal} ppm`],
                ["ADC", `${s.adc}`],
                ["AQI Band", s.aqiBand ?? "GOOD"],
                ["Read", fmtAgo(s.heardAt, now)],
              ]}
            />
            <Note>
              <span>Status: {s.warming ? "warm-up in progress" : "warm-up done"}</span>
            </Note>
          </div>
          <div className="mt-2 flex flex-1 flex-col justify-end min-h-[40px]">
            <Sparkline data={state.history.gas.slice(-60)} color={t("status-warn")} baseline={400} />
          </div>
        </div>
      ) : (
        <Empty label="Gas sensor offline" />
      )}
    </Card>
  );
}

/* ----------------------------------------------------------------- THERMAL */
export function ThermalPanel({ state }: { state: ConsoleState }) {
  const now = state.now;
  const s = state.sensors.thermal;
  const fire = !!s && (s.objectC > 55 || s.zone === "FIRE RISK");
  const bodyHeat = !!s && !fire && s.zone === "HUMAN HEAT";
  return (
    <Card
      title="Temperature"
      sub="IR spot"
      className="flex h-full flex-col shadow-sm"
      bodyClass="flex min-h-0 flex-1 flex-col p-3.5"
      right={
        fire ? (
          <WordChip word="FIRE RISK" tone="critical" />
        ) : bodyHeat ? (
          <WordChip word="HUMAN HEAT" tone="ok" />
        ) : (
          <Fresh s={s} now={now} live />
        )
      }
    >
      {s ? (
        <>
          <Big value={`${s.objectC.toFixed(1)}°C`} unit="Object Temp" tone={fire ? "text-critical" : bodyHeat ? "text-ok" : undefined} />
          <Stats
            items={[
              ["Ambient", `${s.ambientC.toFixed(1)}°C`],
              ["Δ Obj-Amb", `${s.objectC - s.ambientC >= 0 ? "+" : ""}${(s.deltaC ?? s.objectC - s.ambientC).toFixed(1)}°`],
              ["Zone", s.zone ?? "NORMAL"],
              ["Read", fmtAgo(s.heardAt, now)],
            ]}
          />
          <Note>
            {bodyHeat ? <span className="font-bold text-ok">body-heat band · confirmed</span> : <span className="tnum">IR spot, single point</span>}
          </Note>
          <Foot>
            <Gauge value={s.objectC} min={-20} max={80} label="object temp" showValue={false} />
          </Foot>
        </>
      ) : (
        <Empty label="Thermal sensor offline" />
      )}
    </Card>
  );
}

/* ---------------------------------------------------------------- CLEARANCE */
export function DistancePanel({ state }: { state: ConsoleState }) {
  const now = state.now;
  const s = state.sensors.distance;
  const blocked = !!s && ((s.status === "valid" && s.mm < 120) || s.state === "STOP");
  const cm = s?.cm ?? (s?.mm && s?.mm > 0 ? Math.round(s.mm / 10) : null);
  const bins = [
    { k: "L", v: s?.cmLeft, tone: t("accent") },
    { k: "F", v: cm, tone: blocked ? t("status-critical") : t("accent") },
    { k: "R", v: s?.cmRight, tone: t("accent") },
  ];
  return (
    <Card
      title="Clearance"
      sub="ToF + 3-way sonar"
      className="flex h-full flex-col shadow-sm"
      bodyClass="flex min-h-0 flex-1 flex-col p-3.5"
      right={
        s?.state ? (
          <WordChip word={s.state} tone={(s.state === "STOP" && "critical") || (s.state === "NEAR" && "warn") || "ok"} />
        ) : (
          <Fresh s={s} now={now} live />
        )
      }
    >
      {s ? (
        <>
          <Big
            value={cm != null ? (cm >= 100 ? `${(cm / 100).toFixed(2)} m` : `${cm} cm`) : "—"}
            unit="Front"
            tone={blocked ? "text-critical" : undefined}
          />
          <Stats
            items={[
              ["Laser", s.laserState ?? "IN RANGE"],
              ["Cross-check", s.match && s.match !== "----" ? s.match : "YES"],
              ["Mode", s.status ?? "valid"],
              ["Read", fmtAgo(s.heardAt, now)],
            ]}
          />
          <Note>
            <span>{blocked ? <span className="font-bold text-critical">obstacle ahead · stop</span> : "L = left · F = front · R = right"}</span>
          </Note>
          <Foot>
            <div className="flex h-full items-stretch gap-2">
              {bins.map((b) => (
                <div key={b.k} className="flex flex-1 flex-col justify-end">
                  <div className="tnum mb-1 text-[10px] text-text-faint">{b.v != null && b.v >= 0 ? `${Math.round(b.v)} cm` : "—"}</div>
                  <div className="flex h-[40px] w-full items-end overflow-hidden rounded bg-surface-2">
                    <div
                      className="w-full rounded transition-all duration-500"
                      style={{
                        height: `${b.v != null && b.v >= 0 ? Math.min(100, (b.v / 400) * 100) : 0}%`,
                        background: b.v != null && b.v >= 0 ? b.tone : "transparent",
                      }}
                    />
                  </div>
                  <div className="mt-1 text-center text-[9px] font-bold uppercase tracking-wider text-text-faint">{b.k}</div>
                </div>
              ))}
            </div>
          </Foot>
        </>
      ) : (
        <Empty label="Ranger offline" />
      )}
    </Card>
  );
}

/* -------------------------------------------------------------------- TILT */
export function TiltPanel({ state }: { state: ConsoleState }) {
  const now = state.now;
  const s = state.sensors.tilt;
  const tilt = s ? Math.max(Math.abs(s.pitchDeg), Math.abs(s.rollDeg)) : 0;
  return (
    <Card
      title="Tilt"
      sub="IMU · stability"
      className="flex h-full flex-col shadow-sm"
      bodyClass="flex min-h-0 flex-1 flex-col p-3.5"
      right={
        s?.attitude ? (
          <WordChip word={s.attitude} tone={s.attitude === "TIPOVER" ? "critical" : s.attitude === "TILTED" ? "warn" : "ok"} />
        ) : (
          <Fresh s={s} now={now} live />
        )
      }
    >
      {s ? (
        <>
          <Big value={`${tilt.toFixed(1)}°`} unit="Max Axis" tone={tilt > 28 ? "text-critical" : undefined} />
          <Stats
            items={[
              ["Pitch", `${s.pitchDeg >= 0 ? "+" : ""}${s.pitchDeg.toFixed(1)}°`],
              ["Roll", `${s.rollDeg >= 0 ? "+" : ""}${s.rollDeg.toFixed(1)}°`],
              ["Heading", s.headingDeg != null ? `${Math.round(s.headingDeg)}°` : "0°"],
              ["Read", fmtAgo(s.heardAt, now)],
            ]}
          />
          <Note>
            <span>{tilt > 28 ? <span className="font-bold text-critical">tilt blocked · envelope limit</span> : "level ↔ tipover envelope"}</span>
          </Note>
          <Foot>
            <Gauge value={tilt} min={0} max={45} label="max axis" unit="°" showValue={false} />
          </Foot>
        </>
      ) : (
        <Empty label="IMU offline" />
      )}
    </Card>
  );
}

/* ----------------------------------------------------------------- CLIMATE */
export function ClimatePanel({ state }: { state: ConsoleState }) {
  const now = state.now;
  const s = state.sensors.climate;
  return (
    <Card
      title="Climate"
      sub="Air"
      className="flex h-full flex-col shadow-sm"
      bodyClass="flex min-h-0 flex-1 flex-col p-3.5"
      right={s?.band ? <WordChip word={s.band} tone="muted" /> : <Fresh s={s} now={now} live />}
    >
      {s ? (
        <>
          <Big value={`${s.tempC.toFixed(1)}°C`} unit="Air Temp" />
          <Stats
            items={[
              ["Humidity", `${Math.round(s.humidityPct)}% RH`],
              ["Band", s.band ?? "COMFORT"],
              ["Rate", "1 Hz"],
              ["Read", fmtAgo(s.heardAt, now)],
            ]}
          />
          <Note>
            <span className="tnum">{fmtDuration(Math.max(0, s.heardAt - state.mission.startedAt))} · humidity last 60 s</span>
          </Note>
          <Foot>
            <Sparkline data={state.history.humidity.slice(-60)} color={t("status-info")} />
          </Foot>
        </>
      ) : (
        <Empty label="Climate sensor offline" />
      )}
    </Card>
  );
}

/* ---------------------------------------------------------------------- PIR */
export function PirPanel({ state }: { state: ConsoleState }) {
  const now = state.now;
  const s = state.sensors.pir;
  return (
    <Card
      title="Motion · PIR"
      sub="Body Detection"
      className="flex h-full flex-col shadow-sm"
      bodyClass="flex min-h-0 flex-1 flex-col p-3.5"
      right={s ? <WordChip word={s.state} tone={s.state === "MOTION" ? "warn" : "muted"} /> : <Fresh s={s} now={now} live />}
    >
      {s ? (
        <>
          <Big value={s.total.toString()} unit="Total Triggers" />
          <Stats
            items={[
              ["Rate (60s)", `${s.perMin}/min`],
              ["Last Trigger", s.lastSecs < 0 ? "never" : `${s.lastSecs}s ago`],
              ["State", s.state ?? "IDLE"],
              ["Read", fmtAgo(s.heardAt, now)],
            ]}
          />
          <Note>
            <span>{s.state === "MOTION" ? <span className="font-bold text-warn">motion · warm body in range</span> : "idle · scanning"}</span>
          </Note>
          <Foot>
            <div className="flex h-full items-end gap-1.5">
              {Array.from({ length: 20 }).map((_, i) => {
                const active = i >= 15 && s.state === "MOTION";
                return <div key={i} className="flex-1 rounded-sm bg-surface-2" style={{ height: active ? "72%" : "26%" }} />;
              })}
            </div>
          </Foot>
        </>
      ) : (
        <Empty label="PIR offline" />
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ VISION */
export function VisionPanel({ state }: { state: ConsoleState }) {
  const now = state.now;
  const v = state.sensors.vision;
  const det = v ? v : null;
  const recent = det && now - det.at < 90_000 ? det : null;
  const human = recent?.human ?? false;
  const age = det ? Math.round((now - det.at) / 1000) : null;
  return (
    <Card
      title="Vision · YOLO"
      sub="ESP32-CAM Detector"
      className="flex h-full flex-col shadow-sm"
      bodyClass="flex min-h-0 flex-1 flex-col p-3.5"
      right={
        det ? (
          recent ? (
            <WordChip word={human ? "HUMAN DETECTED" : "CLEAR"} tone={human ? "critical" : "muted"} />
          ) : (
            <FreshnessChip f="stale" heardAt={det.at} />
          )
        ) : (
          <FreshnessChip f="not_installed" />
        )
      }
    >
      {det ? (
        <>
          <Big
            value={human ? "PERSON" : "clear"}
            unit={human ? `conf ${Math.round(det.confidence * 100)}%` : "no target"}
            tone={human ? "text-critical" : undefined}
          />
          <Stats
            items={[
              ["Last Frame", human ? `${age ?? "0"}s ago` : "clear"],
              ["Classifier", "YOLOv8 Edge AI"],
              ["Model Target", "Person Class"],
              ["Status", recent ? "fresh" : "stale"],
            ]}
          />
          <Note>
            <span className="tnum">newest detector frame = current state</span>
          </Note>
        </>
      ) : (
        <Empty label="Vision offline" />
      )}
    </Card>
  );
}

/* -------------------------------------------------------------------- LINK */
export function LinkPanel({ state }: { state: ConsoleState }) {
  const now = state.now;
  const d = state.device;
  const age = d.lastSeenAt ? Math.max(0, Math.round((now - d.lastSeenAt) / 1000)) : null;
  return (
    <Card
      title="Robot Link"
      sub="Supabase Live Pipeline"
      className="flex h-full flex-col shadow-sm"
      bodyClass="flex min-h-0 flex-1 flex-col p-3.5"
      right={
        <FreshnessChip
          f={d.link === "online" ? "live" : d.link === "delayed" ? "delayed" : d.link === "offline" ? "offline" : "not_installed"}
          heardAt={d.lastSeenAt || undefined}
        />
      }
    >
      <Big
        value={d.link === "online" ? "ONLINE" : d.link === "delayed" ? "DELAYED" : "OFFLINE"}
        unit={age != null ? `${age}s ago` : "—"}
        tone={d.link === "online" ? "text-ok" : "text-critical"}
      />
      <Stats
        items={[
          ["Robot ID", state.mission.robotId?.toUpperCase() ?? "PAWS-01"],
          ["Cadence", "2s sampling"],
          ["Channel", "realtime + poll"],
          ["Heartbeat", age != null ? `${age}s` : "—"],
        ]}
      />
      <Note>
        <span>{d.link === "online" ? <span className="font-bold text-ok">link healthy · uploads landing</span> : "telemetry delayed"}</span>
      </Note>
    </Card>
  );
}
