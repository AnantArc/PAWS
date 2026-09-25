import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { readSessionFromCookies, signFieldToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = readSessionFromCookies();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "operator")
    return NextResponse.json({ error: "Observers are read-only" }, { status: 403 });

  const state = await getStore().getState();
  const missionId = state.mission.id;
  const token = signFieldToken(missionId);
  return NextResponse.json({ ok: true, token });
}
