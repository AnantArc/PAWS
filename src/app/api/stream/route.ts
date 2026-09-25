import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { readSessionFromCookies } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Server-Sent Events stream: pushes a compact snapshot after every store
 * mutation. The console subscribes here; in Supabase mode the same endpoint
 * polls the DB at 2 s inside the store, so the client code is identical.
 */
export async function GET(req: Request) {
  const user = readSessionFromCookies();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const store = getStore();
  const encoder = new TextEncoder();

  let lastJson = "";

  const stream = new ReadableStream({
    start(controller) {
      const push = async () => {
        const s = await store.getState();
        const compact = {
          ...s,
          events: s.events.slice(0, 80),
          alerts: s.alerts.slice(0, 40),
          detections: s.detections.slice(0, 40),
          commands: s.commands.slice(0, 20),
          trail: s.trail.slice(-600),
          scoreHistory: s.scoreHistory.slice(-180),
        };
        const json = JSON.stringify(compact);
        if (json === lastJson) return;
        lastJson = json;
        controller.enqueue(encoder.encode(`data: ${json}\n\n`));
      };
      void push();
      const unsub = store.subscribe(() => void push());
      const ping = setInterval(() => controller.enqueue(encoder.encode(": ping\n\n")), 15_000);
      req.signal.addEventListener("abort", () => {
        clearInterval(ping);
        unsub();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
