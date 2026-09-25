/**
 * PAWS — FROZEN TELEMETRY & DOMAIN CONTRACT (v2.1)
 * -------------------------------------------------
 * Every sensor, event, command and score in the system is described here.
 * The ESP32 firmware, the ingest API, the fusion engine and every UI panel
 * speak exactly this language. Changes require a version bump + migration.
 *
 * Units are explicit. Precision is the sensor's real precision — never more.
 */

// ---------------------------------------------------------------------------
// Device / link
// ---------------------------------------------------------------------------

export type LinkState = "online" | "delayed" | "offline";
export type Freshness = "live" | "delayed" | "stale" | "offline" | "not_installed" | "simulated";

export interface DeviceStatus {
  deviceId: string;
  link: LinkState;
  lastSeenAt: number; // epoch ms
}

// ---------------------------------------------------------------------------
// Sensors
// ---------------------------------------------------------------------------

export type RangeStatus = "valid" | "out_of_range" | "signal_fail";

/** Sound module — amplitude + dB estimate (v2.9 mic). No bearing, ever. */
export interface SoundReading {
  amp: number; // 0..1 instantaneous amplitude
  baseline: number; // 0..1 rolling baseline
  peak: number; // 0..1 peak hold since last reset
  db?: number; // SPL estimate (dB), v2.9
  band?: string; // SILENT / QUIET / MODERATE / LOUD / HAZARD
  peakDb?: number; // peak dB since page shown
  heardAt: number;
}

/** MQ-2 gas sensor — LPG/smoke ppm + AQI (v2.9 calibrated). */
export interface GasReading {
  ppm: number; // LPG ppm (calibrated)
  adc: number; // raw 0..4095
  smoke?: number; // smoke ppm (v2.9)
  aqiBand?: string; // GOOD / MODERATE / POOR / VERY POOR / SEVERE
  warming?: boolean; // true during the ~90 s MQ-2 warm-up
  heardAt: number;
}

/** MLX90614 (GY-906) — single-point IR thermopile. */
export interface ThermalReading {
  objectC: number; // object temperature, 0.1 °C precise
  ambientC: number; // sensor ambient, 0.1 °C precise
  deltaC?: number; // object − ambient (v2.9)
  zone?: string; // HUMAN HEAT / FIRE RISK / COLD / NORMAL / NO SENSOR
  heardAt: number;
}

/** VL53L0X ToF ranger (1 mm) + 3-way HC-SR04 sonar sweep (v2.9). */
export interface DistanceReading {
  mm: number; // laser mm (or -1 → derived from cm)
  status: RangeStatus;
  source: "vl53l0x" | "hc-sr04";
  cm?: number; // forward sonar cm (v2.9)
  cmLeft?: number; // left bin (v2.9, -1 = no echo)
  cmRight?: number; // right bin (v2.9, -1 = no echo)
  state?: string; // CLEAR / NEAR / STOP / NO ECHO
  laserState?: string; // IN RANGE / NO TARGET
  match?: string; // YES / NO / "----"
  heardAt: number;
}

/** MPU-6050 tilt + attitude (v2.9). */
export interface TiltReading {
  pitchDeg: number; // 0.1° precise
  rollDeg: number;
  attitude?: string; // LEVEL / TILTED / TIPOVER
  headingDeg?: number; // gyro heading 0–359
  heardAt: number;
}

/** DHT11 climate (v2.9 new sensor). */
export interface ClimateReading {
  tempC: number; // air temperature °C
  humidityPct: number; // relative humidity %
  band?: string; // DRY / COMFORT / DAMP / HUMID
  heardAt: number;
}

/** PIR motion (v2.9). */
export interface PirReading {
  state: "MOTION" | "IDLE";
  total: number; // rising edges since boot
  perMin: number; // events in last 60 s
  lastSecs: number; // -1 = never triggered
  heardAt: number;
}

/** YOLO vision state from the ESP32-CAM detector (v2.9). */
export interface VisionReading {
  human: boolean; // true = person in frame (label "person"), false = clear ("none")
  confidence: number; // 0..1 of the last person frame
  at: number; // detection timestamp (ms)
  source: "yolo";
}

/** Origin-anchored estimated position (IMU + gait odometry — no GPS claim). */
export interface PositionReading {
  xM: number; // metres relative to origin
  yM: number;
  headingDeg: number; // 0 = +Y (frame north)
  driftM: number; // growing uncertainty estimate
  mode: "estimated_imu_odometry";
  origin: { xM: number; yM: number; setAt: number };
  heardAt: number;
}

// ---------------------------------------------------------------------------
// Vision
// ---------------------------------------------------------------------------

export interface CameraFrame {
  frameId: number;
  ts: number;
  hasFrame: boolean;
  width: number;
  height: number;
  jpegBytes?: number;
}

