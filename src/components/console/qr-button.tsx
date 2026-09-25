"use client";

import { useEffect, useState } from "react";
import { QrCode, Copy, ExternalLink, Check } from "lucide-react";
import { Modal } from "@/components/ui";

/**
 * Minimised QR bubble (bottom-right). Click to expand: a large, crisp QR
 * plus the share link for the on-field rescuer. The link opens the mobile
 * read-only Field Rescue View.
 */
export function QrShareButton({ role, missionId }: { role: string; missionId: string }) {
  const [open, setOpen] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setError(null);
    const res = await fetch("/api/field-token");
    if (!res.ok) {
      setError(res.status === 403 ? "Only operators can share the field link." : "Could not create field link.");
      return;
    }
    const data = await res.json();
    const base = `${location.origin}/field`;
    const full = `${base}?token=${encodeURIComponent(data.token)}`;
    setUrl(full);
    const QRCode = (await import("qrcode")).default;
    const dataUrl = await QRCode.toDataURL(full, {
      width: 480,
      margin: 1,
      color: { dark: "#0a0f1a", light: "#ffffff" },
    });
    setQr(dataUrl);
  }

  useEffect(() => {
    if (open) void generate();
  }, [open]);

  async function copy() {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <>
      {/* minimised bubble */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-40 flex h-12 w-12 items-center justify-center rounded-full border border-border bg-surface text-accent shadow-xl transition-transform hover:scale-105"
        title="Share field link (QR) with on-site rescuers"
        aria-label="Open field link QR"
      >
        <QrCode size={22} />
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="Field Rescue Link">
        <div className="flex flex-col items-center gap-3">
          <p className="text-center text-[12px] leading-relaxed text-text-muted">
            Scan with any phone → the <b className="text-text-primary">Field Rescue View</b> opens with live survivor
            coordinates, pins and logs for <b className="tnum text-accent">mission {missionId.slice(-6)}</b>. Read-only.
          </p>
          {qr ? (
            <div className="rounded-xl border-4 border-white bg-white p-2 shadow-lg">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qr} alt="Field rescue QR code" className="h-56 w-56" />
            </div>
          ) : error ? (
            <p className="text-[12px] text-critical">{error}</p>
          ) : (
            <div className="flex h-56 w-56 items-center justify-center text-[12px] text-text-faint">
              Generating secure link…
            </div>
          )}

          {url && (
            <>
              <div className="flex w-full items-center gap-2 rounded-md border border-border bg-bg px-3 py-2">
                <span className="tnum min-w-0 flex-1 truncate text-[11px] text-text-muted">{url}</span>
                <button onClick={copy} className="text-text-muted hover:text-accent" title="Copy link">
                  {copied ? <Check size={14} className="text-ok" /> : <Copy size={14} />}
                </button>
                <a href={url} target="_blank" rel="noreferrer" className="text-text-muted hover:text-accent" title="Open field view">
                  <ExternalLink size={14} />
                </a>
              </div>
              <p className="text-center text-[10.5px] text-text-faint">
                Link expires in 4 hours. Observer role: read-only — no controls, no commands.
              </p>
            </>
          )}
        </div>
      </Modal>
    </>
  );
}
