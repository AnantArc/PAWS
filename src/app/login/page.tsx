"use client";

/**
 * /login — kept alive for the QR and field links that reference it.
 * It renders the exact same sign-in card as the landing page, so there is
 * one sign-in surface to maintain and no divergence between the two.
 */

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme";
import { SignInCard } from "@/components/landing/sign-in-card";
import { SystemStatus } from "@/components/landing/system-status";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  );
}

function LoginInner() {
  const params = useSearchParams();
  const raw = params.get("next") ?? "/console";
  // only ever follow an internal path
  const next = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/console";

  return (
    <main className="relative flex min-h-screen flex-col bg-bg text-text-primary">
      <header className="border-b border-border bg-bg">
        <div className="mx-auto flex w-full max-w-[1240px] flex-wrap items-center justify-between gap-3 px-5 py-3.5 sm:px-8">
          <div className="flex items-center gap-2.5">
            <Logo size={30} />
            <div className="flex flex-col leading-none">
              <span className="text-[17px] font-black tracking-tight text-text-primary">PAWS</span>
              <span className="mt-1 text-[10px] font-bold uppercase tracking-[0.18em] text-text-muted">
                Rescue Mission Console
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            <SystemStatus />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <section className="flex flex-1 items-center justify-center px-5 py-12">
        <div className="w-full max-w-[420px] animate-risein">
          <div className="mb-5 flex items-center justify-between">
            <Link
              href="/"
              className="land-focus inline-flex items-center gap-1.5 rounded text-[12px] font-semibold text-text-muted hover:text-text-primary"
            >
              <ArrowLeft size={14} /> Back to PAWS
            </Link>
            <Logo size={34} />
          </div>
          <SignInCard next={next} />
        </div>
      </section>

      <footer className="border-t border-border bg-bg py-6 text-center text-[12px] text-text-muted">
        Built for Rescue Teams by Team Anant Arc
      </footer>
    </main>
  );
}
