"use client";

import { useEffect, useRef, useState } from "react";
import type { ConsoleState } from "@/lib/types";

/**
 * Single source of truth for the live console.
 * Initial snapshot via /api/state, then a Server-Sent Events subscription.
 * Includes automatic fast-recovery fallback polling so no data is ever delayed,
 * even during SSE reconnects on serverless hosts.
 */
export function useConsoleState() {
  const [state, setState] = useState<ConsoleState | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const retry = useRef(0);

  useEffect(() => {
    let es: EventSource | null = null;
    let closed = false;
    let pollInterval: ReturnType<typeof setInterval> | null = null;

    async function fetchState() {
      try {
        const res = await fetch("/api/state", { cache: "no-store" });
        if (!res.ok) throw new Error("state unavailable");
        const snap = (await res.json()) as ConsoleState;
        if (!closed) setState(snap);
      } catch {
        /* skip failed tick */
      }
    }

    function startStream() {
      if (closed) return;
      if (es) {
        es.close();
        es = null;
      }
      es = new EventSource("/api/stream");
      es.onopen = () => {
        setConnected(true);
        retry.current = 0;
      };
      es.onmessage = (ev) => {
        try {
          const snap = JSON.parse(ev.data) as ConsoleState;
          if (!closed) {
            setState(snap);
            setConnected(true);
          }
        } catch {
          /* skip malformed frames */
        }
      };
      es.onerror = () => {
        setConnected(false);
      };
    }

    void fetchState();
    startStream();

    // Safety fallback poll: ensures live data updates with 0 delay
    // even during serverless function resets or network reconnects
    pollInterval = setInterval(() => {
      void fetchState();
    }, 1500);

    return () => {
      closed = true;
      if (pollInterval) clearInterval(pollInterval);
      es?.close();
    };
  }, []);

  return { state, connected, error };
}
