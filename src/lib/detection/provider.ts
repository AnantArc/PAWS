import type { Detection } from "@/lib/types";
import { uid } from "@/lib/utils";
import { DETECT_RANGE_M, detectionConfidence, nearestSurvivor } from "@/lib/world";

/**
 * DETECTION PROVIDER
 * ------------------
 * The ingest pipeline asks a provider for detections on each frame.
 *  - simulated : the camera only sees a person when the robot is actually
 *                within sensor range of one of the world model's survivor
 *                positions (src/lib/world.ts) — the same person the thermal,
 *                acoustic and PIR channels are reacting to in that tick
 *  - server    : POSTs the frame to DETECTION_SERVICE_URL and expects
 *                { detections: [{ label, confidence, bbox }] }
 * Swap by env — no other code changes. (On-device FOMO remains finale roadmap.)
 */
export interface DetectionProvider {
  readonly name: "simulated" | "server";
  detect(input: {
    frameId: number;
    ts: number;
    position?: { xM: number; yM: number };
  }): Promise<Detection[]>;
}

/**
 * The simulated camera is POSITION-DRIVEN, not frame-counted: a person is in
 * frame only while the robot is within DETECT_RANGE_M of a survivor position,
 * and the reported confidence follows the geometry (closer = more confident).
 * Because the survivor list lives in the shared world model, this detection is
 * automatically in step with the simulator's sound / thermal / PIR reactions.
 */
export class SimulatedDetectionProvider implements DetectionProvider {
  readonly name = "simulated" as const;

  async detect(input: {
    frameId: number;
    ts: number;
    position?: { xM: number; yM: number };
  }): Promise<Detection[]> {
    if (!input.position) return [];
    const near = nearestSurvivor(input.position);
    if (!near || near.distanceM > DETECT_RANGE_M) return [];

    const closeness = 1 - Math.min(1, near.distanceM / DETECT_RANGE_M);
    const w = 0.1 + 0.1 * closeness; // box grows as the robot closes in
    const h = 0.42 + 0.2 * closeness;
    return [
      {
        id: uid("det"),
        ts: input.ts,
        label: "person" as const,
        confidence: detectionConfidence(near.distanceM),
        bbox: { x: Math.round((0.5 - w / 2) * 100) / 100, y: Math.round((0.26 - h / 2) * 100) / 100, w: Math.round(w * 100) / 100, h: Math.round(h * 100) / 100 },
        position: { xM: near.spot.xM, yM: near.spot.yM },
        source: "vision" as const,
      },
    ];
  }
}

export class ServerDetectionProvider implements DetectionProvider {
  readonly name = "server" as const;
  private url: string;

  constructor(url: string) {
    this.url = url;
  }

  async detect(input: {
    frameId: number;
    ts: number;
    position?: { xM: number; yM: number };
  }): Promise<Detection[]> {
    // The deployment posts the frame here; the local build never calls this
    // unless configured. Timeout + graceful fallback keep the console alive.
    try {
      const res = await fetch(this.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ frameId: input.frameId, ts: input.ts }),
        signal: AbortSignal.timeout(3500),
      });
      if (!res.ok) return [];
      const data = (await res.json()) as {
        detections?: Array<{ label: string; confidence: number; bbox: { x: number; y: number; w: number; h: number } }>;
      };
      return (data.detections ?? [])
        .filter((d) => d.label === "person" && d.confidence > 0.4)
        .map((d) => ({
          id: uid("det"),
          ts: input.ts,
          label: "person" as const,
          confidence: Math.round(d.confidence * 100) / 100,
          bbox: d.bbox,
          position: input.position,
          source: "vision" as const,
        }));
    } catch {
      return [];
    }
  }
}

export function getDetectionProvider(): DetectionProvider {
  const mode = process.env.DETECTION_PROVIDER ?? "simulated";
  if (mode === "server" && process.env.DETECTION_SERVICE_URL) {
    return new ServerDetectionProvider(process.env.DETECTION_SERVICE_URL);
  }
  return new SimulatedDetectionProvider();
}
