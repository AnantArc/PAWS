"use client";

/**
 * SYSTEM STATUS PILL
 * ------------------
 * Bound to the real /api/health endpoint — it turns red if the console
 * backend stops answering. Nothing here is hardcoded.
 */

import { useEffect, useState } from "react";

type State = "checking" | "ready" | "offline";

export function SystemStatus() {
  const [state, setState] = useState<State>("checking");

  useEffect(() => {
    let alive = true;
    async function ping() {
      try {
        const res = await fetch("/api/health", { cache: "no-store" });
        const d = await res.json();
        if (alive) setState(res.ok && d.ok ? "ready" : "offline");
      } catch {
        if (alive) setState("offline");
      }
    }
    void ping();
    const t = setInterval(ping, 20000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const map = {
    checking: { label: "CHECKING", dot: "rgb(var(--text-faint))", text: "text-text-faint" },
    ready: { label: "SYSTEM READY", dot: "rgb(var(--status-ok))", text: "text-ok" },
    offline: { label: "OFFLINE", dot: "rgb(var(--status-critical))", text: "text-critical" },
  }[state];

  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10.5px] font-bold uppercase tracking-[0.12em] ${map.text}`}
      style={{ borderColor: "rgb(var(--land-hair) / var(--land-hair-a))" }}
      title={state === "ready" ? "Console backend reachable" : state === "offline" ? "Console backend unreachable" : "Contacting console…"}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${state === "ready" ? "animate-pulse" : ""}`}
        style={{ background: map.dot }}
      />
      {map.label}
    </span>
  );
}
