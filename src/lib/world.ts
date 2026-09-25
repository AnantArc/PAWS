/**
 * SIMULATED WORLD MODEL — single source of truth
 * -----------------------------------------------
 * The demo floor is not random noise. It has fixed survivor positions, a gas
 * pocket and debris the robot squeezes past. BOTH the sensor simulator and
 * the camera detection provider read this file, so the person the camera sees
 * is the SAME person the thermopile feels, the microphone hears and the PIR
 * detects — every signal rises and falls together, from one physical cause.
 *
 * Coordinates are metres in the same frame as the robot's odometry
 * (origin = walk-in anchor, +Y = frame north).
 */

export interface WorldPoint {
  xM: number;
  yM: number;
}

export interface SurvivorSpot extends WorldPoint {
  id: string;
  /** Operator-facing description, used in notes only — never invented data. */
  label: string;
}

/**
 * How close the robot must be for a survivor to enter its sensor range (m).
 * Close enough that the camera can actually resolve a person in rubble, and
 * that the thermopile and microphone are genuinely looking at the same body.
 */
export const DETECT_RANGE_M = 1.8;

/** Fixed survivor positions on the demo floor. */
export const SURVIVORS: SurvivorSpot[] = [
  { id: "S-A", xM: 3.4, yM: 5.6, label: "survivor at the back wall" },
  { id: "S-B", xM: -1.2, yM: 3.1, label: "survivor beside the gas pocket" },
];

/** A fixed gas leak — concentration falls off with distance from the pocket. */
export const GAS_POCKET = {
  xM: -1.2,
  yM: 3.1,
  radiusM: 2.8,
  /** ppm at the centre of the cloud / on clean floor far away. */
  peakPpm: 1180,
  basePpm: 140,
};

/** Debris the robot has to squeeze past — dips the forward ranger. */
export const OBSTACLES = [
  { xM: 2.6, yM: 3.4, rangeM: 1.0, clearanceCm: 145 },
  { xM: -1.1, yM: 0.6, rangeM: 1.0, clearanceCm: 170 },
];

export function distanceM(a: WorldPoint, b: WorldPoint): number {
  return Math.hypot(a.xM - b.xM, a.yM - b.yM);
}

/** Nearest survivor to a point, with its distance. */
export function nearestSurvivor(p: WorldPoint): { spot: SurvivorSpot; distanceM: number } | null {
  let best: { spot: SurvivorSpot; distanceM: number } | null = null;
  for (const spot of SURVIVORS) {
    const d = distanceM(p, spot);
    if (!best || d < best.distanceM) best = { spot, distanceM: d };
  }
  return best;
}

/**
 * Camera confidence for a survivor at distance `d`: ~0.92 point-blank,
 * ~0.72 at the edge of range. Confidence therefore RISES as the robot closes
 * in, and never exceeds what the geometry supports.
 */
export function detectionConfidence(d: number): number {
  const t = clamp01(d / DETECT_RANGE_M); // 0 = touching, 1 = edge of range
  return Math.round((0.92 - 0.2 * t) * 100) / 100;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}
