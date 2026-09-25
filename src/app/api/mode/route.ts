import { NextResponse } from "next/server";
import { z } from "zod";
import { dataMode, getStore, setDataModeOverride } from "@/lib/store";
import { readSessionFromCookies } from "@/lib/auth";

export const dynamic = "force-dynamic";

const Body = z.object({ mode: z.enum(["local", "supabase"]) });

/**
 * One-click LIVE ↔ DEMO switch (demo-day fallback if WiFi / Supabase
 * misbehaves). Flips the store selector and drops the cached store;
 * the client reloads and picks up the new mode.
 */
export async function POST(req: Request) {
  const user = readSessionFromCookies();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "operator") return NextResponse.json({ error: "Observers are read-only" }, { status: 403 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 422 });

  // Validate the target store constructs before committing, so the toggle
  // can never brick the session (e.g. switching to supabase without env keys).
  const previous = dataMode();
  setDataModeOverride(parsed.data.mode);
  try {
    getStore();
  } catch (err) {
    setDataModeOverride(previous);
    return NextResponse.json(
      { error: `Cannot switch to ${parsed.data.mode} — ${err instanceof Error ? err.message : "not configured"}` },
      { status: 400 }
    );
  }
  return NextResponse.json({ ok: true, mode: parsed.data.mode });
}
