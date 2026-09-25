import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { readSessionFromCookies } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = readSessionFromCookies();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const state = await getStore().getState();
  return NextResponse.json(state);
}
