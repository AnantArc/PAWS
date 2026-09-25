import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import type {
  Alert,
  AlertKind,
  ClimateReading,
  Command,
  CommandStageName,
  ConsoleState,
  Detection,
  DistanceReading,
  FeedEvent,
  GasReading,
  Mission,
  PirReading,
  PositionReading,
  ScoreResult,
  ScoreWeights,
  SoundReading,
  ThermalReading,
  TiltReading,
  TrailPoint,
  VisionReading,
} from "@/lib/types";
import type { TelemetryPayload } from "@/lib/contract";
import type { ConsoleStore, MissionTimeline } from "./types";
import { computeScores, DEFAULT_WEIGHTS } from "@/lib/fusion/engine";
import { uid } from "@/lib/utils";

/**
 * SupabaseStore — the production data layer (DB v2, single live row).
 *
 * HOW IT WORKS NOW:
 *  - The robot (ESP32) POSTs its 37-field v2.9 payload with the fixed
 *    primary key id=1 (merge-duplicates). The DATABASE trigger rewrites the
 *    row into one self-updating live row: sensors, ts, mission id, payload,
 *    plus the single mission_state row. NO console writes to telemetry.
 *  - The ESP32-CAM detector writes `person`/`none` rows into `detections`
 *    (newest row = current vision state).
 *  - This store READS: latest running mission → mission_state (sensors) →
 *    detections (vision) → events/commands/alerts/weights. It derives the
 *    rolling chart history, trail, fusion scores, sound events and alerts
 *    CLIENT-SIDE (in this server process) from the live sensor map.
 *  - Realtime pushes: telemetry INSERT+UPDATE, mission_state UPDATE,
 *    detections INSERT → broadcast to every console client. 3 s poll is
 *    the safety net.
 */

const CAPS = { events: 500, alerts: 200, commands: 100, detections: 200, trail: 4000, scoreHistory: 600, history: 120 };

export class SupabaseStore implements ConsoleStore {
  readonly mode = "supabase" as const;
  private db: SupabaseClient;
  private listeners = new Set<(s: ConsoleState) => void>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private rtChannel: RealtimeChannel | null = null;
  private startedAt = Date.now();

  // ---- client-side derivation state (per process, per mission) ----
  private cache = {
    missionId: "",
    sensorsTs: 0,
    lastSoundEventAt: 0,
    lastPirAt: 0,
    alertCooldown: {} as Partial<Record<AlertKind, number>>,
    history: { sound: [] as number[], gas: [] as number[], thermalObj: [] as number[], distance: [] as number[], humidity: [] as number[] },
    trail: [] as TrailPoint[],
    scoreHistory: [] as ScoreResult[],
    events: [] as FeedEvent[],
    alerts: [] as Alert[],
    synthSoundEvents: [] as FeedEvent[],
    lastTrailTs: 0,
    rebase: { xM: 0, yM: 0, setAt: 0 },
  };

  /** Serialises derivation batches so concurrent events never race. */
  private chain: Promise<void> = Promise.resolve();

