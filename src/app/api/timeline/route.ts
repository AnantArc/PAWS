import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { readSessionFromCookies } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = readSessionFromCookies();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const missionId = new URL(req.url).searchParams.get("mission");
  if (!missionId) return NextResponse.json({ error: "missing mission" }, { status: 400 });
  const timeline = await getStore().getMissionTimeline(missionId);
  if (!timeline) return NextResponse.json({ error: "mission not found" }, { status: 404 });
  return NextResponse.json(timeline);
}
