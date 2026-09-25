"use client";

import { useState } from "react";
import Link from "next/link";
import { Settings2, Sliders } from "lucide-react";
import type { ConsoleState } from "@/lib/types";
import { Card, LevelBadge } from "@/components/ui";
import { Sparkline, TrendBar } from "@/components/charts";
import { fmtAgo, t } from "@/lib/utils";

const SRC_COLOR: Record<string, { color: string; key: "vision" | "sound" | "thermal" }> = {
  vision: { color: t("accent"), key: "vision" },
  sound: { color: t("status-info"), key: "sound" },
  thermal: { color: t("status-ok"), key: "thermal" },
};

export function ScorePanel({ state }: { state: ConsoleState }) {
  const [showWeightModal, setShowWeightModal] = useState(false);
  const now = state.now;
  const last = state.scoreHistory.slice(-1)[0];
  const reasons = last?.survivor.reasons ?? ["No evidence yet — score is 0% until a signal arrives."];
  const hist = state.scoreHistory.slice(-90);

  const [weights, setWeights] = useState({
    vision: last?.weights.vision ?? 0.5,
    sound: last?.weights.sound ?? 0.3,
    thermal: last?.weights.thermal ?? 0.2,
  });

  if (!last) {
    return (
      <Card title="Survivor Likelihood" sub="fusion v2.1 · explainable" className="flex h-full flex-col">
        <div className="flex h-full items-center justify-center text-[12px] text-text-faint">
          Waiting for the first telemetry tick…
        </div>
      </Card>
    );
  }

  // Double-digit percentage representation (e.g. 56% or 87%)
  const scorePct = Math.round(last.survivor.value * 100);

  const w = last.weights;
  const wTotal = w.vision + w.sound + w.thermal || 1;
  const pct = (x: number) => Math.round((x / wTotal) * 100);

  const sources = [
    { key: "vision", label: "VISION", v: last.survivor.breakdown.vision.value, note: last.survivor.breakdown.vision.note, weightPct: pct(w.vision) },
    { key: "sound", label: "SOUND", v: last.survivor.breakdown.sound.value, note: last.survivor.breakdown.sound.note, weightPct: pct(w.sound) },
    { key: "thermal", label: "THERMAL", v: last.survivor.breakdown.thermal.value, note: last.survivor.breakdown.thermal.note, weightPct: pct(w.thermal) },
  ];

  async function handleSaveWeights() {
    await fetch("/api/weights", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(weights),
    });
    setShowWeightModal(false);
  }

  return (
    <Card
      title="Survivor Likelihood"
      sub={`fusion v${last.weights.version} · timestamped ${fmtAgo(last.ts, now)}`}
      right={<LevelBadge level={last.survivor.level} />}
      className="flex h-full flex-col"
      bodyClass="flex min-h-0 flex-1 flex-col p-3.5"
    >
      {/* Big Score Row — Double Digit % · fusion settings beside the score */}
      <div className="flex shrink-0 items-end justify-between gap-2">
        <div className="flex min-w-0 items-end gap-2">
          <div className="whitespace-nowrap">
            <span className="tnum text-5xl font-extrabold leading-none text-text-primary">
              {scorePct}%
            </span>
            <span className="ml-2 text-[11px] font-bold uppercase tracking-wider text-text-faint">Confidence</span>
          </div>
          <button
            onClick={() => setShowWeightModal(true)}
            className="shrink-0 rounded p-0.5 text-text-faint hover:bg-surface-2 hover:text-accent transition-colors"
            title="Fusion Settings"
          >
            <Settings2 size={15} />
          </button>
        </div>
        <div className="w-28 shrink min-w-[88px]">
          <Sparkline data={hist.map((h) => Math.round(h.survivor.value * 100))} height={44} color={t("accent")} />
        </div>
      </div>

      {/* 3 Source Progress Bars */}
      <div className="mt-4 space-y-2.5">
        {sources.map((s) => (
          <div key={s.key} title={s.note}>
            <div className="mb-1 flex items-center justify-between text-[11px]">
              <span className="font-semibold tracking-wide text-text-muted">
                {s.label} <span className="ml-1 text-text-faint">({s.weightPct}% weight)</span>
              </span>
              <span className="tnum font-bold text-text-primary">{Math.round(s.v * 100)}%</span>
            </div>
            <TrendBar value={s.v} color={SRC_COLOR[s.key].color} />
          </div>
        ))}
      </div>

      {/* Expect a Human if Score is > 70% — plain English details */}
      <div className="scroll-thin mt-4 min-h-0 flex-1 overflow-y-auto rounded-md border border-border bg-bg/50 p-2.5">
        <div className="mb-1 text-[10.5px] font-extrabold uppercase tracking-[0.12em] text-accent">
          Expect a Human if Score is &gt; 70%
        </div>
        <ul className="space-y-1">
          {reasons.map((r, i) => (
            <li key={i} className="break-words text-[11.5px] leading-snug text-text-muted">
              • {r}
            </li>
          ))}
        </ul>
      </div>

      {/* Fusion Weight Configuration Modal */}
      {showWeightModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm animate-fadein">
          <div className="w-full max-w-md rounded-xl border border-border bg-surface p-5 shadow-2xl">
            <div className="mb-3 flex items-center gap-2 text-accent">
              <Sliders size={20} />
              <h3 className="text-base font-bold text-text-primary">Fusion Weight Settings</h3>
            </div>
            <p className="mb-4 text-[12px] text-text-muted leading-relaxed">
              Adjust algorithm weights for survivor likelihood score calculations.
            </p>

            <div className="space-y-4 mb-5">
              <div>
                <div className="flex justify-between text-[12px] font-semibold mb-1">
                  <span>Vision Weight</span>
                  <span className="tnum text-accent">{Math.round(weights.vision * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={weights.vision}
                  onChange={(e) => setWeights({ ...weights, vision: parseFloat(e.target.value) })}
                  className="w-full accent-accent"
                />
              </div>

              <div>
                <div className="flex justify-between text-[12px] font-semibold mb-1">
                  <span>Sound Weight</span>
                  <span className="tnum text-accent">{Math.round(weights.sound * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={weights.sound}
                  onChange={(e) => setWeights({ ...weights, sound: parseFloat(e.target.value) })}
                  className="w-full accent-accent"
                />
              </div>

              <div>
                <div className="flex justify-between text-[12px] font-semibold mb-1">
                  <span>Thermal Weight</span>
                  <span className="tnum text-accent">{Math.round(weights.thermal * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={weights.thermal}
                  onChange={(e) => setWeights({ ...weights, thermal: parseFloat(e.target.value) })}
                  className="w-full accent-accent"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2.5">
              <button
                onClick={() => setShowWeightModal(false)}
                className="rounded-lg border border-border px-4 py-2 text-[12px] font-medium text-text-muted hover:bg-surface-2"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveWeights}
                className="rounded-lg bg-accent px-5 py-2 text-[12px] font-bold text-slate-950 hover:brightness-110 shadow-md"
              >
                Save Weights
              </button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
