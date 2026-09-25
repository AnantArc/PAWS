import { NextResponse } from "next/server";
import { TelemetryPayloadSchema } from "@/lib/contract";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * THE single write path for robot data.
 * The ESP32 posts here (keep-alive HTTPS, VGA JPEG ~30 KB). Device token
 * authenticates the robot; zod validates every byte; the store owns fusion.
 */
export async function POST(req: Request) {
  const deviceToken = req.headers.get("x-device-token");
  const expected = process.env.INGEST_DEVICE_TOKEN ?? "paws-device-token";
  if (deviceToken !== expected) {
    return NextResponse.json({ error: "invalid device token" }, { status: 401 });
  }

  const json = await req.json().catch(() => null);
  const parsed = TelemetryPayloadSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid payload", detail: parsed.error.flatten() }, { status: 422 });
  }

  await getStore().ingest(parsed.data);
  return NextResponse.json({ ok: true, ts: Date.now() });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: "PAWS telemetry ingest",
    contract: "v2.1",
    headers: { "x-device-token": "required" },
  });
}
