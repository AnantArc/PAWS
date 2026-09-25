import { NextResponse } from "next/server";
import { z } from "zod";
import { getStore } from "@/lib/store";
import { readSessionFromCookies } from "@/lib/auth";

export const dynamic = "force-dynamic";

const Body = z.object({
  action: z.enum(["start", "pause", "resume", "end"]),
  name: z.string().min(1).max(80).optional(),
  robotId: z.string().min(1).max(40).optional(),
});

export async function POST(req: Request) {
  const user = readSessionFromCookies();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "operator")
    return NextResponse.json({ error: "Observers are read-only" }, { status: 403 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 422 });

  const store = getStore();
  switch (parsed.data.action) {
    case "start":
      await store.startMission(parsed.data.name ?? "Field Mission", parsed.data.robotId ?? user.robotId);
      break;
    case "pause":
      await store.pauseMission();
      break;
    case "resume":
      await store.resumeMission();
      break;
    case "end":
      await store.endMission();
      break;
  }
  return NextResponse.json({ ok: true });
}

export async function GET() {
  const user = readSessionFromCookies();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ missions: await getStore().listMissions() });
}
