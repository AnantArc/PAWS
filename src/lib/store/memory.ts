import type {
  Alert,
  AlertKind,
  Command,
  CommandStageName,
  ConsoleState,
  FeedEvent,
  LinkState,
  ScoreResult,
  ScoreWeights,
  SensorSnapshot,
} from "@/lib/types";
import type { TelemetryPayload } from "@/lib/contract";
import type { ConsoleStore, MissionTimeline } from "./types";
import { computeScores, DEFAULT_WEIGHTS, type FusionContext } from "@/lib/fusion/engine";
import { getDetectionProvider } from "@/lib/detection/provider";
import { Simulator } from "@/lib/simulator";
import { uid } from "@/lib/utils";

/**
 * MemoryStore — the local demo data layer.
 * Holds the full mission in memory, emits a snapshot to subscribers after
 * every mutation, and hands telemetry to the detection provider + fusion
 * engine exactly like the production path does. (Restart clears data — see
 * README; production persistence lives in SupabaseStore.)
 */

const SNAPSHOT_CAPS = {
  events: 500,
  alerts: 200,
  commands: 100,
  detections: 200,
  trail: 4000,
  scoreHistory: 600,
  history: 120,
};

export class MemoryStore implements ConsoleStore {
  readonly mode = "local" as const;

  private state: ConsoleState;
  private listeners = new Set<(s: ConsoleState) => void>();
  private alertCooldown: Partial<Record<AlertKind, number>> = {};
  private provider = getDetectionProvider();
  private camFrame = 0;
  private soundEventAt: number | null = null;
  private pirEventAt: number | null = null;
  private rebase: { xM: number; yM: number; setAt: number } = { xM: 0, yM: 0, setAt: Date.now() };
  private missionCount = 0;
  private sim: Simulator | null = null;

  /** Process-level counters: survive separate route-handler module graphs. */
  private static stats(): { ingestCount: number; lastIngestAt: number | null; startedAt: number } {
    const g = globalThis as unknown as {
      __pawsStats?: { ingestCount: number; lastIngestAt: number | null; startedAt: number };
    };
    if (!g.__pawsStats) g.__pawsStats = { ingestCount: 0, lastIngestAt: null, startedAt: Date.now() };
    return g.__pawsStats;
  }

  constructor() {
    const now = Date.now();
    const missionName = "Warehouse Sweep — Demo";
    this.state = {
      mode: "local",
      mission: {
        id: uid("mis"),
        name: missionName,
        status: "running",
        startedAt: now,
        origin: { xM: 0, yM: 0, setAt: now },
        robotId: "paws-01",
      },
      device: { deviceId: "paws-01", link: "online", lastSeenAt: now },
      sensors: {
        sound: null,
        gas: null,
        thermal: null,
        distance: null,
        tilt: null,
        position: null,
        camera: null,
        climate: null,
        pir: null,
        vision: null,
      },
      history: { sound: [], gas: [], thermalObj: [], distance: [], humidity: [] },
      rebase: { xM: 0, yM: 0, setAt: now },
      latestDetection: null,
      detections: [],
      trail: [],
      scoreHistory: [],
      events: [],
      alerts: [],
      commands: [],
      weights: { ...DEFAULT_WEIGHTS },
      simulated: true,
      now,
    };
    this.pushEvent("system", "info", `Mission "${missionName}" started — PAWS is walking.`);
    // Local demo mode: a scripted robot drives the exact same ingest path
    // that the real ESP32 will use. (Supabase mode has no simulator.)
    this.sim = new Simulator(this, this.getStateForSim());
    this.sim.start();
  }

  /** Called by the store selector when the LIVE ↔ DEMO switch drops this store. */
  dispose() {
    this.sim?.stop();
  }

  /** Sync snapshot for the simulator (no side effects). */
  private getStateForSim(): ConsoleState {
    return { ...this.state };
  }

  // ---------------------------------------------------------------- basics
  async getState(): Promise<ConsoleState> {
    return { ...this.state, now: Date.now() };
  }

