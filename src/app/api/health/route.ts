import { NextResponse } from "next/server";
import { getStore, dataMode } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const store = getStore();
  const h = store.health();
  return NextResponse.json({
    ok: true,
    service: "paws-console",
    mode: dataMode(),
    store: store.mode,
    detection: process.env.DETECTION_PROVIDER ?? "simulated",
    ...h,
  });
}
