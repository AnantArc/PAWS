import { describe, expect, it } from "vitest";
import { computeScores, DEFAULT_WEIGHTS, type FusionContext } from "@/lib/fusion/engine";

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

  it("thermal is a close-range confirmer and never a lone survivor claim at distance", () => {
    const thermal = { objectC: 34.5, ambientC: 25, heardAt: 999_000 };
    const s = computeScores(ctx({ thermal })).survivor;
    expect(s.value).toBeGreaterThan(0);
    expect(s.value).toBeLessThan(0.7); // low weight ⇒ heat alone never claims a human
    expect(s.breakdown.thermal.note).toContain("Body-heat");
  });

  it("fire risk (>55 °C) is a HAZARD, never a survivor signal", () => {
    const r = computeScores(ctx({ thermal: { objectC: 120, ambientC: 25, heardAt: 999_000 } }));
    expect(r.hazard.fireDetected).toBe(true);
    expect(r.hazard.value).toBeGreaterThanOrEqual(0.35);
    expect(r.survivor.value).toBe(0); // hot object ≠ person
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
