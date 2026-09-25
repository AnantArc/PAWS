import { NextResponse } from "next/server";
import { readSessionFromCookies, mode } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = readSessionFromCookies();
  return NextResponse.json({ authed: !!user, user, mode: mode() });
}