  constructor() {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error("SupabaseStore requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY");
    }
    this.db = createClient(url, key, { auth: { persistSession: false } });
  }

  /** Called by the store selector when the LIVE ↔ DEMO switch swaps stores. */
  dispose(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.rtChannel) {
      void this.db.removeChannel(this.rtChannel);
      this.rtChannel = null;
    }
    this.listeners.clear();
  }

  private emptyState(): ConsoleState {
    const now = Date.now();
    return {
      mode: "supabase",
      mission: {
        id: "",
        name: "—",
        status: "idle",
        startedAt: now,
        origin: { xM: 0, yM: 0, setAt: now },
      },
      device: { deviceId: "paws-01", link: "offline", lastSeenAt: now },
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
      rebase: this.cache.rebase,
      latestDetection: null,
      detections: [],
      trail: [],
      scoreHistory: [],
      events: [],
      alerts: [],
      commands: [],
      weights: { ...DEFAULT_WEIGHTS },
      simulated: false,
      now,
    };
  }

  async getState(): Promise<ConsoleState> {
    return (await this.derive()) ?? this.emptyState();
  }

  private async derive(): Promise<ConsoleState | null> {
    const run = this.chain.then(() => this.deriveInner());
    this.chain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  private async deriveInner(): Promise<ConsoleState | null> {
    // 1) mission: latest running, else latest
    let { data: missions } = await this.db
      .from("missions")
      .select("*")
      .eq("status", "running")
      .order("started_at", { ascending: false })
      .limit(1);
    if (!missions?.[0]) {
      ({ data: missions } = await this.db.from("missions").select("*").order("started_at", { ascending: false }).limit(1));
    }
    const missionRow = missions?.[0];
    if (!missionRow) return null;

    const [stRow, detRows, evRows, cmdRows, alrRows, wRow] = await Promise.all([
      this.db.from("mission_state").select("*").eq("mission_id", missionRow.id).limit(1),
      this.db.from("detections").select("*").order("ts", { ascending: false }).limit(100),
      this.db.from("events").select("*").order("ts", { ascending: false }).limit(50),
      this.db.from("commands").select("*").order("issued_at", { ascending: false }).limit(50),
      this.db.from("alerts").select("*").order("ts", { ascending: false }).limit(50),
      this.db.from("fusion_weights").select("*").limit(1),
    ]);

    const now = Date.now();
    const st = stRow?.data?.[0];
    const sensorMap = (st?.sensors as Record<string, unknown>) ?? {};
    const updatedAt = st?.updated_at ? new Date(String(st.updated_at)).getTime() : 0;
    const link = !updatedAt ? "offline" : now - updatedAt < 12000 ? "online" : now - updatedAt < 60000 ? "delayed" : "offline";

    // ==== LOCAL DERIVATION (new mission → reset caches) ====
    if (this.cache.missionId !== missionRow.id) {
      this.cache.missionId = missionRow.id;
      this.cache.history = { sound: [], gas: [], thermalObj: [], distance: [], humidity: [] };
      this.cache.trail = [];
      this.cache.scoreHistory = [];
      this.cache.events = [];
      this.cache.alerts = [];
      this.cache.synthSoundEvents = [];
      this.cache.lastTrailTs = 0;
      this.cache.rebase = { xM: 0, yM: 0, setAt: now };
    }

    const sensors = this.mapSensors(sensorMap, missionRow, updatedAt, now);
    const detections = (detRows?.data ?? []).map(mapDetection);
    const vision = this.deriveVision(detections, now);

    // rolling history (only when a NEW reading arrived)
    if (sensors.sound?.heardAt && sensors.sound.heardAt !== this.cache.sensorsTs) {
      this.cache.sensorsTs = sensors.sound.heardAt;
      this.cache.history.sound = push(this.cache.history.sound, sensors.sound.amp, CAPS.history);
      this.cache.history.gas = push(this.cache.history.gas, sensors.gas?.ppm, CAPS.history);
      this.cache.history.thermalObj = push(this.cache.history.thermalObj, sensors.thermal?.objectC, CAPS.history);
      this.cache.history.distance = push(
        this.cache.history.distance,
        sensors.distance?.status === "valid" ? sensors.distance.mm : undefined,
        CAPS.history
      );
      this.cache.history.humidity = push(this.cache.history.humidity, sensors.climate?.humidityPct, CAPS.history);
    }

    // local sensor events + alerts (cooldown-gated) — DB rows stay as-is
    const sensorEvent = this.sensorEvent(sensors, now);
    if (sensorEvent.events.length || sensorEvent.alerts.length) {
      this.cache.events = [...sensorEvent.events, ...this.cache.events].slice(0, CAPS.events);
      this.cache.alerts = [...sensorEvent.alerts, ...this.cache.alerts].slice(0, CAPS.alerts);
    }

    // vision: person detected → detection alert (once per sighting)
    if (vision?.human && vision.at > this.cache.lastTrailTs - 1) {
      const key = "person_detected" as AlertKind;
      if (now - (this.cache.alertCooldown[key] ?? 0) > 30_000) {
        this.cache.alertCooldown[key] = now;
        const personAlert: Alert = {
          id: uid("alr"),
          ts: now,
          kind: key,
          severity: "warn",
          message: `Person detected · confidence ${Math.round(vision.confidence * 100)}%${sensors.position ? ` at (${sensors.position.xM.toFixed(1)}, ${sensors.position.yM.toFixed(1)}) m from origin` : " — check camera"}`,
        };
        this.cache.alerts = [personAlert, ...this.cache.alerts].slice(0, CAPS.alerts);
        const personEvent: FeedEvent = {
          id: uid("evt"),
          ts: now,
          kind: "detection",
          level: "success",
          text: `Person detected · confidence ${Math.round(vision.confidence * 100)}%`,
          snapshot: { position: sensors.position ?? undefined },
        };
        this.cache.events = [personEvent, ...this.cache.events].slice(0, CAPS.events);
      }
    }

    // fusion + trail (local derivation, same engine as demo mode)
    const score = computeScores({
      now,
      sound: sensors.sound,
      gas: sensors.gas,
      thermal: sensors.thermal,
      distance: sensors.distance,
      tilt: sensors.tilt,
      position: sensors.position,
      link,
      detections,
      soundEvents: (evRows?.data ?? []).map(mapEvent).concat(this.cache.synthSoundEvents),
      weights: wRow?.data?.[0]
        ? {
            ...DEFAULT_WEIGHTS,
            vision: wRow.data[0].vision,
            sound: wRow.data[0].sound,
            thermal: wRow.data[0].thermal,
            version: (wRow.data[0].version as string) ?? "2.1",
          }
        : { ...DEFAULT_WEIGHTS },
    });
    this.cache.scoreHistory = [...this.cache.scoreHistory, score].slice(-CAPS.scoreHistory);
    if (sensors.position && sensors.position.heardAt !== this.cache.lastTrailTs) {
      this.cache.lastTrailTs = sensors.position.heardAt;
      this.cache.trail = [
        ...this.cache.trail,
        {
          xM: sensors.position.xM,
          yM: sensors.position.yM,
          ts: sensors.position.heardAt,
          score: score.survivor.value,
          hazard: score.hazard.value,
          gasPpm: sensors.gas?.ppm ?? 0,
        },
      ].slice(-CAPS.trail);
    }

    const m: Mission = {
      id: missionRow.id,
      name: missionRow.name,
      status: missionRow.status,
      startedAt: new Date(missionRow.started_at).getTime(),
      endedAt: missionRow.ended_at ? new Date(missionRow.ended_at).getTime() : undefined,
      origin: (missionRow.origin as Mission["origin"]) ?? { xM: 0, yM: 0, setAt: new Date(missionRow.started_at).getTime() },
      robotId: (missionRow.robot_id as string | undefined) ?? undefined,
    };

    return {
      mode: "supabase",
      mission: m,
      device: { deviceId: "paws-01", link, lastSeenAt: updatedAt },
      sensors,
      history: this.cache.history,
      rebase: this.cache.rebase,
      latestDetection: detections.filter((d) => (now - d.ts < 5 * 60_000)).sort((a, b) => b.ts - a.ts)[0] ?? null,
      detections,
      trail: this.cache.trail,
      scoreHistory: this.cache.scoreHistory,
      events: [...this.cache.events, ...(evRows?.data ?? []).map(mapEvent)].slice(0, CAPS.events),
      alerts: [...this.cache.alerts, ...(alrRows?.data ?? []).map(mapAlert)].slice(0, CAPS.alerts),
      commands: (cmdRows?.data ?? []).map(mapCommand),
      weights: wRow?.data?.[0]
        ? {
            vision: wRow.data[0].vision,
            sound: wRow.data[0].sound,
            thermal: wRow.data[0].thermal,
            hazardGas: DEFAULT_WEIGHTS.hazardGas,
            hazardTemp: DEFAULT_WEIGHTS.hazardTemp,
            accClearance: DEFAULT_WEIGHTS.accClearance,
            accTilt: DEFAULT_WEIGHTS.accTilt,
            accLink: DEFAULT_WEIGHTS.accLink,
            version: (wRow.data[0].version as string) ?? "2.1",
          }
        : { ...DEFAULT_WEIGHTS },
      simulated: false,
      now,
    };
  }

  /** mission_state.sensors (trigger-built JSONB) → typed console sensors. */
  private mapSensors(
    s: Record<string, unknown>,
    missionRow: Record<string, unknown>,
    updatedAt: number,
    now: number
  ): ConsoleState["sensors"] {
    const soundRaw = (s.sound ?? null) as Record<string, unknown> | null;
    const gasRaw = (s.gas ?? null) as Record<string, unknown> | null;
    const thermalRaw = (s.thermal ?? null) as Record<string, unknown> | null;
    const distRaw = (s.distance ?? null) as Record<string, unknown> | null;
    const laserRaw = (s.laser ?? null) as Record<string, unknown> | null;
    const imuRaw = (s.imu ?? null) as Record<string, unknown> | null;
    const climateRaw = (s.climate ?? null) as Record<string, unknown> | null;
    const pirRaw = (s.pir ?? null) as Record<string, unknown> | null;
    const odomRaw = (s.odom ?? null) as Record<string, unknown> | null;
    const heard = (r: Record<string, unknown> | null) => Number(r?.heardAt ?? updatedAt);

    const sound: SoundReading | null = soundRaw
      ? {
          amp: Number(soundRaw.amp ?? 0),
          baseline: Number(soundRaw.baseline ?? 0.07),
          peak: Number(soundRaw.peak ?? 0.12),
          db: soundRaw.db != null ? Number(soundRaw.db) : undefined,
          band: soundRaw.band ? String(soundRaw.band) : undefined,
          peakDb: soundRaw.peakDb != null ? Number(soundRaw.peakDb) : undefined,
          heardAt: heard(soundRaw),
        }
      : null;

    const gas: GasReading | null = gasRaw
      ? {
          ppm: Number(gasRaw.ppm ?? 0),
          adc: Number(gasRaw.adc ?? 0),
          smoke: gasRaw.smoke != null ? Number(gasRaw.smoke) : undefined,
          aqiBand: gasRaw.aqiBand ? String(gasRaw.aqiBand) : undefined,
          warming: gasRaw.warming != null ? Boolean(gasRaw.warming) : undefined,
          heardAt: heard(gasRaw),
        }
      : null;

    const thermal: ThermalReading | null = thermalRaw
      ? {
          objectC: Number(thermalRaw.objectC ?? 0),
          ambientC: Number(thermalRaw.ambientC ?? 0),
          deltaC: thermalRaw.deltaC != null ? Number(thermalRaw.deltaC) : undefined,
          zone: thermalRaw.zone ? String(thermalRaw.zone) : undefined,
          heardAt: heard(thermalRaw),
        }
      : null;

    const cm = distRaw?.cm != null ? Number(distRaw.cm) : undefined;
    const mmRaw = laserRaw?.mm != null ? Number(laserRaw.mm) : distRaw?.mm != null ? Number(distRaw.mm) : undefined;
    const distance: DistanceReading | null =
      distRaw || laserRaw
        ? {
            mm: mmRaw && mmRaw > 0 ? mmRaw : cm != null && cm > 0 ? cm * 10 : 0,
            status: mmRaw && mmRaw > 0 ? ("valid" as const) : cm != null && cm > 0 ? ("valid" as const) : ("signal_fail" as const),
            source: laserRaw?.mm != null ? ("vl53l0x" as const) : ("hc-sr04" as const),
            cm,
            cmLeft: distRaw?.cmLeft != null ? Number(distRaw.cmLeft) : undefined,
            cmRight: distRaw?.cmRight != null ? Number(distRaw.cmRight) : undefined,
            state: distRaw?.state ? String(distRaw.state) : undefined,
            laserState: laserRaw?.state ? String(laserRaw.state) : undefined,
            match: laserRaw?.match ? String(laserRaw.match) : undefined,
            heardAt: heard(distRaw ?? laserRaw),
          }
        : null;

    const tilt: TiltReading | null = imuRaw
      ? {
          pitchDeg: Number(imuRaw.pitchDeg ?? 0),
          rollDeg: Number(imuRaw.rollDeg ?? 0),
          attitude: imuRaw.attitude ? String(imuRaw.attitude) : undefined,
          headingDeg: imuRaw.headingDeg != null ? Number(imuRaw.headingDeg) : undefined,
          heardAt: heard(imuRaw),
        }
      : null;

    const climate: ClimateReading | null = climateRaw
      ? {
          tempC: Number(climateRaw.tempC ?? 0),
          humidityPct: Number(climateRaw.humidityPct ?? 0),
          band: climateRaw.band ? String(climateRaw.band) : undefined,
          heardAt: heard(climateRaw),
        }
      : null;

    const pir: PirReading | null = pirRaw
      ? {
          state: String(pirRaw.state ?? "IDLE") === "MOTION" ? "MOTION" : "IDLE",
          total: Number(pirRaw.total ?? 0),
          perMin: Number(pirRaw.perMin ?? 0),
          lastSecs: Number(pirRaw.lastSecs ?? -1),
          heardAt: heard(pirRaw),
        }
      : null;

    let position: PositionReading | null = null;
    if (odomRaw && odomRaw.xCm != null) {
      const started = new Date(String(missionRow.started_at ?? Date.now())).getTime();
      const mins = Math.max(0, (now - started) / 60000);
      position = {
        xM: Number(odomRaw.xCm) / 100,
        yM: Number(odomRaw.yCm) / 100,
        headingDeg: odomRaw.headingDeg != null ? Number(odomRaw.headingDeg) : 0,
        driftM: Math.min(1.4, Math.round((0.2 + mins * 0.05) * 10) / 10),
        mode: "estimated_imu_odometry",
        origin: (missionRow.origin as PositionReading["origin"]) ?? { xM: 0, yM: 0, setAt: started },
        heardAt: heard(odomRaw),
      };
    }

    return {
      sound,
      gas,
      thermal,
      distance,
      tilt,
      position,
      camera: null, // stills/model frames don't stream to the DB; the panel live-previews via CAM_URL
      climate,
      pir,
      vision: null, // filled by deriveVision
    };
  }

  /** Newest detections row = current state; person rows = detection history. */
  private deriveVision(detections: Detection[], now: number): VisionReading | null {
    if (detections.length === 0) return null;
    const latest = detections[0]; // ordered desc by ts
    const person = detections.filter((d) => d.label === "person" && now - d.ts < 5 * 60_000)[0];
    return {
      human: latest.label === "person",
      confidence: latest.label === "person" ? latest.confidence : person?.confidence ?? 0,
      at: latest.ts,
      source: "yolo",
    };
  }

  /** Local, cooldown-gated sensor events/alerts (v2.9 words). */
  private sensorEvent(
    s: ConsoleState["sensors"],
    now: number
  ): { events: FeedEvent[]; alerts: Alert[] } {
    const events: FeedEvent[] = [];
    const alerts: Alert[] = [];
    const hit = (key: AlertKind, ms: number) => {
      if (now - (this.cache.alertCooldown[key] ?? 0) < ms) return false;
      this.cache.alertCooldown[key] = now;
      return true;
    };

    if (s.sound && (s.sound.db ?? 0) >= 72 && hit("sound_event", 20_000)) {
      events.push({
        id: uid("evt"),
        ts: now,
        kind: "sound_event",
        level: "warn",
        text: `Loud sound event · ${Math.round(s.sound.db!)} dB (${s.sound.band ?? "LOUD"})`,
        snapshot: { sound: s.sound },
      });
      alerts.push({ id: uid("alr"), ts: now, kind: "sound_event", severity: "warn", message: `Loud sound event — ${Math.round(s.sound.db!)} dB` });
    }
    if (s.gas && (s.gas.ppm >= 800 || s.gas.aqiBand === "VERY POOR" || s.gas.aqiBand === "SEVERE") && hit("gas_high", 30_000)) {
      alerts.push({
        id: uid("alr"),
        ts: now,
        kind: "gas_high",
        severity: "warn",
        message: `Gas concentration ${Math.round(s.gas.ppm)} ppm · AQI ${s.gas.aqiBand ?? "—"} — hazard zone`,
      });
      events.push({ id: uid("evt"), ts: now, kind: "alert", level: "warn", text: `ALERT — gas ${Math.round(s.gas.ppm)} ppm (${s.gas.aqiBand ?? "hazard"})`, snapshot: { gas: s.gas } });
    }
    if (s.thermal && (s.thermal.objectC > 55 || s.thermal.zone === "FIRE RISK") && hit("fire_risk", 30_000)) {
      alerts.push({ id: uid("alr"), ts: now, kind: "fire_risk", severity: "critical", message: `Fire risk — surface temperature ${s.thermal.objectC.toFixed(1)} °C` });
      events.push({ id: uid("evt"), ts: now, kind: "alert", level: "critical", text: `ALERT — fire risk at ${s.thermal.objectC.toFixed(1)} °C`, snapshot: { thermal: s.thermal } });
    }
    if (s.distance && (s.distance.state === "STOP" || (s.distance.status === "valid" && s.distance.mm < 120)) && hit("obstacle", 30_000)) {
      alerts.push({
        id: uid("alr"),
        ts: now,
        kind: "obstacle",
        severity: "info",
        message: `Obstacle ahead — ${s.distance.cm != null ? `${Math.round(s.distance.cm)} cm (${s.distance.state ?? "STOP"})` : `${Math.round(s.distance.mm)} mm laser`}`,
      });
    }
    if (s.pir && s.pir.state === "MOTION" && hit("person_detected", 25_000)) {
      events.push({
        id: uid("evt"),
        ts: now,
        kind: "detection",
        level: "warn",
        text: `Motion detected · ${s.pir.perMin}/min, ${s.pir.total} total since boot${s.pir.lastSecs >= 0 ? ` · last ${s.pir.lastSecs} s ago` : ""}`,
        snapshot: { pir: s.pir },
      });
    }
    return { events, alerts };
  }

  // ----------------------------------------------------------------- realtime
  subscribe(fn: (s: ConsoleState) => void): () => void {
    this.listeners.add(fn);

    if (!this.rtChannel) {
      this.rtChannel = this.db
        .channel("paws-live")
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "telemetry" }, () => this.broadcast())
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "telemetry" }, () => this.broadcast())
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "mission_state" }, () => this.broadcast())
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "detections" }, () => this.broadcast())
        .subscribe();
    }

    if (!this.pollTimer) {
      this.pollTimer = setInterval(() => void this.broadcast(), 1500);
    }

    return () => {
      this.listeners.delete(fn);
      if (this.listeners.size === 0) {
        if (this.pollTimer) {
          clearInterval(this.pollTimer);
          this.pollTimer = null;
        }
        if (this.rtChannel) {
          void this.db.removeChannel(this.rtChannel);
          this.rtChannel = null;
        }
      }
    };
  }

  private broadcasting = false;
  private broadcast(): void {
    if (this.broadcasting) return;
    this.broadcasting = true;
    void this.getState()
      .then((snap) => {
        this.broadcasting = false;
        for (const l of this.listeners) l(snap);
      })
      .catch(() => {
        this.broadcasting = false;
      });
  }

  health() {
    return { uptimeSec: Math.round((Date.now() - this.startedAt) / 1000), ingestCount: 0, lastIngestAt: null };
  }

  // ------------------------------------------------------------- telemetry
  async ingest(payload: TelemetryPayload): Promise<void> {
    // Console-side test/seed path only — the robot writes direct to Supabase.
    let mission = await this.currentMissionId();
    if (!mission) return;
    await this.db.from("telemetry").insert({
      mission_id: mission,
      device_id: payload.deviceId,
      ts: payload.ts,
      payload,
    });
    void this.broadcast();
  }

  private async currentMissionId(): Promise<string> {
    const { data } = await this.db.from("missions").select("id").eq("status", "running").order("started_at", { ascending: false }).limit(1);
    return data?.[0]?.id ?? "";
  }

  // -------------------------------------------------------------- mission
  async startMission(name: string, robotId?: string): Promise<void> {
    const robot = robotId ?? "paws-01";
    const id = uid("mis");
    await this.db.from("robots").upsert({ id: robot, name: `PAWS ${robot.toUpperCase()}` }, { onConflict: "id" });
    await this.db.from("missions").insert({
      id,
      name,
      status: "running",
      started_at: new Date().toISOString(),
      origin: { xM: 0, yM: 0, setAt: Date.now() },
      robot_id: robot,
    });
    await this.db.from("events").insert({
      id: uid("evt"),
      mission_id: id,
      ts: Date.now(),
      kind: "mission",
      level: "success",
      text: `Mission "${name}" started for robot ${robot}. Origin anchored at (0, 0).`,
      snapshot: {},
    });
    this.cache.missionId = "";
    void this.broadcast();
  }

  async listRobots(): Promise<Array<{ id: string; name: string }>> {
    const { data } = await this.db.from("robots").select("id, name").order("id", { ascending: true }).limit(100);
    return data ?? [];
  }

  async pauseMission(): Promise<void> {
    const id = await this.currentMissionId();
    if (!id) return;
    await this.db.from("missions").update({ status: "paused" }).eq("id", id);
    void this.broadcast();
  }

  async resumeMission(): Promise<void> {
    const id = await this.currentMissionId();
    if (!id) return;
    await this.db.from("missions").update({ status: "running" }).eq("id", id);
    void this.broadcast();
  }

  async endMission(): Promise<void> {
    const id = await this.currentMissionId();
    if (!id) return;
    await this.db.from("missions").update({ status: "ended", ended_at: new Date().toISOString() }).eq("id", id);
    void this.broadcast();
  }

  async issueCommand(input: { type: Command["type"]; params: Record<string, string>; issuedBy: string }): Promise<Command> {
    const id = await this.currentMissionId();
    const cmd: Command = {
      id: uid("cmd"),
      type: input.type,
      params: input.params,
      issuedBy: input.issuedBy,
      issuedAt: Date.now(),
      stages: [{ stage: "queued", at: Date.now() }],
      current: "queued",
    };
    if (id) {
      await this.db.from("commands").insert({
        id: cmd.id,
        mission_id: id,
        type: cmd.type,
        params: cmd.params,
        issued_by: cmd.issuedBy,
        issued_at: cmd.issuedAt,
        current: "queued",
        stages: cmd.stages,
      });
    }
    // Re-anchor = display-only rebase: origin moves to the robot NOW.
    if (cmd.type === "re_anchor") {
      const s = await this.getState();
      if (s.sensors.position) {
        this.cache.rebase = { xM: s.sensors.position.xM, yM: s.sensors.position.yM, setAt: Date.now() };
      }
    }
    void this.broadcast();
    return cmd;
  }

  async updateCommandStage(id: string, stage: CommandStageName, note?: string): Promise<void> {
    const { data } = await this.db.from("commands").select("stages").eq("id", id).limit(1);
    const stages = [...((data?.[0]?.stages as Command["stages"]) ?? []), { stage, at: Date.now(), note }];
    await this.db.from("commands").update({ current: stage, stages }).eq("id", id);
    void this.broadcast();
  }

  async ackAlert(id: string, who: string): Promise<void> {
    await this.db.from("alerts").update({ acked_by: who, acked_at: new Date().toISOString() }).eq("id", id);
    this.cache.alerts = this.cache.alerts.filter((a) => a.id !== id);
    void this.broadcast();
  }

  async setWeights(w: Partial<ScoreWeights>): Promise<ScoreWeights> {
    const base = await this.getState();
    const next: ScoreWeights = { ...base.weights, ...w, version: "2.1" };
    await this.db
      .from("fusion_weights")
      .upsert({ id: 1, vision: next.vision, sound: next.sound, thermal: next.thermal, version: "2.1" }, { onConflict: "id" });
    void this.broadcast();
    return next;
  }

  async getMissionTimeline(missionId: string): Promise<MissionTimeline | null> {
    if (missionId === this.cache.missionId) {
      const s = await this.getState();
      return {
        mission: s.mission,
        trail: s.trail,
        scoreHistory: s.scoreHistory,
        events: s.events,
        detections: s.detections,
        commands: s.commands,
        alerts: s.alerts,
      };
    }
    const { data: m } = await this.db.from("missions").select("*").eq("id", missionId).limit(1);
    if (!m?.[0]) return null;
    const [trail, scores, events, detections, commands, alerts] = await Promise.all([
      this.db.from("trail_points").select("*").eq("mission_id", missionId).order("id", { ascending: true }),
      this.db.from("scores").select("*").eq("mission_id", missionId).order("id", { ascending: true }),
      this.db.from("events").select("*").eq("mission_id", missionId).order("ts", { ascending: true }),
      this.db.from("detections").select("*").eq("mission_id", missionId).order("ts", { ascending: true }),
      this.db.from("commands").select("*").eq("mission_id", missionId).order("issued_at", { ascending: true }),
      this.db.from("alerts").select("*").eq("mission_id", missionId).order("ts", { ascending: true }),
    ]);
    return {
      mission: {
        id: m[0].id,
        name: m[0].name,
        status: m[0].status,
        startedAt: new Date(m[0].started_at).getTime(),
        endedAt: m[0].ended_at ? new Date(m[0].ended_at).getTime() : undefined,
        origin: m[0].origin ?? { xM: 0, yM: 0, setAt: new Date(m[0].started_at).getTime() },
        robotId: (m[0].robot_id as string | undefined) ?? undefined,
      },
      trail: (trail.data ?? []).map(mapTrail),
      scoreHistory: (scores.data ?? []).map((r) => r.payload as ScoreResult),
      events: (events.data ?? []).map(mapEvent),
      detections: (detections.data ?? []).map(mapDetection),
      commands: (commands.data ?? []).map(mapCommand),
      alerts: (alerts.data ?? []).map(mapAlert),
    };
  }

  async listMissions() {
    const { data } = await this.db
      .from("missions")
      .select("id,name,status,started_at,ended_at")
      .order("started_at", { ascending: false })
      .limit(25);
    return (data ?? []).map((m) => ({
      id: m.id,
      name: m.name,
      status: m.status,
      startedAt: new Date(m.started_at).getTime(),
      endedAt: m.ended_at ? new Date(m.ended_at).getTime() : undefined,
    }));
  }
}

