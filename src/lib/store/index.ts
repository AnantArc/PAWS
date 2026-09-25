import { MemoryStore } from "./memory";
import { SupabaseStore } from "./supabase";
import type { ConsoleStore } from "./types";

export type { ConsoleStore, MissionTimeline } from "./types";

/**
 * Store selector — the only place that knows which mode we're in.
 * Cached on globalThis so Next.js dev HMR never creates duplicate stores.
 */
declare global {
  // eslint-disable-next-line no-var
  var __pawsStore: ConsoleStore | undefined;
}

/** Runtime override (set by the LIVE ↔ DEMO switch). Never persisted. */
let modeOverride: "local" | "supabase" | null = null;

/**
 * One-click switch. Drops the cached store so the next `getStore()`
 * constructs the other implementation (and the old simulator stops).
 */
export function setDataModeOverride(mode: "local" | "supabase") {
  modeOverride = mode;
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
  if (globalThis.__pawsStore) return globalThis.__pawsStore;
  const mode = modeOverride ?? (process.env.DATA_MODE === "supabase" ? "supabase" : "local");
  globalThis.__pawsStore = mode === "supabase" ? new SupabaseStore() : new MemoryStore();
  return globalThis.__pawsStore;
}

export function dataMode(): "local" | "supabase" {
  return modeOverride ?? (process.env.DATA_MODE === "supabase" ? "supabase" : "local");
}
