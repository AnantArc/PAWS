import { NextResponse } from "next/server";
import { CommandRequestSchema } from "@/lib/contract";
import { getStore } from "@/lib/store";
import { readSessionFromCookies } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const user = readSessionFromCookies();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "operator")
    return NextResponse.json({ error: "Observers are read-only — commands are disabled" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = CommandRequestSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid command" }, { status: 422 });

  const cmd = await getStore().issueCommand({ ...parsed.data, issuedBy: user.name });
  return NextResponse.json({ ok: true, command: cmd });
}
