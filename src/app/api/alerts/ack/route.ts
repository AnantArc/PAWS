import { NextResponse } from "next/server";
import { z } from "zod";
import { getStore } from "@/lib/store";
import { readSessionFromCookies } from "@/lib/auth";

export const dynamic = "force-dynamic";

const Body = z.object({ id: z.string().min(1) });

export async function POST(req: Request) {
  const user = readSessionFromCookies();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "operator")
    return NextResponse.json({ error: "Observers are read-only" }, { status: 403 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 422 });

  await getStore().ackAlert(parsed.data.id, user.name);
  return NextResponse.json({ ok: true });
}
