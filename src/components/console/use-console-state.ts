"use client";

import { useEffect, useRef, useState } from "react";
import type { ConsoleState } from "@/lib/types";

/**
 * Single source of truth for the live console.
 * Initial snapshot via /api/state, then a Server-Sent Events subscription.
 * Works identically in local demo mode and Supabase mode.
 */
export function useConsoleState() {
  const [state, setState] = useState<ConsoleState | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const retry = useRef(0);

  useEffect(() => {
    let es: EventSource | null = null;
    let closed = false;

    async function init() {
      try {
        const res = await fetch("/api/state", { cache: "no-store" });
        if (!res.ok) throw new Error("state unavailable");
        const snap = (await res.json()) as ConsoleState;
        if (!closed) setState(snap);
      } catch {
        /* SSE will retry below */
      }

      if (closed) return;
      es = new EventSource("/api/stream");
      es.onopen = () => {
        setConnected(true);
        retry.current = 0;
      };
      es.onmessage = (ev) => {
        try {
          const snap = JSON.parse(ev.data) as ConsoleState;
          setState(snap);
        } catch {
          /* skip malformed frames */
        }
      };
      es.onerror = () => {
        setConnected(false);
      };
    }

    void init();
    return () => {
      closed = true;
      es?.close();
    };
  }, []);

  return { state, connected, error };
}
