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

// Evidence half-lives. These are matched to the SEARCH PACE:
// a fresh sighting holds full confidence during the active reading window,
// and decays smoothly as the robot moves past.
const VISION_HALF_LIFE = 12_000;
const SOUND_HALF_LIFE = 10_000;
const THERMAL_HALF_LIFE = 10_000;
const ACTIVE_READING_WINDOW = 15_000; // active reading window (15 s, matching camera heartbeat)
const DETECTION_WINDOW = 5 * 60_000;
const SOUND_WINDOW = 3 * 60_000;

/**
 * Temperature fusion rules for human heat declaration
 * - Ambient: -20°C to 0°C  -> Object: 5°C – 22°C
 * - Ambient: 0°C to 10°C   -> Object: 15°C – 29°C
 * - Ambient: 10°C to 20°C  -> Object: 20°C – 33°C
 * - Ambient: 20°C to 30°C  -> Object: 25°C – 40°C
 * - Ambient: 30°C to 40°C  -> Object: 33.5°C – 41°C
 * - Ambient: Above 40°C    -> Object: 35°C – 42°C
 * Note: If difference between ambient and object temperature is below 1.5°C,
 * it should NOT identify or display as human heat on the front-end dashboard.
 */
export interface HumanHeatRange {
  minAmb: number;
  maxAmb: number;
  minObj: number;
  maxObj: number;
}

export const HUMAN_HEAT_RULES: HumanHeatRange[] = [
  { minAmb: -20, maxAmb: 0, minObj: 5, maxObj: 22 },
  { minAmb: 0, maxAmb: 10, minObj: 15, maxObj: 29 },
  { minAmb: 10, maxAmb: 20, minObj: 20, maxObj: 33 },
  { minAmb: 20, maxAmb: 30, minObj: 25, maxObj: 40 },
  { minAmb: 30, maxAmb: 40, minObj: 33.5, maxObj: 41 },
  { minAmb: 40, maxAmb: 60, minObj: 35, maxObj: 42 },
];

export function getHumanHeatRule(ambientC: number): HumanHeatRange {
  for (const r of HUMAN_HEAT_RULES) {
    if (ambientC >= r.minAmb && ambientC <= r.maxAmb) return r;
  }
  if (ambientC < -20) return HUMAN_HEAT_RULES[0];
  return HUMAN_HEAT_RULES[HUMAN_HEAT_RULES.length - 1];
}

/**
 * Speech-level acoustic classification table (NIDCD reference at 1 metre):
 * - Exceeding 95 dB: Very Loud Sound (environmental/machinery/collapse, not human vocalization)
 * - 80–95 dB: Human Yelling / Shouting
 * - 70–80 dB: Human Loud Speech
 * - 55–70 dB: Human Talk (Normal conversation)
 * - 40–55 dB: Human Soft Speech
 * - 30–40 dB: Human Whisper
 * - Below 30 dB: Quiet / Ambient
 */
export function classifySound(db: number): string {
  if (db > 95) return "Very Loud Sound";
  if (db >= 80) return "HUMAN YELLING";
  if (db >= 70) return "HUMAN LOUD SPEECH";
  if (db >= 55) return "HUMAN TALK";
  if (db >= 40) return "HUMAN SOFT SPEECH";
  if (db >= 30) return "HUMAN WHISPER";
  return "QUIET";
}

export function isHumanHeat(ambientC: number, objectC: number): boolean {
  if (objectC > 55) return false; // Fire risk cutoff
  const absDelta = Math.abs(objectC - ambientC);
  if (absDelta < 1.5) return false; // Difference between ambient and object below 1.5 °C is not human heat

  // In normal to cool environments (<= 30 °C), human skin is warmer than ambient
  if (ambientC <= 30 && objectC <= ambientC) return false;

  const rule = getHumanHeatRule(ambientC);
  // Allow a small sensor tolerance (+1.0 °C on peripheral skin measurement)
  return objectC >= rule.minObj && objectC <= (rule.maxObj + 1.0);
}

