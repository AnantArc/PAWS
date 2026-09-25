import { z } from "zod";

/**
 * Zod validation for the wire contract.
 * The ingest API rejects anything that does not match — bad bytes never
 * reach the store or the UI.
 */

const ts = z.number().int().nonnegative();
const norm01 = z.number().min(0).max(1);

export const SoundReadingSchema = z.object({
  amp: norm01,
  baseline: norm01,
  peak: norm01,
  db: z.number().min(0).max(140).optional(), // v2.9 SPL estimate
  band: z.string().max(16).optional(), // SILENT/QUIET/MODERATE/LOUD/HAZARD
  peakDb: z.number().min(0).max(140).optional(),
  heardAt: ts,
});

export const GasReadingSchema = z.object({
  ppm: z.number().min(0).max(20000),
  adc: z.number().int().min(0).max(4095),
  smoke: z.number().min(0).max(20000).optional(), // v2.9
  aqiBand: z.string().max(16).optional(), // v2.9 GOOD..SEVERE
  warming: z.boolean().optional(), // v2.9 MQ-2 warm-up
  heardAt: ts,
});

export const ThermalReadingSchema = z.object({
  objectC: z.number().min(-40).max(300),
  ambientC: z.number().min(-40).max(125),
  deltaC: z.number().min(-500).max(500).optional(), // v2.9
  zone: z.string().max(20).optional(), // v2.9 HUMAN HEAT/FIRE RISK/...
  heardAt: ts,
});

export const DistanceReadingSchema = z.object({
  mm: z.number().int().min(0).max(8000),
  status: z.enum(["valid", "out_of_range", "signal_fail"]),
  source: z.enum(["vl53l0x", "hc-sr04"]),
  cm: z.number().min(-1).max(500).optional(), // v2.9 forward sonar
  cmLeft: z.number().min(-1).max(500).optional(),
  cmRight: z.number().min(-1).max(500).optional(),
  state: z.string().max(12).optional(), // CLEAR/NEAR/STOP/NO ECHO
  laserState: z.string().max(12).optional(), // IN RANGE/NO TARGET
  match: z.string().max(4).optional(), // YES/NO/----
  heardAt: ts,
});

export const TiltReadingSchema = z.object({
  pitchDeg: z.number().min(-180).max(180),
  rollDeg: z.number().min(-180).max(180),
  attitude: z.string().max(12).optional(), // v2.9 LEVEL/TILTED/TIPOVER
  headingDeg: z.number().min(0).max(360).optional(),
  heardAt: ts,
});

export const ClimateReadingSchema = z.object({
  tempC: z.number().min(-40).max(125),
  humidityPct: z.number().min(0).max(100),
  band: z.string().max(12).optional(),
  heardAt: ts,
});

export const PirReadingSchema = z.object({
  state: z.enum(["MOTION", "IDLE"]),
  total: z.number().int().min(0),
  perMin: z.number().int().min(0),
  lastSecs: z.number().int().min(-1),
  heardAt: ts,
});

export const PositionReadingSchema = z.object({
  xM: z.number().min(-1000).max(1000),
  yM: z.number().min(-1000).max(1000),
  headingDeg: z.number().min(0).max(360),
  driftM: z.number().min(0).max(100),
  mode: z.literal("estimated_imu_odometry"),
  origin: z.object({ xM: z.number(), yM: z.number(), setAt: ts }),
  heardAt: ts,
});

/** What the ESP32 posts to /api/ingest. Sensors are optional — the UI shows
 *  NOT INSTALLED for anything absent. */
export const TelemetryPayloadSchema = z.object({
  deviceId: z.string().min(1).max(64),
  ts: ts,
  seq: z.number().int().nonnegative(),
  heartbeat: z.boolean().optional(),
  sound: SoundReadingSchema.optional(),
  gas: GasReadingSchema.optional(),
  thermal: ThermalReadingSchema.optional(),
  distance: DistanceReadingSchema.optional(),
  tilt: TiltReadingSchema.optional(),
  climate: ClimateReadingSchema.optional(), // v2.9 DHT11
  pir: PirReadingSchema.optional(), // v2.9
  position: PositionReadingSchema.optional(),
  camera: z
    .object({
      frameId: z.number().int(),
      ts: ts,
      hasFrame: z.boolean(),
      width: z.number().int().min(1).max(4096),
      height: z.number().int().min(1).max(4096),
      jpegBytes: z.number().int().positive().optional(),
    })
    .optional(),
});

export type TelemetryPayload = z.infer<typeof TelemetryPayloadSchema>;

export const CommandRequestSchema = z.object({
  type: z.enum(["estop", "resume", "re_anchor", "set_mode", "deploy_payload"]),
  params: z.record(z.string()).default({}),
});

export const WeightsRequestSchema = z.object({
  vision: z.number().min(0).max(1),
  sound: z.number().min(0).max(1),
  thermal: z.number().min(0).max(1),
});

export const MissionRequestSchema = z.object({
  name: z.string().min(1).max(80),
  action: z.literal("start"),
});
