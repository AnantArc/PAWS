import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import {
  DEFAULT_ROBOT_ID,
  DEMO_USERS,
  SESSION_COOKIE_NAME,
  mode,
  roleFromSupabase,
  signSession,
  type SessionUser,
} from "@/lib/auth";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

const Body = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  /** Personalized operator name — typed at login, shown in the header
   *  and used for command attribution. */
  operatorName: z.string().max(40).optional(),
  /** The PAWS robot this session drives (dropdown at login). */
  robotId: z.string().min(1).max(40).optional(),
});

export async function POST(req: Request) {
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const { email, password, operatorName, robotId } = body.data;
  const chosenRobot = robotId ?? DEFAULT_ROBOT_ID;

  if (mode() === "local") {
    const user = DEMO_USERS.find((u) => u.email === email.toLowerCase() && u.password === password);
    if (!user) return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    const session: SessionUser = {
      name: operatorName?.trim() || user.name,
      email: user.email,
      role: user.role,
      mode: "local",
      robotId: chosenRobot,
    };
    const res = NextResponse.json({ ok: true, role: user.role, name: session.name, robotId: session.robotId });
    res.cookies.set(SESSION_COOKIE_NAME, signSession(session), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 12,
      path: "/",
    });
    return res;
  }

  // ---- Supabase mode ------------------------------------------------------
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });

  const cookieStore = cookies();
  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: Array<{ name: string; value: string; options?: Record<string, unknown> }>) {
        for (const { name: n, value: v, options } of cookiesToSet) {
          cookieStore.set({ name: n, value: v, ...options });
        }
      },
    },
  });

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  const session: SessionUser = {
    name: operatorName?.trim() || (data.user.user_metadata?.name as string) || email.split("@")[0],
    email,
    role: roleFromSupabase(data.user),
    mode: "supabase",
    robotId: chosenRobot,
  };
  return NextResponse.json({ ok: true, role: session.role, name: session.name, robotId: session.robotId });
}

export async function GET() {
  let robots: Array<{ id: string; name: string }> = [];
  try {
    robots = await getStore().listRobots();
  } catch {
    robots = [];
  }
  return NextResponse.json({
    mode: mode(),
    demoUsers: mode() === "local" ? DEMO_USERS.map(({ password: _p, ...u }) => u) : [],
    robots: robots.length ? robots : [{ id: DEFAULT_ROBOT_ID, name: "PAWS Alpha" }],
  });
}