export function computeScores(ctx: FusionContext): ScoreResult {
  const { weights } = ctx;

  // ---- VISION ------------------------------------------------------------
  let visionValue = 0;
  let visionNote = "No person detected recently";
  let visionAt = ctx.now;

  const recentDetections = ctx.detections
    .filter((d) => ctx.now - d.ts < DETECTION_WINDOW)
    .sort((a, b) => b.ts - a.ts);

  const latestDet = recentDetections[0];
  const personDet = recentDetections.find(
    (d) => (d.label === "person" || (d.label as string) === "human") && (d.confidence ?? 0) > 0
  );

  const activeDet = (latestDet && (latestDet.label === "person" || (latestDet.label as string) === "human"))
    ? latestDet
    : personDet;

  if (activeDet) {
    const age = Math.max(0, ctx.now - activeDet.ts);
    const rawConf = Number(activeDet.confidence ?? 0);
    const conf = rawConf > 1 ? rawConf / 100 : rawConf;

    // During the active reading window, vision score equals the confidence score directly.
    if (age <= ACTIVE_READING_WINDOW) {
      visionValue = clamp(conf, 0, 1);
    } else {
      visionValue = clamp(conf * recency(age - ACTIVE_READING_WINDOW, VISION_HALF_LIFE), 0, 1);
    }

    visionNote = `Person detected ${Math.round(age / 1000)} s ago · confidence ${Math.round(
      conf * 100
    )}%${activeDet.position ? ` · at (${activeDet.position.xM.toFixed(1)}, ${activeDet.position.yM.toFixed(1)}) m` : ""}`;
    visionAt = activeDet.ts;
  }

  // ---- SOUND -------------------------------------------------------------
  let soundValue = 0;
  let soundNote = "No loud event in recent window";
  let soundAt = ctx.now;

  const recentSound = ctx.soundEvents
    .filter((e) => ctx.now - e.ts < SOUND_WINDOW)
    .sort((a, b) => b.ts - a.ts)[0];

  if (recentSound) {
    const age = ctx.now - recentSound.ts;
    const strength = recentSound.snapshot.sound?.peak ?? 0.7;
    soundValue = clamp(strength * (age <= ACTIVE_READING_WINDOW ? 1 : recency(age - ACTIVE_READING_WINDOW, SOUND_HALF_LIFE)), 0, 1);
    soundNote = `Loud sound event ${Math.round(age / 1000)} s ago · peak ${Math.round(strength * 100)}%`;
    soundAt = recentSound.ts;
  }

  if (ctx.sound) {
    const ampNow = ctx.sound.amp ?? 0;
    const baseNow = ctx.sound.baseline ?? 0.1;
    const excess = Math.max(0, ampNow - baseNow);
    let readingSoundValue = 0;

    if (ctx.sound.db != null && ctx.sound.db > 0) {
      const db = ctx.sound.db;
      if (db > 95) {
        // Exceeding 95 dB does not attribute to human vocalization (machinery, collapse, heavy impact).
        readingSoundValue = 0.15;
      } else if (db >= 80) {
        // Human Yelling / Shouting: 80 - 95 dB
        readingSoundValue = 0.85 + 0.10 * clamp((db - 80) / 15, 0, 1);
      } else if (db >= 70) {
        // Human Loud Speech: 70 - 80 dB
        readingSoundValue = 0.70 + 0.15 * ((db - 70) / 10);
      } else if (db >= 55) {
        // Human Talk / Normal conversation: 55 - 70 dB
        readingSoundValue = 0.55 + 0.15 * ((db - 55) / 15);
      } else if (db >= 40) {
        // Human Soft Speech: 40 - 55 dB
        readingSoundValue = 0.40 + 0.15 * ((db - 40) / 15);
      } else if (db >= 30) {
        // Human Whisper: 30 - 40 dB
        readingSoundValue = 0.25 + 0.15 * ((db - 30) / 10);
      } else {
        // Below 30 dB (Ambient quiet, e.g. 15-20 dB): fair baseline contribution >= 1%
        readingSoundValue = clamp(db / 100, 0.03, 0.20);
      }
    } else if (excess > 0.15) {
      readingSoundValue = clamp(excess, 0, 1) * 0.8;
    }

    if (readingSoundValue > soundValue) {
      soundValue = readingSoundValue;
      const bandName = ctx.sound.band ?? (ctx.sound.db != null ? classifySound(ctx.sound.db) : "ACTIVE");
      soundNote = ctx.sound.db != null
        ? `${bandName} · ${Math.round(ctx.sound.db)} dB`
        : `Sustained audio · ${Math.round(excess * 100)}% above baseline`;
      soundAt = ctx.sound.heardAt ?? ctx.now;
    }
  }

  // ---- THERMAL -----------------------------------------------------------
  let thermalValue = 0;
  let thermalNote = "No body-heat signature in range";
  let thermalAt = ctx.now;

  if (ctx.thermal) {
    const objectC = ctx.thermal.objectC;
    const ambientC = ctx.thermal.ambientC;
    const deltaC = objectC - ambientC;
    const isFire = objectC > 55;
    const age = Math.max(0, ctx.now - ctx.thermal.heardAt);

    if (isFire) {
      thermalValue = 0;
      thermalNote = `Fire risk — surface ${objectC.toFixed(1)} °C`;
      thermalAt = ctx.thermal.heardAt;
    } else if (isHumanHeat(ambientC, objectC)) {
      // Confirmed human heat according to ambient-relative temperature rules
      const rule = getHumanHeatRule(ambientC);
      const center = (rule.minObj + rule.maxObj) / 2;
      const half = Math.max(1, (rule.maxObj - rule.minObj) / 2);
      const proximity = clamp(1 - Math.abs(objectC - center) / (half * 1.2), 0, 1);
      const deltaFactor = clamp((deltaC - 1.5) / 6.0, 0, 1);

      // Strong human heat score (0.65 to 0.95)
      const rawThermal = 0.65 + 0.25 * proximity + 0.10 * deltaFactor;
      thermalValue = clamp(rawThermal * (age <= ACTIVE_READING_WINDOW ? 1 : recency(age - ACTIVE_READING_WINDOW, THERMAL_HALF_LIFE)), 0, 1);
      thermalNote = `Human heat confirmed · ${objectC.toFixed(1)} °C (Δ ${deltaC.toFixed(1)} °C over ${ambientC.toFixed(1)} °C ambient)`;
      thermalAt = ctx.thermal.heardAt;
    } else if (objectC > 0) {
      // Any valid reading below human threshold contributes a fair baseline percentage (at least 3%)
      const baseline = clamp(Math.max(0.04, deltaC > 0 ? deltaC / 40 : 0.03), 0.03, 0.15);
      thermalValue = clamp(baseline * (age <= ACTIVE_READING_WINDOW ? 1 : recency(age - ACTIVE_READING_WINDOW, THERMAL_HALF_LIFE)), 0, 1);
      thermalNote = deltaC < 1.5
        ? `Thermal reading · ${objectC.toFixed(1)} °C (Δ ${deltaC.toFixed(1)} °C < 1.5 °C)`
        : `Thermal reading · ${objectC.toFixed(1)} °C`;
      thermalAt = ctx.thermal.heardAt;
    }
  }

  // ---- SURVIVOR (FUSION SCORE) -------------------------------------------
  // If a human is detected via vision, the baseline survivor score is directly
  // equal to that detection confidence score.
  // When multiple channels (vision, mic, thermal) have readings, they combine
  // smoothly with corroboration — staying well-balanced and in-between.
  let survivorValue = 0;

  if (visionValue > 0 && weights.vision > 0) {
    const otherW = (weights.sound > 0 ? weights.sound : 0) + (weights.thermal > 0 ? weights.thermal : 0);
    const otherSupport = otherW > 0 ? (weights.sound * soundValue + weights.thermal * thermalValue) / otherW : 0;

    // Anchor directly to vision confidence score, with gentle multi-sensor confirmation
    survivorValue = visionValue + (1 - visionValue) * otherSupport * 0.65;
  } else {
    // Non-vision mode (e.g. camera offline or survivor occluded under rubble):
    // Derive from microphone and thermal sensors weighted by channel weights
    const totalW = weights.vision + weights.sound + weights.thermal || 1;
    const sEff = weights.sound > 0 ? (weights.sound / totalW) * soundValue : 0;
    const tEff = weights.thermal > 0 ? (weights.thermal / totalW) * thermalValue : 0;
    const rawContribution = sEff + tEff;

    if (rawContribution <= 0) {
      survivorValue = 0;
    } else {
      const isSpeech = soundValue >= 0.40 && weights.sound > 0;
      const isHeat = thermalValue >= 0.50 && weights.thermal > 0;
      const isDualHuman = isSpeech && isHeat;
      const isSingleHuman = (isSpeech || isHeat) && !isDualHuman;

      if (isDualHuman) {
        // Multi-sensor corroboration: both sound (speech) and thermal (heat) confirm human presence
        // Pulls in the range of 60% to 75% max (never beyond 75%)
        const speechStrength = clamp((soundValue - 0.40) / 0.55, 0, 1);
        const heatStrength = clamp((thermalValue - 0.50) / 0.45, 0, 1);
        const corroborationLevel = 0.60 + 0.15 * (0.5 * speechStrength + 0.5 * heatStrength);
        survivorValue = clamp(corroborationLevel, 0.60, 0.75);
      } else if (isSingleHuman) {
        // Single sensor confirmation: human heat alone OR human speech alone
        // Strictly ranges from 25% to 35% max (never reaching 50%)
        const sensorNorm = isSpeech
          ? (0.25 + 0.10 * clamp((soundValue - 0.40) / 0.55, 0, 1))
          : (0.25 + 0.10 * clamp((thermalValue - 0.50) / 0.45, 0, 1));
        const relWeight = isSpeech ? (weights.sound / totalW) : (weights.thermal / totalW);
        const defaultRel = isSpeech ? (DEFAULT_WEIGHTS.sound / 1.0) : (DEFAULT_WEIGHTS.thermal / 1.0);
        const discount = clamp(relWeight / (defaultRel || 1), 0.65, 1.0);
        const singleScore = sensorNorm * discount;
        survivorValue = clamp(singleScore, 0.20, 0.35);
      } else {
        // No human presence confirmed: ambient thermal or quiet sound (e.g. 15-20 dB)
        // Strictly contributes at least 1% (fair baseline, below 25%)
        survivorValue = clamp(rawContribution * 1.5, 0.01, 0.20);
      }
    }
  }

  // Strictly enforce that the survivor score cannot reach or exceed 100% (must stay strictly less than 100)
  survivorValue = Math.round(clamp(survivorValue, 0, 0.99) * 100) / 100;

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
        vision: { value: Math.round(clamp(visionValue, 0, 0.99) * 100) / 100, note: visionNote, at: visionAt },
        sound: { value: Math.round(clamp(soundValue, 0, 0.99) * 100) / 100, note: soundNote, at: soundAt },
        thermal: { value: Math.round(clamp(thermalValue, 0, 0.99) * 100) / 100, note: thermalNote, at: thermalAt },
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
