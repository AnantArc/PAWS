import { describe, expect, it } from "vitest";
import { classifySound, computeScores, DEFAULT_WEIGHTS, isHumanHeat, type FusionContext } from "@/lib/fusion/engine";

function ctx(over: Partial<FusionContext> = {}): FusionContext {
  return {
    now: 1_000_000,
    sound: null,
    gas: null,
    thermal: null,
    distance: null,
    tilt: null,
    position: null,
    link: "online",
    detections: [],
    soundEvents: [],
    weights: DEFAULT_WEIGHTS,
    ...over,
  };
}

describe("fusion engine v2 — survivor likelihood", () => {
  it("returns EXACTLY 0 when there is no evidence", () => {
    const s = computeScores(ctx()).survivor;
    expect(s.value).toBe(0);
    expect(s.level).toBe("none");
    expect(s.reasons[0]).toContain("No survivor evidence");
  });

  it("vision evidence drives the score, with a plain-English reason", () => {
    const det = { id: "d1", ts: 999_000, label: "person" as const, confidence: 0.86, bbox: { x: 0, y: 0, w: 0.2, h: 0.5 }, position: { xM: 3.4, yM: 5.6 }, source: "vision" as const };
    const s = computeScores(ctx({ detections: [det] })).survivor;
    expect(s.value).toBeGreaterThan(0);
    expect(s.breakdown.vision.note).toContain("3.4, 5.6");
    expect(s.reasons.join(" ")).toContain("Vision");
  });

  it("RULE: evidence decays back below the 70% line while the robot is alone", () => {
    // A sighting that is a minute old must NOT keep the score above the
    // "expect a human" threshold after the robot has walked away.
    const det = { id: "d1", ts: 999_000, label: "person" as const, confidence: 0.9, bbox: { x: 0, y: 0, w: 0.2, h: 0.5 }, source: "vision" as const };
    const atSighting = computeScores(ctx({ detections: [det] })).survivor;
    const muchLater = computeScores(ctx({ detections: [det], now: 999_000 + 60_000 })).survivor;
    expect(atSighting.value).toBeGreaterThan(0.7);
    expect(muchLater.value).toBeLessThan(0.7);
    expect(muchLater.level).not.toBe("high");
  });

  it("RULE: a confident camera detection crosses 70% on its own", () => {
    for (const confidence of [0.8, 0.85, 0.9, 0.95]) {
      const det = {
        id: "d1",
        ts: 999_000, // 1 s old
        label: "person" as const,
        confidence,
        bbox: { x: 0, y: 0, w: 0.2, h: 0.5 },
        source: "vision" as const,
      };
      const s = computeScores(ctx({ detections: [det] })).survivor;
      expect(s.value, `camera ${confidence} must clear the 70% human line`).toBeGreaterThan(0.7);
      expect(s.level).toBe("high");
    }
  });

  it("RULE: corroboration only ever raises the score", () => {
    const det = {
      id: "d1",
      ts: 999_000,
      label: "person" as const,
      confidence: 0.82,
      bbox: { x: 0, y: 0, w: 0.2, h: 0.5 },
      source: "vision" as const,
    };
    const visionOnly = computeScores(ctx({ detections: [det] })).survivor.value;
    const corroborated = computeScores(
      ctx({
        detections: [det],
        thermal: { objectC: 35.8, ambientC: 24.6, heardAt: 999_000 },
        sound: { amp: 0.9, baseline: 0.07, peak: 0.82, db: 84, heardAt: 999_000 },
        soundEvents: [{ id: "e1", ts: 999_000, kind: "sound_event" as const, level: "warn" as const, text: "Loud sound event", snapshot: { sound: { amp: 0.9, baseline: 0.07, peak: 0.82, db: 84, heardAt: 999_000 } } }],
      })
    ).survivor.value;
    expect(corroborated).toBeGreaterThanOrEqual(visionOnly);
    expect(corroborated).toBeGreaterThan(0.9);
  });

  it("RULE: weights act as reliability discounts (a zero weight ignores a channel)", () => {
    const soundOnly = {
      soundEvents: [{ id: "e1", ts: 999_000, kind: "sound_event" as const, level: "warn" as const, text: "Loud sound event", snapshot: { sound: { amp: 0.9, baseline: 0.07, peak: 0.9, db: 84, heardAt: 999_000 } } }],
    };
    const trusted = computeScores(ctx({ ...soundOnly, weights: { ...DEFAULT_WEIGHTS, vision: 0.3, sound: 0.9, thermal: 0.2 } })).survivor.value;
    const distrusted = computeScores(ctx({ ...soundOnly, weights: { ...DEFAULT_WEIGHTS, vision: 0.9, sound: 0.3, thermal: 0.2 } })).survivor.value;
    expect(trusted).toBeGreaterThan(distrusted);
    const ignored = computeScores(ctx({ ...soundOnly, weights: { ...DEFAULT_WEIGHTS, sound: 0 } })).survivor.value;
    expect(ignored).toBe(0);
  });

  it("decays: a detection from 3 minutes ago barely counts", () => {
    const det = { id: "d1", ts: 100_000, label: "person" as const, confidence: 0.9, bbox: { x: 0, y: 0, w: 0.2, h: 0.5 }, source: "vision" as const };
    const fresh = computeScores(ctx({ detections: [{ ...det, ts: 999_000 }] })).survivor.value;
    const old = computeScores(ctx({ detections: [det] })).survivor.value;
    expect(old).toBeLessThan(fresh * 0.25);
  });

  it("two-sensor corroboration (sound + thermal without vision) stays in 60% to 75% range and never beyond 75%", () => {
    // Both sensors confirm human: human yelling (88 dB) + human heat (36.5°C in 22°C ambient)
    const dualSensor = computeScores(
      ctx({
        sound: { amp: 0.9, baseline: 0.07, peak: 0.9, db: 88, heardAt: 999_500 },
        thermal: { objectC: 36.5, ambientC: 22.0, heardAt: 999_500 },
      })
    );
    expect(dualSensor.survivor.value).toBeGreaterThanOrEqual(0.60);
    expect(dualSensor.survivor.value).toBeLessThanOrEqual(0.75);

    // Human talk (60 dB) + human heat
    const talkAndHeat = computeScores(
      ctx({
        sound: { amp: 0.6, baseline: 0.07, peak: 0.6, db: 60, heardAt: 999_500 },
        thermal: { objectC: 35.0, ambientC: 22.0, heardAt: 999_500 },
      })
    );
    expect(talkAndHeat.survivor.value).toBeGreaterThanOrEqual(0.60);
    expect(talkAndHeat.survivor.value).toBeLessThanOrEqual(0.75);
  });

  it("single sensor confirmation (heat alone or speech alone) ranges strictly between 25% and 35% max", () => {
    // Thermal alone with confirmed human heat (ambient quiet)
    const heatOnly = computeScores(
      ctx({
        sound: { amp: 0.05, baseline: 0.07, peak: 0.05, db: 20, heardAt: 999_500 },
        thermal: { objectC: 36.5, ambientC: 22.0, heardAt: 999_500 },
      })
    );
    expect(heatOnly.survivor.value).toBeGreaterThanOrEqual(0.25);
    expect(heatOnly.survivor.value).toBeLessThanOrEqual(0.35);

    // Sound alone with human speech (ambient thermal)
    const speechOnly = computeScores(
      ctx({
        sound: { amp: 0.7, baseline: 0.07, peak: 0.7, db: 70, heardAt: 999_500 },
        thermal: { objectC: 22.0, ambientC: 22.0, heardAt: 999_500 },
      })
    );
    expect(speechOnly.survivor.value).toBeGreaterThanOrEqual(0.25);
    expect(speechOnly.survivor.value).toBeLessThanOrEqual(0.35);
  });

  it("thermal confirms human heat within ambient range and never a lone claim of 100%", () => {
    const thermal = { objectC: 34.5, ambientC: 25, heardAt: 999_000 };
    const s = computeScores(ctx({ thermal })).survivor;
    expect(s.value).toBeGreaterThan(0.3);
    expect(s.value).toBeLessThan(0.7); // heat alone without camera produces balanced in-between score
    expect(s.breakdown.thermal.note.toLowerCase()).toContain("heat");
  });

  it("temperature fusion rules table: human heat declaration across ambient ranges", () => {
    // 1. -20°C to 0°C (Freezing) -> 5°C – 22°C
    expect(isHumanHeat(-5, 16)).toBe(true);
    expect(isHumanHeat(-5, 3)).toBe(false);

    // 2. 0°C to 10°C (Very Cold) -> 15°C – 29°C
    expect(isHumanHeat(5, 22)).toBe(true);

    // 3. 10°C to 20°C (Cool / AC Room) -> 20°C – 33°C
    expect(isHumanHeat(18, 28)).toBe(true);

    // 4. 20°C to 30°C (Room Temp / Warm) -> 25°C – 40°C (user screenshot: 40.6°C object over 21.7°C ambient)
    expect(isHumanHeat(21.7, 40.6)).toBe(true);
    expect(isHumanHeat(25, 36)).toBe(true);

    // 5. 30°C to 40°C (Hot) -> 33.5°C – 41°C
    expect(isHumanHeat(35, 38)).toBe(true);

    // 6. Above 40°C (Extreme Heat) -> 35°C – 42°C
    expect(isHumanHeat(42, 38.5)).toBe(true);

    // Rule: difference < 1.5°C must NOT be identified as human heat
    expect(isHumanHeat(24.0, 25.0)).toBe(false); // delta = 1.0 < 1.5
    expect(isHumanHeat(22.0, 23.4)).toBe(false); // delta = 1.4 < 1.5
  });

  it("any reading (e.g. 15-20 dB or ambient thermal) contributes at least 1% to survivor score", () => {
    const lowSound = computeScores(ctx({ sound: { db: 15, amp: 0.05, baseline: 0.07, peak: 0.05, heardAt: 999_000 } }));
    expect(lowSound.survivor.value).toBeGreaterThanOrEqual(0.01);
    expect(lowSound.survivor.breakdown.sound.value).toBeGreaterThanOrEqual(0.03);

    const normalTemp = computeScores(ctx({ thermal: { objectC: 22.0, ambientC: 21.5, heardAt: 999_000 } }));
    expect(normalTemp.survivor.value).toBeGreaterThanOrEqual(0.01);
    expect(normalTemp.survivor.breakdown.thermal.value).toBeGreaterThanOrEqual(0.03);
  });

  it("fire risk (>55 °C) is a HAZARD, never a survivor signal", () => {
    const r = computeScores(ctx({ thermal: { objectC: 120, ambientC: 25, heardAt: 999_000 } }));
    expect(r.hazard.fireDetected).toBe(true);
    expect(r.hazard.value).toBeGreaterThanOrEqual(0.35);
    expect(r.survivor.value).toBe(0); // hot object ≠ person
  });

  it("human detection confidence directly equals vision score and survivor score", () => {
    for (const conf of [0.65, 0.78, 0.85, 0.92]) {
      const det = {
        id: "det-human",
        ts: 999_500, // within active window (now = 1_000_000)
        label: "person" as const,
        confidence: conf,
        bbox: { x: 0, y: 0, w: 0.2, h: 0.5 },
        source: "vision" as const,
      };
      const res = computeScores(ctx({ detections: [det] }));
      expect(res.survivor.breakdown.vision.value).toBe(conf);
      expect(res.survivor.value).toBe(conf);
    }
  });

  it("sound decibel classification follows speech-level reference guide", () => {
    expect(classifySound(20)).toBe("QUIET");
    expect(classifySound(35)).toBe("HUMAN WHISPER");
    expect(classifySound(45)).toBe("HUMAN SOFT SPEECH");
    expect(classifySound(60)).toBe("HUMAN TALK");
    expect(classifySound(75)).toBe("HUMAN LOUD SPEECH");
    expect(classifySound(88)).toBe("HUMAN YELLING");
    expect(classifySound(98)).toBe("Very Loud Sound");
  });

  it("sounds exceeding 95 dB are classified as Very Loud Sound and do not inflate survivor score as vocalization", () => {
    const res90 = computeScores(ctx({ sound: { amp: 0.9, baseline: 0.07, peak: 0.9, db: 90, heardAt: 999_500 } }));
    const res105 = computeScores(ctx({ sound: { amp: 1.0, baseline: 0.07, peak: 1.0, db: 105, heardAt: 999_500 } }));
    expect(res90.survivor.breakdown.sound.note).toContain("HUMAN YELLING");
    expect(res105.survivor.breakdown.sound.note).toContain("Very Loud Sound");
    // 90 dB yelling reflects human presence (~0.90+ sound score, ~0.55+ survivor)
    // 105 dB is non-vocal disturbance (modest ~0.15 sound score)
    expect(res90.survivor.breakdown.sound.value).toBeGreaterThan(res105.survivor.breakdown.sound.value);
    expect(res90.survivor.value).toBeGreaterThan(res105.survivor.value);
  });

  it("survivor score strictly never reaches or exceeds 100% (always < 1.0)", () => {
    // Extreme theoretical inputs: 100% camera detection + max sound + peak human thermal heat
    const det = {
      id: "det-max",
      ts: 999_900,
      label: "person" as const,
      confidence: 1.0,
      bbox: { x: 0, y: 0, w: 0.2, h: 0.5 },
      source: "vision" as const,
    };
    const res = computeScores(
      ctx({
        detections: [det],
        sound: { amp: 1.0, baseline: 0.07, peak: 1.0, db: 95, heardAt: 999_900 },
        thermal: { objectC: 36.5, ambientC: 22.0, heardAt: 999_900 },
      })
    );
    expect(res.survivor.value).toBeLessThan(1.0);
    expect(res.survivor.value).toBeLessThanOrEqual(0.99);
    expect(res.survivor.breakdown.vision.value).toBeLessThan(1.0);
    expect(res.survivor.breakdown.sound.value).toBeLessThan(1.0);
    expect(res.survivor.breakdown.thermal.value).toBeLessThan(1.0);
  });
});

describe("fusion engine v2 — hazard & accessibility", () => {
  it("gas hazard scales with ppm", () => {
    const low = computeScores(ctx({ gas: { ppm: 300, adc: 600, heardAt: 999_000 } })).hazard.value;
    const high = computeScores(ctx({ gas: { ppm: 1100, adc: 2200, heardAt: 999_000 } })).hazard.value;
    expect(high).toBeGreaterThan(low);
  });

  it("tight clearance blocks accessibility", () => {
    const open = computeScores(ctx({ distance: { mm: 900, status: "valid", source: "vl53l0x", heardAt: 999_000 } })).accessibility;
    const blocked = computeScores(ctx({ distance: { mm: 80, status: "valid", source: "vl53l0x", heardAt: 999_000 } })).accessibility;
    expect(open.level).toBe("mobile");
    expect(blocked.level).toBe("blocked");
    expect(blocked.reasons.join(" ")).toContain("120 mm");
  });

  it("an offline robot cannot be accessible", () => {
    const a = computeScores(ctx({ link: "offline" })).accessibility;
    expect(a.value).toBe(0);
    expect(a.level).toBe("blocked");
  });
});
