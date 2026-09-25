"use client";

import { useState } from "react";
import { OctagonAlert, Play, Anchor, PackageCheck } from "lucide-react";
import type { Command, ConsoleState } from "@/lib/types";
import type { Role } from "@/lib/auth";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";

const STAGES: Array<Command["current"]> = ["queued", "delivered", "acknowledged", "done", "failed"];

export function CommandBar({
  state,
  role,
  onCommand,
}: {
  state: ConsoleState;
  role: Role;
  onCommand: (t: Command["type"], params?: Record<string, string>) => Promise<void>;
}) {
  const [busyType, setBusyType] = useState<string | null>(null);
  const observer = role !== "operator";

  async function fire(t: Command["type"], params?: Record<string, string>) {
    setBusyType(t);
    await onCommand(t, params);
    setBusyType(null);
  }

  const latest = state.commands.slice(0, 3);
  const link = state.device.link;

  return (
    <section className="rounded-lg border border-border bg-surface shadow-sm">
      <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <h3 className="text-[12px] font-bold uppercase tracking-[0.12em] text-text-muted">Command</h3>
        <span
          className={cn(
            "text-[11px] font-semibold",
            link === "online" ? "text-ok" : link === "delayed" ? "text-warn" : "text-critical"
          )}
        >
          {link === "online" ? "ROBOT LINK OK" : link === "delayed" ? "LINK DELAYED" : "ROBOT OFFLINE — commands disabled"}
        </span>
      </header>
      <div className="flex flex-wrap items-center gap-2.5 p-3.5">
        <Button
          variant="danger"
          disabled={observer || link === "offline" || busyType === "estop"}
          onClick={() => fire("estop")}
          className="px-5 py-2 text-[13.5px] font-bold shadow-sm"
        >
          <OctagonAlert size={16} /> E-STOP
        </Button>
        
        <Button
          variant="success"
          disabled={observer || link === "offline" || busyType === "resume"}
          onClick={() => fire("resume")}
          className="px-4 py-2 text-[13px] font-semibold"
        >
          <Play size={14} /> Resume
        </Button>

        <Button
          disabled={observer || link === "offline" || busyType === "re_anchor"}
          onClick={() => fire("re_anchor")}
          className="px-4 py-2 text-[13px] font-semibold"
        >
          <Anchor size={14} /> Re-anchor origin
        </Button>

        {/* Change 5: Drop Survivor's Kit button */}
        <Button
          disabled={observer || link === "offline" || busyType === "deploy_payload"}
          onClick={() => fire("deploy_payload")}
          className="bg-teal-600 text-white hover:bg-teal-500 border border-teal-500/30 px-4 py-2 text-[13px] font-bold shadow-sm"
        >
          <PackageCheck size={15} /> Drop Survivor's Kit
        </Button>

        {observer && <span className="ml-auto text-[11px] italic text-text-faint">observer session — commands disabled</span>}
      </div>

      {/* lifecycle strip */}
      <div className="border-t border-border px-4 py-2">
        {latest.length === 0 ? (
          <p className="text-[11px] text-text-faint">No commands issued yet.</p>
        ) : (
          <div className="space-y-1.5">
            {latest.map((c) => (
              <CommandRow key={c.id} cmd={c} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function CommandRow({ cmd }: { cmd: Command }) {
  const label: Record<string, string> = {
    estop: "EMERGENCY STOP",
    resume: "Resume mission",
    re_anchor: "Re-anchor origin",
    deploy_payload: "Drop Survivor's Kit",
    set_mode: "Set mode",
  };
  const activeIdx = STAGES.indexOf(cmd.current === "failed" ? "failed" : cmd.current === "done" ? "done" : cmd.current);
  const failed = cmd.current === "failed";
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border bg-bg/40 px-2.5 py-1.5">
      <span className={cn("text-[11.5px] font-bold", cmd.type === "estop" ? "text-critical" : cmd.type === "deploy_payload" ? "text-teal-400" : "text-text-primary")}>
        {label[cmd.type] ?? cmd.type}
      </span>
      <div className="flex items-center gap-1">
        {(["queued", "delivered", "acknowledged", "done"] as const).map((s, i) => {
          const reached = failed ? i < 3 : i <= activeIdx;
          return (
            <span key={s} className="flex items-center gap-1">
              <span
                className={cn(
                  "rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide",
                  failed && s === "acknowledged"
                    ? "bg-critical/20 text-critical"
                    : reached
                      ? "bg-ok/15 text-ok"
                      : "bg-surface-2 text-text-faint"
                )}
              >
                {s}
              </span>
              {i < 3 && <span className="h-px w-2 bg-border" />}
            </span>
          );
        })}
        {failed && <span className="rounded bg-critical/20 px-1.5 py-0.5 text-[9px] font-bold uppercase text-critical">failed</span>}
      </div>
      <span className="tnum ml-auto text-[10px] text-text-faint">by {cmd.issuedBy}</span>
    </div>
  );
}
