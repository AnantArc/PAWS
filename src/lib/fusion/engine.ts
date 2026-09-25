import type {
  Detection,
  DistanceReading,
  FeedEvent,
  GasReading,
  LinkState,
  PositionReading,
  ScoreResult,
  ScoreWeights,
  SoundReading,
  ThermalReading,
  TiltReading,
} from "@/lib/types";
import { accessibilityLevel, clamp, hazardLevel, levelFromScore, recency } from "@/lib/utils";

/**
 * PAWS FUSION ENGINE v2
 * ---------------------
 * Three independent signals -> three explainable scores:
 *   SURVIVOR LIKELIHOOD  = vision + sound + thermal   (confirmation, decayed)
 *   HAZARD               = gas + temperature          (max-based)
 *   ACCESSIBILITY        = clearance + tilt + link    (min-based)
 *
 * The survivor score is a confirmation rule, so it is internally consistent
 * with the operator rule "expect a human if score is > 70 %": a confident
 * detection on any one channel crosses that line on its own, and a second
 * agreeing channel can only push the score up.
 *
 * Rules:
 *  - No evidence => survivor score is EXACTLY 0 (never a made-up number).
 *  - Every score carries its inputs and a plain-English "why".
 *  - Evidence decays with a half-life, so old events fade honestly.
 *  - Weights are configurable (settings screen), versioned and stored
 *    alongside every score for auditability.
 *
 * Unit tests: tests/fusion.test.ts
 */

export const DEFAULT_WEIGHTS: ScoreWeights = {
  vision: 0.5,
  sound: 0.3,
  thermal: 0.2,
  hazardGas: 0.65,
  hazardTemp: 0.35,
  accClearance: 0.5,
  accTilt: 0.3,
  accLink: 0.2,
  version: "2.1",
};

export interface FusionContext {
  now: number;
  sound: SoundReading | null;
  gas: GasReading | null;
  thermal: ThermalReading | null;
  distance: DistanceReading | null;
  tilt: TiltReading | null;
  position: PositionReading | null;
  link: LinkState;
  detections: Detection[]; // all this mission, any age
  soundEvents: FeedEvent[]; // kind sound_event, any age
  weights: ScoreWeights;
}

// Evidence half-lives. These are matched to the SEARCH PACE, so the score
// answers "is someone here now", not "was someone here a minute ago": a fresh
// confirmation crosses the 70 % line immediately, and it falls back below that
// line while the robot is walking empty floor. Longer half-lives would pin the
// score permanently above the threshold even when the robot is alone, which
// would make the operator rule meaningless.
const VISION_HALF_LIFE = 12_000; // a sighting is decisive for ~10 s
const SOUND_HALF_LIFE = 10_000;
const THERMAL_HALF_LIFE = 10_000;
const DETECTION_WINDOW = 5 * 60_000;
const SOUND_WINDOW = 3 * 60_000;

