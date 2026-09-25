import { NextResponse } from "next/server";
import { WeightsRequestSchema } from "@/lib/contract";
import { getStore } from "@/lib/store";
import { readSessionFromCookies } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const user = readSessionFromCookies();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "operator")
    return NextResponse.json({ error: "Observers are read-only" }, { status: 403 });

  const parsed = WeightsRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid weights" }, { status: 422 });

  const weights = await getStore().setWeights(parsed.data);
  return NextResponse.json({ ok: true, weights });
}