  subscribe(fn: (s: ConsoleState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    const snap: ConsoleState = { ...this.state, now: Date.now() };
    for (const fn of this.listeners) {
      try {
        fn(snap);
      } catch {
        /* listener errors must never break the store */
      }
    }
  }

  health() {
    const s = MemoryStore.stats();
    return {
      uptimeSec: Math.round((Date.now() - s.startedAt) / 1000),
      ingestCount: s.ingestCount,
      lastIngestAt: s.lastIngestAt,
    };
  }

  // ------------------------------------------------------------- telemetry
  async ingest(payload: TelemetryPayload): Promise<void> {
    const stats = MemoryStore.stats();
    stats.ingestCount += 1;
    stats.lastIngestAt = Date.now();
    const s = this.state;
    const sensor = payload; // contract: sensor fields sit at the top level

    const next: ConsoleState = {
      ...s,
      device: { ...s.device, link: "online", lastSeenAt: Date.now() },
      sensors: { ...s.sensors },
    };

    if (sensor.sound) next.sensors.sound = { ...sensor.sound };
    if (sensor.gas) next.sensors.gas = { ...sensor.gas };
    if (sensor.thermal) next.sensors.thermal = { ...sensor.thermal };
    if (sensor.distance) next.sensors.distance = { ...sensor.distance };
    if (sensor.tilt) next.sensors.tilt = { ...sensor.tilt };
    if (sensor.climate) next.sensors.climate = { ...sensor.climate };
    if (sensor.pir) next.sensors.pir = { ...sensor.pir };

    // PIR live event (v2.9): MOTION transition → operator-facing note
    if (sensor.pir && sensor.pir.state === "MOTION" && Date.now() - (this.pirEventAt ?? 0) > 25000) {
      this.pirEventAt = Date.now();
      this.pushEvent(
        "detection",
        "warn",
        `Motion detected · ${sensor.pir.perMin}/min, total ${sensor.pir.total} since boot${sensor.pir.lastSecs >= 0 ? ` · last trigger ${sensor.pir.lastSecs} s ago` : ""}`
      );
    }

    // rolling true-history for the live charts (newest last)
    const push = (arr: number[], v: number | undefined) =>
      v === undefined ? arr : [...arr, v].slice(-SNAPSHOT_CAPS.history);
    next.history = {
      sound: push(s.history.sound, sensor.sound?.amp),
      gas: push(s.history.gas, sensor.gas?.ppm),
      thermalObj: push(s.history.thermalObj, sensor.thermal?.objectC),
      distance: push(s.history.distance, sensor.distance?.status === "valid" ? sensor.distance.mm : undefined),
      humidity: push(s.history.humidity, sensor.climate?.humidityPct),
    };

    if (sensor.position) {
      // Positions are ALWAYS kept in the device frame (absolute, firmware
      // origin). Re-anchoring is a DISPLAY-ONLY rebase: the renderer subtracts
      // state.rebase, so the origin visually moves to the robot while the
      // underlying data and the robot's on-screen position never jump.
      next.sensors.position = { ...sensor.position };
    }
    if (payload.camera) next.sensors.camera = { ...payload.camera };

    this.state = next;

    // ---- vision: run the pluggable detection provider --------------------
    if (payload.camera?.hasFrame) {
      this.camFrame += 1;
      const dets = await this.provider.detect({
        frameId: this.camFrame,
        ts: Date.now(),
        position: this.state.sensors.position
          ? { xM: this.state.sensors.position.xM, yM: this.state.sensors.position.yM }
          : undefined,
      });
      for (const d of dets) {
        this.state = {
          ...this.state,
          detections: [d, ...this.state.detections].slice(0, SNAPSHOT_CAPS.detections),
          latestDetection: d,
          sensors: {
            ...this.state.sensors,
            vision: { human: true, confidence: d.confidence, at: d.ts, source: "yolo" },
          },
        };
        const pos = d.position ? ` at (${d.position.xM.toFixed(1)}, ${d.position.yM.toFixed(1)}) m from origin` : "";
        this.pushEvent("detection", "success", `Person detected · confidence ${Math.round(d.confidence * 100)}%${pos}`);
        this.raiseAlert(
          "person_detected",
          "warn",
          `Person detected${d.position ? ` at (${d.position.xM.toFixed(1)}, ${d.position.yM.toFixed(1)}) m from origin` : " — check camera"}`,
          "person_detected"
        );
      }
    }

    // ---- loud sound events (v2.9 dB-aware) --------------------------------
    const loudPeak = sensor.sound?.peak ?? 0;
    const loudDb = sensor.sound?.db ?? 0;
    if ((loudPeak >= 0.6 || loudDb >= 72) && Date.now() - (this.soundEventAt ?? 0) > 20_000) {
      this.soundEventAt = Date.now();
      const detail = loudDb >= 72 ? `${Math.round(loudDb)} dB (${sensor.sound?.band ?? "LOUD"})` : `peak ${Math.round(loudPeak * 100)}% of range`;
      this.pushEvent("sound_event", "warn", `Loud sound event · ${detail}`);
      this.raiseAlert("sound_event", "warn", `Loud sound event — ${detail}`, "sound_event");
    }

    // ---- alert rules (cooldown-gated, v2.9 words) --------------------------
    if (sensor.gas && (sensor.gas.ppm >= 800 || sensor.gas.aqiBand === "VERY POOR" || sensor.gas.aqiBand === "SEVERE"))
      this.raiseAlert(
        "gas_high",
        "warn",
        `Gas concentration ${Math.round(sensor.gas.ppm)} ppm · AQI ${sensor.gas.aqiBand ?? "—"} — hazard zone`,
        "gas_high"
      );
    if (sensor.thermal && (sensor.thermal.objectC > 55 || sensor.thermal.zone === "FIRE RISK"))
      this.raiseAlert(
        "fire_risk",
        "critical",
        `Fire risk — surface temperature ${sensor.thermal.objectC.toFixed(1)} °C (zone: ${sensor.thermal.zone ?? "FIRE RISK"})`,
        "fire_risk"
      );
    if (sensor.distance && (sensor.distance.state === "STOP" || (sensor.distance.status === "valid" && sensor.distance.mm < 120)))
      this.raiseAlert(
        "obstacle",
        "info",
        `Obstacle ahead — ${sensor.distance.cm != null ? `${Math.round(sensor.distance.cm)} cm (sonar ${sensor.distance.state ?? ""})` : `${Math.round(sensor.distance.mm)} mm laser`} clearance`,
        "obstacle"
      );

    // ---- fusion: recompute every tick ------------------------------------
    this.computeAndAppendScore();
    this.emit();
  }

  /**
   * DISPLAY-ONLY rebase: the origin moves to the robot's current position.
   * All coordinates stay in the device frame; renderers subtract
   * state.rebase, so the robot never jumps and the trail stays continuous.
   */
  private anchorDisplayOrigin() {
    const p = this.state.sensors.position;
    if (!p) {
      this.pushEvent("system", "warn", "Re-anchor ignored — no position reading yet.");
      return;
    }
    this.rebase = { xM: p.xM, yM: p.yM, setAt: Date.now() };
    this.state = { ...this.state, rebase: this.rebase };
    this.pushEvent(
      "system",
      "success",
      `Origin re-anchored — coordinates now relative to the robot at (0, 0); the robot stays where it is on the map.`
    );
    this.emit();
  }

  async clearLink(lost: boolean): Promise<void> {
    this.state = {
      ...this.state,
      device: { ...this.state.device, link: lost ? "offline" : "online" },
    };
    if (lost) {
      this.raiseAlert("link_lost", "critical", "Robot link lost — showing last known state", "link_lost");
      this.pushEvent("link", "critical", "Robot link lost — Wi-Fi timeout. Showing last known state.");
    } else {
      this.pushEvent("link", "success", "Robot link restored.");
    }
    this.emit();
  }

  // ----------------------------------------------------------------- score
  private computeAndAppendScore() {
    const s = this.state;
    const ctx = this.buildFusionContext();
    const score: ScoreResult = computeScores(ctx);
    const p = s.sensors.position;
    const trailEntry = p
      ? {
          xM: p.xM,
          yM: p.yM,
          ts: Date.now(),
          score: score.survivor.value,
          hazard: score.hazard.value,
          gasPpm: s.sensors.gas?.ppm ?? 0,
        }
      : null;
    this.state = {
      ...this.state,
      scoreHistory: [...this.state.scoreHistory, score].slice(-SNAPSHOT_CAPS.scoreHistory),
      trail: trailEntry ? [...this.state.trail, trailEntry].slice(-SNAPSHOT_CAPS.trail) : this.state.trail,
    };
  }

  private buildFusionContext(): FusionContext {
    const s = this.state;
    const soundEvents = s.events.filter((e) => e.kind === "sound_event").sort((a, b) => b.ts - a.ts);
    const effectiveNow = s.mission.status === "paused" && s.mission.pausedAt ? s.mission.pausedAt : Date.now();
    return {
      now: effectiveNow,
      sound: s.sensors.sound,
      gas: s.sensors.gas,
      thermal: s.sensors.thermal,
      distance: s.sensors.distance,
      tilt: s.sensors.tilt,
      position: s.sensors.position,
      link: s.device.link,
      detections: s.detections,
      soundEvents,
      weights: s.weights,
    };
  }

  // ---------------------------------------------------------------- feed
  pushEvent(
    kind: FeedEvent["kind"],
    level: FeedEvent["level"],
    text: string,
    snapshotPartial: Partial<SensorSnapshot> = {},
    refId?: string
  ) {
    const snapshot: SensorSnapshot = {
      sound: this.state.sensors.sound ?? undefined,
      gas: this.state.sensors.gas ?? undefined,
      thermal: this.state.sensors.thermal ?? undefined,
      distance: this.state.sensors.distance ?? undefined,
      tilt: this.state.sensors.tilt ?? undefined,
      position: this.state.sensors.position ?? undefined,
      detection: this.state.latestDetection ?? undefined,
      ...snapshotPartial,
    };
    const ev: FeedEvent = { id: uid("evt"), ts: Date.now(), kind, level, text, snapshot, refId };
    this.state = { ...this.state, events: [ev, ...this.state.events].slice(0, SNAPSHOT_CAPS.events) };
    this.emit();
  }

  // --------------------------------------------------------------- alerts
  private raiseAlert(kind: AlertKind, severity: Alert["severity"], message: string, throttleKey: AlertKind) {
    const now = Date.now();
    if (now - (this.alertCooldown[throttleKey] ?? 0) < 30_000) return;
    this.alertCooldown[throttleKey] = now;
    const alert: Alert = { id: uid("alr"), ts: now, kind, severity, message };
    this.state = { ...this.state, alerts: [alert, ...this.state.alerts].slice(0, SNAPSHOT_CAPS.alerts) };
    if (kind !== "command")
      this.pushEvent("alert", severity === "critical" ? "critical" : "warn", `ALERT — ${message}`, {}, alert.id);
  }

  async ackAlert(id: string, who: string): Promise<void> {
    this.state = {
      ...this.state,
      alerts: this.state.alerts.map((a) => (a.id === id ? { ...a, ackedBy: who, ackedAt: Date.now() } : a)),
    };
    this.pushEvent("system", "info", `Alert acknowledged by ${who}.`);
    this.emit();
  }

  // -------------------------------------------------------------- mission
  async startMission(name: string, robotId?: string): Promise<void> {
    const now = Date.now();
    this.missionCount += 1;
    this.state = {
      ...this.state,
      mission: {
        id: uid("mis"),
        name: this.missionCount === 0 ? name : `${name} #${this.missionCount + 1}`,
        status: "running",
        startedAt: now,
        origin: { xM: 0, yM: 0, setAt: now },
        robotId: robotId ?? "paws-01",
      },
      trail: [],
      scoreHistory: [],
      events: [],
      alerts: [],
      commands: [],
      detections: [],
      history: { sound: [], gas: [], thermalObj: [], distance: [], humidity: [] },
      latestDetection: null,
      rebase: { xM: 0, yM: 0, setAt: now },
      sensors: {
        ...this.state.sensors,
        position: null,
        vision: null,
        pir: null,
        climate: null,
      },
    };
    this.rebase = { xM: 0, yM: 0, setAt: now };
    this.pushEvent("mission", "success", `Mission "${name}" started. Origin anchored at (0, 0).`);
    this.emit();
    // Fresh robot for the fresh mission — old walker is stopped, never leaked.
    this.sim?.stop();
    this.sim = new Simulator(this, this.getStateForSim());
    this.sim.start();
  }

  async pauseMission(): Promise<void> {
    if (this.state.mission.status !== "running") return;
    this.state = { ...this.state, mission: { ...this.state.mission, status: "paused", pausedAt: Date.now() } };
    this.pushEvent("mission", "info", "Mission paused by operator.");
    this.emit();
  }

  async resumeMission(): Promise<void> {
    if (this.state.mission.status !== "paused") return;
    this.state = { ...this.state, mission: { ...this.state.mission, status: "running" } };
    this.pushEvent("mission", "success", "Mission resumed by operator.");
    this.emit();
  }

  async endMission(): Promise<void> {
    if (this.state.mission.status === "ended") return;
    this.state = { ...this.state, mission: { ...this.state.mission, status: "ended", endedAt: Date.now() } };
    this.pushEvent("mission", "info", "Mission ended.");
    this.emit();
  }

  // ------------------------------------------------------------- commands
  async issueCommand(input: {
    type: Command["type"];
    params: Record<string, string>;
    issuedBy: string;
  }): Promise<Command> {
    const cmd: Command = {
      id: uid("cmd"),
      type: input.type,
      params: input.params,
      issuedBy: input.issuedBy,
      issuedAt: Date.now(),
      stages: [{ stage: "queued", at: Date.now() }],
      current: "queued",
    };
    this.state = {
      ...this.state,
      commands: [cmd, ...this.state.commands].slice(0, SNAPSHOT_CAPS.commands),
      mission: { ...this.state.mission, pausedAt: this.state.mission.pausedAt },
    };
    this.pushEvent("command", "info", `Command ${label(cmd.type)} issued by ${input.issuedBy} — queued.`, {
      position: this.state.sensors.position ?? undefined,
    });
    this.emit();
    // Re-anchor is a DISPLAY-ONLY rebase: the origin moves to the robot's
    // current position immediately (no firmware action exists for it yet).
    if (cmd.type === "re_anchor") this.anchorDisplayOrigin();
    return cmd;
  }

  async updateCommandStage(id: string, stage: CommandStageName, note?: string): Promise<void> {
    const cmds = this.state.commands.map((c) =>
      c.id === id ? { ...c, current: stage, stages: [...c.stages, { stage, at: Date.now(), note }] } : c
    );
    const target = cmds.find((c) => c.id === id);
    if (!target) return;
    this.state = { ...this.state, commands: cmds };
    const verb =
      stage === "delivered"
        ? "received by robot"
        : stage === "acknowledged"
          ? "acknowledged by robot"
          : stage === "done"
            ? "completed"
            : stage === "failed"
              ? "FAILED"
              : "queued";
    if (stage !== "queued")
      this.pushEvent(
        "command",
        stage === "failed" ? "critical" : "success",
        `Command ${label(target.type)} ${verb}.`
      );
    this.emit();
  }

  // --------------------------------------------------------------- weights
  async setWeights(w: Partial<ScoreWeights>): Promise<ScoreWeights> {
    const next: ScoreWeights = { ...this.state.weights, ...w, version: "2.1" };
    this.state = { ...this.state, weights: next };
    this.pushEvent(
      "system",
      "info",
      `Fusion weights updated (vision ${next.vision}, sound ${next.sound}, thermal ${next.thermal}).`
    );
    this.emit();
    return next;
  }

  // ---------------------------------------------------------------- replay
  async getMissionTimeline(missionId: string): Promise<MissionTimeline | null> {
    if (missionId !== this.state.mission.id) return null;
    const s = this.state;
    return {
      mission: s.mission,
      trail: [...s.trail],
      scoreHistory: [...s.scoreHistory],
      events: [...s.events],
      detections: [...s.detections],
      commands: [...s.commands],
      alerts: [...s.alerts],
    };
  }

  async listMissions() {
    const m = this.state.mission;
    return [
      { id: m.id, name: m.name, status: m.status, startedAt: m.startedAt, endedAt: m.endedAt },
    ];
  }

  async listRobots(): Promise<Array<{ id: string; name: string }>> {
    // Local demo mode: one robot. Supabase mode reads the robots table.
    return [{ id: "paws-01", name: "PAWS Alpha" }];
  }
}

function label(t: Command["type"]): string {
  switch (t) {
    case "estop":
      return "EMERGENCY STOP";
    case "resume":
      return "Resume";
    case "re_anchor":
      return "Re-anchor origin";
    case "deploy_payload":
      return "Drop Survivor's Kit";
    case "set_mode":
      return "Set mode";
  }
}
