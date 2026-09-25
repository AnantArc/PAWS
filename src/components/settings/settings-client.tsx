"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, RotateCcw, SlidersHorizontal } from "lucide-react";
import type { ScoreWeights } from "@/lib/types";
import { DEFAULT_WEIGHTS } from "@/lib/fusion/engine";
import type { SessionUser } from "@/lib/auth";
import { Button } from "@/components/ui";
import { ThemeToggle } from "@/components/theme";

/**
 * Fusion weight tuning — a live stage moment: shift how strongly vision
 * vs sound vs thermal drive the survivor score and watch the console
 * react within one tick.
 */
export function SettingsClient({ user }: { user: SessionUser }) {
  const [w, setW] = useState<ScoreWeights>({ ...DEFAULT_WEIGHTS });
  const [status, setStatus] = useState<string | null>(null);
  const isOperator = user.role === "operator";

  useEffect(() => {
    fetch("/api/state", { cache: "no-store" })
      .then((r) => r.json())
      .then((s) => s.weights && setW(s.weights))
      .catch(() => {});
  }, []);

  const save = useCallback(async (next: ScoreWeights) => {
    setStatus("saving…");
    const res = await fetch("/api/weights", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ vision: next.vision, sound: next.sound, thermal: next.thermal }),
    });
    setStatus(res.ok ? "saved — console updated live" : "failed — observers are read-only");
    setTimeout(() => setStatus(null), 2200);
  }, []);

  const sliders: Array<{ key: "vision" | "sound" | "thermal"; label: string; hint: string }> = [
    { key: "vision", label: "Vision (person detection)", hint: "strongest, but only sees what the camera sees" },
    { key: "sound", label: "Sound (loud events)", hint: "catches calls for help the camera missed" },
    { key: "thermal", label: "Thermal (body heat)", hint: "close-range confirmer only — never over-claims" },
  ];

  return (
    <div className="min-h-screen bg-bg p-4 text-text-primary">
      <div className="mx-auto max-w-xl space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/console" className="flex items-center gap-1 text-[12.5px] text-text-muted hover:text-accent">
              <ChevronLeft size={14} /> Console
            </Link>
            <h1 className="text-lg font-bold">Fusion Settings</h1>
            <SlidersHorizontal size={16} className="text-text-faint" />
          </div>
          <ThemeToggle />
        </div>

        <div className="rounded-lg border border-border bg-surface p-5">
          <p className="mb-4 text-[12.5px] leading-relaxed text-text-muted">
            Weights decide how the three independent survivor signals combine into the Survivor Likelihood score.
            Changes apply on the next telemetry tick — watch the score card react.
          </p>
          <div className="space-y-5">
            {sliders.map((s) => (
              <div key={s.key}>
                <div className="mb-1 flex items-baseline justify-between">
                  <div>
                    <span className="text-[13px] font-semibold">{s.label}</span>
                    <span className="ml-2 text-[11px] text-text-faint">{s.hint}</span>
                  </div>
                  <span className="tnum text-[13px] font-bold text-accent">{w[s.key].toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={w[s.key]}
                  disabled={!isOperator}
                  onChange={(e) => setW((prev) => ({ ...prev, [s.key]: Number(e.target.value) }))}
                  className="w-full accent-cyan-400"
                />
              </div>
            ))}
          </div>

          <div className="mt-6 flex items-center gap-2 border-t border-border pt-4">
            {isOperator ? (
              <>
                <Button variant="primary" onClick={() => save(w)}>
                  Apply weights
                </Button>
                <Button variant="ghost" onClick={() => setW({ ...DEFAULT_WEIGHTS })}>
                  <RotateCcw size={13} /> Reset to defaults
                </Button>
              </>
            ) : (
              <span className="text-[12px] italic text-text-faint">observer session — weights are read-only</span>
            )}
            {status && <span className="ml-auto text-[12px] font-medium text-accent">{status}</span>}
          </div>

          <p className="mt-3 text-[11px] text-text-faint">
            version {w.version} · every score stores the weights that produced it, so any historical number can be
            re-explained.
          </p>
        </div>

        <div className="rounded-lg border border-border bg-surface p-4 text-[12px] text-text-muted">
          <div className="mb-1 font-bold uppercase tracking-wider text-text-faint">Data integrity</div>
          <ul className="list-inside list-disc space-y-1">
            <li>Nothing is displayed that a sensor didn't produce.</li>
            <li>No evidence = score 0. The score never invents a survivor.</li>
            <li>A single sensor may confirm a survivor; agreeing sensors can only raise the score.</li>
            <li>Every command is audited: who, when, and what the robot confirmed.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
