"use client";

export function PrintButton({ label = "Print / Save as PDF" }: { label?: string }) {
  return (
    <button onClick={() => window.print()} className="rounded-md bg-accent px-4 py-2 text-[12.5px] font-semibold text-slate-950">
      {label}
    </button>
  );
}

export function ExportJsonButton({ data, filename }: { data: unknown; filename: string }) {
  return (
    <button
      onClick={() => {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
      }}
      className="rounded-md border border-border bg-surface px-4 py-2 text-[12.5px] font-medium"
    >
      Export JSON
    </button>
  );
}
