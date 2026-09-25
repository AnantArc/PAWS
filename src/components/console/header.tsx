"use client";

import Link from "next/link";
import { LogOut, History, Settings2, Activity } from "lucide-react";
import type { ConsoleState } from "@/lib/types";
import { ThemeToggle } from "@/components/theme";
import { Logo } from "@/components/logo";
import { cn, fmtDuration } from "@/lib/utils";

export function Header({
  state,
  onLogout,
}: {
  state: ConsoleState;
  onLogout: () => void;
}) {
  const m = state.mission;
  const elapsed = (m.endedAt ?? state.now) - m.startedAt;
  const link = state.device.link;

  return (
    <header className="flex items-center gap-4 border-b border-border bg-surface px-4 py-2.5 shadow-sm">
      <div className="flex items-center gap-2.5">
        <Logo size={32} withText />
      </div>

      <div className="hidden items-center gap-4 border-l border-border pl-4 md:flex">
        <div>
          <div className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-text-faint">Mission</div>
          <div className="tnum max-w-[200px] truncate text-[12.5px] font-semibold text-text-primary">{m.name}</div>
        </div>
        <div>
          <div className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-text-faint">Status</div>
          <div
            className={cn(
              "text-[12.5px] font-bold uppercase tracking-wide",
              m.status === "running" ? "text-ok" : m.status === "paused" ? "text-warn" : "text-text-muted"
            )}
          >
            {m.status}
          </div>
        </div>
        <div>
          <div className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-text-faint">Elapsed</div>
          <div className="tnum text-[12.5px] font-semibold text-accent">{fmtDuration(elapsed)}</div>
        </div>
        <div>
          <div className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-text-faint">Robot</div>
          <div
            className={cn(
              "tnum text-[12.5px] font-semibold flex items-center gap-1.5",
              link === "online" ? "text-ok" : link === "delayed" ? "text-warn" : "text-critical"
            )}
          >
            <span className={cn("h-2 w-2 rounded-full", link === "online" ? "animate-pulse bg-ok" : "bg-critical")} />
            {link === "online" ? "ONLINE" : link === "delayed" ? "DELAYED" : "OFFLINE"}
          </div>
        </div>
      </div>

      <nav className="ml-auto hidden items-center gap-1 lg:flex">
        {[
          { href: "/replay", icon: <History size={14} />, label: "Replay" },
          { href: "/settings", icon: <Settings2 size={14} />, label: "Settings" },
          { href: "/status", icon: <Activity size={14} />, label: "Status" },
        ].map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-medium text-text-muted transition-colors hover:bg-surface-2 hover:text-accent"
          >
            {l.icon}
            {l.label}
          </Link>
        ))}
      </nav>

      {/* Right side: Theme Toggle + Logout (mission controls live in the body mission row) */}
      <div className="ml-auto flex items-center gap-2 lg:ml-2">
        <ThemeToggle />
        <button onClick={onLogout} className="text-text-faint hover:text-critical transition-colors" title="Sign out">
          <LogOut size={16} />
        </button>
      </div>
    </header>
  );
}