// ------------------------------------------------------------------- helpers
function push(arr: number[], v: number | undefined, cap: number): number[] {
  if (v === undefined || Number.isNaN(v)) return arr;
  return [...arr, v].slice(-cap);
}

function mapDetection(r: Record<string, unknown>): Detection {
  const label = String(r.label ?? "none");
  const isPerson = label === "person" || label === "human";
  return {
    id: String(r.id),
    ts: typeof r.ts === "number" ? r.ts : new Date(String(r.ts)).getTime(),
    label: isPerson ? "person" : "none",
    confidence: isPerson ? Number(r.confidence) : 0,
    bbox: (r.bbox as Detection["bbox"]) ?? { x: 0, y: 0, w: 0, h: 0 },
    position: (r.position as Detection["position"]) ?? undefined,
    source: "vision",
  };
}

function mapTrail(r: Record<string, unknown>): TrailPoint {
  return {
    xM: Number(r.x ?? r.xM ?? 0),
    yM: Number(r.y ?? r.yM ?? 0),
    ts: typeof r.ts === "number" ? r.ts : new Date(String(r.ts)).getTime(),
    score: Number(r.score ?? 0),
    hazard: Number(r.hazard ?? 0),
    gasPpm: Number(r.gas_ppm ?? r.gasPpm ?? 0),
  };
}

