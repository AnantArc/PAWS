import Link from "next/link";
import { ArrowRight, Flame, History, MapPin, QrCode } from "lucide-react";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme";
import { SignInCard } from "@/components/landing/sign-in-card";
import { SystemStatus } from "@/components/landing/system-status";

/**
 * PUBLIC LANDING — PAWS Rescue Mission Console
 * --------------------------------------------
 * The landing page carries the sign-in card itself (mission control access),
 * so a judge lands, reads the pitch and is one click from the console.
 * /login renders the same card for the QR + field links that reference it.
 *
 * The Mission Console is a separate surface with its own cyan identity and is
 * deliberately untouched by this page.
 */

const FEATURES = [
  {
    icon: <MapPin size={17} />,
    title: "Origin-Anchored Coordinates",
    body: "PAWS reports positions relative to its walk-in anchor, so on-field rescuers get a trail, pins and bearings they can navigate indoors.",
  },
  {
    icon: <Flame size={17} />,
    title: "Hazard Awareness & Heat-Maps",
    body: "Gas concentration maps and fire-risk temperature detection keep the rescue team out of danger while the robot goes in.",
  },
  {
    icon: <QrCode size={17} />,
    title: "Field Rescue Link",
    body: "One QR code opens a live, read-only mobile view with survivor coordinates — mission control hands the rescuer the exact spot to walk to.",
  },
  {
    icon: <History size={17} />,
    title: "Replay & Mission Reports",
    body: "Scrub any mission from the archive, then export a full incident report with sensor states at every event timestamp.",
  },
];

export default function LandingPage() {
  return (
    <main className="relative flex min-h-screen flex-col bg-bg text-text-primary">
      {/* ---------------------------------------------------------- header */}
      <header className="relative z-20 border-b border-border bg-bg">
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
            <Link
              href="#access"
              className="land-btn-primary land-focus inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-[12.5px] font-bold"
            >
              Sign In <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      </header>

      {/* --------------------------------------------- hero + feature band */}
      <section className="relative flex-1 overflow-hidden">
        {/* one photograph, treated by the theme scrim only — switches smoothly */}
        <div className="pointer-events-none absolute inset-0" aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/hero-rubble.jpg" alt="" className="land-photo h-full w-full" draggable={false} />
          <div className="land-wash absolute inset-0" />
          <div className="land-veil absolute inset-0" />
        </div>

        <div className="relative z-10 mx-auto w-full max-w-[1240px] px-5 pb-7 pt-6 sm:px-8 sm:pt-7">
          <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_420px] lg:gap-12">
            {/* ------------------------------------------------------ hero */}
            <div className="max-w-2xl">
              <div className="flex flex-wrap items-center gap-4 sm:gap-4">
                <span className="hidden sm:block">
                  <Logo size={80} />
                </span>
                <span className="sm:hidden">
                  <Logo size={56} />
                </span>
                <h1 className="text-[52px] font-black leading-[0.92] tracking-tight text-text-primary sm:text-[74px]">
                  PAWS
                </h1>
              </div>

              <p className="mt-2.5 text-[17px] font-semibold text-text-muted sm:text-[20px]">
                Post-Disaster Autonomous Walking Scout
              </p>

              <div className="my-4 h-px w-full max-w-xl" style={{ background: "rgb(var(--land-hair) / var(--land-hair-a))" }} />

              <p className="max-w-xl text-[14px] leading-relaxed text-text-muted sm:text-[15px]">
                The robot takes the risk. Your team gets coordinates, hazard maps and a survivor score it can defend,
                line by line.
              </p>
            </div>

            {/* ------------------------------------------------- sign-in card */}
            <div className="w-full lg:justify-self-end">
              <SignInCard />
            </div>
          </div>

          {/* --------------------------------------------------- four features */}
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:mt-8 lg:grid-cols-4">
            {FEATURES.map((f) => (
              <article key={f.title} className="land-panel rounded-xl p-5">
                <div
                  className="mb-3.5 inline-flex h-9 w-9 items-center justify-center rounded-lg land-amber-soft land-amber-text"
                  aria-hidden="true"
                >
                  {f.icon}
                </div>
                <h3 className="text-[13.5px] font-bold leading-snug text-text-primary">{f.title}</h3>
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-text-muted">{f.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------- footer */}
      <footer className="relative z-20 border-t border-border bg-bg py-4 text-center text-[12px] text-text-muted">
        Built for Rescue Teams by Team Anant Arc
      </footer>
    </main>
  );
}
