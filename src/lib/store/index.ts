import { cookies } from "next/headers";
import { MemoryStore } from "./memory";
import { SupabaseStore } from "./supabase";
import type { ConsoleStore } from "./types";

export type { ConsoleStore, MissionTimeline } from "./types";

/**
 * Store selector — single source of truth for whether the console is in
 * LIVE (Supabase) mode or DEMO (local memory) mode.
 * Cached on globalThis with mode-awareness so Next.js HMR and route chunks
 * never get out of sync or flip between modes.
 */
declare global {
  // eslint-disable-next-line no-var
  var __pawsStore: ConsoleStore | undefined;
  // eslint-disable-next-line no-var
  var __pawsMode: "local" | "supabase" | undefined;
}

export function defaultMode(): "local" | "supabase" {
  if (process.env.DATA_MODE === "local") return "local";
  if (process.env.DATA_MODE === "supabase") return "supabase";
  // If Supabase URL or keys exist, default to supabase mode
  if (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return "supabase";
  }
  return "local";
}

export function dataMode(): "local" | "supabase" {
  // 1. Check runtime override stored on globalThis
  if (globalThis.__pawsMode) return globalThis.__pawsMode;

  // 2. Check cookie if in request context
  try {
    const c = cookies().get("paws_mode")?.value;
    if (c === "supabase" || c === "local") return c;
  } catch {
    /* cookies() not available outside request context */
  }

  // 3. Fallback to environment default
  return defaultMode();
}

/**
 * One-click switch. Drops the cached store so the next `getStore()`
 * constructs the other implementation (and the old simulator stops).
 */
export function setDataModeOverride(mode: "local" | "supabase") {
  globalThis.__pawsMode = mode;
  disposeCachedStore();
}

function disposeCachedStore() {
  const old = globalThis.__pawsStore;
  if (old && "dispose" in old && typeof (old as { dispose?: () => void }).dispose === "function") {
    (old as { dispose: () => void }).dispose();
  }
  globalThis.__pawsStore = undefined;
}

export function getStore(): ConsoleStore {
  const targetMode = dataMode();

  // If store exists and matches target mode, reuse it
  if (globalThis.__pawsStore && globalThis.__pawsStore.mode === targetMode) {
    return globalThis.__pawsStore;
  }

  // If store exists but mode changed, cleanly dispose the old one
  if (globalThis.__pawsStore) {
    disposeCachedStore();
  }

  globalThis.__pawsStore = targetMode === "supabase" ? new SupabaseStore() : new MemoryStore();
  return globalThis.__pawsStore;
}