function mapEvent(r: Record<string, unknown>): FeedEvent {
  return {
    id: String(r.id),
    ts: typeof r.ts === "number" ? r.ts : new Date(String(r.ts)).getTime(),
    kind: r.kind as FeedEvent["kind"],
    level: r.level as FeedEvent["level"],
    text: String(r.text),
    snapshot: (r.snapshot as FeedEvent["snapshot"]) ?? {},
  };
}

function mapAlert(r: Record<string, unknown>): Alert {
  return {
    id: String(r.id),
    ts: typeof r.ts === "number" ? r.ts : new Date(String(r.ts)).getTime(),
    kind: r.kind as Alert["kind"],
    severity: r.severity as Alert["severity"],
    message: String(r.message),
    ackedBy: r.acked_by ? String(r.acked_by) : undefined,
    ackedAt: r.acked_at ? new Date(String(r.acked_at)).getTime() : undefined,
  };
}

function mapCommand(r: Record<string, unknown>): Command {
  return {
    id: String(r.id),
    type: r.type as Command["type"],
    params: (r.params as Record<string, string>) ?? {},
    issuedBy: String(r.issued_by ?? "operator"),
    issuedAt: typeof r.issued_at === "number" ? r.issued_at : new Date(String(r.issued_at)).getTime(),
    stages: (r.stages as Command["stages"]) ?? [{ stage: "queued", at: Date.now() }],
    current: (r.current as CommandStageName) ?? "queued",
  };
}
