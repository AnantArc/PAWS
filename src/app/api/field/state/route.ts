import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { verifyFieldToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Read-only state for the on-field rescuer (mobile). Authenticated by a
 * signed field token from the QR — a rescuer can watch the mission but
 * never issue anything. Polled by the phone at 3 s; tiny payload on purpose.
 */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token");
  if (!token) return NextResponse.json({ error: "missing token" }, { status: 401 });
  const claim = verifyFieldToken(token);
  if (!claim) return NextResponse.json({ error: "invalid or expired link" }, { status: 401 });

  const store = getStore();
  const state = await store.getState();
  if (state.mission.id !== claim.missionId) {
    return NextResponse.json({ error: "link is for a different mission" }, { status: 404 });
  }

  const pins = state.detections
    .filter((d) => d.position)
    .slice(0, 30)
    .map((d) => ({
      id: d.id,
      ts: d.ts,
      confidence: d.confidence,
      position: d.position,
      note: `Person detected · ${Math.round(d.confidence * 100)}%`,
    }));

  return NextResponse.json({
    mission: { name: state.mission.name, status: state.mission.status, startedAt: state.mission.startedAt },
    device: state.device,
    position: state.sensors.position,
    gasPpm: state.sensors.gas?.ppm ?? null,
    pins,
    latestScore: state.scoreHistory.slice(-1)[0]?.survivor.value ?? 0,
    recentEvents: state.events
      .filter((e) => ["detection", "alert", "mission", "link", "sound_event"].includes(e.kind))
      .slice(0, 30)
      .map((e) => ({ id: e.id, ts: e.ts, kind: e.kind, level: e.level, text: e.text })),
    now: Date.now(),
  });
}
