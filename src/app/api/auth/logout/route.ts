import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { SESSION_COOKIE_NAME, mode } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST() {
  const cookieStore = cookies();
  if (mode() === "supabase") {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (url && anon) {
      const supabase = createServerClient(url, anon, {
        cookies: {
          getAll: () => cookieStore.getAll(),
          setAll: (c: Array<{ name: string; value: string; options?: Record<string, unknown> }>) =>
            c.forEach(({ name, value, options }) => cookieStore.set({ name, value, ...options })),
        },
      });
      await supabase.auth.signOut();
    }
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE_NAME, "", { maxAge: 0, path: "/" });
  return res;
}
