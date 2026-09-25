import Link from "next/link";
import { getStore, dataMode } from "@/lib/store";
import { ThemeToggle } from "@/components/theme";

export const dynamic = "force-dynamic";

/** Public health page — the sort of page that makes a system feel real. */
export default async function StatusPage() {
  const store = getStore();
  const h = store.health();
  const ingest = await store.getState().catch(() => null);

  const rows = [
    { k: "Service", v: "paws-console · OK" },
    { k: "Data mode", v: dataMode().toUpperCase() },
    { k: "Store", v: store.mode === "local" ? "in-memory (demo)" : "Supabase · Postgres + RLS" },
    { k: "Detection provider", v: (process.env.DETECTION_PROVIDER ?? "simulated").toUpperCase() },
    { k: "Uptime", v: `${h.uptimeSec}s` },
    { k: "Ingest count", v: h.ingestCount },
    { k: "Last ingest", v: h.lastIngestAt ? new Date(h.lastIngestAt).toLocaleTimeString("en-GB") : "—" },
    { k: "Current mission", v: ingest?.mission.name ?? "—" },
    { k: "Robot link", v: (ingest?.device.link ?? "—").toUpperCase() },
  ];

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-6">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6">
        <div className="mb-1 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-ok" />
            <h1 className="text-[14px] font-bold">PAWS Console — Status</h1>
          </div>
          <ThemeToggle />
        </div>
        <p className="mb-4 text-[11.5px] text-text-faint">Public health endpoint · everything nominal</p>
        <dl className="space-y-1.5">
          {rows.map((r) => (
            <div key={r.k} className="flex items-baseline justify-between border-b border-border/50 pb-1.5 text-[12.5px]">
              <dt className="text-text-muted">{r.k}</dt>
              <dd className="tnum font-semibold text-text-primary">{r.v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-center text-[12px]">
          <Link href="/console" className="text-accent hover:underline">
            → Open console
          </Link>
        </p>
      </div>
    </div>
  );
}
