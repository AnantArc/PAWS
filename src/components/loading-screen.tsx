"use client";

import { useEffect, useState } from "react";
import { Logo } from "@/components/logo";

/** The real PAWS badge + animated loading bar shown while the console boots. */
export function LoadingScreen({ label = "CONNECTING TO PAWS" }: { label?: string }) {
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const t = setInterval(() => {
      setProgress((p) => {
        const next = p + Math.random() * 14 + 4;
        if (next >= 100) {
          clearInterval(t);
          setTimeout(() => setDone(true), 260);
          return 100;
        }
        return next;
      });
    }, 180);
    return () => clearInterval(t);
  }, []);

  if (done) return null;
  return (
    <div className="fixed inset-0 z-[100] flex animate-fadein flex-col items-center justify-center bg-bg">
      <div className="paws-float mb-6 flex h-24 w-24 items-center justify-center rounded-2xl border border-border bg-surface shadow-xl">
        <Logo size={76} />
      </div>
      <div className="tnum text-[13px] font-semibold tracking-[0.3em] text-text-muted">
        {label} · {Math.min(100, Math.round(progress))}%
      </div>
      <div className="mt-4 h-1.5 w-56 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full bg-accent transition-all duration-200" style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
}