export interface Detection {
  id: string;
  ts: number;
  label: "person" | "none"; // "none" = camera frame clear (no person)
  confidence: number; // 0..1, one decimal
  bbox: { x: number; y: number; w: number; h: number }; // normalized 0..1
  position?: { xM: number; yM: number }; // anchor-frame position at capture
  source: "vision";
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export interface ScoreWeights {
  vision: number;
  sound: number;
  thermal: number;
  hazardGas: number;
  hazardTemp: number;
  accClearance: number;
  accTilt: number;
  accLink: number;
  version: string;
}

export interface SourceEvidence {
  vision: { value: number; note: string; at: number };
  sound: { value: number; note: string; at: number };
  thermal: { value: number; note: string; at: number };
}

export interface ScoreResult {
  ts: number;
  survivor: {
    value: number; // 0..1, no evidence => exactly 0
    level: "none" | "low" | "moderate" | "high";
    breakdown: SourceEvidence;
    reasons: string[];
  };
  hazard: {
    value: number; // 0..1
    level: "clear" | "elevated" | "severe";
    gasPpm: number;
    objectC: number;
    fireDetected: boolean;
    reasons: string[];
  };
  accessibility: {
    value: number; // 0..1 (1 = fully mobile)
    level: "mobile" | "constrained" | "blocked";
    clearanceMm: number;
    tiltDeg: number;
    link: LinkState;
    reasons: string[];
  };
  weights: ScoreWeights;
}

export interface TrailPoint {
  xM: number;
  yM: number;
  ts: number;
  score: number; // survivor 0..1
  hazard: number; // hazard 0..1
  gasPpm: number;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export type CommandType = "estop" | "resume" | "re_anchor" | "set_mode" | "deploy_payload";
export type CommandStageName = "queued" | "delivered" | "acknowledged" | "done" | "failed";

export interface CommandStage {
  stage: CommandStageName;
  at: number;
  note?: string;
}

export interface Command {
  id: string;
  type: CommandType;
  params: Record<string, string>;
  issuedBy: string;
  issuedAt: number;
  stages: CommandStage[];
  current: CommandStageName;
}

// ---------------------------------------------------------------------------
// Alerts & feed
// ---------------------------------------------------------------------------

export type AlertKind =
  | "person_detected"
  | "sound_event"
  | "gas_high"
  | "fire_risk"
  | "link_lost"
  | "obstacle"
  | "command";

export interface Alert {
  id: string;
  ts: number;
  kind: AlertKind;
  severity: "info" | "warn" | "critical";
  message: string;
  ackedBy?: string;
  ackedAt?: number;
}

export type EventKind =
  | "detection"
  | "sound_event"
  | "alert"
  | "command"
  | "system"
  | "mission"
  | "link";

/** Point-in-time capture of every sensor at the moment of an event. */
export interface SensorSnapshot {
  sound?: SoundReading;
  gas?: GasReading;
  thermal?: ThermalReading;
  distance?: DistanceReading;
  tilt?: TiltReading;
  position?: PositionReading;
  detection?: Detection;
  vision?: Detection;
  climate?: ClimateReading;
  pir?: PirReading;
}

export interface FeedEvent {
  id: string;
  ts: number;
  kind: EventKind;
  level: "info" | "success" | "warn" | "critical";
  text: string; // operator English, always
  snapshot: SensorSnapshot; // full sensor state at this moment
  refId?: string; // links to the originating alert/command id
}

// ---------------------------------------------------------------------------
// Mission
// ---------------------------------------------------------------------------

export type MissionStatus = "idle" | "running" | "paused" | "ended";

export interface Mission {
  id: string;
  name: string;
  status: MissionStatus;
  startedAt: number;
  endedAt?: number;
  pausedAt?: number;
  origin: { xM: number; yM: number; setAt: number };
  /** The PAWS robot this mission belongs to (per-robot missions). */
  robotId?: string;
}

// ---------------------------------------------------------------------------
// The aggregate state the console renders
// ---------------------------------------------------------------------------

export interface ConsoleState {
  mode: "local" | "supabase";
  mission: Mission;
  device: DeviceStatus;
  sensors: {
    sound: SoundReading | null;
    gas: GasReading | null;
    thermal: ThermalReading | null;
    distance: DistanceReading | null;
    tilt: TiltReading | null;
    position: PositionReading | null;
    camera: CameraFrame | null;
    climate: ClimateReading | null;
    pir: PirReading | null;
    vision: VisionReading | null;
  };
  /** Display rebase: every absolute coordinate is rendered as (value − rebase).
   *  Re-anchoring moves the origin to the robot WITHOUT touching the data. */
  rebase: { xM: number; yM: number; setAt: number };
  /** Rolling true readings (newest last) for live charts — never fabricated. */
  history: {
    sound: number[]; // amp 0..1
    gas: number[]; // ppm
    thermalObj: number[]; // °C
    distance: number[]; // mm
    humidity: number[]; // %RH (v2.9 climate)
  };
  latestDetection: Detection | null;
  detections: Detection[]; // mission-scoped, newest first (cap 200)
  trail: TrailPoint[]; // mission-scoped (cap 4000)
  scoreHistory: ScoreResult[]; // cap 600
  events: FeedEvent[]; // newest first (cap 500)
  alerts: Alert[]; // newest first, unacked highlighted
  commands: Command[]; // newest first (cap 100)
  weights: ScoreWeights;
  simulated: boolean; // true when data comes from the robot simulator
  now: number;
}