export function computeScores(ctx: FusionContext): ScoreResult {
  const { weights } = ctx;

  // ---- VISION ------------------------------------------------------------
  let visionValue = 0;
  let visionNote = "No person detected recently";
  let visionAt = ctx.now;
  const recentDet = ctx.detections
    .filter((d) => ctx.now - d.ts < DETECTION_WINDOW)
    .sort((a, b) => b.ts - a.ts)[0];
  if (recentDet) {
    const age = ctx.now - recentDet.ts;
    visionValue = clamp(recentDet.confidence * recency(age, VISION_HALF_LIFE), 0, 1);
    visionNote = `Person detected ${Math.round(age / 1000)} s ago · confidence ${Math.round(
      recentDet.confidence * 100
    )}%${recentDet.position ? ` · at (${recentDet.position.xM.toFixed(1)}, ${recentDet.position.yM.toFixed(1)}) m` : ""}`;
    visionAt = recentDet.ts;
  }

  // ---- SOUND -------------------------------------------------------------
  let soundValue = 0;
  let soundNote = "No loud event in recent window";
  let soundAt = ctx.now;
  const recentSound = ctx.soundEvents
    .filter((e) => ctx.now - e.ts < SOUND_WINDOW)
    .sort((a, b) => b.ts - a.ts)[0];
  const ampNow = ctx.sound?.amp ?? 0;
  const baseNow = ctx.sound?.baseline ?? 0.1;
  const excess = Math.max(0, ampNow - baseNow);
  if (recentSound) {
    const age = ctx.now - recentSound.ts;
    const strength = recentSound.snapshot.sound?.peak ?? 0.7;
    soundValue = clamp(strength * recency(age, SOUND_HALF_LIFE), 0, 1);
    soundNote = `Loud sound event ${Math.round(age / 1000)} s ago · peak ${Math.round(strength * 100)}%`;
    soundAt = recentSound.ts;
  } else if (excess > 0.15) {
    soundValue = clamp(excess, 0, 1) * 0.8;
    soundNote = `Sustained loud audio · ${Math.round(excess * 100)}% above baseline`;
    soundAt = ctx.now;
  }

  // ---- THERMAL -----------------------------------------------------------
  let thermalValue = 0;
  let thermalNote = "No body-heat signature in range";
  let thermalAt = ctx.now;
  if (ctx.thermal) {
    const delta = ctx.thermal.objectC - ctx.thermal.ambientC;
    const bodyBand = delta >= 1.5 && delta <= 14 && ctx.thermal.objectC >= 28 && ctx.thermal.objectC <= 40;
    const age = ctx.now - ctx.thermal.heardAt;
    if (bodyBand) {
      // Close-range confirmer only: delta scaled + decayed. We never claim a
      // survivor from thermal alone at distance.
      thermalValue = clamp((delta / 10) * recency(age, THERMAL_HALF_LIFE), 0, 1);
      thermalNote = `Body-heat signature · Δ ${delta.toFixed(1)} °C over ambient ${Math.round(age / 1000)} s ago`;
      thermalAt = ctx.thermal.heardAt;
    }
  }

  // ---- SURVIVOR ----------------------------------------------------------
  // INDEPENDENT-EVIDENCE CONFIRMATION (not a weighted average).
  //
  // A weighted average silently caps a single sensor at its own weight: a
  // camera 88 % sure of a person could never produce a score above 44 %, which
  // made "EXPECT A HUMAN IF SCORE IS > 70 %" mathematically unreachable from
  // vision alone. Each channel now reports how strongly it believes a person
  // is present, its weight acts as a RELIABILITY DISCOUNT relative to the most
  // trusted channel (0 → ignored, 1 → taken at face value), and the discounted
  // confirmations combine as independent sources: the score is one minus the
  // probability that EVERY channel is a false alarm. One confident sensor is
  // therefore enough to cross the threshold; corroboration pushes it higher.
  const maxW = Math.max(weights.vision, weights.sound, weights.thermal) || 1;
  const reliability = (w: number) => clamp(w / maxW, 0, 1);
  const confirmations = [
    visionValue * reliability(weights.vision),
    soundValue * reliability(weights.sound),
    thermalValue * reliability(weights.thermal),
  ];
  let allFalseAlarm = 1;
  for (const c of confirmations) allFalseAlarm *= 1 - clamp(c, 0, 1);
  let survivorValue = Math.round(clamp(1 - allFalseAlarm, 0, 1) * 100) / 100;

  const reasons: string[] = [];
  if (visionValue > 0) reasons.push(`Vision (${Math.round(weights.vision * 100)}% weight): ${visionNote}`);
  if (soundValue > 0) reasons.push(`Sound (${Math.round(weights.sound * 100)}% weight): ${soundNote}`);
  if (thermalValue > 0) reasons.push(`Thermal (${Math.round(weights.thermal * 100)}% weight): ${thermalNote}`);
  if (reasons.length === 0) reasons.push("No survivor evidence from any signal — score is 0.");

  // ---- HAZARD ------------------------------------------------------------
  const gasFactor = ctx.gas ? clamp(ctx.gas.ppm / 1200, 0, 1) : 0;
  const fireDetected = !!ctx.thermal && ctx.thermal.objectC > 55;
  const tempFactor = fireDetected ? 1 : 0;
  const hazardValue = Math.round(clamp(gasFactor * weights.hazardGas + tempFactor * weights.hazardTemp, 0, 1) * 100) / 100;
  const hazardReasons: string[] = [];
  if (ctx.gas && gasFactor > 0.05)
    hazardReasons.push(`Gas ${Math.round(ctx.gas.ppm)} ppm — ${gasFactor > 0.6 ? "respiratory risk" : "elevated"}`);
  if (fireDetected && ctx.thermal)
    hazardReasons.push(`Fire risk — object temp ${ctx.thermal.objectC.toFixed(1)} °C (> 55 °C)`);
  if (hazardReasons.length === 0) hazardReasons.push("No hazard signal — gas and temperature nominal.");

  // ---- ACCESSIBILITY -----------------------------------------------------
  const clearanceBlocked = !!ctx.distance && ctx.distance.status === "valid" && ctx.distance.mm < 120;
  const clearanceMm = ctx.distance?.status === "valid" ? ctx.distance.mm : null;
  const tiltDeg = ctx.tilt ? Math.max(Math.abs(ctx.tilt.pitchDeg), Math.abs(ctx.tilt.rollDeg)) : 0;
  const tiltBlocked = tiltDeg > 28;
  const linkLost = ctx.link === "offline";
  // Partial constraints reduce mobility; any HARD STOP (clearance < 120 mm,
  // tilt > 28°, link lost) floors the value to <= 0.2 — a stuck robot is
  // blocked no matter how healthy the other factors look.
  let accValue = Math.round(
    clamp(
      (clearanceBlocked ? 0 : weights.accClearance) + (tiltBlocked ? 0 : weights.accTilt) + (linkLost ? 0 : weights.accLink),
      0,
      1
    ) * 100
  ) / 100;
  if (linkLost) accValue = 0; // unreachable robot = zero mobility
  else if (clearanceBlocked || tiltBlocked) accValue = Math.min(accValue, 0.2);
  const accReasons: string[] = [];
  accReasons.push(
    clearanceMm !== null
      ? `Clearance ${clearanceMm >= 1000 ? (clearanceMm / 1000).toFixed(2) + " m" : clearanceMm + " mm"} ${clearanceBlocked ? "— blocked (< 120 mm)" : "— passable"}`
      : "Clearance sensor not providing readings"
  );
  accReasons.push(tiltBlocked ? `Tilt ${tiltDeg.toFixed(1)}° — beyond stability limit` : `Tilt ${tiltDeg.toFixed(1)}° — stable`);
  accReasons.push(linkLost ? "Robot link lost" : "Robot link healthy");

  return {
    ts: ctx.now,
    survivor: {
      value: survivorValue,
      level: levelFromScore(survivorValue),
      breakdown: {
        vision: { value: Math.round(visionValue * 100) / 100, note: visionNote, at: visionAt },
        sound: { value: Math.round(soundValue * 100) / 100, note: soundNote, at: soundAt },
        thermal: { value: Math.round(thermalValue * 100) / 100, note: thermalNote, at: thermalAt },
      },
      reasons,
    },
    hazard: {
      value: hazardValue,
      level: hazardLevel(hazardValue),
      gasPpm: ctx.gas?.ppm ?? 0,
      objectC: ctx.thermal?.objectC ?? 0,
      fireDetected,
      reasons: hazardReasons,
    },
    accessibility: {
      value: accValue,
      level: accessibilityLevel(accValue),
      clearanceMm: clearanceMm ?? 0,
      tiltDeg: Math.round(tiltDeg * 10) / 10,
      link: ctx.link,
      reasons: accReasons,
    },
    weights,
  };
}
